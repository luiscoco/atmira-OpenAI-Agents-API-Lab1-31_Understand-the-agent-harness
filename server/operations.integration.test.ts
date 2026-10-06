import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import OperationsLab from '../src/OperationsLab.tsx';
import { runOperationsSuite, operationTitles, parseTrace, traceFixture, parseUsage, usageFixture, retryDelay } from '../src/operationsLabRules.ts';
import { operationsLessons } from '../src/operationsLessons.ts';
import { OwnershipStore, WebhookLedger, signFixture, boundedRetry } from './operationsService.ts';
import { handleOperationsLab, runHookValidation } from './labs41to50.ts';
import { registerPageTools } from '../src/lab46Registration.ts';

for (let lab = 41; lab <= 50; lab++) {
  test(`Lab ${lab}: shared rules and six explained snippets`, () => { const checks = runOperationsSuite(lab); assert.ok(checks.length >= 2); for (const check of checks) assert.equal(check.passed, true, check.name); assert.equal(operationsLessons[lab].length, 6); });
  test(`Lab ${lab}: React page renders exercise and evidence export`, () => { const html = renderToStaticMarkup(createElement(OperationsLab, { lab: lab as keyof typeof operationTitles, active: false })); assert.ok(html.includes(operationTitles[lab])); assert.ok(html.includes('Export evidence and notes')); assert.ok(html.includes('Run server tests')); });
}
test('Lab 49 offers inline demo sign-in and disables retries while signed out', () => {
  const html = renderToStaticMarkup(createElement(OperationsLab, { lab: 49, active: false }));
  assert.ok(html.includes('Sign in as alice')); assert.ok(html.includes('Sign in as bob'));
  assert.ok(html.includes('your API key is separate from this sign-in'));
  assert.match(html, /<button[^>]*disabled=""[^>]*>Run local retry exercise<\/button>/);
  assert.ok(!html.includes('Choose Alice or Bob in Lab 50'));
});
test('SDK verification rejects tampering and old timestamps; durable concurrent replay deduplicates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agents-lab44-test-')); const file = join(directory, 'events.jsonl');
  try {
    const ledger = new WebhookLedger(file), secret = `whsec_${randomBytes(32).toString('base64')}`;
    const raw = JSON.stringify({ id: 'evt_delivery', type: 'agent.session.idle', data: { id: 'sess_fixture' } });
    const headers = signFixture(raw, secret);
    await assert.rejects(ledger.accept(raw.replace('idle', 'failed'), headers, secret));
    await assert.rejects(ledger.accept(raw, signFixture(raw, secret, undefined, Math.floor(Date.now() / 1000) - 600), secret));
    await assert.rejects(ledger.accept(raw, headers, `whsec_${randomBytes(32).toString('base64')}`));
    const results = await Promise.all([ledger.accept(raw, headers, secret), ledger.accept(raw, headers, secret)]);
    assert.equal(results.filter(row => !row.duplicate).length, 1);
    assert.equal((await new WebhookLedger(file).entries()).length, 1);
    assert.ok((await ledger.entries())[0].outcome.includes('not proof of success'));
    const invalid = raw.replace('agent.session.idle', 'agent.session.turn.completed'); await assert.rejects(ledger.accept(invalid, signFixture(invalid, secret), secret));
  } finally { const target = resolve(directory); assert.equal(dirname(target), resolve(tmpdir())); assert.ok(basename(target).startsWith('agents-lab44-test-')); await rm(target, { recursive: true, force: true }); }
});
test('Ownership rejects foreign read, stop and delete without modifying the owner session', () => {
  const store = new OwnershipStore(); const aliceToken = store.login('alice'), bobToken = store.login('bob'); assert.equal(store.identity(aliceToken), 'alice'); assert.equal(store.identity(bobToken), 'bob'); const created = store.create('alice');
  for (const action of ['read', 'stop', 'delete'] as const) assert.equal(store.access('bob', created.id, action), null);
  assert.equal(store.access('alice', created.id, 'read')?.status, 'idle'); assert.equal(store.access('alice', created.id, 'stop')?.status, 'cancelled');
  assert.equal(store.access('alice', created.id, 'delete')?.status, 'deleted'); assert.equal(store.access('alice', created.id, 'read'), null);
  assert.equal(store.identity('alice'), null); store.identities.get(aliceToken)!.expires = 0; assert.equal(store.identity(aliceToken), null);
});
test('Budget reservation is per identity and resets only with window expiry', () => { const store = new OwnershipStore(); for (let i = 0; i < 3; i++) assert.equal(store.reserve('alice', 100).allowed, true); assert.equal(store.reserve('alice', 100).allowed, false); assert.equal(store.reserve('bob', 100).allowed, true); assert.equal(store.reserve('alice', 60100).allowed, true); });
test('Retry worker respects wait, hard attempt bound, permanent errors and unsafe writes', async () => {
  const delays: number[] = []; const statuses = [429, 503, 200]; const result = await boundedRetry(async i => ({ status: statuses[i] }), true, async ms => { delays.push(ms); }); assert.equal(result.success, true); assert.deepEqual(delays, [250, 500]);
  const exhausted = await boundedRetry(async () => ({ status: 429 }), true, async () => {}); assert.equal(exhausted.attempts.length, 4); assert.equal(exhausted.success, false);
  for (const [status, safe] of [[503, false], [401, true]] as const) assert.equal((await boundedRetry(async () => ({ status }), safe, async () => { assert.fail('Must not wait'); })).attempts.length, 1);
  assert.equal(retryDelay(429, 0, new Date(10000).toUTCString(), true, 0), null);
});
test('Hook validation command reports meaningful pass and fail exit codes', async () => { const pass = await runHookValidation(false) as any, fail = await runHookValidation(true) as any; assert.equal(pass.exitCode, 0); assert.equal(fail.exitCode, 2); assert.ok(fail.output.includes('cannot undo')); assert.ok(pass.source.includes('not verified')); });
test('Trace parser supports export envelope and usage parser replaces later snapshots', () => { assert.equal(parseTrace({ data: [{ otlp: traceFixture(true) }] }).length, 4); const final = { ...usageFixture[1], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }; assert.deepEqual(parseUsage([usageFixture[1], final]), [final]); });
test('WebMCP late registration is removed before a new page lifetime registers tools', async () => {
  let release: () => void; let registered: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { registered = resolve; });
  const events: string[] = []; let first = true;
  const context = { registerTool: async (tool: any) => { events.push(`register:${tool.name}`); if (first) { first = false; registered(); await gate; } }, unregisterTool: async (name: string) => { events.push(`remove:${name}`); } };
  const old = registerPageTools(context, [{ name: 'read' }, { name: 'filter' }], () => assert.fail('Closed old page must not report success'));
  await entered; old.close(); let newReady: () => void; const reached = new Promise<void>(resolve => { newReady = resolve; }); const next = registerPageTools(context, [{ name: 'read' }, { name: 'filter' }], () => newReady());
  release(); await old.ready; await reached;
  assert.deepEqual(events, ['register:read', 'remove:read', 'register:read', 'register:filter']); next.close(); await next.ready;
  assert.deepEqual(events.slice(-2), ['remove:read', 'remove:filter']);
});
test('WebMCP partial registration failure removes already registered tools', async () => {
  const removed: string[] = []; const reports: string[] = [];
  const context = { registerTool: async (tool: any) => { if (tool.name === 'filter') throw new Error('Browser registration refused'); }, unregisterTool: async (name: string) => { removed.push(name); } };
  const registration = registerPageTools(context, [{ name: 'read' }, { name: 'filter' }], status => reports.push(status)); await registration.ready; assert.deepEqual(removed, ['read']); assert.ok(reports[0].includes('refused')); registration.close();
});
test('HTTP authentication, cookie revocation, origin checks, foreign operations and budgets', async () => {
  const server = createServer((request, response) => { const path = new URL(request.url!, 'http://localhost').pathname; const lab = Number(/^\/api\/lab(\d+)/.exec(path)?.[1]); void handleOperationsLab(request, response, path, lab); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address() as any; const base = `http://127.0.0.1:${address.port}`;
  const post = (lab: number, action: string, value = {}, cookie = '', origin = base) => fetch(`${base}/api/lab${lab}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie, origin }, body: JSON.stringify(value) });
  try {
    assert.equal((await post(50, 'create')).status, 401);
    const signedOut = await post(49, 'run', { scenario: 'recover', safe: true }); assert.equal(signedOut.status, 401); assert.ok((await signedOut.json() as any).error.includes('Select Alice or Bob in Lab 49'));
    assert.equal((await post(49, 'login', { user: 'alice' }, '', 'https://foreign.example')).status, 403);
    assert.equal((await post(50, 'login', { user: 'alice' }, '', 'https://foreign.example')).status, 403);
    const alice = await post(49, 'login', { user: 'alice' }); assert.equal(alice.status, 200); const aliceCookie = alice.headers.get('set-cookie')!.split(';')[0]; assert.ok(alice.headers.get('set-cookie')!.includes('HttpOnly')); assert.ok(alice.headers.get('set-cookie')!.includes('SameSite=Strict'));
    assert.equal((await (await fetch(`${base}/api/lab50/status`, { headers: { cookie: aliceCookie } })).json() as any).identity, 'alice');
    assert.equal((await post(49, 'login', { user: 'invalid' }, aliceCookie)).status, 400);
    const created = await (await post(50, 'create', {}, aliceCookie)).json() as any; assert.ok(created.session.id.startsWith('app_')); assert.ok(!JSON.stringify(created).includes('providerId'));
    const bob = await post(50, 'login', { user: 'bob' }); const bobCookie = bob.headers.get('set-cookie')!.split(';')[0];
    for (const action of ['read', 'stop', 'delete']) assert.equal((await post(50, action, { id: created.session.id }, bobCookie)).status, 404);
    assert.equal((await post(50, 'read', { id: created.session.id }, aliceCookie)).status, 200);
    assert.equal((await post(50, 'read', { id: created.session.id, owner: 'alice' }, bobCookie)).status, 400);
    for (let i = 0; i < 3; i++) assert.equal((await post(49, 'run', { scenario: 'unauthorized', safe: true }, aliceCookie)).status, 200);
    assert.equal((await post(49, 'run', { scenario: 'unauthorized', safe: true }, aliceCookie)).status, 429);
    assert.equal((await post(49, 'run', { scenario: 'unauthorized', safe: true }, bobCookie)).status, 200);
    assert.equal((await post(49, 'logout', {}, aliceCookie)).status, 200); assert.equal((await post(50, 'read', { id: created.session.id }, aliceCookie)).status, 401); assert.equal((await post(49, 'run', { scenario: 'recover', safe: true }, aliceCookie)).status, 401);
    for (let lab = 41; lab <= 50; lab++) { const result = await post(lab, 'test'); assert.equal(result.status, 200); assert.ok((await result.json() as any).results.every(row => row.passed)); }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
