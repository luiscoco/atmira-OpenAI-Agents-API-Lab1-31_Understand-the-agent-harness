import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import { localExecutorRequest } from './lab32.ts';
import { configured, model, body, send, redact, requestId } from './courseLabHttp.ts';
import { createDelegationJob, executeDelegation, type DelegationApi } from './delegationService.ts';
import { runAdvancedSuite } from '../src/advancedLabTests.ts';
const jobs = new Map<string, { job: ReturnType<typeof createDelegationJob>; controller: AbortController; done: Promise<void>; cleaning: boolean }>();
function apiAdapter(): DelegationApi {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 0 });
  return {
    create: (request, signal) => client.beta.agents.sessions.create(request, { signal, timeout: 185000 }),
    inspect: async (id, signal) => {
      const [turns, items, children] = await Promise.all([client.beta.agents.sessions.turns.list(id, { limit: 100, order: 'asc' }, { signal }), client.beta.agents.sessions.items.list(id, { limit: 100, order: 'asc' }, { signal }), client.beta.agents.sessions.subagents.list(id, { limit: 100, order: 'asc' }, { signal })]);
      if (turns.has_more || items.has_more || children.has_more || children.data.length > 10) throw new Error('Saved inventory exceeds the course bound');
      const childState = await Promise.all(children.data.map(async child => { const [messages, history] = await Promise.all([client.beta.agents.sessions.subagents.items.list(child.id, { session_id: id, limit: 100, order: 'asc' }, { signal }), client.beta.agents.sessions.subagents.turns.list(child.id, { session_id: id, limit: 100, order: 'asc' }, { signal })]); if (messages.has_more || history.has_more) throw new Error('Child inventory exceeds course bound'); return { items: messages.data, turns: history.data }; }));
      return { turns: [...turns.data, ...childState.flatMap(row => row.turns)], items: [...items.data, ...childState.flatMap(row => row.items)], children: children.data };
    },
    cancel: async id => { await client.beta.agents.sessions.events.create(id, { events: [{ type: 'agent.session.input.cancel' }] }); },
    delete: async id => { try { await client.beta.agents.sessions.delete(id); } catch (error) { if ((error as any).status !== 404) throw error; } },
  };
}
export async function handleDelegationLab(request: IncomingMessage, response: ServerResponse, path: string, lab: 39 | 40) {
  if (!localExecutorRequest(request)) return send(response, 403, { error: 'Use same-origin localhost.' });
  const prefix = `/api/lab${lab}`;
  if (path === `${prefix}/status` && request.method === 'GET') return send(response, 200, { applicationKey: configured(), model: model() });
  if (path === `${prefix}/test` && request.method === 'POST') return send(response, 200, { results: runAdvancedSuite(lab) });
  if (path === `${prefix}/job` && request.method === 'GET') { const id = new URL(request.url!, 'http://localhost').searchParams.get('id'); const entry = [...jobs.values()].find(row => row.job.id === id && row.job.lab === lab); return send(response, entry ? 200 : 404, entry ? { job: redact(entry.job) } : { error: 'Run not found in this process.' }); }
  if (request.method !== 'POST' || !['run', 'stop', 'cleanup'].some(action => path === `${prefix}/${action}`)) return send(response, 404, { error: 'Route not found' });
  let value: any; try { value = await body(request, ['requestId', 'enabled', 'failure', 'id']); } catch { return send(response, 400, { error: 'Only fixed delegation options are accepted.' }); }
  if (path.endsWith('/run')) {
    if (!requestId(value.requestId) || typeof value.enabled !== 'boolean' || typeof value.failure !== 'boolean' || (lab === 39 && value.failure) || value.id !== undefined) return send(response, 400, { error: 'Supply requestId, enabled and a valid failure boolean. Sources and concurrency are fixed.' });
    const previous = jobs.get(`${lab}:${value.requestId}`); if (previous) return send(response, 200, { job: redact(previous.job) });
    if (!configured()) return send(response, 503, { error: 'Configure OPENAI_API_KEY and restart. Synthetic practice needs no key.' });
    if ([...jobs.values()].some(row => row.job.status === 'running' || row.job.trace.cleanup === 'failed')) return send(response, 409, { error: 'Settle the current delegation run and cleanup first.' });
    if (jobs.size >= 40) return send(response, 429, { error: 'Run retention limit reached.' });
    const entry = { job: createDelegationJob(randomUUID(), lab, value.enabled, value.failure), controller: new AbortController(), done: Promise.resolve(), cleaning: false }; jobs.set(`${lab}:${value.requestId}`, entry); entry.done = executeDelegation(entry.job, apiAdapter(), model(), entry.controller); return send(response, 202, { job: redact(entry.job) });
  }
  const entry = [...jobs.values()].find(row => row.job.id === value.id && row.job.lab === lab); if (!entry) return send(response, 404, { error: 'Run not found' });
  if (path.endsWith('/stop')) { entry.controller.abort(); return send(response, 202, { job: redact(entry.job) }); }
  if (entry.job.status === 'running' || entry.cleaning) return send(response, 409, { error: 'Wait for the operation to settle.' });
  entry.cleaning = true; try { if (entry.job.trace.sessionId && entry.job.trace.cleanup === 'failed') { await apiAdapter().delete(entry.job.trace.sessionId); entry.job.trace.cleanup = 'deleted'; } return send(response, 200, { job: redact(entry.job) }); } catch { return send(response, 502, { error: 'Session cleanup remains unconfirmed.' }); } finally { entry.cleaning = false; }
}
export async function stopDelegationLabs() { for (const entry of jobs.values()) entry.controller.abort(); await Promise.allSettled([...jobs.values()].map(row => row.done)); }
