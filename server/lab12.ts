import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';

type AgentConfig = { model: string; instructions: string };

const sessionIdPattern = /^sess_[A-Za-z0-9_-]+$/;
// After the root turn ends, wait this long for agent.session.idle before closing.
const idleGraceMs = 3000;

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};
const writeEvent = (response: ServerResponse, event: unknown) => {
  if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(event)}\n`);
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

// Keep the identifiers and states the timeline needs; drop prompt and answer text.
function normalize(event, at: number) {
  const base = { eventId: event.event_id, type: event.type, at, turnId: event.turn_id ?? null, itemId: null, itemType: null, status: null, subagentId: null, detail: null };
  if (event.turn) return { ...base, turnId: event.turn.id, status: event.turn.status, subagentId: event.turn.subagent_id ?? null, detail: event.turn.error?.message ?? null };
  if (event.item) {
    const role = event.item.role ? [event.item.role, event.item.phase].filter(Boolean).join(' · ') : null;
    return { ...base, itemId: event.item.id ?? null, itemType: event.item.type, status: event.item.status ?? null, detail: role };
  }
  if (event.item_id) {
    const detail = typeof event.delta === 'string' ? `+${event.delta.length} chars` : typeof event.text === 'string' ? `${event.text.length} chars` : `part ${event.content_index ?? event.summary_index ?? 0}`;
    return { ...base, itemId: event.item_id, detail };
  }
  if (event.session) return { ...base, status: event.session.status };
  if (event.subagent) return { ...base, subagentId: event.subagent.id, detail: event.subagent.name ?? null };
  if (event.type === 'error') return { ...base, detail: event.error?.message ?? 'Error' };
  return base;
}

export async function runLab12(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_api_key_here') return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let prompt = '';
  let sessionId = '';
  try {
    const body = await readBody(request);
    prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  } catch {
    return sendJson(response, 400, { error: 'Send a valid JSON request with a prompt.' });
  }
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });
  if (sessionId && (sessionId.length > 200 || !sessionIdPattern.test(sessionId))) return sendJson(response, 400, { error: 'Invalid session ID.' });

  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let stream: Awaited<ReturnType<typeof api.beta.agents.sessions.events.stream>> | undefined;
  let outcome: string | null = null;
  let message: string | null = null;
  let idleObserved = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const earlierTurns = new Set<string>();
  const subagentTurns = new Set<string>();

  try {
    if (sessionId) {
      writeEvent(response, { type: 'session', sessionId });
      // Remember existing turns so a replayed terminal event cannot end this run.
      const page = await api.beta.agents.sessions.turns.list(sessionId, { limit: 100 });
      for (const turn of page.data) earlierTurns.add(turn.id);
      stream = await api.beta.agents.sessions.events.stream(sessionId);
      await api.beta.agents.sessions.events.create(sessionId, {
        events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }],
      });
    } else {
      writeEvent(response, { type: 'status', label: 'Starting agent session' });
      stream = await api.beta.agents.sessions.create({ agent, environment: { type: 'none' }, input: prompt, stream: true });
    }

    for await (const event of stream) {
      if (response.destroyed) return;
      const eventSessionId = event.type === 'agent.session.created' ? event.session.id : 'session_id' in event ? event.session_id : '';
      if (!sessionId && eventSessionId) { sessionId = eventSessionId; writeEvent(response, { type: 'session', sessionId }); }
      writeEvent(response, { type: 'event', event: normalize(event, Date.now()) });

      if (event.type === 'agent.session.turn.created' && event.turn.subagent_id != null) subagentTurns.add(event.turn.id);
      // The answer text is sent once, from the root turn's completed message.
      if (event.type === 'agent.session.turn.item.done' && event.item.type === 'message' && event.item.phase !== 'commentary' && event.turn_id && !subagentTurns.has(event.turn_id)) {
        writeEvent(response, { type: 'answer', turnId: event.turn_id, text: event.item.content.map((part) => part.text).join('') });
      }

      const rootTerminal = (event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled')
        && event.turn.subagent_id == null && !earlierTurns.has(event.turn.id);
      if (rootTerminal && !outcome) {
        // A subagent turn finishing is not the end of the run; only the root turn decides.
        outcome = event.turn.status;
        message = event.turn.error?.message ?? null;
        graceTimer = setTimeout(() => stream?.controller.abort(), idleGraceMs);
      } else if (outcome && (event.type === 'agent.session.idle' || event.type === 'agent.session.requires_action')) {
        idleObserved = true;
        break;
      } else if (!outcome && (event.type === 'error' || event.type === 'agent.session.failed' || event.type === 'agent.session.environment.failed')) {
        outcome = 'failed';
        message = event.type === 'error' ? event.error?.message ?? 'The agent returned an error.' : 'The agent session failed.';
        break;
      }
    }
  } catch (error) {
    // Aborting after the grace period is expected; any other error is reported.
    if (!outcome) message = error instanceof Error ? error.message : 'Something went wrong.';
  } finally {
    clearTimeout(graceTimer);
    stream?.controller.abort();
    if (outcome) writeEvent(response, { type: 'done', outcome, message, idleObserved });
    else writeEvent(response, { type: 'error', message: message ?? 'The stream ended before the root turn reached an outcome.' });
    if (!response.destroyed) response.end();
  }
}
