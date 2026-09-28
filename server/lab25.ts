import type { IncomingMessage, ServerResponse } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import OpenAI from 'openai';
import type { AgentSessionEvent } from 'openai/resources/beta/agents/agents';
import type { Stream } from 'openai/core/streaming';
import type { TurnStatus } from '../src/lab16Tool.ts';
import { hasErrors, parseMcpCall, type McpCall } from '../src/lab22Mcp.ts';
import {
  buildEnvironment, maxPluginBytes, networkFor, packPlugin, pluginInstructions, pluginParam, withArchive,
  type HostedEnvironment, type InstallMode, type InstallSettings, type NetworkAccess, type PluginFile, type PluginRun, type TemplateView,
} from '../src/lab25Plugin.ts';
import { runPluginSuite } from '../src/lab25Tests.ts';

type AgentConfig = { model: string; instructions: string };

const pluginRoot = resolve(import.meta.dirname, '..', 'plugins', 'course-docs');
const templateName = 'Agents API labs - Lab 25';
// Live, 2026-09-28: environment.ready arrived about 19 s after sessions.create. Wait longer than that, but not forever.
const readyLimitMs = 150_000;
const runLimitMs = 360_000;
const bodyLimit = maxPluginBytes * 2 + 20_000;

// Templates have no metadata, so the app finds its own by name. The fingerprint and version of what it stored are
// known only to this process: after a restart they are unknown until the template is updated.
const state: { templateId: string | null; lookedUp: boolean; fingerprint: string | null; version: string | null } = { templateId: null, lookedUp: false, fingerprint: null, version: null };

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
    if (raw.length > bodyLimit) throw new Error('Request is too large.');
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
const networkOf = (value: unknown): NetworkAccess => (value === 'enabled' || value === 'disabled' ? value : 'restricted');

// ---- The plugin folder on disk, and drafts from the workbench ----

async function readFolder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? readFolder(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)]))));
  return nested.flat();
}
export async function diskPlugin(): Promise<PluginFile[]> {
  const paths = await readFolder(pluginRoot);
  const files = await Promise.all(paths.map(async (path) => ({ path: relative(pluginRoot, path).split('\\').join('/'), text: await readFile(path, 'utf8') })));
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}
// The browser may send an edited copy. It is only text: the server checks and packs it again itself.
function filesOf(value: unknown): PluginFile[] | null {
  if (!Array.isArray(value) || value.length > 40) return null;
  const files = value.map((item) => (typeof item === 'object' && item !== null && typeof (item as PluginFile).path === 'string' && typeof (item as PluginFile).text === 'string' ? { path: (item as PluginFile).path.slice(0, 300), text: (item as PluginFile).text } : null));
  return files.every(Boolean) ? files as PluginFile[] : null;
}

// ---- The environment template: store the archive once ----

type RawTemplate = { id: string; name: string | null; plugins: Array<{ name: string; description: string }>; network: { access: string; allowed_domains: string[] }; created_at: number; updated_at: number };
const templateView = (raw: RawTemplate): TemplateView => ({
  id: raw.id, name: raw.name, plugins: raw.plugins.map((item) => ({ name: item.name, description: item.description })), network: raw.network,
  createdAt: raw.created_at, updatedAt: raw.updated_at,
  fingerprint: raw.id === state.templateId ? state.fingerprint : null, version: raw.id === state.templateId ? state.version : null,
});

async function findTemplate(api: OpenAI): Promise<RawTemplate | null> {
  if (state.templateId) {
    try { return await api.beta.agents.environments.templates.retrieve(state.templateId) as RawTemplate; }
    catch (error) { if ((error as { status?: number }).status !== 404) throw error; Object.assign(state, { templateId: null, lookedUp: false, fingerprint: null, version: null }); }
  }
  if (state.lookedUp) return null;
  for await (const template of api.beta.agents.environments.templates.list({ limit: 100 })) {
    if (template.name === templateName) { state.templateId = template.id; state.lookedUp = true; return template as RawTemplate; }
  }
  state.lookedUp = true;
  return null;
}

// GET /api/lab25/plugin — the plugin folder as it is on disk, and the template's metadata if there is one.
export async function pluginLab25(_request: IncomingMessage, response: ServerResponse) {
  try {
    const files = await diskPlugin();
    let template: TemplateView | null = null;
    let templateError: string | null = null;
    if (configured()) {
      try { const raw = await findTemplate(client()); template = raw ? templateView(raw) : null; } catch (error) { templateError = errorMessage(error); }
    }
    sendJson(response, 200, { configured: configured(), root: 'plugins/course-docs', files, template, templateError });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'Could not read the plugin folder.' });
  }
}

