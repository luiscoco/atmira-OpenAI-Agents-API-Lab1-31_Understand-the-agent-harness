import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';

const agentIdPattern = /^agent_[A-Za-z0-9_-]+$/;
const configured = () => Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_api_key_here');
const client = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function writeEvent(response: ServerResponse, event: unknown) {
  response.write(`${JSON.stringify(event)}\n`);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 12_000) throw new Error('Request is too large.');
  }
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
}

function validAgentId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && agentIdPattern.test(value);
}

function summary(agent: { id: string; name: string | null; model: string; instructions: string | null }) {
  return { id: agent.id, name: agent.name || 'Unnamed agent', model: agent.model, instructions: agent.instructions || '' };
}

export async function createLab7Agent(request: IncomingMessage, response: ServerResponse, model: string) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); }
  catch { return sendJson(response, 400, { error: 'Send a valid JSON object with a name and instructions.' }); }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
  if (!name || name.length > 80) return sendJson(response, 400, { error: 'Name must be between 1 and 80 characters.' });
  if (!instructions || instructions.length > 4000) return sendJson(response, 400, { error: 'Instructions must be between 1 and 4,000 characters.' });
  try {
    const agent = await client().beta.agents.create({ name, model, instructions });
    sendJson(response, 201, { agent: summary(agent) });
  } catch (error) {
    sendJson(response, 502, { error: error instanceof Error ? error.message : 'Could not save the agent.' });
  }
}

export async function retrieveLab7Agent(request: IncomingMessage, response: ServerResponse) {
  const agentId = new URL(request.url || '/', 'http://localhost').searchParams.get('agentId');
  if (!validAgentId(agentId)) return sendJson(response, 400, { error: 'Invalid agent ID.' });
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  try {
    const agent = await client().beta.agents.retrieve(agentId);
    sendJson(response, 200, { agent: summary(agent) });
  } catch (error) {
    const status = error instanceof OpenAI.APIError && error.status === 404 ? 404 : 502;
    sendJson(response, status, { error: error instanceof Error ? error.message : 'Could not retrieve the agent.' });
  }
}

export async function runLab7(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); }
  catch { return sendJson(response, 400, { error: 'Send a valid JSON object with an agent ID and prompt.' }); }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!validAgentId(body.agentId)) return sendJson(response, 400, { error: 'Invalid agent ID.' });
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });

  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });

  let stream;
  let completed = false;
  let sessionId = '';
  const parts = new Map<string, string>();
  try {
    writeEvent(response, { type: 'status', label: 'Starting a new session from the saved agent' });
    stream = await client().beta.agents.sessions.create({
      agent_id: body.agentId,
      environment: { type: 'none' },
      input: prompt,
      stream: true,
    });
    for await (const event of stream) {
      if (response.destroyed) break;
      if (!sessionId && event.session_id) {
        sessionId = event.session_id;
        writeEvent(response, { type: 'session', sessionId });
      }
      if (event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') {
        const key = `${event.item_id}:${event.output_index}:${event.content_index}`;
        const value = event.type === 'agent.session.turn.output_text.delta'
          ? (parts.get(key) || '') + event.delta : event.text;
        parts.set(key, value);
        writeEvent(response, { type: 'text', text: [...parts.values()].join('\n') });
      } else if (event.type === 'agent.session.turn.completed' && event.turn?.subagent_id == null) {
        if (!sessionId) throw new Error('The turn completed without a session ID.');
        completed = true;
        writeEvent(response, { type: 'complete' });
        break;
      } else if (event.type === 'agent.session.turn.failed' && event.turn?.subagent_id == null) {
        throw new Error(event.turn.error?.message || 'The agent turn failed.');
      } else if (event.type === 'agent.session.turn.cancelled' && event.turn?.subagent_id == null) {
        throw new Error('The agent turn was cancelled.');
      } else if (event.type === 'error') {
        throw new Error(event.error?.message || 'The agent returned an error.');
      } else if (event.type === 'agent.session.failed' || event.type === 'agent.session.environment.failed') {
        throw new Error('The agent session failed.');
      }
    }
    if (!completed && !response.destroyed) throw new Error('The stream closed before the turn completed.');
  } catch (error) {
    if (!response.destroyed) writeEvent(response, { type: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
  } finally {
    stream?.controller?.abort();
    if (!response.destroyed) response.end();
  }
}
