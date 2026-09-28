# Lab 07 — Save and reuse an agent

Lab 07 builds on [Lab 06](LAB06.md). Create a named programming tutor once, then use its saved `agent_id` to start two independent sessions. The browser stores only the agent ID; the server keeps the API key private.

## Learning goals

1. Create a reusable agent with a name, model, and instructions.
2. Retrieve that agent by ID after returning to the page.
3. Start two new sessions with the same `agent_id` and compare their different session IDs.
4. Explain the difference between shared configuration and separate conversation histories.

## Run the lab

Run `npm ci`, set `OPENAI_API_KEY` in a private `.env` file, and run `npm run dev`. Open <http://localhost:5173> and select **Save and reuse an agent** under **TypeScript & Configuration**. The server uses `OPENAI_MODEL` when set, otherwise its configured default.

## How it was built — step by step

`server/lab7.ts` adds three routes: `POST /api/lab7/agent` (create), `GET /api/lab7/agent` (retrieve), and `POST /api/lab7/run` (start a session from the saved agent).

### 1. Create a saved agent on the server

```ts
// server/lab7.ts, createLab7Agent
const name = typeof body.name === 'string' ? body.name.trim() : '';
const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
if (!name || name.length > 80) return sendJson(response, 400, { error: 'Name must be between 1 and 80 characters.' });
if (!instructions || instructions.length > 4000) return sendJson(response, 400, { error: 'Instructions must be between 1 and 4,000 characters.' });
const agent = await client().beta.agents.create({ name, model, instructions });
sendJson(response, 201, { agent: summary(agent) });
```

```ts
// server/index.ts
if (path === '/api/lab7/agent' && request.method === 'POST') {
  await createLab7Agent(request, response, agent.model);
  return;
}
```

**Why:** Until now, every session carried its own inline configuration (`agent: { model, instructions }`). `agents.create` saves that configuration once, under a name, and returns an `agent_…` ID. The browser chooses only the name and instructions. The **model** comes from the server (`OPENAI_MODEL` or its default), so a page cannot pick a model the project has not approved. The response is trimmed by `summary()` to the ID, name, model, and instructions.

### 2. Validate agent IDs like session IDs

```ts
// server/lab7.ts
const agentIdPattern = /^agent_[A-Za-z0-9_-]+$/;

function validAgentId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && agentIdPattern.test(value);
}
```

**Why:** An agent ID arrives from the browser (from local storage), so it is untrusted input. The function is also a TypeScript **type guard** (`value is string`): after `validAgentId(body.agentId)` returns true, TypeScript treats `body.agentId` as a `string`, with no cast needed.

### 3. Start a new session from the saved agent

```ts
// server/lab7.ts, runLab7
stream = await client().beta.agents.sessions.create({
  agent_id: body.agentId,
  environment: { type: 'none' },
  input: prompt,
  stream: true,
});
```

**Why:** This is the only real change from Lab 01. `agent_id` replaces the inline `agent` object. The session takes the saved agent's model and instructions, but it gets its **own** session ID, conversation history, and turns. Two sessions created from one agent share configuration, not context. The streaming loop that follows is the same pattern as Labs 01–04.

### 4. Remember the agent ID in the browser, and re-read it from the API

```tsx
// src/Lab7.tsx
const storageKey = 'agents-api-lab7-agent-id';

// after a successful save
localStorage.setItem(storageKey, result.agent.id);

// when the lab first becomes active
const savedId = localStorage.getItem(storageKey);
if (!savedId) return;
getJson<{ agent: SavedAgent }>('/api/lab7/agent?agentId=' + encodeURIComponent(savedId))
  .then((result) => { setAgent(result.agent); setName(result.agent.name); setInstructions(result.agent.instructions); });
```

```ts
// server/lab7.ts, retrieveLab7Agent
const agent = await client().beta.agents.retrieve(agentId);
sendJson(response, 200, { agent: summary(agent) });
```

**Why:** Local storage keeps only the ID, which is not a secret. The configuration itself is always read back from the API with `agents.retrieve`, so the page shows what is really saved, not a stale copy. A deleted or unknown agent returns `404`, which the page reports. The load runs once, the first time the lab becomes active (`loadedRef`).

### 5. Run two sessions and compare their IDs

```tsx
// src/Lab7.tsx, runSession
await streamSavedAgent(agent.id, nextPrompt, (event) => {
  setSessions((previous) => {
    const current = previous[slot];
    if (event.type === 'session') return { ...previous, [slot]: { ...current, id: event.sessionId } };
    if (event.type === 'text') return { ...previous, [slot]: { ...current, answer: event.text, status: 'Streaming answer' } };
    if (event.type === 'complete') return { ...previous, [slot]: { ...current, status: 'Completed' } };
    return previous;
  });
});

const separateSessions = Boolean(sessions.A.id && sessions.B.id && sessions.A.id !== sessions.B.id);
```

**Why:** The page keeps two slots, **Session A** and **Session B**, in one state object keyed by slot. Both send the same agent ID and the same question. The evidence panel checks `separateSessions`: two different session IDs from one agent ID prove that configuration is shared while conversations are separate. `streamSavedAgent` validates each line with Lab 06's `parseRunEvent`.

### 6. Save as a new preset instead of editing

**Why:** **Save as a new preset** calls `agents.create` again and stores the new ID. The first saved agent is not modified, and sessions already created from it keep the configuration they started with. This lab creates presets but does not delete them.

**View code** holds four explained snippets, each with a **Viva voice · Read aloud** button that uses browser speech synthesis.

## Exercise

1. Review the tutor's name and instructions, then select **Save tutor preset**. Record the returned agent ID.
2. Ask the same question in **Session A** and **Session B**. Both runs use the saved agent ID, but each creates a fresh session.
3. Compare the two session IDs. They should differ. The answers may also differ because model output can vary.
4. Reload the page. The browser reads the saved agent ID from local storage and the server retrieves its current configuration from the API.
5. Open **View code**. Read the four explained snippets and use **Viva voice · Read aloud** to hear each explanation through browser speech synthesis. No audio API call is made.
6. Change the instructions and choose **Save as a new preset**. This creates a second saved agent; it does not modify the first. Repeat the two-session comparison.

The local course app has no user accounts. In a multi-user app, the server must authenticate users and authorize access to saved agent IDs and session IDs. This lab intentionally creates presets but does not delete them; manage project resources according to your own retention policy.

## Code map

| File | Role |
| --- | --- |
| `server/lab7.ts` | Validates requests, creates and retrieves saved agents, and streams new sessions using `agent_id`. |
| `server/index.ts` | Routes the Lab 07 API calls and passes the server's model to `createLab7Agent`. |
| `src/Lab7.tsx` | Renders the preset form, two sessions, comparison evidence, snippets, and Viva voice controls. |
| `src/App.tsx` | Adds Lab 07 to desktop and mobile navigation. |
| `src/styles.css` | Styles white cards, session results, and code blocks. |

See [OpenAI Docs: Configuring Agents](https://developers.openai.com/api/docs/guides/agents-api/configuration) for saved-agent reuse. A saved agent supplies configuration; each session has its own conversation and work.
