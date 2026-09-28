// Lab 15: turn a run into an honest summary of tokens, time, and errors.
// Usage is best effort: null means unknown, never zero. Pure functions only, so the live run and the playground share them.

export type Usage = { input: number; output: number; total: number; cached: number | null; reasoning: number | null };
export type Outcome = 'completed' | 'failed' | 'cancelled' | 'rejected' | 'unknown';
export type ErrorSource = 'http' | 'turn' | 'stream';
export type RunError = { source: ErrorSource; status: number | null; code: string | null; message: string };

// Everything one run left behind. Milliseconds are measured by our server from the moment it sent the request.
// Timestamps are the API's own, in whole Unix seconds.
export type RunRecord = {
  id: string;
  prompt: string;
  model: string | null;
  sessionId: string | null;
  turnId: string | null;
  outcome: Outcome;
  clock: { firstEventMs: number | null; turnCreatedMs: number | null; inProgressMs: number | null; firstTextMs: number | null; endMs: number | null };
  api: { createdAt: number | null; startedAt: number | null; completedAt: number | null };
  usage: { event: Usage | null; turn: Usage | null; session: Usage | null; rereadAt: number | null };
  savedStatus: string | null; // the turn status from the latest re-read, if any
  error: RunError | null;
  chars: number;
};

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

// Runtime boundary for the API's TokenUsage object. Anything missing or malformed is unknown.
export function parseUsage(raw: unknown): Usage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const usage = raw as Record<string, unknown>;
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  if (input === null || output === null) return null;
  const inputDetails = usage.input_tokens_details as Record<string, unknown> | null | undefined;
  const outputDetails = usage.output_tokens_details as Record<string, unknown> | null | undefined;
  return {
    input,
    output,
    total: count(usage.total_tokens) ?? input + output,
    cached: count(inputDetails?.cached_tokens),
    reasoning: count(outputDetails?.reasoning_tokens),
  };
}

// The value a summary should trust: the saved turn when it was re-read, otherwise the terminal event.
export function bestUsage(run: RunRecord): { usage: Usage | null; source: 'saved turn' | 'turn event' | null } {
  if (run.usage.turn) return { usage: run.usage.turn, source: 'saved turn' };
  if (run.usage.event) return { usage: run.usage.event, source: 'turn event' };
  return { usage: null, source: null };
}

