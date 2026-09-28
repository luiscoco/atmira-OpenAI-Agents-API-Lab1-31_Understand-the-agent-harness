import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import type { AgentSessionEvent } from 'openai/resources/beta/agents/agents';
import type { Stream } from 'openai/core/streaming';
import type { TurnStatus } from '../src/lab16Tool.ts';
import { parseCommand, parseUsage, type CommandRun } from '../src/lab26Environment.ts';
import { parseFileRef } from '../src/lab27Files.ts';
import {
  buildEnvironment, checkConfig, checkRequest, classifyError, fingerprint, lockDir, parseEcho, presets, taskInfo,
  type ConfigRun, type Preset, type Task,
} from '../src/lab28Packages.ts';
import { runPackageSuite } from '../src/lab28Tests.ts';

type AgentConfig = { model: string; instructions: string };

// Live, 2026-09-28: environment.ready after 15.6–26.0 s with no packages, 23.5–33.2 s with tabulate and jq.
const readyLimitMs = 180_000;
const runLimitMs = 300_000;
// Live (Lab 25): a turn completed at the API while the stream never delivered turn.completed. Check when quiet this long.
const quietMs = 10_000;
const outputLimit = 4_000;

const configured = () => Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_api_key_here');
const client = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};
const writeEvent = (response: ServerResponse, event: unknown) => {
  if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(event)}\n`);
};
async function readBody(request: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > limit) throw new Error('Request is too large.');
  }
  const parsed: unknown = raw ? JSON.parse(raw) : {};
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  return parsed as Record<string, unknown>;
}
const errorMessage = (error: unknown) => {
  const failure = error as { status?: number; error?: { message?: string }; message?: string };
  return `${failure.status ? `${failure.status} ` : ''}${failure.error?.message ?? failure.message ?? 'The API rejected the request.'}`;
};

type Trace = { run: ConfigRun; started: number; commands: Map<string, CommandRun>; parts: Map<string, string>; commentary: Map<string, string>; seen: Set<string>; turnId: string | null; lastEventAt: number; settled: boolean };
const terminalStatuses = ['completed', 'failed', 'cancelled'];
const elapsed = (trace: Trace) => Date.now() - trace.started;
const answerOf = (trace: Trace) => [...trace.parts.values()].join('\n');
const fail = (trace: Trace, message: string) => { trace.run.turnStatus = 'failed'; trace.run.error = message; trace.run.errorKind = classifyError(message); };

function seeCommand(response: ServerResponse, trace: Trace, item: unknown) {
  const command = parseCommand(item);
  if (command.output && command.output.length > outputLimit) command.output = `${command.output.slice(0, 1_000)}\n… (${command.output.length.toLocaleString('en')} characters in all) …\n${command.output.slice(-2_500)}`;
  trace.commands.set(command.id, command);
  writeEvent(response, { type: 'command', command });
}

async function follow(response: ServerResponse, trace: Trace, stream: Stream<AgentSessionEvent>, onReady: () => Promise<void>) {
  for await (const event of stream) {
    if (response.destroyed) return;
    if (trace.seen.has(event.event_id)) continue;
    trace.seen.add(event.event_id);
    trace.lastEventAt = Date.now();
    if (trace.settled) return;
    if (!/delta/.test(event.type)) writeEvent(response, { type: 'event', name: event.type, ms: elapsed(trace) });
    // Live: environment.ready arrived twice in every session. Only the first one lists the environment and sends the task.
    if (event.type === 'agent.session.environment.ready') {
      if (trace.run.readyMs === null) trace.run.readyMs = elapsed(trace);
      await onReady();
      continue;
    }
    // Live: a failing setup command gave environment.failed "The environment failed to connect.", with no word about setup.
    if (event.type === 'agent.session.environment.failed') {
      fail(trace, `The hosted environment failed: ${event.environment.error?.message ?? event.environment.error?.code ?? 'no reason given'}`);
      trace.run.errorKind = 'environment';
      return;
    }
    if ('turn' in event && event.turn?.subagent_id == null && !trace.turnId) trace.turnId = event.turn.id;
    if (event.type === 'agent.session.turn.item.done' && event.item.type === 'command_execution') { seeCommand(response, trace, event.item); continue; }
    if (event.type === 'agent.session.turn.item.added' && event.item.type === 'command_execution') { writeEvent(response, { type: 'status', label: 'Running a command in the sandbox' }); continue; }
    if (event.type === 'agent.session.turn.item.added' && event.item.type === 'message' && event.item.phase === 'commentary' && event.item.id) { trace.commentary.set(event.item.id, ''); continue; }
    if (event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') {
      const target = trace.commentary.has(event.item_id) ? trace.commentary : trace.parts;
      const key = target === trace.commentary ? event.item_id : `${event.item_id}:${event.content_index}`;
      target.set(key, event.type === 'agent.session.turn.output_text.delta' ? (target.get(key) ?? '') + event.delta : event.text);
      writeEvent(response, { type: 'text', text: answerOf(trace), commentary: [...trace.commentary.values()].filter(Boolean) });
      continue;
    }
    const terminal = event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled';
    if (terminal && event.turn.subagent_id == null && (!trace.turnId || event.turn.id === trace.turnId)) {
      trace.settled = true;
      trace.run.turnStatus = event.turn.status as TurnStatus;
      trace.run.usage = parseUsage(event.turn.usage);
      if (event.type === 'agent.session.turn.failed') fail(trace, event.turn.error?.message ?? 'The turn failed.');
      return;
    }
    if (event.type === 'error') { fail(trace, event.error?.message ?? 'The agent returned an error.'); return; }
    if (event.type === 'agent.session.failed') { fail(trace, 'The agent session failed.'); return; }
  }
  if (trace.run.turnStatus === 'unknown' && !trace.run.error) trace.run.error = 'The stream closed before the turn had an outcome.';
}

// The stream went quiet: ask the API for the turn. If it has ended, rebuild the commands and the answer from saved items.
async function settleFromApi(api: OpenAI, response: ServerResponse, trace: Trace, sessionId: string): Promise<boolean> {
  const turn = trace.turnId
    ? await api.beta.agents.sessions.turns.retrieve(trace.turnId, { session_id: sessionId })
    : (await api.beta.agents.sessions.turns.list(sessionId, { limit: 5 })).data.find((item) => item.subagent_id == null);
  if (!turn || !terminalStatuses.includes(turn.status) || trace.settled) return false;
  Object.assign(trace, { settled: true, turnId: turn.id });
  Object.assign(trace.run, { turnStatus: turn.status as TurnStatus, completion: 'polled', usage: parseUsage(turn.usage) });
  if (turn.status === 'failed') fail(trace, turn.error?.message ?? 'The turn failed.');
  writeEvent(response, { type: 'status', label: `The stream went quiet for ${quietMs / 1000} s; the API says the turn ${turn.status}. Reading the saved items.` });
  const page = await api.beta.agents.sessions.items.list(sessionId, { order: 'asc', limit: 100 });
  const answer: string[] = [];
  for (const item of page.data) {
    if ('turn_id' in item && item.turn_id !== turn.id) continue;
    if (item.type === 'command_execution' && !trace.commands.has(item.id)) seeCommand(response, trace, item);
    if (item.type === 'message' && item.role === 'assistant') {
      const text = item.content.map((part) => ('text' in part ? part.text : '')).join('');
      if (item.phase === 'commentary') trace.commentary.set(item.id, text); else answer.push(text);
    }
  }
  if (answer.length) trace.parts = new Map([['saved', answer.join('\n')]]);
  writeEvent(response, { type: 'text', text: answerOf(trace), commentary: [...trace.commentary.values()].filter(Boolean) });
  return true;
}

// POST /api/lab28/run — one task in a brand-new hosted session, with the packages and network policy the student chose.
export async function runLab28(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request, 20_000); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const task: Task = body.task === 'install' ? 'install' : 'audit';
  const preset = typeof body.preset === 'string' && body.preset in presets ? body.preset as Preset : null;
  // The same checks as the browser. The server builds the environment itself; it never forwards a raw one.
  const checked = checkConfig(body.config);
  if (!checked.config) return sendJson(response, 400, { error: 'Fix the configuration first.', findings: checked.findings });
  const { config } = checked;
  const environment = buildEnvironment(config, task);
  const { instructions, prompt } = taskInfo[task];

  const trace: Trace = {
    run: {
      task, preset, config, prompt, model: agent.model, fingerprint: fingerprint(environment),
      sessionId: null, environmentId: null, echo: null, listed: null,
      turnStatus: 'unknown', readyMs: null, durationMs: null, commands: [], commentary: [], answer: '', error: null, errorKind: null, usage: null, completion: 'stream',
    },
    started: Date.now(), commands: new Map(), parts: new Map(), commentary: new Map(), seen: new Set(), turnId: null, lastEventAt: Date.now(), settled: false,
  };
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = client();
  let stream: Stream<AgentSessionEvent> | undefined;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  response.on('close', () => stream?.controller.abort());
  const limit = setTimeout(() => stream?.controller.abort(), runLimitMs);
  try {
    writeEvent(response, { type: 'declared', environment, fingerprint: trace.run.fingerprint, findings: checked.findings });
    writeEvent(response, { type: 'status', label: environment.packages ? 'Creating an openai_hosted session: the packages are installed before environment.ready' : 'Creating an openai_hosted session' });
    // No input yet: the task goes in when the sandbox is ready.
    const session = await api.beta.agents.sessions.create({ agent: { model: agent.model, instructions }, environment });
    trace.run.sessionId = session.id;
    if (session.environment.type === 'openai_hosted') {
      trace.run.environmentId = session.environment.id;
      // Live: the echo lists packages and the effective network policy. Setup commands are confidential and never echoed.
      trace.run.echo = parseEcho(session.environment);
    }
    writeEvent(response, { type: 'session', sessionId: session.id, echo: trace.run.echo, ms: elapsed(trace) });
    stream = await api.beta.agents.sessions.events.stream(session.id);
    let sent = false;
    const onReady = async () => {
      if (sent) return;
      sent = true;
      clearTimeout(waiting);
      const environmentId = trace.run.environmentId;
      writeEvent(response, { type: 'status', label: trace.run.readyMs === null ? `No ready event within ${readyLimitMs / 1000} s: going on anyway` : `Sandbox ready after ${(trace.run.readyMs / 1000).toFixed(1)} s` });
      // The setup command's only visible trace: the lock file it wrote, seen by the API, not by the agent.
      if (environmentId && task === 'audit') {
        try {
          const page = await api.beta.agents.environments.files.list(environmentId, { path: lockDir, order: 'asc', limit: 20 });
          trace.run.listed = page.data.map(parseFileRef);
        } catch (caught) {
          trace.run.listed = [];
          writeEvent(response, { type: 'status', label: `environments.files.list ${lockDir}: ${errorMessage(caught)}` });
        }
        writeEvent(response, { type: 'listed', files: trace.run.listed, ms: elapsed(trace) });
      }
      writeEvent(response, { type: 'status', label: task === 'audit' ? 'Sending the audit' : 'Sending the install task' });
      await api.beta.agents.sessions.events.create(session.id, { events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }] });
      trace.lastEventAt = Date.now();
      let checking = false;
      watchdog = setInterval(() => {
        if (checking || trace.settled || Date.now() - trace.lastEventAt < quietMs) return;
        checking = true;
        settleFromApi(api, response, trace, session.id)
          .then((done) => { if (done) stream?.controller.abort(); else trace.lastEventAt = Date.now(); })
          .catch(() => { trace.lastEventAt = Date.now(); })
          .finally(() => { checking = false; });
      }, 2_500);
    };
    writeEvent(response, { type: 'status', label: 'Waiting for agent.session.environment.ready' });
    waiting = setTimeout(() => { void onReady().catch(() => stream?.controller.abort()); }, readyLimitMs);
    await follow(response, trace, stream, onReady);
  } catch (caught) {
    if (response.destroyed) return;
    // Live: an unknown package ended the stream itself with "Failed to provision environment: script "Python package
    // installation" failed with exit code 1: … No matching distribution found for …".
    if (trace.run.completion !== 'polled') fail(trace, errorMessage(caught));
  } finally {
    clearTimeout(limit);
    clearTimeout(waiting);
    clearInterval(watchdog);
    stream?.controller.abort();
    // Usage is best-effort (Lab 15): the event often carries null, and the turn may fill it in only later.
    if (!trace.run.usage && trace.turnId && trace.run.sessionId) {
      try { trace.run.usage = parseUsage((await api.beta.agents.sessions.turns.retrieve(trace.turnId, { session_id: trace.run.sessionId })).usage); } catch { /* unknown stays unknown */ }
    }
    trace.run.commands = [...trace.commands.values()];
    trace.run.commentary = [...trace.commentary.values()].filter(Boolean);
    trace.run.answer = answerOf(trace);
    trace.run.durationMs = elapsed(trace);
    writeEvent(response, { type: 'summary', run: trace.run });
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

// POST /api/lab28/probe — send an environment the checker refuses, to compare the API's own 400 with the checker.
// Only refused requests are sent: an accepted one would provision a sandbox for nothing.
export async function probeLab28(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request, 60_000); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request (at most 60 KB).' }); }
  const checked = checkRequest(body.environment);
  if (checked.environment) return sendJson(response, 400, { error: 'The checker accepts this request, so it is not sent: it would create a sandbox. Use the live run instead.' });
  try {
    const session = await client().beta.agents.sessions.create({ agent: { model: agent.model, instructions: taskInfo.audit.instructions }, environment: body.environment as never });
    sendJson(response, 200, { status: 200, message: `Accepted: session ${session.id}. The checker was stricter than the API here. The hosted session stays in the project until it is deleted (Lab 30).`, sessionId: session.id });
  } catch (caught) {
    const failure = caught as { status?: number };
    sendJson(response, 200, { status: failure.status ?? 0, message: errorMessage(caught) });
  }
}

// POST /api/lab28/test — the same suite as the browser, on the server. No network, no API key.
export function testLab28(_request: IncomingMessage, response: ServerResponse) {
  try {
    const started = performance.now();
    const results = runPackageSuite();
    sendJson(response, 200, { results, runtime: `Node ${process.version}`, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'The suite crashed.' });
  }
}
