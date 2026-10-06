import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const phase = process.argv[2], base = (process.argv[3] || 'http://localhost:8080').replace(/\/$/, ''), origin = new URL(base).origin;
const file = resolve('.lab-data', 'capstone-persistence-checkpoint.json'); let cookie = '';
async function post(action: string, body: unknown) { const response = await fetch(`${base}/api/capstone/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }); assert.ok(response.ok, `HTTP ${response.status}: ${action}`); const issued = response.headers.get('set-cookie'); if (issued) cookie = issued.split(';')[0]; return await response.json() as any; }
async function get(action: string) { const response = await fetch(`${base}/api/capstone/${action}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) }); assert.ok(response.ok, `HTTP ${response.status}: ${action}`); return response; }
if (phase === 'record') {
  await post('register', { email: `restart-${randomUUID().slice(0, 8)}@example.test`, password: `Course-${randomUUID()}` }); const workspace = (await post('workspace', { name: 'Restart persistence smoke' })).workspace.id;
  await post('upload', { workspace, name: 'source.txt', content: 'Search supports date filtering. Existing queries continue to work.' }); const investigation = (await post('investigation', { workspace, question: 'What changed?' })).investigation.id;
  const operationId = (await post('run', { investigation, question: 'What changed?', mode: 'fixture', delegation: false, failure: false, requestId: randomUUID() })).operation.id;
  let operation: any; for (let i = 0; i < 20; i++) { operation = (await (await get(`operation?id=${operationId}`)).json() as any).operation; if (operation.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 100)); } assert.equal(operation.status, 'completed'); await post('approval', { id: operation.approvals[0].id, decision: 'approved' });
  await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify({ target: origin, cookie, workspace, investigation, operationId, report: operation.report.id }), { mode: 0o600 }); console.log('Restart checkpoint recorded in ignored .lab-data. Restart the deployment, then run verify.');
} else if (phase === 'verify') {
  const saved = JSON.parse(await readFile(file, 'utf8')); assert.equal(saved.target, origin); cookie = saved.cookie;
  const snapshot = await (await get(`workspaces?workspace=${saved.workspace}`)).json() as any; assert.equal(snapshot.documents.length, 1); assert.equal(snapshot.findings.length, 1); assert.ok(snapshot.investigations.some(row => row.id === saved.investigation)); const operation = (await (await get(`operation?id=${saved.operationId}`)).json() as any).operation; assert.equal(operation.status, 'completed'); assert.equal((await get(`report?id=${saved.report}`)).status, 200); await post('logout', {}); await unlink(file); console.log(JSON.stringify({ target: origin, persistenceAcrossRestart: 'pass', account: 'restored', investigation: 'restored', approval: 'restored once', report: 'downloaded', liveModel: 'not run' }, null, 2));
} else throw new Error('Use record or verify, followed by the target URL.');
