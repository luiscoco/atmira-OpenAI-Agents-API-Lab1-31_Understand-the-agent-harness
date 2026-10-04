import { randomBytes } from 'node:crypto';
import { applyExecutorEvent, environmentRequest, listingPrompt, newExecutorTrace, object, type ExecutorTrace } from '../src/lab32Environment.ts';
import type { ExecutorProvider } from './lab32Docker.ts';

export type ExecutorApi = {
  create(signal: AbortSignal): Promise<unknown>;
  stream(id: string, signal: AbortSignal): Promise<AsyncIterable<unknown> & { controller?: AbortController }>;
  input(id: string, prompt: string, signal: AbortSignal): Promise<void>;
  cancel(id: string): Promise<void>;
  delete(id: string): Promise<void>;
};
export type ExecutorJob = {
  id: string; status: 'running' | 'finished'; trace: ExecutorTrace;
  containerName: string; sessionCleanup: 'not created' | 'not started' | 'deleted' | 'failed';
};
export function createExecutorJob(id: string, lab: 32 | 34 = 32): ExecutorJob {
  return { id, status: 'running', trace: newExecutorTrace(randomBytes(8).toString('hex')),
    containerName: `agents-lab${lab}-${randomBytes(16).toString('hex')}`, sessionCleanup: 'not created' };
}
function aborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(new Error('Run stopped.'));
    if (signal.aborted) { reject(new Error('Run stopped.')); return; }
    signal.addEventListener('abort', stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}
