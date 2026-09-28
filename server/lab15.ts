import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';

type AgentConfig = { model: string; instructions: string };
type Mode = 'normal' | 'cancel' | 'bad_model' | 'stop_early';

const sessionIdPattern = /^sess_[A-Za-z0-9_-]+$/;
const turnIdPattern = /^[A-Za-z0-9_-]{1,200}$/;
const modes: Mode[] = ['normal', 'cancel', 'bad_model', 'stop_early'];
// A model name no project has, so the request fails before or during the turn.
const missingModel = 'lab15-no-such-model';
// cancel and stop_early act after this much answer text has streamed.
const actAfterChars = 160;
const runLimitMs = 120_000;

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
// An HTTP failure from the SDK, reported as data the page can explain.
const httpError = (error: unknown) => {
  const failure = error as { status?: number; code?: string | null; error?: { code?: string | null; message?: string }; message?: string };
  return { source: 'http' as const, status: failure.status ?? null, code: failure.error?.code ?? failure.code ?? null, message: failure.error?.message ?? failure.message ?? 'The API rejected the request.' };
};

// POST /api/lab15/run — run one measured turn and finish with a summary: outcome, timings, raw usage, error.
export async function runLab15(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const prompt = text(body.prompt);
  const mode = body.mode as Mode;
  // A bad model needs a new session: a session's model is fixed when it is created.
  let sessionId = mode === 'bad_model' ? '' : text(body.sessionId);
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });
  if (!modes.includes(mode)) return sendJson(response, 400, { error: 'Unknown mode.' });
  if (sessionId && (sessionId.length > 200 || !sessionIdPattern.test(sessionId))) return sendJson(response, 400, { error: 'Invalid session ID.' });

  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = client();
  let stream: Awaited<ReturnType<typeof api.beta.agents.sessions.events.stream>> | undefined;
  response.on('close', () => stream?.controller.abort());
  const limit = setTimeout(() => stream?.controller.abort(), runLimitMs);

  const model = mode === 'bad_model' ? missingModel : agent.model;
  const clock = { firstEventMs: null as number | null, turnCreatedMs: null as number | null, inProgressMs: null as number | null, firstTextMs: null as number | null, endMs: null as number | null };
  const apiTimes = { createdAt: null as number | null, startedAt: null as number | null, completedAt: null as number | null };
  let outcome = 'unknown';
  let turnId: string | null = null;
  let usage: unknown = null;
  let error: { source: 'http' | 'turn' | 'stream'; status: number | null; code: string | null; message: string } | null = null;
  const earlierTurns = new Set<string>();
  const parts = new Map<string, string>();
  const commentary = new Set<string>();
  let cancelSent = false;
  let started = 0;
  const since = () => Math.round(performance.now() - started);
  const mark = (key: keyof typeof clock, label: string) => {
    if (clock[key] !== null) return;
    clock[key] = since();
    writeEvent(response, { type: 'mark', label, ms: clock[key] });
  };
  const answer = () => [...parts.values()].join('\n');

  try {
    if (sessionId) {
      writeEvent(response, { type: 'session', sessionId });
      // Subscribe first, and remember earlier turns, so only this run's turn is measured.
      stream = await api.beta.agents.sessions.events.stream(sessionId);
      for (const turn of (await api.beta.agents.sessions.turns.list(sessionId, { limit: 100 })).data) earlierTurns.add(turn.id);
      started = performance.now();
      await api.beta.agents.sessions.events.create(sessionId, { events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }] });
    } else {
      started = performance.now();
      stream = await api.beta.agents.sessions.create({ agent: { ...agent, model }, environment: { type: 'none' }, input: prompt, stream: true });
    }

    for await (const event of stream) {
      if (response.destroyed) return;
      mark('firstEventMs', 'first event');
      if (!sessionId && event.type === 'agent.session.created') { sessionId = event.session.id; writeEvent(response, { type: 'session', sessionId }); }

      const rootTurn = 'turn' in event && event.turn?.subagent_id == null && !earlierTurns.has(event.turn.id) ? event.turn : null;
      if (rootTurn && !turnId) { turnId = rootTurn.id; writeEvent(response, { type: 'turn', turnId }); }
      if (rootTurn && event.type === 'agent.session.turn.created') mark('turnCreatedMs', 'turn.created');
      if (rootTurn && event.type === 'agent.session.turn.in_progress') mark('inProgressMs', 'turn.in_progress');

      if (event.type === 'agent.session.turn.item.added' && event.item.type === 'message' && event.item.phase === 'commentary') commentary.add(event.item.id);
      if ((event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') && !commentary.has(event.item_id)) {
        if (event.turn_id && earlierTurns.has(event.turn_id)) continue;
        const key = `${event.item_id}:${event.content_index}`;
        if (event.type === 'agent.session.turn.output_text.delta') { mark('firstTextMs', 'first text'); parts.set(key, (parts.get(key) ?? '') + event.delta); }
        else parts.set(key, event.text);
        writeEvent(response, { type: 'text', text: answer() });
        const length = answer().length;
        if (mode === 'cancel' && !cancelSent && length >= actAfterChars) {
          cancelSent = true;
          writeEvent(response, { type: 'mark', label: 'cancel sent', ms: since() });
          await api.beta.agents.sessions.events.create(sessionId, { events: [{ type: 'agent.session.input.cancel' }] });
        }
        if (mode === 'stop_early' && length >= actAfterChars) {
          // The page's reader stops; the turn keeps running and keeps using tokens.
          writeEvent(response, { type: 'mark', label: 'stopped reading', ms: since() });
          error = { source: 'stream', status: null, code: null, message: `The server stopped reading after ${length} characters. No cancel was sent, so the turn kept running.` };
          break;
        }
        continue;
      }

      const terminal = event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled';
      if (terminal && rootTurn && rootTurn.id === turnId) {
        mark('endMs', `turn.${rootTurn.status}`);
        outcome = rootTurn.status;
        // Best effort: the event's usage, else the turn's own. null stays null.
        usage = event.usage ?? rootTurn.usage ?? null;
        apiTimes.createdAt = rootTurn.created_at ?? null;
        apiTimes.startedAt = rootTurn.started_at ?? null;
        apiTimes.completedAt = rootTurn.completed_at ?? null;
        if (event.type === 'agent.session.turn.failed') error = { source: 'turn', status: null, code: rootTurn.error?.code ?? null, message: rootTurn.error?.message ?? 'The turn failed without a message.' };
        break;
      }
      if (event.type === 'error') { mark('endMs', 'error event'); outcome = 'failed'; error = { source: 'turn', status: null, code: event.error?.code ?? null, message: event.error?.message ?? 'The agent returned an error.' }; break; }
      if (event.type === 'agent.session.failed') { mark('endMs', 'session.failed'); outcome = 'failed'; error = { source: 'turn', status: null, code: null, message: 'The agent session failed.' }; break; }
    }
    if (outcome === 'unknown' && !error) error = { source: 'stream', status: null, code: null, message: 'The stream closed before the turn had an outcome. Read the saved turn.' };
  } catch (caught) {
    if (response.destroyed) return;
    if (outcome === 'unknown' && !error) {
      error = httpError(caught);
      // Refused before a session existed: nothing ran, so there is no usage to know.
      if (!sessionId) outcome = 'rejected';
    }
  } finally {
    clearTimeout(limit);
    stream?.controller.abort();
    writeEvent(response, { type: 'summary', summary: { model, sessionId: sessionId || null, turnId, outcome, clock, api: apiTimes, usage, error, chars: answer().length } });
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

// GET /api/lab15/usage — read the saved turn and session again. Recorded usage may change after the stream ends. Sends nothing.
export async function usageLab15(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  const query = new URL(request.url ?? '', 'http://localhost').searchParams;
  const sessionId = text(query.get('sessionId'));
  const turnId = text(query.get('turnId'));
  if (!sessionIdPattern.test(sessionId) || sessionId.length > 200) return sendJson(response, 400, { error: 'Invalid session ID.' });
  if (turnId && !turnIdPattern.test(turnId)) return sendJson(response, 400, { error: 'Invalid turn ID.' });
  try {
    const api = client();
    const [session, turn] = await Promise.all([
      api.beta.agents.sessions.retrieve(sessionId),
      turnId ? api.beta.agents.sessions.turns.retrieve(turnId, { session_id: sessionId }) : Promise.resolve(null),
    ]);
    sendJson(response, 200, {
      session: { status: session.status, usage: session.usage ?? null },
      turn: turn ? { status: turn.status, usage: turn.usage ?? null, createdAt: turn.created_at ?? null, startedAt: turn.started_at ?? null, completedAt: turn.completed_at ?? null, error: turn.error ? { code: turn.error.code, message: turn.error.message } : null } : null,
    });
  } catch (error) {
    const failure = httpError(error);
    sendJson(response, failure.status && failure.status < 500 ? failure.status : 502, { error: failure.message });
  }
}
