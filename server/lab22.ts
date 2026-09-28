import type { IncomingMessage, ServerResponse } from 'node:http';
import { lookup } from 'node:dns/promises';
import OpenAI from 'openai';
import type { AgentSessionEvent, AgentSessionItem } from 'openai/resources/beta/agents/agents';
import type { Stream } from 'openai/core/streaming';
import type { TurnStatus } from '../src/lab16Tool.ts';
import {
  buildMcpTool, defaultSettings, describeCall, docsInstructions, failed, hasErrors, isPrivateAddress, parseMcpCall, parseRpcMessages, parseToolList, rpcResult,
  type DiscoveredTool, type Discovery, type DiscoveryStep, type McpCall, type McpSettings, type McpSummary, type McpTool, type Moment,
} from '../src/lab22Mcp.ts';
import { runMcpSuite } from '../src/lab22Tests.ts';

type AgentConfig = { model: string; instructions: string };

// Connecting, discovering, and calling a remote server takes longer than a plain answer.
const runLimitMs = 180_000;
const probeLimitMs = 8_000;
const probeMaxBytes = 1_000_000;
const sessionIdPattern = /^sess_[A-Za-z0-9_-]+$/;

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
    if (raw.length > 12_000) throw new Error('Request is too large.');
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
function settingsOf(value: unknown): McpSettings {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const field = (input: unknown, fallback: string, max: number) => (typeof input === 'string' ? input.slice(0, max) : fallback);
  return {
    offered: raw.offered !== false,
    label: field(raw.label, defaultSettings.label, 100),
    serverUrl: field(raw.serverUrl, defaultSettings.serverUrl, 2_000),
    required: raw.required === true,
  };
}

// ---- Discovery: the handshake the Agents API performs before the turn, repeated here so students can see it ----

// A server that fetches a URL typed in the browser must not become a way into your own network:
// resolve the host first and refuse private addresses, and refuse redirects instead of following them.
async function assertPublicHost(url: string) {
  const host = new URL(url).hostname;
  const addresses = await lookup(host, { all: true });
  const blocked = addresses.find((entry) => isPrivateAddress(entry.address));
  if (blocked) throw new Error(`${host} resolves to ${blocked.address}, a private address. The probe will not connect to it.`);
}

async function rpc(url: string, body: unknown, session: string | null, step: string) {
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(probeLimitMs),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
      ...(session ? { 'Mcp-Session-Id': session } : {}),
    },
    body: JSON.stringify(body),
  });
  if (response.status >= 300 && response.status < 400) throw new Error(`${step}: the server redirected (${response.status}). The probe does not follow redirects.`);
  const raw = await response.text();
  if (raw.length > probeMaxBytes) throw new Error(`${step}: the response is larger than ${probeMaxBytes / 1_000_000} MB.`);
  return { status: response.status, ok: response.ok, raw, contentType: response.headers.get('content-type'), session: response.headers.get('mcp-session-id'), ms: Math.round(performance.now() - started) };
}

