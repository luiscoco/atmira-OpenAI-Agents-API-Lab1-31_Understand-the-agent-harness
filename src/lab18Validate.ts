// Lab 18: validate tool inputs, and handle timeouts and exceptions.
// Pure functions and small async helpers only, so the server, the live run, and the test page share them.
import { courseCalendarTool, lookupCourseCalendar, parseArguments, type CalendarEntry, type FunctionToolDeclaration, type ToolCall, type TurnStatus } from './lab16Tool.ts';
import { toolResultEvent, type ToolResultEvent } from './lab17Action.ts';

export { toolResultEvent, type ToolResultEvent };

const kinds = ['lab', 'live_session', 'deadline', 'any'] as const;
export type CalendarKind = (typeof kinds)[number];
// What the function receives once validation succeeds. Everything before this point is `unknown`.
export type CalendarArgs = { topic: string; kind: CalendarKind; from_date?: string };

// The course runs inside this window. A date outside it is well formed but meaningless for this tool.
export const courseWindow = { first: '2026-09-01', last: '2026-12-31' };

// The strict declaration the server offers in Lab 18: Lab 16's tool plus length limits on topic.
export const strictCalendarTool: FunctionToolDeclaration = {
  ...courseCalendarTool,
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', minLength: 2, maxLength: 60, description: 'What to look up: a lab number such as "lab 18", or a topic such as "function tools" or "streaming".' },
      kind: { type: 'string', enum: [...kinds], description: 'The kind of calendar entry. Use "any" when the user does not say.' },
      from_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Only return entries on or after this date, as YYYY-MM-DD. Omit to start from today.' },
    },
    required: ['topic', 'kind'],
    additionalProperties: false,
  },
};

// A loose declaration: no enum, no limits, extra fields allowed. The server still validates against the strict schema,
// which shows that the declaration is a hint to the model and validation is the guarantee.
export const looseCalendarTool: FunctionToolDeclaration = {
  ...courseCalendarTool,
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'What to look up.' },
      kind: { type: 'string', description: 'The kind of calendar entry, in your own words.' },
      from_date: { type: 'string', description: 'A start date.' },
    },
  },
};

// ---- Validation: unknown → CalendarArgs ----

export type Layer = 'parse' | 'schema' | 'meaning';
export type Issue = { layer: Layer; path: string; code: string; message: string };
export type Validation = { ok: true; value: CalendarArgs; issues: [] } | { ok: false; value: null; issues: Issue[] };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const show = (value: unknown) => (typeof value === 'string' && value.length > 40 ? JSON.stringify(`${value.slice(0, 40)}…`) : JSON.stringify(value) ?? String(value));
const typeOf = (value: unknown) => (value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value);

// A small JSON Schema checker for the keywords this course uses. It collects every issue instead of stopping at the
// first one, so the agent can fix all of them in a single retry.
export function checkSchema(value: unknown, schema: Record<string, unknown>, path = ''): Issue[] {
  const at = path || '(arguments)';
  const issue = (code: string, message: string): Issue => ({ layer: 'schema', path: at, code, message });
  const type = schema.type;
  if (type === 'object') {
    if (!isObject(value)) return [issue('type', `must be an object, got ${typeOf(value)}.`)];
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];
    const issues: Issue[] = [];
    for (const key of required) if (!(key in value)) issues.push({ layer: 'schema', path: `${path}/${key}`, code: 'required', message: 'is required but missing.' });
    for (const [key, item] of Object.entries(value)) {
      const property = properties[key];
      if (isObject(property)) issues.push(...checkSchema(item, property, `${path}/${key}`));
      else if (schema.additionalProperties === false) issues.push({ layer: 'schema', path: `${path}/${key}`, code: 'additional', message: 'is not a declared argument. Remove it.' });
    }
    return issues;
  }
  if (type === 'string') {
    if (typeof value !== 'string') return [issue('type', `must be a string, got ${typeOf(value)} ${show(value)}.`)];
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return [issue('enum', `must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')} (got ${show(value)}).`)];
    const issues: Issue[] = [];
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) issues.push(issue('minLength', `must be at least ${schema.minLength} characters (got ${value.length}).`));
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) issues.push(issue('maxLength', `must be at most ${schema.maxLength} characters (got ${value.length}).`));
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) issues.push(issue('pattern', `must match ${schema.pattern} (got ${show(value)}).`));
    return issues;
  }
  if (type === 'integer' || type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) return [issue('type', `must be ${type === 'integer' ? 'an integer' : 'a number'}, got ${typeOf(value)} ${show(value)}.`)];
    // Lab 19 adds numeric ranges.
    if (typeof schema.minimum === 'number' && value < schema.minimum) return [issue('minimum', `must be at least ${schema.minimum} (got ${value}).`)];
    if (typeof schema.maximum === 'number' && value > schema.maximum) return [issue('maximum', `must be at most ${schema.maximum} (got ${value}).`)];
    return [];
  }
  if (type === 'boolean' && typeof value !== 'boolean') return [issue('type', `must be a boolean, got ${typeOf(value)} ${show(value)}.`)];
  return [];
}

