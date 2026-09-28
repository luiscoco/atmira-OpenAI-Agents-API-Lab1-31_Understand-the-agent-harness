import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import type { AgentSessionEvent } from 'openai/resources/beta/agents/agents';
import type { Stream } from 'openai/core/streaming';
import type { TurnStatus } from '../src/lab16Tool.ts';
import { checkServerUrl, parseMcpCall, type McpCall } from '../src/lab22Mcp.ts';
import {
  buildPrivateRequest, checkRevoke, findSecrets, judgeAuthRun, parseCredential, privateInstructions, privateLabel, privateTools, redact, withSecret,
  type AuthMode, type AuthRun, type AuthSettings, type PublicCredential, type RotationState, type VaultView,
} from '../src/lab24Vault.ts';
import { runVaultSuite } from '../src/lab24Tests.ts';
import { savedItem } from './lab22.ts';
import { accessLog, allTokenValues, currentToken, localMcpUrl, mcpPort, mintToken, revokeRetiring, tokenInfos, tokenValue } from './lab24Mcp.ts';

type AgentConfig = { model: string; instructions: string };

const runLimitMs = 180_000;
const sessionIdPattern = /^sess_[A-Za-z0-9_-]+$/;
const credentialName = `${privateLabel} bearer`;
const vaultMetadata = { course: 'agents-api-labs', lab: '24' };

// The app's side of the story. Only IDs and versions are kept here; the token itself lives in the vault (and, for the
// private server's own check, in lab24Mcp.ts, which plays the other party).
const state: { publicUrl: string; vaultId: string | null; lookedUp: boolean; vaultVersion: number | null; verifiedVersion: number | null; written: PublicCredential | null } = {
  publicUrl: process.env.LAB24_PUBLIC_URL?.trim() ?? '', vaultId: null, lookedUp: false, vaultVersion: null, verifiedVersion: null, written: null,
};
// Every line this lab sends to the browser passes the guard. It should never have anything to redact.
const guard = { checked: 0, redacted: 0 };

const configured = () => Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_api_key_here');
const client = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const guarded = (body: unknown): { text: string; redacted: number } => {
  const raw = JSON.stringify(body);
  const out = redact(raw, allTokenValues());
  guard.checked += 1;
  guard.redacted += out.count ? 1 : 0;
  return { text: out.text, redacted: out.count ? 1 : 0 };
};
const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(guarded(body).text);
};
const writeEvent = (response: ServerResponse, event: unknown) => {
  if (response.destroyed || response.writableEnded) return 0;
  const out = guarded(event);
  response.write(`${out.text}\n`);
  return out.redacted;
};
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 12_000) throw new Error('Request is too large.');
  }
  const parsed: unknown = raw ? JSON.parse(raw) : {};
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  return parsed as Record<string, unknown>;
}
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const errorMessage = (error: unknown) => {
  const failure = error as { status?: number; error?: { message?: string }; message?: string };
  return `${failure.status ? `${failure.status} ` : ''}${failure.error?.message ?? failure.message ?? 'The API rejected the request.'}`;
};
const rotation = (): RotationState => ({ tokens: tokenInfos(), vaultVersion: state.vaultVersion, verifiedVersion: state.verifiedVersion });

// ---- The vault: found by its metadata, so a restart does not create a second one ----

async function findVault(api: OpenAI) {
  if (state.vaultId || state.lookedUp) return state.vaultId;
  for await (const vault of api.beta.agents.vaults.list({ limit: 100 })) {
    if (vault.metadata?.course === vaultMetadata.course && vault.metadata?.lab === vaultMetadata.lab) { state.vaultId = vault.id; break; }
  }
  state.lookedUp = true;
  return state.vaultId;
}

async function readVault(api: OpenAI): Promise<VaultView | null> {
  const id = await findVault(api);
  if (!id) return null;
  try {
    const vault = await api.beta.agents.vaults.retrieve(id);
    const credentials: PublicCredential[] = [];
    for await (const credential of api.beta.agents.vaults.credentials.list(id, { limit: 100 })) credentials.push(parseCredential(credential));
    // Live, 2026-09-28: a list right after credentials.create sometimes missed the new credential for a moment.
    // Keep the one this server just wrote until the list shows it.
    if (state.written?.vaultId === id && !credentials.some((item) => item.id === state.written?.id)) credentials.unshift(state.written);
    return { id: vault.id, name: vault.name, metadata: vault.metadata ?? {}, createdAt: vault.created_at, credentials };
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      state.vaultId = null; state.lookedUp = false; state.vaultVersion = null; state.verifiedVersion = null; state.written = null;
      return null;
    }
    throw error;
  }
}

