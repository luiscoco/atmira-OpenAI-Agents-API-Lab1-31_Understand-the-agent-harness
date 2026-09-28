import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import type { AgentSessionEvent, AgentSessionItem } from 'openai/resources/beta/agents/agents';
import type { Stream } from 'openai/core/streaming';
import type { TurnStatus } from '../src/lab16Tool.ts';
import {
  buildSearchTool, contextSizes, describeAction, emptyLocation, hasErrors, informative, parseAnnotations, parseSearchAction, searchInstructions, searchModes,
  type Moment, type SearchCall, type SearchSettings, type SearchSummary, type UrlAnnotation, type WebSearchTool,
} from '../src/lab21Search.ts';
import { runSearchSuite } from '../src/lab21Tests.ts';

type AgentConfig = { model: string; instructions: string };

// Searching and reading pages takes longer than a plain answer.
const runLimitMs = 180_000;
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
function settingsOf(value: unknown): SearchSettings {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const location = typeof raw.location === 'object' && raw.location !== null ? raw.location as Record<string, unknown> : {};
  const field = (input: unknown, max: number) => (typeof input === 'string' ? input.slice(0, max) : '');
  return {
    offered: raw.offered !== false,
    mode: searchModes.find((item) => item.id === raw.mode)?.id ?? 'live',
    contextSize: contextSizes.find((item) => item.id === raw.contextSize)?.id ?? 'medium',
    domains: field(raw.domains, 6_000),
    location: { ...emptyLocation, country: field(location.country, 10), region: field(location.region, 120), city: field(location.city, 120), timezone: field(location.timezone, 64) },
  };
}

type Trace = SearchSummary & { started: number; searchMap: Map<string, SearchCall>; parts: Map<string, string>; commentary: Set<string>; seen: Set<string>; marked: Set<string> };
const answerOf = (trace: Trace) => [...trace.parts.values()].join('\n');
const mark = (response: ServerResponse, trace: Trace, kind: Moment['kind'], label: string) => {
  const moment: Moment = { at: Date.now(), kind, label };
  trace.timeline.push(moment);
  writeEvent(response, { type: 'moment', moment });
};
const summary = (trace: Trace): SearchSummary => ({
  tool: trace.tool, sessionId: trace.sessionId, turnId: trace.turnId, turnStatus: trace.turnStatus, searches: [...trace.searchMap.values()], answer: answerOf(trace),
  annotations: trace.annotations, events: trace.events, timeline: trace.timeline, durationMs: Date.now() - trace.started, firstSearchMs: trace.firstSearchMs, firstTextMs: trace.firstTextMs, error: trace.error,
});

// A web_search_call item arrives when the search starts (item.added) and again with its action when it is done (item.done).
// item.added often carries an empty action ({ type: 'search', queries: [] }), so the timeline waits for one with content.
function seeSearch(response: ServerResponse, trace: Trace, item: { id: string; status: string; turn_id: string; action: unknown }, done: boolean) {
  const known = trace.searchMap.get(item.id);
  const action = parseSearchAction(item.action);
  const call: SearchCall = { id: item.id, status: item.status, turnId: item.turn_id, action: informative(action) || !known?.action ? action : known.action };
  trace.searchMap.set(item.id, call);
  writeEvent(response, { type: 'search', call });
  if (trace.firstSearchMs === null) trace.firstSearchMs = Date.now() - trace.started;
  if (!trace.marked.has(item.id) && (informative(call.action) || done)) {
    trace.marked.add(item.id);
    mark(response, trace, call.action?.type === 'open_page' || call.action?.type === 'find_in_page' ? 'open' : 'search', describeAction(call.action));
  }
}

