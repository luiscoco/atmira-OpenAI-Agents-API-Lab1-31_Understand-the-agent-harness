# Lab 09 — Compare models and reasoning settings

Lab 09 builds on [Lab 07](LAB07.md) and [Lab 08](LAB08.md). It uses one saved tutor agent to start two independent sessions with identical prompts. After each setup turn, the baseline keeps its inherited configuration; the updated session changes its model and reasoning effort before the same follow-up question.

## Learning goals

1. Explain that a saved agent supplies initial session settings and that `sessions.update` affects subsequent turns in one existing session.
2. Change `model` and `reasoning.effort` together when needed. A `null` effort requests the selected model's default.
3. Compare the resulting answers with a consistent human quality score, measured follow-up latency, and best-effort token usage.
4. Record the effective settings and session and turn IDs as evidence. Recognize that one run is insufficient to establish a general model ranking.

## Run the lab

Run `npm ci`, set `OPENAI_API_KEY` in a private `.env` file, and start the app with `npm run dev`. Save a tutor preset in Lab 07, then open **Compare models & reasoning** in the sidebar. The model must be available to your project, and supported reasoning efforts vary by model. The API reports an incompatible setting as an error.

## How it was built — step by step

Everything happens in one request to `POST /api/lab9/run` (`server/lab9.ts`): a setup turn, an optional update, and a measured follow-up.

### 1. Validate the model name and the effort

```ts
// server/lab9.ts
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const efforts = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = typeof efforts[number];

if (mode !== 'baseline' && mode !== 'updated') return sendJson(response, 400, { error: 'Choose baseline or updated.' });
if (mode === 'updated' && (!modelPattern.test(model) || !efforts.includes(effort as Effort))) {
  return sendJson(response, 400, { error: 'Enter a valid model and reasoning effort.' });
}
```

**Why:** The model name is free text typed by the student, so the server checks its shape before sending it. The effort must be one of a fixed list, and `as const` turns that list into a TypeScript union type (`Effort`). `'default'` is the page's own option, meaning "let the model decide". Which efforts a model supports varies, so the API has the final word and reports an unsupported combination as an error.

### 2. Run a setup turn from the saved agent

```ts
// server/lab9.ts
const first = await api.beta.agents.sessions.create({ agent_id: agentId, environment: { type: 'none' }, input: setupPrompt, stream: true });
try {
  for await (const event of first) {
    const eventSessionId = event.type === 'agent.session.created' ? event.session.id : 'session_id' in event ? event.session_id : '';
    if (!sessionId && eventSessionId) { sessionId = eventSessionId; writeEvent(response, { type: 'session', sessionId }); }
    if (event.type === 'agent.session.turn.completed' && event.turn?.subagent_id == null) { firstCompleted = true; break; }
    // …failed, cancelled, and error events throw
  }
} finally { first.controller.abort(); }
```

**Why:** `sessions.update` changes an **existing** session's settings for its **later** turns. So each run first needs a session with one completed turn. Both the baseline and the updated run execute the same setup turn, which keeps the conversations comparable. Its answer is not measured.

### 3. Update one session, or read the baseline's settings

```ts
// server/lab9.ts
if (mode === 'updated') {
  const updated = await api.beta.agents.sessions.update(sessionId, {
    agent: { model, reasoning: { effort: effort === 'default' ? null : effort as Exclude<Effort, 'default'> } },
  });
  effectiveModel = updated.agent.model;
  effectiveEffort = updated.agent.reasoning?.effort ?? null;
} else {
  const baseline = await api.beta.agents.sessions.retrieve(sessionId);
  effectiveModel = baseline.agent.model;
  effectiveEffort = baseline.agent.reasoning?.effort ?? null;
}
writeEvent(response, { type: 'configuration', model: effectiveModel, effort: effectiveEffort });
```

**Why:** This is the core of the lab. `sessions.update` changes the model and reasoning effort of **this session only**. The saved agent is untouched, and the change applies to the next turn. `null` asks for the model's default effort. The page does not show what it **asked** for. It shows the **effective** settings the API returns, for the updated run from the update's response and for the baseline from `retrieve`. The worksheet records those values as evidence.

