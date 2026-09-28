// Lab 20: approve a write action. Read tools run at once; write tools pause until a person decides.
// Pure functions and one small engine, so the server, the offline bench, and the test page share the same rules.
import { parseArguments, type FunctionToolDeclaration, type ToolCall, type TurnStatus } from './lab16Tool.ts';
import { toolResultEvent, type ToolResultEvent } from './lab17Action.ts';
import { checkSchema, isRealDate, type Issue } from './lab18Validate.ts';

export { toolResultEvent, type ToolResultEvent, type Issue };

// ---- The simulated calendar: a student's study planner ----

export type EventKind = 'study' | 'lab' | 'live_session' | 'deadline';
export type StudyEvent = {
  id: string;
  title: string;
  kind: EventKind;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  durationMin: number;
  movable: boolean; // live sessions and deadlines belong to the course staff
  status: 'scheduled' | 'cancelled';
  version: number; // bumped on every change, so an approval can tell if the event moved under it
};
export type Planner = { events: StudyEvent[] };

export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const todayIso = () => new Date().toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
export const describeWhen = (event: Pick<StudyEvent, 'date' | 'start'>) => `${weekday(event.date)} ${event.date} at ${event.start}`;

// Dates are relative to today, so the lab works whenever it is run.
export function seedPlanner(today: string): Planner {
  const event = (id: string, title: string, kind: EventKind, offset: number, start: string, durationMin: number, movable = true): StudyEvent =>
    ({ id, title, kind, date: addDays(today, offset), start, durationMin, movable, status: 'scheduled', version: 1 });
  return {
    events: [
      event('evt_review_19', 'Review Lab 19 notes', 'study', 1, '18:00', 60),
      event('evt_lab_20', 'Work through Lab 20', 'lab', 2, '10:00', 90),
      event('evt_live_qna', 'Live Q&A: function tools', 'live_session', 3, '17:00', 60, false),
      event('evt_study_group', 'Study group: tools and approvals', 'study', 4, '19:00', 90),
      event('evt_project', 'Stage 4 project submission', 'deadline', 6, '23:00', 0, false),
    ],
  };
}

// ---- The tools, and the policy that says which ones need a person ----

const idPattern = '^evt_[a-z0-9_]{2,40}$';
const datePattern = '^\\d{4}-\\d{2}-\\d{2}$';
const timePattern = '^([01]\\d|2[0-3]):[0-5]\\d$';

export const listTool: FunctionToolDeclaration = {
  type: 'function',
  name: 'list_study_events',
  description: 'List the events in the student\'s study planner, with their IDs, dates, start times, and whether they can be moved. ' +
    'Use it before proposing any change, and whenever the user asks what is planned. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      from_date: { type: 'string', pattern: datePattern, description: 'Only events on or after this date, YYYY-MM-DD. Omit for today.' },
      days: { type: 'integer', minimum: 1, maximum: 60, description: 'How many days to include. Omit for 14.' },
    },
    additionalProperties: false,
  },
};
export const rescheduleTool: FunctionToolDeclaration = {
  type: 'function',
  name: 'reschedule_study_event',
  description: 'Move one event in the student\'s study planner to a new date and start time. This CHANGES the planner, so it waits for the student to approve it. ' +
    'Use it only when the user asks to move something. Call list_study_events first to get the event ID.',
  parameters: {
    type: 'object',
    properties: {
      event_id: { type: 'string', pattern: idPattern, description: 'The event ID from list_study_events, such as "evt_review_19".' },
      new_date: { type: 'string', pattern: datePattern, description: 'The new date, YYYY-MM-DD.' },
      new_start: { type: 'string', pattern: timePattern, description: 'The new start time, 24-hour HH:MM.' },
      reason: { type: 'string', minLength: 3, maxLength: 200, description: 'One short sentence the student will see: why this change.' },
    },
    required: ['event_id', 'new_date', 'new_start', 'reason'],
    additionalProperties: false,
  },
};
export const cancelTool: FunctionToolDeclaration = {
  type: 'function',
  name: 'cancel_study_event',
  description: 'Cancel one event in the student\'s study planner. This CHANGES the planner, so it waits for the student to approve it. ' +
    'Use it only when the user clearly asks to cancel or remove something.',
  parameters: {
    type: 'object',
    properties: {
      event_id: { type: 'string', pattern: idPattern, description: 'The event ID from list_study_events.' },
      reason: { type: 'string', minLength: 3, maxLength: 200, description: 'One short sentence the student will see: why this change.' },
    },
    required: ['event_id', 'reason'],
    additionalProperties: false,
  },
};
export const plannerTools = [listTool, rescheduleTool, cancelTool];