export function publicExecutorJob(job: ExecutorJob, secrets: string[]): ExecutorJob {
  // Command output and final answers can expose the restricted key. Redact the full
  // accumulated text so a key split across text deltas is still removed.
  let json = JSON.stringify(job);
  for (const secret of secrets.filter(Boolean)) json = json.split(JSON.stringify(secret).slice(1, -1)).join('[redacted]');
  return JSON.parse(json);
}
export async function executeListing(job: ExecutorJob, api: ExecutorApi, provider: ExecutorProvider, controller: AbortController, limits = { runMs: 300_000, connectMs: 120_000 }, promptFor = listingPrompt) {
  const trace = job.trace; const started = Date.now(); const signal = controller.signal;
  let stream: (AsyncIterable<unknown> & { controller?: AbortController }) | undefined;
  let computeAttempted = false; let sent = false;
  const parts = new Map<string, string>(); const commentary = new Set<string>(); const seen = new Set<string>();
  const runTimer = setTimeout(() => controller.abort(), limits.runMs);
  let connectionTimer: ReturnType<typeof setTimeout> | undefined;
  const ms = () => Date.now() - started;
  try {
    await provider.preflight();
    if (signal.aborted) throw new Error('Run stopped.');
    const session = object(await api.create(signal));
    if (typeof session.id !== 'string' || !/^sess_[a-zA-Z0-9_-]+$/.test(session.id)) throw new Error('Invalid session response.');
    trace.sessionId = session.id; job.sessionCleanup = 'not started';
    const environment = object(session.environment);
    if (environment.type !== environmentRequest.type || typeof environment.id !== 'string' || typeof environment.remote_url !== 'string') throw new Error('Unexpected environment response.');
    trace.environmentId = environment.id;
    stream = await api.stream(session.id, signal);
    if (signal.aborted) throw new Error('Run stopped.');
    computeAttempted = true;
    // Known name is recorded before launch, even if Docker times out after creating it.
    await provider.start({ name: job.containerName, nonce: trace.nonce, environmentId: environment.id, remoteUrl: environment.remote_url });
    connectionTimer = setTimeout(() => controller.abort(), limits.connectMs);
    const iterator = stream[Symbol.asyncIterator]();
    while (true) {
      const next = await aborted(iterator.next(), signal);
      if (next.done) break;
      const event = object(next.value);
      if (typeof event.event_id === 'string') {
        if (seen.has(event.event_id)) continue;
        if (seen.size >= 10_000) throw new Error('Event limit reached.');
        seen.add(event.event_id);
      }
      applyExecutorEvent(trace, event, ms());
      if (event.type === 'agent.session.environment.connected' && !sent) {
        sent = true; clearTimeout(connectionTimer);
        trace.inputMs = ms();
        await api.input(session.id, promptFor(trace.nonce), signal);
        trace.inputSent = true;
      }
      const item = object(event.item);
      if (['agent.session.turn.item.added', 'agent.session.turn.item.done'].includes(String(event.type)) && item.type === 'message' && item.phase === 'commentary') {
        commentary.add(item.id);
        for (const key of parts.keys()) if (key.startsWith(`${item.id}:`)) parts.delete(key);
        trace.answer = [...parts.values()].join('\n');
      }
      if ((event.type === 'agent.session.turn.output_text.delta' || event.type === 'agent.session.turn.output_text.done') && !commentary.has(event.item_id) && event.subagent_id == null) {
        const key = `${event.item_id}:${event.content_index}`;
        parts.set(key, event.type.endsWith('.done') ? String(event.text ?? '') : (parts.get(key) ?? '') + String(event.delta ?? ''));
        trace.answer = [...parts.values()].join('\n');
        if (trace.answer.length > 64_000) throw new Error('Answer limit reached.');
      }
      if (event.type === 'agent.session.turn.item.done' && item.type === 'message' && item.role === 'assistant' && item.phase !== 'commentary' && event.subagent_id == null) {
        for (const [index, part] of (Array.isArray(item.content) ? item.content : []).entries()) {
          if (typeof part.text === 'string') parts.set(`${item.id}:${index}`, part.text);
        }
        trace.answer = [...parts.values()].join('\n');
        if (trace.answer.length > 64_000) throw new Error('Answer limit reached.');
      }
      if (trace.error || event.type === 'agent.session.environment.disconnected') throw new Error('Connection or session failed.');
      if (['completed', 'failed', 'cancelled'].includes(trace.outcome)) break;
    }
    if (trace.outcome === 'unknown') trace.error = 'The event stream closed before a root-turn outcome was observed. Input was not resubmitted.';
  } catch {
    trace.error ||= signal.aborted ? 'The run was stopped or exceeded its deadline. A remote turn outcome remains unknown unless observed below.' : 'Executor run failed. Check Docker, the image version, API access, and the restricted environment key.';
  } finally {
    clearTimeout(runTimer); clearTimeout(connectionTimer); stream?.controller?.abort();
    if (sent && trace.sessionId && !['completed', 'failed', 'cancelled'].includes(trace.outcome)) {
      try { await api.cancel(trace.sessionId); } catch { /* Preserve unknown; cleanup still proceeds. */ }
    }
    if (computeAttempted) {
      try { await provider.remove(job.containerName); trace.cleanup = 'removed'; }
      catch { trace.cleanup = 'failed'; trace.error ||= 'Container removal was not confirmed. Use Retry cleanup or remove the named container manually.'; }
    }
    if (trace.sessionId) {
      try { await api.delete(trace.sessionId); job.sessionCleanup = 'deleted'; }
      catch { job.sessionCleanup = 'failed'; trace.error ||= 'API session deletion was not confirmed. Use Retry cleanup.'; }
    }
    job.status = 'finished';
  }
}
export async function retryExecutorCleanup(job: ExecutorJob, api: ExecutorApi, provider: ExecutorProvider) {
  if (job.status !== 'finished') throw new Error('Wait for the run to settle before retrying cleanup.');
  const results = await Promise.allSettled([
    (async () => { if (job.trace.cleanup === 'failed') { await provider.remove(job.containerName); job.trace.cleanup = 'removed'; } })(),
    (async () => { if (job.sessionCleanup === 'failed' && job.trace.sessionId) { await api.delete(job.trace.sessionId); job.sessionCleanup = 'deleted'; } })(),
  ]);
  if (results.some(result => result.status === 'rejected')) throw new Error('Cleanup is still unconfirmed.');
}