// Annotations are not in the typed OutputText, but read them if a part ever carries url_citation entries.
function readAnnotations(trace: Trace, part: unknown, offset: number) {
  const found = parseAnnotations((part as { annotations?: unknown } | null)?.annotations);
  const shifted: UrlAnnotation[] = found.map((note) => ({ ...note, start: note.start === null ? null : note.start + offset, end: note.end === null ? null : note.end + offset }));
  trace.annotations.push(...shifted);
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

    if ((event.type === 'agent.session.turn.item.added' || event.type === 'agent.session.turn.item.done') && event.item.type === 'web_search_call') {
      seeSearch(response, trace, event.item, event.type === 'agent.session.turn.item.done');
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
    if (event.type === 'agent.session.turn.content_part.done' && !trace.commentary.has(event.item_id)) {
      const key = `${event.item_id}:${event.content_index}`;
      const before = [...trace.parts.keys()].indexOf(key);
      const offset = [...trace.parts.values()].slice(0, before < 0 ? trace.parts.size : before).reduce((total, part) => total + part.length + 1, 0);
      readAnnotations(trace, event.part, offset);
      continue;
    }

    // This agent has no function tools, so a pause is unexpected: cancel rather than leave the turn waiting.
    if (event.type === 'agent.session.requires_action') {
      trace.error = 'The turn asked for a function result, but this lab declares no function tools. The server cancelled it.';
      await api.beta.agents.sessions.events.create(trace.sessionId ?? '', { events: [{ type: 'agent.session.input.cancel' }] });
      continue;
    }

    const terminal = event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled';
    if (terminal && event.turn.subagent_id == null && (!trace.turnId || event.turn.id === trace.turnId)) {
      trace.turnStatus = event.turn.status as TurnStatus;
      if (event.type === 'agent.session.turn.failed') trace.error = event.turn.error?.message ?? 'The turn failed.';
      mark(response, trace, 'outcome', `Turn ${event.turn.status} after ${trace.searchMap.size} search${trace.searchMap.size === 1 ? '' : 'es'}`);
      return;
    }
    if (event.type === 'error') { trace.turnStatus = 'failed'; trace.error = event.error?.message ?? 'The agent returned an error.'; return; }
    if (event.type === 'agent.session.failed') { trace.turnStatus = 'failed'; trace.error = 'The agent session failed.'; return; }
  }
  if (trace.turnStatus === 'unknown' && !trace.error) trace.error = 'The stream closed before the turn had an outcome.';
}

// POST /api/lab21/run — one question, with web_search declared (or left out) exactly as the page shows.
export async function runLab21(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const prompt = text(body.prompt);
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });
  const declared = buildSearchTool(settingsOf(body.search));
  if (hasErrors(declared.findings)) return sendJson(response, 400, { error: 'Fix the web search settings first.', findings: declared.findings });
  const tool: WebSearchTool | null = declared.tool;

  const trace: Trace = {
    tool, sessionId: null, turnId: null, turnStatus: 'unknown', searches: [], answer: '', annotations: [], events: [], timeline: [], durationMs: null, firstSearchMs: null, firstTextMs: null, error: null,
    started: Date.now(), searchMap: new Map(), parts: new Map(), commentary: new Set(), seen: new Set(), marked: new Set(),
  };
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = client();
  let stream: Stream<AgentSessionEvent> | undefined;
  response.on('close', () => stream?.controller.abort());
  const limit = setTimeout(() => stream?.controller.abort(), runLimitMs);
  try {
    writeEvent(response, { type: 'status', label: tool ? `Starting a session with web_search (mode ${tool.mode}${tool.allowed_domains ? `, ${tool.allowed_domains.length} allowed domain${tool.allowed_domains.length === 1 ? '' : 's'}` : ''})` : 'Starting a session with no tools' });
    writeEvent(response, { type: 'tool', tool });
    mark(response, trace, 'prompt', prompt);
    stream = await api.beta.agents.sessions.create({
      // The instructions are the same with and without the tool, so the tool is the only difference between runs.
      agent: { ...agent, instructions: searchInstructions(new Date().toISOString().slice(0, 10)), ...(tool ? { tools: [tool] } : {}) },
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

// GET /api/lab21/items — the saved session: the question, each web_search_call with its action, and the answer. Sends nothing.
export type SavedItem = { id: string | null; type: string; role: string | null; text: string | null; status: string | null; search: string | null };
const savedItem = (item: AgentSessionItem): SavedItem => {
  const blank: SavedItem = { id: 'id' in item ? item.id ?? null : null, type: item.type, role: null, text: null, status: 'status' in item ? String(item.status) : null, search: null };
  if (item.type === 'message') return { ...blank, role: item.role, text: item.content.map((part) => ('text' in part ? part.text : '[image]')).join('\n') };
  if (item.type === 'web_search_call') return { ...blank, search: describeAction(parseSearchAction(item.action)) };
  return blank;
};
export async function itemsLab21(request: IncomingMessage, response: ServerResponse) {
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

// POST /api/lab21/test — the same suite as the browser, on the server. No network, no API key.
export function testLab21(_request: IncomingMessage, response: ServerResponse) {
  try {
    const started = performance.now();
    const results = runSearchSuite();
    sendJson(response, 200, { results, runtime: `Node ${process.version}`, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'The suite crashed.' });
  }
}
