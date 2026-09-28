import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import type { AgentSession, AgentSessionEvent } from 'openai/resources/beta/agents/agents';
import type { Stream } from 'openai/core/streaming';
import type { ToolCall, TurnStatus } from '../src/lab16Tool.ts';
import { maxRounds } from '../src/lab17Action.ts';
import { callSignature, faults, liveTiming, looseCalendarTool, runTool, strictCalendarTool, toolResultEvent, type CheckedResult, type Declaration, type Fault, type Moment } from '../src/lab18Validate.ts';
import { runSuite } from '../src/lab18Tests.ts';

type AgentConfig = { model: string; instructions: string };

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
  'If a tool rejects your arguments, read the error, correct the arguments, and call it again. ' +
  'If a tool says not to retry, or fails twice, tell the user plainly instead of guessing.';

const functionActions = (actions: AgentSession['required_actions']): ToolCall[] => actions.flatMap((action) => action.type === 'function_call'
  ? [{ callId: action.call_id, name: action.name, turnId: action.turn_id, itemId: null, status: null, arguments: action.arguments }]
  : []);

type Trace = {
  fault: Fault;
  declaration: Declaration;
  sessionId: string | null;
  turnId: string | null;
  turnStatus: TurnStatus;
  rounds: number;
  attempts: number; // calls that passed validation and reached the service
  calls: Map<string, ToolCall>;
  results: CheckedResult[];
  answered: Set<string>;
  rejected: Set<string>; // signatures of calls that failed validation
  events: string[];
  timeline: Moment[];
  parts: Map<string, string>;
  commentary: Set<string>;
  seen: Set<string>;
  error: string | null;
};
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
  fault: trace.fault, declaration: trace.declaration, sessionId: trace.sessionId, turnId: trace.turnId, turnStatus: trace.turnStatus, rounds: trace.rounds,
  calls: [...trace.calls.values()], results: trace.results, answer: answerOf(trace), events: trace.events, timeline: trace.timeline, error: trace.error,
});

// Validate and run every waiting call, then send all the results in one events.create request.
// Calls run one after another so "fails once" means the first attempt in the turn.
async function answer(api: OpenAI, response: ServerResponse, trace: Trace, waiting: ToolCall[]) {
  if (!trace.sessionId) throw new Error('No session to answer.');
  trace.rounds += 1;
  const results: CheckedResult[] = [];
  for (const call of waiting) {
    const signature = callSignature(call);
    const outcome = await runTool(call, { fault: trace.fault, attempt: trace.attempts + 1, timing: liveTiming, repeated: trace.rejected.has(signature) });
    if (outcome.stage !== 'name' && outcome.stage !== 'parse' && outcome.stage !== 'schema' && outcome.stage !== 'meaning') trace.attempts += 1;
    else trace.rejected.add(signature);
    // The internal detail is logged here, on the server. Only outcome.error goes to the agent.
    if (outcome.internal) console.warn(`[lab18] ${call.callId} ${outcome.internal}`);
    const result: CheckedResult = { ...outcome, callId: call.callId, turnId: call.turnId ?? trace.turnId ?? '', name: call.name, round: trace.rounds, attempt: trace.attempts };
    results.push(result);
    writeEvent(response, { type: 'result', result });
    mark(response, trace, result.success ? 'result' : 'reject', `${result.name} → ${result.success ? 'success' : `${result.stage} error`} in ${result.durationMs} ms (${result.callId})`);
  }
  await api.beta.agents.sessions.events.create(trace.sessionId, { events: results.map(toolResultEvent) });
  for (const result of results) { trace.results.push(result); trace.answered.add(result.callId); }
  writeEvent(response, { type: 'status', label: `Sent ${results.length} tool result${results.length === 1 ? '' : 's'}. The turn resumes.` });
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

    if (event.type === 'agent.session.requires_action') {
      const waiting = functionActions(event.session.required_actions).filter((call) => !trace.answered.has(call.callId));
      if (!waiting.length) continue;
      for (const call of waiting) if (!trace.calls.has(call.callId)) see(response, trace, call);
      if (trace.rounds >= maxRounds) {
        trace.error = `The turn paused for tools ${maxRounds} times. The server stopped answering and cancelled it.`;
        await api.beta.agents.sessions.events.create(trace.sessionId ?? '', { events: [{ type: 'agent.session.input.cancel' }] });
        continue;
      }
      await answer(api, response, trace, waiting);
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

// POST /api/lab18/run — ask a question; validate and run every call on the server, with a deadline and a fault you choose.
export async function runLab18(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const prompt = text(body.prompt);
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });
  const fault: Fault = faults.some((item) => item.id === body.fault) ? body.fault as Fault : 'none';
  const declaration: Declaration = body.declaration === 'loose' ? 'loose' : 'strict';
  const trace: Trace = {
    fault, declaration, sessionId: null, turnId: null, turnStatus: 'unknown', rounds: 0, attempts: 0, calls: new Map(), results: [], answered: new Set(),
    rejected: new Set(), events: [], timeline: [], parts: new Map(), commentary: new Set(), seen: new Set(), error: null,
  };

  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = client();
  let stream: Stream<AgentSessionEvent> | undefined;
  response.on('close', () => stream?.controller.abort());
  const limit = setTimeout(() => stream?.controller.abort(), runLimitMs);
  try {
    writeEvent(response, { type: 'status', label: `Starting a session with the ${declaration} declaration` });
    mark(response, trace, 'prompt', prompt);
    stream = await api.beta.agents.sessions.create({
      // The declaration only guides the model. The server always validates against the strict schema.
      agent: { ...agent, instructions: instructions(new Date().toISOString().slice(0, 10)), tools: [declaration === 'loose' ? looseCalendarTool : strictCalendarTool] },
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

// POST /api/lab18/test — run the whole tool test suite on the server. No API key needed: nothing is sent to OpenAI.
export async function testLab18(_request: IncomingMessage, response: ServerResponse) {
  try {
    const started = performance.now();
    const results = await runSuite();
    sendJson(response, 200, { results, runtime: `Node ${process.version}`, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'The suite crashed.' });
  }
}
