import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSkillSuite } from '../src/lab34Tests.ts';
import { inspectManifest, skillEnvironment, skillImage, skillPractice, verifySkillEvidence, revenueTotal, skillPrompt } from '../src/lab34Skills.ts';
import { executorArgs, validContainerName, type ExecutorProvider } from './lab32Docker.ts';
import { createExecutorJob, executeListing, publicExecutorJob, type ExecutorApi } from './lab32Service.ts';
import { skillBundle, handleLab34, type SkillJob } from './lab34.ts';
test('shared browser/server skill suite passes', () => { for (const check of runSkillSuite()) assert.equal(check.passed, true, check.name); });
test('bundled manifest metadata validates and supporting resources exist', async () => {
  const files = await skillBundle(); assert.equal(files.length, 3); assert.ok(inspectManifest(files[0].content).checks.every(check => check.passed));
  assert.ok(files[0].content.includes('references/report-contract.md')); assert.ok(files[0].content.includes('scripts/report.mjs'));
});
test('registration points to the immutable standalone skill parent', () => {
  assert.deepEqual(skillEnvironment(true).capability_directories, ['/opt/lab34/skills']); assert.deepEqual(skillEnvironment(false).capability_directories, []);
});
test('reusable executor labels and validates each lab independently', () => {
  const job = createExecutorJob('job_test', 34); assert.ok(validContainerName(job.containerName, 34)); assert.ok(!validContainerName(job.containerName));
  const args = executorArgs({ name: job.containerName, environmentId: 'env_test', remoteUrl: 'https://api.openai.com/v1/agents/api', nonce: job.trace.nonce }, 34, skillImage);
  assert.ok(args.includes(skillImage)); assert.ok(args.includes('agents.course.lab=34')); assert.ok(!args.includes('--mount')); assert.ok(!args.includes('--privileged'));
  assert.throws(() => executorArgs({ name: job.containerName, environmentId: 'env_test', remoteUrl: 'https://evil.test', nonce: job.trace.nonce }, 34, skillImage));
});
test('actual bundled helper uses exact cents, rejects bad input and preserves the CSV', () => {
  const prefix = join(tmpdir(), 'lab34-test-'); const directory = mkdtempSync(prefix);
  const script = fileURLToPath(new URL('../sandbox/lab34/skills/course-sales-report/scripts/report.mjs', import.meta.url));
  try {
    const csv = join(directory, 'sales.csv'); const marker = join(directory, 'marker.txt'); writeFileSync(marker, '0000000000000000\n');
    const input = 'product,units,price_cents\nbook,1,1200\npen,8,200\n'; writeFileSync(csv, input);
    const report = JSON.parse(execFileSync(process.execPath, [script, csv, marker], { encoding: 'utf8', stdio: 'pipe', windowsHide: true }));
    assert.equal(report.total_cents, revenueTotal('0000000000000000')); assert.equal(report.marker, '0000000000000000'); assert.equal(readFileSync(csv, 'utf8'), input);
    for (const invalid of ['product,units,price_cents\nbook,-1,1200\n', 'product,units,price_cents\nbook,1,1.2\n', 'product,units,price_cents\nbook,9007199254740992,1\n', 'wrong-header\nbook,1,1200\n']) { writeFileSync(csv, invalid); assert.throws(() => execFileSync(process.execPath, [script, csv, marker], { stdio: 'pipe', windowsHide: true })); }
  } finally { if (!resolve(directory).startsWith(resolve(prefix))) throw new Error('Unexpected temporary cleanup target.'); rmSync(directory, { recursive: true, force: true }); }
});
test('connected executor sends the fixed skill task once and records command evidence', async () => {
  const practice = skillPractice('revenue'); const calls: string[] = [];
  const job: SkillJob = { ...createExecutorJob('skill_job', 34), task: 'revenue', registered: true, capabilityDirectories: ['/opt/lab34/skills'] }; job.trace.nonce = practice.trace.nonce;
  const api: ExecutorApi = {
    create: async () => ({ id: 'sess_skill', environment: { ...skillEnvironment(true), id: 'env_skill', remote_url: 'https://api.openai.com/v1/agents/api' } }),
    stream: async () => ({ async *[Symbol.asyncIterator]() { yield { type: 'agent.session.environment.connected' }; yield { type: 'agent.session.environment.connected' }; for (const command of practice.trace.commands) yield { type: 'agent.session.turn.item.done', item: { ...command, type: 'command_execution', exit_code: 0 } }; yield { type: 'agent.session.turn.output_text.done', item_id: 'answer', content_index: 0, text: practice.trace.answer }; yield { type: 'agent.session.turn.completed', turn: { subagent_id: null } }; } }),
    input: async (_id, prompt) => { calls.push(prompt); }, cancel: async () => {}, delete: async () => { calls.push('delete'); },
  };
  const provider: ExecutorProvider = { preflight: async () => {}, start: async () => {}, remove: async () => { calls.push('remove'); } };
  await executeListing(job, api, provider, new AbortController(), undefined, () => skillPrompt(job.task));
  assert.equal(calls.filter(call => call === skillPrompt('revenue')).length, 1); assert.ok(verifySkillEvidence(job).every(check => check.passed)); assert.equal(job.sessionCleanup, 'deleted');
});
test('nonzero helper exit and wrong fresh marker cannot establish execution', () => {
  const evidence = skillPractice('revenue'); evidence.trace.commands[2].exitCode = 1; assert.equal(verifySkillEvidence(evidence)[5].passed, false);
  const wrong = skillPractice('revenue'); wrong.trace.answer = wrong.trace.answer.replace(wrong.trace.nonce, '0000000000000000'); assert.equal(verifySkillEvidence(wrong)[6].passed, false);
});
test('public skill evidence retains registration while redacting credentials', () => {
  const job: SkillJob = { ...createExecutorJob('job', 34), task: 'unrelated', registered: true, capabilityDirectories: ['/opt/lab34/skills'] }; job.trace.answer = 'secret_key';
  const result = publicExecutorJob(job, ['secret_key']) as SkillJob; assert.equal(result.registered, true); assert.equal(result.trace.answer, '[redacted]');
});
test('HTTP fixture routes work offline and arbitrary image/path overrides are rejected', async () => {
  const server = createServer((request, response) => { void handleLab34(request, response, new URL(request.url!, 'http://localhost').pathname); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const bundle = await fetch(`${url}/api/lab34/skill`); assert.equal(bundle.status, 200); assert.equal((await bundle.json()).files.length, 3);
    const tests = await fetch(`${url}/api/lab34/test`, { method: 'POST' }); assert.ok((await tests.json()).results.every((check: any) => check.passed));
    const bad = await fetch(`${url}/api/lab34/run`, { method: 'POST', body: JSON.stringify({ requestId: 'a'.repeat(20), task: 'revenue', registered: true, image: 'unsafe' }) }); assert.equal(bad.status, 400);
    const foreign = await fetch(`${url}/api/lab34/status`, { headers: { Origin: 'https://evil.test' } }); assert.equal(foreign.status, 403);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
