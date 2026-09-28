import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import type { AgentSession, AgentSessionEvent } from 'openai/resources/beta/agents/agents';
import type { Stream } from 'openai/core/streaming';
import type { ToolCall, TurnStatus } from '../src/lab16Tool.ts';
import { maxRounds } from '../src/lab17Action.ts';
import {
  createEngine, decide, expiryChoices, plannerTools, propose, settle, simulateEdit, todayIso, toolPolicy, toolResultEvent,
  type Approval, type ApprovalMode, type Batch, type Engine, type Moment, type ToolResult,
} from '../src/lab20Approval.ts';
import { runRuleSuite } from '../src/lab20Tests.ts';

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

// ---- Server state. In production this is a database; here it lives in memory and resets with the server. ----

let engine: Engine = createEngine(todayIso());
// Per session: the approval policy chosen at the start, and how many times the turn has paused.
// `answered` remembers every call already answered, because a resumed stream replays the turn's earlier events.
const sessions = new Map<string, { mode: ApprovalMode; expiryMs: number; rounds: number; answered: Set<string> }>();
// Per session: the pause being answered. Every call in it needs a result before any are sent.
const batches = new Map<string, Batch>();

const instructions = (today: string) =>
  'You manage the student\'s study planner for the "OpenAI Agents API with React" course. ' +
  `Today is ${today}. Answer clearly and briefly. ` +
  'Call list_study_events to find events and their IDs before proposing a change. ' +
  'Changes (reschedule_study_event, cancel_study_event) wait for the student to approve them in the app. Propose one change per call, with a one-sentence reason. ' +
  'Never say a change was made unless its tool result says "status": "done". ' +
  'If the student rejects a change, do not propose it again; say it was not made and ask what they would prefer. ' +
  'If a tool says the change is invalid, the approval expired, or the event changed, explain that plainly.';

const functionActions = (actions: AgentSession['required_actions']): ToolCall[] => actions.flatMap((action) => action.type === 'function_call'
  ? [{ callId: action.call_id, name: action.name, turnId: action.turn_id, itemId: null, status: null, arguments: action.arguments }]
  : []);