// A real calendar date: 2026-02-30 matches the pattern but is not a day that exists.
export function isRealDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Rules a JSON Schema cannot express. The schema checks shape; only your code knows what the values mean.
// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u0000-\u001f\u007f]/;
export function checkMeaning(args: CalendarArgs): Issue[] {
  const issues: Issue[] = [];
  const issue = (path: string, code: string, message: string) => issues.push({ layer: 'meaning', path, code, message });
  if (controlCharacters.test(args.topic)) issue('/topic', 'control', 'contains control characters. Send plain text only.');
  else if (args.topic.trim().length < 2) issue('/topic', 'blank', 'is blank once spaces are removed.');
  if (args.from_date !== undefined) {
    if (!isRealDate(args.from_date)) issue('/from_date', 'date', `${show(args.from_date)} is not a real calendar date.`);
    else if (args.from_date < courseWindow.first || args.from_date > courseWindow.last) issue('/from_date', 'window', `${show(args.from_date)} is outside the course calendar (${courseWindow.first} to ${courseWindow.last}).`);
  }
  return issues;
}

// The whole boundary: parse, check the schema, narrow the type, check the meaning, normalise.
export function validateCalendarArgs(raw: unknown, schema: Record<string, unknown> = strictCalendarTool.parameters): Validation {
  const parsed = parseArguments(raw);
  if (!parsed.value) {
    const message = Array.isArray(raw) ? 'must be a JSON object, got an array.' : raw === null || raw === undefined ? 'are missing.' : typeof raw === 'string' ? 'are not valid JSON.' : `must be a JSON object, got ${typeOf(raw)}.`;
    return { ok: false, value: null, issues: [{ layer: 'parse', path: '(arguments)', code: 'parse', message: parsed.error && typeof raw === 'string' && parsed.error.includes('not an object') ? 'must be a JSON object.' : message }] };
  }
  const shape = checkSchema(parsed.value, schema);
  if (shape.length) return { ok: false, value: null, issues: shape };
  // The schema passed, so these casts are now justified.
  const args: CalendarArgs = { topic: parsed.value.topic as string, kind: parsed.value.kind as CalendarKind };
  if (typeof parsed.value.from_date === 'string') args.from_date = parsed.value.from_date;
  const meaning = checkMeaning(args);
  if (meaning.length) return { ok: false, value: null, issues: meaning };
  return { ok: true, value: { ...args, topic: args.topic.trim().replace(/\s+/g, ' ') }, issues: [] };
}

// ---- The service behind the tool, with faults you can switch on ----

export type Fault = 'none' | 'slow' | 'throw' | 'flaky';
export const faults: Array<{ id: Fault; label: string; hint: string }> = [
  { id: 'none', label: 'Works normally', hint: 'The lookup answers in about a tenth of a second.' },
  { id: 'slow', label: 'Too slow', hint: 'The lookup hangs longer than the timeout. The server aborts it.' },
  { id: 'throw', label: 'Throws a bug', hint: 'The lookup crashes with a TypeError. The stack trace stays on the server.' },
  { id: 'flaky', label: 'Fails once', hint: 'The first attempt in a turn hits a temporary error; a retry succeeds.' },
];

