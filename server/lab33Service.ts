import { buildRuleRequest, resolveRules, verifyReport, type RuleOptions, type RuleFile } from '../src/lab33Rules.ts';
export type RulesApi = {
  create(instructions: string, input: string, signal: AbortSignal): Promise<AsyncIterable<any> & { controller?: AbortController }>;
  cancel(id: string): Promise<void>;
  delete(id: string): Promise<void>;
};
export type RulesResult = { mode: 'guided' | 'unguided'; source: 'live Agents API'; sources: RuleFile[]; instructions: string; sessionId: string | null; outcome: string; answer: string; cleanup: string; error: string | null; checks: ReturnType<typeof verifyReport> };
function nextWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Comparison stopped.'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export async function runRuleArm(options: RuleOptions, guided: boolean, api: RulesApi, signal: AbortSignal): Promise<RulesResult> {
  const request = buildRuleRequest(options, guided);
  const result: RulesResult = { mode: guided ? 'guided' : 'unguided', source: 'live Agents API', sources: request.sources, instructions: request.instructions, sessionId: null, outcome: 'unknown', answer: '', cleanup: 'not created', error: null, checks: [] };
  let stream: Awaited<ReturnType<RulesApi['create']>> | undefined;
  const parts = new Map<string, string>(); const commentary = new Set<string>(); const seen = new Set<string>();
  try {
    if (signal.aborted) throw new Error('Stopped.');
    stream = await api.create(request.instructions, request.prompt, signal);
    const iterator = stream[Symbol.asyncIterator]();
    while (true) {
      const next = await nextWithAbort(iterator.next(), signal); if (next.done) break;
      const event = next.value;
      const id = event.type === 'agent.session.created' ? event.session?.id : event.session_id;
      if (!result.sessionId && typeof id === 'string' && /^sess_[a-zA-Z0-9_-]+$/.test(id)) { result.sessionId = id; result.cleanup = 'not started'; }
      if (event.event_id) { if (seen.has(event.event_id)) continue; seen.add(event.event_id); }
      if (seen.size > 5000) throw new Error('Event limit.');
      const item = event.item;
      if (item?.type === 'message' && item.phase === 'commentary') {
        commentary.add(item.id); for (const key of parts.keys()) if (key.startsWith(`${item.id}:`)) parts.delete(key);
      }
      if (/^agent\.session\.turn\.output_text\.(delta|done)$/.test(event.type) && !commentary.has(event.item_id)) {
        const key = `${event.item_id}:${event.content_index}`;
        parts.set(key, event.type.endsWith('.done') ? String(event.text ?? '') : (parts.get(key) ?? '') + String(event.delta ?? ''));
      }
      if (event.type === 'agent.session.turn.item.done' && item?.type === 'message' && item.role === 'assistant' && item.phase !== 'commentary') {
        for (const [index, part] of (item.content ?? []).entries()) if (typeof part.text === 'string') parts.set(`${item.id}:${index}`, part.text);
      }
      result.answer = [...parts.values()].join('\n');
      if (result.answer.length > 32_000) { result.answer = result.answer.slice(0, 32_000); throw new Error('Output limit.'); }
      if (/^agent\.session\.turn\.(completed|failed|cancelled)$/.test(event.type) && event.turn && event.turn.subagent_id == null) { result.outcome = event.type.split('.').at(-1); break; }
      if (['error', 'agent.session.failed'].includes(event.type)) throw new Error('Session failed.');
    }
    if (result.outcome !== 'completed') result.error = 'A completed root turn was not observed.';
  } catch { result.error = signal.aborted ? 'Comparison stopped or exceeded its two-minute deadline.' : 'API run failed. Check model access and server credentials.'; }
  finally {
    stream?.controller?.abort();
    if (result.sessionId) {
      if (result.outcome === 'unknown') { try { await api.cancel(result.sessionId); } catch { /* Outcome stays unknown. */ } }
      try { await api.delete(result.sessionId); result.cleanup = 'deleted'; } catch { result.cleanup = 'failed'; result.error ||= 'Session deletion was not confirmed.'; }
    }
  }
  result.checks = verifyReport(result.answer, resolveRules(options));
  return result;
}
