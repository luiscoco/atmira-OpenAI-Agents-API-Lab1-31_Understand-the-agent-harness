# Lab 13 — Recover after a disconnect

Lab 04 showed that a stream ending without an outcome is uncertain. Lab 13 makes the tutor **refresh-safe**. The page writes down each request before sending it and survives a dropped stream or a page reload. It reads the saved session to learn what happened. Then it reattaches, shows the saved answer, or sends again with the same request ID. It never repeats input blindly.

## Learning goals

1. Save a pending record (request ID, session ID, question, last known turn) in browser storage **before** sending, and clear it only when the outcome is known.
2. Tag the work with the request ID: `metadata` on a new session, and the `Idempotency-Key` header on a follow-up message.
3. Find the session after a disconnect, by its ID or by the request ID in its metadata, and read its turns and saved items. Reading sends nothing.
4. Match the question to a saved turn and let that turn's status decide: reattach, show the saved answer, resend with the same key, or offer a retry.
5. Reattach to a running turn by opening the event stream **before** reading its status, then replace the streamed text with the saved answer.

## Run the lab

Run `npm ci`, put `OPENAI_API_KEY` in a private `.env` file, and start the app with `npm run dev`. Open **Recover after a disconnect** in the sidebar. The open lab is now kept in the URL hash (`#lab13`), so a reload returns to it.

**Live run.** Ask a question. Break the stream in one of three ways:

| How | What happens |
| --- | --- |
| **Server drops the stream after the first 80 characters** (on by default) | The server stops forwarding without cancelling the turn. The agent keeps answering. |
| **Disconnect now** | The browser aborts the request. The server stops reading; the turn keeps running on the API. |
| **Reload the page** | Everything in memory is lost. Only the pending record in browser storage remains. |

The page then reads saved state and shows a **decision** with its evidence and what a blind resend would have done. Reading and reattaching are automatic. Sending is always a button the user presses. The conversation panel is rebuilt from the session's saved items, not from the stream. A recovered turn is labelled **recovered, not resent**. The panel also shows the raw storage record and a timestamped recovery log.

**Recovery playground (no API key needed).** Pick a case, then reveal one check at a time until the decision:

| Case | Decision |
| --- | --- |
| Disconnected before the session existed | Resend: nothing ran, nothing was billed. |
| Stream dropped mid-answer, turn still running | Reattach and follow the turn. |
| Page refreshed, the turn completed meanwhile | Show the saved answer; the session is found by request ID metadata. |
| Follow-up input never arrived | Resend with the same Idempotency-Key. |
| The turn failed after the disconnect | Show the error; a retry is a new request with a new ID. |
| A blind retry already ran | Review: the question is in two turns, so it was paid for twice. |

The cases are scripted teaching fixtures in the same shape as the live flow, not recordings. The live run and the playground use the same `decideRecovery` function.

Open **View code** for six snippets and explanations. **Viva voice · Read aloud** reads one explanation; **Viva voice · Read all six** reads them in order. Both use browser speech synthesis and do not call an audio API.

## How it was built — step by step

### 1. Write the request down before sending it

```ts
// src/lab13Recovery.ts
// Written to browser storage before the request leaves, and cleared once its outcome is known.
export type PendingSend = {
  requestId: string;          // browser-generated; also the Idempotency-Key and the session metadata tag
  sessionId: string | null;   // null until the server reports the new session's ID
  prompt: string;
  afterTurnId: string | null; // the last root turn the browser knew before this send
  sentAt: number;
  partial: string;            // text streamed before the disconnect; shown, never trusted as final
};
```

```tsx
// src/Lab13.tsx
async function send(record: PendingSend) {
  persist({ sessionId: record.sessionId ?? storedRef.current.sessionId, pending: record });   // storage first…
  // …then the network request
  const response = await fetch('/api/lab13/send', { method: 'POST', /* … */ body: JSON.stringify({ prompt: record.prompt, sessionId: record.sessionId ?? '', requestId: record.requestId /* … */ }) });
}
```

