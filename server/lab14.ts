import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';

type AgentConfig = { model: string; instructions: string };

const sessionIdPattern = /^sess_[A-Za-z0-9_-]+$/;
const controlIdPattern = /^[A-Za-z0-9_-]{8,64}$/;
// Once every new root turn has an outcome, wait this long for agent.session.idle before closing.
const idleGraceMs = 4_000;
// A run stream is never kept open longer than this.
const runLimitMs = 180_000;
const terminal = ['completed', 'failed', 'cancelled'];

const configured = () => Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_api_key_here');
const client = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const message = (value: string) => ({ type: 'agent.session.input.message' as const, input: [{ role: 'user' as const, content: [{ type: 'input_text' as const, text: value }] }] });

// Lifecycle events are forwarded as metadata; text arrives separately as per-message parts.
const forwarded = /^agent\.session\.(created|in_progress|idle|failed|turn\.(created|in_progress|completed|failed|cancelled|item\.added|item\.done))$/;

// POST /api/lab14/run — stream one question (or, with follow, reattach) and keep following the session until it is idle again,
// so a steer that lands in the running turn (or starts a new one) is seen on the same stream.
export async function runLab14(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const prompt = text(body.prompt);
  let sessionId = text(body.sessionId);
  // follow: reattach to the session's active turns without sending anything.
  const follow = body.follow === true;
  if (follow && !sessionId) return sendJson(response, 400, { error: 'Following needs a session ID.' });
  if (!follow && (!prompt || prompt.length > 2000)) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });
  if (sessionId && (sessionId.length > 200 || !sessionIdPattern.test(sessionId))) return sendJson(response, 400, { error: 'Invalid session ID.' });

  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = client();
  let stream: Awaited<ReturnType<typeof api.beta.agents.sessions.events.stream>> | undefined;
  // Closing the page's stream stops this reader only. It does not cancel the turn.
  response.on('close', () => stream?.controller.abort());
  const limit = setTimeout(() => stream?.controller.abort(), runLimitMs);
  let grace: ReturnType<typeof setTimeout> | undefined;
  const earlierTurns = new Set<string>();
  const turns = new Map<string, string>(); // new root turn ID → latest status
  const parts = new Map<string, { itemId: string; turnId: string | null; text: string; done: boolean }>();
  const commentary = new Set<string>();
  let reason = 'closed';
  let failure: string | null = null;

  const settled = () => turns.size > 0 && [...turns.values()].every((status) => terminal.includes(status));

  try {
    if (sessionId) {
      writeEvent(response, { type: 'session', sessionId });
      // Open the stream before reading turns or sending, so no event falls in the gap.
      stream = await api.beta.agents.sessions.events.stream(sessionId);
      const page = await api.beta.agents.sessions.turns.list(sessionId, { limit: 100 });
      for (const turn of page.data) {
        if (follow && turn.subagent_id == null && !terminal.includes(turn.status)) {
          turns.set(turn.id, turn.status);
          writeEvent(response, { type: 'turn', turnId: turn.id, status: turn.status, error: null });
        } else earlierTurns.add(turn.id);
      }
      if (follow && !turns.size) { reason = 'settled'; return; }
      if (!follow) await api.beta.agents.sessions.events.create(sessionId, { events: [message(prompt)] });
    } else {
      stream = await api.beta.agents.sessions.create({ agent, environment: { type: 'none' }, input: prompt, stream: true });
    }

    for await (const event of stream) {
      if (response.destroyed) return;
      if (!sessionId && event.type === 'agent.session.created') { sessionId = event.session.id; writeEvent(response, { type: 'session', sessionId }); }

      const isTurnEvent = event.type.startsWith('agent.session.turn.') && 'turn' in event;
      if (isTurnEvent && event.turn.subagent_id == null && !earlierTurns.has(event.turn.id)) {
        turns.set(event.turn.id, event.turn.status);
        writeEvent(response, { type: 'turn', turnId: event.turn.id, status: event.turn.status, error: event.turn.error?.message ?? null });
      }

      if (event.type === 'agent.session.turn.item.added' && event.item.type === 'message' && event.item.role === 'assistant' && event.item.phase === 'commentary') commentary.add(event.item.id);
      if (event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') {
        if (commentary.has(event.item_id)) continue;
        const part = parts.get(event.item_id) ?? { itemId: event.item_id, turnId: event.turn_id ?? null, text: '', done: false };
        if (event.type === 'agent.session.turn.output_text.delta') part.text += event.delta;
        else { part.text = event.text; part.done = true; }
        parts.set(event.item_id, part);
        writeEvent(response, { type: 'parts', parts: [...parts.values()] });
        continue;
      }

      if (forwarded.test(event.type)) {
        const item = 'item' in event && event.item?.type === 'message' ? event.item : null;
        writeEvent(response, {
          type: 'event',
          event: event.type,
          turnId: 'turn_id' in event ? event.turn_id ?? null : null,
          detail: item ? `${item.role} message` : 'turn' in event ? event.turn.status : null,
        });
      }
      if (event.type === 'error' || event.type === 'agent.session.failed') {
        failure = event.type === 'error' ? event.error?.message ?? 'The agent returned an error.' : 'The agent session failed.';
        reason = 'failed';
        break;
      }
      if (event.type === 'agent.session.idle' && settled()) { reason = 'idle'; break; }
      // Some streams may not send idle; do not wait for ever once every turn has an outcome.
      clearTimeout(grace);
      if (settled()) grace = setTimeout(() => { reason = 'settled'; stream?.controller.abort(); }, idleGraceMs);
    }
  } catch (error) {
    if (!response.destroyed && reason === 'closed') { reason = 'failed'; failure = error instanceof Error ? error.message : 'The agent request failed.'; }
  } finally {
    clearTimeout(limit);
    clearTimeout(grace);
    stream?.controller.abort();
    if (reason === 'settled' && !turns.size) failure = null;
    else if (reason === 'closed' && !settled()) failure = 'The stream closed before every turn had an outcome. Read saved state.';
    writeEvent(response, { type: 'end', reason: settled() || reason === 'settled' ? 'settled' : reason, message: failure });
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

// POST /api/lab14/control — send a cancel or a steering message to the session.
// 202 from the API means the input was accepted, not that it took effect. The page reads the turn to find out.
export async function controlLab14(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const sessionId = text(body.sessionId);
  const kind = body.kind;
  const controlId = text(body.controlId);
  const steer = text(body.text);
  if (!sessionIdPattern.test(sessionId) || sessionId.length > 200) return sendJson(response, 400, { error: 'Invalid session ID.' });
  if (kind !== 'cancel' && kind !== 'steer') return sendJson(response, 400, { error: 'Kind must be cancel or steer.' });
  if (!controlIdPattern.test(controlId)) return sendJson(response, 400, { error: 'Invalid control ID.' });
  if (kind === 'steer' && (!steer || steer.length > 2000)) return sendJson(response, 400, { error: 'A steering message must be between 1 and 2,000 characters.' });

  try {
    if (kind === 'cancel') {
      await client().beta.agents.sessions.events.create(sessionId, { events: [{ type: 'agent.session.input.cancel' }] });
    } else {
      // The control ID is the Idempotency-Key, so a retried click is not a second message.
      await client().beta.agents.sessions.events.create(sessionId, { 'Idempotency-Key': controlId, events: [message(steer)] });
    }
    sendJson(response, 200, { accepted: true });
  } catch (error) {
    // The API refused it. Report the refusal as data, so the page can explain it.
    const failure = error as { status?: number; code?: string | null; error?: { code?: string | null; message?: string }; message?: string };
    sendJson(response, 200, { accepted: false, error: { status: failure.status ?? null, code: failure.error?.code ?? failure.code ?? null, message: failure.error?.message ?? failure.message ?? 'The API rejected the request.' } });
  }
}
