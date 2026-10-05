import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runAdvancedSuite } from '../src/advancedLabTests.ts';
import { applyDelegationEvent, childOverlap, delegationPractice, newDelegationTrace, verifyDelegation } from '../src/lab39Delegation.ts';
import { createDelegationJob, executeDelegation, type DelegationApi } from './delegationService.ts';
import { handleDelegationLab } from './labs39to40.ts';
export function registerDelegationTests(lab: 39 | 40) {
  test(`shared Lab ${lab} suite passes`, () => { for (const row of runAdvancedSuite(lab)) assert.ok(row.passed, row.name); });
  test('child text and terminal events cannot settle or overwrite root output', () => {
    const trace = newDelegationTrace();
    applyDelegationEvent(trace, { type: 'agent.session.turn.in_progress', turn: { id: 'childTurn', subagent_id: 'child' } }, 1);
    applyDelegationEvent(trace, { type: 'agent.session.turn.output_text.done', turn_id: 'childTurn', item_id: 'childText', text: 'Must not become root answer' }, 2);
    applyDelegationEvent(trace, { type: 'agent.session.turn.failed', turn: { id: 'childTurn', subagent_id: 'child' } }, 3);
    assert.equal(trace.root, 'unknown'); assert.equal(trace.answer, '');
    applyDelegationEvent(trace, { type: 'agent.session.turn.in_progress', turn: { id: 'rootTurn', subagent_id: null } }, 4);
    applyDelegationEvent(trace, { type: 'agent.session.turn.item.done', item: { id: 'rootText', type: 'message', role: 'assistant', phase: 'final_answer', turn_id: 'rootTurn', content: [{ text: 'Root answer' }] } }, 5);
    assert.equal(trace.answer, 'Root answer');
  });
  test('valid root claims without observed child messages cannot verify the returned contract', () => { const trace = delegationPractice(lab, 'success'); trace.items = trace.items.filter(row => !row.id.startsWith('childMessage')); assert.ok(verifyDelegation(trace, lab, false).some(row => !row.passed)); });
  test('worker waits through child outcomes, merges saved history and cleans up', async () => {
    const practice = delegationPractice(lab, 'success'); const calls: string[] = []; const job = createDelegationJob('test', lab, true, false);
    const api: DelegationApi = {
      create: async request => { assert.equal((request.agent.multi_agent as any).max_concurrent_subagents, lab === 39 ? 1 : 2); return { async *[Symbol.asyncIterator]() { yield { type: 'agent.session.created', session: { id: 'sess_delegation' } }; yield { type: 'agent.session.turn.in_progress', turn: { id: 'root', subagent_id: null } }; for (const child of practice.children) yield { type: 'agent.session.subagent.created', subagent: { id: child } }; for (const [id, turn] of Object.entries(practice.turns)) if (turn.child) yield { type: 'agent.session.turn.in_progress', turn: { id, subagent_id: turn.child } }; await new Promise(resolve => setTimeout(resolve, 5)); for (const [id, turn] of Object.entries(practice.turns)) if (turn.child) yield { type: 'agent.session.turn.completed', turn: { id, subagent_id: turn.child } }; yield { type: 'agent.session.turn.completed', turn: { id: 'root', subagent_id: null } }; } }; },
      inspect: async () => ({ turns: Object.entries(practice.turns).map(([id, turn]) => ({ id, subagent_id: turn.child, status: turn.status })), items: practice.items, children: practice.children.map(id => ({ id })) }), cancel: async () => { calls.push('cancel'); }, delete: async () => { calls.push('delete'); },
    };
    await executeDelegation(job, api, 'test-model', new AbortController()); assert.equal(job.trace.root, 'completed'); assert.equal(job.trace.answer, practice.answer); for (const check of verifyDelegation(job.trace, lab, false)) assert.ok(check.passed, check.name); assert.deepEqual(calls, ['delete']);
  });
  test('premature stream end remains unknown and attempts cancellation plus deletion', async () => { const job = createDelegationJob('test', lab, true, false); const calls: string[] = []; const api: DelegationApi = { create: async () => ({ async *[Symbol.asyncIterator]() { yield { type: 'agent.session.created', session: { id: 'sess_unknown' } }; } }), inspect: async () => ({ turns: [], items: [], children: [] }), cancel: async () => { calls.push('cancel'); }, delete: async () => { calls.push('delete'); } }; await executeDelegation(job, api, 'test', new AbortController()); assert.equal(job.trace.root, 'unknown'); assert.equal(job.trace.cleanup, 'deleted'); assert.deepEqual(calls, ['cancel', 'delete']); });
  test('deletion failure is retained for a separate cleanup retry', async () => { const job = createDelegationJob('test', lab, false, false); const api: DelegationApi = { create: async () => ({ async *[Symbol.asyncIterator]() { yield { type: 'agent.session.created', session: { id: 'sess_cleanup' } }; yield { type: 'agent.session.turn.completed', turn: { id: 'root', subagent_id: null } }; } }), inspect: async () => ({ turns: [], items: [], children: [] }), cancel: async () => {}, delete: async () => { throw new Error('delete failed'); } }; await executeDelegation(job, api, 'test', new AbortController()); assert.equal(job.trace.root, 'completed'); assert.equal(job.trace.cleanup, 'failed'); assert.equal(job.status, 'finished'); });
  test('fixed HTTP options reject tool, model, source and concurrency overrides', async () => {
    const server = createServer((request, response) => { void handleDelegationLab(request, response, new URL(request.url!, 'http://localhost').pathname, lab); }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${(server.address() as any).port}/api/lab${lab}`;
    try { assert.ok((await (await fetch(`${base}/test`, { method: 'POST' })).json()).results.every((row: any) => row.passed)); for (const override of [{ tools: [] }, { model: 'other' }, { sources: {} }, { max_concurrent_subagents: 100 }]) assert.equal((await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ requestId: 'a'.repeat(20), enabled: true, failure: false, ...override }) })).status, 400); assert.equal((await fetch(`${base}/status`, { headers: { Origin: 'https://external.test' } })).status, 403); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  if (lab === 40) test('failed child preserves an explicitly incomplete root; sequential work cannot pass as parallel', () => { const failed = delegationPractice(40, 'child-failed'); assert.equal(failed.root, 'completed'); assert.ok(Object.values(failed.turns).some(turn => turn.child && turn.status === 'failed')); assert.ok(verifyDelegation(failed, 40, true).every(row => row.passed)); assert.equal(childOverlap(delegationPractice(40, 'sequential')), false); });
}
