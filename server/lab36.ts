import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { localExecutorRequest } from './lab32.ts';
import { dockerExecutor } from './lab32Docker.ts';
import { createExecutorJob, executeListing, publicExecutorJob, retryExecutorCleanup, type ExecutorJob, type ExecutorApi } from './lab32Service.ts';
import { privateMcpImage, privateMcpTool, inventoryPrompt } from '../src/lab36Mcp.ts';
import { runAdvancedSuite } from '../src/advancedLabTests.ts';
export type McpJob = ExecutorJob & { origin: 'environment' | 'service'; mcpCalls: any[] };
const jobs = new Map<string, { job: McpJob; controller: AbortController; done: Promise<void> }>();
const cleanupLocks = new Set<string>();
const configured = (value?: string) => Boolean(value?.trim() && !['your_api_key_here', 'your_environment_key_here'].includes(value));
const settings = () => ({ enabled: process.env.LAB36_ENABLE_LOCAL_EXECUTOR === 'true', applicationKey: configured(process.env.OPENAI_API_KEY), executorKey: configured(process.env.OPENAI_EXECUTOR_API_KEY) && process.env.OPENAI_EXECUTOR_API_KEY !== process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-5.6-terra' });
function send(response: ServerResponse, status: number, body: unknown) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(body)); }
function apiAdapter(origin: 'environment' | 'service'): ExecutorApi {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 0 });
  return {
    create: signal => client.beta.agents.sessions.create({ agent: { model: settings().model, instructions: 'Use only the private_inventory MCP tool for the inventory task. Report observed output.', tools: [privateMcpTool(origin)] }, environment: { type: 'self_hosted', workspace_directory: '/workspace' } }, { signal }),
    stream: (id, signal) => client.beta.agents.sessions.events.stream(id, { signal, timeout: 310_000 }),
    input: async (id, prompt, signal) => { await client.beta.agents.sessions.events.create(id, { events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }] }, { signal }); },
    cancel: async id => { await client.beta.agents.sessions.events.create(id, { events: [{ type: 'agent.session.input.cancel' }] }); },
    delete: async id => { try { await client.beta.agents.sessions.delete(id); } catch (error) { if ((error as { status?: number }).status !== 404) throw error; } },
  };
}
const provider = () => dockerExecutor(process.env.OPENAI_EXECUTOR_API_KEY!, 36, privateMcpImage);
const view = (job: McpJob) => publicExecutorJob(job, [process.env.OPENAI_API_KEY ?? '', process.env.OPENAI_EXECUTOR_API_KEY ?? '']);
export async function probeBundle() { return readFile(new URL('../sandbox/lab36/mcp.mjs', import.meta.url), 'utf8'); }
export async function handleLab36(request: IncomingMessage, response: ServerResponse, path: string) {
  if (!localExecutorRequest(request)) { send(response, 403, { error: 'Use a same-origin localhost connection for Lab 36.' }); return; }
  if (path === '/api/lab36/status' && request.method === 'GET') { send(response, 200, settings()); return; }
  if (path === '/api/lab36/probe' && request.method === 'GET') { try { send(response, 200, { source: await probeBundle() }); } catch { send(response, 502, { error: 'The fixed probe could not be read.' }); } return; }
  if (path === '/api/lab36/test' && request.method === 'POST') { send(response, 200, { results: runAdvancedSuite(36) }); return; }
  if (path === '/api/lab36/job' && request.method === 'GET') {
    const id = new URL(request.url!, 'http://localhost').searchParams.get('id'); const entry = [...jobs.values()].find(entry => entry.job.id === id);
    send(response, entry ? 200 : 404, entry ? { job: view(entry.job) } : { error: 'Run not found in this server process.' }); return;
  }
  if (request.method !== 'POST' || !['/api/lab36/run', '/api/lab36/stop', '/api/lab36/cleanup'].includes(path)) { send(response, 404, { error: 'Lab 36 route not found.' }); return; }
  let body: Record<string, unknown>;
  try { let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 1000) throw new Error('Size limit.'); } body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid object.'); }
  catch { send(response, 400, { error: 'Send a small JSON object.' }); return; }
  if (path === '/api/lab36/run') {
    const requestId = body.requestId; const origin = body.origin as 'environment' | 'service';
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId) || !['environment', 'service'].includes(String(origin)) || Object.keys(body).some(key => !['requestId', 'origin'].includes(key))) { send(response, 400, { error: 'Supply requestId and environment/service origin. Image and endpoint are fixed.' }); return; }
    const previous = jobs.get(requestId); if (previous) { send(response, 200, { job: view(previous.job) }); return; }
    const config = settings(); if (!config.enabled || !config.applicationKey || !config.executorKey) { send(response, 503, { error: 'Configure both distinct keys and LAB36_ENABLE_LOCAL_EXECUTOR=true in .env, then restart the server.' }); return; }
    if ([...jobs.values()].some(entry => entry.job.status === 'running' || entry.job.trace.cleanup === 'failed' || entry.job.sessionCleanup === 'failed')) { send(response, 409, { error: 'Finish the current Lab 36 run and resolve cleanup first.' }); return; }
    if (jobs.size >= 20) { send(response, 429, { error: '20 run IDs retained. Restart after confirming cleanup.' }); return; }
    const job: McpJob = { ...createExecutorJob(randomUUID(), 36), origin, mcpCalls: [] };
    const entry = { job, controller: new AbortController(), done: Promise.resolve() }; jobs.set(requestId, entry);
    entry.done = executeListing(job, apiAdapter(origin), provider(), entry.controller, undefined, () => inventoryPrompt, event => { if (event.type === 'agent.session.turn.item.done' && event.item?.type === 'mcp_call' && job.mcpCalls.length < 100) job.mcpCalls.push(event.item); });
    send(response, 202, { job: view(job) }); return;
  }
  const entry = [...jobs.values()].find(entry => entry.job.id === body.id); if (!entry) { send(response, 404, { error: 'Run not found.' }); return; }
  if (path === '/api/lab36/stop') { entry.controller.abort(); send(response, 202, { job: view(entry.job) }); return; }
  if (entry.job.status === 'running' || cleanupLocks.has(entry.job.id)) { send(response, 409, { error: 'Wait for the run or cleanup to settle.' }); return; }
  cleanupLocks.add(entry.job.id);
  try { await retryExecutorCleanup(entry.job, apiAdapter(entry.job.origin), provider()); send(response, 200, { job: view(entry.job) }); }
  catch { send(response, 502, { error: 'Cleanup remains unconfirmed. Check the exact named container and saved session ID.' }); }
  finally { cleanupLocks.delete(entry.job.id); }
}
export async function stopLab36() { for (const entry of jobs.values()) entry.controller.abort(); await Promise.allSettled([...jobs.values()].map(entry => entry.done)); }
