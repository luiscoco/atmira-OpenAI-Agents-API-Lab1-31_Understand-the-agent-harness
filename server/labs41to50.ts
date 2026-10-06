import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { send, body } from './courseLabHttp.ts';
import { localExecutorRequest } from './lab32.ts';
import { runOperationsSuite } from '../src/operationsLabRules.ts';
import { OwnershipStore, WebhookLedger, boundedRetry, signFixture } from './operationsService.ts';
export const ownership = new OwnershipStore();
const ledger = new WebhookLedger(join(import.meta.dirname, '..', '.lab-data', 'lab44-webhooks.jsonl'));
const fixtureLedger = new WebhookLedger(join(import.meta.dirname, '..', '.lab-data', 'lab44-fixture.jsonl'));
const fixtureSecret = `whsec_${randomBytes(32).toString('base64')}`;
const tokenFrom = (request: IncomingMessage) => /(?:^|;\s*)lab50_auth=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || '')?.[1] || '';
export function runHookValidation(failure: boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'sandbox', 'lab45', 'validate-report.mjs'), '--fixture', failure ? 'fail' : 'pass'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; const timer = setTimeout(() => child.kill(), 10000); child.stdout.on('data', value => { if (output.length < 10000) output += value; }); child.stderr.on('data', value => { if (output.length < 10000) output += value; });
    child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ source: 'Direct command validation; Codex lifecycle invocation not verified', exitCode: code, signal, output }); });
    child.stdin.end(JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'apply_patch', cwd: process.cwd() }));
  });
}
export async function handleOperationsLab(request: IncomingMessage, response: ServerResponse, path: string, lab: number) {
  // Provider delivery uses signature authentication, independently of local UI origin checks.
  if (lab === 44 && path === '/api/lab44/webhook' && request.method === 'POST') {
    if (!process.env.OPENAI_WEBHOOK_SECRET) return send(response, 503, { error: 'Configure OPENAI_WEBHOOK_SECRET and restart.' });
    try { const chunks: Buffer[] = []; let bytes = 0; for await (const chunk of request) { bytes += chunk.length; if (bytes > 16000) throw new Error('Body limit'); chunks.push(Buffer.from(chunk)); } const raw = Buffer.concat(chunks).toString('utf8'); const headers = Object.fromEntries(Object.entries(request.headers).filter(([, value]) => typeof value === 'string')) as Record<string, string>; return send(response, 200, await ledger.accept(raw, headers, process.env.OPENAI_WEBHOOK_SECRET)); } catch { return send(response, 400, { error: 'Signature, payload or ledger validation failed.' }); }
  }
  if (!localExecutorRequest(request)) return send(response, 403, { error: 'Use same-origin localhost.' });
  try {
    const action = path.slice(`/api/lab${lab}/`.length);
    if (action === 'test' && request.method === 'POST') return send(response, 200, { results: runOperationsSuite(lab) });
    if (action === 'status' && request.method === 'GET') return send(response, 200, { lab, source: 'Local teaching exercises', webhookConfigured: Boolean(process.env.OPENAI_WEBHOOK_SECRET), identity: ownership.identity(tokenFrom(request)) });
    if (lab === 44 && action === 'log' && request.method === 'GET') return send(response, 200, { live: await ledger.entries(), fixture: await fixtureLedger.entries() });
    if (request.method !== 'POST') return send(response, 404, { error: 'Route not found' });
    if (lab === 44 && action === 'practice') { const value = await body(request, ['mode']); if (!['valid', 'duplicate', 'tampered', 'expired'].includes(value.mode)) throw new Error('Unknown fixture'); const raw = JSON.stringify({ id: 'evt_lab44_idle_fixture', type: 'agent.session.idle', data: { id: 'sess_lab44_fixture' } }); const headers = signFixture(raw, fixtureSecret, undefined, Math.floor(Date.now() / 1000) - (value.mode === 'expired' ? 600 : 0)); try { let result = await fixtureLedger.accept(value.mode === 'tampered' ? raw.replace('idle', 'failed') : raw, headers, fixtureSecret); if (value.mode === 'duplicate') result = await fixtureLedger.accept(raw, headers, fixtureSecret); return send(response, 200, { source: 'Locally signed fixture using official SDK verifier', ...result, log: await fixtureLedger.entries() }); } catch { return send(response, 200, { source: 'Locally signed fixture', rejected: true, reason: 'Signature or timestamp rejected', log: await fixtureLedger.entries() }); } }
    if (lab === 45 && action === 'validate') { const value = await body(request, ['failure']); if (typeof value.failure !== 'boolean') throw new Error('Supply failure boolean'); return send(response, 200, await runHookValidation(value.failure)); }
    if ([49, 50].includes(lab) && action === 'login') { const value = await body(request, ['user']); const token = ownership.login(value.user); ownership.identities.delete(tokenFrom(request)); response.setHeader('Set-Cookie', `lab50_auth=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=3600${request.socket instanceof Object && 'encrypted' in request.socket ? '; Secure' : ''}`); return send(response, 200, { identity: value.user, source: 'Local demo identity selector, not production credential authentication' }); }
    const principal = ownership.identity(tokenFrom(request));
    if ([49, 50].includes(lab) && !principal) return send(response, 401, { error: `Your local demo sign-in is missing or expired. Select Alice or Bob in Lab ${lab}. This is separate from your OpenAI API key.` });
    if ([49, 50].includes(lab) && action === 'logout') { await body(request, []); ownership.identities.delete(tokenFrom(request)); response.setHeader('Set-Cookie', 'lab50_auth=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0'); return send(response, 200, { loggedOut: true }); }
    if (lab === 50 && action === 'create') { await body(request, []); return send(response, 201, { session: ownership.create(principal!) }); }
    if (lab === 50 && ['read', 'stop', 'delete'].includes(action)) { const value = await body(request, ['id']); if (typeof value.id !== 'string' || !/^app_[a-f0-9-]{36}$/.test(value.id)) return send(response, 404, { error: 'Session not found' }); const result = ownership.access(principal!, value.id, action as 'read' | 'stop' | 'delete'); return send(response, result ? 200 : 404, result ? { session: result } : { error: 'Session not found' }); }
    if (lab === 49 && action === 'run') {
      const value = await body(request, ['scenario', 'safe']); if (!['recover', 'exhausted', 'unauthorized', 'long-wait'].includes(value.scenario) || typeof value.safe !== 'boolean') throw new Error('Invalid retry scenario');
      const budget = ownership.reserve(principal!); if (!budget.allowed) { response.setHeader('Retry-After', String(Math.max(1, Math.ceil((budget.reset - Date.now()) / 1000)))); return send(response, 429, { error: 'Three application requests per identity per minute exhausted', budget }); }
      const sequence = value.scenario === 'recover' ? [429, 503, 200] : value.scenario === 'unauthorized' ? [401] : [429, 429, 429, 429];
      const result = await boundedRetry(async index => ({ status: sequence[Math.min(index, sequence.length - 1)], retryAfter: value.scenario === 'long-wait' ? '60' : undefined }), value.safe);
      return send(response, 200, { source: 'Injected local HTTP statuses; no model calls or charges', identity: principal, budget, ...result });
    }
    return send(response, 404, { error: 'Route not found' });
  } catch { if (!response.headersSent) send(response, 400, { error: 'Invalid request or exercise failed.' }); }
}
