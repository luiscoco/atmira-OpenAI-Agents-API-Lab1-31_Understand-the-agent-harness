import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import { validSessionId } from '../src/lab31Harness.ts';
import { runHarnessSuite } from '../src/lab31Tests.ts';
import { inspectHarness, type InspectionApi } from './lab31Service.ts';
function send(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}
export async function handleLab31(request: IncomingMessage, response: ServerResponse, path: string) {
  if (path === '/api/lab31/test' && request.method === 'POST') { send(response, 200, { results: runHarnessSuite() }); return; }
  if (path !== '/api/lab31/inspect' || request.method !== 'GET') { send(response, 404, { error: 'Lab 31 route not found.' }); return; }
  const id = new URL(request.url ?? '/', 'http://localhost').searchParams.get('sessionId');
  if (!validSessionId(id)) { send(response, 400, { error: 'Enter a valid sess_ session ID.' }); return; }
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_api_key_here') { send(response, 503, { error: 'Configure OPENAI_API_KEY on the server for live inspection. Practice and teaching work without it.' }); return; }
  try {
    const api = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 15_000, maxRetries: 0 });
    const reader: InspectionApi = {
      retrieve: id => api.beta.agents.sessions.retrieve(id),
      turns: (id, after) => api.beta.agents.sessions.turns.list(id, { order: 'asc', limit: 100, ...(after ? { after } : {}) }),
      items: (id, after) => api.beta.agents.sessions.items.list(id, { order: 'asc', limit: 100, ...(after ? { after } : {}) }),
    };
    send(response, 200, { trace: await inspectHarness(reader, id) });
  } catch (error) {
    const status = (error as { status?: number }).status;
    send(response, status === 404 ? 404 : status === 403 ? 403 : 502, { error: status === 404 ? 'Session not found in the configured project.' : status === 403 ? 'The API key cannot read this session.' : 'Saved-state inspection failed. Check server access and try again.' });
  }
}
