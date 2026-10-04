import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import { localExecutorRequest } from './lab32.ts';
import { validateOptions } from '../src/lab33Rules.ts';
import { runRulesSuite } from '../src/lab33Tests.ts';
import { runRuleArm, type RulesApi } from './lab33Service.ts';
let comparing = false;
function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(body));
}
export async function handleLab33(request: IncomingMessage, response: ServerResponse, path: string) {
  if (!localExecutorRequest(request)) { send(response, 403, { error: 'Use the same-origin localhost course server.' }); return; }
  if (path === '/api/lab33/test' && request.method === 'POST') { send(response, 200, { results: runRulesSuite() }); return; }
  if (path === '/api/lab33/status' && request.method === 'GET') { send(response, 200, { configured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_api_key_here'), model: process.env.OPENAI_MODEL || 'gpt-5.6-terra' }); return; }
  if (path !== '/api/lab33/compare' || request.method !== 'POST') { send(response, 404, { error: 'Lab 33 route not found.' }); return; }
  let options: ReturnType<typeof validateOptions>;
  try { let raw = ''; for await (const chunk of request) { raw += chunk; if (Buffer.byteLength(raw) > 20_000) throw new Error('Size limit.'); } options = validateOptions(JSON.parse(raw)); }
  catch { send(response, 400, { error: 'Send valid fixture options and 1–4000 characters of repository guidance.' }); return; }
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_api_key_here') { send(response, 503, { error: 'Configure OPENAI_API_KEY in .env and restart the server. Practice works without a key.' }); return; }
  if (comparing) { send(response, 409, { error: 'A Lab 33 comparison is already running.' }); return; }
  comparing = true;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 120_000);
  const stop = () => { if (!response.writableEnded) controller.abort(); }; response.on('close', stop);
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 0 });
    const api: RulesApi = {
      create: (instructions, input, signal) => client.beta.agents.sessions.create({ agent: { model: process.env.OPENAI_MODEL || 'gpt-5.6-terra', instructions }, environment: { type: 'none' }, input, stream: true }, { signal, timeout: 125_000 }),
      cancel: async id => { await client.beta.agents.sessions.events.create(id, { events: [{ type: 'agent.session.input.cancel' }] }); },
      delete: async id => { try { await client.beta.agents.sessions.delete(id); } catch (error) { if ((error as { status?: number }).status !== 404) throw error; } },
    };
    const results = [];
    for (const guided of [false, true]) { if (controller.signal.aborted) break; results.push(await runRuleArm(options, guided, api, controller.signal)); }
    // The browser gets fixture guidance and evidence, never environment credentials.
    let body = JSON.stringify({ options, results });
    for (const secret of [process.env.OPENAI_API_KEY, process.env.OPENAI_EXECUTOR_API_KEY].filter(Boolean)) body = body.split(JSON.stringify(secret).slice(1, -1)).join('[redacted]');
    if (!response.destroyed) send(response, 200, JSON.parse(body));
  } catch { if (!response.destroyed) send(response, 502, { error: 'Comparison failed. Check the server and try again.' }); }
  finally { clearTimeout(timer); response.off('close', stop); comparing = false; }
}
