import { createExecutorJob, type ExecutorApi, type ExecutorJob } from './lab32Service.ts';
import type { ExecutorProvider, ExecutorSpec } from './lab32Docker.ts';
import { applyExecutorEvent, listingPrompt, object } from '../src/lab32Environment.ts';
import { recoveryDecision, type RecoveryState } from '../src/lab37Recovery.ts';
import { boundedNext } from './courseLabHttp.ts';
export type RecoveryApi = ExecutorApi & { inspect(id: string, signal: AbortSignal): Promise<{ session: any; environment: any; turns: any[]; items: any[] }> };
export type RecoveryJob = ExecutorJob & { recovery: RecoveryState; fault: 'none' | 'stream' };
export function createRecoveryJob(id: string, fault: RecoveryJob['fault']): RecoveryJob {
  return { ...createExecutorJob(id, 37), fault, recovery: { source: 'live Agents API', sessionId: null, environmentId: null, inputAttempts: 0, reconnects: 0, outcome: 'unknown', phase: 'starting', log: [], cleanup: 'not started', answer: '', error: null } };
}
export async function executeRecovery(job: RecoveryJob, api: RecoveryApi, provider: ExecutorProvider, controller: AbortController, limitMs = 300000) {
  const state = job.recovery; const signal = controller.signal; const started = Date.now(); const timer = setTimeout(() => controller.abort(), limitMs);
  let spec: ExecutorSpec; let compute = false; let stream: any; let sent = false; let faultInjected = false; const seen = new Set<string>(); const parts = new Map<string, string>(); const commentary = new Set<string>();
  const collect = (event: any) => {
    if (event.event_id) { if (seen.has(event.event_id)) return; seen.add(event.event_id); if (seen.size > 5000) throw new Error('Event limit'); }
    applyExecutorEvent(job.trace, event, Date.now() - started);
    if (event.item?.type === 'message' && event.item.phase === 'commentary') { commentary.add(event.item.id); for (const key of parts.keys()) if (key.startsWith(`${event.item.id}:`)) parts.delete(key); }
    if (event.type === 'agent.session.turn.output_text.done' && !commentary.has(event.item_id)) parts.set(`${event.item_id}:${event.content_index}`, String(event.text ?? ''));
    if (event.type === 'agent.session.turn.item.done' && event.item?.type === 'message' && event.item.role === 'assistant' && event.item.phase !== 'commentary') for (const [index, part] of (event.item.content ?? []).entries()) if (typeof part.text === 'string') parts.set(`${event.item.id}:${index}`, part.text);
    job.trace.answer = [...parts.values()].join('\n'); if (job.trace.answer.length > 64000) throw new Error('Answer limit');
  };
  try {
    await provider.preflight(); const session = object(await api.create(signal)); const env = object(session.environment);
    if (!/^sess_[\w-]+$/.test(session.id) || env.type !== 'self_hosted') throw new Error('Invalid session');
    job.trace.sessionId = state.sessionId = session.id; job.trace.environmentId = state.environmentId = env.id; job.sessionCleanup = 'not started';
    spec = { name: job.containerName, nonce: job.trace.nonce, environmentId: env.id, remoteUrl: env.remote_url };
    stream = await api.stream(session.id, signal); compute = true; await provider.start(spec); state.phase = 'waiting for connection';
    while (!signal.aborted) {
      let loss = false;
      try {
        const iterator = stream[Symbol.asyncIterator]();
        while (true) {
          const next = await boundedNext<IteratorResult<any>>(iterator.next(), signal); if (next.done) { loss = true; break; }
          const event = object(next.value); collect(event);
          if (event.type === 'agent.session.environment.connected' && !sent) {
            sent = true; state.inputAttempts++; job.trace.inputMs = Date.now() - started;
            await api.input(session.id, listingPrompt(job.trace.nonce), signal); job.trace.inputSent = true; state.phase = 'running';
            if (job.fault === 'stream' && !faultInjected) { faultInjected = true; state.log.push('Injected observation loss: closed local subscription only; executor remains running'); loss = true; break; }
          }
          if (['completed', 'failed', 'cancelled'].includes(job.trace.outcome)) break;
          if (event.type === 'agent.session.environment.disconnected' || event.type === 'agent.session.environment.failed') { loss = true; break; }
        }
      } catch (error) { if (signal.aborted) throw error; loss = true; }
      stream?.controller?.abort();
      const saved = await api.inspect(session.id, signal);
      if (saved.session.id !== session.id || saved.session.environment?.id !== spec.environmentId || saved.environment.id !== spec.environmentId) throw new Error('Recovery mapping mismatch');
      // Saved items/turns recover output missed by the live subscription. This task has no subagents.
      for (const item of saved.items) collect({ type: 'agent.session.turn.item.done', item });
      const root = [...saved.turns].reverse().find(turn => turn.subagent_id == null);
      if (root && ['completed', 'failed', 'cancelled'].includes(root.status)) job.trace.outcome = root.status;
      state.log.push(`Inspect saved state: ${saved.environment.status}, root ${job.trace.outcome}`);
      const decision = recoveryDecision(saved.environment.status, job.trace.outcome, state.reconnects); state.phase = decision; state.log.push(decision);
      if (decision === 'inspect-result') break;
      if (!['reconnect-environment', 'reattach-stream'].includes(decision)) throw new Error('Recovery budget or environment state prevents safe continuation');
      state.reconnects++;
      stream = await api.stream(session.id, signal);
      if (decision === 'reconnect-environment') {
        await provider.remove(job.containerName);
        // Rebuild only the deterministic input workspace; session and input are retained.
        await provider.start(spec); state.log.push('Reconnected executor with the same environment ID; volatile workspace rebuilt');
      }
      job.trace.error = null;
    }
  } catch (error) { state.error = signal.aborted ? 'Stopped or deadline exceeded; unseen remote outcome remains unknown.' : String((error as Error).message); }
  finally {
    clearTimeout(timer); stream?.controller?.abort();
    if (sent && state.sessionId && !['completed', 'failed', 'cancelled'].includes(job.trace.outcome)) { try { await api.cancel(state.sessionId); } catch { /* Do not manufacture cancellation. */ } }
    const cleanup = await Promise.allSettled([
      (async () => { if (compute) { try { await provider.remove(job.containerName); job.trace.cleanup = 'removed'; } catch { job.trace.cleanup = 'failed'; throw new Error('Container cleanup failed'); } } })(),
      (async () => { if (state.sessionId) { try { await api.delete(state.sessionId); job.sessionCleanup = 'deleted'; } catch { job.sessionCleanup = 'failed'; throw new Error('Session cleanup failed'); } } })(),
    ]);
    state.cleanup = cleanup.every(row => row.status === 'fulfilled') ? 'confirmed' : 'failed'; state.outcome = job.trace.outcome; state.answer = job.trace.answer; state.phase = 'settled'; job.status = 'finished';
  }
}
