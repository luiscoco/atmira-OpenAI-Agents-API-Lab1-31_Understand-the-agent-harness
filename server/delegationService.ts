import { applyDelegationEvent, delegationRequest, newDelegationTrace, type DelegationTrace } from '../src/lab39Delegation.ts';
import { boundedNext } from './courseLabHttp.ts';
export type DelegationApi = { create(request: ReturnType<typeof delegationRequest>, signal: AbortSignal): Promise<AsyncIterable<any> & { controller?: AbortController }>; inspect(id: string, signal: AbortSignal): Promise<{ turns: any[]; items: any[]; children: any[] }>; cancel(id: string): Promise<void>; delete(id: string): Promise<void> };
export type DelegationJob = { id: string; lab: 39 | 40; status: 'running' | 'finished'; enabled: boolean; failure: boolean; trace: DelegationTrace };
export async function executeDelegation(job: DelegationJob, api: DelegationApi, model: string, controller: AbortController, deadlineMs = 180000) {
  const trace = job.trace; const started = Date.now(); const timer = setTimeout(() => controller.abort(), deadlineMs); let stream: any;
  try {
    stream = await api.create(delegationRequest(job.lab, job.enabled, job.failure, model), controller.signal); const iterator = stream[Symbol.asyncIterator]();
    while (true) {
      const next = await boundedNext<IteratorResult<any>>(iterator.next(), controller.signal); if (next.done) break; const event = next.value; applyDelegationEvent(trace, event, Date.now() - started);
      if (['completed', 'failed', 'cancelled'].includes(trace.root)) break;
      if (['error', 'agent.session.failed'].includes(event.type)) throw new Error('Session failed');
    }
    stream?.controller?.abort();
    if (trace.sessionId && !controller.signal.aborted) {
      const saved = await api.inspect(trace.sessionId, controller.signal);
      // Merge saved attribution and output; do not manufacture overlap from inventory order.
      for (const child of saved.children) if (typeof child.id === 'string' && !trace.children.includes(child.id)) trace.children.push(child.id);
      for (const turn of saved.turns) {
        const prior = trace.turns[turn.id]; trace.turns[turn.id] = { ...prior, child: turn.subagent_id ?? null, status: turn.status };
        if (turn.subagent_id == null && ['completed', 'failed', 'cancelled'].includes(turn.status)) trace.root = turn.status;
      }
      for (const item of saved.items) applyDelegationEvent(trace, { type: 'agent.session.turn.item.done', item }, Date.now() - started);
    }
    if (trace.root !== 'completed') trace.error = 'A completed root outcome was not established; inspect the retained evidence.';
  } catch { trace.error = controller.signal.aborted ? 'Stopped or deadline exceeded. Unseen remote outcomes remain unknown.' : 'Delegation run or saved-state inspection failed. Available evidence is retained.'; }
  finally {
    clearTimeout(timer); stream?.controller?.abort();
    if (trace.sessionId) {
      if (!['completed', 'failed', 'cancelled'].includes(trace.root)) { try { await api.cancel(trace.sessionId); } catch { /* Preserve unknown. */ } }
      try { await api.delete(trace.sessionId); trace.cleanup = 'deleted'; } catch { trace.cleanup = 'failed'; trace.error ||= 'Session deletion was not confirmed.'; }
    }
    job.status = 'finished';
  }
}
export function createDelegationJob(id: string, lab: 39 | 40, enabled: boolean, failure: boolean): DelegationJob { return { id, lab, enabled, failure, status: 'running', trace: newDelegationTrace() }; }