export async function discover(url: string): Promise<Discovery> {
  const started = performance.now();
  const steps: DiscoveryStep[] = [];
  const result: Discovery = { url, serverName: null, serverVersion: null, protocolVersion: null, tools: [], steps, durationMs: 0, error: null };
  try {
    await assertPublicHost(url);
    // 1. initialize: agree on a protocol version and learn what the server can do.
    const init = await rpc(url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agents-api-labs', version: '1.0.0' } } }, null, 'initialize');
    if (!init.ok) { steps.push({ method: 'initialize', status: init.status, ms: init.ms, ok: false, note: init.raw.slice(0, 200) || 'No body.' }); throw new Error(`initialize answered HTTP ${init.status}.`); }
    const hello = rpcResult(parseRpcMessages(init.raw, init.contentType), 1);
    if ('error' in hello) { steps.push({ method: 'initialize', status: init.status, ms: init.ms, ok: false, note: hello.error }); throw new Error(hello.error); }
    const info = hello.result as { protocolVersion?: unknown; serverInfo?: { name?: unknown; version?: unknown }; capabilities?: Record<string, unknown> };
    result.protocolVersion = typeof info.protocolVersion === 'string' ? info.protocolVersion : null;
    result.serverName = typeof info.serverInfo?.name === 'string' ? info.serverInfo.name : null;
    result.serverVersion = typeof info.serverInfo?.version === 'string' ? info.serverInfo.version : null;
    steps.push({ method: 'initialize', status: init.status, ms: init.ms, ok: true, note: `${result.serverName ?? 'server'} ${result.serverVersion ?? ''} · protocol ${result.protocolVersion ?? '?'} · capabilities: ${Object.keys(info.capabilities ?? {}).join(', ') || 'none'}${init.session ? ' · Mcp-Session-Id set' : ''}`.replace(/\s+·/, ' ·') });

    // 2. notifications/initialized: a notification has no id and gets no result (HTTP 202 is typical).
    const ready = await rpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.session, 'notifications/initialized');
    steps.push({ method: 'notifications/initialized', status: ready.status, ms: ready.ms, ok: ready.status < 400, note: ready.status === 202 ? 'Accepted. A notification has no response body.' : `HTTP ${ready.status}` });

    // 3. tools/list, following nextCursor for a few pages.
    let cursor: string | null = null;
    const tools: DiscoveredTool[] = [];
    for (let page = 0; page < 5; page += 1) {
      const id = 2 + page;
      const list = await rpc(url, { jsonrpc: '2.0', id, method: 'tools/list', params: cursor ? { cursor } : {} }, init.session, 'tools/list');
      const reply = list.ok ? rpcResult(parseRpcMessages(list.raw, list.contentType), id) : { error: `HTTP ${list.status}` };
      if ('error' in reply) { steps.push({ method: 'tools/list', status: list.status, ms: list.ms, ok: false, note: reply.error }); throw new Error(`tools/list: ${reply.error}`); }
      const parsed = parseToolList(reply.result);
      tools.push(...parsed.tools);
      steps.push({ method: 'tools/list', status: list.status, ms: list.ms, ok: true, note: `${parsed.tools.length} tool${parsed.tools.length === 1 ? '' : 's'}: ${parsed.tools.map((tool) => tool.name).join(', ')}${parsed.nextCursor ? ' · more pages' : ''}` });
      cursor = parsed.nextCursor;
      if (!cursor) break;
    }
    result.tools = tools;
  } catch (error) {
    result.error = error instanceof Error ? (error.name === 'TimeoutError' ? `No answer within ${probeLimitMs / 1000} s.` : error.message) : 'Discovery failed.';
  }
  result.durationMs = Math.round(performance.now() - started);
  return result;
}

// POST /api/lab22/discover — initialize and tools/list against the declared server. No OpenAI call, no API key.
export async function discoverLab22(request: IncomingMessage, response: ServerResponse) {
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const declared = buildMcpTool({ ...settingsOf(body.mcp), offered: true });
  if (!declared.tool) return sendJson(response, 400, { error: 'Fix the MCP settings first.', findings: declared.findings });
  sendJson(response, 200, await discover(declared.tool.transport.server_url));
}

// ---- The live run ----

type Trace = McpSummary & { started: number; callMap: Map<string, McpCall>; parts: Map<string, string>; commentary: Set<string>; seen: Set<string>; types: Set<string> };
const answerOf = (trace: Trace) => [...trace.parts.values()].join('\n');
const mark = (response: ServerResponse, trace: Trace, kind: Moment['kind'], label: string) => {
  const moment: Moment = { at: Date.now(), kind, label };
  trace.timeline.push(moment);
  writeEvent(response, { type: 'moment', moment });
};
const summary = (trace: Trace): McpSummary => ({
  tool: trace.tool, sessionId: trace.sessionId, turnId: trace.turnId, turnStatus: trace.turnStatus, calls: [...trace.callMap.values()], answer: answerOf(trace),
  events: trace.events, itemTypes: [...trace.types], timeline: trace.timeline, durationMs: Date.now() - trace.started, firstCallMs: trace.firstCallMs, firstTextMs: trace.firstTextMs, error: trace.error,
});

