import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import type { AgentSessionEvent } from 'openai/resources/beta/agents/agents';
import type { Stream } from 'openai/core/streaming';
import type { TurnStatus } from '../src/lab16Tool.ts';
import { parseCommand, parseUsage, type CommandRun } from '../src/lab26Environment.ts';
import { checkDataset, isAccountLimit, makeDataset, parseFileRef } from '../src/lab27Files.ts';
import {
  artifactIdPattern, buildEnvironment, cancelAfterMs, checkDownload, downloadHeaders, forTurn, instructions, isText, parseArtifact, previewLimit, promptsFor, sessionIdPattern,
  type ArtifactRef, type ArtifactRun, type Download, type Task, type TurnRef,
} from '../src/lab29Artifacts.ts';
import { runArtifactSuite } from '../src/lab29Tests.ts';

type AgentConfig = { model: string; instructions: string };

// Live, 2026-09-28: environment.ready after 21.0 s; the artifacts were listed 0.6 s after turn.completed.
const readyLimitMs = 180_000;
const runLimitMs = 360_000;
// Live (Lab 25): a turn completed at the API while the stream never delivered turn.completed. Check when quiet this long.
const quietMs = 10_000;
const outputLimit = 4_000;
const maxDownloads = 20;

// Downloads and deletes are proxied only for sessions this server created. The browser never names an arbitrary session.
const owned = new Set<string>();

