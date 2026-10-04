import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExecutorJob, executeListing, publicExecutorJob, retryExecutorCleanup, type ExecutorApi } from './lab32Service.ts';
import { executorArgs, validContainerName, type ExecutorProvider } from './lab32Docker.ts';
import { localExecutorRequest } from './lab32.ts';
import { runExecutorSuite } from '../src/lab32Tests.ts';
import { fixtureFiles, verifyListing } from '../src/lab32Environment.ts';

function setup(events: Record<string, any>[] = []) {
  const calls: string[] = []; const job = createExecutorJob('test-job'); const controller = new AbortController();
  const api: ExecutorApi = {
    create: async () => { calls.push('create'); return { id: 'sess_test', environment: { type: 'self_hosted', id: 'env_test', remote_url: 'wss://codex-cloud-environments.chatgpt.com/test', workspace_directory: '/workspace' } }; },
    stream: async () => { calls.push('subscribe'); return { async *[Symbol.asyncIterator]() { for (const event of events) yield event; } }; },
    input: async () => { calls.push('input'); }, cancel: async () => { calls.push('cancel'); }, delete: async () => { calls.push('delete'); },
  };
  const provider: ExecutorProvider = { preflight: async () => { calls.push('preflight'); }, start: async () => { calls.push('start'); }, remove: async () => { calls.push('remove'); } };
  return { calls, job, controller, api, provider, run: (limits?: { runMs: number; connectMs: number }) => executeListing(job, api, provider, controller, limits) };
}
const connected = { type: 'agent.session.environment.connected', event_id: 'evt_connected' };
const complete = { type: 'agent.session.turn.completed', turn: { id: 'turn_test', subagent_id: null }, event_id: 'evt_complete' };

