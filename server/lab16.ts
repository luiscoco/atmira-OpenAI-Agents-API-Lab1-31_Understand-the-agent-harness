import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import type { AgentSession } from 'openai/resources/beta/agents/agents';
import { lintTool, type ToolCall, type TurnStatus } from '../src/lab16Tool.ts';

type AgentConfig = { model: string; instructions: string };
type After = 'cancel' | 'leave';

const sessionIdPattern = /^sess_[A-Za-z0-9_-]+$/;
const runLimitMs = 90_000;

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
const errorMessage = (error: unknown) => {
  const failure = error as { status?: number; error?: { message?: string }; message?: string };
  return `${failure.status ? `${failure.status} ` : ''}${failure.error?.message ?? failure.message ?? 'The API rejected the request.'}`;
};

// The instructions never name the tool. The tool's own description has to tell the model when to call it.
const instructions = (today: string) =>
  'You are the assistant for the "OpenAI Agents API with React" course. ' +
  `Today is ${today}. Answer clearly and briefly. ` +
  'Use your tools when they can answer a question better than you can. Never invent course dates.';

// Only function calls: required_actions can also hold environment reconnections.
const functionActions = (actions: AgentSession['required_actions']): ToolCall[] => actions.flatMap((action) => action.type === 'function_call'
  ? [{ callId: action.call_id, name: action.name, turnId: action.turn_id, itemId: null, status: null, arguments: action.arguments }]
  : []);

