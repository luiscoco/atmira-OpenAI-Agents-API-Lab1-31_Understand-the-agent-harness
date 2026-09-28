import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import type { AgentSessionEvent } from 'openai/resources/beta/agents/agents';
import type { Stream } from 'openai/core/streaming';
import type { TurnStatus } from '../src/lab16Tool.ts';
import { hasErrors, parseMcpCall, type Discovery, type McpCall } from '../src/lab22Mcp.ts';
import {
  allowInstructions, allowedNames, buildRestrictedTool, defaultAllowSettings, isAllowedCall, probes, uncheckedTool,
  type AllowSettings, type ProbeRun, type RestrictedTool,
} from '../src/lab23Allow.ts';
import { runAllowSuite } from '../src/lab23Tests.ts';
import { discover } from './lab22.ts';

type AgentConfig = { model: string; instructions: string };

// Probes run in parallel, and each connects to the server, so allow as long as one slow Lab 22 run.
const runLimitMs = 180_000;
const maxRuns = 6;
// tools/list rarely changes within minutes; a short cache keeps every run from repeating the handshake.
const discoveryTtlMs = 5 * 60_000;
const discoveries = new Map<string, { at: number; result: Discovery }>();

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
    if (raw.length > 16_000) throw new Error('Request is too large.');
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  return parsed as Record<string, unknown>;
}
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const errorMessage = (error: unknown) => {
  const failure = error as { status?: number; error?: { message?: string }; message?: string };
  return `${failure.status ? `${failure.status} ` : ''}${failure.error?.message ?? failure.message ?? 'The API rejected the request.'}`;
};

// The browser sends plain settings. The server rebuilds the declaration itself and refuses anything with an error.
function settingsOf(value: unknown): AllowSettings {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const field = (input: unknown, fallback: string, max: number) => (typeof input === 'string' ? input.slice(0, max) : fallback);
  return {
    label: field(raw.label, defaultAllowSettings.label, 100),
    serverUrl: field(raw.serverUrl, defaultAllowSettings.serverUrl, 2_000),
    required: raw.required !== false,
    origin: raw.origin === 'environment' ? 'environment' : 'service',
    restrict: raw.restrict !== false,
    allowed: Array.isArray(raw.allowed) ? raw.allowed.filter((name): name is string => typeof name === 'string').slice(0, 64).map((name) => name.slice(0, 128)) : [],
  };
}

// The allowlist is only as good as its names, so the server checks them against a fresh (or recent) tools/list.
async function toolsFor(url: string, fresh = false): Promise<Discovery> {
  const cached = discoveries.get(url);
  if (!fresh && cached && Date.now() - cached.at < discoveryTtlMs && !cached.result.error) return cached.result;
  const result = await discover(url);
  discoveries.set(url, { at: Date.now(), result });
  return result;
}

// POST /api/lab23/discover — tools/list for the declared server (cached for five minutes). No OpenAI call, no API key.
export async function discoverLab23(request: IncomingMessage, response: ServerResponse) {
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const tool = uncheckedTool(settingsOf(body.mcp));
  if (!tool) return sendJson(response, 400, { error: 'Fix the server label and URL first.' });
  sendJson(response, 200, await toolsFor(tool.transport.server_url, body.fresh === true));
}

// ---- The allowlist test: one session per probe, all with the same declaration ----

type Job = { probeId: string; prompt: string; target: string | null };

