# Lab 11 — Render text events correctly

Lab 11 opens the **Streaming and React** stage. Earlier labs rendered streamed text with a small map inside the server. This lab moves that logic into a pure, typed reducer in the browser. It then compares the reducer with a naive renderer that appends everything it receives.

## Learning goals

1. Explain the text event sequence for one message: `item.added`, `content_part.added`, `output_text.delta`, `output_text.done`, `content_part.done`, and `item.done`.
2. Keep a separate buffer for each content part, keyed by `item_id` and `content_index`.
3. Append deltas to their own part and skip an event ID that was already applied.
4. Replace a part's streamed buffer with its completed text instead of appending the completed text.
5. Render parts by `output_index` and `content_index`, not by arrival order, and show `commentary` messages apart from the `final_answer`.

## Run the lab

Run `npm ci`, put `OPENAI_API_KEY` in a private `.env` file, and start the app with `npm run dev`. Open **Render text events** in the sidebar.

**Live run.** Enter a question and choose **Run and compare**. The server creates a session, forwards the root turn's message and text events, and stops on `turn.completed`. Panel A (naive append) adds every delta and every `output_text.done` text in arrival order. Panel B (keyed buffer) runs the reducer. After the turn completes, the content-part table shows each part's key, phase, delta count, and whether its completed text matched the deltas or replaced them. Choose **Replay this run step by step** to load the recorded events into the replayer.

**Step-through replay (no API key needed).** Choose a scripted sequence and apply one event at a time:

| Sequence | What it shows |
| --- | --- |
| Two content parts, interleaved | Deltas from parts 0 and 1 alternate. Panel A mixes them; panel B keeps them separate and in order. |
| Commentary, then the final answer | Two message items with different phases. Panel B shows commentary as working notes. |
| Replayed delta, missing delta | One delta arrives twice and one never arrives. Panel B skips the replay by event ID, and the completed text repairs the missing words. |

The sequences are scripted teaching fixtures in the same shape the server forwards, not recordings. A live answer often has one message with one content part, so use the fixtures to see multi-part behavior.

Open **View code** for five snippets and explanations. **Viva voice · Read aloud** reads one explanation; **Viva voice · Read all five** reads them in order. Both use browser speech synthesis and do not call an audio API.

## How it was built — step by step

### 1. Forward a compact text event for the root turn only

```ts
// server/lab11.ts, inside the event loop
if (event.type === 'agent.session.turn.created' && event.turn.subagent_id != null) subagentTurns.add(event.turn.id);
// …
else if (event.type === 'agent.session.turn.output_text.delta' && isRoot(event.turn_id)) {
  writeEvent(response, { type: 'text-event', event: {
    type: 'text.delta', eventId: event.event_id, itemId: event.item_id,
    outputIndex: event.output_index, contentIndex: event.content_index, delta: event.delta,
  } });
} else if (event.type === 'agent.session.turn.output_text.done' && isRoot(event.turn_id)) {
  writeEvent(response, { type: 'text-event', event: {
    type: 'text.done', eventId: event.event_id, itemId: event.item_id,
    outputIndex: event.output_index, contentIndex: event.content_index, text: event.text,
  } });
}
```

**Why:** Until Lab 10, the server assembled the answer itself and sent the browser finished text. Lab 11 moves that job to the browser, so the server now forwards every text-related event as a small, flat record. There are six kinds: `item.added`/`item.done` for assistant messages, `part.added`/`part.done` for content parts, and `text.delta`/`text.done`. Each record carries the event ID and the positions (`itemId`, `outputIndex`, `contentIndex`) the reducer needs. Events from subagent turns are skipped (`isRoot`), because only the root turn's text is the answer. `item.added` also forwards the message's `phase`, `commentary` or `final_answer`.

### 2. Type the events and validate them at the boundary

```ts
// src/lab11TextBuffer.ts
export type TextEvent =
  | (ItemRef & { type: 'item.added'; phase: Phase })
  | (PartRef & { type: 'part.added'; text: string })
  | (PartRef & { type: 'text.delta'; delta: string })
  | (PartRef & { type: 'text.done'; text: string })
  | (PartRef & { type: 'part.done'; text: string })
  | (ItemRef & { type: 'item.done'; phase: Phase; parts: string[] });

export function parseTextEvent(value: unknown): TextEvent { /* checks every field, throws on anything else */ }
```

**Why:** This is Lab 06's pattern applied to text: a discriminated union for the six shapes, plus a runtime parser that the browser runs on every line before reducing it.

### 3. Keep one buffer per content part

```ts
// src/lab11TextBuffer.ts
export const partKey = (itemId: string, contentIndex: number): string => `${itemId}:${contentIndex}`;

export type PartState = {
  key: string; itemId: string; outputIndex: number; contentIndex: number;
  text: string; status: 'streaming' | 'done'; deltas: number; replaced: boolean;
};
```

**Why:** One answer can have several messages, and one message several content parts, and their deltas can interleave. Appending everything to a single string mixes them. Each part gets its own buffer, keyed by item and content index. The buffer also records whether it is still streaming, how many deltas it received, and whether the completed text **replaced** what the deltas built.

### 4. Reduce events: skip replays, append deltas, replace on done