// Timings. The test page uses shorter ones so the whole suite runs in under a second.
export type Timing = { timeoutMs: number; latencyMs: number; slowMs: number };
export const liveTiming: Timing = { timeoutMs: 1500, latencyMs: 120, slowMs: 6000 };
export const testTiming: Timing = { timeoutMs: 300, latencyMs: 20, slowMs: 1200 };

export class ToolTimeoutError extends Error {
  constructor(readonly ms: number) { super(`Timed out after ${ms} ms.`); this.name = 'ToolTimeoutError'; }
}
// An error worth one retry, such as a dropped connection. Anything else is treated as a bug.
export class TransientError extends Error {
  constructor(message: string) { super(message); this.name = 'TransientError'; }
}

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason);
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

// The course calendar as a remote service. It honours the abort signal, so a timeout also stops the work.
export async function calendarService(args: CalendarArgs, fault: Fault, attempt: number, timing: Timing, signal: AbortSignal): Promise<{ entries: CalendarEntry[]; note: string }> {
  await wait(fault === 'slow' ? timing.slowMs : timing.latencyMs, signal);
  if (fault === 'flaky' && attempt === 1) throw new TransientError('ECONNRESET: the calendar backend closed the connection.');
  if (fault === 'throw') {
    const rows: CalendarEntry[] = [];
    // A genuine bug: reading a field of a row that does not exist throws a real TypeError.
    return { entries: [], note: rows[0].date };
  }
  return lookupCourseCalendar(args);
}

// Run work with a deadline. On timeout, abort the work as well as rejecting, or it keeps running in the background.
export async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { const error = new ToolTimeoutError(ms); controller.abort(error); reject(error); }, ms);
  });
  try { return await Promise.race([work(controller.signal), deadline]); }
  finally { clearTimeout(timer); }
}

// ---- One call, end to end ----

export type Stage = 'name' | 'parse' | 'schema' | 'meaning' | 'timeout' | 'exception' | 'ok';
export const stages: Array<{ id: Stage; label: string; detail: string }> = [
  { id: 'name', label: 'Name', detail: 'a function we run' },
  { id: 'parse', label: 'Parse', detail: 'JSON object' },
  { id: 'schema', label: 'Schema', detail: 'shape and types' },
  { id: 'meaning', label: 'Meaning', detail: 'rules code knows' },
  { id: 'timeout', label: 'Deadline', detail: 'answer in time' },
  { id: 'exception', label: 'No crash', detail: 'errors caught' },
  { id: 'ok', label: 'Result', detail: 'success: true' },
];

export type ToolOutcome = {
  stage: Stage; // where the call stopped; 'ok' means it ran and succeeded
  success: boolean;
  output: string | null; // sent to the agent
  error: string | null; // sent to the agent: short, actionable, no internals
  retryable: boolean;
  issues: Issue[];
  args: CalendarArgs | null; // the validated, normalised arguments
  internal: string | null; // server log only: never sent to the agent
  durationMs: number;
};
export type RunOptions = { fault: Fault; attempt: number; timing: Timing; repeated?: boolean };

