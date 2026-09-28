// Lab 20: the approval rules, tested. Every case builds a fresh engine and walks through one scenario with the same
// propose / decide functions the server uses. No API key and no network.
import { cancelTool, createEngine, decide, expiryChoices, listTool, propose, rescheduleTool, settle, simulateEdit, type AuditEntry, type Context, type Engine, type StudyEvent } from './lab20Approval.ts';
import type { ToolCall } from './lab16Tool.ts';

export type TestGroup = 'ask' | 'decide' | 'guard';
export type RuleTest = { id: string; label: string; group: TestGroup; expect: string; note: string };
export type RuleResult = { id: string; got: string; pass: boolean; detail: string; audit: AuditEntry[]; event: StudyEvent | null; result: { success: boolean; output: string | null; error: string | null } | null };

const today = '2026-10-05';
const ctx = (extra: Partial<Context> = {}): Context => ({ sessionId: 'sess_test', turnId: 'turn_test', mode: 'ask', now: 1_000, expiryMs: expiryChoices.normal, today, ...extra });
const call = (name: string, args: unknown, id = 'call_1'): ToolCall => ({ callId: id, name, turnId: 'turn_test', itemId: null, status: null, arguments: args });
const move = (extra: Record<string, unknown> = {}, id?: string) => call(rescheduleTool.name, { event_id: 'evt_review_19', new_date: '2026-10-09', new_start: '17:00', reason: 'The user asked to move it to Friday.', ...extra }, id);
const eventOf = (engine: Engine, id = 'evt_review_19') => engine.planner.events.find((item) => item.id === id) ?? null;

type Scenario = (engine: Engine) => Promise<{ got: string; detail: string; result?: RuleResult['result']; eventId?: string }>;
const cases: Array<RuleTest & { scenario: Scenario }> = [];
const test = (id: string, label: string, group: TestGroup, expect: string, note: string, scenario: Scenario) => cases.push({ id, label, group, expect, note, scenario });

// Proposing a call
test('read', 'A read runs at once', 'ask', 'ran', 'list_study_events never waits for a person.', async (engine) => {
  const proposal = await propose(engine, call(listTool.name, {}), ctx());
  return { got: proposal.kind, detail: `${JSON.parse(proposal.result?.output ?? '{}').events?.length ?? 0} events returned`, result: proposal.result };
});
test('write-asks', 'A valid move waits', 'ask', 'asked', 'The planner is untouched until someone decides.', async (engine) => {
  const proposal = await propose(engine, move(), ctx());
  return { got: proposal.kind, detail: `planner still v${eventOf(engine)?.version}; preview: ${proposal.approval?.preview.summary ?? '—'}` };
});
test('conflict', 'A clash is shown, not hidden', 'ask', 'asked', 'Moving onto the study group asks, with a warning in the preview.', async (engine) => {
  const proposal = await propose(engine, move({ new_date: '2026-10-09', new_start: '19:30' }), ctx());
  return { got: proposal.kind, detail: proposal.approval?.preview.warnings.join(' ') || 'no warning' };
});
test('bad-date', 'An impossible date', 'ask', 'invalid', '2026-02-30 is refused before anyone is asked.', async (engine) => {
  const proposal = await propose(engine, move({ new_date: '2026-02-30' }), ctx());
  return { got: proposal.kind, detail: proposal.result?.error ?? '', result: proposal.result };
});
test('locked', 'A staff event', 'ask', 'invalid', 'The live Q&A is not the student’s to move.', async (engine) => {
  const proposal = await propose(engine, move({ event_id: 'evt_live_qna' }), ctx());
  return { got: proposal.kind, detail: proposal.result?.error ?? '', result: proposal.result };
});
test('night', 'Outside study hours', 'ask', 'invalid', 'A 23:30 start is refused.', async (engine) => {
  const proposal = await propose(engine, move({ new_start: '23:30' }), ctx());
  return { got: proposal.kind, detail: proposal.result?.error ?? '', result: proposal.result };
});
test('auto', 'Auto policy', 'ask', 'auto', 'For comparison only: the change runs with nobody asked.', async (engine) => {
  const proposal = await propose(engine, move(), ctx({ mode: 'auto' }));
  return { got: proposal.kind, detail: `planner now v${eventOf(engine)?.version} at ${eventOf(engine)?.date} ${eventOf(engine)?.start}`, result: proposal.result };
});