export type Access = 'read' | 'write';
export type Risk = 'none' | 'medium' | 'high';
// The policy lives in code, next to the tools. It is never something the model can argue with.
export const toolPolicy: Record<string, { access: Access; risk: Risk; label: string }> = {
  [listTool.name]: { access: 'read', risk: 'none', label: 'Read the planner' },
  [rescheduleTool.name]: { access: 'write', risk: 'medium', label: 'Move an event' },
  [cancelTool.name]: { access: 'write', risk: 'high', label: 'Cancel an event' },
};

// ---- Validation, before anyone is asked ----

export type RescheduleArgs = { event_id: string; new_date: string; new_start: string; reason: string };
export type CancelArgs = { event_id: string; reason: string };
export type Checked =
  | { ok: true; name: string; args: Record<string, unknown>; event: StudyEvent | null; issues: [] }
  | { ok: false; name: string; args: Record<string, unknown> | null; event: null; issues: Issue[] };

export const horizonDays = 60;
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u0000-\u001f\u007f]/;

export function checkCall(call: Pick<ToolCall, 'name' | 'arguments'>, planner: Planner, today: string): Checked {
  const fail = (issues: Issue[], args: Record<string, unknown> | null = null): Checked => ({ ok: false, name: call.name, args, event: null, issues });
  const tool = plannerTools.find((item) => item.name === call.name);
  if (!tool) return fail([{ layer: 'schema', path: '(name)', code: 'name', message: `"${call.name}" is not a function this server runs.` }]);
  const parsed = parseArguments(call.arguments);
  if (!parsed.value) return fail([{ layer: 'parse', path: '(arguments)', code: 'parse', message: 'must be a JSON object.' }]);
  const shape = checkSchema(parsed.value, tool.parameters);
  if (shape.length) return fail(shape, parsed.value);
  const args = parsed.value;
  const issues: Issue[] = [];
  const meaning = (path: string, code: string, message: string) => issues.push({ layer: 'meaning', path, code, message });
  if (tool === listTool) {
    if (typeof args.from_date === 'string' && !isRealDate(args.from_date)) meaning('/from_date', 'date', `${args.from_date} is not a real date.`);
    return issues.length ? fail(issues, args) : { ok: true, name: call.name, args, event: null, issues: [] };
  }
  if (typeof args.reason === 'string' && controlCharacters.test(args.reason)) meaning('/reason', 'control', 'contains control characters.');
  const event = planner.events.find((item) => item.id === args.event_id);
  if (!event) meaning('/event_id', 'missing', `${String(args.event_id)} is not in the planner. Call ${listTool.name} for the IDs.`);
  else if (event.status === 'cancelled') meaning('/event_id', 'cancelled', `${event.id} is already cancelled.`);
  else if (!event.movable) meaning('/event_id', 'locked', `"${event.title}" belongs to the course staff and cannot be ${tool === cancelTool ? 'cancelled' : 'moved'} from the planner.`);
  if (tool === rescheduleTool && event) {
    const date = String(args.new_date), start = String(args.new_start);
    if (!isRealDate(date)) meaning('/new_date', 'date', `${date} is not a real calendar date.`);
    else if (date < today) meaning('/new_date', 'past', `${date} is in the past (today is ${today}).`);
    else if (date > addDays(today, horizonDays)) meaning('/new_date', 'horizon', `${date} is more than ${horizonDays} days ahead.`);
    else if (toMinutes(start) < 7 * 60 || toMinutes(start) + event.durationMin > 22 * 60) meaning('/new_start', 'hours', `${start} for ${event.durationMin} minutes falls outside study hours (07:00–22:00).`);
    else if (date === event.date && start === event.start) meaning('/new_date', 'same', 'is the same date and time the event already has. Nothing would change.');
  }
  return issues.length ? fail(issues, args) : { ok: true, name: call.name, args, event: event ?? null, issues: [] };
}

