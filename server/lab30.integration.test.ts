import { test } from 'node:test';
import assert from 'node:assert/strict';
import { practiceSnapshot } from '../src/lab30Cleanup.ts';
import { runCleanupSuite } from '../src/lab30Tests.ts';
import { executeCleanup, verifyCleanup, type CleanupApi } from './lab30Service.ts';

const decision = { stoppedInput: true, retainedOutputs: true, confirmation: practiceSnapshot.id };
function fake() {
  let calls = 0; let reads = 0;
  const api: CleanupApi = {
    inspect: async () => { reads++; return structuredClone(practiceSnapshot); },
    delete: async () => { calls++; return { deleted: true }; },
    retrieve: async () => { throw { status: 404 }; },
  };
  return { api, deletes: () => calls, reads: () => reads };
}
test('shared browser/server lifecycle policy', () => {
  for (const result of runCleanupSuite()) assert.equal(result.passed, true, result.name);
});
test('recheck state, delete, and verify 404', async () => {
  const state = fake();
  const result = await executeCleanup(state.api, practiceSnapshot, decision);
  assert.equal(state.reads(), 1); assert.equal(state.deletes(), 1);
  assert.equal(result.deleted, true); assert.equal(result.verification.verified, true);
});
test('409 bounded retries re-inspect before each attempt', async () => {
  const state = fake(); let attempts = 0; const delays: number[] = [];
  state.api.delete = async () => { if (++attempts < 3) throw { status: 409 }; return { deleted: true }; };
  const result = await executeCleanup(state.api, practiceSnapshot, decision, async ms => { delays.push(ms); });
  assert.equal(result.attempts, 3); assert.equal(state.reads(), 3); assert.deepEqual(delays, [500, 1000]);
});
test('permanent conflict stops at three attempts', async () => {
  const state = fake(); let attempts = 0;
  state.api.delete = async () => { attempts++; throw { status: 409 }; };
  await assert.rejects(executeCleanup(state.api, practiceSnapshot, decision, async () => {}));
  assert.equal(attempts, 3);
});
test('changed outputs block deletion', async () => {
  const state = fake(); state.api.inspect = async () => ({ ...practiceSnapshot, artifacts: [] });
  await assert.rejects(executeCleanup(state.api, practiceSnapshot, decision), /changed since inspection/);
  assert.equal(state.deletes(), 0);
});
test('active work appearing after a conflict stops further attempts', async () => {
  const state = fake(); let attempts = 0;
  state.api.delete = async () => { attempts++; throw { status: 409 }; };
  state.api.inspect = async () => ({ ...practiceSnapshot, status: attempts ? 'in_progress' : 'idle' });
  await assert.rejects(executeCleanup(state.api, practiceSnapshot, decision, async () => {}), /still active/);
  assert.equal(attempts, 1);
});
test('retention acknowledgement missing prevents any delete', async () => {
  const state = fake();
  await assert.rejects(executeCleanup(state.api, practiceSnapshot, { ...decision, retainedOutputs: false }), /Save needed outputs/);
  assert.equal(state.deletes(), 0);
});
test('403 verification preserves deletion confirmation without claiming absence', async () => {
  const state = fake(); state.api.retrieve = async () => { throw { status: 403 }; };
  const result = await executeCleanup(state.api, practiceSnapshot, decision);
  assert.equal(result.deleted, true); assert.equal(result.verification.verified, false);
  assert.match(result.verification.message, /inconclusive/);
});
test('unconfirmed deletion is an error', async () => {
  const state = fake(); state.api.delete = async () => ({ deleted: false });
  await assert.rejects(executeCleanup(state.api, practiceSnapshot, decision), /did not confirm/);
});
test('non-conflict errors are not retried', async () => {
  const state = fake(); let attempts = 0;
  state.api.delete = async () => { attempts++; throw { status: 401 }; };
  await assert.rejects(executeCleanup(state.api, practiceSnapshot, decision));
  assert.equal(attempts, 1);
});
test('successful retrieval and network failures do not verify absence', async () => {
  assert.equal((await verifyCleanup({ retrieve: async () => ({}) }, practiceSnapshot.id)).verified, false);
  assert.equal((await verifyCleanup({ retrieve: async () => { throw new Error('network'); } }, practiceSnapshot.id)).verified, false);
});
