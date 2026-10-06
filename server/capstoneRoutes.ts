import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import OpenAI from 'openai';
import { body, send, configured, redact } from './courseLabHttp.ts';
import { localExecutorRequest } from './lab32.ts';
import { WorkspaceStore, WorkspaceError } from './capstoneStore.ts';
import { ResearchRunner } from './capstoneRunner.ts';
import { researchProfile } from './capstoneIntegrations.ts';
import { evaluateDataset, evaluationDataset, specification, runFinalSuite } from '../src/capstoneRules.ts';
const token = (request: IncomingMessage) => /(?:^|;\s*)capstone_auth=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || '')?.[1] || '';
const cookie = (value: string, secure: boolean, maxAge = 3600) => `capstone_auth=${value}; HttpOnly; SameSite=Strict; Path=/api/capstone; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
export function capstoneOrigin(request: IncomingMessage, publicOrigin = process.env.CAPSTONE_PUBLIC_ORIGIN) {
  if (!publicOrigin) return localExecutorRequest(request);
  let expected: URL; try { expected = new URL(publicOrigin); } catch { return false; }
  if (request.headers.host !== expected.host || request.headers['sec-fetch-site'] === 'cross-site') return false;
  // Require explicit same-origin requests for all state changes; no trust in forwarded headers.
  return request.method === 'GET' ? !request.headers.origin || request.headers.origin === expected.origin : request.headers.origin === expected.origin;
}
export class CapstoneApplication {
  store: WorkspaceStore; runner: ResearchRunner; authAttempts = new Map<string, { count: number; reset: number }>();
  constructor(file = process.env.CAPSTONE_DB_PATH || join(import.meta.dirname, '..', '.lab-data', 'capstone.sqlite')) { this.store = new WorkspaceStore(file); this.runner = new ResearchRunner(this.store); }
  async stop() { await this.runner.shutdown(); this.store.close(); }
  async handle(request: IncomingMessage, response: ServerResponse, path: string) {
    const reply = (status: number, value: unknown) => send(response, status, redact(value));
    if (path === '/api/capstone/health' && request.method === 'GET') { try { this.store.one('SELECT 1'); return reply(200, { status: 'ok', schema: this.store.one('PRAGMA user_version').user_version, liveConfigured: configured(), persistence: 'SQLite', runtime: 'single-process course capstone' }); } catch { return reply(503, { status: 'unavailable' }); } }
    if (path === '/api/capstone/webhook' && request.method === 'POST') {
      if (!process.env.OPENAI_WEBHOOK_SECRET) return reply(503, { error: 'Webhook signing secret not configured.' });
      try { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 16000) throw new Error('Body limit'); chunks.push(Buffer.from(chunk)); } const raw = Buffer.concat(chunks).toString('utf8'); const api = new OpenAI({ apiKey: 'signature-verification-only', webhookSecret: process.env.OPENAI_WEBHOOK_SECRET }); await api.webhooks.verifySignature(raw, request.headers as any); const event = JSON.parse(raw); if (!/^evt_[\w-]{1,100}$/.test(event.id) || !/^sess_[\w-]{1,100}$/.test(event.data?.id) || !['agent.session.created', 'agent.session.in_progress', 'agent.session.idle', 'agent.session.failed', 'agent.session.action_required'].includes(event.type)) throw new Error('Invalid notification'); return reply(200, this.store.notification(event.id, event.data.id, event.type)); } catch { return reply(400, { error: 'Invalid webhook signature or notification.' }); }
    }
    if (!capstoneOrigin(request)) return reply(403, { error: 'Use the configured application origin.' });
    const lesson = /^\/api\/lab(5[1-6])\/(\w+)$/.exec(path);
    if (lesson) {
      if (lesson[2] === 'test' && request.method === 'POST') return reply(200, { results: runFinalSuite(Number(lesson[1])) });
      if (lesson[2] === 'evaluate' && request.method === 'POST') { try { const value = await body(request, ['dataset'], 200000); return reply(200, { before: evaluateDataset(value.dataset || evaluationDataset, 'baseline'), after: evaluateDataset(value.dataset || evaluationDataset, 'enforced') }); } catch (error) { return reply(400, { error: error.message }); } }
      if (lesson[2] === 'setup' && request.method === 'GET') return reply(200, { specificationVersion: specification.version, sqliteReady: true, liveConfigured: configured(), deployment: 'This endpoint verifies the current process only; hosted deployment remains unverified until a target smoke check.', publicOrigin: process.env.CAPSTONE_PUBLIC_ORIGIN || null });
      return reply(404, { error: 'Route not found' });
    }
    const action = path.slice('/api/capstone/'.length); const identity = this.store.identity(token(request)); const secure = Boolean(process.env.CAPSTONE_PUBLIC_ORIGIN?.startsWith('https://') || 'encrypted' in request.socket);
    try {
      if (action === 'status' && request.method === 'GET') return reply(200, { user: identity, liveConfigured: configured(), specificationVersion: specification.version, profiles: ['sources', 'connected', 'hosted'] });
      if (['register', 'login'].includes(action) && request.method === 'POST') {
        const key = request.socket.remoteAddress || 'unknown'; const now = Date.now(); for (const [id, row] of this.authAttempts) if (row.reset <= now) this.authAttempts.delete(id);
        let attempts = this.authAttempts.get(key); if (!attempts) { if (this.authAttempts.size >= 500) throw new WorkspaceError(429, 'Authentication capacity reached.'); attempts = { count: 0, reset: now + 60000 }; this.authAttempts.set(key, attempts); } if (++attempts.count > 10) throw new WorkspaceError(429, 'Too many sign-in attempts; try again in one minute.');
        if (action === 'register' && process.env.CAPSTONE_PUBLIC_ORIGIN && process.env.CAPSTONE_ALLOW_REGISTRATION !== 'true') throw new WorkspaceError(403, 'Hosted registration is disabled by configuration.');
        const value = await body(request, ['email', 'password']); const signed = action === 'register' ? this.store.register(value.email, value.password) : this.store.login(value.email, value.password); this.store.logout(token(request)); response.setHeader('Set-Cookie', cookie(signed.token, secure)); return reply(200, { user: signed.user });
      }
      if (!identity) return reply(401, { error: 'Sign in to your research workspace first.' });
      const user = identity.id; const query = new URL(request.url!, 'http://localhost').searchParams;
      if (action === 'workspaces' && request.method === 'GET') return reply(200, this.store.snapshot(user, query.get('workspace') || undefined));
      if (action === 'history' && request.method === 'GET') return reply(200, { operations: this.store.history(user, query.get('investigation') || '') });
      if (action === 'operation' && request.method === 'GET') return reply(200, { operation: this.store.publicOperation(user, query.get('id') || '') });
      if (action === 'report' && request.method === 'GET') { const report = this.store.report(user, query.get('id') || ''); response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="research-report.md"', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); response.end(report.content); return; }
      if (action === 'evaluations' && request.method === 'GET') return reply(200, { evaluations: this.store.all('SELECT id,report,created FROM evaluations WHERE owner=? ORDER BY created DESC LIMIT 20', user).map(row => ({ ...row, report: JSON.parse(row.report) })) });
      if (request.method !== 'POST') return reply(404, { error: 'Route not found' });
      if (action === 'logout') { await body(request, []); this.store.logout(token(request)); response.setHeader('Set-Cookie', cookie('', secure, 0)); return reply(200, { loggedOut: true }); }
      if (action === 'workspace') { const value = await body(request, ['name']); return reply(201, { workspace: this.store.createWorkspace(user, value.name) }); }
      if (action === 'upload') { const value = await body(request, ['workspace', 'name', 'content'], 200000); return reply(201, { document: this.store.upload(user, value.workspace, value.name, value.content) }); }
      if (action === 'investigation') { const value = await body(request, ['workspace', 'question']); return reply(201, { investigation: { id: this.store.createInvestigation(user, value.workspace, value.question).id } }); }
      if (action === 'run') {
        const value = await body(request, ['investigation', 'requestId', 'question', 'mode', 'delegation', 'failure', 'profile']); if (typeof value.delegation !== 'boolean' || typeof value.failure !== 'boolean' || (value.mode === 'live' && value.failure)) throw new WorkspaceError(400, 'Use bounded delegation and fixture-only failure options.');
        const profile = researchProfile(value.profile);
        this.store.investigation(user, value.investigation); const replay = this.store.one('SELECT id FROM operations WHERE investigation_id=? AND request_id=?', value.investigation, value.requestId);
        if (!replay && this.runner.jobs.size >= 2) throw new WorkspaceError(429, 'Two server operations are already active.');
        if (!replay && value.mode === 'live' && !configured()) throw new WorkspaceError(503, 'Configure OPENAI_API_KEY and restart, or use the local fixture.');
        const entry = this.store.createOperation(user, value.investigation, value.requestId, value.question, value.mode, { delegation: value.delegation, failure: value.failure, ...(value.profile === undefined ? {} : { profile }) }); if (entry.created) this.runner.start(user, entry.operation.id, value.delegation, value.failure); return reply(entry.created ? 202 : 200, { operation: this.store.publicOperation(user, entry.operation.id), replay: !entry.created });
      }
      if (['inspect', 'stop'].includes(action)) { const value = await body(request, ['id']); return reply(200, { operation: await (action === 'inspect' ? this.runner.inspect(user, value.id) : this.runner.stop(user, value.id)) }); }
      if (action === 'delete-session') { const value = await body(request, ['investigation']); return reply(200, await this.runner.removeSession(user, value.investigation)); }
      if (action === 'approval') { const value = await body(request, ['id', 'decision']); return reply(200, this.store.decide(user, value.id, value.decision)); }
      if (action === 'save-evaluation') { const value = await body(request, ['dataset'], 200000); if (this.store.one('SELECT count(*) AS n FROM evaluations WHERE owner=?', user).n >= 20) throw new WorkspaceError(429, 'Saved evaluation limit reached.'); const report = { before: evaluateDataset(value.dataset || evaluationDataset, 'baseline'), after: evaluateDataset(value.dataset || evaluationDataset, 'enforced') }; const id = crypto.randomUUID(); this.store.run('INSERT INTO evaluations VALUES (?,?,?,?)', id, user, JSON.stringify(report), Date.now()); return reply(201, { id, report }); }
      return reply(404, { error: 'Route not found' });
    } catch (error) { return reply(error instanceof WorkspaceError ? error.status : 400, { error: error instanceof WorkspaceError ? error.message : 'Invalid request or operation could not be verified.' }); }
  }
}
let application: CapstoneApplication | undefined;
export const capstoneApplication = () => application ||= new CapstoneApplication();
export async function stopCapstone() { await application?.stop(); }
