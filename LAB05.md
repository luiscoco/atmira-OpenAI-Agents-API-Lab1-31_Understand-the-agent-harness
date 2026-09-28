# Lab 05 — Manage sessions

Lab 05 builds on [Lab 04](LAB04.md). Browse sessions in the configured OpenAI project, retrieve the current state of one session, and delete a session after reviewing its ID.

## Learning goals

1. List sessions in pages rather than assuming the first response contains every session.
2. Retrieve one session to inspect its current status, agent, model, environment, and required action count.
3. Decide when a session ID should be retained for a follow-up and when a session can be deleted.
4. Verify that deletion removes the session from the API history.

## Run on Windows

Use Node.js 22 or newer. Run `npm ci`, set your own `OPENAI_API_KEY` in the environment or a private `.env` file, and run `npm run dev`. Open <http://localhost:5173> and choose **Manage sessions**. The browser never receives the API key.

## How it was built — step by step

The server module `server/lab5.ts` exposes three routes: `GET /api/lab5/sessions` (list), `GET /api/lab5/session` (retrieve), and `DELETE /api/lab5/session` (delete).

### 1. Validate every session ID on the server

```ts
// server/lab5.ts
const sessionIdPattern = /^sess_[A-Za-z0-9_-]+$/;

function validId(id) {
  return typeof id === 'string' && id.length <= 200 && sessionIdPattern.test(id);
}
```

**Why:** Session IDs arrive from the browser in query strings and request bodies, so they are untrusted input. Every route checks the ID's shape before it calls OpenAI. That applies to the pagination cursor as well, because the cursor is also a session ID.

### 2. Reduce each session to the fields the page needs

```ts
// server/lab5.ts
function summary(session) {
  return {
    id: session.id,
    status: session.status,
    createdAt: session.created_at,
    lastActiveAt: session.last_active_at,
    agentName: session.agent?.name || 'Inline agent',
    model: session.agent?.model || 'Unknown',
    environment: session.environment?.type || 'Unknown',
    requiredActions: session.required_actions?.length || 0,
  };
}
```

**Why:** A session object carries much more than a history row needs. The server sends a small, predictable shape instead of the raw API object. That keeps responses small and avoids forwarding fields the page never uses. An inline agent (Labs 01–04) has no saved name, so it is labelled **Inline agent**.

### 3. List sessions one page at a time

```ts
// server/lab5.ts, listLab5
const after = new URL(request.url, 'http://localhost').searchParams.get('after');
if (after && !validId(after)) return sendJson(response, 400, { error: 'Invalid page cursor.' });
const page = await client().beta.agents.sessions.list({ limit: 20, order: 'desc', ...(after ? { after } : {}) });
sendJson(response, 200, {
  sessions: page.data.map(summary),
  nextCursor: page.has_more ? page.data.at(-1)?.id || null : null,
});
```

**Why:** A project can hold many sessions, so the API returns them in pages. This route asks for 20 at a time, newest first. When `has_more` is true, the ID of the last session on the page becomes the cursor for the next request (`after`). The page shows **Load more sessions** only when a cursor exists.

```tsx
// src/Lab5.tsx
async function loadSessions(after = '', append = false) {
  const requestId = ++requestRef.current;
  const result = await getJson('/api/lab5/sessions' + (after ? '?after=' + encodeURIComponent(after) : ''));
  if (requestId !== requestRef.current) return;   // a newer request replaced this one
  setSessions((previous) => append
    ? [...previous, ...result.sessions.filter((item) => !previous.some((old) => old.id === item.id))]
    : result.sessions);
  setNextCursor(result.nextCursor);
}
```

**Why:** Loading more **appends** a page, and **Refresh** replaces the list. A request counter ignores late responses from an older request, so a slow page cannot overwrite a newer one. Duplicate IDs are filtered out, because the list can shift if a session is created between two page requests.

### 4. Retrieve one session for the detail panel

```ts
// server/lab5.ts, retrieveLab5
const session = await client().beta.agents.sessions.retrieve(id);
sendJson(response, 200, { session: {
  ...summary(session),
  instructions: session.agent?.instructions || null,
  error: session.error || null,
  metadata: session.metadata || {},
} });
```

**Why:** A list row is a snapshot taken when the page was loaded, so it can go stale. Selecting a row retrieves the session again and shows its **current** status, together with its instructions, any error, and its metadata. Comparing the list status with the retrieved status is one of the exercises.

### 5. Delete only after confirming the exact ID

```ts
// server/lab5.ts, deleteLab5
if (!validId(body?.sessionId)) return sendJson(response, 400, { error: 'Invalid session ID.' });
const result = await client().beta.agents.sessions.delete(body.sessionId);
if (!result.deleted) throw new Error('The API did not confirm deletion.');
sendJson(response, 200, { id: body.sessionId, deleted: true });
```

```tsx
// src/Lab5.tsx, deleteSession
await getJson('/api/lab5/session', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: deleteTarget }),
});
setNotice(`Deleted ${deleteTarget} from the Agents API.`);
setSelected(null);
setDeleteTarget('');
await loadSessions('', false);
```

**Why:** Deleting cannot be undone. **Delete session…** only stores a `deleteTarget` and shows the exact ID with **Yes, delete session**. The request is sent only after that second click. The server reports success only when the API confirms `deleted: true`. The page then reloads the history from the first page, so students can see the session is gone.

### 6. Explain what to retain

The **What should you retain?** panel gives four rules. Keep a session ID while the user may continue the conversation. Review a session before deleting it if it is active or waiting for an action. Delete sessions you no longer need, following your own retention policy. In production, authenticate users and check who owns each session on the server. **View code** holds four explained snippets, each with a **Viva voice · Read aloud** button.

## Exercises

1. In Lab 02, create two separate conversations. Open Lab 05 and select **Refresh**. Find both IDs in **Recent sessions**.
2. Select one ID. Compare its list status with the retrieved status and note its model, environment, and last active time. A list row can become stale until refreshed.
3. If **Load more sessions** appears, click it. Explain why the request passes the last ID from the previous page as `after`.
4. Select a disposable session and click **Delete session…**. Verify the exact ID, then choose **Yes, delete session**. Confirm it disappears from the refreshed history. Keep a session that you still need for a follow-up.
5. Open **View code**. Read the four snippets and their explanations. Each has a **Viva voice · Read aloud** button that uses browser speech synthesis and makes no audio API call.

Deletion removes a session from the public API; physical cleanup may continue asynchronously. This course app has no user accounts and shows the configured project's sessions. A production application must authenticate users and check ownership before listing, retrieving, or deleting their sessions (Lab 45).

## Code map

| File | Role |
| --- | --- |
| `server/lab5.ts` | Validates IDs, lists paginated sessions, retrieves selected fields, and deletes a session. |
| `server/index.ts` | Routes Lab 05 API requests. |
| `src/Lab5.tsx` | Renders history, details, confirmation, teaching snippets, and Viva voice controls. |
| `src/App.tsx` | Adds Lab 05 navigation. |
| `src/styles.css` | Styles the history and detail panels for desktop and mobile. |

See [OpenAI Docs: Manage sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage) for the list, retrieve, and delete API calls.
