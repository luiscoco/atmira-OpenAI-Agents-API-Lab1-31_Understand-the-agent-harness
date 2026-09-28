// Lab 17: complete a required action. The server runs the function the agent asked for and sends its result back.
// Pure functions only, so the server, the live run, the function bench, and the playground share them.
import { checkArguments, courseCalendarTool, lookupCourseCalendar, parseArguments, type FunctionToolDeclaration, type ToolCall, type TurnStatus } from './lab16Tool.ts';

export { courseCalendarTool };
export type ResultMode = 'execute' | 'fail';
export type Delivery = 'auto' | 'step';

// How many times one turn may pause for tools before the server gives up and cancels it.
export const maxRounds = 4;
export const calendarOutage = 'The course calendar service is unavailable (simulated outage). Try again later.';

// What the server did with one call. `output` is the exact string sent back to the agent.
export type ToolResult = {
  callId: string;
  turnId: string;
  name: string;
  success: boolean;
  output: string | null;
  error: string | null;
  durationMs: number;
  round: number;
};

// The input event the Agents API accepts (AgentSessionInputParam.SessionInputParamAgentSessionInputToolResult in openai 7.23.0).
export type ToolResultEvent = { type: 'agent.session.input.tool_result'; call_id: string; turn_id: string; success: boolean; output?: string; error?: string };

// Run one requested call. The server only runs functions it implements, and only with arguments that match the schema.
export function executeCall(call: ToolCall, tool: FunctionToolDeclaration, mode: ResultMode): Pick<ToolResult, 'success' | 'output' | 'error'> {
  const fail = (error: string) => ({ success: false, output: null, error });
  if (call.name !== tool.name) return fail(`Unknown function "${call.name}". This server only implements ${tool.name}.`);
  const parsed = parseArguments(call.arguments);
  if (!parsed.value) return fail(`Invalid arguments: ${parsed.error ?? 'could not parse them.'}`);
  const problems = checkArguments(parsed.value, tool.parameters).filter((finding) => finding.level === 'error');
  if (problems.length) return fail(`Invalid arguments: ${problems.map((finding) => finding.text).join(' ')}`);
  if (mode === 'fail') return fail(calendarOutage);
  return { success: true, output: JSON.stringify(lookupCourseCalendar(parsed.value)), error: null };
}

// One result becomes one input event. The call_id and turn_id must be the ones the agent sent.
export function toolResultEvent(result: Pick<ToolResult, 'callId' | 'turnId' | 'success' | 'output' | 'error'>): ToolResultEvent {
  const base = { type: 'agent.session.input.tool_result' as const, call_id: result.callId, turn_id: result.turnId, success: result.success };
  return result.success ? { ...base, output: result.output ?? '' } : { ...base, error: result.error ?? 'The function failed.' };
}

// ---- The run, as the browser sees it ----

export type Moment = { at: number; kind: 'prompt' | 'call' | 'result' | 'waiting' | 'answer' | 'outcome'; label: string };

export type ActionRun = {
  id: string;
  prompt: string;
  mode: ResultMode;
  delivery: Delivery;
  sessionId: string | null;
  turnId: string | null;
  turnStatus: TurnStatus;
  rounds: number; // how many times the turn paused for tools and the server answered
  calls: ToolCall[]; // every call the agent asked for
  results: ToolResult[]; // every result the server sent
  pending: ToolCall[]; // calls still waiting (step-through mode)
  answer: string;
  events: string[];
  timeline: Moment[]; // wall-clock times, so a step-through run can be merged across requests
  error: string | null;
};

export type Pair = { call: ToolCall; result: ToolResult | null; finding: { level: 'ok' | 'warn' | 'error'; text: string } };

// Match every call with its result by call_id. A call without a result keeps the turn waiting.
export function pairCalls(run: Pick<ActionRun, 'calls' | 'results'>): Pair[] {
  return run.calls.map((call) => {
    const result = run.results.find((item) => item.callId === call.callId) ?? null;
    if (!result) return { call, result, finding: { level: 'error', text: 'No result was sent for this call_id. The turn cannot finish until one is.' } };
    if (call.turnId && result.turnId !== call.turnId) return { call, result, finding: { level: 'error', text: `turn_id ${result.turnId} does not match the call’s turn ${call.turnId}.` } };
    if (!result.success) return { call, result, finding: { level: 'warn', text: 'Answered with success: false. The agent reads the error and decides what to say or try next.' } };
    return { call, result, finding: { level: 'ok', text: 'Answered with success: true and the same call_id.' } };
  });
}

