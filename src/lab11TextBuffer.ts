// Lab 11: a pure reducer that turns text events into the displayed answer.
// It has no React or network code, so the browser and the replay tool share it.

export type Phase = 'commentary' | 'final_answer' | null;
type ItemRef = { eventId: string; itemId: string; outputIndex: number };
type PartRef = ItemRef & { contentIndex: number };

export type TextEvent =
  | (ItemRef & { type: 'item.added'; phase: Phase })
  | (PartRef & { type: 'part.added'; text: string })
  | (PartRef & { type: 'text.delta'; delta: string })
  | (PartRef & { type: 'text.done'; text: string })
  | (PartRef & { type: 'part.done'; text: string })
  | (ItemRef & { type: 'item.done'; phase: Phase; parts: string[] });

export type PartState = {
  key: string;
  itemId: string;
  outputIndex: number;
  contentIndex: number;
  text: string;
  status: 'streaming' | 'done';
  deltas: number;
  replaced: boolean;
};

export type TextBuffer = {
  parts: Record<string, PartState>;
  phases: Record<string, Phase>;
  seenEventIds: string[];
  duplicates: number;
  lateDeltas: number;
  naive: string;
};

export const emptyBuffer = (): TextBuffer => ({ parts: {}, phases: {}, seenEventIds: [], duplicates: 0, lateDeltas: 0, naive: '' });

export const partKey = (itemId: string, contentIndex: number): string => `${itemId}:${contentIndex}`;

function currentPart(buffer: TextBuffer, event: PartRef): PartState {
  const key = partKey(event.itemId, event.contentIndex);
  return buffer.parts[key] ?? { key, itemId: event.itemId, outputIndex: event.outputIndex, contentIndex: event.contentIndex, text: '', status: 'streaming', deltas: 0, replaced: false };
}

// A completed part is authoritative: it replaces whatever the deltas built.
function finalizePart(part: PartState, text: string): PartState {
  return { ...part, text, status: 'done', replaced: part.replaced || part.text !== text };
}

// The naive strategy is the common bug: append every delta and every done text,
// in arrival order, without checking for replayed events.
function naiveAppend(naive: string, event: TextEvent): string {
  if (event.type === 'text.delta') return naive + event.delta;
  if (event.type === 'text.done') return naive + event.text;
  return naive;
}

export function applyTextEvent(buffer: TextBuffer, event: TextEvent): TextBuffer {
  const naive = naiveAppend(buffer.naive, event);
  if (buffer.seenEventIds.includes(event.eventId)) return { ...buffer, naive, duplicates: buffer.duplicates + 1 };
  const next: TextBuffer = { ...buffer, naive, seenEventIds: [...buffer.seenEventIds, event.eventId] };

  if (event.type === 'item.added') return { ...next, phases: { ...next.phases, [event.itemId]: event.phase } };
  if (event.type === 'item.done') {
    const parts = { ...next.parts };
    event.parts.forEach((text, contentIndex) => {
      const part = currentPart(next, { ...event, contentIndex });
      parts[part.key] = finalizePart(part, text);
    });
    return { ...next, parts, phases: { ...next.phases, [event.itemId]: event.phase } };
  }

  const part = currentPart(next, event);
  if (event.type === 'text.delta') {
    if (part.status === 'done') return { ...next, lateDeltas: next.lateDeltas + 1 };
    return { ...next, parts: { ...next.parts, [part.key]: { ...part, text: part.text + event.delta, deltas: part.deltas + 1 } } };
  }
  if (event.type === 'part.added') return { ...next, parts: { ...next.parts, [part.key]: part.deltas ? part : { ...part, text: event.text } } };
  return { ...next, parts: { ...next.parts, [part.key]: finalizePart(part, event.text) } };
}

export function orderedParts(buffer: TextBuffer): PartState[] {
  return Object.values(buffer.parts).sort((a, b) => a.outputIndex - b.outputIndex || a.contentIndex - b.contentIndex);
}

// Parts of one message join directly; separate messages become paragraphs.
export function renderText(buffer: TextBuffer, show: 'answer' | 'commentary'): string {
  const messages = new Map<string, string>();
  for (const part of orderedParts(buffer)) {
    const isCommentary = buffer.phases[part.itemId] === 'commentary';
    if (isCommentary !== (show === 'commentary')) continue;
    messages.set(part.itemId, (messages.get(part.itemId) ?? '') + part.text);
  }
  return [...messages.values()].filter(Boolean).join('\n\n');
}

const isPhase = (value: unknown): value is Phase => value === null || value === 'commentary' || value === 'final_answer';
const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

// Runtime boundary: the browser checks each forwarded event before reducing it.
export function parseTextEvent(value: unknown): TextEvent {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid text event.');
  const event = value as Record<string, unknown>;
  if (typeof event.eventId !== 'string' || typeof event.itemId !== 'string' || !isIndex(event.outputIndex)) throw new Error('Invalid text event.');
  const item = { eventId: event.eventId, itemId: event.itemId, outputIndex: event.outputIndex };
  if (event.type === 'item.added' && isPhase(event.phase)) return { ...item, type: 'item.added', phase: event.phase };
  if (event.type === 'item.done' && isPhase(event.phase) && Array.isArray(event.parts) && event.parts.every((part) => typeof part === 'string')) {
    return { ...item, type: 'item.done', phase: event.phase, parts: event.parts as string[] };
  }
  if (!isIndex(event.contentIndex)) throw new Error('Invalid text event.');
  const part = { ...item, contentIndex: event.contentIndex };
  if (event.type === 'text.delta' && typeof event.delta === 'string') return { ...part, type: 'text.delta', delta: event.delta };
  if ((event.type === 'part.added' || event.type === 'text.done' || event.type === 'part.done') && typeof event.text === 'string') return { ...part, type: event.type, text: event.text };
  throw new Error('Invalid text event.');
}
