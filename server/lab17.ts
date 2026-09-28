import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import type { AgentSession, AgentSessionEvent, AgentSessionItem } from 'openai/resources/beta/agents/agents';
import type { Stream } from 'openai/core/streaming';
import type { ToolCall, TurnStatus } from '../src/lab16Tool.ts';
import { courseCalendarTool, executeCall, maxRounds, toolResultEvent, type Delivery, type Moment, type ResultMode, type ToolResult, type TraceItem } from '../src/lab17Action.ts';

type AgentConfig = { model: string; instructions: string };

const sessionIdPattern = /^sess_[A-Za-z0-9_-]+$/;
const runLimitMs = 120_000;

const configured = () => Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_api_key_here');
const client = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};
const writeEvent = (response: ServerResponse, event: unknown) => {
  if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(event)}\n`);
};
const startStream = (response: ServerResponse) => response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
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

const instructions = (today: string) =>
  'You are the assistant for the "OpenAI Agents API with React" course. ' +
  `Today is ${today}. Answer clearly and briefly. ` +
  'Use your tools when they can answer a question better than you can. Never invent course dates. ' +
  'If a tool reports an error, say so plainly instead of guessing.';

// Only function calls: required_actions can also hold environment reconnections.
const functionActions = (actions: AgentSession['required_actions']): ToolCall[] => actions.flatMap((action) => action.type === 'function_call'
  ? [{ callId: action.call_id, name: action.name, turnId: action.turn_id, itemId: null, status: null, arguments: action.arguments }]
  : []);

// Everything one request learns about the turn. The browser merges two of these in step-through mode.
type Trace = {
  mode: ResultMode;
  delivery: Delivery;
  sessionId: string | null;
  turnId: string | null;
  turnStatus: TurnStatus;
  rounds: number;
  calls: Map<string, ToolCall>;
  results: ToolResult[];
  pending: ToolCall[];
  answered: Set<string>;
  events: string[];
  timeline: Moment[];
  parts: Map<string, string>;
  commentary: Set<string>;
  seen: Set<string>;
  error: string | null;
};
const newTrace = (mode: ResultMode, delivery: Delivery): Trace => ({
  mode, delivery, sessionId: null, turnId: null, turnStatus: 'unknown', rounds: 0, calls: new Map(), results: [], pending: [],
  answered: new Set(), events: [], timeline: [], parts: new Map(), commentary: new Set(), seen: new Set(), error: null,
});
const answerOf = (trace: Trace) => [...trace.parts.values()].join('\n');
const mark = (response: ServerResponse, trace: Trace, kind: Moment['kind'], label: string) => {
  const moment: Moment = { at: Date.now(), kind, label };
  trace.timeline.push(moment);
  writeEvent(response, { type: 'moment', moment });
};
const see = (response: ServerResponse, trace: Trace, call: ToolCall) => {
  trace.calls.set(call.callId, call);
  writeEvent(response, { type: 'call', call });
  mark(response, trace, 'call', `${call.name}(${JSON.stringify(call.arguments)})`);
};
const summary = (trace: Trace) => ({
  mode: trace.mode, delivery: trace.delivery, sessionId: trace.sessionId, turnId: trace.turnId, turnStatus: trace.turnStatus, rounds: trace.rounds,
  calls: [...trace.calls.values()], results: trace.results, pending: trace.pending, answer: answerOf(trace), events: trace.events, timeline: trace.timeline, error: trace.error,
});

// Run every waiting call on this server, then send all the results in one events.create request.
async function answer(api: OpenAI, response: ServerResponse, trace: Trace, waiting: ToolCall[]) {
  if (!trace.sessionId) throw new Error('No session to answer.');
  trace.rounds += 1;
  const results: ToolResult[] = waiting.map((call) => {
    const started = performance.now();
    const outcome = executeCall(call, courseCalendarTool, trace.mode);
    return { callId: call.callId, turnId: call.turnId ?? trace.turnId ?? '', name: call.name, ...outcome, durationMs: Math.round((performance.now() - started) * 100) / 100, round: trace.rounds };
  });
  for (const result of results) writeEvent(response, { type: 'result', result });
  await api.beta.agents.sessions.events.create(trace.sessionId, { events: results.map(toolResultEvent) });
  for (const result of results) {
    trace.results.push(result);
    trace.answered.add(result.callId);
    mark(response, trace, 'result', `${result.name} → ${result.success ? 'success' : 'error'} (${result.callId})`);
  }
  trace.pending = [];
  writeEvent(response, { type: 'status', label: `Sent ${results.length} tool result${results.length === 1 ? '' : 's'}. The turn resumes.` });
}

// Read one stream until the turn ends, or until it waits and this request should not answer.
async function follow(api: OpenAI, response: ServerResponse, trace: Trace, stream: Stream<AgentSessionEvent>) {
  for await (const event of stream) {
    if (response.destroyed) return;
    // A reattached stream can deliver an event again; skip an event ID that was already handled.
    if (trace.seen.has(event.event_id)) continue;
    trace.seen.add(event.event_id);
    if (!(event.type === 'agent.session.turn.output_text.delta' && trace.events.at(-1) === event.type)) {
      trace.events.push(event.type);
      writeEvent(response, { type: 'event', name: event.type });
    }
    if (event.type === 'agent.session.created') { trace.sessionId = event.session.id; writeEvent(response, { type: 'session', sessionId: trace.sessionId }); }
    if ('turn' in event && event.turn?.subagent_id == null && !trace.turnId) trace.turnId = event.turn.id;

    // The function_call item can arrive before or after requires_action. Record the call the first time it is seen.
    if ((event.type === 'agent.session.turn.item.added' || event.type === 'agent.session.turn.item.done') && event.item.type === 'function_call') {
      const item = event.item;
      const known = trace.calls.get(item.call_id);
      if (known) trace.calls.set(item.call_id, { ...known, itemId: item.id, status: item.status });
      else see(response, trace, { callId: item.call_id, name: item.name, turnId: item.turn_id, itemId: item.id, status: item.status, arguments: item.arguments });
    }
    if (event.type === 'agent.session.turn.item.added' && event.item.type === 'message' && event.item.phase === 'commentary' && event.item.id) trace.commentary.add(event.item.id);
    if ((event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') && !trace.commentary.has(event.item_id)) {
      const key = `${event.item_id}:${event.content_index}`;
      if (!trace.parts.has(key)) mark(response, trace, 'answer', 'The agent starts its answer');
      trace.parts.set(key, event.type === 'agent.session.turn.output_text.delta' ? (trace.parts.get(key) ?? '') + event.delta : event.text);
      writeEvent(response, { type: 'text', text: answerOf(trace) });
      continue;
    }

    // The pause. Answer only the calls that have no result yet.
    if (event.type === 'agent.session.requires_action') {
      const waiting = functionActions(event.session.required_actions).filter((call) => !trace.answered.has(call.callId));
      if (!waiting.length) continue;
      for (const call of waiting) if (!trace.calls.has(call.callId)) see(response, trace, call);
      trace.turnStatus = 'waiting';
      mark(response, trace, 'waiting', `Session requires_action: ${waiting.length} call${waiting.length === 1 ? '' : 's'} waiting`);
      if (trace.delivery === 'step') {
        trace.pending = waiting;
        writeEvent(response, { type: 'pending', calls: waiting });
        return;
      }
      if (trace.rounds >= maxRounds) {
        trace.error = `The turn paused for tools ${maxRounds} times. The server stopped answering and cancelled it.`;
        await api.beta.agents.sessions.events.create(trace.sessionId ?? '', { events: [{ type: 'agent.session.input.cancel' }] });
        continue;
      }
      await answer(api, response, trace, waiting);
      trace.turnStatus = 'unknown';
      continue;
    }

    const terminal = event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled';
    if (terminal && event.turn.subagent_id == null && (!trace.turnId || event.turn.id === trace.turnId)) {
      trace.turnStatus = event.turn.status as TurnStatus;
      if (event.type === 'agent.session.turn.failed') trace.error = event.turn.error?.message ?? 'The turn failed.';
      mark(response, trace, 'outcome', `Turn ${event.turn.status}`);
      return;
    }
    if (event.type === 'error') { trace.turnStatus = 'failed'; trace.error = event.error?.message ?? 'The agent returned an error.'; return; }
    if (event.type === 'agent.session.failed') { trace.turnStatus = 'failed'; trace.error = 'The agent session failed.'; return; }
  }
  if (trace.turnStatus === 'unknown' && !trace.error) trace.error = 'The stream closed before the turn had an outcome.';
}

const readMode = (value: unknown): ResultMode => (value === 'fail' ? 'fail' : 'execute');

// POST /api/lab17/run — ask a question, run each requested function on the server, send the results, and read the answer.
export async function runLab17(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const prompt = text(body.prompt);
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });
  const trace = newTrace(readMode(body.mode), body.delivery === 'step' ? 'step' : 'auto');

  startStream(response);
  const api = client();
  let stream: Stream<AgentSessionEvent> | undefined;
  response.on('close', () => stream?.controller.abort());
  const limit = setTimeout(() => stream?.controller.abort(), runLimitMs);
  try {
    writeEvent(response, { type: 'status', label: `Starting a session with ${courseCalendarTool.name}` });
    mark(response, trace, 'prompt', prompt);
    stream = await api.beta.agents.sessions.create({
      // The server declares the tool itself: it only offers functions it can run.
      agent: { ...agent, instructions: instructions(new Date().toISOString().slice(0, 10)), tools: [courseCalendarTool] },
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

// POST /api/lab17/resolve — step-through mode. Read the waiting calls from the saved session (not from the browser),
// run them, send the results, and follow the same turn to its end.
export async function resolveLab17(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const sessionId = text(body.sessionId);
  if (!sessionIdPattern.test(sessionId) || sessionId.length > 200) return sendJson(response, 400, { error: 'Invalid session ID.' });
  const trace = newTrace(readMode(body.mode), 'step');
  trace.sessionId = sessionId;

  startStream(response);
  const api = client();
  let stream: Stream<AgentSessionEvent> | undefined;
  response.on('close', () => stream?.controller.abort());
  const limit = setTimeout(() => stream?.controller.abort(), runLimitMs);
  try {
    // Open the stream first, then read the session, so nothing that happens between the two is missed.
    stream = await api.beta.agents.sessions.events.stream(sessionId);
    const session = await api.beta.agents.sessions.retrieve(sessionId);
    const waiting = functionActions(session.required_actions);
    if (session.status !== 'requires_action' || !waiting.length) {
      trace.error = `Nothing is waiting: the session is ${session.status}.`;
      return;
    }
    trace.turnId = waiting[0].turnId;
    for (const call of waiting) trace.calls.set(call.callId, call);
    await answer(api, response, trace, waiting);
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

// GET /api/lab17/items — the saved trace: user message, function_call, function_call_output, assistant message. Sends nothing.
const traceItem = (item: AgentSessionItem): TraceItem => {
  const blank: TraceItem = { id: 'id' in item ? item.id ?? null : null, type: item.type, turnId: 'turn_id' in item ? item.turn_id ?? null : null, role: null, text: null, name: null, callId: null, arguments: undefined, output: undefined, error: null, status: 'status' in item ? String(item.status) : null };
  if (item.type === 'message') return { ...blank, role: item.role, text: item.content.map((part) => ('text' in part ? part.text : '[image]')).join('\n') };
  if (item.type === 'function_call') return { ...blank, name: item.name, callId: item.call_id, arguments: item.arguments };
  if (item.type === 'function_call_output') return { ...blank, callId: item.call_id, output: item.output, error: item.error };
  return blank;
};
export async function itemsLab17(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  const sessionId = text(new URL(request.url ?? '', 'http://localhost').searchParams.get('sessionId'));
  if (!sessionIdPattern.test(sessionId) || sessionId.length > 200) return sendJson(response, 400, { error: 'Invalid session ID.' });
  try {
    const page = await client().beta.agents.sessions.items.list(sessionId, { order: 'asc', limit: 100 });
    sendJson(response, 200, { items: page.data.map(traceItem), hasMore: page.hasNextPage() });
  } catch (error) {
    sendJson(response, 502, { error: errorMessage(error) });
  }
}