export const tokens = (value: number | null | undefined): string => (value === null || value === undefined ? 'unknown' : value.toLocaleString('en-US'));
export const ms = (value: number | null): string => (value === null ? 'unknown' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`);

export type Duration = { label: string; value: string; known: boolean; note: string };

// Three clocks, three meanings. Each one is reported only when both of its ends are known.
export function durations(run: RunRecord): Duration[] {
  const { clock, api } = run;
  const span = (from: number | null, to: number | null) => (from === null || to === null ? null : Math.max(0, to - from));
  const queued = span(api.createdAt, api.startedAt);
  const working = span(api.startedAt, api.completedAt);
  return [
    { label: 'Wall time', value: ms(clock.endMs), known: clock.endMs !== null, note: 'Our server: request sent → turn outcome. What the user waited.' },
    { label: 'First text', value: ms(clock.firstTextMs), known: clock.firstTextMs !== null, note: 'Our server: request sent → first output_text.delta. What the user felt.' },
    { label: 'Start-up', value: ms(clock.inProgressMs), known: clock.inProgressMs !== null, note: 'Our server: request sent → turn.in_progress. Session creation and queueing.' },
    { label: 'Queued (API)', value: queued === null ? 'unknown' : `${queued} s`, known: queued !== null, note: 'turn.started_at − turn.created_at, in whole seconds.' },
    { label: 'Working (API)', value: working === null ? 'unknown' : `${working} s`, known: working !== null, note: 'turn.completed_at − turn.started_at, in whole seconds. Set for any terminal status.' },
  ];
}

// Sum usage without pretending: unknown runs are counted, not added as zero.
export type UsageTotal = { input: number; output: number; total: number; known: number; unknown: number };
export function sumUsage(list: Array<Usage | null>): UsageTotal {
  return list.reduce<UsageTotal>((sum, usage) => usage
    ? { input: sum.input + usage.input, output: sum.output + usage.output, total: sum.total + usage.total, known: sum.known + 1, unknown: sum.unknown }
    : { ...sum, unknown: sum.unknown + 1 }, { input: 0, output: 0, total: 0, known: 0, unknown: 0 });
}
// "at least" when any run is unknown: the known sum is a floor, not the answer.
export const totalLabel = (value: number, sum: UsageTotal): string => (sum.known === 0 ? 'unknown' : `${sum.unknown ? '≥ ' : ''}${value.toLocaleString('en-US')}`);

export type Check = { ok: boolean | null; text: string };

// Sanity checks that catch a wrong reading before it reaches a dashboard.
export function usageChecks(run: RunRecord): Check[] {
  const { usage } = bestUsage(run);
  const checks: Check[] = [];
  if (run.outcome === 'unknown' && run.savedStatus) checks.push({ ok: null, text: `The stream ended without an outcome, but the saved turn is ${run.savedStatus}. The work went on after the page stopped reading.` });
  if (!usage) {
    checks.push({ ok: null, text: run.outcome === 'rejected' ? 'No turn ran, so no usage exists. That is different from unknown usage.' : 'Usage is unknown. It is shown as unknown and left out of totals, not counted as 0.' });
    return checks;
  }
  checks.push({ ok: usage.total === usage.input + usage.output, text: `total_tokens ${tokens(usage.total)} ${usage.total === usage.input + usage.output ? '=' : '≠'} input ${tokens(usage.input)} + output ${tokens(usage.output)}.` });
  if (usage.cached !== null) checks.push({ ok: usage.cached <= usage.input, text: `Cached ${tokens(usage.cached)} is part of input, not extra: ${usage.cached <= usage.input ? 'within' : 'exceeds'} input.` });
  if (usage.reasoning !== null) checks.push({ ok: usage.reasoning <= usage.output, text: `Reasoning ${tokens(usage.reasoning)} is part of output, not extra: ${usage.reasoning <= usage.output ? 'within' : 'exceeds'} output.` });
  if (run.usage.event && run.usage.turn) {
    const same = run.usage.event.total === run.usage.turn.total && run.usage.event.input === run.usage.turn.input;
    checks.push({ ok: same ? true : null, text: same ? 'The terminal event and the saved turn agree.' : `Recorded usage changed: the event said ${tokens(run.usage.event.total)}, the saved turn now says ${tokens(run.usage.turn.total)}. Trust the latest read.` });
  } else if (run.usage.event && !run.usage.turn) {
    checks.push({ ok: null, text: 'Read from the terminal event only. Recorded usage may change; re-read the saved turn before storing it.' });
  }
  if (run.outcome === 'cancelled' || run.outcome === 'failed') checks.push({ ok: null, text: `The turn ${run.outcome}, yet these tokens were used. Work before the end still counts.` });
  return checks;
}

export type ErrorHelp = { title: string; retry: 'yes' | 'later' | 'no' | 'change'; advice: string };

// The SDK's SessionTurnError codes, plus the HTTP statuses a request can fail with before any turn exists.
const codeHelp: Record<string, ErrorHelp> = {
  rate_limit_exceeded: { title: 'Rate limited', retry: 'later', advice: 'Wait and retry with backoff. Show the user it is temporary.' },
  server_overloaded: { title: 'Model overloaded', retry: 'later', advice: 'Transient. Retry with backoff, or fall back to another model.' },
  server_error: { title: 'Model service error', retry: 'later', advice: 'Transient. Retry once, then report.' },
  internal_error: { title: 'Internal error', retry: 'later', advice: 'Retry once, then report with the session and turn IDs.' },
  connection_failed: { title: 'Could not reach the model', retry: 'later', advice: 'Transient. Retry with backoff.' },
  request_timeout: { title: 'Timed out', retry: 'later', advice: 'Retry, or ask for a shorter answer.' },
  context_length_exceeded: { title: 'Too much context', retry: 'change', advice: 'Retrying unchanged fails again. Start a new session or shorten the input.' },
  session_budget_exceeded: { title: 'Session budget reached', retry: 'change', advice: 'This session has used its budget. Start a new session.' },
  usage_limit_exceeded: { title: 'Usage limit reached', retry: 'no', advice: 'An organization limit. Retrying does not help; an admin must raise it.' },
  credit_balance_exhausted: { title: 'No credits left', retry: 'no', advice: 'Billing issue. Retrying does not help.' },
  authentication_error: { title: 'Credentials rejected', retry: 'no', advice: 'Fix the server’s API key or project access.' },
  invalid_request: { title: 'Invalid request', retry: 'change', advice: 'The request itself is wrong. Fix it before retrying.' },
  resource_not_found: { title: 'Model or resource unavailable', retry: 'change', advice: 'Check the model name and the project’s access to it.' },
  model_not_found: { title: 'Model not found', retry: 'change', advice: 'Check the model name and the project’s access to it.' },
  cyber_policy: { title: 'Blocked by a safety policy', retry: 'no', advice: 'Do not retry the same request.' },
  active_turn_not_steerable: { title: 'Turn cannot take input now', retry: 'later', advice: 'Wait for the turn to finish, or cancel it first.' },
};
const statusHelp = (status: number | null): ErrorHelp => {
  if (status === 401 || status === 403) return codeHelp.authentication_error;
  if (status === 404) return codeHelp.resource_not_found;
  if (status === 429) return codeHelp.rate_limit_exceeded;
  if (status !== null && status >= 500) return codeHelp.server_error;
  if (status === 400 || status === 422) return codeHelp.invalid_request;
  return { title: 'Request failed', retry: 'change', advice: 'Read the message, then decide.' };
};

export function explainError(error: RunError): ErrorHelp {
  if (error.source === 'stream') return { title: 'Stream ended without an outcome', retry: 'no', advice: 'The turn may still be running. Read the saved turn before retrying, or you may pay twice.' };
  return (error.code && codeHelp[error.code]) || statusHelp(error.status);
}
export const retryLabels: Record<ErrorHelp['retry'], string> = { yes: 'Retry now', later: 'Retry later', no: 'Do not retry', change: 'Change, then retry' };

// One line for a log or a support ticket. It never says 0 for an unknown value.
export function summaryLine(run: RunRecord): string {
  const { usage } = bestUsage(run);
  const parts = [`${run.outcome}`, `wall ${ms(run.clock.endMs)}`, `first text ${ms(run.clock.firstTextMs)}`, `tokens ${usage ? `${tokens(usage.input)} in / ${tokens(usage.output)} out` : run.outcome === 'rejected' ? 'none (no turn ran)' : 'unknown'}`];
  if (run.error) parts.push(`error ${run.error.code ?? run.error.status ?? run.error.source}: ${run.error.message}`);
  return parts.join(' · ');
}

// Runtime boundary: the browser checks the server's summary before using it.
const nullableNumber = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value));
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const outcomes: Outcome[] = ['completed', 'failed', 'cancelled', 'rejected', 'unknown'];

export type ServerSummary = Omit<RunRecord, 'id' | 'prompt' | 'usage' | 'savedStatus'> & { usage: Usage | null };
export function parseServerSummary(value: unknown): ServerSummary {
  const fail = (): never => { throw new Error('Invalid run summary.'); };
  if (typeof value !== 'object' || value === null) return fail();
  const body = value as Record<string, unknown>;
  const clock = body.clock as Record<string, unknown> | null;
  const api = body.api as Record<string, unknown> | null;
  if (!clock || !api || !outcomes.includes(body.outcome as Outcome) || !nullableString(body.model) || !nullableString(body.sessionId) || !nullableString(body.turnId) || typeof body.chars !== 'number') return fail();
  const clockKeys = ['firstEventMs', 'turnCreatedMs', 'inProgressMs', 'firstTextMs', 'endMs'] as const;
  const apiKeys = ['createdAt', 'startedAt', 'completedAt'] as const;
  if (!clockKeys.every((key) => nullableNumber(clock[key])) || !apiKeys.every((key) => nullableNumber(api[key]))) return fail();
  let error: RunError | null = null;
  if (body.error !== null) {
    const raw = body.error as Record<string, unknown>;
    if (!raw || !['http', 'turn', 'stream'].includes(raw.source as string) || !nullableNumber(raw.status) || !nullableString(raw.code) || typeof raw.message !== 'string') return fail();
    error = { source: raw.source as ErrorSource, status: raw.status, code: raw.code, message: raw.message };
  }
  return {
    model: body.model, sessionId: body.sessionId, turnId: body.turnId, outcome: body.outcome as Outcome, chars: body.chars, error,
    clock: { firstEventMs: clock.firstEventMs as number | null, turnCreatedMs: clock.turnCreatedMs as number | null, inProgressMs: clock.inProgressMs as number | null, firstTextMs: clock.firstTextMs as number | null, endMs: clock.endMs as number | null },
    api: { createdAt: api.createdAt as number | null, startedAt: api.startedAt as number | null, completedAt: api.completedAt as number | null },
    usage: parseUsage(body.usage), // the raw API object; malformed or null stays unknown
  };
}