// An mcp_call arrives when the call starts (item.added, status in_progress, arguments already set) and again when it ends
// (item.done, with the output or the error). A failed connection arrives as one mcp_call named "initialize".
function seeCall(response: ServerResponse, trace: Trace, item: unknown, done: boolean) {
  const call = parseMcpCall(item);
  // Keep the output small for the browser: a fetched page can be tens of kilobytes.
  if (call.output && call.output.length > 6_000) call.output = `${call.output.slice(0, 6_000)}\n… (${call.output.length.toLocaleString('en')} characters in all)`;
  const known = trace.callMap.has(call.id);
  trace.callMap.set(call.id, call);
  writeEvent(response, { type: 'call', call });
  if (call.kind === 'connection') {
    if (done) mark(response, trace, 'connect', describeCall(call));
    return;
  }
  if (trace.firstCallMs === null) trace.firstCallMs = Date.now() - trace.started;
  if (!known) mark(response, trace, 'call', describeCall(call));
  if (done) mark(response, trace, 'result', failed(call) ? `${call.name} failed: ${call.error?.message ?? call.output?.slice(0, 120) ?? 'error'}` : `${call.name} returned ${(call.output ?? '').length.toLocaleString('en')} characters`);
}

async function follow(api: OpenAI, response: ServerResponse, trace: Trace, stream: Stream<AgentSessionEvent>) {
  for await (const event of stream) {
    if (response.destroyed) return;
    if (trace.seen.has(event.event_id)) continue;
    trace.seen.add(event.event_id);
    if (!(event.type === 'agent.session.turn.output_text.delta' && trace.events.at(-1) === event.type)) {
      trace.events.push(event.type);
      writeEvent(response, { type: 'event', name: event.type });
    }
    if (event.type === 'agent.session.created') { trace.sessionId = event.session.id; writeEvent(response, { type: 'session', sessionId: trace.sessionId }); }
    if ('turn' in event && event.turn?.subagent_id == null && !trace.turnId) trace.turnId = event.turn.id;
    // Every item type seen: it shows that discovery itself never appears in the stream.
    if (event.type === 'agent.session.turn.item.added') trace.types.add(event.item.type);

    if ((event.type === 'agent.session.turn.item.added' || event.type === 'agent.session.turn.item.done') && event.item.type === 'mcp_call') {
      seeCall(response, trace, event.item, event.type === 'agent.session.turn.item.done');
      continue;
    }
    if (event.type === 'agent.session.turn.item.added' && event.item.type === 'message' && event.item.phase === 'commentary' && event.item.id) trace.commentary.add(event.item.id);
    if ((event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') && !trace.commentary.has(event.item_id)) {
      const key = `${event.item_id}:${event.content_index}`;
      if (!trace.parts.has(key)) {
        mark(response, trace, 'answer', 'The agent starts its answer');
        if (trace.firstTextMs === null) trace.firstTextMs = Date.now() - trace.started;
      }
      trace.parts.set(key, event.type === 'agent.session.turn.output_text.delta' ? (trace.parts.get(key) ?? '') + event.delta : event.text);
      writeEvent(response, { type: 'text', text: answerOf(trace) });
      continue;
    }

    // MCP tools run on OpenAI's side, and this agent has no function tools, so a pause is unexpected: cancel it.
    if (event.type === 'agent.session.requires_action') {
      trace.error = 'The turn asked for a function result, but this lab declares no function tools. The server cancelled it.';
      await api.beta.agents.sessions.events.create(trace.sessionId ?? '', { events: [{ type: 'agent.session.input.cancel' }] });
      continue;
    }

    const terminal = event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled';
    if (terminal && event.turn.subagent_id == null && (!trace.turnId || event.turn.id === trace.turnId)) {
      trace.turnStatus = event.turn.status as TurnStatus;
      if (event.type === 'agent.session.turn.failed') trace.error = event.turn.error?.message ?? 'The turn failed.';
      const calls = [...trace.callMap.values()].filter((call) => call.kind === 'tool').length;
      mark(response, trace, 'outcome', `Turn ${event.turn.status} after ${calls} MCP call${calls === 1 ? '' : 's'}`);
      return;
    }
    if (event.type === 'error') { trace.turnStatus = 'failed'; trace.error = event.error?.message ?? 'The agent returned an error.'; return; }
    if (event.type === 'agent.session.failed') { trace.turnStatus = 'failed'; trace.error = 'The agent session failed.'; return; }
  }
  if (trace.turnStatus === 'unknown' && !trace.error) trace.error = 'The stream closed before the turn had an outcome.';
}

// POST /api/lab22/run — one question, with the MCP server declared (or left out) exactly as the page shows.
export async function runLab22(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const prompt = text(body.prompt);
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });
  const settings = settingsOf(body.mcp);
  const declared = buildMcpTool(settings);
  if (hasErrors(declared.findings)) return sendJson(response, 400, { error: 'Fix the MCP settings first.', findings: declared.findings });
  const tool: McpTool | null = declared.tool;

  const trace: Trace = {
    tool, sessionId: null, turnId: null, turnStatus: 'unknown', calls: [], answer: '', events: [], itemTypes: [], timeline: [], durationMs: null, firstCallMs: null, firstTextMs: null, error: null,
    started: Date.now(), callMap: new Map(), parts: new Map(), commentary: new Set(), seen: new Set(), types: new Set(),
  };
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = client();
  let stream: Stream<AgentSessionEvent> | undefined;
  response.on('close', () => stream?.controller.abort());
  const limit = setTimeout(() => stream?.controller.abort(), runLimitMs);
  try {
    writeEvent(response, { type: 'status', label: tool ? `Starting a session with MCP server “${tool.server_label}” (${new URL(tool.transport.server_url).host}${tool.required ? ', required' : ''})` : 'Starting a session with no tools' });
    writeEvent(response, { type: 'tool', tool });
    mark(response, trace, 'prompt', prompt);
    stream = await api.beta.agents.sessions.create({
      // The instructions are the same with and without the server, so the server is the only difference between runs.
      agent: { ...agent, instructions: docsInstructions(new Date().toISOString().slice(0, 10), tool?.server_label ?? settings.label), ...(tool ? { tools: [tool] } : {}) },
      environment: { type: 'none' },
      input: prompt,
      stream: true,
    });
    await follow(api, response, trace, stream);
  } catch (caught) {
    if (response.destroyed) return;
    trace.error = errorMessage(caught);
    if (trace.turnStatus === 'unknown') trace.turnStatus = 'failed';
  } finally {
    clearTimeout(limit);
    stream?.controller.abort();
    writeEvent(response, { type: 'summary', summary: summary(trace) });
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

// GET /api/lab22/items — the saved session: the question, each mcp_call with its arguments and result, and the answer.
export type SavedItem = { id: string | null; type: string; role: string | null; text: string | null; status: string | null; call: string | null };
export const savedItem = (item: AgentSessionItem): SavedItem => {
  const blank: SavedItem = { id: 'id' in item ? item.id ?? null : null, type: item.type, role: null, text: null, status: 'status' in item ? String(item.status) : null, call: null };
  if (item.type === 'message') return { ...blank, role: item.role, text: item.content.map((part) => ('text' in part ? part.text : '[image]')).join('\n') };
  if (item.type === 'mcp_call') {
    const call = parseMcpCall(item);
    return { ...blank, call: `${call.server} · ${describeCall(call)}`, text: call.error ? `error: ${call.error.message}` : call.output };
  }
  return blank;
};
export async function itemsLab22(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  const sessionId = text(new URL(request.url ?? '', 'http://localhost').searchParams.get('sessionId'));
  if (!sessionIdPattern.test(sessionId) || sessionId.length > 200) return sendJson(response, 400, { error: 'Invalid session ID.' });
  try {
    const page = await client().beta.agents.sessions.items.list(sessionId, { order: 'asc', limit: 100 });
    sendJson(response, 200, { items: page.data.map(savedItem), hasMore: page.hasNextPage() });
  } catch (error) {
    sendJson(response, 502, { error: errorMessage(error) });
  }
}

// POST /api/lab22/test — the same suite as the browser, on the server. No network, no API key.
export function testLab22(_request: IncomingMessage, response: ServerResponse) {
  try {
    const started = performance.now();
    const results = runMcpSuite();
    sendJson(response, 200, { results, runtime: `Node ${process.version}`, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'The suite crashed.' });
  }
}
