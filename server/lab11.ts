import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';

type AgentConfig = { model: string; instructions: string };

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};
const writeEvent = (response: ServerResponse, event: unknown) => {
  if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`);
};
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 12_000) throw new Error('Request is too large.');
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  return parsed as Record<string, unknown>;
}

export async function runLab11(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_api_key_here') return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let prompt = '';
  try {
    const body = await readBody(request);
    prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  } catch {
    return sendJson(response, 400, { error: 'Send a valid JSON request with a prompt.' });
  }
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });

  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let stream: Awaited<ReturnType<typeof api.beta.agents.sessions.events.stream>> | undefined;
  let sessionId = '';
  let completed = false;
  const subagentTurns = new Set<string>();
  const isRoot = (turnId: string | null) => !turnId || !subagentTurns.has(turnId);

  try {
    writeEvent(response, { type: 'status', label: 'Starting agent session' });
    stream = await api.beta.agents.sessions.create({ agent, environment: { type: 'none' }, input: prompt, stream: true });
    for await (const event of stream) {
      if (response.destroyed) return;
      const eventSessionId = event.type === 'agent.session.created' ? event.session.id : 'session_id' in event ? event.session_id : '';
      if (!sessionId && eventSessionId) { sessionId = eventSessionId; writeEvent(response, { type: 'session', sessionId }); }

      // Forward only the fields the text reducer needs, and only for the root turn.
      if (event.type === 'agent.session.turn.created' && event.turn.subagent_id != null) subagentTurns.add(event.turn.id);
      else if ((event.type === 'agent.session.turn.item.added' || event.type === 'agent.session.turn.item.done') && isRoot(event.turn_id)) {
        const item = event.item;
        if (item.type !== 'message' || !('role' in item) || item.role !== 'assistant' || !('phase' in item)) continue;
        const base = { eventId: event.event_id, itemId: item.id, outputIndex: event.output_index ?? 0, phase: item.phase };
        writeEvent(response, { type: 'text-event', event: event.type === 'agent.session.turn.item.added' ? { ...base, type: 'item.added' } : { ...base, type: 'item.done', parts: item.content.map((part) => part.text) } });
      } else if ((event.type === 'agent.session.turn.content_part.added' || event.type === 'agent.session.turn.content_part.done') && isRoot(event.turn_id)) {
        writeEvent(response, { type: 'text-event', event: { type: event.type === 'agent.session.turn.content_part.added' ? 'part.added' : 'part.done', eventId: event.event_id, itemId: event.item_id, outputIndex: event.output_index, contentIndex: event.content_index, text: event.part.text } });
      } else if (event.type === 'agent.session.turn.output_text.delta' && isRoot(event.turn_id)) {
        writeEvent(response, { type: 'text-event', event: { type: 'text.delta', eventId: event.event_id, itemId: event.item_id, outputIndex: event.output_index, contentIndex: event.content_index, delta: event.delta } });
      } else if (event.type === 'agent.session.turn.output_text.done' && isRoot(event.turn_id)) {
        writeEvent(response, { type: 'text-event', event: { type: 'text.done', eventId: event.event_id, itemId: event.item_id, outputIndex: event.output_index, contentIndex: event.content_index, text: event.text } });
      } else if (event.type === 'agent.session.turn.completed' && event.turn?.subagent_id == null) {
        completed = true;
        writeEvent(response, { type: 'complete', turnId: event.turn.id });
        break;
      } else if (event.type === 'agent.session.turn.failed' && event.turn?.subagent_id == null) {
        throw new Error(event.turn.error?.message || 'The turn failed.');
      } else if (event.type === 'agent.session.turn.cancelled' && event.turn?.subagent_id == null) {
        throw new Error('The turn was cancelled.');
      } else if (event.type === 'error') {
        throw new Error(event.error?.message || 'The agent returned an error.');
      } else if (event.type === 'agent.session.failed' || event.type === 'agent.session.environment.failed') {
        throw new Error('The session failed.');
      }
    }
    if (!completed && !response.destroyed) throw new Error('The stream ended before the turn completed. The rendered text may be partial.');
  } catch (error) {
    writeEvent(response, { type: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
  } finally {
    stream?.controller.abort();
    if (!response.destroyed) response.end();
  }
}