// POST /api/lab25/template — create the template, or replace its plugins and network. The archive is sent once, here.
export async function templateLab25(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const files = filesOf(body.files) ?? await diskPlugin();
  const { packed, check } = packPlugin(files);
  if (!packed) return sendJson(response, 400, { error: 'Fix the plugin first: it does not pack.', findings: check.findings });
  const access = networkOf(body.network);
  const params = { name: templateName, network: networkFor(access, check.servers), plugins: [pluginParam(packed, packed.base64)] };
  try {
    const api = client();
    const existing = await findTemplate(api);
    const raw = (existing
      ? await api.beta.agents.environments.templates.update(existing.id, params)
      : await api.beta.agents.environments.templates.create(params)) as RawTemplate;
    Object.assign(state, { templateId: raw.id, lookedUp: true, fingerprint: packed.fingerprint, version: packed.version });
    // The raw response is shown as is: it lists the plugin's name and description, never the archive.
    sendJson(response, 200, { template: templateView(raw), raw, updated: Boolean(existing), sentChars: packed.base64Chars });
  } catch (error) {
    sendJson(response, 502, { error: errorMessage(error) });
  }
}

// DELETE /api/lab25/template — sessions already running keep their environment; new sessions cannot use the ID.
export async function deleteTemplateLab25(_request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  try {
    const api = client();
    const existing = await findTemplate(api);
    if (existing) await api.beta.agents.environments.templates.delete(existing.id);
    Object.assign(state, { templateId: null, lookedUp: true, fingerprint: null, version: null });
    sendJson(response, 200, { template: null, deleted: Boolean(existing) });
  } catch (error) {
    sendJson(response, 502, { error: errorMessage(error) });
  }
}

// ---- The live run: create the session, wait for its environment, then ask ----

type Trace = { run: PluginRun; started: number; calls: Map<string, McpCall>; parts: Map<string, string>; commentary: Set<string>; seen: Set<string>; turnId: string | null; lastEventAt: number; settled: boolean };
// Live, 2026-09-28: a turn completed at the API (session idle, final answer saved) while the event stream never delivered
// agent.session.turn.completed. When the stream is quiet this long, the server asks for the turn instead of waiting.
const quietMs = 10_000;
const terminalStatuses = ['completed', 'failed', 'cancelled'];
const answerOf = (trace: Trace) => [...trace.parts.values()].join('\n');
const elapsed = (trace: Trace) => Date.now() - trace.started;

function seeCall(response: ServerResponse, trace: Trace, item: unknown) {
  const call = parseMcpCall(item);
  if (call.output && call.output.length > 6_000) call.output = `${call.output.slice(0, 6_000)}\n… (${call.output.length.toLocaleString('en')} characters in all)`;
  trace.calls.set(call.id, call);
  writeEvent(response, { type: 'call', call });
}

