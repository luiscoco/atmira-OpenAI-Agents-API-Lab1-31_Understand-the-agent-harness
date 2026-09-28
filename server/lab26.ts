import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import type { AgentSessionEvent } from 'openai/resources/beta/agents/agents';
import type { Stream } from 'openai/core/streaming';
import type { TurnStatus } from '../src/lab16Tool.ts';
import {
  checkEnvironment, checkSpec, instructions, parseCommand, parseUsage, primeSum, promptFor,
  type CommandRun, type EnvKind, type EnvRun, type EnvironmentParam, type TaskKind,
} from '../src/lab26Environment.ts';
import { runEnvSuite } from '../src/lab26Tests.ts';

type AgentConfig = { model: string; instructions: string };

// Live, 2026-09-28: environment.ready arrived 19.7–26.1 s after sessions.create. Wait longer than that, but not forever.
const readyLimitMs = 150_000;
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
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 8_000) throw new Error('Request is too large.');
  }
  const parsed: unknown = raw ? JSON.parse(raw) : {};
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  return parsed as Record<string, unknown>;
}
const errorMessage = (error: unknown) => {
  const failure = error as { status?: number; error?: { message?: string }; message?: string };
  return `${failure.status ? `${failure.status} ` : ''}${failure.error?.message ?? failure.message ?? 'The API rejected the request.'}`;
};

type Trace = { run: EnvRun; started: number; commands: Map<string, CommandRun>; parts: Map<string, string>; commentary: Map<string, string>; seen: Set<string>; turnId: string | null; lastEventAt: number; settled: boolean };
const terminalStatuses = ['completed', 'failed', 'cancelled'];
const elapsed = (trace: Trace) => Date.now() - trace.started;
const answerOf = (trace: Trace) => [...trace.parts.values()].join('\n');

function seeCommand(response: ServerResponse, trace: Trace, item: unknown) {
  const command = parseCommand(item);
  if (command.output && command.output.length > outputLimit) command.output = `${command.output.slice(0, outputLimit)}\n… (${command.output.length.toLocaleString('en')} characters in all)`;
  trace.commands.set(command.id, command);
  writeEvent(response, { type: 'command', command });
}

