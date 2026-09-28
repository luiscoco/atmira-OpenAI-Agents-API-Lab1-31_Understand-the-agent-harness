import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import type { AgentSessionMessage } from 'openai/resources/beta/agents/agents';

type AgentConfig = { model: string; instructions: string };

const sessionIdPattern = /^sess_[A-Za-z0-9_-]+$/;
const requestIdPattern = /^[A-Za-z0-9_-]{8,64}$/;
const turnIdPattern = /^[A-Za-z0-9_-]{1,200}$/;
// The session metadata key that carries the browser's request ID.
const requestMetadataKey = 'lab13_request_id';
// A reattached stream is closed after this long; the browser then reads saved state again.
const attachLimitMs = 120_000;
// A follow-up whose Idempotency-Key matches a message the API already has starts no new turn.
const newTurnWaitMs = 15_000;
const maxRead = 300;
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
const startStream = (response: ServerResponse) => response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
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

// Keeps answer text per content part, skips commentary, and replaces a part with its done text.
function textBuffer() {
  const parts = new Map<string, string>();
  const commentary = new Set<string>();
  return {
    apply(event): boolean {
      if (event.type === 'agent.session.turn.item.added' && event.item?.phase === 'commentary') commentary.add(event.item.id);
      if (commentary.has(event.item_id)) return false;
      const key = `${event.item_id}:${event.content_index}`;
      if (event.type === 'agent.session.turn.output_text.delta') parts.set(key, (parts.get(key) ?? '') + event.delta);
      else if (event.type === 'agent.session.turn.output_text.done') parts.set(key, event.text);
      else return false;
      return true;
    },
    get text() { return [...parts.values()].join('\n'); },
  };
}

