export const releaseSources = { A: 'Release A: Search now supports filtering by date. Existing queries continue to work.', B: 'Release B: The export endpoint now returns a download URL instead of file bytes. Update clients to fetch that URL.' };
export function delegationContract(lab: 39 | 40, failure = false) {
  return { task: lab === 39 ? 'Extract the customer-visible change and migration impact from release A.' : 'Compare release A and release B using one child per source.', permittedTools: 'Harness coordination only; no web, shell or function tools configured.', output: '{source: A|B, change: string, migration: string, status: complete|unavailable}', completion: 'Root verifies returned fields against the supplied source; no invented claims.', concurrency: lab === 39 ? 1 : 2, failurePolicy: 'At most one follow-up per failed/incomplete child; mark the source unavailable if still missing.', sources: { A: releaseSources.A, ...(lab === 40 ? { B: failure ? 'Release B: SOURCE UNAVAILABLE. Return status unavailable; do not invent release details.' : releaseSources.B } : {}) } };
}
export function delegationRequest(lab: 39 | 40, enabled: boolean, failure: boolean, model: string) {
  const contract = delegationContract(lab, failure);
  return { agent: { model, instructions: `Follow this delegation contract: ${JSON.stringify(contract)}. ${enabled ? 'Create the requested independent subagents, pass each its labelled source and contract, wait for results and verify them. Do not declare coordination tools yourself.' : 'Delegation is disabled. Do this in the root and do not claim child evidence.'} For Lab 40 launch both source tasks before waiting. An unavailable source is a data failure, not necessarily a failed API turn. Preserve each child's structured fields verbatim after verifying them. Return JSON {results:[{source,change,migration,status}],complete:boolean}.`, multi_agent: enabled ? { enabled: true, max_concurrent_subagents: contract.concurrency } : { enabled: false } }, environment: { type: 'none' as const }, input: JSON.stringify(contract.sources), stream: true as const };
}
export type DelegationTrace = { source: string; sessionId: string | null; root: string; turns: Record<string, { child: string | null; status: string; start?: number; end?: number }>; children: string[]; items: any[]; texts: Record<string, string>; events: string[]; seen: string[]; answer: string; cleanup: string; error: string | null };
export function newDelegationTrace(source = 'live Agents API'): DelegationTrace { return { source, sessionId: null, root: 'unknown', turns: {}, children: [], items: [], texts: {}, events: [], seen: [], answer: '', cleanup: 'not created', error: null }; }
export function applyDelegationEvent(trace: DelegationTrace, event: any, ms: number) {
  if (event.event_id) { if (trace.seen.includes(event.event_id)) return; trace.seen.push(event.event_id); }
  if (trace.seen.length > 5000 || trace.items.length > 1000 || JSON.stringify(trace.items).length > 256000 || JSON.stringify(trace.texts).length > 100000) throw new Error('Trace size limit.');
  const id = event.type === 'agent.session.created' ? event.session?.id : event.session_id;
  if (!trace.sessionId && typeof id === 'string' && /^sess_[\w-]+$/.test(id)) { trace.sessionId = id; trace.cleanup = 'not started'; }
  if (trace.events.length < 500 && !event.type?.endsWith('.delta')) trace.events.push(event.type);
  if (event.type === 'agent.session.subagent.created' && typeof event.subagent?.id === 'string' && !trace.children.includes(event.subagent.id)) trace.children.push(event.subagent.id);
  if (event.turn?.id) {
    const turn = event.turn; const previous = trace.turns[turn.id]; const status = event.type.split('.').at(-1);
    trace.turns[turn.id] = { child: turn.subagent_id ?? null, status, ...(previous?.start !== undefined ? { start: previous.start } : status === 'in_progress' ? { start: ms } : {}), ...(['completed', 'failed', 'cancelled'].includes(status) ? { end: ms } : {}) };
    if (turn.subagent_id == null && ['completed', 'failed', 'cancelled'].includes(status)) trace.root = status;
  }
  if (event.type === 'agent.session.turn.item.done' && event.item?.id) {
    const index = trace.items.findIndex(row => row.id === event.item.id); if (index >= 0) trace.items[index] = event.item; else trace.items.push(event.item);
  }
  if (event.type === 'agent.session.turn.output_text.done') trace.texts[`${event.turn_id}:${event.item_id}:${event.content_index}`] = String(event.text ?? '');
  // Attribute by the saved turn map: text events do not carry subagent_id.
  const rootMessages = trace.items.filter(item => item.type === 'message' && item.role === 'assistant' && item.phase !== 'commentary' && trace.turns[item.turn_id]?.child === null);
  trace.answer = rootMessages.length ? rootMessages.map(item => (item.content ?? []).map(part => part.text ?? '').join('')).join('\n') : Object.entries(trace.texts).filter(([key]) => trace.turns[key.split(':')[0]]?.child === null).map(([, value]) => value).join('\n');
}
export function childOverlap(trace: DelegationTrace) {
  const turns = Object.values(trace.turns).filter(turn => turn.child && turn.start !== undefined && turn.end !== undefined);
  return turns.some((a, index) => turns.slice(index + 1).some(b => a.child !== b.child && Math.max(a.start!, b.start!) < Math.min(a.end!, b.end!)));
}
export function verifyDelegation(trace: DelegationTrace, lab: 39 | 40, failure: boolean, enabled = true) {
  let report: any; try { report = JSON.parse(trace.answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { report = {}; }
  const results = Array.isArray(report.results) ? report.results : []; const a = results.find(row => row.source === 'A'); const b = results.find(row => row.source === 'B');
  const calls = trace.items.filter(row => row.type === 'create_subagent_call' && row.status === 'completed');
  const childDone = Object.values(trace.turns).filter(row => row.child && row.status === 'completed');
  const childFailed = Object.values(trace.turns).filter(row => row.child && row.status === 'failed');
  const followups = trace.items.filter(row => row.type === 'send_subagent_input_call');
  const childReports = trace.items.filter(row => row.type === 'message' && row.role === 'assistant' && row.phase !== 'commentary' && trace.turns[row.turn_id]?.child).flatMap(row => {
    try { const parsed = JSON.parse((row.content ?? []).map(part => part.text ?? '').join('')); return Array.isArray(parsed.results) ? parsed.results : [parsed]; } catch { return []; }
  });
  const expectedChildren = lab === 39 ? 1 : 2;
  return [
    { name: 'Root completed independently of child outcomes', passed: trace.root === 'completed' },
    { name: enabled ? 'Creation calls and child IDs observed' : 'Disabled comparison does not claim delegation', passed: enabled ? calls.length >= expectedChildren && trace.children.length >= expectedChildren : calls.length === 0 && trace.children.length === 0 },
    { name: 'Child terminal work observed', passed: !enabled || new Set([...childDone, ...(failure ? childFailed : [])].map(row => row.child)).size >= expectedChildren },
    { name: 'Root report agrees with returned child fields', passed: !enabled || results.length === expectedChildren && results.every(row => childReports.some(child => ['source', 'change', 'migration', 'status'].every(key => child[key] === row[key])) || failure && row.source === 'B' && row.status === 'unavailable' && childFailed.length > 0) },
    { name: 'At most one follow-up after initial child input', passed: followups.every(row => followups.filter(other => other.recipient_agent_id === row.recipient_agent_id).length <= 2) },
    { name: 'Release A change and migration are grounded', passed: a?.status === 'complete' && /date/i.test(a.change ?? '') && /existing|no.*migration|unchanged|continue/i.test(a.migration ?? '') },
    ...(lab === 40 ? [{ name: 'Independent child turn intervals overlap', passed: !enabled || childOverlap(trace) }, { name: failure ? 'Missing source marked explicitly incomplete' : 'Release B change and migration are grounded', passed: failure ? b?.status === 'unavailable' && report.complete === false && !b.change && !b.migration : b?.status === 'complete' && /url/i.test(b.change ?? '') && /fetch|download/i.test(b.migration ?? '') }] : []),
    { name: 'Exact source inventory and completeness', passed: results.length === expectedChildren && new Set(results.map(row => row.source)).size === expectedChildren && results.every(row => ['A', ...(lab === 40 ? ['B'] : [])].includes(row.source)) && report.complete === !failure },
    { name: 'API session deletion confirmed', passed: trace.cleanup === 'deleted' },
  ];
}
export function delegationPractice(lab: 39 | 40, kind: string) {
  const trace = newDelegationTrace('synthetic practice'); const count = lab === 39 ? 1 : 2; const failure = ['unavailable', 'child-failed'].includes(kind); let ms = 0;
  const emit = (event: any) => applyDelegationEvent(trace, { event_id: `ev_${++ms}`, ...event }, ms);
  emit({ type: 'agent.session.created', session: { id: 'sess_practice' } }); emit({ type: 'agent.session.turn.created', turn: { id: 'root', subagent_id: null } });
  if (kind !== 'claim' && kind !== 'disabled') for (let i = 0; i < count; i++) {
    emit({ type: 'agent.session.subagent.created', subagent: { id: `child${i}` } }); emit({ type: 'agent.session.turn.item.done', item: { id: `spawn${i}`, type: 'create_subagent_call', status: 'completed', agent_id: 'root', turn_id: 'root' } }); emit({ type: 'agent.session.turn.created', turn: { id: `turn${i}`, subagent_id: `child${i}` } }); emit({ type: 'agent.session.turn.in_progress', turn: { id: `turn${i}`, subagent_id: `child${i}` } });
    if (kind === 'sequential') emit({ type: 'agent.session.turn.completed', turn: { id: `turn${i}`, subagent_id: `child${i}` } });
  }
  if (kind !== 'claim' && kind !== 'disabled' && kind !== 'sequential') for (let i = 0; i < count; i++) emit({ type: kind === 'child-failed' && i === 1 ? 'agent.session.turn.failed' : 'agent.session.turn.completed', turn: { id: `turn${i}`, subagent_id: `child${i}` } });
  const results = [{ source: 'A', change: 'Search filters by date', migration: 'Existing queries continue unchanged', status: 'complete' }, ...(lab === 40 ? [{ source: 'B', change: failure ? '' : 'Export returns a download URL', migration: failure ? '' : 'Fetch the URL', status: failure ? 'unavailable' : 'complete' }] : [])];
  if (kind !== 'claim' && kind !== 'disabled') results.forEach((result, index) => { if (kind !== 'child-failed' || index !== 1) emit({ type: 'agent.session.turn.item.done', item: { id: `childMessage${index}`, type: 'message', role: 'assistant', phase: 'final_answer', turn_id: `turn${index}`, content: [{ text: JSON.stringify(result) }] } }); });
  emit({ type: 'agent.session.turn.item.done', item: { id: 'answer', type: 'message', role: 'assistant', phase: 'final_answer', turn_id: 'root', content: [{ text: JSON.stringify({ results, complete: !failure }) }] } }); emit({ type: 'agent.session.turn.completed', turn: { id: 'root', subagent_id: null } }); trace.cleanup = 'deleted'; return trace;
}
