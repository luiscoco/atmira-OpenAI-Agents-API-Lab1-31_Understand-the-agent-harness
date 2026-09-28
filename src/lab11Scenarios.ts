import type { Phase, TextEvent } from './lab11TextBuffer.ts';

// Scripted teaching sequences in the same shape the Lab 11 server forwards.
// They are not recordings of a real run; each isolates one rendering rule.
export type Scenario = { id: string; title: string; summary: string; events: TextEvent[] };

function script(prefix: string) {
  let count = 0;
  const id = () => `${prefix}_${String(++count).padStart(2, '0')}`;
  return {
    itemAdded: (itemId: string, outputIndex: number, phase: Phase): TextEvent => ({ type: 'item.added', eventId: id(), itemId, outputIndex, phase }),
    partAdded: (itemId: string, outputIndex: number, contentIndex: number): TextEvent => ({ type: 'part.added', eventId: id(), itemId, outputIndex, contentIndex, text: '' }),
    delta: (itemId: string, outputIndex: number, contentIndex: number, delta: string): TextEvent => ({ type: 'text.delta', eventId: id(), itemId, outputIndex, contentIndex, delta }),
    textDone: (itemId: string, outputIndex: number, contentIndex: number, text: string): TextEvent => ({ type: 'text.done', eventId: id(), itemId, outputIndex, contentIndex, text }),
    partDone: (itemId: string, outputIndex: number, contentIndex: number, text: string): TextEvent => ({ type: 'part.done', eventId: id(), itemId, outputIndex, contentIndex, text }),
    itemDone: (itemId: string, outputIndex: number, phase: Phase, parts: string[]): TextEvent => ({ type: 'item.done', eventId: id(), itemId, outputIndex, phase, parts }),
  };
}

function twoParts(): TextEvent[] {
  const s = script('evt_parts');
  const first = 'A closure is a function that remembers the variables around it. ';
  const second = 'For example, `makeCounter()` returns a function that keeps its own count.';
  return [
    s.itemAdded('msg_answer', 0, 'final_answer'),
    s.partAdded('msg_answer', 0, 0),
    s.delta('msg_answer', 0, 0, 'A closure is a function '),
    s.partAdded('msg_answer', 0, 1),
    s.delta('msg_answer', 0, 1, 'For example, `makeCounter()` '),
    s.delta('msg_answer', 0, 0, 'that remembers the variables around it. '),
    s.delta('msg_answer', 0, 1, 'returns a function that keeps its own count.'),
    s.textDone('msg_answer', 0, 0, first),
    s.partDone('msg_answer', 0, 0, first),
    s.textDone('msg_answer', 0, 1, second),
    s.partDone('msg_answer', 0, 1, second),
    s.itemDone('msg_answer', 0, 'final_answer', [first, second]),
  ];
}

function phases(): TextEvent[] {
  const s = script('evt_phase');
  const note = 'Checking the difference between let and const first.';
  const answer = 'Use `const` when a binding is never reassigned, and `let` when it is.';
  return [
    s.itemAdded('msg_note', 0, 'commentary'),
    s.partAdded('msg_note', 0, 0),
    s.delta('msg_note', 0, 0, 'Checking the difference '),
    s.delta('msg_note', 0, 0, 'between let and const first.'),
    s.textDone('msg_note', 0, 0, note),
    s.itemDone('msg_note', 0, 'commentary', [note]),
    s.itemAdded('msg_final', 1, 'final_answer'),
    s.partAdded('msg_final', 1, 0),
    s.delta('msg_final', 1, 0, 'Use `const` when a binding '),
    s.delta('msg_final', 1, 0, 'is never reassigned, and `let` when it is.'),
    s.textDone('msg_final', 1, 0, answer),
    s.itemDone('msg_final', 1, 'final_answer', [answer]),
  ];
}

function recovery(): TextEvent[] {
  const s = script('evt_fix');
  const answer = 'An async function always returns a Promise, even when it returns a plain value.';
  const events = [
    s.itemAdded('msg_answer', 0, 'final_answer'),
    s.partAdded('msg_answer', 0, 0),
    s.delta('msg_answer', 0, 0, 'An async function always '),
    s.delta('msg_answer', 0, 0, 'returns a Promise, '),
  ];
  // The same event arrives twice, as it can after a reconnect replays recent events.
  events.push({ ...events[events.length - 1] });
  // The delta ' even when it' is missing, so the streamed buffer is incomplete.
  events.push(
    s.delta('msg_answer', 0, 0, ' returns a plain value.'),
    s.textDone('msg_answer', 0, 0, answer),
    s.itemDone('msg_answer', 0, 'final_answer', [answer]),
  );
  return events;
}

export const scenarios: Scenario[] = [
  { id: 'parts', title: 'Two content parts, interleaved', summary: 'One message has two parts whose deltas alternate. Keys keep each part separate; ordering puts part 0 before part 1.', events: twoParts() },
  { id: 'phases', title: 'Commentary, then the final answer', summary: 'Two message items have different phases. Commentary is shown as working notes, not as the answer.', events: phases() },
  { id: 'recovery', title: 'Replayed delta, missing delta', summary: 'One delta arrives twice and another never arrives. The event ID check skips the replay, and the completed text replaces the incomplete buffer.', events: recovery() },
];