async function follow(response: ServerResponse, trace: Trace, stream: Stream<AgentSessionEvent>, send: () => Promise<void>) {
  for await (const event of stream) {
    if (response.destroyed) return;
    if (trace.seen.has(event.event_id)) continue;
    trace.seen.add(event.event_id);
    trace.lastEventAt = Date.now();
    if (trace.settled) return;
    if (!/delta/.test(event.type)) writeEvent(response, { type: 'event', name: event.type, ms: elapsed(trace) });
    if (event.type === 'agent.session.created') {
      trace.run.sessionId = event.session.id;
      trace.run.reportedType = event.session.environment.type;
      writeEvent(response, { type: 'session', sessionId: event.session.id, environment: event.session.environment, ms: elapsed(trace) });
      continue;
    }
    // Live: a hosted session sent environment.ready twice (26.1 s and 32.1 s). Only the first one sends the question.
    if (event.type === 'agent.session.environment.ready') {
      if (trace.run.readyMs === null) trace.run.readyMs = elapsed(trace);
      await send();
      continue;
    }
    if (event.type === 'agent.session.environment.failed') {
      trace.run.turnStatus = 'failed';
      trace.run.error = `The hosted environment failed${event.environment.error ? `: ${event.environment.error.message ?? event.environment.error.code}` : '.'}`;
      return;
    }
    if ('turn' in event && event.turn?.subagent_id == null && !trace.turnId) trace.turnId = event.turn.id;
    if (event.type === 'agent.session.turn.item.done' && event.item.type === 'command_execution') { seeCommand(response, trace, event.item); continue; }
    if (event.type === 'agent.session.turn.item.added' && event.item.type === 'command_execution') { writeEvent(response, { type: 'status', label: 'Running a command in the sandbox' }); continue; }
    // Commentary ("I'll compute both directly…") is kept apart from the answer: the judge compares it with the evidence.
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
      if (event.type === 'agent.session.turn.failed') trace.run.error = event.turn.error?.message ?? 'The turn failed.';
      return;
    }
    if (event.type === 'error') { trace.run.turnStatus = 'failed'; trace.run.error = event.error?.message ?? 'The agent returned an error.'; return; }
    if (event.type === 'agent.session.failed') { trace.run.turnStatus = 'failed'; trace.run.error = 'The agent session failed.'; return; }
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
  if (turn.status === 'failed') trace.run.error = turn.error?.message ?? 'The turn failed.';
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

// POST /api/lab26/run — one task in a brand-new session, in the environment the student chose.
export async function runLab26(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const task: TaskKind = body.task === 'compute' ? 'compute' : 'explain';
  const spec = task === 'compute' ? checkSpec(body.spec) : null;
  if (task === 'compute' && !spec) return sendJson(response, 400, { error: 'The compute task needs a spec: text lab26-<8 hex digits> and an integer limit from 1,000 to 1,000,000.' });
  // The same checker as the browser. With force, a refused request still goes to the API, to see its own answer.
  const checked = checkEnvironment(body.environment);
  const force = body.force === true && typeof body.environment === 'object' && body.environment !== null && JSON.stringify(body.environment).length < 2_000;
  if (!checked.environment && !force) return sendJson(response, 400, { error: 'Fix the environment first.', findings: checked.findings });
  const environment = (checked.environment ?? body.environment) as EnvironmentParam;
  const kind: EnvKind = environment.type === 'openai_hosted' ? 'openai_hosted' : 'none';
  const prompt = promptFor(task, spec);
  // Expected values come from node:crypto here; the browser recomputes them with its own SHA-256.
  const expected = spec ? { sha256: createHash('sha256').update(spec.text).digest('hex'), primeSum: primeSum(spec.limit) } : null;

  const trace: Trace = {
    run: {
      task, kind, prompt, spec, expected, sessionId: null, environmentId: null, reportedType: null, network: null, turnStatus: 'unknown', readyMs: null, durationMs: null,
      commands: [], commentary: [], answer: '', error: null, usage: null, completion: 'stream',
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
    writeEvent(response, { type: 'declared', environment, findings: checked.findings, forced: !checked.environment });
    if (kind === 'none') {
      // No sandbox to wait for: the question goes in with sessions.create, and the stream starts at once.
      writeEvent(response, { type: 'status', label: 'Creating a none session with the question' });
      stream = await api.beta.agents.sessions.create({ agent: { model: agent.model, instructions }, environment, input: prompt, stream: true });
      await follow(response, trace, stream, async () => {});
    } else {
      writeEvent(response, { type: 'status', label: 'Creating an openai_hosted session without input' });
      const session = await api.beta.agents.sessions.create({ agent: { model: agent.model, instructions }, environment });
      trace.run.sessionId = session.id;
      trace.run.reportedType = session.environment.type;
      if (session.environment.type === 'openai_hosted') {
        trace.run.environmentId = session.environment.id;
        trace.run.network = { access: session.environment.network.access, allowed_domains: session.environment.network.allowed_domains };
      }
      writeEvent(response, { type: 'session', sessionId: session.id, environment: session.environment, ms: elapsed(trace) });
      stream = await api.beta.agents.sessions.events.stream(session.id);
      let sent = false;
      const send = async () => {
        if (sent) return;
        sent = true;
        clearTimeout(waiting);
        writeEvent(response, { type: 'status', label: trace.run.readyMs === null ? `No ready event within ${readyLimitMs / 1000} s: sending the task anyway` : `Sandbox ready after ${(trace.run.readyMs / 1000).toFixed(1)} s: sending the task` });
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
      waiting = setTimeout(() => { void send().catch(() => stream?.controller.abort()); }, readyLimitMs);
      await follow(response, trace, stream, send);
    }
  } catch (caught) {
    if (response.destroyed) return;
    if (trace.run.completion !== 'polled') {
      trace.run.error = errorMessage(caught);
      if (trace.run.turnStatus === 'unknown') trace.run.turnStatus = 'failed';
    }
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

// POST /api/lab26/test — the same suite as the browser, on the server. No network, no API key.
export function testLab26(_request: IncomingMessage, response: ServerResponse) {
  try {
    const started = performance.now();
    const results = runEnvSuite();
    sendJson(response, 200, { results, runtime: `Node ${process.version}`, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'The suite crashed.' });
  }
}
