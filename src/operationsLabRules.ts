import { applyDelegationEvent, newDelegationTrace, type DelegationTrace } from './lab39Delegation.ts';

export const operationTitles = { 41: 'Display subagent progress', 42: 'Coordinate reviewer and writer', 43: 'Compare single and multi-agent runs', 44: 'Receive a webhook', 45: 'Automate with lifecycle hooks', 46: 'Expose React actions through WebMCP', 47: 'Read an agent trace', 48: 'Record usage carefully', 49: 'Add limits and retries', 50: 'Protect user sessions' };
export type OperationsLabId = keyof typeof operationTitles;
export function progressDecision(trace: DelegationTrace) {
  if (trace.root === 'completed') return 'Inspect root answer and completeness';
  if (['failed', 'cancelled'].includes(trace.root)) return 'Root settled; inspect failure and cleanup';
  if (Object.values(trace.turns).some(turn => turn.child && ['failed', 'cancelled'].includes(turn.status))) return 'Root still pending; wait for bounded recovery or inspect saved state';
  return 'Root still pending; continue observing';
}
export function progressEvents(failure = false) {
  return [
    { type: 'agent.session.turn.in_progress', turn: { id: 'root', subagent_id: null } },
    { type: 'agent.session.subagent.created', subagent: { id: 'writer' } },
    { type: 'agent.session.subagent.created', subagent: { id: 'reviewer' } },
    { type: 'agent.session.turn.in_progress', turn: { id: 'writer-turn', subagent_id: 'writer' } },
    { type: 'agent.session.turn.in_progress', turn: { id: 'reviewer-turn', subagent_id: 'reviewer' } },
    { type: 'agent.session.turn.completed', turn: { id: 'writer-turn', subagent_id: 'writer' } },
    { type: `agent.session.turn.${failure ? 'failed' : 'completed'}`, turn: { id: 'reviewer-turn', subagent_id: 'reviewer' } },
    { type: 'agent.session.turn.completed', turn: { id: 'root', subagent_id: null } },
  ].map((event, index) => ({ event_id: `progress-${index}`, ...event }));
}
export function replayProgress(events: any[], count: number) { const trace = newDelegationTrace('synthetic step-by-step replay'); events.slice(0, count).forEach((event, i) => applyDelegationEvent(trace, event, i * 100)); return trace; }

export const reviewSource = 'Release A adds a date filter without breaking existing queries. Release B returns a download URL; clients must fetch that URL. Support contact: support@example.test.';
export const draftFixture = 'Release A adds date filtering. Release B returns file bytes. No client changes are required.';
export const revisedFixture = 'Release A adds date filtering; existing queries continue to work. Release B returns a download URL; clients must fetch that URL. Contact support@example.test for help.';
export function reviewDraft(draft: string) {
  return [
    { id: 'AC-01', name: 'Date filter and backwards compatibility', passed: /date/i.test(draft) && /existing queries continue|backward/i.test(draft) },
    { id: 'AC-02', name: 'Export change and migration action', passed: /download URL/i.test(draft) && /fetch/i.test(draft) && !/returns file bytes|no client changes/i.test(draft) },
    { id: 'AC-03', name: 'Support contact grounded in source', passed: draft.includes('support@example.test') },
  ];
}
export type UsageTurn = { id: string; subagent_id: string | null; usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null };
export function parseUsage(value: any): UsageTurn[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Supply up to 500 turn resources, not a session aggregate.');
  const rows = new Map<string, UsageTurn>();
  for (const row of value) {
    if (!row || typeof row.id !== 'string' || row.id.length > 100 || !(row.subagent_id === null || typeof row.subagent_id === 'string') || !(row.usage === null || (row.usage && ['input_tokens', 'output_tokens', 'total_tokens'].every(key => Number.isSafeInteger(row.usage[key]) && row.usage[key] >= 0) && row.usage.total_tokens === row.usage.input_tokens + row.usage.output_tokens))) throw new Error('Invalid turn ownership or nullable usage.');
    rows.set(row.id, { id: row.id, subagent_id: row.subagent_id, usage: row.usage === null ? null : { input_tokens: row.usage.input_tokens, output_tokens: row.usage.output_tokens, total_tokens: row.usage.total_tokens } });
  }
  return [...rows.values()]; // Later snapshots replace earlier ones; never sum snapshots.
}
export function usageSummary(turns: UsageTurn[]) { const rows = parseUsage(turns); const known = rows.filter(row => row.usage !== null); return { knownSubtotal: known.reduce((sum, row) => sum + row.usage!.total_tokens, 0), unknownTurns: rows.length - known.length, total: rows.length && rows.length === known.length ? known.reduce((sum, row) => sum + row.usage!.total_tokens, 0) : null, rootTurns: rows.filter(row => row.subagent_id === null).length, childTurns: rows.filter(row => row.subagent_id !== null).length }; }
export const usageFixture: UsageTurn[] = [{ id: 'root-turn', subagent_id: null, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }, { id: 'child-turn', subagent_id: 'reviewer', usage: null }];
export type ComparisonRun = { task: string; source: string; model: string; mode: 'single' | 'multi'; durationMs: number | null; draft: string; turns: UsageTurn[]; coordinationCalls: number; recoveryAttempts: number };
export const comparisonFixture: ComparisonRun[] = [
  { task: reviewSource, source: 'synthetic fixture', model: 'fixture-model', mode: 'single', durationMs: 1500, draft: draftFixture, turns: [{ id: 'single', subagent_id: null, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }], coordinationCalls: 0, recoveryAttempts: 0 },
  { task: reviewSource, source: 'synthetic fixture', model: 'fixture-model', mode: 'multi', durationMs: 2000, draft: revisedFixture, turns: usageFixture, coordinationCalls: 3, recoveryAttempts: 1 },
];
export function compareRuns(value: any) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error('Import exactly one single and one multi run.');
  const single = value.find(row => row?.mode === 'single'), multi = value.find(row => row?.mode === 'multi');
  if (!single || !multi || single.task !== reviewSource || multi.task !== single.task || typeof single.model !== 'string' || single.model !== multi.model) throw new Error('Both modes must use the displayed task and the same model.');
  const rows = [single, multi].map(row => {
    if (typeof row.source !== 'string' || typeof row.draft !== 'string' || row.draft.length > 10000 || !(row.durationMs === null || Number.isFinite(row.durationMs) && row.durationMs >= 0) || ![row.coordinationCalls, row.recoveryAttempts].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid comparison evidence.');
    return { ...row, quality: reviewDraft(row.draft).filter(check => check.passed).length, usage: usageSummary(row.turns) };
  });
  return { rows, recommendation: rows[1].quality > rows[0].quality ? 'Delegation improves these acceptance checks. Compare additional duration, coordination and recovery; incomplete usage prevents a token-cost conclusion.' : 'No measured quality gain. Prefer the simpler run unless repeated matched evidence shows a benefit.' };
}