// Deciding
test('approve', 'Approve', 'decide', 'executed', 'The stored arguments run, the version goes up, and the agent is told “done”.', async (engine) => {
  const proposal = await propose(engine, move(), ctx());
  const decided = await decide(engine, { callId: 'call_1', sessionId: 'sess_test', decision: 'approve', digest: proposal.approval?.digest ?? '' }, 2_000);
  return { got: decided.kind, detail: `planner v${eventOf(engine)?.version} at ${eventOf(engine)?.date} ${eventOf(engine)?.start}`, result: 'result' in decided ? decided.result : null };
});
test('reject', 'Reject with a reason', 'decide', 'rejected', 'Nothing runs; the student’s reason reaches the agent.', async (engine) => {
  const proposal = await propose(engine, move(), ctx());
  const decided = await decide(engine, { callId: 'call_1', sessionId: 'sess_test', decision: 'reject', digest: proposal.approval?.digest ?? '', reason: 'I have football on Friday.' }, 2_000);
  return { got: decided.kind, detail: `planner still v${eventOf(engine)?.version}`, result: 'result' in decided ? decided.result : null };
});
test('cancel', 'Approve a cancellation', 'decide', 'executed', 'High risk, same rules. The event is marked cancelled, not deleted.', async (engine) => {
  const proposal = await propose(engine, call(cancelTool.name, { event_id: 'evt_study_group', reason: 'The user is ill.' }), ctx());
  const decided = await decide(engine, { callId: 'call_1', sessionId: 'sess_test', decision: 'approve', digest: proposal.approval?.digest ?? '' }, 2_000);
  return { got: decided.kind, detail: `status ${eventOf(engine, 'evt_study_group')?.status} · risk ${proposal.approval?.preview.risk}`, result: 'result' in decided ? decided.result : null, eventId: 'evt_study_group' };
});
test('batch', 'Two changes in one pause', 'decide', 'sent 2 together', 'The first decision is held; both results go to the agent after the second.', async (engine) => {
  const first = await propose(engine, move(), ctx());
  const second = await propose(engine, call(cancelTool.name, { event_id: 'evt_study_group', reason: 'The user is ill.' }, 'call_2'), ctx());
  const batch = { turnId: 'turn_test', results: [], waitingFor: new Set(['call_1', 'call_2']) };
  const one = await decide(engine, { callId: 'call_1', sessionId: 'sess_test', decision: 'approve', digest: first.approval?.digest ?? '' }, 2_000);
  const held = 'result' in one ? settle(batch, one.result) : null;
  const two = await decide(engine, { callId: 'call_2', sessionId: 'sess_test', decision: 'reject', digest: second.approval?.digest ?? '', reason: 'Keep the group.' }, 2_100);
  const sent = 'result' in two ? settle(batch, two.result) : null;
  return { got: held === null && sent ? `sent ${sent.length} together` : `held ${held?.length ?? 0}, sent ${sent?.length ?? 0}`, detail: `after 1st decision: held · after 2nd: ${sent?.map((item) => `${item.name} ${item.success ? 'done' : 'rejected'}`).join(', ') ?? '—'}` };
});

// Guards at decision time
test('twice', 'Approve twice', 'guard', 'already_decided', 'A double click or a replay never runs the change again.', async (engine) => {
  const proposal = await propose(engine, move(), ctx());
  const input = { callId: 'call_1', sessionId: 'sess_test', decision: 'approve' as const, digest: proposal.approval?.digest ?? '' };
  await decide(engine, input, 2_000);
  const second = await decide(engine, input, 2_100);
  return { got: second.kind, detail: `planner v${eventOf(engine)?.version} (changed once)` };
});
test('expired', 'Approve too late', 'guard', 'expired', 'After the window closes, approval no longer counts.', async (engine) => {
  const proposal = await propose(engine, move(), ctx({ expiryMs: expiryChoices.short }));
  const decided = await decide(engine, { callId: 'call_1', sessionId: 'sess_test', decision: 'approve', digest: proposal.approval?.digest ?? '' }, 1_000 + expiryChoices.short + 1);
  return { got: decided.kind, detail: `planner still v${eventOf(engine)?.version}`, result: 'result' in decided ? decided.result : null };
});
test('stale', 'Approve after someone else edits', 'guard', 'stale', 'The event is re-checked at execution time; the old approval does not apply.', async (engine) => {
  const proposal = await propose(engine, move(), ctx());
  simulateEdit(engine, 'evt_review_19', 'sess_test', 1_500);
  const decided = await decide(engine, { callId: 'call_1', sessionId: 'sess_test', decision: 'approve', digest: proposal.approval?.digest ?? '' }, 2_000);
  return { got: decided.kind, detail: `planner v${eventOf(engine)?.version} at ${eventOf(engine)?.start} (the other edit stands)`, result: 'result' in decided ? decided.result : null };
});
test('tampered', 'Approve a different change', 'guard', 'tampered', 'The digest does not match what was shown, so nothing runs and it stays pending.', async (engine) => {
  await propose(engine, move(), ctx());
  const decided = await decide(engine, { callId: 'call_1', sessionId: 'sess_test', decision: 'approve', digest: 'f'.repeat(64) }, 2_000);
  return { got: decided.kind, detail: `approval ${engine.approvals.get('call_1')?.status}; planner v${eventOf(engine)?.version}` };
});
test('other-session', 'Approve from another session', 'guard', 'unknown', 'An approval belongs to one session.', async (engine) => {
  const proposal = await propose(engine, move(), ctx());
  const decided = await decide(engine, { callId: 'call_1', sessionId: 'sess_other', decision: 'approve', digest: proposal.approval?.digest ?? '' }, 2_000);
  return { got: decided.kind, detail: `approval ${engine.approvals.get('call_1')?.status}` };
});

export const ruleTests: RuleTest[] = cases.map(({ scenario: _scenario, ...item }) => item);

export async function runRuleTest(id: string): Promise<RuleResult> {
  const item = cases.find((entry) => entry.id === id);
  if (!item) throw new Error(`Unknown test ${id}.`);
  const engine = createEngine(today);
  const outcome = await item.scenario(engine);
  return { id, got: outcome.got, pass: outcome.got === item.expect, detail: outcome.detail, audit: engine.audit, event: eventOf(engine, outcome.eventId), result: outcome.result ?? null };
}
export const runRuleSuite = () => Promise.all(cases.map((item) => runRuleTest(item.id)));
