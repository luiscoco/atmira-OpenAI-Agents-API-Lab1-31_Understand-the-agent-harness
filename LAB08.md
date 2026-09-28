# Lab 08 — Override one session

Lab 08 builds on [Lab 07](LAB07.md). Start two new sessions from one saved agent. The baseline inherits its configuration; the second session adds an instruction without updating the saved agent.

## Learning goals

1. Use `agent_id` alone to create a baseline session.
2. Add `agent: { instructions }` beside `agent_id` for one session. These instructions append to the saved base instructions.
3. Compare two separate session IDs and the resulting answers to the same question.
4. Retrieve the saved agent again to verify its name, model, and instructions are unchanged.

## Run the lab

Run `npm ci`, set `OPENAI_API_KEY` in a private `.env` file, and run `npm run dev`. In Lab 07, save a tutor preset. Open **Override one session** under **TypeScript & Configuration**. Lab 08 reads the Lab 07 agent ID from local storage and retrieves the preset from the server.

## How it was built — step by step

### 1. Load the Lab 07 preset instead of creating a new one

```tsx
// src/Lab8.tsx
const savedId = localStorage.getItem(storageKey);   // the same key Lab 07 writes
const { agent } = await getJson<{ agent: SavedAgent }>(
  '/api/lab7/agent?agentId=' + encodeURIComponent(savedId)
);
```

**Why:** Lab 08 needs an existing saved agent, so it reads the ID Lab 07 stored and retrieves the preset through Lab 07's route. The retrieved agent is also the **snapshot** that step 4 compares against. If no preset exists, the page asks the student to create one in Lab 07 first.

### 2. Accept a mode and validate the override

```ts
// server/lab8.ts, runLab8
const mode = body.mode;
const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
if (typeof agentId !== 'string' || agentId.length > 200 || !agentIdPattern.test(agentId)) {
  return sendJson(response, 400, { error: 'Invalid agent ID.' });
}
if (mode !== 'baseline' && mode !== 'override') return sendJson(response, 400, { error: 'Choose baseline or override.' });
if (mode === 'override' && (!instructions || instructions.length > 4000)) {
  return sendJson(response, 400, { error: 'Override instructions must be between 1 and 4,000 characters.' });
}
```

**Why:** One route, `POST /api/lab8/run`, serves both runs. The explicit `mode` makes the difference between the two requests visible in the code. The override text is required, and limited in length, only in override mode.

### 3. Add the override beside `agent_id`

```ts
// server/lab8.ts
stream = await client().beta.agents.sessions.create({
  agent_id: agentId,
  ...(mode === 'override' ? { agent: { instructions } } : {}),
  environment: { type: 'none' },
  input: prompt,
  stream: true,
});
```

**Why:** This one line is the lesson. The baseline sends only `agent_id`, so the session inherits the saved configuration. The override sends `agent_id` **and** an `agent` object with extra instructions. Those instructions are added to the saved agent's instructions **for this session only**. The saved agent is never updated, and other sessions are not affected. The conditional spread adds the `agent` field only in override mode, so the baseline request contains no `agent` key at all.

### 4. Run both sessions into separate result slots

```tsx
// src/Lab8.tsx, run(mode)
await streamSession(agent.id, question, mode, override, (event) => {
  setResults((previous) => {
    const current = previous[mode];
    if (event.type === 'session') return { ...previous, [mode]: { ...current, id: event.sessionId } };
    if (event.type === 'text') return { ...previous, [mode]: { ...current, answer: event.text, status: 'Streaming answer' } };
    if (event.type === 'complete') return { ...previous, [mode]: { ...current, status: 'Completed' } };
    return previous;
  });
});
```

**Why:** The same pattern as Lab 07's two slots, keyed by mode this time. Both runs use the same question, so any difference comes from the override. Editing the question or the extra instruction clears both results, so a comparison never mixes two different inputs.

### 5. Verify that the saved agent did not change

```tsx
// src/Lab8.tsx, verify
const { agent: after } = await getJson<{ agent: SavedAgent }>('/api/lab7/agent?agentId=' + encodeURIComponent(agent.id));
setVerification(after.id === agent.id && after.name === agent.name && after.model === agent.model && after.instructions === agent.instructions
  ? 'unchanged' : 'changed');
```

**Why:** Answer wording is weak evidence, because model output varies. The strong evidence is configuration: retrieve the saved agent **after** both runs and compare every saved field with the snapshot from before. **Unchanged** proves the override stayed inside its session.

### 6. Teach the code

**View code** holds four snippets: load the preset, the baseline request, the override request, and the verification. Each has a **Viva voice · Read aloud** button.

## Exercise

1. Review the saved agent ID and base instructions. Enter one question for both sessions.
2. Keep or edit the additional instruction. For a clear comparison, request Spanish in the override while the saved preset has no language instruction.
3. Select **Run baseline**, then **Run override**. The app creates two fresh sessions with the same `agent_id` and displays their separate session IDs.
4. Select **Verify saved preset**. The server retrieves the agent again; the app compares its saved ID, name, model, and instructions with the snapshot loaded before the runs.
5. Open **View code** to inspect four snippets and their explanations. Use **Viva voice · Read aloud** to hear each explanation through browser speech synthesis. This does not call an audio API.
6. Change the extra instruction and repeat. Editing either input resets the displayed comparison so both results refer to the same question and instruction.

Model output is variable; answer wording alone does not prove an override. The request fields and retrieval of the saved preset are the configuration evidence. The local course app has no user accounts; a multi-user version would authorize access to saved agent IDs and sessions on the server.

## Code map

| File | Role |
| --- | --- |
| `server/lab8.ts` | Validates inputs and streams a baseline or overridden session. |
| `server/index.ts` | Routes `POST /api/lab8/run`. Retrieval reuses `GET /api/lab7/agent`. |
| `src/Lab8.tsx` | Loads the Lab 07 preset, compares sessions, verifies the saved fields, and presents the teaching section with Viva voice. |
| `src/App.tsx` | Adds Lab 08 navigation. |
| `src/styles.css` | Styles the comparison and lesson. |

See [OpenAI Docs: Configuring Agents](https://developers.openai.com/api/docs/guides/agents-api/configuration) for session-specific overrides.