export type ActionVerdict = { tone: 'complete' | 'waiting' | 'direct' | 'failed' | 'unknown'; title: string; text: string };
export function classifyActionRun(run: ActionRun): ActionVerdict {
  const calls = run.calls.length;
  const failed = run.results.filter((result) => !result.success).length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const unanswered = run.calls.filter((call) => !run.results.some((item) => item.callId === call.callId)).length;
  if (run.pending.length && run.turnStatus === 'waiting') return { tone: 'waiting', title: 'Waiting for your result', text: `The agent asked for ${plural(run.pending.length, 'call')}. Nothing has been sent for ${run.pending.length === 1 ? 'it' : 'them'} yet, so the turn is paused.` };
  if (run.turnStatus === 'waiting') return { tone: 'waiting', title: 'Still waiting · a result is missing', text: `${plural(unanswered, 'call')} ${unanswered === 1 ? 'has' : 'have'} no result, so the turn cannot resume.` };
  if (run.turnStatus === 'completed' && calls) return { tone: 'complete', title: failed ? 'Completed · a tool reported an error' : 'Completed · request → call → result → answer', text: `${plural(calls, 'call')} answered in ${plural(run.rounds, 'round')}${failed ? `, ${failed} with success: false` : ''}. The agent read the ${run.results.length === 1 ? 'result' : 'results'} and finished the turn.` };
  if (run.turnStatus === 'completed') return { tone: 'direct', title: 'Answered directly', text: 'The agent did not need the tool, so there was no required action to complete.' };
  if (run.turnStatus === 'cancelled') return { tone: 'failed', title: 'Cancelled', text: run.error ?? 'The turn was cancelled before it finished.' };
  if (run.turnStatus === 'failed' || run.error) return { tone: 'failed', title: 'Failed', text: run.error ?? 'The turn failed.' };
  return { tone: 'unknown', title: 'No outcome', text: 'The stream ended before the turn had an outcome.' };
}

// A step-through run arrives in two parts: the pause, then what happened after the results were sent.
export function mergeRuns(first: ActionRun, next: ActionRun): ActionRun {
  const calls = [...first.calls, ...next.calls.filter((call) => !first.calls.some((item) => item.callId === call.callId))];
  return {
    ...next,
    id: first.id, prompt: first.prompt, delivery: first.delivery,
    sessionId: first.sessionId ?? next.sessionId, turnId: first.turnId ?? next.turnId,
    rounds: first.rounds + next.rounds,
    calls, results: [...first.results, ...next.results],
    answer: next.answer || first.answer,
    events: [...first.events, ...next.events],
    timeline: [...first.timeline, ...next.timeline],
  };
}

// Runtime boundary: the browser checks the server's summary before using it.
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function parseActionRun(value: unknown, id: string, prompt: string): ActionRun {
  const fail = (): never => { throw new Error('Invalid run summary.'); };
  if (!isObject(value)) return fail();
  const str = (field: unknown): string | null => (typeof field === 'string' ? field : field === null || field === undefined ? null : fail());
  const call = (raw: unknown): ToolCall => {
    if (!isObject(raw) || typeof raw.callId !== 'string' || typeof raw.name !== 'string') return fail();
    return { callId: raw.callId, name: raw.name, turnId: str(raw.turnId), itemId: str(raw.itemId), status: str(raw.status), arguments: raw.arguments };
  };
  const result = (raw: unknown): ToolResult => {
    if (!isObject(raw) || typeof raw.callId !== 'string' || typeof raw.turnId !== 'string' || typeof raw.name !== 'string' || typeof raw.success !== 'boolean') return fail();
    return { callId: raw.callId, turnId: raw.turnId, name: raw.name, success: raw.success, output: str(raw.output), error: str(raw.error), durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : 0, round: typeof raw.round === 'number' ? raw.round : 1 };
  };
  const kinds: Moment['kind'][] = ['prompt', 'call', 'result', 'waiting', 'answer', 'outcome'];
  const moment = (raw: unknown): Moment => (isObject(raw) && typeof raw.at === 'number' && kinds.includes(raw.kind as Moment['kind']) && typeof raw.label === 'string' ? { at: raw.at, kind: raw.kind as Moment['kind'], label: raw.label } : fail());
  const statuses: TurnStatus[] = ['completed', 'failed', 'cancelled', 'waiting', 'unknown'];
  if (!statuses.includes(value.turnStatus as TurnStatus) || ![value.calls, value.results, value.pending, value.events, value.timeline].every(Array.isArray)) return fail();
  return {
    id, prompt,
    mode: value.mode === 'fail' ? 'fail' : 'execute', delivery: value.delivery === 'step' ? 'step' : 'auto',
    sessionId: str(value.sessionId), turnId: str(value.turnId), turnStatus: value.turnStatus as TurnStatus,
    rounds: typeof value.rounds === 'number' ? value.rounds : 0,
    calls: (value.calls as unknown[]).map(call), results: (value.results as unknown[]).map(result), pending: (value.pending as unknown[]).map(call),
    answer: typeof value.answer === 'string' ? value.answer : '',
    events: (value.events as unknown[]).filter((item): item is string => typeof item === 'string'),
    timeline: (value.timeline as unknown[]).map(moment),
    error: str(value.error),
  };
}

// ---- Saved items: the same trace, read back from the session ----

export type TraceItem = { id: string | null; type: string; turnId: string | null; role: string | null; text: string | null; name: string | null; callId: string | null; arguments: unknown; output: unknown; error: string | null; status: string | null };