function publicState() {
  return {
    configured: configured(),
    server: { localUrl: localMcpUrl, port: mcpPort, publicUrl: state.publicUrl || null, tools: privateTools },
    tokens: tokenInfos(),
    rotation: rotation(),
    access: accessLog().slice(-40),
    guard: { ...guard },
  };
}

// GET /api/lab24/state — the private server, its tokens (versions and fingerprints only), the vault's metadata, and the log.
export async function stateLab24(_request: IncomingMessage, response: ServerResponse) {
  let vault: VaultView | null = null;
  let vaultError: string | null = null;
  if (configured()) {
    try { vault = await readVault(client()); } catch (error) { vaultError = errorMessage(error); }
  }
  // After a restart the vault may hold a token from an earlier run: its version is unknown until you update it.
  sendJson(response, 200, { ...publicState(), vault, vaultError });
}

// POST /api/lab24/public-url — the tunnel's https address. Not a secret; checked with Lab 22's URL rules.
export async function publicUrlLab24(request: IncomingMessage, response: ServerResponse) {
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const raw = text(body.url);
  if (!raw) { state.publicUrl = ''; return sendJson(response, 200, publicState()); }
  const checked = checkServerUrl(raw);
  if (!checked.url) return sendJson(response, 400, { error: 'Use a public https URL, such as https://your-tunnel.trycloudflare.com/mcp.', findings: checked.findings });
  if (!new URL(checked.url).pathname.endsWith('/mcp')) return sendJson(response, 400, { error: 'The private server answers on /mcp. End the URL with /mcp.' });
  state.publicUrl = checked.url;
  sendJson(response, 200, publicState());
}

// ---- The probe: the private server's own answer to four kinds of callers. No OpenAI call, no API key. ----

type ProbeCase = { id: string; label: string; header: string | null; shown: string };
export async function probeLab24(_request: IncomingMessage, response: ServerResponse) {
  const current = currentToken();
  const cases: ProbeCase[] = [
    { id: 'none', label: 'No Authorization header', header: null, shown: '(none)' },
    { id: 'wrong', label: 'A token the server never issued', header: 'Bearer lab24_this-token-was-never-issued-000', shown: 'Bearer lab24_this-token-was-never-issued-000' },
    ...tokenInfos().map((info) => ({ id: `v${info.version}`, label: `Token v${info.version} (${info.state})`, header: `Bearer ${tokenValue(info.version)}`, shown: `Bearer «v${info.version} · ${info.fingerprint}»` })),
  ];
  const results = [];
  for (const item of cases) {
    const started = performance.now();
    const call = async (body: unknown) => {
      const reply = await fetch(localMcpUrl, { method: 'POST', signal: AbortSignal.timeout(5_000), headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(item.header ? { Authorization: item.header } : {}) }, body: JSON.stringify(body) });
      return { status: reply.status, challenge: reply.headers.get('www-authenticate'), body: await reply.text() };
    };
    try {
      const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lab24-probe', version: '1.0.0' } } });
      let tools: string[] = [];
      if (init.status === 200) {
        const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
        tools = ((JSON.parse(list.body) as { result?: { tools?: Array<{ name: string }> } }).result?.tools ?? []).map((tool) => tool.name);
      }
      results.push({ id: item.id, label: item.label, header: item.shown, status: init.status, challenge: init.challenge, tools, ms: Math.round(performance.now() - started), current: item.id === `v${current?.info.version}` });
    } catch (error) {
      results.push({ id: item.id, label: item.label, header: item.shown, status: null, challenge: null, tools: [], ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : 'No answer.', current: false });
    }
  }
  sendJson(response, 200, { results, ...publicState() });
}

// ---- Vault setup, rotation, and removal ----