async function follow(response: ServerResponse, trace: Trace, stream: Stream<AgentSessionEvent>, send: (why: 'ready' | 'timeout') => Promise<void>) {
  for await (const event of stream) {
    if (response.destroyed) return;
    if (trace.seen.has(event.event_id)) continue;
    trace.seen.add(event.event_id);
    trace.lastEventAt = Date.now();
    if (trace.settled) return;
    if (event.type !== 'agent.session.turn.output_text.delta') writeEvent(response, { type: 'event', name: event.type, ms: elapsed(trace) });
    if (event.type === 'agent.session.environment.ready' || event.type === 'agent.session.environment.connected') {
      if (trace.run.readyMs === null) trace.run.readyMs = elapsed(trace);
      await send('ready');
      continue;
    }
    if (event.type === 'agent.session.environment.failed') {
      trace.run.turnStatus = 'failed';
      trace.run.error = `The hosted environment failed${event.environment.error ? `: ${event.environment.error.message ?? event.environment.error.code}` : '.'}`;
      return;
    }
    if ('turn' in event && event.turn?.subagent_id == null && !trace.turnId) trace.turnId = event.turn.id;
    if ((event.type === 'agent.session.turn.item.added' || event.type === 'agent.session.turn.item.done') && event.item.type === 'mcp_call') { seeCall(response, trace, event.item); continue; }
    if (event.type === 'agent.session.turn.item.done' && event.item.type === 'command_execution') { trace.run.commands += 1; continue; }
    if (event.type === 'agent.session.turn.item.added' && event.item.type === 'message' && event.item.phase === 'commentary' && event.item.id) trace.commentary.add(event.item.id);
    if ((event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') && !trace.commentary.has(event.item_id)) {
      const key = `${event.item_id}:${event.content_index}`;
      trace.parts.set(key, event.type === 'agent.session.turn.output_text.delta' ? (trace.parts.get(key) ?? '') + event.delta : event.text);
      writeEvent(response, { type: 'text', text: answerOf(trace) });
      continue;
    }
    const terminal = event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled';
    if (terminal && event.turn.subagent_id == null && (!trace.turnId || event.turn.id === trace.turnId)) {
      trace.settled = true;
      trace.run.turnStatus = event.turn.status as TurnStatus;
      if (event.type === 'agent.session.turn.failed') trace.run.error = event.turn.error?.message ?? 'The turn failed.';
      return;
    }
    if (event.type === 'error') { trace.run.turnStatus = 'failed'; trace.run.error = event.error?.message ?? 'The agent returned an error.'; return; }
    if (event.type === 'agent.session.failed') { trace.run.turnStatus = 'failed'; trace.run.error = 'The agent session failed.'; return; }
  }
  if (trace.run.turnStatus === 'unknown' && !trace.run.error) trace.run.error = 'The stream closed before the turn had an outcome.';
}

// The stream went quiet: ask the API for the turn. If it has ended, rebuild the calls and the answer from the saved items.
export async function settleFromApi(api: OpenAI, response: ServerResponse, trace: Trace, sessionId: string): Promise<boolean> {
  const turn = trace.turnId
    ? await api.beta.agents.sessions.turns.retrieve(trace.turnId, { session_id: sessionId })
    : (await api.beta.agents.sessions.turns.list(sessionId, { limit: 5 })).data.find((item) => item.subagent_id == null);
  if (!turn || !terminalStatuses.includes(turn.status) || trace.settled) return false;
  trace.settled = true;
  trace.turnId = turn.id;
  trace.run.turnStatus = turn.status as TurnStatus;
  trace.run.completion = 'polled';
  if (turn.status === 'failed') trace.run.error = turn.error?.message ?? 'The turn failed.';
  writeEvent(response, { type: 'status', label: `The stream went quiet for ${quietMs / 1000} s; the API says the turn ${turn.status}. Reading the saved items.` });
  const page = await api.beta.agents.sessions.items.list(sessionId, { order: 'asc', limit: 100 });
  const answer: string[] = [];
  for (const item of page.data) {
    if ('turn_id' in item && item.turn_id !== turn.id) continue;
    if (item.type === 'mcp_call' && !trace.calls.has(item.id)) seeCall(response, trace, item);
    if (item.type === 'message' && item.role === 'assistant' && item.phase !== 'commentary') answer.push(item.content.map((part) => ('text' in part ? part.text : '')).join(''));
  }
  if (answer.length) {
    trace.parts = new Map([['saved', answer.join('\n')]]);
    writeEvent(response, { type: 'text', text: answerOf(trace) });
  }
  return true;
}

// POST /api/lab25/run — one question in a brand-new session: the plugin inline, from the template, or not at all.
export async function runLab25(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const prompt = text(body.prompt);
  if (!prompt || prompt.length > 2000) return sendJson(response, 400, { error: 'Prompt must be between 1 and 2,000 characters.' });
  const mode: InstallMode = body.mode === 'template' || body.mode === 'none' ? body.mode : 'inline';
  const sendEarly = body.sendEarly === true;
  const files = filesOf(body.files) ?? await diskPlugin();
  const { packed, check } = packPlugin(files);
  if (mode === 'template' && !state.templateId) {
    try { await findTemplate(client()); } catch (error) { return sendJson(response, 502, { error: errorMessage(error) }); }
  }
  const settings: InstallSettings = { mode, network: networkOf(body.network), templateId: state.templateId };
  const declared = buildEnvironment(settings, packed, check);
  if (!declared.environment || hasErrors(declared.findings)) return sendJson(response, 400, { error: 'Fix the plugin or the install settings first.', findings: declared.findings });
  const shown: HostedEnvironment = declared.environment;
  const environment = mode === 'inline' && packed ? withArchive(shown, packed.base64) : shown;

  const trace: Trace = {
    run: {
      mode, prompt, sessionId: null, templateId: mode === 'template' ? settings.templateId : null, turnStatus: 'unknown', installed: [], capabilityDirs: [], sent: sendEarly ? 'early' : 'ready', readyMs: null,
      calls: [], commands: 0, answer: '', error: null, durationMs: null,
      fingerprint: mode === 'inline' ? packed?.fingerprint ?? null : mode === 'template' ? state.fingerprint : null,
      requestChars: JSON.stringify(environment).length, completion: 'stream',
    },
    started: Date.now(), calls: new Map(), parts: new Map(), commentary: new Set(), seen: new Set(), turnId: null, lastEventAt: Date.now(), settled: false,
  };
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = client();
  let stream: Stream<AgentSessionEvent> | undefined;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  response.on('close', () => stream?.controller.abort());
  const limit = setTimeout(() => stream?.controller.abort(), runLimitMs);
  try {
    writeEvent(response, { type: 'declared', environment: shown, findings: declared.findings, requestChars: trace.run.requestChars });
    writeEvent(response, { type: 'status', label: mode === 'template' ? 'Creating a session from the environment template' : mode === 'inline' ? `Creating a session with ${packed?.name} installed inline` : 'Creating a session with no plugin' });
    // No input yet: a hosted session may be created without one, so the question can wait for the environment.
    const session = await api.beta.agents.sessions.create({ agent: { model: agent.model, instructions: pluginInstructions(new Date().toISOString().slice(0, 10)) }, environment });
    trace.run.sessionId = session.id;
    if (session.environment.type === 'openai_hosted') {
      trace.run.installed = session.environment.plugins.map((plugin) => ({ name: plugin.name, description: plugin.description }));
      trace.run.capabilityDirs = session.environment.capability_directories;
    }
    writeEvent(response, { type: 'session', sessionId: session.id, installed: trace.run.installed, capabilityDirs: trace.run.capabilityDirs, ms: elapsed(trace) });

    stream = await api.beta.agents.sessions.events.stream(session.id);
    let sent = false;
    const send = async (why: 'ready' | 'timeout' | 'early') => {
      if (sent) return;
      sent = true;
      clearTimeout(waiting);
      trace.run.sent = why;
      writeEvent(response, { type: 'status', label: why === 'early' ? 'Sending the question now, without waiting (to see the race)' : why === 'ready' ? `Environment ready after ${(elapsed(trace) / 1000).toFixed(1)} s: sending the question` : `No ready event within ${readyLimitMs / 1000} s: sending the question anyway` });
      await api.beta.agents.sessions.events.create(session.id, { events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }] });
      trace.lastEventAt = Date.now();
      // Once the question is in, a quiet stream is checked against the API instead of trusted to deliver the outcome.
      let checking = false;
      watchdog = setInterval(() => {
        if (checking || trace.settled || Date.now() - trace.lastEventAt < quietMs) return;
        checking = true;
        settleFromApi(api, response, trace, session.id)
          .then((done) => { if (done) stream?.controller.abort(); else trace.lastEventAt = Date.now(); })
          .catch(() => { trace.lastEventAt = Date.now(); })
          .finally(() => { checking = false; });
      }, 2_500);
    };
    if (sendEarly) await send('early');
    else {
      writeEvent(response, { type: 'status', label: 'Waiting for agent.session.environment.ready before asking' });
      waiting = setTimeout(() => { void send('timeout').catch(() => stream?.controller.abort()); }, readyLimitMs);
    }
    await follow(response, trace, stream, send);
  } catch (caught) {
    if (response.destroyed) return;
    // The watchdog aborts the stream after it read the outcome from the API: that is not an error.
    if (trace.run.completion === 'polled') return;
    trace.run.error = errorMessage(caught);
    if (trace.run.turnStatus === 'unknown') trace.run.turnStatus = 'failed';
  } finally {
    clearTimeout(limit);
    clearTimeout(waiting);
    clearInterval(watchdog);
    stream?.controller.abort();
    trace.run.calls = [...trace.calls.values()];
    trace.run.answer = answerOf(trace);
    trace.run.durationMs = elapsed(trace);
    writeEvent(response, { type: 'summary', run: trace.run });
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

// POST /api/lab25/test — the same suite as the browser, on the server. No network, no API key.
export function testLab25(_request: IncomingMessage, response: ServerResponse) {
  try {
    const started = performance.now();
    const results = runPluginSuite();
    sendJson(response, 200, { results, runtime: `Node ${process.version}`, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'The suite crashed.' });
  }
}