// POST /api/lab13/send — run one question. The request ID travels with the work so it can be found later.
export async function sendLab13(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const prompt = text(body.prompt);
  let sessionId = text(body.sessionId);
  const requestId = text(body.requestId);
  const dropAfterChars = typeof body.dropAfterChars === 'number' && body.dropAfterChars > 0 ? Math.min(body.dropAfterChars, 2000) : 0;
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });
  if (!requestIdPattern.test(requestId)) return sendJson(response, 400, { error: 'Invalid request ID.' });
  if (sessionId && (sessionId.length > 200 || !sessionIdPattern.test(sessionId))) return sendJson(response, 400, { error: 'Invalid session ID.' });

  startStream(response);
  const api = client();
  let stream: Awaited<ReturnType<typeof api.beta.agents.sessions.events.stream>> | undefined;
  // If the browser goes away, stop reading. The agent turn keeps running on the API.
  response.on('close', () => stream?.controller.abort());
  const earlierTurns = new Set<string>();
  const buffer = textBuffer();
  let turnId: string | null = null;
  let outcome: string | null = null;
  let message: string | null = null;
  let dropped = false;
  let noNewTurn = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  try {
    if (sessionId) {
      writeEvent(response, { type: 'session', sessionId });
      const page = await api.beta.agents.sessions.turns.list(sessionId, { limit: 100 });
      for (const turn of page.data) earlierTurns.add(turn.id);
      stream = await api.beta.agents.sessions.events.stream(sessionId);
      // The same request ID is the Idempotency-Key, so a resend of this message is not a second message.
      await api.beta.agents.sessions.events.create(sessionId, {
        'Idempotency-Key': requestId,
        events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }],
      });
      watchdog = setTimeout(() => { if (!turnId) { noNewTurn = true; stream?.controller.abort(); } }, newTurnWaitMs);
    } else {
      // Tag the new session so it can be found by request ID if its ID never reaches the browser.
      stream = await api.beta.agents.sessions.create({ agent, environment: { type: 'none' }, input: prompt, stream: true, metadata: { [requestMetadataKey]: requestId } });
    }

    for await (const event of stream) {
      if (response.destroyed) return;
      const eventSessionId = event.type === 'agent.session.created' ? event.session.id : 'session_id' in event ? event.session_id : '';
      if (!sessionId && eventSessionId) { sessionId = eventSessionId; writeEvent(response, { type: 'session', sessionId }); }
      if (event.type === 'agent.session.turn.created' && event.turn.subagent_id == null && !earlierTurns.has(event.turn.id) && !turnId) {
        turnId = event.turn.id;
        writeEvent(response, { type: 'turn', turnId });
      }
      if (buffer.apply(event)) {
        writeEvent(response, { type: 'text', text: buffer.text });
        if (dropAfterChars && buffer.text.length >= dropAfterChars) {
          // Simulated disconnect: stop forwarding without cancelling the turn.
          dropped = true;
          return;
        }
      }
      const isOutcome = event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled';
      if (isOutcome && event.turn.subagent_id == null && !earlierTurns.has(event.turn.id)) {
        outcome = event.turn.status;
        message = event.turn.error?.message ?? null;
        turnId = event.turn.id;
        break;
      }
      if (event.type === 'error' || event.type === 'agent.session.failed') {
        outcome = 'failed';
        message = event.type === 'error' ? event.error?.message ?? 'The agent returned an error.' : 'The agent session failed.';
        break;
      }
    }
  } catch (error) {
    if (!outcome && !response.destroyed) message = error instanceof Error ? error.message : 'The agent request failed.';
  } finally {
    clearTimeout(watchdog);
    stream?.controller.abort();
    // An aborted stream can end the loop without throwing, so the watchdog is checked here.
    if (noNewTurn) message = 'No new turn started. The API may have matched this Idempotency-Key to a message it already has. Read saved state before sending anything.';
    if (!dropped) {
      if (outcome) writeEvent(response, { type: 'outcome', outcome, turnId, message });
      else if (message) writeEvent(response, { type: 'error', message });
    }
    // Without an outcome line, the browser treats the end of the stream as a disconnect.
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

type Page<T> = { data: T[]; hasNextPage(): boolean; getNextPage(): Promise<Page<T>> };
async function collect<T>(first: PromiseLike<Page<T>>): Promise<{ data: T[]; complete: boolean }> {
  let page = await first;
  const data = [...page.data];
  while (page.hasNextPage() && data.length < maxRead) { page = await page.getNextPage(); data.push(...page.data); }
  return { data, complete: !page.hasNextPage() };
}

// GET /api/lab13/snapshot — read saved state. It never sends input, so it is always safe to call.
export async function snapshotLab13(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  const params = new URL(request.url ?? '', 'http://localhost').searchParams;
  const sessionId = params.get('sessionId') ?? '';
  const requestId = params.get('requestId') ?? '';
  if ((sessionId && !sessionIdPattern.test(sessionId)) || (requestId && !requestIdPattern.test(requestId)) || (!sessionId && !requestId)) return sendJson(response, 400, { error: 'Send a valid session ID or request ID.' });
  const api = client();
  const empty = { sessionId: sessionId || null, foundBy: null, sessionStatus: null, turns: [], messages: [], complete: true };
  try {
    let session;
    let foundBy: 'id' | 'metadata';
    if (sessionId) {
      try { session = await api.beta.agents.sessions.retrieve(sessionId); } catch (error) {
        if ((error as { status?: number }).status === 404) return sendJson(response, 200, empty);
        throw error;
      }
      foundBy = 'id';
    } else {
      // The ID never reached the browser: look for the request ID in recent sessions' metadata.
      const page = await api.beta.agents.sessions.list({ limit: 20, order: 'desc' });
      session = page.data.find((candidate) => candidate.metadata?.[requestMetadataKey] === requestId);
      if (!session) return sendJson(response, 200, empty);
      foundBy = 'metadata';
    }
    const [turns, items] = await Promise.all([
      collect(api.beta.agents.sessions.turns.list(session.id, { order: 'asc', limit: 100 })),
      collect(api.beta.agents.sessions.items.list(session.id, { order: 'asc', limit: 100 })),
    ]);
    sendJson(response, 200, {
      sessionId: session.id,
      foundBy,
      sessionStatus: session.status,
      turns: turns.data.map((turn) => ({ id: turn.id, status: turn.status, subagentId: turn.subagent_id ?? null, error: turn.error?.message ?? null })),
      messages: items.data.filter((item): item is AgentSessionMessage => item.type === 'message').map((item) => ({
        id: item.id,
        turnId: item.turn_id,
        role: item.role,
        phase: item.phase,
        status: item.status ?? 'completed',
        text: item.content.map((part) => ('text' in part && typeof part.text === 'string' ? part.text : '')).join(''),
      })),
      complete: turns.complete && items.complete,
    });
  } catch (error) {
    sendJson(response, 502, { error: error instanceof Error ? error.message : 'Could not read saved state.' });
  }
}

// POST /api/lab13/attach — follow a turn that is still running, without sending anything.
export async function attachLab13(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const sessionId = text(body.sessionId);
  const turnId = text(body.turnId);
  if (!sessionIdPattern.test(sessionId) || !turnIdPattern.test(turnId)) return sendJson(response, 400, { error: 'Invalid session or turn ID.' });

  startStream(response);
  const api = client();
  let stream: Awaited<ReturnType<typeof api.beta.agents.sessions.events.stream>> | undefined;
  response.on('close', () => stream?.controller.abort());
  const timer = setTimeout(() => stream?.controller.abort(), attachLimitMs);
  const seen = new Set<string>();
  const turnItems = new Set<string>();
  const buffer = textBuffer();
  let outcome: string | null = null;
  let message: string | null = null;

  try {
    // Open the stream first, then read the status, so an outcome between the two is not missed.
    stream = await api.beta.agents.sessions.events.stream(sessionId);
    const turn = await api.beta.agents.sessions.turns.retrieve(turnId, { session_id: sessionId });
    writeEvent(response, { type: 'attached', status: turn.status });
    if (terminal.includes(turn.status)) {
      outcome = turn.status;
      message = turn.error?.message ?? null;
      return;
    }
    for await (const event of stream) {
      if (response.destroyed) return;
      // A reconnect can deliver an event again; skip an event ID that was already handled.
      if (seen.has(event.event_id)) continue;
      seen.add(event.event_id);
      if ((event.type === 'agent.session.turn.item.added' || event.type === 'agent.session.turn.item.done') && event.turn_id === turnId && event.item.id) turnItems.add(event.item.id);
      // Text events may omit turn_id, so follow the items that started in this turn.
      const inTurn = ('turn_id' in event && event.turn_id === turnId) || ('item_id' in event && turnItems.has(event.item_id));
      if (inTurn && buffer.apply(event)) writeEvent(response, { type: 'text', text: buffer.text });
      const isOutcome = event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled';
      if (isOutcome && event.turn.id === turnId) {
        outcome = event.turn.status;
        message = event.turn.error?.message ?? null;
        break;
      }
    }
    if (!outcome) message = 'The reattached stream closed before the turn finished. Read saved state again.';
  } catch (error) {
    if (!outcome) message = error instanceof Error && error.name !== 'AbortError' ? error.message : 'The reattached stream closed before the turn finished. Read saved state again.';
  } finally {
    clearTimeout(timer);
    stream?.controller.abort();
    if (outcome) writeEvent(response, { type: 'outcome', outcome, turnId, message });
    else writeEvent(response, { type: 'error', message: message ?? 'The reattached stream ended without an outcome.' });
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}
