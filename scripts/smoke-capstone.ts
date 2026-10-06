import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const base = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, ''); const origin = new URL(base).origin;
let cookie = '';
async function post(action: string, value = {}) { const response = await fetch(`${base}/api/capstone/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, body: JSON.stringify(value), signal: AbortSignal.timeout(10000) }); const body = await response.json() as any; const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0]; return { response, body }; }
async function get(action: string) { return fetch(`${base}/api/capstone/${action}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) }); }
const suffix = randomUUID().slice(0, 8); const password = `Course-smoke-${randomUUID()}`;
assert.equal((await get('health')).status, 200);
const alice = await post('register', { email: `smoke-a-${suffix}@example.test`, password }); assert.equal(alice.response.status, 200); const aliceCookie = cookie;
const workspace = await post('workspace', { name: `Smoke ${suffix}` }); const workspaceId = workspace.body.workspace.id;
assert.equal((await post('upload', { workspace: workspaceId, name: 'release.md', content: 'Search supports date filtering. Existing queries continue to work.' })).response.status, 201);
const investigation = await post('investigation', { workspace: workspaceId, question: 'What changed?' }); const inv = investigation.body.investigation.id;
const request = { investigation: inv, requestId: randomUUID(), question: 'What changed?', mode: 'fixture', delegation: false, failure: false }; const run = await post('run', request); assert.equal(run.response.status, 202); assert.equal((await post('run', request)).body.replay, true);
let operation: any;
for (let i = 0; i < 15; i++) { operation = await (await get(`operation?id=${run.body.operation.id}`)).json() as any; if (operation.operation.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 100)); }
assert.equal(operation.operation.status, 'completed'); const approvalId = operation.operation.approvals[0].id; const reportId = operation.operation.report.id;
assert.equal((await post('approval', { id: approvalId, decision: 'approved' })).body.replay, false); assert.equal((await post('approval', { id: approvalId, decision: 'approved' })).body.replay, true); assert.equal((await get(`report?id=${reportId}`)).status, 200);
cookie = ''; assert.equal((await post('register', { email: `smoke-b-${suffix}@example.test`, password })).response.status, 200);
assert.equal((await get(`workspaces?workspace=${workspaceId}`)).status, 404); assert.equal((await get(`report?id=${reportId}`)).status, 404); assert.equal((await post('approval', { id: approvalId, decision: 'approved' })).response.status, 404);
await post('logout'); cookie = aliceCookie; assert.equal((await get(`workspaces?workspace=${workspaceId}`)).status, 200); await post('logout');
const report = { recordedAt: new Date().toISOString(), target: origin, source: 'Actual target HTTP smoke with fixture research', health: 'pass', persistence: 'same-process read verified; restart test requires integration suite', ownership: 'pass', approvalReplay: 'pass', reportDownload: 'pass', liveModel: 'not run', testAccountSuffix: suffix };
const out = process.argv.indexOf('--out'); if (out >= 0) { const file = process.argv[out + 1]; if (!file) throw new Error('Supply an evidence filename after --out.'); await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
