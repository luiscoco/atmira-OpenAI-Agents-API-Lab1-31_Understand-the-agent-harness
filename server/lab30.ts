import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import OpenAI from 'openai';
import { validSessionId, type CleanupSnapshot } from '../src/lab30Cleanup.ts';
import { downloadHeaders, checkDownload, parseArtifact } from '../src/lab29Artifacts.ts';
import { runCleanupSuite } from '../src/lab30Tests.ts';
import { CleanupError, errorStatus, executeCleanup, verifyCleanup } from './lab30Service.ts';

// Inspection tickets scope all operations to a session explicitly selected on this page.
const tickets = new Map<string, { snapshot: CleanupSnapshot; expires: number }>();
const locks = new Set<string>();
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 4000) throw new CleanupError(400, 'Request too large.'); }
  try {
    const result = JSON.parse(raw);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new CleanupError(400, 'Send a JSON object.'); }
}
async function inspect(api: OpenAI, id: string): Promise<CleanupSnapshot> {
  const session = await api.beta.agents.sessions.retrieve(id);
  if (session.environment.type !== 'openai_hosted') throw new CleanupError(400, 'Choose an OpenAI-hosted session.');
  const turns = await api.beta.agents.sessions.turns.list(id, { order: 'desc', limit: 1 });
  const artifacts = [];
  for await (const artifact of api.beta.agents.sessions.artifacts.list(id, { limit: 100, order: 'asc' })) {
    artifacts.push({ id: artifact.id, path: artifact.path, size: artifact.size_bytes, turnId: artifact.turn_id });
    if (artifacts.length > 1000) throw new CleanupError(413, 'More than 1000 artifacts: retain and clean up using a dedicated application.');
  }
  const environmentId = session.environment.id;
  let environmentStatus = 'unknown';
  try { environmentStatus = (await api.beta.agents.environments.retrieve(environmentId)).status; } catch { /* Unknown blocks deletion. */ }
  return {
    id, status: session.status, environmentType: session.environment.type, environmentId, environmentStatus,
    lastActiveAt: session.last_active_at, requiredActions: session.required_actions.length,
    turn: turns.data[0] ? { id: turns.data[0].id, status: turns.data[0].status } : null, artifacts,
  };
}
function ticket(token: unknown) {
  const now = Date.now();
  for (const [key, value] of tickets) if (value.expires < now) tickets.delete(key);
  const result = typeof token === 'string' ? tickets.get(token) : null;
  if (!result) throw new CleanupError(409, 'Inspection expired. Inspect the session again.');
  return result.snapshot;
}

export async function handleLab30(req: IncomingMessage, res: ServerResponse, path: string) {
  if (path === '/api/lab30/test' && req.method === 'POST') return json(res, 200, { results: runCleanupSuite(), source: 'server' });
  const routes: Record<string, string> = { '/api/lab30/list': 'GET', '/api/lab30/inspect': 'GET', '/api/lab30/download': 'GET', '/api/lab30/cancel': 'POST', '/api/lab30/delete': 'POST', '/api/lab30/verify': 'POST' };
  if (routes[path] !== req.method) return json(res, 404, { error: 'Lab 30 route not found.' });
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_api_key_here') return json(res, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  const api = new OpenAI({ maxRetries: 0, timeout: 20_000 });
  const adapter = { inspect: (id: string) => inspect(api, id), delete: (id: string) => api.beta.agents.sessions.delete(id), retrieve: (id: string) => api.beta.agents.sessions.retrieve(id) };
  const query = new URL(req.url!, 'http://localhost').searchParams;
  try {
    if (path === '/api/lab30/list') {
      const after = query.get('after');
      if (after && !validSessionId(after)) throw new CleanupError(400, 'Invalid page cursor.');
      const page = await api.beta.agents.sessions.list({ order: 'desc', limit: 20, ...(after ? { after } : {}) });
      return json(res, 200, {
        sessions: page.data.filter(session => session.environment.type === 'openai_hosted').map(session => ({ id: session.id, status: session.status, lastActiveAt: session.last_active_at, model: session.agent.model })),
        nextCursor: page.has_more ? page.data.at(-1)?.id : null,
      });
    }
    if (path === '/api/lab30/inspect') {
      const id = query.get('sessionId');
      if (!validSessionId(id)) throw new CleanupError(400, 'Invalid session ID.');
      const snapshot = await inspect(api, id);
      const token = randomUUID();
      for (const [key, value] of tickets) if (value.expires < Date.now()) tickets.delete(key);
      if (tickets.size >= 200) tickets.delete(tickets.keys().next().value!);
      tickets.set(token, { snapshot, expires: Date.now() + 10 * 60_000 });
      return json(res, 200, { snapshot, token });
    }
    if (path === '/api/lab30/download') {
      const snapshot = ticket(query.get('token'));
      const artifactId = query.get('artifactId');
      if (!snapshot.artifacts.some(artifact => artifact.id === artifactId)) throw new CleanupError(400, 'Choose an artifact from the inspected session.');
      if (locks.has(snapshot.id)) throw new CleanupError(409, 'Cleanup is in progress.');
      locks.add(snapshot.id);
      try {
      const artifact = parseArtifact(await api.beta.agents.sessions.artifacts.retrieve(artifactId!, { session_id: snapshot.id }));
      const check = checkDownload(artifact);
      if (!check.ok) throw new CleanupError(check.status, check.reason);
      const content = await api.beta.agents.sessions.artifacts.content(artifactId!, { session_id: snapshot.id });
      const bytes = Buffer.from(await content.arrayBuffer());
      if (bytes.length !== artifact.sizeBytes) throw new CleanupError(502, 'Downloaded size did not match metadata.');
      res.writeHead(200, { ...downloadHeaders(artifact.path, bytes.length), 'Cache-Control': 'no-store', 'X-Artifact-Sha256': createHash('sha256').update(bytes).digest('hex') });
      return res.end(bytes);
      } finally { locks.delete(snapshot.id); }
    }
    const fields = await body(req);
    const snapshot = ticket(fields.token);
    if (path === '/api/lab30/verify') return json(res, 200, await verifyCleanup(adapter, snapshot.id));
    if (locks.has(snapshot.id)) throw new CleanupError(409, 'Another cleanup operation is in progress.');
    locks.add(snapshot.id);
    try {
      if (path === '/api/lab30/cancel') {
        if (fields.confirmation !== snapshot.id) throw new CleanupError(400, 'Type the session ID to confirm cancellation.');
        const fresh = await inspect(api, snapshot.id);
        if (!['in_progress', 'requires_action'].includes(fresh.status) && (!fresh.turn || ['completed', 'failed', 'cancelled'].includes(fresh.turn.status))) throw new CleanupError(409, 'No active turn to cancel. Inspect again.');
        await api.beta.agents.sessions.events.create(snapshot.id, { events: [{ type: 'agent.session.input.cancel' }] });
        tickets.delete(fields.token as string);
        return json(res, 200, { message: 'Cancellation requested. Wait for a terminal turn, then inspect again. Unpublished outputs may be lost.' });
      }
      const result = await executeCleanup(adapter, snapshot, { stoppedInput: fields.stoppedInput === true, retainedOutputs: fields.retainedOutputs === true, confirmation: typeof fields.confirmation === 'string' ? fields.confirmation : '' });
      return json(res, 200, result);
    } finally { locks.delete(snapshot.id); }
  } catch (error) {
    return json(res, errorStatus(error) || 502, { error: error instanceof Error ? error.message : 'Cleanup request failed.' });
  }
}
