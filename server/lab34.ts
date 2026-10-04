import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { localExecutorRequest } from './lab32.ts';
import { dockerExecutor } from './lab32Docker.ts';
import { createExecutorJob, executeListing, publicExecutorJob, retryExecutorCleanup, type ExecutorJob, type ExecutorApi } from './lab32Service.ts';
import { skillEnvironment, skillImage, skillPrompt, type SkillTask } from '../src/lab34Skills.ts';
import { runSkillSuite } from '../src/lab34Tests.ts';
export type SkillJob = ExecutorJob & { task: SkillTask; registered: boolean; capabilityDirectories: string[] };
const jobs = new Map<string, { job: SkillJob; controller: AbortController; done: Promise<void> }>();
const cleanupLocks = new Set<string>();
const configured = (value?: string) => Boolean(value?.trim() && !['your_api_key_here', 'your_environment_key_here'].includes(value));
const settings = () => ({ enabled: process.env.LAB34_ENABLE_LOCAL_EXECUTOR === 'true', applicationKey: configured(process.env.OPENAI_API_KEY), executorKey: configured(process.env.OPENAI_EXECUTOR_API_KEY) && process.env.OPENAI_EXECUTOR_API_KEY !== process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-5.6-terra' });
function send(response: ServerResponse, status: number, body: unknown) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(body)); }
function apiAdapter(registered: boolean): ExecutorApi {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 0 });
  return {
    create: signal => client.beta.agents.sessions.create({ agent: { model: settings().model, instructions: 'Complete the user task using available capabilities where relevant. Ground file reports in observed command output. Keep input files unchanged.' }, environment: skillEnvironment(registered) }, { signal }),
    stream: (id, signal) => client.beta.agents.sessions.events.stream(id, { signal, timeout: 310_000 }),
    input: async (id, prompt, signal) => { await client.beta.agents.sessions.events.create(id, { events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }] }, { signal }); },
    cancel: async id => { await client.beta.agents.sessions.events.create(id, { events: [{ type: 'agent.session.input.cancel' }] }); },
    delete: async id => { try { await client.beta.agents.sessions.delete(id); } catch (error) { if ((error as { status?: number }).status !== 404) throw error; } },
  };
}
const provider = () => dockerExecutor(process.env.OPENAI_EXECUTOR_API_KEY!, 34, skillImage);
const view = (job: SkillJob) => publicExecutorJob(job, [process.env.OPENAI_API_KEY ?? '', process.env.OPENAI_EXECUTOR_API_KEY ?? '']);
export async function skillBundle() {
  return Promise.all(['SKILL.md', 'references/report-contract.md', 'scripts/report.mjs'].map(async path => ({ path, content: await readFile(new URL(`../sandbox/lab34/skills/course-sales-report/${path}`, import.meta.url), 'utf8') })));
}
export async function handleLab34(request: IncomingMessage, response: ServerResponse, path: string) {
  if (!localExecutorRequest(request)) { send(response, 403, { error: 'Use a same-origin localhost connection for Lab 34.' }); return; }
  if (path === '/api/lab34/status' && request.method === 'GET') { send(response, 200, settings()); return; }
  if (path === '/api/lab34/skill' && request.method === 'GET') { try { send(response, 200, { files: await skillBundle() }); } catch { send(response, 502, { error: 'The bundled skill files could not be read.' }); } return; }
  if (path === '/api/lab34/test' && request.method === 'POST') { send(response, 200, { results: runSkillSuite() }); return; }
  if (path === '/api/lab34/job' && request.method === 'GET') {
    const id = new URL(request.url!, 'http://localhost').searchParams.get('id'); const entry = [...jobs.values()].find(entry => entry.job.id === id);
    send(response, entry ? 200 : 404, entry ? { job: view(entry.job) } : { error: 'Run not found in this server process.' }); return;
  }
  if (request.method !== 'POST' || !['/api/lab34/run', '/api/lab34/stop', '/api/lab34/cleanup'].includes(path)) { send(response, 404, { error: 'Lab 34 route not found.' }); return; }
  let body: Record<string, unknown>;
  try { let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 1000) throw new Error('Size limit.'); } body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid object.'); }
  catch { send(response, 400, { error: 'Send a small JSON object.' }); return; }
  if (path === '/api/lab34/run') {
    const { requestId, task, registered } = body;
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId) || !['revenue', 'unrelated'].includes(String(task)) || typeof registered !== 'boolean' || Object.keys(body).some(key => !['requestId', 'task', 'registered'].includes(key))) { send(response, 400, { error: 'Supply requestId, a fixture task and a registration boolean. Image, skill and paths are fixed.' }); return; }
    const previous = jobs.get(requestId); if (previous) { send(response, 200, { job: view(previous.job) }); return; }
    const config = settings(); if (!config.enabled || !config.applicationKey || !config.executorKey) { send(response, 503, { error: 'Configure both distinct keys and LAB34_ENABLE_LOCAL_EXECUTOR=true in .env, then restart the server.' }); return; }
    if ([...jobs.values()].some(entry => entry.job.status === 'running' || entry.job.trace.cleanup === 'failed' || entry.job.sessionCleanup === 'failed')) { send(response, 409, { error: 'Finish the current Lab 34 run and resolve cleanup first.' }); return; }
    if (jobs.size >= 20) { send(response, 429, { error: '20 run IDs retained. Restart after confirming cleanup.' }); return; }
    const job: SkillJob = { ...createExecutorJob(randomUUID(), 34), task: task as SkillTask, registered, capabilityDirectories: skillEnvironment(registered).capability_directories };
    const entry = { job, controller: new AbortController(), done: Promise.resolve() }; jobs.set(requestId, entry);
    entry.done = executeListing(job, apiAdapter(registered), provider(), entry.controller, undefined, () => skillPrompt(job.task));
    send(response, 202, { job: view(job) }); return;
  }
  const entry = [...jobs.values()].find(entry => entry.job.id === body.id); if (!entry) { send(response, 404, { error: 'Run not found.' }); return; }
  if (path === '/api/lab34/stop') { entry.controller.abort(); send(response, 202, { job: view(entry.job) }); return; }
  if (entry.job.status === 'running' || cleanupLocks.has(entry.job.id)) { send(response, 409, { error: 'Wait for the run or cleanup to settle.' }); return; }
  cleanupLocks.add(entry.job.id);
  try { await retryExecutorCleanup(entry.job, apiAdapter(entry.job.registered), provider()); send(response, 200, { job: view(entry.job) }); }
  catch { send(response, 502, { error: 'Cleanup remains unconfirmed. Check the exact named container and saved session ID.' }); }
  finally { cleanupLocks.delete(entry.job.id); }
}
export async function stopLab34() { for (const entry of jobs.values()) entry.controller.abort(); await Promise.allSettled([...jobs.values()].map(entry => entry.done)); }