test('shared browser/server rule suite passes', () => {
  for (const row of runExecutorSuite()) assert.equal(row.passed, true, row.name);
});
test('subscribes before compute; repeated connected events submit one input', async () => {
  const fixture = setup([connected, connected, { ...connected, event_id: 'evt_connected_again' }, complete]);
  await fixture.run();
  assert.deepEqual(fixture.calls, ['preflight', 'create', 'subscribe', 'start', 'input', 'remove', 'delete']);
  assert.equal(fixture.job.trace.outcome, 'completed'); assert.equal(fixture.job.trace.cleanup, 'removed');
});
test('command evidence and split final text verify exact fixture', async () => {
  const fixture = setup(); const files = fixtureFiles(fixture.job.trace.nonce); const answer = JSON.stringify({ files, nonce: fixture.job.trace.nonce });
  fixture.api.stream = async () => ({ async *[Symbol.asyncIterator]() {
    yield connected;
    yield { type: 'agent.session.turn.item.done', item: { type: 'command_execution', id: 'cmd_test', command: 'find . -type f; cat run-*.txt', cwd: '/workspace', exit_code: 0, output: files.join('\n') + '\n' + fixture.job.trace.nonce } };
    yield { type: 'agent.session.turn.output_text.delta', item_id: 'msg_test', content_index: 0, delta: answer.slice(0, 20) };
    yield { type: 'agent.session.turn.output_text.delta', item_id: 'msg_test', content_index: 0, delta: answer.slice(20) };
    yield { type: 'agent.session.turn.output_text.done', item_id: 'msg_test', content_index: 0, text: answer };
    yield complete;
  } });
  await fixture.run(); assert.ok(verifyListing(fixture.job.trace).every(row => row.passed));
});
test('child completion cannot settle a root turn', async () => {
  const fixture = setup([connected, { type: complete.type, turn: { id: 'turn_child', subagent_id: 'subagent_test' } }]);
  await fixture.run(); assert.equal(fixture.job.trace.outcome, 'unknown'); assert.ok(fixture.calls.includes('cancel'));
});
test('completed assistant message provides evidence when text deltas are absent', async () => {
  const fixture = setup(); const answer = JSON.stringify({ files: fixtureFiles(fixture.job.trace.nonce), nonce: fixture.job.trace.nonce });
  fixture.api.stream = async () => ({ async *[Symbol.asyncIterator]() {
    yield connected;
    yield { type: 'agent.session.turn.item.done', item: { id: 'msg_complete', type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: answer }] } };
    yield complete;
  } });
  await fixture.run(); assert.equal(fixture.job.trace.answer, answer);
});
test('environment failure cannot manufacture a failed root-turn outcome', async () => {
  const fixture = setup([{ type: 'agent.session.environment.failed' }]);
  await fixture.run(); assert.equal(fixture.job.trace.connection, 'failed'); assert.equal(fixture.job.trace.outcome, 'unknown'); assert.ok(!fixture.calls.includes('input')); assert.equal(fixture.job.trace.cleanup, 'removed');
});
test('hosted ready does not submit self-hosted input', async () => {
  const fixture = setup([{ type: 'agent.session.environment.ready' }]);
  await fixture.run(); assert.ok(!fixture.calls.includes('input')); assert.equal(fixture.job.trace.outcome, 'unknown');
});
test('preflight failure creates neither session nor compute', async () => {
  const fixture = setup(); fixture.provider.preflight = async () => { throw new Error('no docker'); };
  await fixture.run(); assert.deepEqual(fixture.calls, []); assert.equal(fixture.job.status, 'finished');
});
test('launcher failure still removes its recorded target and API session', async () => {
  const fixture = setup(); fixture.provider.start = async () => { throw new Error('launcher failed after creation'); };
  await fixture.run(); assert.ok(fixture.calls.includes('remove')); assert.ok(fixture.calls.includes('delete'));
});
test('input failure preserves unknown and attempts cancel plus compute removal', async () => {
  const fixture = setup([connected]); fixture.api.input = async () => { throw new Error('input not accepted'); };
  await fixture.run(); assert.equal(fixture.job.trace.inputSent, false); assert.equal(fixture.job.trace.outcome, 'unknown'); assert.ok(fixture.calls.includes('cancel')); assert.ok(fixture.calls.includes('remove'));
});
test('disconnect never resubmits input', async () => {
  const fixture = setup([connected, { type: 'agent.session.environment.disconnected' }, connected]);
  await fixture.run(); assert.equal(fixture.calls.filter(call => call === 'input').length, 1); assert.equal(fixture.job.trace.outcome, 'unknown');
});
test('deadline interrupts an unresponsive iterator and cleans up', async () => {
  const fixture = setup(); fixture.api.stream = async () => ({ [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; } });
  await fixture.run({ runMs: 20, connectMs: 10 }); assert.equal(fixture.job.status, 'finished'); assert.equal(fixture.job.trace.cleanup, 'removed');
});
test('cleanup failures can be retried without executing the task again', async () => {
  const fixture = setup([connected, complete]); let removeCount = 0;
  fixture.provider.remove = async () => { removeCount++; if (removeCount === 1) throw new Error('daemon down'); };
  await fixture.run(); assert.equal(fixture.job.trace.cleanup, 'failed');
  await retryExecutorCleanup(fixture.job, fixture.api, fixture.provider);
  assert.equal(fixture.job.trace.cleanup, 'removed'); assert.equal(fixture.calls.filter(call => call === 'input').length, 1);
});
test('session deletion failure is tracked independently', async () => {
  const fixture = setup([connected, complete]); fixture.api.delete = async () => { throw new Error('API unavailable'); };
  await fixture.run(); assert.equal(fixture.job.trace.cleanup, 'removed'); assert.equal(fixture.job.sessionCleanup, 'failed');
});
test('public evidence removes exact keys across split output', () => {
  const fixture = setup(); fixture.job.trace.answer = 'before restricted-secret after'; fixture.job.trace.commands.push({ id: 'cmd', command: 'echo application-secret', output: 'restricted-secret', cwd: null, exitCode: 0, durationMs: null, status: null });
  const text = JSON.stringify(publicExecutorJob(fixture.job, ['restricted-secret', 'application-secret']));
  assert.ok(!text.includes('restricted-secret')); assert.ok(!text.includes('application-secret')); assert.ok(text.includes('[redacted]'));
});
test('Docker arguments have no mounts, host network, privileged mode, or key value', () => {
  const fixture = setup(); const args = executorArgs({ name: fixture.job.containerName, nonce: fixture.job.trace.nonce, environmentId: 'env_test', remoteUrl: 'wss://codex-cloud-environments.chatgpt.com/test?x=1' });
  for (const prohibited of ['--privileged', '--mount', '-v', '--network=host', 'OPENAI_API_KEY']) assert.ok(!args.includes(prohibited));
  assert.ok(args.includes('--read-only')); assert.ok(args.includes('CODEX_API_KEY')); assert.ok(validContainerName(fixture.job.containerName));
});
test('executor rejects shell-shaped names and unexpected connection endpoints', () => {
  const base = { name: 'agents-lab32-' + 'a'.repeat(32), nonce: 'a'.repeat(16), environmentId: 'env_test', remoteUrl: 'wss://codex-cloud-environments.chatgpt.com/test' };
  assert.throws(() => executorArgs({ ...base, name: 'other-container' }));
  for (const remoteUrl of ['ws://codex-cloud-environments.chatgpt.com/test', 'wss://evil.test', 'wss://codex-cloud-environments.chatgpt.com.evil.test']) assert.throws(() => executorArgs({ ...base, remoteUrl }));
});
test('executor routes enforce localhost and same-origin access', () => {
  const local = { headers: { host: 'localhost:5173', origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' }, socket: { remoteAddress: '127.0.0.1' } } as any;
  assert.equal(localExecutorRequest(local), true);
  assert.equal(localExecutorRequest({ ...local, headers: { ...local.headers, origin: 'https://evil.test' } }), false);
  assert.equal(localExecutorRequest({ ...local, socket: { remoteAddress: '192.168.1.10' } } as any), false);
});
