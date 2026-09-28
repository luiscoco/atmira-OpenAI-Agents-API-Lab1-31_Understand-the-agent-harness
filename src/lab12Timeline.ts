// Lab 12: group a session's events by turn and keep their arrival order.
// Pure functions only, so the live run and the step-through replayer share them.

export type Category = 'session' | 'environment' | 'subagent' | 'turn' | 'item' | 'text' | 'reasoning' | 'error';

// The metadata the server forwards for every event. It carries no prompt or answer text.
export type TimelineEvent = {
  eventId: string;
  type: string;
  at: number; // milliseconds since the epoch, when the server received the event
  turnId: string | null;
  itemId: string | null;
  itemType: string | null;
  status: string | null;
  subagentId: string | null;
  detail: string | null;
};

export type Row = {
  seq: number; // 1-based arrival order after replays are removed
  offsetMs: number; // time since the first event on this timeline
  event: TimelineEvent;
  category: Category;
  turnId: string | null;
  inferred: boolean; // the turn came from the item, not from the event itself
};

export type RowGroup = { kind: 'single'; row: Row } | { kind: 'deltas'; rows: Row[] };

export type TurnGroup = {
  turnId: string;
  label: string;
  subagentId: string | null;
  status: string;
  sawCreated: boolean;
  rows: Row[];
  itemIds: string[];
  firstSeq: number;
  lastSeq: number;
  durationMs: number;
};

export type Timeline = {
  rows: Row[];
  sessionRows: Row[];
  turns: TurnGroup[];
  duplicates: number;
  warnings: string[];
  rootOutcome: string;
};

export const terminalStatuses = ['completed', 'failed', 'cancelled'];

export function categoryOf(type: string): Category {
  if (type === 'error') return 'error';
  if (type.startsWith('agent.session.environment.')) return 'environment';
  if (type.startsWith('agent.session.subagent.')) return 'subagent';
  if (type.includes('.reasoning_summary')) return 'reasoning';
  if (type.includes('.output_text.') || type.includes('.content_part.')) return 'text';
  if (type.startsWith('agent.session.turn.item.')) return 'item';
  if (type.startsWith('agent.session.turn.')) return 'turn';
  return 'session';
}

export const shortType = (type: string): string => type.replace(/^agent\.session\./, '');
export const shortId = (id: string): string => (id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-5)}` : id);

// A turn event's own status wins; otherwise the event name says what happened.
function turnStatus(event: TimelineEvent): string {
  return event.status ?? event.type.split('.').pop() ?? 'unknown';
}

export function buildTimeline(events: TimelineEvent[]): Timeline {
  const seen = new Set<string>();
  const itemTurns = new Map<string, string>();
  const turns = new Map<string, TurnGroup>();
  const rows: Row[] = [];
  const sessionRows: Row[] = [];
  const warnings: string[] = [];
  let duplicates = 0;
  const start = events[0]?.at ?? 0;

  for (const event of events) {
    // A reconnect can deliver an event again. Its event ID has already been placed.
    if (seen.has(event.eventId)) { duplicates += 1; continue; }
    seen.add(event.eventId);

    // Text events may omit turn_id; fall back to the turn in which their item started.
    const fromItem = event.itemId ? itemTurns.get(event.itemId) ?? null : null;
    const turnId = event.turnId ?? fromItem;
    if (turnId && event.itemId && !itemTurns.has(event.itemId)) itemTurns.set(event.itemId, turnId);
    const row: Row = { seq: rows.length + 1, offsetMs: Math.max(0, event.at - start), event, category: categoryOf(event.type), turnId, inferred: !event.turnId && !!fromItem };
    rows.push(row);
    if (!turnId) { sessionRows.push(row); continue; }

    let turn = turns.get(turnId);
    if (!turn) {
      turn = { turnId, label: '', subagentId: null, status: 'unknown', sawCreated: false, rows: [], itemIds: [], firstSeq: row.seq, lastSeq: row.seq, durationMs: 0 };
      turns.set(turnId, turn);
      if (event.type !== 'agent.session.turn.created') warnings.push(`#${row.seq}: turn ${shortId(turnId)} first appeared in ${shortType(event.type)}. Its created event was not observed.`);
    }
    if (terminalStatuses.includes(turn.status) && row.category !== 'turn') warnings.push(`#${row.seq}: ${shortType(event.type)} arrived after turn ${shortId(turnId)} was ${turn.status}.`);
    if (row.category === 'turn') {
      turn.status = turnStatus(event);
      if (event.subagentId) turn.subagentId = event.subagentId;
      if (event.type === 'agent.session.turn.created') turn.sawCreated = true;
    }
    if (event.itemId && !turn.itemIds.includes(event.itemId)) turn.itemIds.push(event.itemId);
    turn.rows.push(row);
    turn.lastSeq = row.seq;
    turn.durationMs = row.offsetMs - turn.rows[0].offsetMs;
  }

  let rootCount = 0;
  let subagentCount = 0;
  const grouped = [...turns.values()].map((turn) => ({ ...turn, label: turn.subagentId ? `Subagent turn ${++subagentCount}` : `Turn ${++rootCount}` }));
  const lastRoot = grouped.filter((turn) => !turn.subagentId).at(-1);
  return { rows, sessionRows, turns: grouped, duplicates, warnings, rootOutcome: lastRoot?.status ?? 'not started' };
}

// Consecutive deltas for the same item become one row, so the order stays readable.
export function collapseDeltas(rows: Row[]): RowGroup[] {
  const groups: RowGroup[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    const isDelta = row.event.type.endsWith('.delta');
    if (isDelta && last?.kind === 'deltas' && last.rows[0].event.type === row.event.type && last.rows[0].event.itemId === row.event.itemId) last.rows.push(row);
    else groups.push(isDelta ? { kind: 'deltas', rows: [row] } : { kind: 'single', row });
  }
  return groups;
}

const optionalString = (value: unknown): value is string | null => value === null || typeof value === 'string';

// Runtime boundary: the browser checks each forwarded event before it is placed.
export function parseTimelineEvent(value: unknown): TimelineEvent {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid timeline event.');
  const event = value as Record<string, unknown>;
  if (typeof event.eventId !== 'string' || typeof event.type !== 'string' || typeof event.at !== 'number' || !Number.isFinite(event.at)) throw new Error('Invalid timeline event.');
  const { turnId, itemId, itemType, status, subagentId, detail } = event;
  if (!optionalString(turnId) || !optionalString(itemId) || !optionalString(itemType) || !optionalString(status) || !optionalString(subagentId) || !optionalString(detail)) throw new Error('Invalid timeline event.');
  return { eventId: event.eventId, type: event.type, at: event.at, turnId, itemId, itemType, status, subagentId, detail };
}
