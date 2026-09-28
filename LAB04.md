# Lab 04 — Handle interrupted work

Lab 04 builds on [Lab 03](LAB03.md). It adds an error and recovery panel beside the tutor. Students can inspect an API error, request cancellation of a live turn, and simulate a stream that stops before the turn outcome arrives. Then they retrieve the saved state before deciding whether a retry is safe.

## Learning goals

1. Distinguish an HTTP or API error from a failed or cancelled agent turn.
2. Treat a stream that ends without a root turn outcome as uncertain.
3. Retrieve the session, recent turns, and saved messages before retrying.
4. Explain why a recovered completed turn should not be run again.

## Run on Windows

Use Node.js 22 or newer. In Windows Terminal, run `npm ci`, set your own `OPENAI_API_KEY` in the environment or a private `.env` file, and run `npm run dev`. Open <http://localhost:5173> and choose **Handle interrupted work**.

## How it was built — step by step

Lab 04 moves its server code into its own module, `server/lab4.ts`, with three routes: `POST /api/lab4/run`, `GET /api/lab4/recover`, and `POST /api/lab4/cancel`.

### 1. Accept a scenario so every failure can be repeated

```ts
// server/lab4.ts, inside runLab4
const scenario = body.scenario || 'normal';
if (!prompt || prompt.length > 2000 || (sessionId && !validSessionId(sessionId)) ||
    !['normal', 'api_error', 'turn_failure', 'disconnect'].includes(scenario)) {
  sendJson(response, 400, { error: 'Invalid prompt, session ID, or scenario.' });
  return;
}
if (scenario === 'api_error') {
  sendJson(response, 503, { error: 'Simulated API error: the request was rejected before a session or turn was started.', simulated: true });
  return;
}
if (scenario === 'turn_failure') {
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
  writeEvent(response, { type: 'outcome', outcome: 'failed', simulated: true,
    message: 'Simulated turn failure: a real turn did not run in this local exercise.' });
  response.end();
  return;
}
```

**Why:** Real failures are rare and unpredictable, which makes them hard to teach. The scenario field gives the lesson repeatable cases. The two simulations deliberately fail in **different** ways. An API error is an HTTP error (`503`): no session or turn was ever started. A turn failure is a successful HTTP response whose **outcome** is `failed`. The page must handle both, and they lead to different retry rules. Both simulations are local and make no OpenAI call.

### 2. Report a turn outcome, not just "the stream ended"

```ts
// server/lab4.ts, inside the event loop
} else if (event.type === 'agent.session.turn.completed' && event.turn?.subagent_id == null) {
  terminal = true;
  writeEvent(response, { type: 'outcome', outcome: 'completed' });
  break;
} else if (event.type === 'agent.session.turn.failed' && event.turn?.subagent_id == null) {
  terminal = true;
  writeEvent(response, { type: 'outcome', outcome: 'failed', message: event.turn.error?.message || 'The agent turn failed.' });
  break;
} else if (event.type === 'agent.session.turn.cancelled' && event.turn?.subagent_id == null) {
  terminal = true;
  writeEvent(response, { type: 'outcome', outcome: 'cancelled', message: 'The agent turn was cancelled.' });
  break;
}
// …after the loop
if (!terminal && !simulatedDisconnect && !response.destroyed) {
  writeEvent(response, { type: 'error', kind: 'disconnect', message: 'The stream closed before a turn outcome arrived.' });
}
```

**Why:** Labs 01–03 turned failed and cancelled turns into errors. Lab 04 sends them as an explicit `outcome` event, so the browser can tell a clean failure apart from a broken connection. If the stream ends without any terminal event, the server says so with `kind: 'disconnect'`. That result is **uncertain**: the turn may still be running or may already have completed.

### 3. Simulate a dropped stream without cancelling the turn

```ts
// server/lab4.ts
if (event.type === 'agent.session.turn.output_text.delta') {
  const key = partKey(event);
  parts.set(key, (parts.get(key) || '') + event.delta);
  writeEvent(response, { type: 'text', text: [...parts.values()].join('\n') });
  if (scenario === 'disconnect' && sessionSent) {
    simulatedDisconnect = true;
    response.end();
    break;
  }
}
```

**Why:** The disconnect scenario closes the browser's response as soon as the first text arrives, while the agent keeps working on OpenAI's side. That is exactly what happens when a laptop sleeps or a network drops. The session ID was already sent, so the page can still look the session up afterwards.

### 4. Cancel a live turn with an input event

```ts
// server/lab4.ts, cancelLab4
await client().beta.agents.sessions.events.create(body.sessionId, {
  events: [{ type: 'agent.session.input.cancel' }],
});
sendJson(response, 200, { requested: true });
```

