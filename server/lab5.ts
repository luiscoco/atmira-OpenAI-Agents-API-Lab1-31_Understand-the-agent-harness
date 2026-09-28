import OpenAI from 'openai';

const sessionIdPattern = /^sess_[A-Za-z0-9_-]+$/;
const configured = () => Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_api_key_here');
const client = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function validId(id) {
  return typeof id === 'string' && id.length <= 200 && sessionIdPattern.test(id);
}

function summary(session) {
  return {
    id: session.id,
    status: session.status,
    createdAt: session.created_at,
    lastActiveAt: session.last_active_at,
    agentName: session.agent?.name || 'Inline agent',
    model: session.agent?.model || 'Unknown',
    environment: session.environment?.type || 'Unknown',
    requiredActions: session.required_actions?.length || 0,
  };
}

function apiError(response, error, fallback) {
  sendJson(response, error.status === 404 ? 404 : 502, { error: error.message || fallback });
}

export async function listLab5(request, response) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  const after = new URL(request.url, 'http://localhost').searchParams.get('after');
  if (after && !validId(after)) return sendJson(response, 400, { error: 'Invalid page cursor.' });
  try {
    const page = await client().beta.agents.sessions.list({ limit: 20, order: 'desc', ...(after ? { after } : {}) });
    sendJson(response, 200, {
      sessions: page.data.map(summary),
      nextCursor: page.has_more ? page.data.at(-1)?.id || null : null,
    });
  } catch (error) {
    apiError(response, error, 'Could not list sessions.');
  }
}

export async function retrieveLab5(request, response) {
  const id = new URL(request.url, 'http://localhost').searchParams.get('sessionId');
  if (!validId(id)) return sendJson(response, 400, { error: 'Invalid session ID.' });
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  try {
    const session = await client().beta.agents.sessions.retrieve(id);
    sendJson(response, 200, { session: {
      ...summary(session),
      instructions: session.agent?.instructions || null,
      error: session.error || null,
      metadata: session.metadata || {},
    } });
  } catch (error) {
    apiError(response, error, 'Could not retrieve the session.');
  }
}

export async function deleteLab5(request, response) {
  let body;
  try {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 1000) throw new Error('Request is too large.');
    }
    body = JSON.parse(raw);
  } catch {
    return sendJson(response, 400, { error: 'Send a valid JSON request.' });
  }
  if (!validId(body?.sessionId)) return sendJson(response, 400, { error: 'Invalid session ID.' });
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  try {
    const result = await client().beta.agents.sessions.delete(body.sessionId);
    if (!result.deleted) throw new Error('The API did not confirm deletion.');
    sendJson(response, 200, { id: body.sessionId, deleted: true });
  } catch (error) {
    apiError(response, error, 'Could not delete the session.');
  }
}