// POST /api/lab16/run — start a session whose agent declares one function tool, and report what the agent asked for.
export async function runLab16(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const prompt = text(body.prompt);
  const after: After = body.after === 'leave' ? 'leave' : 'cancel';
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });

  // The browser lints too, but the server never sends a declaration it has not checked itself.
  let tool = null;
  if (body.tool !== null) {
    const raw = body.tool as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== 'object') return sendJson(response, 400, { error: 'Send a tool declaration or null.' });
    const linted = lintTool({ name: text(raw.name), description: text(raw.description), parametersText: JSON.stringify(raw.parameters ?? null) });
    if (!linted.declaration) return sendJson(response, 400, { error: `The tool declaration has errors: ${linted.findings.filter((item) => item.level === 'error').map((item) => item.text).join(' ')}` });
    tool = linted.declaration;
  }

  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = client();
  let stream: Awaited<ReturnType<typeof api.beta.agents.sessions.events.stream>> | undefined;
  response.on('close', () => stream?.controller.abort());
  const limit = setTimeout(() => stream?.controller.abort(), runLimitMs);

  let sessionId: string | null = null;
  let turnId: string | null = null;
  let turnStatus: TurnStatus = 'unknown';
  let sessionStatus: string | null = null;
  let requiredActions: ToolCall[] = [];
  let cancelSent = false;
  let error: string | null = null;
  const calls = new Map<string, ToolCall>();
  const events: string[] = [];
  const parts = new Map<string, string>();
  const commentary = new Set<string>();
  const answer = () => [...parts.values()].join('\n');

  try {
    writeEvent(response, { type: 'status', label: tool ? `Starting a session with the tool ${tool.name}` : 'Starting a session with no tools' });
    stream = await api.beta.agents.sessions.create({
      agent: { ...agent, instructions: instructions(new Date().toISOString().slice(0, 10)), ...(tool ? { tools: [tool] } : {}) },
      environment: { type: 'none' },
      input: prompt,
      stream: true,
    });

    for await (const event of stream) {
      if (response.destroyed) return;
      // Text deltas are noisy; record their type once per run so the event list stays readable.
      if (!(event.type === 'agent.session.turn.output_text.delta' && events.at(-1) === event.type)) {
        events.push(event.type);
        writeEvent(response, { type: 'event', name: event.type });
      }
      if (event.type === 'agent.session.created') { sessionId = event.session.id; writeEvent(response, { type: 'session', sessionId }); }
      if ('turn' in event && event.turn?.subagent_id == null && !turnId) turnId = event.turn.id;

      // 1. The request as an item: a function_call with a name, a call_id, and arguments.
      if ((event.type === 'agent.session.turn.item.added' || event.type === 'agent.session.turn.item.done') && event.item.type === 'function_call') {
        const item = event.item;
        const call: ToolCall = { callId: item.call_id, name: item.name, turnId: item.turn_id, itemId: item.id, status: item.status, arguments: item.arguments };
        calls.set(item.call_id, call);
        writeEvent(response, { type: 'call', call });
      }
      if (event.type === 'agent.session.turn.item.added' && event.item.type === 'message' && event.item.phase === 'commentary' && event.item.id) commentary.add(event.item.id);
      if ((event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') && !commentary.has(event.item_id)) {
        const key = `${event.item_id}:${event.content_index}`;
        parts.set(key, event.type === 'agent.session.turn.output_text.delta' ? (parts.get(key) ?? '') + event.delta : event.text);
        writeEvent(response, { type: 'text', text: answer() });
        continue;
      }

      // 2. The session pauses: the same request, saved on the session as a required action.
      if (event.type === 'agent.session.requires_action') {
        sessionStatus = event.session.status;
        requiredActions = functionActions(event.session.required_actions);
        turnStatus = 'waiting';
        writeEvent(response, { type: 'requires_action', sessionStatus, actions: requiredActions });
        if (after === 'leave') break; // Lab 17 answers it with agent.session.input.tool_result.
        if (!cancelSent && sessionId) {
          cancelSent = true;
          writeEvent(response, { type: 'status', label: 'No result will be sent in Lab 16: cancelling the waiting turn' });
          await api.beta.agents.sessions.events.create(sessionId, { events: [{ type: 'agent.session.input.cancel' }] });
        }
        continue;
      }

      const terminal = event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled';
      if (terminal && event.turn.subagent_id == null) {
        turnStatus = event.turn.status as TurnStatus;
        if (event.type === 'agent.session.turn.failed') error = event.turn.error?.message ?? 'The turn failed.';
        break;
      }
      if (event.type === 'error') { turnStatus = 'failed'; error = event.error?.message ?? 'The agent returned an error.'; break; }
      if (event.type === 'agent.session.failed') { turnStatus = 'failed'; error = 'The agent session failed.'; break; }
    }
    if (turnStatus === 'unknown' && !error) error = 'The stream closed before the turn had an outcome.';
  } catch (caught) {
    if (response.destroyed) return;
    error = errorMessage(caught);
    if (turnStatus === 'unknown') turnStatus = 'failed';
  } finally {
    clearTimeout(limit);
    stream?.controller.abort();
    writeEvent(response, { type: 'summary', summary: { tool, sessionId, turnId, turnStatus, sessionStatus, calls: [...calls.values()], requiredActions, answer: answer(), events, cancelSent, error } });
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

// GET /api/lab16/session — read the saved session. A waiting request lives here, not only in the stream. Sends nothing.
export async function sessionLab16(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  const sessionId = text(new URL(request.url ?? '', 'http://localhost').searchParams.get('sessionId'));
  if (!sessionIdPattern.test(sessionId) || sessionId.length > 200) return sendJson(response, 400, { error: 'Invalid session ID.' });
  try {
    const session = await client().beta.agents.sessions.retrieve(sessionId);
    sendJson(response, 200, { status: session.status, requiredActions: functionActions(session.required_actions), tools: session.agent.tools.filter((item) => item.type === 'function').map((item) => ({ name: item.name, description: item.description, parameters: item.parameters })) });
  } catch (error) {
    sendJson(response, 502, { error: errorMessage(error) });
  }
}

// POST /api/lab16/cancel — cancel a turn left waiting for a tool result.
export async function cancelLab16(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let sessionId = '';
  try { sessionId = text((await readBody(request)).sessionId); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  if (!sessionIdPattern.test(sessionId) || sessionId.length > 200) return sendJson(response, 400, { error: 'Invalid session ID.' });
  try {
    await client().beta.agents.sessions.events.create(sessionId, { events: [{ type: 'agent.session.input.cancel' }] });
    sendJson(response, 202, { accepted: true });
  } catch (error) {
    sendJson(response, 502, { error: errorMessage(error) });
  }
}
