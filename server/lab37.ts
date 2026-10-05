import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import { localExecutorRequest } from './lab32.ts';
import { dockerExecutor } from './lab32Docker.ts';
import { retryExecutorCleanup } from './lab32Service.ts';
import { createRecoveryJob, executeRecovery, type RecoveryApi } from './lab37Service.ts';
import { configured, restricted, model, body, send, redact, requestId } from './courseLabHttp.ts';
import { runAdvancedSuite } from '../src/advancedLabTests.ts';
const jobs = new Map<string, { job: ReturnType<typeof createRecoveryJob>; controller: AbortController; done: Promise<void>; busy: boolean }>();
function apiAdapter(): RecoveryApi {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 0 });
  return {
    create: signal => client.beta.agents.sessions.create({ agent: { model: model(), instructions: 'List the fixed course workspace using a shell command and return the exact requested JSON. No subagents.' }, environment: { type: 'self_hosted', workspace_directory: '/workspace' } }, { signal }),
    stream: (id, signal) => client.beta.agents.sessions.events.stream(id, { signal, timeout: 310000 }),
    input: async (id, prompt, signal) => { await client.beta.agents.sessions.events.create(id, { 'Idempotency-Key': `lab37-${id}`, events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }] }, { signal }); },
    inspect: async (id, signal) => {
      const session = await client.beta.agents.sessions.retrieve(id, { signal });
      if (session.environment.type !== 'self_hosted') throw new Error('Unexpected environment');
      const [environment, turns, items] = await Promise.all([client.beta.agents.environments.retrieve(session.environment.id, { signal }), client.beta.agents.sessions.turns.list(id, { limit: 100, order: 'asc' }, { signal }), client.beta.agents.sessions.items.list(id, { limit: 100, order: 'asc' }, { signal })]);
      if (turns.has_more || items.has_more) throw new Error('Saved inventory exceeds recovery bound'); return { session, environment, turns: turns.data, items: items.data };
    },
    cancel: async id => { await client.beta.agents.sessions.events.create(id, { events: [{ type: 'agent.session.input.cancel' }] }); },
    delete: async id => { try { await client.beta.agents.sessions.delete(id); } catch (error) { if ((error as any).status !== 404) throw error; } },
  };
}
const provider = () => dockerExecutor(process.env.OPENAI_EXECUTOR_API_KEY!, 37, 'agents-lab32-executor:local');
export async function handleLab37(request: IncomingMessage, response: ServerResponse, path: string) {
  if (!localExecutorRequest(request)) return send(response, 403, { error: 'Use same-origin localhost.' });
  if (path.endsWith('/status') && request.method === 'GET') return send(response, 200, { enabled: process.env.LAB37_ENABLE_LOCAL_EXECUTOR === 'true', applicationKey: configured(), executorKey: restricted(), model: model() });
  if (path.endsWith('/test') && request.method === 'POST') return send(response, 200, { results: runAdvancedSuite(37) });
  if (path.endsWith('/job') && request.method === 'GET') { const id = new URL(request.url!, 'http://localhost').searchParams.get('id'); const entry = [...jobs.values()].find(row => row.job.id === id); return send(response, entry ? 200 : 404, entry ? { job: redact(entry.job) } : { error: 'Run not found in this process; use the exported mapping after a restart.' }); }
  if (request.method !== 'POST' || !['/api/lab37/run', '/api/lab37/stop', '/api/lab37/cleanup'].includes(path)) return send(response, 404, { error: 'Route not found' });
  let value: any; try { value = await body(request, ['requestId', 'fault', 'id']); } catch { return send(response, 400, { error: 'Send only fixed run options.' }); }
  if (path.endsWith('/run')) {
    if (!requestId(value.requestId) || !['none', 'stream'].includes(value.fault) || value.id !== undefined) return send(response, 400, { error: 'Supply requestId and fault none/stream.' });
    const previous = jobs.get(value.requestId); if (previous) return send(response, 200, { job: redact(previous.job) });
    if (!configured() || !restricted() || process.env.LAB37_ENABLE_LOCAL_EXECUTOR !== 'true') return send(response, 503, { error: 'Configure both keys and LAB37_ENABLE_LOCAL_EXECUTOR=true; restart and recheck.' });
    if ([...jobs.values()].some(row => row.job.status === 'running' || row.job.recovery.cleanup === 'failed')) return send(response, 409, { error: 'Resolve the existing run and cleanup first.' });
    if (jobs.size >= 20) return send(response, 429, { error: 'Run retention limit reached.' });
    const entry = { job: createRecoveryJob(randomUUID(), value.fault), controller: new AbortController(), done: Promise.resolve(), busy: false }; jobs.set(value.requestId, entry); entry.done = executeRecovery(entry.job, apiAdapter(), provider(), entry.controller); return send(response, 202, { job: redact(entry.job) });
  }
  const entry = [...jobs.values()].find(row => row.job.id === value.id); if (!entry) return send(response, 404, { error: 'Run not found' });
  if (path.endsWith('/stop')) { entry.controller.abort(); return send(response, 202, { job: redact(entry.job) }); }
  if (entry.job.status === 'running' || entry.busy) return send(response, 409, { error: 'Wait for run or cleanup to settle.' });
  entry.busy = true; try { await retryExecutorCleanup(entry.job, apiAdapter(), provider()); entry.job.recovery.cleanup = 'confirmed'; return send(response, 200, { job: redact(entry.job) }); } catch { return send(response, 502, { error: 'Cleanup remains unconfirmed.' }); } finally { entry.busy = false; }
}
export async function stopLab37() { for (const entry of jobs.values()) entry.controller.abort(); await Promise.allSettled([...jobs.values()].map(row => row.done)); }