### 4. Time the follow-up turn only

```ts
// server/lab9.ts
// Subscribe before sending input so the response's first events are not missed.
stream = await api.beta.agents.sessions.events.stream(sessionId);
const started = performance.now();
await api.beta.agents.sessions.events.create(sessionId, {
  events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: question }] }] }],
});
// …
} else if (event.type === 'agent.session.turn.completed' && event.turn?.subagent_id == null) {
  writeEvent(response, {
    type: 'complete', durationMs: Math.round(performance.now() - started), turnId: event.turn.id,
    inputTokens: event.turn.usage?.input_tokens ?? null,
    outputTokens: event.turn.usage?.output_tokens ?? null,
  });
}
```

**Why:** The timer starts just before the follow-up is sent and stops when its root turn completes. The setup turn and the update are not included, so the number compares the two configurations on the same question. It still includes network and server waiting time. Token usage is **best effort**. `?? null` keeps a missing count as `null`, and the page shows it as **unknown**, never 0. Lab 15 builds a full run summary on this rule.

### 5. Score and export a worksheet

```tsx
// src/Lab9.tsx
function csvCell(value: string | number | null) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

const csv = rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\r\n');
const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
const link = document.createElement('a'); link.href = url; link.download = 'lab09-comparison.csv'; link.click(); URL.revokeObjectURL(url);
```

**Why:** Numbers alone do not say which answer was better. The worksheet asks for a 1–5 score on one rubric (accuracy, clarity, usefulness) and written notes for each run. The CSV holds the agent, session, and turn IDs, the effective settings, the time, the tokens, and the scores, so the comparison can be handed in and repeated. Every cell is quoted and inner quotes are doubled, so notes containing commas or quotes do not break the file.

### 6. Teach the code

**View code** holds four snippets: the setup turn, the session update, the measured follow-up, and filling the worksheet. Each has a **Viva voice · Read aloud** button.

## Exercise

1. Keep the two shared prompts identical. The first is a setup turn in each new session. The second is the follow-up whose answer and time you compare.
2. Choose the model and effort for the updated run. To isolate reasoning effort, keep the saved model name and change only effort. To study a model switch, enter another supported model and choose **Model default** initially.
3. Run the baseline and updated configurations. Each run creates its own session, completes the setup turn, and then sends the follow-up. The updated run calls `sessions.update` between turns.
4. Inspect the effective model and effort, session and measured turn IDs, answer, elapsed time, and available input and output tokens. A missing token count displays **unknown**.
5. Score both answers from 1 to 5 using the same accuracy, clarity, and usefulness rubric. Record concrete evidence in the notes fields and download the CSV worksheet.
6. Open **View code** for four snippets and explanations. **Viva voice · Read aloud** speaks the explanations through browser speech synthesis; it does not call an audio API.

The timer begins immediately before the follow-up input request and ends when the root turn completes. It excludes the setup turn and configuration update, but includes network and server waiting time. Outputs can vary between identical runs. Repeat a pair before drawing a strong conclusion about latency or quality. A failed update leaves the baseline usable and shows the API error rather than a fabricated result.

## Code map

| File | Role |
| --- | --- |
| `server/lab9.ts` | Validates inputs, creates and completes a setup turn, updates one session, streams the follow-up, and reports metrics. |
| `server/index.ts` | Routes `POST /api/lab9/run`. |
| `src/Lab9.tsx` | Runs the comparison, renders the worksheet, exports CSV, and teaches the code with Viva voice. |
| `src/App.tsx` | Adds desktop and mobile Lab 09 navigation. |
| `src/styles.css` | Styles the inputs, results, and worksheet. |

See [OpenAI Docs: Configuring Agents](https://developers.openai.com/api/docs/guides/agents-api/configuration) for the rules on updating one session and [Run and continue sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions) for follow-up turns.