**Why:** Cancellation is another input event, sent the same way as a follow-up message. The server replies that cancellation was **requested**, not that it happened. The turn may complete before the cancel arrives, so the page keeps reading the original stream and shows whichever outcome actually arrives. Lab 14 explores this race in depth.

### 5. Retrieve the saved state before retrying

```ts
// server/lab4.ts, recoverLab4
const [session, turnPage, itemPage] = await Promise.all([
  api.beta.agents.sessions.retrieve(sessionId),
  api.beta.agents.sessions.turns.list(sessionId, { order: 'desc', limit: 20 }),
  api.beta.agents.sessions.items.list(sessionId, { order: 'asc', limit: 100 }),
]);
const items = itemPage.data.filter((item) => item.type === 'message').map((item) => ({
  id: item.id, turnId: item.turn_id, role: item.role, status: item.status,
  text: Array.isArray(item.content)
    ? item.content.filter((part) => 'text' in part && typeof part.text === 'string').map((part) => 'text' in part ? part.text : '').join('\n')
    : '',
}));
sendJson(response, 200, {
  session: { id: session.id, status: session.status, requiredActions: session.required_actions?.length || 0 },
  turns: turnPage.data.map((turn) => ({ id: turn.id, status: turn.status, error: turn.error?.message || null })),
  items,
  itemsHasMore: itemPage.has_more,
});
```

**Why:** After an interruption, the only reliable source of truth is the saved session. Three read-only calls run in parallel: the session's status, the 20 most recent turns (newest first), and the first page of saved items. Only message items are forwarded, trimmed to their text. `itemsHasMore` lets the page say when there are more than 100 items instead of pretending the list is complete.

### 6. Decide in React whether a retry is safe

```tsx
// src/Lab4.tsx
const latestTurn = recovery?.turns?.[0];
const turnActive = latestTurn && ['queued', 'in_progress', 'waiting'].includes(latestTurn.status);
const canRetry = Boolean(lastPrompt && runState !== 'running' && (
  !sessionId ? ['api_error', 'failed'].includes(runState) :
    recovery && !reviewRequired && !turnActive && recovery.session.status === 'idle'
    && (noTurnStarted || ['failed', 'cancelled'].includes(latestTurn?.status))
));

// inside recover()
if (latest?.status === 'completed') {
  const savedAnswer = [...saved.items].reverse().find((item) => item.role === 'assistant' && item.turnId === latest.id && item.text);
  if (savedAnswer) setAnswer(savedAnswer.text);
  setRunState('completed');
  setMessage('Saved state shows that the turn completed. The answer was recovered from saved items.');
}
```

**Why:** Retrying blindly can run the same work twice. The page offers **Retry previous prompt** only when a retry is known to be safe:

- **No session was created:** the request never reached the agent.
- **Saved state was checked:** the session is idle, no turn is still active, and the latest turn failed or was cancelled.

If the saved state shows the turn **completed**, the page recovers the answer from the saved assistant message for that turn and hides the retry. Until the saved state has been reviewed, the question box is also locked (`canAsk`).

### 7. Teach the code in the page

**View code** holds four explained snippets. Each has a **Viva voice · Read aloud** button that uses browser speech synthesis.

## Exercises

1. Choose **Simulated turn failure** to see a local failed outcome without an API call. Then choose **Simulated API error** and submit a question. The request is rejected before a session starts. The panel shows that no session ID exists, so retry is available.
2. Choose **Normal run** and submit a question. While it is running, click **Cancel turn**. This sends a real `agent.session.input.cancel` event. The turn may complete before the cancellation arrives; inspect the resulting outcome.
3. Choose **Simulated stream disconnect** and submit a question. The server stops forwarding events after answer text begins, without cancelling the agent turn. Click **Retrieve saved state**. If the turn is still active, wait and refresh. If it completed, the app displays the saved answer and does not offer a retry.
4. Open **View code** to read the four explained snippets and try their **Viva voice · Read aloud** buttons.

A genuine API failure or failed turn may also appear during a normal run. The simulated API error, turn failure, and disconnect options exist so the lesson has repeatable cases. The turn-failure simulation is local and creates no remote session. The saved-state panel shows the first page of up to 100 message items and the 20 most recent root turns; it labels when more items exist.

## Code map

| File | Role |
| --- | --- |
| `server/lab4.ts` | `runLab4` runs a turn or a simulation, `cancelLab4` requests cancellation, `recoverLab4` retrieves session, turn, and item state. |
| `server/index.ts` | Routes Lab 04 requests to the server module. |
| `src/Lab4.tsx` | Shows the run, recovery panel, retry rules, code snippets, and Viva voice controls. |
| `src/App.tsx` | Adds Lab 04 navigation. |
| `src/styles.css` | Styles the workspace, recovery panel, and responsive layout. |

See [OpenAI Docs: Events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events) for turn outcomes and disconnect recovery, and [Manage sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage) for retrieving session state.