// POST /api/lab24/vault — create (or reuse) the vault and store the current token as a static_bearer credential for the
// public URL. This is the only moment the app hands the token to OpenAI; the response has metadata only.
export async function setupLab24(_request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  if (!state.publicUrl) return sendJson(response, 400, { error: 'Set the public https URL of the private server first.' });
  const token = currentToken();
  if (!token) return sendJson(response, 409, { error: 'The private server has no active token.' });
  const api = client();
  const notes: string[] = [];
  try {
    let id = await findVault(api);
    if (!id) {
      const vault = await api.beta.agents.vaults.create({ name: 'Agents API labs - Lab 24', metadata: vaultMetadata });
      id = vault.id; state.vaultId = id;
      notes.push(`Created vault ${id}.`);
    } else notes.push(`Reused vault ${id} (found by its metadata).`);
    const existing = [];
    for await (const credential of api.beta.agents.vaults.credentials.list(id, { limit: 100 })) existing.push(credential);
    // Credentials from an earlier tunnel URL would never match again: remove the ones this lab made.
    for (const old of existing.filter((item) => item.name === credentialName && item.auth.type === 'static_bearer' && item.auth.mcp_server_url !== state.publicUrl)) {
      await api.beta.agents.vaults.credentials.delete(old.id, { vault_id: id });
      notes.push(`Deleted ${old.id}: it was for ${'mcp_server_url' in old.auth ? old.auth.mcp_server_url : 'another URL'}.`);
    }
    const mine = existing.find((item) => item.name === credentialName && item.auth.type === 'static_bearer' && item.auth.mcp_server_url === state.publicUrl);
    const credential = mine
      ? await api.beta.agents.vaults.credentials.update(mine.id, { vault_id: id, auth: { type: 'static_bearer', token: token.value } })
      : await api.beta.agents.vaults.credentials.create(id, { name: credentialName, auth: { type: 'static_bearer', token: token.value, mcp_server_url: state.publicUrl } });
    state.written = parseCredential(credential);
    notes.push(mine ? `Updated ${credential.id} with token v${token.info.version}.` : `Created ${credential.id} with token v${token.info.version}.`);
    state.vaultVersion = token.info.version;
    // The raw API response is shown in the browser on purpose: it proves the secret is write-only.
    sendJson(response, 200, { notes, credential, secretsInResponse: findSecrets(credential, allTokenValues()).length, vault: await readVault(api), ...publicState() });
  } catch (error) {
    sendJson(response, 502, { error: errorMessage(error), notes });
  }
}

// POST /api/lab24/rotate — one step at a time: mint, update, revoke. Verify is a live run.
export async function rotateLab24(request: IncomingMessage, response: ServerResponse) {
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const step = text(body.step);
  if (step === 'mint') {
    const info = mintToken();
    return sendJson(response, 200, { notes: [`Issued token v${info.version} (${info.fingerprint}). The server still accepts the older one.`], ...publicState() });
  }
  if (step === 'update') {
    if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
    const token = currentToken();
    const api = client();
    try {
      const vault = await readVault(api);
      const credential = vault?.credentials.find((item) => item.name === credentialName && item.serverUrl === state.publicUrl);
      if (!vault || !credential || !token) return sendJson(response, 409, { error: 'There is no credential for the current public URL. Create the vault first.' });
      const updated = await api.beta.agents.vaults.credentials.update(credential.id, { vault_id: vault.id, auth: { type: 'static_bearer', token: token.value } });
      state.written = parseCredential(updated);
      state.vaultVersion = token.info.version;
      return sendJson(response, 200, { notes: [`credentials.update(${updated.id}): the vault now holds v${token.info.version}. Same ID; updated_at ${updated.updated_at}.`], credential: updated, vault: await readVault(api), ...publicState() });
    } catch (error) { return sendJson(response, 502, { error: errorMessage(error) }); }
  }
  if (step === 'revoke') {
    const findings = checkRevoke(rotation());
    // force: revoke before the vault is updated, to watch every new vault session fail with 401.
    if (findings.some((item) => item.level === 'error') && body.force !== true) return sendJson(response, 409, { error: findings[0].text, findings });
    const revoked = revokeRetiring();
    return sendJson(response, 200, { notes: revoked.length ? [`Revoked ${revoked.map((item) => `v${item.version}`).join(', ')}.`] : ['Nothing to revoke.'], findings, ...publicState() });
  }
  sendJson(response, 400, { error: 'step must be mint, update, or revoke.' });
}

