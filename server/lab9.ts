import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';

const agentIdPattern = /^agent_[A-Za-z0-9_-]+$/;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const efforts = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = typeof efforts[number];
const client = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function writeEvent(response: ServerResponse, event: unknown) {
  if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`);
}

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

export async function runLab9(request: IncomingMessage, response: ServerResponse) {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_api_key_here') {
    return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  }
  let body: Record<string, unknown>;
  try { body = await readBody(request); }
  catch { return sendJson(response, 400, { error: 'Send a valid JSON object.' }); }
  const agentId = body.agentId;
  const setupPrompt = typeof body.setupPrompt === 'string' ? body.setupPrompt.trim() : '';
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const mode = body.mode;
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  const effort = body.effort;
  if (typeof agentId !== 'string' || agentId.length > 200 || !agentIdPattern.test(agentId)) return sendJson(response, 400, { error: 'Invalid agent ID.' });
  if (!setupPrompt || setupPrompt.length > 2000 || !question || question.length > 2000) return sendJson(response, 400, { error: 'Each prompt must be between 1 and 2,000 characters.' });
  if (mode !== 'baseline' && mode !== 'updated') return sendJson(response, 400, { error: 'Choose baseline or updated.' });
  if (mode === 'updated' && (!modelPattern.test(model) || !efforts.includes(effort as Effort))) return sendJson(response, 400, { error: 'Enter a valid model and reasoning effort.' });

  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = client();
  let stream: Awaited<ReturnType<typeof api.beta.agents.sessions.events.stream>> | undefined;
  let sessionId = '';
  try {
    writeEvent(response, { type: 'status', label: 'Running the shared setup turn' });
    const first = await api.beta.agents.sessions.create({ agent_id: agentId, environment: { type: 'none' }, input: setupPrompt, stream: true });
    let firstCompleted = false;
    try {
      for await (const event of first) {
        if (response.destroyed) return;
        const eventSessionId = event.type === 'agent.session.created' ? event.session.id : 'session_id' in event ? event.session_id : '';
        if (!sessionId && eventSessionId) {
          sessionId = eventSessionId;
          writeEvent(response, { type: 'session', sessionId });
        }
        if (event.type === 'agent.session.turn.completed' && event.turn?.subagent_id == null) { firstCompleted = true; break; }
        if (event.type === 'agent.session.turn.failed' && event.turn?.subagent_id == null) throw new Error(event.turn.error?.message || 'The setup turn failed.');
        if (event.type === 'agent.session.turn.cancelled' && event.turn?.subagent_id == null) throw new Error('The setup turn was cancelled.');
        if (event.type === 'error') throw new Error(event.error?.message || 'The setup turn returned an error.');
        if (event.type === 'agent.session.failed' || event.type === 'agent.session.environment.failed') throw new Error('The setup session failed.');
      }
    } finally { first.controller.abort(); }
    if (!firstCompleted || !sessionId) throw new Error('The setup stream ended before completion.');

    let effectiveModel = '';
    let effectiveEffort: string | null = null;
    if (mode === 'updated') {
      writeEvent(response, { type: 'status', label: 'Updating this session for the next turn' });
      const updated = await api.beta.agents.sessions.update(sessionId, {
        agent: { model, reasoning: { effort: effort === 'default' ? null : effort as Exclude<Effort, 'default'> } },
      });
      effectiveModel = updated.agent.model;
      effectiveEffort = updated.agent.reasoning?.effort ?? null;
    } else {
      const baseline = await api.beta.agents.sessions.retrieve(sessionId);
      effectiveModel = baseline.agent.model;
      effectiveEffort = baseline.agent.reasoning?.effort ?? null;
    }
    writeEvent(response, { type: 'configuration', model: effectiveModel, effort: effectiveEffort });
    writeEvent(response, { type: 'status', label: 'Running the measured follow-up turn' });

    // Subscribe before sending input so the response's first events are not missed.
    stream = await api.beta.agents.sessions.events.stream(sessionId);
    const started = performance.now();
    await api.beta.agents.sessions.events.create(sessionId, {
      events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: question }] }] }],
    });
    let completed = false;
    const parts = new Map<string, string>();
    for await (const event of stream) {
      if (response.destroyed) return;
      if (event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') {
        const key = `${event.item_id}:${event.output_index}:${event.content_index}`;
        parts.set(key, event.type === 'agent.session.turn.output_text.delta' ? (parts.get(key) || '') + event.delta : event.text);
        writeEvent(response, { type: 'text', text: [...parts.values()].join('\n') });
      } else if (event.type === 'agent.session.turn.completed' && event.turn?.subagent_id == null) {
        completed = true;
        writeEvent(response, {
          type: 'complete', durationMs: Math.round(performance.now() - started), turnId: event.turn.id,
          inputTokens: event.turn.usage?.input_tokens ?? null,
          outputTokens: event.turn.usage?.output_tokens ?? null,
        });
        break;
      } else if (event.type === 'agent.session.turn.failed' && event.turn?.subagent_id == null) {
        throw new Error(event.turn.error?.message || 'The follow-up turn failed.');
      } else if (event.type === 'agent.session.turn.cancelled' && event.turn?.subagent_id == null) {
        throw new Error('The follow-up turn was cancelled.');
      } else if (event.type === 'error') {
        throw new Error(event.error?.message || 'The agent returned an error.');
      } else if (event.type === 'agent.session.failed' || event.type === 'agent.session.environment.failed') {
        throw new Error('The session failed.');
      }
    }
    if (!completed && !response.destroyed) throw new Error('The follow-up stream ended before completion.');
  } catch (error) {
    writeEvent(response, { type: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
  } finally {
    stream?.controller.abort();
    if (!response.destroyed) response.end();
  }
}
