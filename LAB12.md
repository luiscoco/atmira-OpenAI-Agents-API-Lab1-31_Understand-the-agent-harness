# Lab 12 — Build a turn timeline

Lab 11 rendered the text of one answer. Lab 12 shows the whole run: every session, turn, item, and text event, grouped by the turn it belongs to and numbered in arrival order. The result is a visual timeline of one agent run, and of later turns in the same session.

## Learning goals

1. Separate session-level events (`agent.session.*` status, environment, and subagent lifecycle) from turn-level events (`turn.*`, `turn.item.*`, text and reasoning events).
2. Assign each event to a turn: use its `turn_id`, and when a text event has none, use the turn in which its item started.
3. Number events in arrival order, skip an event ID that was already placed, and record when the server received each event.
4. Flag events that are out of place: a turn first seen without `turn.created`, or an item or text event after its turn ended.
5. End a run on the **root** turn's `completed`, `failed`, or `cancelled` event, not on a subagent turn, and observe `agent.session.idle` after it.

## Run the lab

Run `npm ci`, put `OPENAI_API_KEY` in a private `.env` file, and start the app with `npm run dev`. Open **Build a turn timeline** in the sidebar.

**Live run.** Enter a question and choose **Run and record**. The server creates a session and forwards every event as metadata only: type, event ID, turn ID, item ID and type, status, and a short detail such as `+12 chars`. It does not forward prompt or answer text in these events. After the root turn ends, the server keeps reading for up to three seconds to capture `agent.session.idle`. Choose **Send follow-up (same session)** to add a second root turn. The timeline then shows one session lane and two turn lanes.

The timeline has three views of the same data:

| View | What it shows |
| --- | --- |
| Summary tiles | Events placed, root and subagent turns, replays skipped, and the latest root outcome. |
| Swimlanes | One lane per turn plus a session lane. Each dot is an event at its sequence position; the bar shows a turn's span. |
| Turn cards | Every event in the lane with its sequence number, time since the first event, type, and metadata. Consecutive deltas can be collapsed into one row. |

**Step-through replay (no API key needed).** Choose a scripted sequence and place one event at a time:

| Sequence | What it shows |
| --- | --- |
| One turn, start to finish | Session events around one root turn. Text deltas have no `turn_id` and are placed by their item. |
| Two turns in one session | A follow-up adds a second root turn; session events sit between the turns. |
| A subagent inside the root turn | The subagent turn completes first. The run ends only when the root turn completes. |
| Failed turn, replayed and late events | One event arrives twice and is skipped; a delta after `turn.failed` is flagged. |

The sequences are scripted teaching fixtures in the same shape the server forwards, not recordings. Choose **Replay these events step by step** after a live run to replay your own session.

Open **View code** for six snippets and explanations. **Viva voice · Read aloud** reads one explanation; **Viva voice · Read all six** reads them in order. Both use browser speech synthesis and do not call an audio API.

## How it was built — step by step

### 1. Normalize every SDK event to timeline metadata

```ts
// server/lab12.ts
function normalize(event, at: number) {
  const base = { eventId: event.event_id, type: event.type, at, turnId: event.turn_id ?? null, itemId: null, itemType: null, status: null, subagentId: null, detail: null };
  if (event.turn) return { ...base, turnId: event.turn.id, status: event.turn.status, subagentId: event.turn.subagent_id ?? null, detail: event.turn.error?.message ?? null };
  if (event.item) {
    const role = event.item.role ? [event.item.role, event.item.phase].filter(Boolean).join(' · ') : null;
    return { ...base, itemId: event.item.id ?? null, itemType: event.item.type, status: event.item.status ?? null, detail: role };
  }
  if (event.item_id) {
    const detail = typeof event.delta === 'string' ? `+${event.delta.length} chars` : typeof event.text === 'string' ? `${event.text.length} chars` : `part ${event.content_index ?? event.summary_index ?? 0}`;
    return { ...base, itemId: event.item_id, detail };
  }
  if (event.session) return { ...base, status: event.session.status };
  if (event.subagent) return { ...base, subagentId: event.subagent.id, detail: event.subagent.name ?? null };
  return base;
}

// in the loop
writeEvent(response, { type: 'event', event: normalize(event, Date.now()) });
```

**Why:** A timeline needs the same fields for every event, but the SDK puts them in different places for turn, item, text, session, and subagent events. `normalize` flattens all of them into one `TimelineEvent`. It records **when the server received** the event (`at`), because stream events carry no timestamp of their own. Text is reduced to a length (`+12 chars`), so no prompt or answer text travels with the timeline. The answer is sent once, separately, from the root turn's completed message.

### 2. End on the root turn, then wait briefly for idle

```ts
// server/lab12.ts
const idleGraceMs = 3000;

const rootTerminal = (event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled')
  && event.turn.subagent_id == null && !earlierTurns.has(event.turn.id);
if (rootTerminal && !outcome) {
  // A subagent turn finishing is not the end of the run; only the root turn decides.
  outcome = event.turn.status;
  graceTimer = setTimeout(() => stream?.controller.abort(), idleGraceMs);
} else if (outcome && (event.type === 'agent.session.idle' || event.type === 'agent.session.requires_action')) {
  idleObserved = true;
  break;
}
```

