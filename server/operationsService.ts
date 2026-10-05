import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import OpenAI from 'openai';
import { retryDelay, ownsSession, webhookTypes } from '../src/operationsLabRules.ts';

export class OwnershipStore {
  identities = new Map<string, { user: string; expires: number }>();
  sessions = new Map<string, { owner: string; providerId: string; status: string }>();
  budgets = new Map<string, { used: number; reset: number }>();
  login(user: string) { if (!['alice', 'bob'].includes(user)) throw new Error('Choose a local demonstration identity.'); if (this.identities.size >= 200) { const now = Date.now(); for (const [id, value] of this.identities) if (value.expires <= now) this.identities.delete(id); if (this.identities.size >= 200) throw new Error('Identity retention limit'); } const token = randomBytes(32).toString('hex'); this.identities.set(token, { user, expires: Date.now() + 3600000 }); return token; }
  identity(token: string) { const row = this.identities.get(token); if (!row || row.expires <= Date.now()) { this.identities.delete(token); return null; } return row.user; }
  create(user: string) { if (!user || this.sessions.size >= 100) throw new Error('Session retention limit or missing identity'); const id = `app_${randomUUID()}`; this.sessions.set(id, { owner: user, providerId: `sess_fixture_${randomUUID()}`, status: 'idle' }); return { id, status: 'idle' }; }
  access(user: string, id: string, action: 'read' | 'stop' | 'delete') { const row = this.sessions.get(id); if (!row || !ownsSession(user, row)) return null; if (action === 'delete') this.sessions.delete(id); if (action === 'stop') row.status = 'cancelled'; return { id, status: action === 'delete' ? 'deleted' : row.status }; }
  reserve(user: string, now = Date.now()) { if (!user) throw new Error('Authentication required'); let row = this.budgets.get(user); if (!row || row.reset <= now) { row = { used: 0, reset: now + 60000 }; this.budgets.set(user, row); } if (row.used >= 3) return { allowed: false, ...row }; row.used++; return { allowed: true, ...row }; }
}
export async function boundedRetry(operation: (attempt: number) => Promise<{ status: number; retryAfter?: string }>, safe: boolean, wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  const attempts: Array<{ attempt: number; status: number; delay: number | null }> = [];
  for (let index = 0; index < 4; index++) { const result = await operation(index); const delay = result.status >= 200 && result.status < 300 ? null : retryDelay(result.status, index, result.retryAfter ?? null, safe); attempts.push({ attempt: index + 1, status: result.status, delay }); if (delay === null) return { attempts, success: result.status >= 200 && result.status < 300 }; await wait(delay); }
  return { attempts, success: false };
}
export class WebhookLedger {
  private pending = Promise.resolve();
  constructor(private file: string) {}
  async entries() { try { const raw = await readFile(this.file, 'utf8'); if (raw.length > 2000000) throw new Error('Ledger retention limit'); return raw.split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if ((error as any).code === 'ENOENT') return []; throw error; } }
  async accept(raw: string, headers: Record<string, string>, secret: string) {
    if (Buffer.byteLength(raw) > 16000) throw new Error('Body limit');
    const verifier = new OpenAI({ apiKey: 'local-verification-only', webhookSecret: secret });
    await verifier.webhooks.verifySignature(raw, headers);
    const value = JSON.parse(raw);
    if (!value || typeof value.id !== 'string' || !/^evt_[\w-]{1,100}$/.test(value.id) || !webhookTypes.includes(value.type) || typeof value.data?.id !== 'string' || !/^sess_[\w-]{1,100}$/.test(value.data.id)) throw new Error('Invalid session notification');
    let result: { duplicate: boolean; event: any };
    const write = this.pending.then(async () => {
      const entries = await this.entries(); const found = entries.find(row => row.id === value.id);
      if (found) { result = { duplicate: true, event: found }; return; }
      if (entries.length >= 1000) throw new Error('Ledger retention limit');
      const event = { id: value.id, type: value.type, sessionId: value.data.id, receivedAt: new Date().toISOString(), outcome: value.type === 'agent.session.idle' ? 'Inspect turn; idle is not proof of success' : 'Delivery notification; inspect current session state' };
      await mkdir(dirname(this.file), { recursive: true }); await appendFile(this.file, JSON.stringify(event) + '\n', { encoding: 'utf8', mode: 0o600 }); result = { duplicate: false, event };
    });
    this.pending = write.catch(() => {}); await write; return result!;
  }
}
export function signFixture(raw: string, secret: string, id = randomUUID(), timestamp = Math.floor(Date.now() / 1000)) { const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64'); return { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`).digest('base64')}` }; }
