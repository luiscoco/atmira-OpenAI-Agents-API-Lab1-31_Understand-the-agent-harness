import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewNativeHookEvidence, parseEvidenceLines } from '../src/nativeHookEvidence.ts';
import { reviewWebMcpEvidence } from '../src/lab46Evidence.ts';
import { registerPageTools } from '../src/lab46Registration.ts';
import { HookNotificationCapture, selectHookNotification } from '../src/nativeHookCapture.ts';

const config = 'C:/course/.codex/hooks.json', report = 'C:/course/report.md';
function hookFixture() {
  const ledger = [false, true].map((passed, index) => ({ recordedAt: new Date(10000 + index * 1000).toISOString(), event: 'PostToolUse', tool: 'apply_patch', sessionId: 'thread', turnId: `turn-${index}`, toolUseId: `edit-${index}`, passed }));
  const notifications = ledger.flatMap((row, index) => [
    { method: 'item/completed', params: { threadId: row.sessionId, turnId: row.turnId, item: { type: 'fileChange', id: row.toolUseId, status: 'completed', changes: [{ path: report }] } } },
    { method: 'hook/completed', params: { threadId: row.sessionId, turnId: row.turnId, run: { id: `hook-${index}`, eventName: 'postToolUse', source: 'project', sourcePath: config, handlerType: 'command', executionMode: 'sync', startedAt: 9999 + index * 1000, completedAt: 10001 + index * 1000, status: row.passed ? 'completed' : 'blocked', entries: [{ kind: 'feedback', text: row.passed ? 'Report validation passed: header and total.' : 'Report must contain the Release report header and Total: 2800.' }] } } },
  ]);
  return { ledger, notifications };
}
test('Hook review correlates both outcomes with the same thread, turn, edit, project config and time interval', () => {
  const { ledger, notifications } = hookFixture();
  assert.equal(reviewNativeHookEvidence(ledger, notifications, config, report).outcome, 'consistent');
  assert.equal(reviewNativeHookEvidence(ledger, [], config, report).outcome, 'incomplete');
  assert.equal(reviewNativeHookEvidence(ledger, [{ method: 'hook/completed' }], config, report).outcome, 'incomplete');
  const malformed: any = structuredClone(notifications); malformed[1].params.run.entries = {};
  assert.equal(reviewNativeHookEvidence(ledger, malformed, config, report).failureObserved, false);
  for (const field of ['threadId', 'turnId']) {
    const wrong = structuredClone(notifications); wrong[1].params[field] = 'foreign';
    assert.equal(reviewNativeHookEvidence(ledger, wrong, config, report).failureObserved, false);
  }
  for (const [field, value] of [['sourcePath', '/other/hooks.json'], ['source', 'user'], ['executionMode', 'async'], ['completedAt', 100], ['status', 'running']]) {
    const wrong = structuredClone(notifications); wrong[1].params.run[field] = value;
    assert.equal(reviewNativeHookEvidence(ledger, wrong, config, report).failureObserved, false);
  }
  assert.equal(reviewNativeHookEvidence([...ledger, ledger[0]], notifications, config, report).observations.at(-1)?.matched, false);
  assert.throws(() => parseEvidenceLines('x'));
  assert.throws(() => parseEvidenceLines(' '.repeat(2000001)));
});
const names = ['lab46_read_report', 'lab46_set_filter'];
test('Hook capture preserves verifier metadata while excluding prompts, diffs, secrets and foreign projects', () => {
  const { ledger, notifications } = hookFixture();
  const raw: any[] = structuredClone(notifications);
  raw[0].params.item.changes[0].diff = 'PRIVATE-DIFF';
  raw[1].params.run.command = 'PRIVATE-COMMAND';
  raw[1].params.run.entries[0].text += ' PRIVATE-SECRET';
  raw.unshift({ method: 'item/completed', params: { threadId: 'thread', turnId: 'turn-0', item: { type: 'userMessage', content: 'PRIVATE-PROMPT' } } });
  raw.push({ method: 'hook/completed', params: { ...notifications[1].params, run: { ...notifications[1].params.run, sourcePath: '/foreign/hooks.json' } } });
  const lines: string[] = [];
  const capture = new HookNotificationCapture(config, report, line => lines.push(line), () => assert.fail('Unexpected limit'));
  const wire = Buffer.from(raw.map(row => JSON.stringify(row)).join('\n') + '\n');
  for (let index = 0; index < wire.length; index += 17) capture.push(wire.subarray(index, index + 17));
  capture.finish();
  assert.equal(lines.length, 4);
  assert.equal(lines.join('').includes('PRIVATE-'), false);
  assert.equal(reviewNativeHookEvidence(ledger, parseEvidenceLines(lines.join('')), config, report).outcome, 'consistent');
  assert.equal(selectHookNotification({ ...notifications[0], id: 1 }, config, report), null);
});
test('Hook capture drops an oversized transport line and resumes on the next notification', () => {
  const lines: string[] = []; let warnings = 0;
  const capture = new HookNotificationCapture(config, report, line => lines.push(line), () => warnings++);
  capture.push(Buffer.from('x'.repeat(4000001)));
  capture.push(Buffer.from('\n' + JSON.stringify(hookFixture().notifications[0]) + '\n'));
  capture.finish();
  assert.equal(warnings, 1); assert.equal(lines.length, 1);
});
function browserCalls(source = 'Native WebMCP execute') {
  return [
    { name: names[0], args: {}, source, lifetime: 1, output: { filter: 'all', rows: [{ name: 'Search', status: 'complete' }, { name: 'Export', status: 'needs-review' }] } },
    { name: names[1], args: { filter: 'needs-review' }, source, lifetime: 1, output: { filter: 'needs-review', rows: [{ name: 'Export', status: 'needs-review' }] } },
    { name: names[0], args: {}, source, lifetime: 1, output: { filter: 'needs-review', rows: [{ name: 'Export', status: 'needs-review' }] } },
  ];
}
test('WebMCP checkpoint requires native read, filter, reread and successful removal in one registration lifetime', () => {
  const lifecycle = [{ lifetime: 1, state: 'registered' as const, names }, { lifetime: 1, state: 'closed' as const, names }];
  assert.equal(reviewWebMcpEvidence(browserCalls(), lifecycle).outcome, 'observed-page-checks');
  assert.equal(reviewWebMcpEvidence(browserCalls('Local demo button'), lifecycle).outcome, 'incomplete');
  assert.equal(reviewWebMcpEvidence(browserCalls(), lifecycle.slice(0, 1)).outcome, 'incomplete');
  const mixed = browserCalls(); mixed[2].lifetime = 2;
  assert.equal(reviewWebMcpEvidence(mixed, lifecycle).outcome, 'incomplete');
  const wrong = browserCalls(); wrong[2].output.filter = 'all';
  assert.equal(reviewWebMcpEvidence(wrong, lifecycle).outcome, 'incomplete');
});
test('Registration lifecycle records only successfully removed tools when cleanup partially fails', async () => {
  const events: any[] = []; let ready: () => void; const registered = new Promise<void>(resolve => { ready = resolve; });
  const context = { registerTool: async () => {}, unregisterTool: async (name: string) => { if (name === names[1]) throw new Error('Removal failed'); } };
  const handle = registerPageTools(context, names.map(name => ({ name })), () => ready(), event => events.push(event));
  await registered; handle.close(); await handle.ready;
  assert.deepEqual(events, [{ state: 'registered', names }, { state: 'closed', names: [names[0]] }]);
});
