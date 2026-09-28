# Lab 01 — Create your first agent

Lab 01 builds a small programming tutor. A student enters a question in React, the Node server creates a new Agents API session, and the answer appears as it streams back. Each submission starts a **new** session; continuing a conversation is introduced in Lab 02.

This walkthrough follows the current TypeScript files. The same design was used when Lab 01 was first built in JavaScript; Lab 06 later changed the source files to `.ts` and `.tsx`.

## How it was built — step by step

Follow the six steps below to build the tutor from server setup to React rendering. Each code excerpt is followed by its purpose and the behavior students should observe.

### 1. Prepare the app and keep the key on the server

The app has a React page in `src/Lab1.tsx` and a Node server in `server/index.ts`. Install dependencies with `npm ci`, put `OPENAI_API_KEY` in a private `.env` file, and start the app with `npm run dev`. Open <http://localhost:5173> and choose **Create your first agent**. Set `OPENAI_MODEL` in `.env` if the default model is unavailable to your project.

The server loads `.env` and reports whether a key is configured. The browser calls the local API route; it never needs the key.

```ts
// server/env.ts
const envPath = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

// server/index.ts imports './env.ts' before initializing lab modules.
// OpenAI clients are constructed on the server.
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

**Why:** An API key is a server credential. Keeping the OpenAI client in Node prevents the browser bundle from containing the key. The app checks for a missing or placeholder key before it starts a run and returns a setup message.

### 2. Define the tutor

```ts
// server/index.ts
const agent = {
  model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
  instructions:
    'You are a friendly programming tutor. Answer clearly and concisely. ' +
    'When useful, include one short example. If you are unsure, say so.',
};
```

**Why:** `model` selects the model configured for the run. `instructions` define the tutor's role and answer style. The model can be changed without editing source by setting `OPENAI_MODEL`. The lab's challenge asks students to edit the instructions and compare answers to the same question.

### 3. Connect the question form to the server

```tsx
// src/Lab1.tsx
async function runAgent(prompt, onEvent) {
  const response = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  // Read the streaming response below.
}
```

```ts
// server/index.ts
if (path === '/api/run' && request.method === 'POST') {
  await handleRun(request, response);
  return;
}
```

**Why:** The browser sends only the student's prompt to the local server. The server trims it and requires 1–2,000 characters before calling OpenAI. This validation handles requests sent outside the React form too. The Lab 01 route calls `handleRun` without a saved session ID, so each question starts fresh.

### 4. Create a session and stream the first turn

```ts
// server/index.ts, inside handleRun
stream = await client.beta.agents.sessions.create({
  agent,
  environment: { type: 'none' },
  input: prompt,
  stream: true,
});
```

**Why:** A session holds the agent's configuration and work. `input` starts its first turn. `environment: { type: 'none' }` fits this question answering tutor because it does not use files or shell commands. `stream: true` returns events while the turn runs, so the UI can show an answer before the turn ends. The server uses the OpenAI JavaScript SDK's managed Agents API (`client.beta.agents`).

### 5. Turn API events into a small browser stream

```ts
// server/index.ts, inside handleRun
const parts = new Map();
const partKey = (event) =>
  `${event.item_id}:${event.output_index}:${event.content_index}`;

for await (const event of stream) {
  if (event.type === 'agent.session.turn.output_text.delta') {
    const key = partKey(event);
    parts.set(key, (parts.get(key) || '') + event.delta);
    writeEvent(response, { type: 'text', text: [...parts.values()].join('\n') });
  } else if (event.type === 'agent.session.turn.output_text.done') {
    parts.set(partKey(event), event.text);
    writeEvent(response, { type: 'text', text: [...parts.values()].join('\n') });
  } else if (event.type === 'agent.session.turn.completed'
      && event.turn?.subagent_id == null) {
    writeEvent(response, { type: 'complete' });
    break;
  }
}
```

**Why:** The Agents API can emit many event types. Lab 01 forwards a simpler newline-delimited JSON stream: `status`, `text`, `complete`, or `error`. Deltas are pieces of text. The map keeps each output content part separate, and a `done` event replaces that part with its final text. The root turn's `completed` event is the success signal; merely closing the stream is not success. The full handler also reports failed and cancelled turns as errors and aborts the SDK stream during cleanup.

### 6. Read the stream and update React

```tsx
// src/Lab1.tsx, inside runAgent
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let complete = false;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop(); // Keep an unfinished JSON line for the next chunk.
  for (const line of lines) {
    if (!line) continue;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'complete') complete = true;
    onEvent(event);
  }
}
if (!complete) throw new Error('The stream ended before the agent completed its turn.');
```

**Why:** Network chunks do not necessarily end on a JSON line boundary. The buffer preserves an incomplete line until more bytes arrive. The browser checks for `complete` and shows an error if the stream ends early. Lab 06 adds explicit runtime validation of these parsed events.

The submit handler clears the previous answer, marks the run as active, then updates React state for each browser event:

```tsx
// src/Lab1.tsx, inside submit
await runAgent(nextPrompt, (item) => {
  if (item.type === 'status') setMessage(item.label);
  if (item.type === 'text') {
    setAnswer(item.text);
    setMessage('Streaming response');
  }
  if (item.type === 'complete') setMessage('Turn completed');
});
setStatus('complete');
```

The response panel renders `answer` with `ReactMarkdown` and `remarkGfm`. The page also shows the question, run state, and an error message if a request fails. The **Under the hood** section has four shorter teaching snippets with Viva voice read aloud buttons powered by browser speech synthesis.

## Check your result

1. Ask one of the example programming questions. Confirm the answer grows while the run is active and the page ends in **Complete**.
2. Submit another question. It starts a new session, so do not expect it to remember the first answer.
3. Temporarily remove or invalidate `OPENAI_API_KEY`, restart the server, and submit again. The page should show the setup error instead of an answer. Restore the key afterward.
4. Open **Under the hood**, read the four snippets, and try their Viva voice controls.
5. Change the tutor instructions in `server/index.ts`, restart, and ask the same question again. Compare the two answers.

See [OpenAI Docs: Agents API quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart) and [Events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events) for the underlying session and event concepts.
