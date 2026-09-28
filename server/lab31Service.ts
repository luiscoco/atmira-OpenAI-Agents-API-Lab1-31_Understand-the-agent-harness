import { object, projectItem, validSessionId, type HarnessTrace, type TraceStep, type EnvironmentKind } from '../src/lab31Harness.ts';
export type Page = { data: unknown[]; has_more: boolean };
export type InspectionApi = {
  retrieve: (id: string) => Promise<unknown>;
  turns: (id: string, after?: string) => Promise<Page>;
  items: (id: string, after?: string) => Promise<Page>;
};
export async function readPages(fetchPage: (after?: string) => Promise<Page>, maxPages = 5): Promise<{ data: unknown[]; complete: boolean }> {
  const data: unknown[] = []; const cursors = new Set<string>(); const seen = new Set<string>(); let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(after);
    if (!Array.isArray(result.data) || typeof result.has_more !== 'boolean') throw new Error('Invalid API inventory page.');
    if (result.data.length > 100) throw new Error('API inventory page exceeds the requested size.');
    for (const value of result.data) {
      const id = object(value).id;
      if (typeof id !== 'string') throw new Error('API inventory entry has no ID.');
      if (!seen.has(id)) { seen.add(id); data.push(value); }
    }
    if (!result.has_more) return { data, complete: true };
    const last = result.data.at(-1); const id = last ? object(last).id : null;
    if (typeof id !== 'string' || cursors.has(id)) return { data, complete: false };
    cursors.add(id); after = id;
  }
  return { data, complete: false };
}
export async function inspectHarness(api: InspectionApi, id: string): Promise<HarnessTrace> {
  if (!validSessionId(id)) throw new Error('Invalid session ID.');
  const session = object(await api.retrieve(id));
  if (session.id !== id) throw new Error('The API returned a different session.');
  const environment = object(session.environment);
  if (!['none', 'openai_hosted', 'self_hosted'].includes(String(environment.type))) throw new Error('Unsupported environment type.');
  const [turns, items] = await Promise.all([readPages(after => api.turns(id, after)), readPages(after => api.items(id, after))]);
  // Reserve the two snapshot rows and all turn outcomes within the import/view limit.
  const visibleItems = items.data.slice(0, 998 - turns.data.length);
  const rootByTurn = new Map(turns.data.map(value => { const turn = object(value); return [turn.id, turn.subagent_id == null] as const; }));
  const steps: TraceStep[] = [
    { id: 'snapshot:session', kind: 'session', label: 'Current session state', detail: 'Retrieved session state; not an event timestamp.', status: typeof session.status === 'string' ? session.status : null, root: true, turnId: null, callId: null },
    { id: 'snapshot:environment', kind: 'environment', label: `Environment: ${environment.type}`, detail: 'Session environment selection. This read does not prove a sandbox command ran.', status: typeof environment.status === 'string' ? environment.status : null, root: true, turnId: null, callId: null },
    ...visibleItems.map(value => { const row = projectItem(value); return { ...row, root: row.turnId ? rootByTurn.get(row.turnId) ?? false : row.root }; }),
    ...turns.data.map(value => {
      const turn = object(value);
      if (typeof turn.id !== 'string') throw new Error('Saved turn has no ID.');
      return { id: `snapshot:${turn.id}`, kind: 'turn' as const, label: `${turn.subagent_id == null ? 'Root' : 'Child'} turn: ${String(turn.status)}`, detail: 'Saved turn outcome; listed in ascending API order after item evidence, not reconstructed stream timing.', status: typeof turn.status === 'string' ? turn.status : null, root: turn.subagent_id == null, turnId: turn.id, callId: null };
    }),
  ];
  return { version: 1, source: 'live saved state', title: 'Saved session ownership', sessionId: id, environment: environment.type as EnvironmentKind, complete: turns.complete && items.complete && visibleItems.length === items.data.length, warning: 'Read-only saved-state projection. Ownership annotations apply documented architecture; internal model invocations and exact stream order are not visible.', steps };
}