**Why:** A page reload wipes React state, but browser storage survives. The page writes a **pending record** before the request leaves, so after any interruption it still knows what it asked, where, and under which request ID. `afterTurnId` records the last turn the page knew about, so new turns can be told apart from old ones later. The record is removed only in `settle()`, once the outcome is known. `loadStored` and `saveStored` wrap storage in `try/catch`, so a private window or blocked storage does not break the page.

### 2. Tag the work with the request ID

```ts
// server/lab13.ts
const requestMetadataKey = 'lab13_request_id';

// a follow-up: the same request ID is the Idempotency-Key
await api.beta.agents.sessions.events.create(sessionId, {
  'Idempotency-Key': requestId,
  events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }],
});

// a new session: tag it so it can be found if its ID never reaches the browser
stream = await api.beta.agents.sessions.create({
  agent, environment: { type: 'none' }, input: prompt, stream: true,
  metadata: { [requestMetadataKey]: requestId },
});
```

**Why:** The request ID links the page's record to the work on OpenAI's side in two ways:

- **New session:** the ID is stored in the session's `metadata`. If the stream drops before the session ID reaches the browser, the session can still be found by searching recent sessions for that tag.
- **Follow-up:** the ID is sent as the `Idempotency-Key`. If the same message is sent again with the same key, the API treats it as the same message, not a second one.

### 3. Read the saved state, by ID or by metadata

```ts
// server/lab13.ts, snapshot
// The ID never reached the browser: look for the request ID in recent sessions' metadata.
const page = await api.beta.agents.sessions.list({ limit: 20, order: 'desc' });
session = page.data.find((candidate) => candidate.metadata?.[requestMetadataKey] === requestId);
foundBy = 'metadata';
```

**Why:** `GET /api/lab13/snapshot` is read-only. It finds the session (by ID when known, otherwise by metadata), then reads its turns and its root agent messages. It reports whether more existed than it read (`complete`), so the page never treats a partial read as proof. The browser checks the snapshot with `parseSnapshot` before using it.

### 4. Decide what to do with one pure function

```ts
// src/lab13Recovery.ts, decideRecovery (the order of the checks)
// 1. Find the session.            not found → resend (nothing ran) or review (it was deleted)
// 2. Keep only root turns created after pending.afterTurnId.
// 3. Find the saved user message that carries this question.
const matched = [...new Set(snapshot.messages
  .filter((message) => message.role === 'user' && freshIds.has(message.turnId) && message.text.trim() === prompt)
  .map((message) => message.turnId))];
//    2+ turns → review: a blind retry already duplicated it
//    0 turns  → wait if the session is busy, otherwise resend with the SAME request ID
// 4. Exactly one turn: its status decides.
if (activeStatuses.includes(turn.status)) return decide('reattach', 'The agent is still answering. Reattach', …);
if (turn.status === 'completed') return decide('show_saved', 'The answer is saved. Show it', …, turn.id, savedAnswer(snapshot, turn.id));
return decide('offer_retry', `The turn ${turn.status}. Let the user decide`, …);
```

**Why:** This function is the lab. It turns "the stream broke" into one of six clear actions: resend, reattach, show the saved answer, offer a retry, wait, or review. Each check it makes is added to `evidence`, and each decision also says what a **blind resend** would have done (`naive`). The page shows both. The live run and all six playground cases call this same function. Reading and reattaching happen automatically; **sending is always a button** the user presses.

### 5. Reattach: open the stream first, then read the status

```ts
// server/lab13.ts, attach
// Open the stream first, then read the status, so an outcome between the two is not missed.
stream = await api.beta.agents.sessions.events.stream(sessionId);
const turn = await api.beta.agents.sessions.turns.retrieve(turnId, { session_id: sessionId });
```

