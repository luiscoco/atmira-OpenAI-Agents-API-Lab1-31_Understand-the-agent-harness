# Lab 03 — Inspect the lifecycle

Lab 03 adds a live event inspector beside the programming tutor chat. It builds on [Lab 02](LAB02.md): a follow-up stays in the same session and starts another turn. The inspector shows every event the agent emits, with the IDs that connect them: session, turn, event, and saved item.

## Learning goals

1. Identify the session ID, root turn ID, event ID, and saved item ID.
2. Read event order as an agent works.
3. Distinguish a session's idle state from a turn's completed, failed, or cancelled outcome.

## Run

Use Node.js 22 or newer. In Windows Terminal, run `npm ci`, provide your own `OPENAI_API_KEY` through the environment or a private `.env` file, then run `npm run dev`. Open <http://localhost:5173> and choose **Inspect the lifecycle**.

## How it was built — step by step

### 1. Reuse the Lab 02 handler with an inspect flag

```ts
// server/index.ts
if (path === '/api/lab3/run' && request.method === 'POST') {
  await handleRun(request, response, true, true);   // lab2 = true, inspect = true
  return;
}
```

**Why:** Lab 03 needs everything Lab 02 does: start a session, continue it with a follow-up, and stream the answer. Instead of copying that code, the route calls the same `handleRun` with a second flag. When `inspect` is on, the handler also forwards a description of every event.

### 2. Forward compact metadata for every event

```ts
// server/index.ts, inside the event loop of handleRun
for await (const event of stream) {
  if (response.destroyed) break;
  if (inspect) {
    // Forward identifiers and lifecycle metadata, never prompt or answer content.
    writeEvent(response, {
      type: 'inspect',
      event: {
        type: event.type,
        eventId: event.event_id || null,
        sessionId: event.session_id || sessionId || null,
        turnId: event.turn_id || event.turn?.id || event.item?.turn_id || null,
        itemId: event.item_id || event.item?.id || null,
        turnStatus: event.turn?.status || null,
        sessionStatus: event.session?.status || null,
        rootTurn: event.turn?.subagent_id == null,
      },
    });
  }
  // …the text and outcome handling from Labs 01–02 follows
}
```

**Why:** Different event types carry their IDs in different places. A text delta has `item_id`, a turn event has `turn.id`, and an item event has `item.id` and `item.turn_id`. The server flattens them into one small record per event, so the browser shows the same fields for every event. It deliberately leaves out the payload: no prompt text and no answer text reach the inspector, only identifiers and statuses. `rootTurn` is true when the turn has no `subagent_id`. That matters from Lab 12 onwards, when subagent turns can appear in the same stream.

### 3. Connect text updates to their item

```ts
// server/index.ts, inside handleRun
const partKey = (event) => `${event.item_id}:${event.output_index}:${event.content_index}`;

if (event.type === 'agent.session.turn.output_text.delta') {
  const key = partKey(event);
  parts.set(key, (parts.get(key) || '') + event.delta);
  writeEvent(response, { type: 'text', text: [...parts.values()].join('\n') });
}
```

**Why:** Many text events share one item ID, because they are pieces of the same saved message. Each event still has its own event ID. In the inspector, students can pick two text events and see the same `itemId` with different `eventId`s. The output index and content index identify the exact text part being assembled. Lab 11 goes deeper into this.

### 4. Decide the outcome from the root turn, not from idle

```ts
// server/index.ts, inside handleRun
} else if (event.type === 'agent.session.turn.completed' && event.turn?.subagent_id == null) {
  completed = true;
  writeEvent(response, { type: 'complete' });
  break;
} else if (event.type === 'agent.session.turn.failed' && event.turn?.subagent_id == null) {
  throw new Error(event.turn.error?.message || 'The agent turn failed.');
} else if (event.type === 'agent.session.turn.cancelled' && event.turn?.subagent_id == null) {
  throw new Error('The agent turn was cancelled.');
}
```

**Why:** A **session** can be in progress or idle. A **turn** ends as completed, failed, or cancelled. Only the root turn's terminal event tells you whether the work succeeded. An idle session just means it is waiting for input: it becomes idle after a failure too. The server stops reading at the completed event, so an idle event may never be seen. That is why the page labels the session state as **observed**.

### 5. Collect IDs and the latest events in React

```tsx
// src/Lab3.tsx
const maxVisibleEvents = 120;

// inside submit, for each line of the stream
if (item.type === 'inspect') {
  const entry = item.event;
  setEventCount((count) => count + 1);
  setEvents((previous) => [...previous, entry].slice(-maxVisibleEvents));
  if (entry.rootTurn && entry.turnId) setRootTurnIds((previous) => previous.includes(entry.turnId) ? previous : [...previous, entry.turnId]);
  if (entry.itemId) setSavedItemIds((previous) => previous.includes(entry.itemId) ? previous : [...previous, entry.itemId]);
  if (entry.type === 'agent.session.idle') setSessionState('idle');
  else if (entry.type === 'agent.session.in_progress') setSessionState('in progress');
  if (entry.rootTurn && entry.type === 'agent.session.turn.completed') setStatus('completed');
  if (entry.rootTurn && entry.type === 'agent.session.turn.failed') setStatus('failed');
  if (entry.rootTurn && entry.type === 'agent.session.turn.cancelled') setStatus('cancelled');
}
```

**Why:** A long answer can produce hundreds of events. The page keeps only the latest 120 visible, but counts all of them, so nothing is silently lost from the total. Root turn IDs and item IDs are kept as unique lists for the whole conversation, so a follow-up visibly adds a **new** turn ID under the **same** session ID. The session state and the turn outcome are separate pieces of state, which mirrors the rule in step 4.

### 6. Show the IDs and the event list, then teach the code

```tsx
// src/Lab3.tsx
function IdField({ label, value }) {
  return <div className="lab3-id"><span>{label}</span><code title={value || undefined}>{value || 'Waiting for an event'}</code></div>;
}
```

**Why:** Each ID gets a labelled field, and the event list shows the newest events first. **View code** holds four explained excerpts: capturing events, connecting text to items, deciding the root turn outcome, and showing IDs in React. Each has a **Viva voice · Read aloud** button that uses browser speech synthesis. It does not make an OpenAI API call.

## Exercise

1. Ask “What is a JavaScript function?” Watch events appear as the response streams.
2. Find the session ID, latest root turn ID, latest event ID, and latest saved item ID in the inspector.
3. Ask “Show me an example.” The session ID should stay the same. A new root turn ID should appear.
4. Compare two text events that share an item ID. Each event has its own event ID.

The inspector shows the latest 120 events while retaining the total count. It forwards metadata rather than raw event payloads, so prompts and response text do not appear in the inspector. The session state is labelled **observed** because the live stream may close on a completed turn before an idle event arrives. An idle event alone is not evidence of success; use the root turn's completion, failure, or cancellation event.

## Code map

| File | Role |
| --- | --- |
| `server/index.ts` | `handleRun` with `inspect = true`: streams agent events and forwards compact lifecycle metadata from `/api/lab3/run`. |
| `src/Lab3.tsx` | Renders the conversation, IDs, event list, turn outcome, code lessons, and read-aloud controls. |
| `src/App.tsx` | Adds the Lab 03 navigation item. |
| `src/styles.css` | Lays out the chat and inspector side by side. |

See [OpenAI Docs: Events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events) for event fields and [Run and continue sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions) for turn outcomes.