const configured = () => Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_api_key_here');
const client = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};
const writeEvent = (response: ServerResponse, event: unknown) => {
  if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(event)}\n`);
};
async function readBody(request: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > limit) throw new Error('Request is too large.');
  }
  const parsed: unknown = raw ? JSON.parse(raw) : {};
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  return parsed as Record<string, unknown>;
}
const errorMessage = (error: unknown) => {
  const failure = error as { status?: number; error?: { message?: string }; message?: string };
  return `${failure.status ? `${failure.status} ` : ''}${failure.error?.message ?? failure.message ?? 'The API rejected the request.'}`;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Trace = { run: ArtifactRun; started: number; commands: Map<string, CommandRun>; commentary: Map<string, string>; seen: Set<string>; finished: Set<string> };
type TurnState = { turnId: string | null; parts: Map<string, string>; settled: boolean; status: TurnStatus; lastEventAt: number; endedAt: number | null };
const terminalStatuses = ['completed', 'failed', 'cancelled'];
const elapsed = (trace: Trace) => Date.now() - trace.started;
const answerOf = (state: TurnState) => [...state.parts.values()].join('\n');
const fail = (trace: Trace, message: string, kind: ArtifactRun['errorKind'] = 'api') => { trace.run.error = message; trace.run.errorKind = isAccountLimit(message) ? 'account' : kind; };

function seeCommand(response: ServerResponse, trace: Trace, item: unknown) {
  const command = parseCommand(item);
  if (command.output && command.output.length > outputLimit) command.output = `${command.output.slice(0, 1_000)}\n… (${command.output.length.toLocaleString('en')} characters in all) …\n${command.output.slice(-2_500)}`;
  trace.commands.set(command.id, command);
  writeEvent(response, { type: 'command', command });
}

// One turn on its own stream: send the message (after the first environment.ready for turn 1), follow it to its end.
async function runTurn(api: OpenAI, response: ServerResponse, trace: Trace, sessionId: string, prompt: string, first: boolean): Promise<TurnState> {
  const state: TurnState = { turnId: null, parts: new Map(), settled: false, status: 'unknown', lastEventAt: Date.now(), endedAt: null };
  const stream: Stream<AgentSessionEvent> = await api.beta.agents.sessions.events.stream(sessionId);
  const abort = () => stream.controller.abort();
  response.on('close', abort);
  let sent = false;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  const settle = (status: TurnStatus) => { state.settled = true; state.status = status; state.endedAt = Date.now(); };
  const send = async () => {
    if (sent) return;
    sent = true;
    writeEvent(response, { type: 'status', label: first ? `Sandbox ready after ${trace.run.readyMs === null ? '—' : `${(trace.run.readyMs / 1000).toFixed(1)} s`}: sending turn 1` : `Sending turn ${trace.run.turns.length + 1}` });
    await api.beta.agents.sessions.events.create(sessionId, { events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }] });
    state.lastEventAt = Date.now();
    let checking = false;
    watchdog = setInterval(() => {
      if (checking || state.settled || Date.now() - state.lastEventAt < quietMs) return;
      checking = true;
      settleFromApi(api, response, trace, state, sessionId)
        .then((done) => { if (done) abort(); else state.lastEventAt = Date.now(); })
        .catch(() => { state.lastEventAt = Date.now(); })
        .finally(() => { checking = false; });
    }, 2_500);
  };
  const waiting = first ? setTimeout(() => { void send().catch(abort); }, readyLimitMs) : undefined;
  try {
    if (!first) await send();
    for await (const event of stream) {
      if (response.destroyed) break;
      if (trace.seen.has(event.event_id)) continue;
      trace.seen.add(event.event_id);
      state.lastEventAt = Date.now();
      if (state.settled) break;
      if (!/delta/.test(event.type)) writeEvent(response, { type: 'event', name: event.type, ms: elapsed(trace) });
      // Live: environment.ready arrived again with every new turn. Only the first one sends turn 1.
      if (event.type === 'agent.session.environment.ready') {
        if (trace.run.readyMs === null) trace.run.readyMs = elapsed(trace);
        if (first) { clearTimeout(waiting); await send(); }
        continue;
      }
      if (event.type === 'agent.session.environment.failed') { fail(trace, `The hosted environment failed: ${event.environment.error?.message ?? event.environment.error?.code ?? 'no reason given'}`, 'environment'); break; }
      if ('turn' in event && event.turn?.subagent_id == null && !state.turnId && !trace.finished.has(event.turn.id)) state.turnId = event.turn.id;
      if (event.type === 'agent.session.turn.item.done' && event.item.type === 'command_execution') { seeCommand(response, trace, event.item); continue; }
      if (event.type === 'agent.session.turn.item.added' && event.item.type === 'command_execution') {
        writeEvent(response, { type: 'status', label: 'Running a command in the sandbox' });
        // The cancel task: stop the turn while its command (write draft.md, then sleep) is still running.
        if (trace.run.task === 'cancel' && !cancelTimer) cancelTimer = setTimeout(() => {
          writeEvent(response, { type: 'status', label: `Cancelling the turn ${cancelAfterMs / 1000} s into the command` });
          api.beta.agents.sessions.events.create(sessionId, { events: [{ type: 'agent.session.input.cancel' }] }).catch((caught) => writeEvent(response, { type: 'status', label: `Cancel failed: ${errorMessage(caught)}` }));
        }, cancelAfterMs);
        continue;
      }
      if (event.type === 'agent.session.turn.item.added' && event.item.type === 'message' && event.item.phase === 'commentary' && event.item.id) { trace.commentary.set(event.item.id, ''); continue; }
      if (event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') {
        const target = trace.commentary.has(event.item_id) ? trace.commentary : state.parts;
        const key = target === trace.commentary ? event.item_id : `${event.item_id}:${event.content_index}`;
        target.set(key, event.type === 'agent.session.turn.output_text.delta' ? (target.get(key) ?? '') + event.delta : event.text);
        writeEvent(response, { type: 'text', text: answerOf(state), commentary: [...trace.commentary.values()].filter(Boolean) });
        continue;
      }
      const terminal = event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled';
      if (terminal && event.turn.subagent_id == null && (!state.turnId || event.turn.id === state.turnId)) {
        state.turnId = event.turn.id;
        settle(event.turn.status as TurnStatus);
        trace.run.usage = parseUsage(event.turn.usage) ?? trace.run.usage;
        if (event.type === 'agent.session.turn.failed') fail(trace, event.turn.error?.message ?? 'The turn failed.');
        break;
      }
      if (event.type === 'error') { fail(trace, event.error?.message ?? 'The agent returned an error.'); break; }
      if (event.type === 'agent.session.failed') { fail(trace, 'The agent session failed.'); break; }
    }
  } finally {
    clearTimeout(waiting);
    clearTimeout(cancelTimer);
    clearInterval(watchdog);
    response.off('close', abort);
    abort();
  }
  if (!state.settled && !trace.run.error && !response.destroyed) {
    // One last look: the stream closed or was aborted by the watchdog.
    try { await settleFromApi(api, response, trace, state, sessionId); } catch { /* the outcome stays unknown */ }
    if (!state.settled) trace.run.error = 'The stream closed before the turn had an outcome.';
  }
  if (state.turnId) trace.finished.add(state.turnId);
  return state;
}

// The stream went quiet: ask the API for the turn. If it has ended, rebuild the commands and the answer from saved items.
async function settleFromApi(api: OpenAI, response: ServerResponse, trace: Trace, state: TurnState, sessionId: string): Promise<boolean> {
  const turn = state.turnId
    ? await api.beta.agents.sessions.turns.retrieve(state.turnId, { session_id: sessionId })
    : (await api.beta.agents.sessions.turns.list(sessionId, { limit: 5 })).data.find((item) => item.subagent_id == null && !trace.finished.has(item.id));
  if (!turn || !terminalStatuses.includes(turn.status) || state.settled) return false;
  state.turnId = turn.id;
  state.settled = true; state.status = turn.status as TurnStatus; state.endedAt = Date.now();
  trace.run.usage = parseUsage(turn.usage) ?? trace.run.usage;
  if (turn.status === 'failed') fail(trace, turn.error?.message ?? 'The turn failed.');
  writeEvent(response, { type: 'status', label: `The stream went quiet; the API says the turn ${turn.status}. Reading the saved items.` });
  const page = await api.beta.agents.sessions.items.list(sessionId, { order: 'asc', limit: 100 });
  const answer: string[] = [];
  for (const item of page.data) {
    if (!('turn_id' in item) || item.turn_id !== turn.id) continue;
    if (item.type === 'command_execution' && !trace.commands.has(item.id)) seeCommand(response, trace, item);
    if (item.type === 'message' && item.role === 'assistant') {
      const text = item.content.map((part) => ('text' in part ? part.text : '')).join('');
      if (item.phase === 'commentary') trace.commentary.set(item.id, text); else answer.push(text);
    }
  }
  if (answer.length) state.parts = new Map([['saved', answer.join('\n')]]);
  writeEvent(response, { type: 'text', text: answerOf(state), commentary: [...trace.commentary.values()].filter(Boolean) });
  return true;
}

// Every artifact in the session, oldest first. The SDK pages for us; stop at a few hundred.
async function listArtifacts(api: OpenAI, sessionId: string): Promise<ArtifactRef[]> {
  const artifacts: ArtifactRef[] = [];
  for await (const item of api.beta.agents.sessions.artifacts.list(sessionId, { order: 'asc', limit: 100 })) {
    artifacts.push(parseArtifact(item));
    if (artifacts.length >= 300) break;
  }
  return artifacts;
}

async function download(api: OpenAI, sessionId: string, artifact: ArtifactRef): Promise<Download> {
  try {
    const result = await api.beta.agents.sessions.artifacts.content(artifact.id, { session_id: sessionId });
    const bytes = Buffer.from(await result.arrayBuffer());
    const text = isText(artifact.path) && bytes.length <= previewLimit ? bytes.toString('utf8') : null;
    return { artifactId: artifact.id, status: result.status, contentType: result.headers.get('content-type'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), text, error: null };
  } catch (caught) {
    return { artifactId: artifact.id, status: (caught as { status?: number }).status ?? 0, contentType: null, bytes: null, sha256: null, text: null, error: errorMessage(caught) };
  }
}

// POST /api/lab29/run — one task in a new hosted session: one or two turns, then list, identify and download the artifacts.
export async function runLab29(request: IncomingMessage, response: ServerResponse, agent: AgentConfig) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request, 80_000); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const task: Task = (['report', 'outside', 'revise', 'cancel'] as const).find((item) => item === body.task) ?? 'report';
  // The same dataset checks as Lab 27. The server builds the files itself from a checked dataset.
  const dataset = body.dataset === undefined ? makeDataset() : checkDataset(body.dataset);
  if (!dataset) return sendJson(response, 400, { error: 'The dataset must be a Lab 27 enrollments CSV this app can analyse.' });
  const prompts = promptsFor(task, dataset);
  const trace: Trace = {
    run: {
      task, prompts, model: agent.model, dataset: { id: dataset.id, csvPath: dataset.csvPath, csv: dataset.csv },
      sessionId: null, environmentId: null, turns: [], artifacts: [], listed: null, downloads: [],
      readyMs: null, durationMs: null, commands: [], commentary: [], answer: '', answers: [], error: null, errorKind: null, usage: null, deleted: [],
    },
    started: Date.now(), commands: new Map(), commentary: new Map(), seen: new Set(), finished: new Set(),
  };
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const api = client();
  const limit = setTimeout(() => response.destroy(), runLimitMs);
  try {
    writeEvent(response, { type: 'status', label: 'Creating an openai_hosted session with the dataset staged, network disabled' });
    const session = await api.beta.agents.sessions.create({ agent: { model: agent.model, instructions }, environment: buildEnvironment(dataset) });
    trace.run.sessionId = session.id;
    owned.add(session.id);
    if (session.environment.type === 'openai_hosted') trace.run.environmentId = session.environment.id;
    writeEvent(response, { type: 'session', sessionId: session.id, environmentId: trace.run.environmentId, ms: elapsed(trace) });
    writeEvent(response, { type: 'status', label: 'Waiting for agent.session.environment.ready' });

    for (const [index, prompt] of prompts.entries()) {
      const state = await runTurn(api, response, trace, session.id, prompt, index === 0);
      if (response.destroyed) return;
      const turn: TurnRef = { id: state.turnId ?? '', status: state.status, publishMs: null };
      trace.run.turns.push(turn);
      trace.run.answers.push(answerOf(state));
      writeEvent(response, { type: 'turn', turn, index: index + 1 });
      if (!state.turnId) break;
      // Publishing happens when the turn completes. Live it took 0.6 s; look up to three times before calling it empty.
      writeEvent(response, { type: 'status', label: 'Listing sessions.artifacts for this turn' });
      for (let attempt = 0; attempt < 3; attempt++) {
        trace.run.artifacts = await listArtifacts(api, session.id);
        const mine = forTurn(trace.run.artifacts, state.turnId);
        if (mine.length) { turn.publishMs = Date.now() - (state.endedAt ?? Date.now()); break; }
        if (state.status !== 'completed') break;
        await pause(1_500);
      }
      writeEvent(response, { type: 'artifacts', artifacts: trace.run.artifacts, turnId: state.turnId, publishMs: turn.publishMs });
      if (state.status !== 'completed' || trace.run.error) break;
    }

    // The live sandbox, for comparison: what exists, whether or not it was published.
    if (trace.run.environmentId) {
      try {
        const page = await api.beta.agents.environments.files.list(trace.run.environmentId, { path: '/workspace', order: 'asc', limit: 100 });
        trace.run.listed = page.data.map(parseFileRef);
      } catch (caught) {
        writeEvent(response, { type: 'status', label: `environments.files.list: ${errorMessage(caught)}` });
      }
      writeEvent(response, { type: 'listed', files: trace.run.listed ?? [] });
    }
    // Download every artifact once, to hash it and check its content against the data.
    for (const artifact of trace.run.artifacts.slice(0, maxDownloads)) {
      if (!checkDownload(artifact).ok) continue;
      trace.run.downloads.push(await download(api, session.id, artifact));
    }
    if (trace.run.downloads.length) writeEvent(response, { type: 'downloads', downloads: trace.run.downloads });
  } catch (caught) {
    if (response.destroyed) return;
    fail(trace, errorMessage(caught));
  } finally {
    clearTimeout(limit);
    trace.run.commands = [...trace.commands.values()];
    trace.run.commentary = [...trace.commentary.values()].filter(Boolean);
    trace.run.answer = trace.run.answers.at(-1) ?? '';
    trace.run.durationMs = elapsed(trace);
    writeEvent(response, { type: 'summary', run: trace.run });
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

function ownedIds(sessionId: unknown, artifactId: unknown): { sessionId: string; artifactId: string } | { status: number; error: string } {
  if (typeof sessionId !== 'string' || !sessionIdPattern.test(sessionId) || typeof artifactId !== 'string' || !artifactIdPattern.test(artifactId)) return { status: 400, error: 'Send a session ID (sess_…) and an artifact ID (artifact_…).' };
  if (!owned.has(sessionId)) return { status: 403, error: 'This server did not create that session in this process. Run the task again (recorded runs download from the page).' };
  return { sessionId, artifactId };
}

// GET /api/lab29/artifact?session=…&artifact=… — metadata first, then the immutable bytes, saved under a safe name.
export async function artifactLab29(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  const query = new URL(request.url ?? '', 'http://localhost').searchParams;
  const ids = ownedIds(query.get('session'), query.get('artifact'));
  if ('error' in ids) return sendJson(response, ids.status, { error: ids.error });
  const api = client();
  try {
    const artifact = parseArtifact(await api.beta.agents.sessions.artifacts.retrieve(ids.artifactId, { session_id: ids.sessionId }));
    const check = checkDownload(artifact);
    if (!check.ok) return sendJson(response, check.status, { error: check.reason });
    const result = await api.beta.agents.sessions.artifacts.content(ids.artifactId, { session_id: ids.sessionId });
    const bytes = Buffer.from(await result.arrayBuffer());
    // Live: the API sent application/octet-stream for Markdown and JSON alike. The type comes from the path, here.
    response.writeHead(200, {
      ...downloadHeaders(artifact.path, bytes.length),
      'X-Artifact-Id': artifact.id, 'X-Artifact-Turn': artifact.turnId, 'X-Artifact-Size': String(artifact.sizeBytes), 'X-Artifact-Sha256': createHash('sha256').update(bytes).digest('hex'),
    });
    response.end(bytes);
  } catch (caught) {
    const status = (caught as { status?: number }).status;
    sendJson(response, status === 404 ? 404 : 502, { error: errorMessage(caught) });
  }
}

// POST /api/lab29/delete — delete the published copy, then show it is gone and the sandbox file is not.
export async function deleteLab29(request: IncomingMessage, response: ServerResponse) {
  if (!configured()) return sendJson(response, 503, { error: 'Add OPENAI_API_KEY to .env, then restart the server.' });
  let body: Record<string, unknown>;
  try { body = await readBody(request, 2_000); } catch { return sendJson(response, 400, { error: 'Send a valid JSON request.' }); }
  const ids = ownedIds(body.sessionId, body.artifactId);
  if ('error' in ids) return sendJson(response, ids.status, { error: ids.error });
  const api = client();
  try {
    const artifact = parseArtifact(await api.beta.agents.sessions.artifacts.retrieve(ids.artifactId, { session_id: ids.sessionId }));
    await api.beta.agents.sessions.artifacts.delete(ids.artifactId, { session_id: ids.sessionId });
    let after = 'still retrievable';
    try { await api.beta.agents.sessions.artifacts.retrieve(ids.artifactId, { session_id: ids.sessionId }); } catch (caught) { after = errorMessage(caught); }
    let liveBytes: number | null = null;
    if (artifact.environmentId) {
      try {
        const page = await api.beta.agents.environments.files.list(artifact.environmentId, { path: artifact.path.slice(0, artifact.path.lastIndexOf('/')), limit: 100 });
        liveBytes = page.data.find((file) => file.path === artifact.path)?.size_bytes ?? null;
      } catch { /* the sandbox may have expired: that is the point of artifacts */ }
    }
    sendJson(response, 200, { artifactId: ids.artifactId, after, liveBytes });
  } catch (caught) {
    const status = (caught as { status?: number }).status;
    sendJson(response, status === 404 ? 404 : 502, { error: errorMessage(caught) });
  }
}

// POST /api/lab29/test — the same suite as the browser, on the server. No network, no API key.
export function testLab29(_request: IncomingMessage, response: ServerResponse) {
  try {
    const started = performance.now();
    const results = runArtifactSuite();
    sendJson(response, 200, { results, runtime: `Node ${process.version}`, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'The suite crashed.' });
  }
}