const where = (item: Issue) => (item.path === '(arguments)' ? 'arguments' : item.path.slice(1).replace(/\//g, '.'));
export function describeIssues(issues: Issue[], repeated = false): string {
  return [
    `Invalid arguments for ${strictCalendarTool.name}:`,
    ...issues.map((item) => `- ${where(item)} ${item.message}`),
    repeated ? 'You already sent these exact arguments and they were rejected. Change them before calling again.' : 'Fix these and call the tool again.',
  ].join('\n');
}
const errorRef = () => `err_${Math.random().toString(36).slice(2, 8)}`;

export async function runTool(call: Pick<ToolCall, 'name' | 'arguments'>, options: RunOptions): Promise<ToolOutcome> {
  const started = performance.now();
  const elapsed = () => Math.round((performance.now() - started) * 10) / 10;
  const refuse = (stage: Stage, error: string, retryable: boolean, issues: Issue[] = [], internal: string | null = null): ToolOutcome =>
    ({ stage, success: false, output: null, error, retryable, issues, args: null, internal, durationMs: elapsed() });

  if (call.name !== strictCalendarTool.name) return refuse('name', `Unknown function "${call.name}". This server only runs ${strictCalendarTool.name}.`, false);
  const checked = validateCalendarArgs(call.arguments);
  if (!checked.ok) return refuse(checked.issues[0].layer, describeIssues(checked.issues, options.repeated), !options.repeated, checked.issues);
  const args = checked.value;
  try {
    const result = await withTimeout((signal) => calendarService(args, options.fault, options.attempt, options.timing, signal), options.timing.timeoutMs);
    return { stage: 'ok', success: true, output: JSON.stringify(result), error: null, retryable: false, issues: [], args, internal: null, durationMs: elapsed() };
  } catch (caught) {
    const outcome = (stage: Stage, error: string, retryable: boolean, internal: string) => ({ ...refuse(stage, error, retryable, [], internal), args });
    if (caught instanceof ToolTimeoutError) return outcome('timeout', `${strictCalendarTool.name} did not answer within ${caught.ms} ms. You may try once more; if it times out again, tell the user the calendar is unavailable.`, true, `${caught.name}: ${caught.message} The request was aborted.`);
    if (caught instanceof TransientError) return outcome('exception', `${strictCalendarTool.name} hit a temporary error. Try the same call once more.`, true, `${caught.name}: ${caught.message}`);
    // A bug: log the details with a reference, and give the agent only the reference.
    const ref = errorRef();
    const detail = caught instanceof Error ? `${caught.name}: ${caught.message}${caught.stack ? `\n${caught.stack.split('\n').slice(1, 3).join('\n')}` : ''}` : String(caught);
    return outcome('exception', `${strictCalendarTool.name} failed with an internal error (ref ${ref}). Do not retry. Tell the user the calendar is unavailable right now.`, false, `[${ref}] ${detail}`);
  }
}

// A stable key for "the same call again": the name plus the arguments with sorted keys.
export function callSignature(call: Pick<ToolCall, 'name' | 'arguments'>): string {
  const parsed = parseArguments(call.arguments);
  const value = parsed.value ? Object.fromEntries(Object.entries(parsed.value).sort(([a], [b]) => a.localeCompare(b))) : call.arguments;
  return `${call.name}:${JSON.stringify(value)}`;
}

// ---- The run, as the browser sees it ----

export type Declaration = 'strict' | 'loose';
export type CheckedResult = ToolOutcome & { callId: string; turnId: string; name: string; round: number; attempt: number };
export type Moment = { at: number; kind: 'prompt' | 'call' | 'reject' | 'result' | 'answer' | 'outcome'; label: string };

export type ValidationRun = {
  id: string;
  prompt: string;
  fault: Fault;
  declaration: Declaration;
  sessionId: string | null;
  turnId: string | null;
  turnStatus: TurnStatus;
  rounds: number;
  calls: ToolCall[];
  results: CheckedResult[];
  answer: string;
  events: string[];
  timeline: Moment[];
  error: string | null;
};

export type RunVerdict = { tone: 'clean' | 'recovered' | 'reported' | 'direct' | 'failed' | 'unknown'; title: string; text: string };
export function classifyValidationRun(run: ValidationRun): RunVerdict {
  const rejected = run.results.filter((item) => !item.success);
  const succeeded = run.results.some((item) => item.success);
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (run.turnStatus === 'completed' && !run.calls.length) return { tone: 'direct', title: 'Answered directly', text: 'The agent did not call the tool, so there was nothing to validate.' };
  if (run.turnStatus === 'completed' && !rejected.length) return { tone: 'clean', title: 'Valid on the first try', text: `${count(run.results.length, 'call')} passed every check and ran within the deadline.` };
  if (run.turnStatus === 'completed' && succeeded) return { tone: 'recovered', title: 'Recovered after a rejection', text: `${count(rejected.length, 'call')} failed (${[...new Set(rejected.map((item) => item.stage))].join(', ')}). The agent read the error, tried again, and a later call succeeded.` };
  if (run.turnStatus === 'completed') return { tone: 'reported', title: 'Reported honestly', text: `Every call failed (${[...new Set(rejected.map((item) => item.stage))].join(', ')}). The turn still completed because each call got a result; check that the answer admits the problem.` };
  if (run.turnStatus === 'cancelled') return { tone: 'failed', title: 'Cancelled', text: run.error ?? 'The turn was cancelled.' };
  if (run.turnStatus === 'failed' || run.error) return { tone: 'failed', title: 'Failed', text: run.error ?? 'The turn failed.' };
  return { tone: 'unknown', title: 'No outcome', text: 'The stream ended before the turn had an outcome.' };
}

// Runtime boundary: the browser checks the server's summary before using it.
export function parseValidationRun(value: unknown, id: string, prompt: string): ValidationRun {
  const fail = (): never => { throw new Error('Invalid run summary.'); };
  if (!isObject(value)) return fail();
  const str = (field: unknown): string | null => (typeof field === 'string' ? field : field === null || field === undefined ? null : fail());
  const call = (raw: unknown): ToolCall => {
    if (!isObject(raw) || typeof raw.callId !== 'string' || typeof raw.name !== 'string') return fail();
    return { callId: raw.callId, name: raw.name, turnId: str(raw.turnId), itemId: str(raw.itemId), status: str(raw.status), arguments: raw.arguments };
  };
  const stageIds = stages.map((item) => item.id);
  const result = (raw: unknown): CheckedResult => {
    if (!isObject(raw) || typeof raw.callId !== 'string' || typeof raw.name !== 'string' || typeof raw.success !== 'boolean' || !stageIds.includes(raw.stage as Stage)) return fail();
    const issues = Array.isArray(raw.issues) ? raw.issues.filter((item): item is Issue => isObject(item) && typeof item.path === 'string' && typeof item.message === 'string') : [];
    return {
      callId: raw.callId, turnId: typeof raw.turnId === 'string' ? raw.turnId : '', name: raw.name, stage: raw.stage as Stage, success: raw.success,
      output: str(raw.output), error: str(raw.error), retryable: raw.retryable === true, issues, args: isObject(raw.args) ? raw.args as CalendarArgs : null,
      internal: str(raw.internal), durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : 0,
      round: typeof raw.round === 'number' ? raw.round : 1, attempt: typeof raw.attempt === 'number' ? raw.attempt : 0,
    };
  };
  const momentKinds: Moment['kind'][] = ['prompt', 'call', 'reject', 'result', 'answer', 'outcome'];
  const moment = (raw: unknown): Moment => (isObject(raw) && typeof raw.at === 'number' && momentKinds.includes(raw.kind as Moment['kind']) && typeof raw.label === 'string' ? { at: raw.at, kind: raw.kind as Moment['kind'], label: raw.label } : fail());
  const statuses: TurnStatus[] = ['completed', 'failed', 'cancelled', 'waiting', 'unknown'];
  if (!statuses.includes(value.turnStatus as TurnStatus) || ![value.calls, value.results, value.events, value.timeline].every(Array.isArray)) return fail();
  return {
    id, prompt,
    fault: faults.some((item) => item.id === value.fault) ? value.fault as Fault : 'none',
    declaration: value.declaration === 'loose' ? 'loose' : 'strict',
    sessionId: str(value.sessionId), turnId: str(value.turnId), turnStatus: value.turnStatus as TurnStatus,
    rounds: typeof value.rounds === 'number' ? value.rounds : 0,
    calls: (value.calls as unknown[]).map(call), results: (value.results as unknown[]).map(result),
    answer: typeof value.answer === 'string' ? value.answer : '',
    events: (value.events as unknown[]).filter((item): item is string => typeof item === 'string'),
    timeline: (value.timeline as unknown[]).map(moment),
    error: str(value.error),
  };
}