**Why:** A subagent turn can complete while the root turn is still working, so only a root turn's terminal event ends the run. After that, the session usually emits `agent.session.idle`. Earlier labs stopped reading before it arrived. Here the server keeps reading for up to three seconds so the timeline can show the idle event after the outcome. It then reports whether idle was observed.

### 3. Protect a follow-up from replayed outcomes

```ts
// server/lab12.ts
if (sessionId) {
  // Remember existing turns so a replayed terminal event cannot end this run.
  const page = await api.beta.agents.sessions.turns.list(sessionId, { limit: 100 });
  for (const turn of page.data) earlierTurns.add(turn.id);
  stream = await api.beta.agents.sessions.events.stream(sessionId);
  await api.beta.agents.sessions.events.create(sessionId, {
    events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }],
  });
}
```

**Why:** **Send follow-up** reattaches to an existing session. A reattached stream can deliver events from earlier turns, including an old `turn.completed`. Without a guard, that old event would end the new run at once. The server lists the turns that already exist before sending, and ignores their terminal events (`!earlierTurns.has(...)`).

### 4. Build the timeline with a pure function

```ts
// src/lab12Timeline.ts, buildTimeline
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
  // …add the row to its turn group
}
```

**Why:** This one function turns a flat list of events into lanes:

- **Replays:** an event ID seen before is counted and skipped.
- **Order:** sequence numbers count arrival order after replays are removed.
- **Turn assignment:** text deltas usually have no `turn_id`, so they are placed in the turn where their item started. The row is marked `inferred`, so the UI can show that the lane was deduced.
- **Session lane:** events with no turn at all, such as session status or environment events, go to the session lane.

The live run and the step-through replayer both call it, which is why they look identical.

### 5. Warn about events that are out of place

```ts
// src/lab12Timeline.ts, inside buildTimeline
if (!turn) {
  turn = { turnId, label: '', subagentId: null, status: 'unknown', sawCreated: false, rows: [], itemIds: [], firstSeq: row.seq, lastSeq: row.seq, durationMs: 0 };
  turns.set(turnId, turn);
  if (event.type !== 'agent.session.turn.created') warnings.push(`#${row.seq}: turn ${shortId(turnId)} first appeared in ${shortType(event.type)}. Its created event was not observed.`);
}
if (terminalStatuses.includes(turn.status) && row.category !== 'turn') warnings.push(`#${row.seq}: ${shortType(event.type)} arrived after turn ${shortId(turnId)} was ${turn.status}.`);
```

**Why:** A timeline is a debugging tool, so it points out anything surprising: a turn whose `created` event was never seen (you attached late), or an item or text event that arrives after its turn already ended. Each warning names the event's sequence number, so it can be found in the turn card.

### 6. Categorize, label, and collapse deltas for display

```ts
// src/lab12Timeline.ts
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

// Consecutive deltas for the same item become one row, so the order stays readable.
export function collapseDeltas(rows: Row[]): RowGroup[] { /* … */ }
```

**Why:** The category gives each dot its colour in the swimlanes. Turns are labelled `Turn 1`, `Turn 2`, and `Subagent turn 1` in the order they appear. A long answer produces hundreds of deltas, so the turn cards can fold consecutive deltas for one item into a single row. The swimlanes still place every event. **View code** holds six snippets with **Viva voice** buttons.

## Timeline rules

```ts
seen(eventId)        → skip, count as a replay
turnId               = event.turn_id ?? turnOfItem[event.item_id] ?? null   // null → session lane
seq                  = arrival order after replays are skipped
run outcome          = root turn completed | failed | cancelled             // subagent turns do not end the run
after the outcome    → wait briefly for agent.session.idle
```

Times are when the **server received** each event. Stream events carry no timestamp of their own, so use these times to compare phases of one run, not as exact model latency. Lab 15 covers usage and duration.

## Code map

| File | Role |
| --- | --- |
| `src/lab12Timeline.ts` | Pure functions: event categories, turn assignment, replay skipping, sequence numbers, order warnings, delta collapsing, and runtime validation. |
| `src/lab12Scenarios.ts` | Four scripted event sequences for the replayer. |
| `server/lab12.ts` | Normalizes each SDK event to timeline metadata, forwards it as NDJSON, ends on the root turn outcome, and waits for idle. For follow-ups, it lists earlier turns first so a replayed outcome cannot end the new run. |
| `server/index.ts` | Routes `POST /api/lab12/run`. |
| `src/Lab12.tsx` | Live run and follow-up, summary tiles, swimlanes, turn cards, step-through replayer, code snippets, and Viva voice. |
| `src/App.tsx` | Adds Lab 12 to the Streaming and React stage. |
| `tsconfig.lab6.json` | Type-checks the timeline and scenarios in strict mode. |

## Student challenge

Step through **A subagent inside the root turn** and explain why the run is not finished when the subagent turn completes. Then run a live question and a follow-up in the same session. Show that the timeline has one session lane and two root turns, record both turn IDs, and name the event that ended each turn. Finally, remove the `?? fromItem` fallback in `buildTimeline`, replay **One turn, start to finish**, and explain where the text deltas went. Revert the change.

See [OpenAI Docs: Events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events) for the event reference.