// Everything one request learns. A run that waits for approval spans several requests; the browser joins them.
type Trace = {
  config: { mode: ApprovalMode; expiryMs: number } | null; // set by /run, registered when the session ID arrives
  sessionId: string | null;
  turnId: string | null;
  turnStatus: TurnStatus;
  calls: Map<string, ToolCall>;
  results: ToolResult[];
  approvals: Approval[];
  answered: Set<string>;
  events: string[];
  timeline: Moment[];
  parts: Map<string, string>;
  commentary: Set<string>;
  seen: Set<string>;
  error: string | null;
};
const newTrace = (config: Trace['config'] = null): Trace => ({
  config, sessionId: null, turnId: null, turnStatus: 'unknown', calls: new Map(), results: [], approvals: [], answered: new Set(),
  events: [], timeline: [], parts: new Map(), commentary: new Set(), seen: new Set(), error: null,
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
  mark(response, trace, 'call', `${call.name}(${JSON.stringify(call.arguments)}) · ${toolPolicy[call.name]?.access ?? 'unknown'}`);
};
const summary = (trace: Trace) => ({
  sessionId: trace.sessionId, turnId: trace.turnId, turnStatus: trace.turnStatus, calls: [...trace.calls.values()], results: trace.results,
  approvals: trace.approvals, answer: answerOf(trace), events: trace.events, timeline: trace.timeline, error: trace.error,
});
const resultLabel = (result: ToolResult) => `${result.name} → ${result.success ? (result.output?.includes('"status":"done"') ? 'done' : 'success') : 'error'}`;

async function send(api: OpenAI, response: ServerResponse, trace: Trace, sessionId: string, results: ToolResult[]) {
  await api.beta.agents.sessions.events.create(sessionId, { events: results.map(toolResultEvent) });
  for (const result of results) { trace.answered.add(result.callId); sessions.get(sessionId)?.answered.add(result.callId); }
  writeEvent(response, { type: 'status', label: `Sent ${results.length} tool result${results.length === 1 ? '' : 's'}. The turn resumes.` });
}

// The pause. Reads run now. Writes are checked; valid ones wait for the student. Returns true when the turn must wait.
async function handlePause(api: OpenAI, response: ServerResponse, trace: Trace, waiting: ToolCall[]): Promise<boolean> {
  const sessionId = trace.sessionId ?? '';
  // Unknown session: fail safe and ask.
  const config = sessions.get(sessionId) ?? { mode: 'ask' as const, expiryMs: expiryChoices.normal, rounds: 0, answered: new Set<string>() };
  sessions.set(sessionId, config);
  if (config.rounds >= maxRounds) {
    trace.error = `The turn paused for tools ${maxRounds} times. The server stopped answering and cancelled it.`;
    await api.beta.agents.sessions.events.create(sessionId, { events: [{ type: 'agent.session.input.cancel' }] });
    return false;
  }
  config.rounds += 1;
  const batch: Batch = { turnId: waiting[0].turnId ?? trace.turnId ?? '', results: [], waitingFor: new Set() };
  for (const call of waiting) {
    const proposal = await propose(engine, call, { sessionId, turnId: batch.turnId, mode: config.mode, now: Date.now(), expiryMs: config.expiryMs, today: todayIso() });
    writeEvent(response, { type: 'audit', entry: proposal.audit });
    if (proposal.kind === 'asked') {
      batch.waitingFor.add(call.callId);
      trace.approvals.push(proposal.approval);
      writeEvent(response, { type: 'approval', approval: proposal.approval });
      mark(response, trace, 'waiting', `Approval needed: ${proposal.approval.preview.summary}`);
    } else {
      batch.results.push(proposal.result);
      trace.results.push(proposal.result);
      writeEvent(response, { type: 'result', result: proposal.result });
      mark(response, trace, 'result', `${resultLabel(proposal.result)}${proposal.kind === 'auto' ? ' · auto-approved by policy' : proposal.kind === 'invalid' ? ' · refused before asking' : ''}`);
    }
  }
  if (batch.waitingFor.size) {
    // Keep the ready results until every approval in this pause is decided, then send them together.
    batches.set(sessionId, batch);
    trace.turnStatus = 'waiting';
    writeEvent(response, { type: 'status', label: `Waiting for your decision on ${batch.waitingFor.size} change${batch.waitingFor.size === 1 ? '' : 's'}. The turn stays paused.` });
    return true;
  }
  await send(api, response, trace, sessionId, batch.results);
  return false;
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
    if (event.type === 'agent.session.created') {
      trace.sessionId = event.session.id;
      if (trace.config && !sessions.has(trace.sessionId)) sessions.set(trace.sessionId, { ...trace.config, rounds: 0, answered: new Set() });
      writeEvent(response, { type: 'session', sessionId: trace.sessionId });
    }
    if ('turn' in event && event.turn?.subagent_id == null && !trace.turnId) trace.turnId = event.turn.id;

    if ((event.type === 'agent.session.turn.item.added' || event.type === 'agent.session.turn.item.done') && event.item.type === 'function_call') {
      const item = event.item;
      const known = trace.calls.get(item.call_id);
      if (known) trace.calls.set(item.call_id, { ...known, itemId: item.id, status: item.status });
      else if (!trace.answered.has(item.call_id)) see(response, trace, { callId: item.call_id, name: item.name, turnId: item.turn_id, itemId: item.id, status: item.status, arguments: item.arguments });
    }
    if (event.type === 'agent.session.turn.item.added' && event.item.type === 'message' && event.item.phase === 'commentary' && event.item.id) trace.commentary.add(event.item.id);
    if ((event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') && !trace.commentary.has(event.item_id)) {
      const key = `${event.item_id}:${event.content_index}`;
      if (!trace.parts.has(key)) mark(response, trace, 'answer', 'The agent writes');
      trace.parts.set(key, event.type === 'agent.session.turn.output_text.delta' ? (trace.parts.get(key) ?? '') + event.delta : event.text);
      writeEvent(response, { type: 'text', text: answerOf(trace) });
      continue;
    }

    if (event.type === 'agent.session.requires_action') {
      const waiting = functionActions(event.session.required_actions).filter((call) => !trace.answered.has(call.callId) && !batches.get(trace.sessionId ?? '')?.waitingFor.has(call.callId));
      if (!waiting.length) continue;
      for (const call of waiting) if (!trace.calls.has(call.callId)) see(response, trace, call);
      if (await handlePause(api, response, trace, waiting)) return; // the stream ends here; the turn waits on the server
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

async function streamed(response: ServerResponse, trace: Trace, work: (api: OpenAI, hold: (stream: Stream<AgentSessionEvent>) => void) => Promise<void>) {
  startStream(response);
  const api = client();
  let stream: Stream<AgentSessionEvent> | undefined;
  response.on('close', () => stream?.controller.abort());
  const limit = setTimeout(() => stream?.controller.abort(), runLimitMs);
  try {
    await work(api, (opened) => { stream = opened; });
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

// POST /api/lab20/run — ask for something. Reads run; the stream stops at the first change that needs approval.
export async function runLab20(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const prompt = text(body.prompt);
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });
  const mode: ApprovalMode = body.mode === 'auto' ? 'auto' : 'ask';
  const expiryMs = body.expiry === 'short' ? expiryChoices.short : expiryChoices.normal;
  const trace = newTrace({ mode, expiryMs });
  await streamed(response, trace, async (api, hold) => {
    writeEvent(response, { type: 'status', label: mode === 'ask' ? 'Starting a session. Changes will wait for your approval.' : 'Starting a session with auto-approval (unsafe, for comparison).' });
    mark(response, trace, 'prompt', prompt);
    const stream = await api.beta.agents.sessions.create({
      agent: { ...agent, instructions: instructions(todayIso()), tools: plannerTools },
      environment: { type: 'none' },
      input: prompt,
      stream: true,
    });
    hold(stream);
    await follow(api, response, trace, stream);
  });
}

// POST /api/lab20/decide — the student's decision. The server checks it, records it, runs or refuses the stored change,
// and resumes the same turn once every change in the pause is decided.
export async function decideLab20(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const sessionId = text(body.sessionId), callId = text(body.callId), digest = text(body.digest);
  if (!sessionIdPattern.test(sessionId) || sessionId.length > 200 || !callId || callId.length > 200 || !/^[0-9a-f]{64}$/.test(digest)) return sendJson(response, 400, { error: 'Send a session ID, a call ID, and the 64-character digest of the change you reviewed.' });
  if (body.decision !== 'approve' && body.decision !== 'reject') return sendJson(response, 400, { error: 'decision must be "approve" or "reject".' });
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 300) : undefined;

  const decided = await decide(engine, { sessionId, callId, digest, decision: body.decision, reason }, Date.now());
  if (decided.kind === 'unknown' || decided.kind === 'already_decided' || decided.kind === 'tampered') {
    return sendJson(response, decided.kind === 'unknown' ? 404 : 409, { error: decided.message, kind: decided.kind, entry: decided.audit });
  }
  const done = decided as Extract<typeof decided, { approval: Approval }>;
  const trace = newTrace();
  trace.sessionId = sessionId;
  for (const id of sessions.get(sessionId)?.answered ?? []) trace.answered.add(id);
  trace.turnId = done.approval.turnId;
  trace.approvals.push(done.approval);
  trace.results.push(done.result);
  await streamed(response, trace, async (api, hold) => {
    writeEvent(response, { type: 'audit', entry: done.audit });
    mark(response, trace, 'decision', `${done.approval.status} by you → ${done.kind}${done.approval.reason ? ` (“${done.approval.reason}”)` : ''}`);
    writeEvent(response, { type: 'result', result: done.result });
    mark(response, trace, 'result', resultLabel(done.result));
    const batch = batches.get(sessionId);
    if (!batch) { trace.error = 'The server no longer holds this pause (it may have restarted). The decision was recorded, but the turn cannot resume.'; return; }
    const ready = settle(batch, done.result);
    if (!ready) {
      trace.turnStatus = 'waiting';
      writeEvent(response, { type: 'status', label: `Recorded. ${batch.waitingFor.size} more change${batch.waitingFor.size === 1 ? '' : 's'} in this pause still need a decision.` });
      return;
    }
    batches.delete(sessionId);
    // Open the stream first, then send, so the first events of the resumed turn are not missed.
    const stream = await api.beta.agents.sessions.events.stream(sessionId);
    hold(stream);
    await send(api, response, trace, sessionId, ready);
    await follow(api, response, trace, stream);
  });
}

// GET /api/lab20/state — the planner, the approvals still pending, and the audit log (newest first). Sends nothing to OpenAI.
export function stateLab20(_request: IncomingMessage, response: ServerResponse) {
  sendJson(response, 200, {
    planner: engine.planner,
    pending: [...engine.approvals.values()].filter((item) => item.status === 'pending'),
    audit: [...engine.audit].reverse().slice(0, 100),
    now: Date.now(),
  });
}

// POST /api/lab20/edit — someone else moves an event, as another app or tab might. Used to show a stale approval.
export async function editLab20(request: IncomingMessage, response: ServerResponse) {
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const event = simulateEdit(engine, text(body.eventId), 'planner', Date.now());
  if (!event) return sendJson(response, 404, { error: 'No scheduled event with that ID.' });
  sendJson(response, 200, { event, planner: engine.planner });
}

// POST /api/lab20/reset — a fresh planner and an empty audit log. Pending approvals are forgotten.
export function resetLab20(_request: IncomingMessage, response: ServerResponse) {
  engine = createEngine(todayIso());
  batches.clear();
  sendJson(response, 200, { planner: engine.planner });
}

// POST /api/lab20/test — the approval rules, run on the server. No network, no API key.
export async function testLab20(_request: IncomingMessage, response: ServerResponse) {
  try {
    const started = performance.now();
    const results = await runRuleSuite();
    sendJson(response, 200, { results, runtime: `Node ${process.version}`, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'The suite crashed.' });
  }
}
