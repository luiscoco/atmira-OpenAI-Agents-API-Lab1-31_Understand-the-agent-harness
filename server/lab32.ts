import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { environmentRequest } from '../src/lab32Environment.ts';
import { runExecutorSuite } from '../src/lab32Tests.ts';
import { dockerExecutor } from './lab32Docker.ts';
import { createExecutorJob, executeListing, publicExecutorJob, retryExecutorCleanup, type ExecutorApi, type ExecutorJob } from './lab32Service.ts';

const jobs = new Map<string, { job: ExecutorJob; controller: AbortController; done: Promise<void> }>();
const cleanupLocks = new Set<string>();
const configured = (key: string | undefined) => Boolean(key && key !== 'your_api_key_here' && key !== 'your_environment_key_here');
function settings() {
  return { enabled: process.env.LAB32_ENABLE_LOCAL_EXECUTOR === 'true',
    applicationKey: configured(process.env.OPENAI_API_KEY), executorKey: configured(process.env.OPENAI_EXECUTOR_API_KEY) && process.env.OPENAI_EXECUTOR_API_KEY !== process.env.OPENAI_API_KEY };
}
function apiAdapter(): ExecutorApi {
  const api = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 0 });
  return {
    create: signal => api.beta.agents.sessions.create({ agent: { model: process.env.OPENAI_MODEL || 'gpt-5.6-terra', instructions: 'Use the shell to inspect /workspace. Read files only. Return the requested JSON from observed command output.' }, environment: environmentRequest }, { signal }),
    stream: (id, signal) => api.beta.agents.sessions.events.stream(id, { signal, timeout: 310_000 }),
    input: async (id, prompt, signal) => { await api.beta.agents.sessions.events.create(id, { events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }] }, { signal }); },
    cancel: async id => { await api.beta.agents.sessions.events.create(id, { events: [{ type: 'agent.session.input.cancel' }] }); },
    delete: async id => { try { await api.beta.agents.sessions.delete(id); } catch (error) { if ((error as { status?: number }).status !== 404) throw error; } },
  };
}
export function localExecutorRequest(request: Pick<IncomingMessage, 'headers' | 'socket'>): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) return false;
  try {
    const url = new URL(`http://${request.headers.host}`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) return false;
    if (request.headers.origin && request.headers.origin !== url.origin) return false;
    if (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(request.headers['sec-fetch-site']))) return false;
    return true;
  } catch { return false; }
}
function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of request) { raw += chunk; if (raw.length > 1000) throw new Error('Body too large.'); }
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body.');
  return value;
}
const view = (job: ExecutorJob) => publicExecutorJob(job, [process.env.OPENAI_API_KEY ?? '', process.env.OPENAI_EXECUTOR_API_KEY ?? '']);
export async function handleLab32(request: IncomingMessage, response: ServerResponse, path: string) {
  if (!localExecutorRequest(request)) { send(response, 403, { error: 'Lab 32 executor controls are available only through a same-origin localhost connection.' }); return; }
  if (path === '/api/lab32/status' && request.method === 'GET') { send(response, 200, { ...settings(), model: process.env.OPENAI_MODEL || 'gpt-5.6-terra' }); return; }
  if (path === '/api/lab32/test' && request.method === 'POST') { send(response, 200, { results: runExecutorSuite() }); return; }
  if (path === '/api/lab32/job' && request.method === 'GET') {
    const query = new URL(request.url!, 'http://localhost').searchParams;
    const id = query.get('id'); const requestId = query.get('requestId');
    const entry = requestId ? jobs.get(requestId) : [...jobs.values()].find(entry => entry.job.id === id);
    send(response, entry ? 200 : 404, entry ? { job: view(entry.job) } : { error: 'Run not found in this server process.' }); return;
  }
  if (!['/api/lab32/run', '/api/lab32/stop', '/api/lab32/cleanup'].includes(path) || request.method !== 'POST') { send(response, 404, { error: 'Lab 32 route not found.' }); return; }
  let input: Record<string, unknown>;
  try { input = await body(request); } catch { send(response, 400, { error: 'Send a small JSON object.' }); return; }
  if (path === '/api/lab32/run') {
    const requestId = input.requestId;
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId) || Object.keys(input).some(key => key !== 'requestId')) { send(response, 400, { error: 'Supply only a valid requestId. The task and image are fixed by the server.' }); return; }
    const previous = jobs.get(requestId);
    if (previous) { send(response, 200, { job: view(previous.job) }); return; }
    const config = settings();
    if (!config.enabled || !config.applicationKey || !config.executorKey) { send(response, 503, { error: 'Configure both keys and LAB32_ENABLE_LOCAL_EXECUTOR=true on the server; restart it before running.' }); return; }
    if ([...jobs.values()].some(entry => entry.job.status === 'running' || entry.job.trace.cleanup === 'failed' || entry.job.sessionCleanup === 'failed')) { send(response, 409, { error: 'Finish the current run and resolve its cleanup before starting another.' }); return; }
    if (jobs.size >= 20) { send(response, 429, { error: 'This teaching server retains 20 run IDs for deduplication. Restart after confirming cleanup to start more.' }); return; }
    const job = createExecutorJob(randomUUID()); const controller = new AbortController();
    const entry = { job, controller, done: Promise.resolve() };
    jobs.set(requestId, entry);
    entry.done = executeListing(job, apiAdapter(), dockerExecutor(process.env.OPENAI_EXECUTOR_API_KEY!), controller);
    send(response, 202, { job: view(job) }); return;
  }
  const entry = [...jobs.values()].find(entry => entry.job.id === input.id);
  if (!entry) { send(response, 404, { error: 'Run not found.' }); return; }
  if (path === '/api/lab32/stop') { entry.controller.abort(); send(response, 202, { job: view(entry.job) }); return; }
  if (entry.job.status !== 'finished' || cleanupLocks.has(entry.job.id)) { send(response, 409, { error: 'Wait for the current run or cleanup to finish.' }); return; }
  cleanupLocks.add(entry.job.id);
  try {
    await retryExecutorCleanup(entry.job, apiAdapter(), dockerExecutor(process.env.OPENAI_EXECUTOR_API_KEY!));
    send(response, 200, { job: view(entry.job) });
  } catch { send(response, 502, { error: 'Cleanup is still unconfirmed. Remove the exact named container and check the saved session with Lab 30.' }); }
  finally { cleanupLocks.delete(entry.job.id); }
}
export async function stopLab32() {
  for (const entry of jobs.values()) entry.controller.abort();
  await Promise.allSettled([...jobs.values()].map(entry => entry.done));
}
