import OpenAI from 'openai';

const sessionIdPattern = /^sess_[A-Za-z0-9_-]+$/;

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function writeEvent(response, event) {
  if (!response.destroyed && !response.writableEnded) response.write(JSON.stringify(event) + '\n');
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 12000) throw new Error('Request is too large.');
  }
  return JSON.parse(raw);
}

function validSessionId(value) {
  return typeof value === 'string' && value.length <= 200 && sessionIdPattern.test(value);
}

function configured() {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_api_key_here');
}

function client() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function runLab4(request, response, agent) {
  let body;
  try {
    body = await readJson(request);
  } catch {
    sendJson(response, 400, { error: 'Send a valid JSON request.' });
    return;
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const scenario = body.scenario || 'normal';
  if (!prompt || prompt.length > 2000 || (sessionId && !validSessionId(sessionId)) ||
      !['normal', 'api_error', 'turn_failure', 'disconnect'].includes(scenario)) {
    sendJson(response, 400, { error: 'Invalid prompt, session ID, or scenario.' });
    return;
  }
  if (scenario === 'api_error') {
    sendJson(response, 503, { error: 'Simulated API error: the request was rejected before a session or turn was started.', simulated: true });
    return;
  }
  if (scenario === 'turn_failure') {
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    writeEvent(response, { type: 'outcome', outcome: 'failed', simulated: true,
      message: 'Simulated turn failure: a real turn did not run in this local exercise.' });
    response.end();
    return;
  }
  if (!configured()) {
    sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
    return;
  }

  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  const api = client();
  let stream;
  let currentSessionId = sessionId;
  let sessionSent = false;
  let terminal = false;
  let simulatedDisconnect = false;
  const parts = new Map();
  const partKey = (event) => [event.item_id, event.output_index, event.content_index].join(':');

  try {
    if (sessionId) {
      writeEvent(response, { type: 'session', sessionId });
      sessionSent = true;
      stream = await api.beta.agents.sessions.events.stream(sessionId);
      await api.beta.agents.sessions.events.create(sessionId, {
        events: [{
          type: 'agent.session.input.message',
          input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        }],
      });
    } else {
      stream = await api.beta.agents.sessions.create({
        agent,
        environment: { type: 'none' },
        input: prompt,
        stream: true,
      });
    }

    for await (const event of stream) {
      if (response.destroyed) break;
      if (!sessionSent && event.session_id) {
        currentSessionId = event.session_id;
        sessionSent = true;
        writeEvent(response, { type: 'session', sessionId: currentSessionId });
      }
      if (event.type === 'agent.session.turn.output_text.delta') {
        const key = partKey(event);
        parts.set(key, (parts.get(key) || '') + event.delta);
        writeEvent(response, { type: 'text', text: [...parts.values()].join('\n') });
        if (scenario === 'disconnect' && sessionSent) {
          simulatedDisconnect = true;
          response.end();
          break;
        }
      } else if (event.type === 'agent.session.turn.output_text.done') {
        parts.set(partKey(event), event.text);
        writeEvent(response, { type: 'text', text: [...parts.values()].join('\n') });
        if (scenario === 'disconnect' && sessionSent) {
          simulatedDisconnect = true;
          response.end();
          break;
        }
      } else if (event.type === 'agent.session.turn.completed' && event.turn?.subagent_id == null) {
        terminal = true;
        writeEvent(response, { type: 'outcome', outcome: 'completed' });
        break;
      } else if (event.type === 'agent.session.turn.failed' && event.turn?.subagent_id == null) {
        terminal = true;
        writeEvent(response, { type: 'outcome', outcome: 'failed', message: event.turn.error?.message || 'The agent turn failed.' });
        break;
      } else if (event.type === 'agent.session.turn.cancelled' && event.turn?.subagent_id == null) {
        terminal = true;
        writeEvent(response, { type: 'outcome', outcome: 'cancelled', message: 'The agent turn was cancelled.' });
        break;
      } else if (event.type === 'agent.session.failed' || event.type === 'agent.session.environment.failed') {
        terminal = true;
        writeEvent(response, { type: 'outcome', outcome: 'failed', message: 'The agent session failed.' });
        break;
      } else if (event.type === 'error') {
        terminal = true;
        writeEvent(response, { type: 'outcome', outcome: 'failed', message: event.error?.message || 'The agent returned an error.' });
        break;
      }
    }
    if (!terminal && !simulatedDisconnect && !response.destroyed) {
      writeEvent(response, { type: 'error', kind: 'disconnect', message: 'The stream closed before a turn outcome arrived.' });
    }
  } catch (error) {
    writeEvent(response, { type: 'error', kind: 'api', message: error.message || 'The agent request failed.' });
  } finally {
    stream?.controller?.abort();
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

export async function recoverLab4(request, response) {
  const sessionId = new URL(request.url, 'http://localhost').searchParams.get('sessionId');
  if (!validSessionId(sessionId)) {
    sendJson(response, 400, { error: 'Invalid session ID.' });
    return;
  }
  if (!configured()) {
    sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
    return;
  }
  try {
    const api = client();
    const [session, turnPage, itemPage] = await Promise.all([
      api.beta.agents.sessions.retrieve(sessionId),
      api.beta.agents.sessions.turns.list(sessionId, { order: 'desc', limit: 20 }),
      api.beta.agents.sessions.items.list(sessionId, { order: 'asc', limit: 100 }),
    ]);
    const items = itemPage.data.filter((item) => item.type === 'message').map((item) => ({
      id: item.id,
      turnId: item.turn_id,
      role: item.role,
      status: item.status,
      text: Array.isArray(item.content)
        ? item.content.filter((part) => 'text' in part && typeof part.text === 'string').map((part) => 'text' in part ? part.text : '').join('\n')
        : '',
    }));
    sendJson(response, 200, {
      session: { id: session.id, status: session.status, requiredActions: session.required_actions?.length || 0 },
      turns: turnPage.data.map((turn) => ({
        id: turn.id, status: turn.status, error: turn.error?.message || null,
      })),
      items,
      itemsHasMore: itemPage.has_more,
    });
  } catch (error) {
    sendJson(response, error.status === 404 ? 404 : 502, { error: error.message || 'Could not retrieve saved state.' });
  }
}

export async function cancelLab4(request, response) {
  let body;
  try {
    body = await readJson(request);
  } catch {
    sendJson(response, 400, { error: 'Send a valid JSON request.' });
    return;
  }
  if (!validSessionId(body.sessionId)) {
    sendJson(response, 400, { error: 'Invalid session ID.' });
    return;
  }
  if (!configured()) {
    sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
    return;
  }
  try {
    await client().beta.agents.sessions.events.create(body.sessionId, {
      events: [{ type: 'agent.session.input.cancel' }],
    });
    sendJson(response, 200, { requested: true });
  } catch (error) {
    sendJson(response, 502, { error: error.message || 'Cancellation request failed.' });
  }
}

