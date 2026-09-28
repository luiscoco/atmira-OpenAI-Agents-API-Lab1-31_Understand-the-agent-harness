import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';

const agentIdPattern = /^agent_[A-Za-z0-9_-]+$/;
const client = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function writeEvent(response: ServerResponse, event: unknown) {
  response.write(`${JSON.stringify(event)}\n`);
}

export async function runLab8(request: IncomingMessage, response: ServerResponse) {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_api_key_here') {
    return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  }
  let body: Record<string, unknown>;
  try {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 12_000) throw new Error('Request is too large.');
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Expected an object.');
    body = parsed as Record<string, unknown>;
  } catch {
    return sendJson(response, 400, { error: 'Send a valid JSON object.' });
  }
  const agentId = body.agentId;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const mode = body.mode;
  const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
  if (typeof agentId !== 'string' || agentId.length > 200 || !agentIdPattern.test(agentId)) {
    return sendJson(response, 400, { error: 'Invalid agent ID.' });
  }
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });
  if (mode !== 'baseline' && mode !== 'override') return sendJson(response, 400, { error: 'Choose baseline or override.' });
  if (mode === 'override' && (!instructions || instructions.length > 4000)) {
    return sendJson(response, 400, { error: 'Override instructions must be between 1 and 4,000 characters.' });
  }

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
    writeEvent(response, { type: 'status', label: mode === 'override' ? 'Starting session with an override' : 'Starting session with saved settings' });
    stream = await client().beta.agents.sessions.create({
      agent_id: agentId,
      ...(mode === 'override' ? { agent: { instructions } } : {}),
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
