import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectHarness, readPages, type InspectionApi } from './lab31Service.ts';
import { runHarnessSuite } from '../src/lab31Tests.ts';
import { parseTrace, traceOutcome } from '../src/lab31Harness.ts';
function fake(): InspectionApi {
  return {
    retrieve: async id => ({ id, status: 'idle', agent: { secret: 'must_not_forward' }, environment: { type: 'openai_hosted' } }),
    turns: async () => ({ data: [{ id: 'turn_root', status: 'completed', subagent_id: null }], has_more: false }),
    items: async () => ({ data: [{ id: 'item_command', type: 'command_execution', turn_id: 'turn_root', command: 'printf hello', exit_code: 0, output: 'must_not_forward' }], has_more: false }),
  };
}
test('shared browser/server ownership cases', () => {
  for (const result of runHarnessSuite()) assert.equal(result.passed, true, result.name);
});
test('real inspection service projects a completed saved trace without secret configuration', async () => {
  const trace = await inspectHarness(fake(), 'sess_test');
  assert.equal(trace.source, 'live saved state'); assert.equal(traceOutcome(trace.steps), 'completed');
  assert.equal(trace.steps.find(step => step.kind === 'command')?.detail, 'Command: printf hello\nExit code: 0');
  assert.equal(JSON.stringify(trace).includes('must_not_forward'), false);
  assert.deepEqual(parseTrace(trace, 'live saved state'), trace);
});
test('pagination sends the final ID as cursor and reads the next page', async () => {
  const cursors: Array<string | undefined> = [];
  const result = await readPages(async after => { cursors.push(after); return after ? { data: [{ id: 'second' }], has_more: false } : { data: [{ id: 'first' }], has_more: true }; });
  assert.deepEqual(cursors, [undefined, 'first']); assert.equal(result.complete, true); assert.equal(result.data.length, 2);
});
test('five-page limit reports an incomplete inventory', async () => {
  let calls = 0;
  const result = await readPages(async () => ({ data: [{ id: `item_${++calls}` }], has_more: true }));
  assert.equal(calls, 5); assert.equal(result.complete, false);
});
test('repeated or empty cursors cannot loop forever', async () => {
  let calls = 0;
  const result = await readPages(async () => { calls++; return { data: [{ id: 'same' }], has_more: true }; });
  assert.equal(calls, 2); assert.equal(result.complete, false);
  assert.equal(result.data.length, 1);
  assert.equal((await readPages(async () => ({ data: [], has_more: true }))).complete, false);
});
test('invalid session ID is rejected before any API read', async () => {
  const api = fake(); let calls = 0; api.retrieve = async () => { calls++; return {}; };
  await assert.rejects(inspectHarness(api, '../private')); assert.equal(calls, 0);
});
test('returned session mismatch is refused', async () => {
  const api = fake(); api.retrieve = async () => ({ id: 'sess_other', environment: { type: 'none' } });
  await assert.rejects(inspectHarness(api, 'sess_test'), /different session/);
});
test('child status does not claim root completion', async () => {
  const api = fake(); api.turns = async () => ({ data: [{ id: 'turn_root', status: 'in_progress', subagent_id: null }, { id: 'turn_child', status: 'completed', subagent_id: 'child_1' }], has_more: false });
  assert.equal(traceOutcome((await inspectHarness(api, 'sess_test')).steps), 'in_progress');
});
test('later root progress supersedes earlier completion', async () => {
  const api = fake(); api.turns = async () => ({ data: [{ id: 'old', status: 'completed', subagent_id: null }, { id: 'new', status: 'waiting', subagent_id: null }], has_more: false });
  assert.equal(traceOutcome((await inspectHarness(api, 'sess_test')).steps), 'waiting');
});
test('read failures propagate rather than manufacturing successful evidence', async () => {
  const api = fake(); api.items = async () => { throw new Error('Read denied'); };
  await assert.rejects(inspectHarness(api, 'sess_test'), /Read denied/);
});
test('maximum saved-state projection remains importable and marks omitted items', async () => {
  const api = fake();
  api.turns = async (_id, after) => {
    const start = after ? Number(after.slice(5)) + 1 : 0;
    return { data: Array.from({ length: 100 }, (_, index) => ({ id: `turn_${start + index}`, status: 'completed', subagent_id: null })), has_more: start < 400 };
  };
  api.items = async (_id, after) => {
    const start = after ? Number(after.slice(5)) + 1 : 0;
    return { data: Array.from({ length: 100 }, (_, index) => ({ id: `item_${start + index}`, type: 'message', role: 'assistant' })), has_more: start < 400 };
  };
  const trace = await inspectHarness(api, 'sess_test');
  assert.equal(trace.steps.length, 1000); assert.equal(trace.complete, false);
  assert.doesNotThrow(() => parseTrace(trace));
});