async function runProbe(api: OpenAI, response: ServerResponse, agent: AgentConfig, tool: RestrictedTool, job: Job, streams: Set<Stream<AgentSessionEvent>>): Promise<ProbeRun> {
  const started = Date.now();
  const allowed = allowedNames(tool);
  const run: ProbeRun = { ...job, sessionId: null, turnStatus: 'unknown', calls: [], answer: '', durationMs: null, error: null, stopped: false };
  const callMap = new Map<string, McpCall>();
  const parts = new Map<string, string>();
  const commentary = new Set<string>();
  let turnId: string | null = null;
  let stream: Stream<AgentSessionEvent> | undefined;
  writeEvent(response, { type: 'probe', probeId: job.probeId, state: 'start' });
  try {
    stream = await api.beta.agents.sessions.create({
      agent: { ...agent, instructions: allowInstructions(new Date().toISOString().slice(0, 10), tool.server_label), tools: [tool] },
      environment: { type: 'none' },
      input: job.prompt,
      stream: true,
    });
    streams.add(stream);
    for await (const event of stream) {
      if (response.destroyed) break;
      if (event.type === 'agent.session.created') { run.sessionId = event.session.id; writeEvent(response, { type: 'probe', probeId: job.probeId, state: 'session', sessionId: run.sessionId }); }
      if ('turn' in event && event.turn?.subagent_id == null && !turnId) turnId = event.turn.id;

      if ((event.type === 'agent.session.turn.item.added' || event.type === 'agent.session.turn.item.done') && event.item.type === 'mcp_call') {
        const call = parseMcpCall(event.item);
        if (call.output && call.output.length > 4_000) call.output = `${call.output.slice(0, 4_000)}\n… (${call.output.length.toLocaleString('en')} characters in all)`;
        callMap.set(call.id, call);
        writeEvent(response, { type: 'call', probeId: job.probeId, call });
        // The API enforces allowed_tools. The app checks anyway: a call outside the list stops the turn at once.
        if (!isAllowedCall(call, allowed) && !run.stopped && run.sessionId) {
          run.stopped = true;
          run.error = `${call.name} is not in allowed_tools. The server cancelled the turn.`;
          await api.beta.agents.sessions.events.create(run.sessionId, { events: [{ type: 'agent.session.input.cancel' }] });
        }
        continue;
      }
      if (event.type === 'agent.session.turn.item.added' && event.item.type === 'message' && event.item.phase === 'commentary' && event.item.id) commentary.add(event.item.id);
      if ((event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') && !commentary.has(event.item_id)) {
        const key = `${event.item_id}:${event.content_index}`;
        parts.set(key, event.type === 'agent.session.turn.output_text.delta' ? (parts.get(key) ?? '') + event.delta : event.text);
        run.answer = [...parts.values()].join('\n');
        writeEvent(response, { type: 'text', probeId: job.probeId, text: run.answer });
        continue;
      }
      // MCP tools run on OpenAI's side and this agent has no function tools, so a pause is unexpected: cancel it.
      if (event.type === 'agent.session.requires_action') {
        run.error = 'The turn asked for a function result, but this lab declares no function tools. The server cancelled it.';
        await api.beta.agents.sessions.events.create(run.sessionId ?? '', { events: [{ type: 'agent.session.input.cancel' }] });
        continue;
      }
      const terminal = event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled';
      if (terminal && event.turn.subagent_id == null && (!turnId || event.turn.id === turnId)) {
        run.turnStatus = event.turn.status as TurnStatus;
        if (event.type === 'agent.session.turn.failed') run.error = event.turn.error?.message ?? 'The turn failed.';
        break;
      }
      if (event.type === 'error') { run.turnStatus = 'failed'; run.error = event.error?.message ?? 'The agent returned an error.'; break; }
      if (event.type === 'agent.session.failed') { run.turnStatus = 'failed'; run.error = 'The agent session failed.'; break; }
    }
    if (run.turnStatus === 'unknown' && !run.error) run.error = 'The stream closed before the turn had an outcome.';
  } catch (caught) {
    // A 400 here is the API refusing the declaration itself, for example an environment origin with no environment.
    run.error = errorMessage(caught);
    run.turnStatus = 'failed';
  } finally {
    stream?.controller.abort();
    if (stream) streams.delete(stream);
  }
  run.calls = [...callMap.values()];
  run.durationMs = Date.now() - started;
  writeEvent(response, { type: 'done', probeId: job.probeId, run });
  return run;
}

// POST /api/lab23/run — the chosen probes (and an optional question of your own), each in its own session, in parallel.
export async function runLab23(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const settings = settingsOf(body.mcp);
  const chosen = Array.isArray(body.probes) ? probes.filter((probe) => (body.probes as unknown[]).includes(probe.id)) : [];
  const question = text(body.prompt);
  if (question.length > 2000) return sendJson(response, 400, { error: 'Your question must be at most 2,000 characters.' });
  const jobs: Job[] = [...chosen.map((probe) => ({ probeId: probe.id, prompt: probe.prompt, target: probe.target })), ...(question ? [{ probeId: 'custom', prompt: question, target: null }] : [])];
  if (!jobs.length || jobs.length > maxRuns) return sendJson(response, 400, { error: `Choose between 1 and ${maxRuns} probes.` });

  const skipChecks = body.skipChecks === true;
  const unchecked = uncheckedTool(settings);
  if (!unchecked) return sendJson(response, 400, { error: 'Fix the server label and URL first.', findings: buildRestrictedTool(settings, null).findings });
  // Check the names against tools/list before sending: the API accepts a name that matches nothing, silently.
  const discovery = await toolsFor(unchecked.transport.server_url);
  const discovered = discovery.error ? null : discovery.tools;
  const built = buildRestrictedTool(settings, discovered);
  if (hasErrors(built.findings) && !skipChecks) return sendJson(response, 400, { error: 'Fix the allowlist or the origin first.', findings: built.findings });
  const tool = skipChecks ? unchecked : built.tool;
  if (!tool) return sendJson(response, 400, { error: 'Fix the settings first.', findings: built.findings });

  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = client();
  const streams = new Set<Stream<AgentSessionEvent>>();
  const stopAll = () => { for (const stream of streams) stream.controller.abort(); };
  response.on('close', stopAll);
  const limit = setTimeout(stopAll, runLimitMs);
  const started = Date.now();
  try {
    writeEvent(response, { type: 'declared', tool, findings: built.findings, skipped: skipChecks && hasErrors(built.findings), discovered: discovered ? discovered.map((item) => item.name) : null, discoveryError: discovery.error });
    const runs = await Promise.all(jobs.map((job) => runProbe(api, response, agent, tool, job, streams)));
    writeEvent(response, { type: 'summary', tool, runs, durationMs: Date.now() - started });
  } finally {
    clearTimeout(limit);
    stopAll();
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

// POST /api/lab23/test — the same suite as the browser, on the server. No network, no API key.
export function testLab23(_request: IncomingMessage, response: ServerResponse) {
  try {
    const started = performance.now();
    const results = runAllowSuite();
    sendJson(response, 200, { results, runtime: `Node ${process.version}`, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'The suite crashed.' });
  }
}