```ts
// src/lab11TextBuffer.ts
// A completed part is authoritative: it replaces whatever the deltas built.
function finalizePart(part: PartState, text: string): PartState {
  return { ...part, text, status: 'done', replaced: part.replaced || part.text !== text };
}

export function applyTextEvent(buffer: TextBuffer, event: TextEvent): TextBuffer {
  const naive = naiveAppend(buffer.naive, event);
  if (buffer.seenEventIds.includes(event.eventId)) return { ...buffer, naive, duplicates: buffer.duplicates + 1 };
  const next: TextBuffer = { ...buffer, naive, seenEventIds: [...buffer.seenEventIds, event.eventId] };
  // …item.added records the phase; item.done finalizes every part of the message
  const part = currentPart(next, event);
  if (event.type === 'text.delta') {
    if (part.status === 'done') return { ...next, lateDeltas: next.lateDeltas + 1 };
    return { ...next, parts: { ...next.parts, [part.key]: { ...part, text: part.text + event.delta, deltas: part.deltas + 1 } } };
  }
  // …part.added seeds the text; text.done and part.done replace it
  return { ...next, parts: { ...next.parts, [part.key]: finalizePart(part, event.text) } };
}
```

**Why:** This pure function is the heart of the lab, and it applies three rules:

- **Skip replays:** an event ID that was already applied is counted and ignored, because a reconnect can deliver an event twice.
- **Append deltas:** a delta is added only to its own part, and only while that part is still streaming. A delta that arrives after the part is done is counted as late and ignored.
- **Replace on done:** `text.done`, `part.done`, and `item.done` **replace** the part's text with the completed text. They never append it. Appending both the deltas and the completed text is the classic duplicated-text bug. Replacing also repairs a delta that never arrived.

The function returns a new object instead of changing the old one, so React sees every change. The same function also computes the naive output (`naiveAppend`) for panel A.

### 5. Render by position, and separate the phases

```ts
// src/lab11TextBuffer.ts
export function orderedParts(buffer: TextBuffer): PartState[] {
  return Object.values(buffer.parts).sort((a, b) => a.outputIndex - b.outputIndex || a.contentIndex - b.contentIndex);
}

export function renderText(buffer: TextBuffer, show: 'answer' | 'commentary'): string {
  const messages = new Map<string, string>();
  for (const part of orderedParts(buffer)) {
    const isCommentary = buffer.phases[part.itemId] === 'commentary';
    if (isCommentary !== (show === 'commentary')) continue;
    messages.set(part.itemId, (messages.get(part.itemId) ?? '') + part.text);
  }
  return [...messages.values()].filter(Boolean).join('\n\n');
}
```

**Why:** The order in which events arrive is not the order the text belongs in. Parts are sorted by `outputIndex`, then `contentIndex`. The parts of one message are joined, and separate messages become paragraphs. `commentary` messages are the agent's working notes, so they render in their own box, apart from the final answer.

### 6. Use the same reducer for the live run and the replayer

```tsx
// src/Lab11.tsx
// live: one event at a time, as it arrives
if (event.type === 'text-event') { setLiveBuffer((previous) => applyTextEvent(previous, event.event)); setLiveEvents((previous) => [...previous, event.event]); }

// replay: rebuild the buffer from the first `step` events
const replayBuffer = useMemo(() => scenario.events.slice(0, step).reduce(applyTextEvent, emptyBuffer()), [scenario.events, step]);
```

**Why:** Because `applyTextEvent` is a pure reducer, it works both ways. A live run applies each event as it arrives. The replayer passes the first *n* events of a scripted sequence to `Array.reduce`, so stepping back and forth is just changing *n*. The three scripted sequences in `src/lab11Scenarios.ts` produce cases a live answer rarely shows: interleaved parts, commentary, and a replayed or missing delta. **View code** holds five snippets with **Viva voice** buttons.

## Rendering rules

```ts
key     = `${itemId}:${contentIndex}`        // one buffer per content part
delta   → part.text += delta                  // once per event ID, only while streaming
done    → part.text  = completed text         // output_text.done, content_part.done, item.done
render  → sort by outputIndex, contentIndex   // join parts of one message, blank line between messages
```

The done events are authoritative. Appending both the deltas and the completed text is the duplicated-text bug shown in panel A. If the stream closes before `turn.completed`, the rendered text may be partial. Lab 13 covers recovering saved items after a disconnect.

## Code map

| File | Role |
| --- | --- |
| `src/lab11TextBuffer.ts` | Pure reducer: event validation, part keys, delta append, replay check, replacement, ordering, and phase-aware rendering. Also computes the naive output for comparison. |
| `src/lab11Scenarios.ts` | Three scripted event sequences for the replayer. |
| `server/lab11.ts` | Streams a session and forwards only the root turn's message and text fields as NDJSON. |
| `server/index.ts` | Routes `POST /api/lab11/run`. |
| `src/Lab11.tsx` | Live run, side-by-side comparison, content-part table, step-through replayer, code snippets, and Viva voice. |
| `src/App.tsx` | Adds the Streaming and React sidebar stage and Lab 11 navigation. |
| `tsconfig.lab6.json` | Type-checks the reducer and scenarios in strict mode. |

## Student challenge

Step through **Replayed delta, missing delta** and explain, event by event, why panels A and B differ. Then change `finalizePart` in `src/lab11TextBuffer.ts` to append instead of replace, and confirm that panel B now duplicates text too. Revert the change, run a live answer, and show that panel B matches the completed text in the content-part table. Record the session ID and root turn ID.

See [OpenAI Docs: Events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events) for the event reference.