// Deleting stored credentials does not revoke provider tokens or cancel running sessions.
export async function deleteLab24(_request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  const api = client();
  try {
    const id = await findVault(api);
    if (!id) return sendJson(response, 404, { error: 'There is no Lab 24 vault.' });
    const deleted = await api.beta.agents.vaults.delete(id);
    state.vaultId = null; state.vaultVersion = null; state.verifiedVersion = null; state.written = null;
    sendJson(response, 200, { deleted, notes: [`Deleted ${deleted.id} and its credentials.`], vault: null, ...publicState() });
  } catch (error) { sendJson(response, 502, { error: errorMessage(error) }); }
}

// ---- The live run ----

function settingsOf(body: Record<string, unknown>): AuthSettings {
  const mode: AuthMode = body.mode === 'inline' || body.mode === 'none' ? body.mode : 'vault';
  return {
    mode, label: privateLabel, serverUrl: state.publicUrl,
    credentialId: typeof body.credentialId === 'string' && body.credentialId ? body.credentialId.slice(0, 200) : null,
    allowed: Array.isArray(body.allowed) ? body.allowed.filter((name): name is string => typeof name === 'string').slice(0, 8) : privateTools,
    saveAsAgent: false,
  };
}

// POST /api/lab24/run — one question to the private server with the chosen credential source. With sessionId, the question
// is a new turn in that session: use it after a rotation to see which token an existing session sends.
export async function runLab24(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const prompt = text(body.prompt);
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });
  const continueId = text(body.sessionId);
  if (continueId && !sessionIdPattern.test(continueId)) return sendJson(response, 400, { error: 'Invalid session ID.' });
  const api = client();
  const settings = settingsOf(body);
  if (continueId) {
    try {
      const session = await api.beta.agents.sessions.retrieve(continueId);
      const mode = session.metadata?.lab24_auth_mode;
      if (mode !== 'inline' && mode !== 'vault' && mode !== 'none') return sendJson(response, 400, { error: 'Choose a session created by Lab 24.' });
      settings.mode = mode;
    } catch (error) { return sendJson(response, 502, { error: errorMessage(error) }); }
  }
  let vault: VaultView | null = null;
  try { vault = !continueId && settings.mode === 'vault' ? await readVault(api) : null; } catch (error) { return sendJson(response, 502, { error: errorMessage(error) }); }
  const built = buildPrivateRequest(settings, vault, body.skipChecks === true);
  // Send anyway lets students watch the API or the private server refuse a declaration the app would refuse.
  // A continued session already has its tools and vaults: the declaration is only checked for a new session.
  if (!built.request && !continueId) return sendJson(response, 400, { error: 'Fix the declaration first.', findings: built.findings });
  const token = currentToken();

  const run: AuthRun = { mode: settings.mode, prompt, sessionId: continueId || null, turnStatus: 'unknown', calls: [], answer: '', error: null, access: [], redacted: 0, durationMs: null };
  const callMap = new Map<string, McpCall>();
  const parts = new Map<string, string>();
  const commentary = new Set<string>();
  let turnId: string | null = null;
  const since = Date.now();
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const emit = (event: unknown) => { run.redacted += writeEvent(response, event); };
  let stream: Stream<AgentSessionEvent> | undefined;
  response.on('close', () => stream?.controller.abort());
  const limit = setTimeout(() => stream?.controller.abort(), runLimitMs);
  try {
    const request = built.request;
    // The browser sees the placeholder version. Only the object passed to the SDK carries the real header.
    emit({ type: 'declared', request, findings: built.findings, continued: Boolean(continueId) });
    if (continueId) {
      stream = await api.beta.agents.sessions.events.stream(continueId);
      await api.beta.agents.sessions.events.create(continueId, { events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }] });
    } else {
      if (!request) throw new Error('No valid private MCP declaration.');
      const tool = settings.mode === 'inline' && token ? withSecret(request.tool, token.value) : request.tool;
      stream = await api.beta.agents.sessions.create({
        agent: { ...agent, instructions: privateInstructions(new Date().toISOString().slice(0, 10), privateLabel), tools: [tool] },
        environment: { type: 'none' },
        metadata: { lab24_auth_mode: settings.mode },
        input: prompt,
        stream: true,
        ...(request?.vault_ids ? { vault_ids: request.vault_ids } : {}),
      });
    }
    for await (const event of stream) {
      if (response.destroyed) break;
      if (event.type === 'agent.session.created') { run.sessionId = event.session.id; emit({ type: 'session', sessionId: run.sessionId }); }
      if ('turn' in event && event.turn?.subagent_id == null && !turnId) turnId = event.turn.id;
      if ((event.type === 'agent.session.turn.item.added' || event.type === 'agent.session.turn.item.done') && event.item.type === 'mcp_call') {
        const call = parseMcpCall(event.item);
        callMap.set(call.id, call);
        emit({ type: 'call', call, access: accessLog(since) });
        continue;
      }
      if (event.type === 'agent.session.turn.item.added' && event.item.type === 'message' && event.item.phase === 'commentary' && event.item.id) commentary.add(event.item.id);
      if ((event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') && !commentary.has(event.item_id)) {
        const key = `${event.item_id}:${event.content_index}`;
        parts.set(key, event.type === 'agent.session.turn.output_text.delta' ? (parts.get(key) ?? '') + event.delta : event.text);
        run.answer = [...parts.values()].join('\n');
        emit({ type: 'text', text: run.answer });
        continue;
      }
      if (event.type === 'agent.session.requires_action') {
        run.error = 'The turn asked for a function result, but this lab declares no function tools. The server cancelled it.';
        await api.beta.agents.sessions.events.create(run.sessionId ?? '', { events: [{ type: 'agent.session.input.cancel' }] });
        continue;
      }
      const terminal = event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled';
      if (terminal && event.turn.subagent_id == null && (!turnId || event.turn.id === turnId)) {
        run.turnStatus = event.turn.status as TurnStatus;
        if (event.type === 'agent.session.turn.failed') run.error = event.turn.error?.message ?? 'The turn failed.';
        break;
      }
      if (event.type === 'error') { run.turnStatus = 'failed'; run.error = event.error?.message ?? 'The agent returned an error.'; break; }
      if (event.type === 'agent.session.failed') { run.turnStatus = 'failed'; run.error = 'The agent session failed.'; break; }
    }
    if (run.turnStatus === 'unknown' && !run.error) run.error = 'The stream closed before the turn had an outcome.';
  } catch (caught) {
    if (response.destroyed) return;
    run.error = errorMessage(caught);
    run.turnStatus = 'failed';
  } finally {
    clearTimeout(limit);
    stream?.controller.abort();
    run.calls = [...callMap.values()];
    run.access = accessLog(since);
    run.durationMs = Date.now() - since;
    const verdict = judgeAuthRun(run, token?.info.version ?? null);
    // A vault run that reached the server with the active token is the proof step 3 of a rotation needs.
    if (settings.mode === 'vault' && verdict.outcome === 'authenticated' && token && verdict.versions.includes(token.info.version)) state.verifiedVersion = token.info.version;
    emit({ type: 'summary', run, ...publicState() });
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

// POST /api/lab24/test — the same suite as the browser, on the server. No network, no API key.
export function testLab24(_request: IncomingMessage, response: ServerResponse) {
  try {
    const started = performance.now();
    const results = runVaultSuite();
    sendJson(response, 200, { results, runtime: `Node ${process.version}`, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'The suite crashed.' });
  }
}

// Saved items need the same leak guard as every other Lab 24 reply.
export async function itemsLab24(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  const sessionId = text(new URL(request.url ?? '', 'http://localhost').searchParams.get('sessionId'));
  if (!sessionIdPattern.test(sessionId) || sessionId.length > 200) return sendJson(response, 400, { error: 'Invalid session ID.' });
  try {
    const page = await client().beta.agents.sessions.items.list(sessionId, { order: 'asc', limit: 100 });
    sendJson(response, 200, { items: page.data.map(savedItem), hasMore: page.hasNextPage() });
  } catch (error) { sendJson(response, 502, { error: errorMessage(error) }); }
}