export function filterReport(filter: string) { if (!['all', 'complete', 'needs-review'].includes(filter)) throw new Error('Unknown report filter'); return [{ name: 'Search migration', status: 'complete' }, { name: 'Export migration', status: 'needs-review' }].filter(row => filter === 'all' || row.status === filter); }
export function validateToolInput(value: any, keys: string[]) { if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) throw new Error('Unexpected tool arguments'); }
export type TraceSpan = { id: string; parent: string; name: string; status: string; start: string; end: string; attributes: unknown };
export function parseTrace(value: any): TraceSpan[] {
  const resources = value.resourceSpans ?? value.data?.flatMap(row => row.otlp?.resourceSpans || []);
  if (!Array.isArray(resources) || JSON.stringify(value).length > 200000) throw new Error('Import a bounded OTLP resourceSpans payload or trace export page.');
  const spans: TraceSpan[] = resources.flatMap(resource => (resource.scopeSpans || []).flatMap(scope => (scope.spans || []).map(span => ({ id: span.spanId, parent: span.parentSpanId || '', name: span.name, status: span.status?.code === 2 ? 'error' : span.status?.code === 1 ? 'ok' : 'unset', start: String(span.startTimeUnixNano ?? ''), end: String(span.endTimeUnixNano ?? ''), attributes: span.attributes || [] }))));
  if (!spans.length || spans.length > 500 || spans.some(span => typeof span.id !== 'string' || typeof span.name !== 'string') || new Set(spans.map(span => span.id)).size !== spans.length) throw new Error('Invalid or duplicate spans.');
  return spans;
}
export function traceFixture(failed = false) { return { resourceSpans: [{ scopeSpans: [{ spans: [
  { spanId: 'session', name: 'Session', status: { code: 1 } }, { spanId: 'turn', parentSpanId: 'session', name: 'Turn 1', status: { code: failed ? 2 : 1 } },
  { spanId: 'generation', parentSpanId: 'turn', name: 'Generation', status: { code: 1 }, attributes: [{ key: 'purpose', value: { stringValue: 'Decide which source to read' } }] },
  { spanId: 'tool', parentSpanId: 'generation', name: 'Tool: read_release', status: { code: failed ? 2 : 1 }, attributes: [{ key: 'result', value: { stringValue: failed ? 'Source unavailable' : reviewSource } }] },
 ] }] }] }; }
export function retryDelay(status: number, attempt: number, retryAfter: string | null, safe: boolean, now = Date.now()) {
  if (!safe || attempt >= 3 || ![408, 429, 500, 502, 503, 504].includes(status)) return null;
  const header = retryAfter === null ? NaN : /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now;
  if (Number.isFinite(header) && header > 5000) return null; // Do not retry earlier than a long provider wait.
  return Math.max(250 * 2 ** attempt, Number.isFinite(header) ? Math.max(0, header) : 0);
}
export const hookProjectConfig = { hooks: { PostToolUse: [{ matcher: '^(apply_patch|Edit|Write)$', hooks: [{ type: 'command', command: 'node sandbox/lab45/validate-report.mjs', timeout: 10, statusMessage: 'Validate course report' }] }] } };
export const hookPluginConfig = { hooks: { PostToolUse: [{ matcher: '^(apply_patch|Edit|Write)$', hooks: [{ type: 'command', command: 'node "${PLUGIN_ROOT}/validate-report.mjs"', timeout: 10, statusMessage: 'Validate course report' }] }] } };