const where = (item: Issue) => (item.path.startsWith('(') ? item.path.slice(1, -1) : item.path.slice(1).replace(/\//g, '.'));
export const describeIssues = (name: string, issues: Issue[]) =>
  [`The change was not proposed to the student, because ${name} got invalid arguments:`, ...issues.map((item) => `- ${where(item)} ${item.message}`), 'Fix them, or tell the user why the change is not possible.'].join('\n');

// ---- The preview: computed by code from the stored event, never taken from the model's words ----

export type Change = { field: string; before: string; after: string };
export type Preview = {
  tool: string;
  action: 'reschedule' | 'cancel';
  risk: Risk;
  eventId: string;
  title: string;
  summary: string;
  changes: Change[];
  warnings: string[];
  agentReason: string; // shown as the agent's claim, clearly labelled
  version: number; // the event version the person is looking at
};

const overlaps = (a: Pick<StudyEvent, 'date' | 'start' | 'durationMin'>, b: Pick<StudyEvent, 'date' | 'start' | 'durationMin'>) =>
  a.date === b.date && a.durationMin > 0 && b.durationMin > 0 && toMinutes(a.start) < toMinutes(b.start) + b.durationMin && toMinutes(b.start) < toMinutes(a.start) + a.durationMin;

export function buildPreview(checked: Extract<Checked, { ok: true }>, planner: Planner): Preview {
  const event = checked.event as StudyEvent;
  const args = checked.args;
  const policy = toolPolicy[checked.name];
  if (checked.name === cancelTool.name) {
    return {
      tool: checked.name, action: 'cancel', risk: policy.risk, eventId: event.id, title: event.title, version: event.version,
      summary: `Cancel “${event.title}” on ${describeWhen(event)}.`,
      changes: [{ field: 'status', before: 'scheduled', after: 'cancelled' }],
      warnings: ['A cancelled event is removed from the plan. Re-creating it is not supported by this agent.'],
      agentReason: String(args.reason),
    };
  }
  const moved = { ...event, date: String(args.new_date), start: String(args.new_start) };
  const clashes = planner.events.filter((item) => item.id !== event.id && item.status === 'scheduled' && overlaps(moved, item));
  const changes: Change[] = [];
  if (moved.date !== event.date) changes.push({ field: 'date', before: `${weekday(event.date)} ${event.date}`, after: `${weekday(moved.date)} ${moved.date}` });
  if (moved.start !== event.start) changes.push({ field: 'start', before: event.start, after: moved.start });
  return {
    tool: checked.name, action: 'reschedule', risk: policy.risk, eventId: event.id, title: event.title, version: event.version,
    summary: `Move “${event.title}” from ${describeWhen(event)} to ${describeWhen(moved)}.`,
    changes,
    warnings: clashes.map((item) => `Overlaps “${item.title}” (${item.start}, ${item.durationMin} min) on ${item.date}.`),
    agentReason: String(args.reason),
  };
}

// ---- Binding: the approval covers these exact arguments and nothing else ----

const canonical = (value: unknown): unknown => (Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  : value);
// SHA-256 of the tool name, the call ID, and the arguments with sorted keys. Web Crypto works in the browser and in Node.
export async function digestOf(name: string, callId: string, args: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ name, callId, args: canonical(args) }));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ---- Applying a change, after re-checking it ----

export type Applied = { kind: 'applied'; planner: Planner; before: StudyEvent; after: StudyEvent } | { kind: 'missing' | 'stale'; current: StudyEvent | null };
export function applyChange(planner: Planner, name: string, args: Record<string, unknown>, expectedVersion: number): Applied {
  const before = planner.events.find((item) => item.id === args.event_id) ?? null;
  if (!before) return { kind: 'missing', current: null };
  // Optimistic concurrency: act only on the version the person approved.
  if (before.version !== expectedVersion || before.status !== 'scheduled') return { kind: 'stale', current: before };
  const after: StudyEvent = name === cancelTool.name
    ? { ...before, status: 'cancelled', version: before.version + 1 }
    : { ...before, date: String(args.new_date), start: String(args.new_start), version: before.version + 1 };
  return { kind: 'applied', planner: { events: planner.events.map((item) => (item.id === after.id ? after : item)) }, before, after };
}

