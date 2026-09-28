import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import { studyPlanInstructions, validateStudyPlan } from './lab10Contract.ts';

const agentIdPattern = /^agent_[A-Za-z0-9_-]+$/;
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
    if (raw.length > 20_000) throw new Error('Request is too large.');
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  return parsed as Record<string, unknown>;
}

export async function validateLab10(request: IncomingMessage, response: ServerResponse) {
  let body: Record<string, unknown>;
  try { body = await readBody(request); }
  catch { return sendJson(response, 400, { error: 'Send a valid JSON object (20 KB maximum).' }); }
  const { raw, days, minutesPerDay } = body;
  if (typeof raw !== 'string' || raw.length > 12_000 || !Number.isInteger(days) || (days as number) < 3 || (days as number) > 7 || !Number.isInteger(minutesPerDay) || (minutesPerDay as number) < 15 || (minutesPerDay as number) > 120) {
    return sendJson(response, 400, { error: 'Provide plan text, 3–7 days, and 15–120 minutes per day.' });
  }
  return sendJson(response, 200, validateStudyPlan(raw, days as number, minutesPerDay as number));
}

export async function runLab10(request: IncomingMessage, response: ServerResponse) {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_api_key_here') return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); }
  catch { return sendJson(response, 400, { error: 'Send a valid JSON object (20 KB maximum).' }); }
  const agentId = body.agentId;
  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  const { days, minutesPerDay } = body;
  if (typeof agentId !== 'string' || !agentIdPattern.test(agentId) || agentId.length > 200) return sendJson(response, 400, { error: 'Invalid saved agent ID.' });
  if (!topic || topic.length > 120 || !goal || goal.length > 300 || !Number.isInteger(days) || (days as number) < 3 || (days as number) > 7 || !Number.isInteger(minutesPerDay) || (minutesPerDay as number) < 15 || (minutesPerDay as number) > 120) {
    return sendJson(response, 400, { error: 'Enter a topic, goal, 3–7 days, and 15–120 minutes per day.' });
  }

  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let sessionId = '';
  let stream: Awaited<ReturnType<typeof api.beta.agents.sessions.events.stream>> | undefined;
  const requestedDays = days as number;
  const requestedMinutes = minutesPerDay as number;
  try {
    const instructions = studyPlanInstructions(requestedDays, requestedMinutes);
    const input = `Topic: ${topic}\nLearning goal: ${goal}\nDaily time budget: ${requestedMinutes} minutes.`;
    writeEvent(response, { type: 'status', label: 'Generating the first plan' });
    stream = await api.beta.agents.sessions.create({ agent_id: agentId, agent: { instructions }, environment: { type: 'none' }, input, stream: true });
    for (let attempt = 1; attempt <= 2; attempt++) {
      const parts = new Map<string, string>();
      let completed = false;
      let turnId = '';
      for await (const event of stream) {
        if (response.destroyed) return;
        const eventSessionId = event.type === 'agent.session.created' ? event.session.id : 'session_id' in event ? event.session_id : '';
        if (!sessionId && eventSessionId) { sessionId = eventSessionId; writeEvent(response, { type: 'session', sessionId }); }
        if (event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') {
          const key = `${event.item_id}:${event.output_index}:${event.content_index}`;
          parts.set(key, event.type === 'agent.session.turn.output_text.delta' ? (parts.get(key) || '') + event.delta : event.text);
          writeEvent(response, { type: 'text', attempt, text: [...parts.values()].join('\n') });
        } else if (event.type === 'agent.session.turn.completed' && event.turn?.subagent_id == null) {
          completed = true; turnId = event.turn.id; break;
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
      stream.controller.abort(); stream = undefined;
      if (!completed || !sessionId) throw new Error('The stream ended before the turn completed. Inspect the session before retrying.');
      const raw = [...parts.values()].join('\n');
      const check = validateStudyPlan(raw, requestedDays, requestedMinutes);
      writeEvent(response, { type: 'validation', attempt, turnId, raw, ...check });
      if (check.valid || attempt === 2) { writeEvent(response, { type: 'complete', accepted: check.valid }); break; }
      writeEvent(response, { type: 'status', label: 'Validation failed; requesting one repair in the same session' });
      stream = await api.beta.agents.sessions.events.stream(sessionId);
      await api.beta.agents.sessions.events.create(sessionId, {
        events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: `Your previous plan failed validation:\n${check.errors.join('\n')}\nReturn a corrected complete JSON object only. Keep the original topic and goal. Do not add Markdown or commentary.` }] }] }],
      });
    }
  } catch (error) {
    writeEvent(response, { type: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
  } finally {
    stream?.controller.abort();
    if (!response.destroyed) response.end();
  }
}
