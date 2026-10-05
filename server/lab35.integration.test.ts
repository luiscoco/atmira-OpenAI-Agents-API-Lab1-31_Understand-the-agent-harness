import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runAccessSuite } from '../src/lab35Tests.ts';
import { accessPractice, accessPrompt, filesystemImage, verifyAccess } from '../src/lab35Filesystem.ts';
import { executorArgs, validContainerName, type ExecutorProvider } from './lab32Docker.ts';
import { createExecutorJob, executeListing, publicExecutorJob, type ExecutorApi } from './lab32Service.ts';
import { probeBundle, handleLab35, type AccessJob } from './lab35.ts';
test('shared browser/server access suite passes', () => { for (const check of runAccessSuite()) assert.equal(check.passed, true, check.name); });
test('probe only uses fixed synthetic paths and reports real OS errors', async () => { const source = await probeBundle(); assert.ok(source.includes('process.getuid()')); assert.ok(source.includes("'EACCES', 'EPERM', 'EROFS'")); assert.ok(!source.includes('process.argv')); assert.ok(!source.includes('process.env')); });
test('Lab 35 uses its own image and cleanup label with isolated mounts', () => {
  const job = createExecutorJob('test', 35); assert.ok(validContainerName(job.containerName, 35)); assert.ok(!validContainerName(job.containerName, 34));
  const args = executorArgs({ name: job.containerName, environmentId: 'env_test', remoteUrl: 'https://api.openai.com/v1/agents/api', nonce: job.trace.nonce }, 35, filesystemImage);
  for (const flag of ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', filesystemImage, 'agents.course.lab=35']) assert.ok(args.includes(flag));
  for (const flag of ['--mount', '--volume', '--privileged', '--user']) assert.ok(!args.includes(flag));
});
test('broader request is sent once after connection; completed evidence and both cleanups are retained', async () => {
  const practice = accessPractice('broader'); const calls: string[] = []; const job: AccessJob = { ...createExecutorJob('access_job', 35), task: 'broader' }; job.trace.nonce = practice.nonce;
  const api: ExecutorApi = {
    create: async () => ({ id: 'sess_access', environment: { type: 'self_hosted', id: 'env_access', remote_url: 'https://api.openai.com/v1/agents/api' } }),
    stream: async () => ({ async *[Symbol.asyncIterator]() { yield { type: 'agent.session.environment.connected' }; yield { type: 'agent.session.environment.connected' }; for (const command of practice.commands) yield { type: 'agent.session.turn.item.done', item: { ...command, type: 'command_execution', exit_code: 0 } }; yield { type: 'agent.session.turn.output_text.done', item_id: 'answer', content_index: 0, text: practice.answer }; yield { type: 'agent.session.turn.completed', turn: { subagent_id: null } }; } }),
    input: async (_id, prompt) => { calls.push(prompt); }, cancel: async () => {}, delete: async () => { calls.push('delete'); },
  };
  const provider: ExecutorProvider = { preflight: async () => {}, start: async () => {}, remove: async () => { calls.push('remove'); } };
  await executeListing(job, api, provider, new AbortController(), undefined, () => accessPrompt(job.task));
  assert.equal(calls.filter(call => call === accessPrompt('broader')).length, 1); assert.ok(verifyAccess(job.trace).every(check => check.passed)); assert.equal(job.sessionCleanup, 'deleted'); assert.ok(calls.includes('remove'));
});
test('final answer cannot replace probe evidence and credentials are redacted', () => {
  assert.ok(verifyAccess(accessPractice('claim')).some(check => !check.passed));
  const job: AccessJob = { ...createExecutorJob('test', 35), task: 'broader' }; job.trace.answer = 'secret_key'; const result = publicExecutorJob(job, ['secret_key']) as AccessJob;
  assert.equal(result.task, 'broader'); assert.equal(result.trace.answer, '[redacted]');
});
test('offline HTTP routes work and arbitrary path overrides and foreign origins are rejected', async () => {
  const server = createServer((request, response) => { void handleLab35(request, response, new URL(request.url!, 'http://localhost').pathname); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const probe = await fetch(`${url}/api/lab35/probe`); assert.equal(probe.status, 200); assert.ok((await probe.json()).source.includes('protected-read'));
    const tests = await fetch(`${url}/api/lab35/test`, { method: 'POST' }); assert.ok((await tests.json()).results.every((check: any) => check.passed));
    const bad = await fetch(`${url}/api/lab35/run`, { method: 'POST', body: JSON.stringify({ requestId: 'a'.repeat(20), task: 'broader', path: 'C:\\' }) }); assert.equal(bad.status, 400);
    const foreign = await fetch(`${url}/api/lab35/status`, { headers: { Origin: 'https://evil.test' } }); assert.equal(foreign.status, 403);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