**Why:** This follows the same rule as Lab 02, applied to recovery. If the page read the status first and opened the stream second, the turn could finish in between and the page would wait forever for an outcome it had missed. Attaching sends nothing. The text seen after reattaching is only the live tail, because missed deltas are not replayed. So when the turn completes, the page replaces it with the saved answer.

### 6. Resume after a reload, and rebuild the conversation from saved items

```tsx
// src/Lab13.tsx, on mount
if (current.pending) {
  addLog('read', `Found pending request ${shortId(current.pending.requestId)} in browser storage from ${clock(current.pending.sentAt)}. Its outcome is unknown.`);
  // …read the snapshot and run decideRecovery
}

// once the outcome is known
async function settle(sessionId: string | null, turnId: string | null, note: string) {
  persist({ sessionId: sessionId ?? storedRef.current.sessionId, pending: null });
  setRecoveredTurn(turnId);
  if (sessionId) await loadConversation(sessionId);
  setLiveText('');
}
```

**Why:** When the page loads and finds a pending record, it starts recovery on its own. The open lab is kept in the URL hash (`#lab13`), so a reload returns to this page. The conversation panel is always rebuilt from the session's **saved items**, not from streamed text. A turn the page recovered rather than sent is labelled **recovered, not resent**. **View code** holds six snippets with **Viva voice** buttons.

## Recovery rules

```ts
before sending        → save { requestId, sessionId, prompt, afterTurnId } to browser storage
new session           → sessions.create({ …, metadata: { lab13_request_id: requestId } })
follow-up             → events.create(sessionId, { 'Idempotency-Key': requestId, events })
stream ends, no outcome → read saved state (session, turns, items); send nothing
session not found     → no session ID known: resend (nothing ran) · ID known: review
question in 0 turns   → session busy: wait · otherwise: resend with the SAME request ID
question in 2+ turns  → review: a blind retry already duplicated it
turn running          → reattach: open the stream, then read the status
turn completed        → show the saved answer; replace the partial text
turn failed/cancelled → show why; a retry gets a NEW request ID
```

Observed while building this lab: resending a follow-up with the same `Idempotency-Key` created no second turn. Because no new turn starts, the server waits 15 seconds and then ends the stream with an explanation, and the page reads saved state. A stream opened with `events.stream` after a disconnect delivered only new events, not the deltas already missed, so the text seen after reattaching is a live tail. It is replaced by the saved answer when the turn completes.

The metadata search reads the 20 most recent sessions, which is enough for this lab. A production app should also record the session ID on its own server as soon as the stream reports it (Lab 45 covers server-side session mapping).

## Code map

| File | Role |
| --- | --- |
| `src/lab13Recovery.ts` | Pure functions: pending record and snapshot types, `decideRecovery`, saved-answer lookup, browser storage with fallbacks, and runtime validation of the snapshot. |
| `src/lab13Scenarios.ts` | Six scripted recovery cases for the playground. |
| `server/lab13.ts` | `send` tags the work and can simulate a drop; `snapshot` reads session, turns, and items (by ID or request ID metadata); `attach` follows a running turn without sending anything. |
| `server/index.ts` | Routes `POST /api/lab13/send`, `GET /api/lab13/snapshot`, and `POST /api/lab13/attach`. |
| `src/Lab13.tsx` | Live run, disconnect and reload controls, decision card, storage and log panels, playground, code snippets, and Viva voice. |
| `src/App.tsx` | Adds Lab 13 to the Streaming and React stage and keeps the open lab in the URL hash. |
| `tsconfig.lab6.json` | Type-checks the recovery logic and scenarios in strict mode. |

## Student challenge

Ask a question with the simulated disconnect on, and record the decision the page makes and why. Then turn the simulation off, ask a follow-up, and choose **Reload the page** while the answer streams. Show that the session holds exactly one turn for each question and that the recovered turn is labelled **recovered, not resent**. Finally, step through **A blind retry already ran** and explain what the duplicate turn cost.

See [OpenAI Docs: Events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events) and [Manage sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage).