export function runOperationsSuite(lab: number) {
  const tests: Array<[string, () => boolean]> = [];
  const rejects = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };
  if (lab === 41) tests.push(['Child completion leaves root pending', () => replayProgress(progressEvents(), 6).root === 'unknown'], ['Child failure requests recovery, not root failure', () => progressDecision(replayProgress(progressEvents(true), 7)).includes('bounded recovery')], ['Root settles separately', () => replayProgress(progressEvents(true), 8).root === 'completed']);
  if (lab === 42) tests.push(['Review catches export regression', () => !reviewDraft(draftFixture)[1].passed], ['Revised writer output resolves all findings', () => reviewDraft(revisedFixture).every(row => row.passed)], ['Unsupported contact fails', () => !reviewDraft(revisedFixture.replace('support@example.test', 'other@example.test'))[2].passed]);
  if (lab === 43) tests.push(['Quality uses the same acceptance checks', () => compareRuns(comparisonFixture).rows[1].quality === 3], ['Mismatched task rejected', () => rejects(() => compareRuns([comparisonFixture[0], { ...comparisonFixture[1], task: 'Different' }]))], ['Unknown child usage remains unknown', () => compareRuns(comparisonFixture).rows[1].usage.total === null]);
  if (lab === 44) tests.push(['Idle is not a turn success notification', () => !webhookTypes.includes('agent.session.turn.completed')], ['Only supported session notifications accepted', () => webhookTypes.includes('agent.session.failed') && !webhookTypes.includes('agent.session.completed')]);
  if (lab === 45) tests.push(['Edit matcher is anchored', () => new RegExp(hookProjectConfig.hooks.PostToolUse[0].matcher).test('apply_patch') && !new RegExp(hookProjectConfig.hooks.PostToolUse[0].matcher).test('Bash')], ['Validation timeout is bounded', () => hookProjectConfig.hooks.PostToolUse[0].hooks[0].timeout === 10], ['Plugin resolves its own installation root', () => hookPluginConfig.hooks.PostToolUse[0].hooks[0].command.includes('${PLUGIN_ROOT}')]);
  if (lab === 46) tests.push(['Filter changes visible report rows', () => filterReport('needs-review').length === 1], ['Invalid filter rejected', () => rejects(() => filterReport('private'))], ['Extra tool arguments rejected', () => rejects(() => validateToolInput({ filter: 'all', url: 'private' }, ['filter']))]);
  if (lab === 47) tests.push(['Failed tool span remains visible', () => parseTrace(traceFixture(true)).find(row => row.id === 'tool')?.status === 'error'], ['Parent relationships retained', () => parseTrace(traceFixture()).find(row => row.id === 'generation')?.parent === 'turn'], ['Malformed export rejected', () => rejects(() => parseTrace({ data: [] }))]);
  if (lab === 48) tests.push(['Null usage is not zero', () => usageSummary(usageFixture).total === null], ['Known subtotal remains available', () => usageSummary(usageFixture).knownSubtotal === 120], ['Repeated turn snapshots replace, never add', () => usageSummary([usageFixture[0], usageFixture[0]]).total === 120], ['Negative counts rejected', () => rejects(() => parseUsage([{ ...usageFixture[0], usage: { input_tokens: -1, output_tokens: 2, total_tokens: 1 } }]))]);
  if (lab === 49) tests.push(['Transient read retries are bounded', () => retryDelay(429, 2, '1', true) === 1000 && retryDelay(429, 3, null, true) === null], ['Unsafe writes do not automatically retry', () => retryDelay(503, 0, null, false) === null], ['Long Retry-After ends this bounded request', () => retryDelay(429, 0, '60', true) === null], ['Authentication failures do not retry', () => retryDelay(401, 0, null, true) === null]);
  if (lab === 50) tests.push(['Opaque application IDs differ from provider IDs', () => !/^sess_/.test('app_random')], ['Ownership compares authenticated principal', () => ownsSession('alice', { owner: 'alice' }) && !ownsSession('bob', { owner: 'alice' })], ['Missing identity fails closed', () => !ownsSession('', { owner: 'alice' })]);
  return tests.map(([name, run]) => { try { return { name, passed: run() }; } catch { return { name, passed: false }; } });
}
export const webhookTypes: string[] = ['agent.session.created', 'agent.session.action_required', 'agent.session.in_progress', 'agent.session.idle', 'agent.session.failed'];
export function ownsSession(principal: string, session: { owner: string }) { return Boolean(principal && principal === session.owner); }