// Someone else edits the event in another tab or app. Used to show why a stale approval must not run.
export function editElsewhere(planner: Planner, eventId: string): { planner: Planner; event: StudyEvent } | null {
  const event = planner.events.find((item) => item.id === eventId);
  if (!event || event.status !== 'scheduled') return null;
  const minutes = Math.min(toMinutes(event.start) + 30, 21 * 60);
  const edited = { ...event, start: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`, version: event.version + 1 };
  return { planner: { events: planner.events.map((item) => (item.id === eventId ? edited : item)) }, event: edited };
}

export function listEvents(planner: Planner, args: Record<string, unknown>, today: string) {
  const from = typeof args.from_date === 'string' ? args.from_date : today;
  const to = addDays(from, typeof args.days === 'number' ? args.days : 14);
  const events = planner.events.filter((item) => item.date >= from && item.date < to).map((item) => ({
    event_id: item.id, title: item.title, kind: item.kind, date: item.date, weekday: weekday(item.date), start: item.start, duration_min: item.durationMin, movable: item.movable, status: item.status,
  }));
  return { today, from_date: from, to_date: to, events };
}

// ---- The engine: proposals, approvals, decisions, and the audit log ----

export type ApprovalMode = 'ask' | 'auto';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type Approval = {
  callId: string;
  sessionId: string;
  turnId: string;
  name: string;
  args: Record<string, unknown>;
  digest: string;
  preview: Preview;
  createdAt: number;
  expiresAt: number;
  status: ApprovalStatus;
  decidedAt: number | null;
  reason: string | null; // the person's reason, when they give one
};
export type ToolResult = { callId: string; turnId: string; name: string; success: boolean; output: string | null; error: string | null };

export type AuditDecision = 'ran' | 'invalid' | 'asked' | 'approved' | 'rejected' | 'expired' | 'auto-approved' | 'refused' | 'edited';
export type AuditEntry = {
  id: number;
  at: number;
  sessionId: string;
  callId: string | null;
  tool: string;
  eventId: string | null;
  summary: string;
  decision: AuditDecision;
  actor: 'agent' | 'student' | 'policy' | 'server' | 'someone else';
  outcome: string;
  reason: string | null;
  digest: string | null;
};

export type Engine = { planner: Planner; approvals: Map<string, Approval>; audit: AuditEntry[]; nextAudit: number };
export const createEngine = (today: string): Engine => ({ planner: seedPlanner(today), approvals: new Map(), audit: [], nextAudit: 1 });

// Append-only: entries are added, never edited or removed.
export function record(engine: Engine, entry: Omit<AuditEntry, 'id'>): AuditEntry {
  const saved = { ...entry, id: engine.nextAudit++ };
  engine.audit.push(saved);
  if (engine.audit.length > 500) engine.audit.shift();
  return saved;
}

export const expiryChoices = { normal: 5 * 60_000, short: 20_000 };
export type Context = { sessionId: string; turnId: string; mode: ApprovalMode; now: number; expiryMs: number; today: string };
export type Proposal =
  | { kind: 'ran' | 'invalid' | 'auto'; result: ToolResult; audit: AuditEntry; approval: null }
  | { kind: 'asked'; result: null; audit: AuditEntry; approval: Approval };

const ok = (call: ToolCall, turnId: string, output: unknown): ToolResult => ({ callId: call.callId, turnId: call.turnId ?? turnId, name: call.name, success: true, output: JSON.stringify(output), error: null });
const no = (call: Pick<ToolCall, 'callId' | 'name'> & { turnId: string | null }, turnId: string, error: string): ToolResult => ({ callId: call.callId, turnId: call.turnId ?? turnId, name: call.name, success: false, output: null, error });
const shortDigest = (digest: string) => digest.slice(0, 12);

function execute(engine: Engine, approval: Pick<Approval, 'name' | 'args' | 'preview'>): Applied {
  const applied = applyChange(engine.planner, approval.name, approval.args, approval.preview.version);
  if (applied.kind === 'applied') engine.planner = applied.planner;
  return applied;
}
const doneOutput = (applied: Extract<Applied, { kind: 'applied' }>, approvedBy: 'student' | 'policy', auditId: number) => ({
  status: 'done', approved_by: approvedBy, audit_id: auditId,
  event: { event_id: applied.after.id, title: applied.after.title, date: applied.after.date, start: applied.after.start, status: applied.after.status },
  previous: { date: applied.before.date, start: applied.before.start, status: applied.before.status },
});

// One call from the agent. Reads run. Invalid writes are refused without asking. Valid writes wait for a person,
// unless the policy says auto (shown only for comparison: it is exactly what this lab argues against).
export async function propose(engine: Engine, call: ToolCall, ctx: Context): Promise<Proposal> {
  const checked = checkCall(call, engine.planner, ctx.today);
  const policy = toolPolicy[call.name];
  const base = { sessionId: ctx.sessionId, callId: call.callId, tool: call.name, at: ctx.now, reason: null, digest: null };
  const eventId = checked.args && typeof checked.args.event_id === 'string' ? checked.args.event_id : null;
  if (!checked.ok) {
    const audit = record(engine, { ...base, eventId, summary: checked.issues.map((item) => `${where(item)} ${item.message}`).join(' '), decision: 'invalid', actor: 'server', outcome: 'not run, not asked' });
    return { kind: 'invalid', result: no(call, ctx.turnId, describeIssues(call.name, checked.issues)), audit, approval: null };
  }
  if (policy.access === 'read') {
    const audit = record(engine, { ...base, eventId: null, summary: 'Read the planner', decision: 'ran', actor: 'agent', outcome: 'read only' });
    return { kind: 'ran', result: ok(call, ctx.turnId, listEvents(engine.planner, checked.args, ctx.today)), audit, approval: null };
  }
  const preview = buildPreview(checked, engine.planner);
  const digest = await digestOf(call.name, call.callId, checked.args);
  if (ctx.mode === 'auto') {
    const applied = execute(engine, { name: call.name, args: checked.args, preview });
    const audit = record(engine, { ...base, eventId, summary: preview.summary, decision: 'auto-approved', actor: 'policy', outcome: applied.kind === 'applied' ? `executed · v${applied.before.version} → v${applied.after.version}` : applied.kind, digest: shortDigest(digest) });
    return { kind: 'auto', result: applied.kind === 'applied' ? ok(call, ctx.turnId, doneOutput(applied, 'policy', audit.id)) : no(call, ctx.turnId, 'The change could not be applied.'), audit, approval: null };
  }
  const approval: Approval = {
    callId: call.callId, sessionId: ctx.sessionId, turnId: call.turnId ?? ctx.turnId, name: call.name, args: checked.args, digest, preview,
    createdAt: ctx.now, expiresAt: ctx.now + ctx.expiryMs, status: 'pending', decidedAt: null, reason: null,
  };
  engine.approvals.set(call.callId, approval);
  const audit = record(engine, { ...base, eventId, summary: preview.summary, decision: 'asked', actor: 'agent', outcome: `waiting for the student · risk ${preview.risk}`, digest: shortDigest(digest) });
  return { kind: 'asked', result: null, audit, approval };
}

export type DecisionInput = { callId: string; sessionId: string; decision: 'approve' | 'reject'; digest: string; reason?: string };
export type Decided =
  | { kind: 'executed' | 'rejected' | 'expired' | 'stale'; result: ToolResult; approval: Approval; audit: AuditEntry }
  | { kind: 'unknown' | 'already_decided' | 'tampered'; message: string; audit: AuditEntry | null };

export async function decide(engine: Engine, input: DecisionInput, now: number): Promise<Decided> {
  const approval = engine.approvals.get(input.callId);
  if (!approval || approval.sessionId !== input.sessionId) return { kind: 'unknown', message: 'No approval is waiting for that call.', audit: null };
  const base = { sessionId: approval.sessionId, callId: approval.callId, tool: approval.name, eventId: approval.preview.eventId, summary: approval.preview.summary, at: now, digest: shortDigest(approval.digest) };
  // Decide once. A second click, a retry, or a replayed request never runs the change again.
  if (approval.status !== 'pending') {
    const audit = record(engine, { ...base, decision: 'refused', actor: 'server', outcome: `already ${approval.status}`, reason: null });
    return { kind: 'already_decided', message: `This change was already ${approval.status}. Nothing was done twice.`, audit };
  }
  // The decision must be about the change the person saw. The server runs its own stored arguments, never the browser's.
  if (input.digest !== approval.digest) {
    const audit = record(engine, { ...base, decision: 'refused', actor: 'server', outcome: 'digest mismatch · still pending', reason: null });
    return { kind: 'tampered', message: 'The decision does not match the change awaiting approval. Nothing was done; the approval is still pending.', audit };
  }
  const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim().replace(/\s+/g, ' ').slice(0, 300) : null;
  approval.decidedAt = now;
  approval.reason = reason;
  if (now > approval.expiresAt) {
    approval.status = 'expired';
    const audit = record(engine, { ...base, decision: 'expired', actor: 'server', outcome: 'not run · decision arrived late', reason });
    return { kind: 'expired', approval, audit, result: no(approval, approval.turnId, `The student did not decide within ${Math.round((approval.expiresAt - approval.createdAt) / 1000)} seconds, so the approval expired and nothing was changed. Do not retry on your own; tell the user the change was not made and that they can ask again.`) };
  }
  if (input.decision === 'reject') {
    approval.status = 'rejected';
    const audit = record(engine, { ...base, decision: 'rejected', actor: 'student', outcome: 'not run', reason });
    return { kind: 'rejected', approval, audit, result: no(approval, approval.turnId, `The student rejected this change${reason ? ` and said: "${reason}"` : ''}. Nothing was changed. Do not propose the same change again; tell the user it was not made and ask what they would prefer.`) };
  }
  approval.status = 'approved';
  const applied = execute(engine, approval);
  if (applied.kind !== 'applied') {
    const current = applied.current;
    const audit = record(engine, { ...base, decision: 'approved', actor: 'student', outcome: `not run · ${applied.kind}${current ? ` (v${approval.preview.version} → v${current.version})` : ''}`, reason });
    return { kind: 'stale', approval, audit, result: no(approval, approval.turnId, `The student approved, but the event changed after they reviewed it${current ? ` (it is now ${describeWhen(current)}, ${current.status})` : ''}, so nothing was changed. Tell the user, and offer to propose the change again with the current details.`) };
  }
  const audit = record(engine, { ...base, decision: 'approved', actor: 'student', outcome: `executed · v${applied.before.version} → v${applied.after.version}`, reason });
  return { kind: 'executed', approval, audit, result: ok({ callId: approval.callId, name: approval.name, turnId: approval.turnId, itemId: null, status: null, arguments: approval.args }, approval.turnId, doneOutput(applied, 'student', audit.id)) };
}

// One pause can hold several calls. The Agents API needs a result for every one of them, so ready results are held
// until the last decision arrives, then sent together.
export type Batch = { turnId: string; results: ToolResult[]; waitingFor: Set<string> };
export function settle(batch: Batch, result: ToolResult): ToolResult[] | null {
  batch.results.push(result);
  batch.waitingFor.delete(result.callId);
  return batch.waitingFor.size ? null : batch.results;
}

export function simulateEdit(engine: Engine, eventId: string, sessionId: string, now: number): StudyEvent | null {
  const edited = editElsewhere(engine.planner, eventId);
  if (!edited) return null;
  engine.planner = edited.planner;
  record(engine, { sessionId, callId: null, tool: '(another app)', eventId, summary: `“${edited.event.title}” moved to ${describeWhen(edited.event)}`, decision: 'edited', actor: 'someone else', outcome: `v${edited.event.version - 1} → v${edited.event.version}`, reason: null, digest: null, at: now });
  return edited.event;
}

// ---- The run, as the browser sees it ----

export type Moment = { at: number; kind: 'prompt' | 'call' | 'waiting' | 'decision' | 'result' | 'answer' | 'outcome'; label: string };
export type Segment = {
  sessionId: string | null;
  turnId: string | null;
  turnStatus: TurnStatus;
  calls: ToolCall[];
  results: ToolResult[];
  approvals: Approval[];
  answer: string;
  events: string[];
  timeline: Moment[];
  error: string | null;
};
export type ApprovalRun = { id: string; prompt: string; mode: ApprovalMode; segments: Segment[] };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function parseApproval(raw: unknown): Approval {
  const fail = (): never => { throw new Error('Invalid approval.'); };
  if (!isObject(raw) || typeof raw.callId !== 'string' || typeof raw.digest !== 'string' || !isObject(raw.preview) || !isObject(raw.args)) return fail();
  const statuses: ApprovalStatus[] = ['pending', 'approved', 'rejected', 'expired'];
  return {
    callId: raw.callId, sessionId: String(raw.sessionId ?? ''), turnId: String(raw.turnId ?? ''), name: String(raw.name ?? ''), args: raw.args, digest: raw.digest,
    preview: raw.preview as Preview, createdAt: Number(raw.createdAt), expiresAt: Number(raw.expiresAt),
    status: statuses.includes(raw.status as ApprovalStatus) ? raw.status as ApprovalStatus : 'pending',
    decidedAt: typeof raw.decidedAt === 'number' ? raw.decidedAt : null, reason: typeof raw.reason === 'string' ? raw.reason : null,
  };
}
export function parseSegment(value: unknown): Segment {
  const fail = (): never => { throw new Error('Invalid run summary.'); };
  if (!isObject(value)) return fail();
  const str = (field: unknown) => (typeof field === 'string' ? field : null);
  const statuses: TurnStatus[] = ['completed', 'failed', 'cancelled', 'waiting', 'unknown'];
  if (!statuses.includes(value.turnStatus as TurnStatus) || ![value.calls, value.results, value.approvals, value.events, value.timeline].every(Array.isArray)) return fail();
  return {
    sessionId: str(value.sessionId), turnId: str(value.turnId), turnStatus: value.turnStatus as TurnStatus,
    calls: (value.calls as unknown[]).filter((item): item is ToolCall => isObject(item) && typeof item.callId === 'string' && typeof item.name === 'string'),
    results: (value.results as unknown[]).filter((item): item is ToolResult => isObject(item) && typeof item.callId === 'string' && typeof item.success === 'boolean'),
    approvals: (value.approvals as unknown[]).map(parseApproval),
    answer: typeof value.answer === 'string' ? value.answer : '',
    events: (value.events as unknown[]).filter((item): item is string => typeof item === 'string'),
    timeline: (value.timeline as unknown[]).filter((item): item is Moment => isObject(item) && typeof item.at === 'number' && typeof item.label === 'string'),
    error: str(value.error),
  };
}
export function parseAudit(value: unknown): AuditEntry[] {
  return Array.isArray(value) ? value.filter((item): item is AuditEntry => isObject(item) && typeof item.id === 'number' && typeof item.decision === 'string' && typeof item.summary === 'string') : [];
}
export function parsePlanner(value: unknown): Planner {
  if (!isObject(value) || !Array.isArray(value.events)) throw new Error('Invalid planner.');
  return { events: value.events.filter((item): item is StudyEvent => isObject(item) && typeof item.id === 'string' && typeof item.version === 'number') };
}

export type RunVerdict = { tone: 'changed' | 'declined' | 'waiting' | 'refused' | 'read' | 'auto' | 'failed' | 'unknown'; title: string; text: string };
export function classifyApprovalRun(run: ApprovalRun): RunVerdict {
  const last = run.segments.at(-1);
  if (!last) return { tone: 'unknown', title: 'No outcome', text: 'Nothing has happened yet.' };
  const approvals = run.segments.flatMap((segment) => segment.approvals);
  const latest = new Map(approvals.map((item) => [item.callId, item]));
  const results = run.segments.flatMap((segment) => segment.results);
  const done = results.filter((item) => item.success && item.output?.includes('"status":"done"'));
  const pending = [...latest.values()].filter((item) => item.status === 'pending');
  if (pending.length && last.turnStatus === 'waiting') return { tone: 'waiting', title: 'Waiting for your decision', text: `${pending.length} change${pending.length === 1 ? '' : 's'} wait${pending.length === 1 ? 's' : ''} for approval. The turn is paused on the server until you decide.` };
  if (last.turnStatus === 'failed' || last.turnStatus === 'cancelled' || (last.turnStatus !== 'completed' && last.error)) return { tone: 'failed', title: last.turnStatus === 'cancelled' ? 'Cancelled' : 'Failed', text: last.error ?? `The turn ${last.turnStatus}.` };
  if (last.turnStatus !== 'completed') return { tone: 'unknown', title: 'No outcome', text: 'The stream ended before the turn had an outcome.' };
  if (run.mode === 'auto' && done.length) return { tone: 'auto', title: 'Changed without asking', text: `${done.length} change${done.length === 1 ? ' was' : 's were'} applied by policy. No person saw ${done.length === 1 ? 'it' : 'them'} first. Compare with “Ask me”.` };
  if (done.length) return { tone: 'changed', title: 'Changed with your approval', text: `${done.length} change${done.length === 1 ? ' was' : 's were'} approved, re-checked, applied, and recorded in the audit log.` };
  const decided = [...latest.values()];
  if (decided.length) return { tone: 'declined', title: 'Nothing changed', text: `Your decision${decided.length === 1 ? '' : 's'}: ${decided.map((item) => item.status).join(', ')}. The agent was told, and the planner is unchanged.` };
  if (results.some((item) => !item.success)) return { tone: 'refused', title: 'Refused before asking', text: 'The proposed change was invalid, so you were never asked. The agent received the reasons.' };
  return { tone: 'read', title: 'Read only', text: 'The agent only read the planner. Nothing needed approval.' };
}
