# Lab 02 — Continue and customize

Lab 02 builds on [Lab 01](LAB01.md). Students ask follow-up questions in one Agents API session, then start a new session with different agent instructions. Both lessons are available from the React sidebar: **Continue a conversation** and **Customize instructions**.

## Learning goals

1. Distinguish a session from a turn.
2. Reuse a session ID for a follow-up message.
3. Open the event stream before submitting the next message.
4. Explain why editing instructions requires a new session.
5. Compare answers from different instruction sets.

## Run on Windows

Open PowerShell or Windows Terminal in this directory:

```powershell
npm ci
Copy-Item .env.example .env
notepad .env
npm run dev
```

Put your own API key in `.env` and open <http://localhost:5173>. Select either Lab 02 item in the sidebar. If `.env` already exists, keep it and run `npm run dev` directly.

## How it was built — step by step

Lab 02 reuses Lab 01's run handler in `server/index.ts`. The same `handleRun` function serves `/api/run` (Lab 01), `/api/lab2/run` (Lab 02), and `/api/lab3/run` (Lab 03), and two flags switch on the extra behaviour.

### 1. Add a route and accept a session ID and instructions

```ts
// server/index.ts
if (path === '/api/lab2/run' && request.method === 'POST') {
  await handleRun(request, response, true);   // lab2 = true
  return;
}

// inside handleRun
if (lab2) {
  sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
}
if (lab2 && sessionId && (sessionId.length > 200 || !/^sess_[A-Za-z0-9_-]+$/.test(sessionId))) {
  sendJson(response, 400, { error: 'Invalid session ID.' });
  return;
}
if (lab2 && !sessionId && (!instructions || instructions.length > 4000)) {
  sendJson(response, 400, { error: 'Instructions must be between 1 and 4,000 characters.' });
  return;
}
```

**Why:** The browser now sends three fields: the prompt, the session ID it saved (empty for a new conversation), and the instructions it wants. The server checks each one before calling OpenAI. A session ID must look like `sess_…`, so a malformed value never reaches the API. Instructions are required only when a **new** session is created, because an existing session keeps the instructions it started with.

### 2. Start a session with the chosen instructions

```ts
// server/index.ts, inside handleRun
writeEvent(response, { type: 'status', label: 'Starting agent session' });
stream = await client.beta.agents.sessions.create({
  agent: lab2 ? { ...agent, instructions } : agent,
  environment: { type: 'none' },
  input: prompt,
  stream: true,
});
```

**Why:** This is the Lab 01 call with one change: the agent's `instructions` come from the editor instead of the server's default. The spread keeps the configured model and replaces only the instructions. The first question creates the session and runs turn 1.

### 3. Send the session ID to the browser

```ts
// server/index.ts, inside the event loop
if (lab2 && !sessionSent && event.session_id) {
  sessionId = event.session_id;
  sessionSent = true;
  writeEvent(response, { type: 'session', sessionId });
}
// …after the loop
if (lab2 && completed && !sessionSent) throw new Error('The session finished without a session ID.');
```

**Why:** The session ID is the handle for every later request, so it is forwarded as its own `session` event as soon as the stream reveals it. If a turn completes without the server ever seeing an ID, that is reported as an error, because a follow-up would otherwise silently create a different session.

### 4. Continue the same session: open the stream first, then send

```ts
// server/index.ts, inside handleRun
if (lab2 && sessionId) {
  writeEvent(response, { type: 'session', sessionId });
  sessionSent = true;
  writeEvent(response, { type: 'status', label: 'Continuing the same session' });
  // Open the event stream before sending input so the first events are captured.
  stream = await client.beta.agents.sessions.events.stream(sessionId);
  await client.beta.agents.sessions.events.create(sessionId, {
    events: [{
      type: 'agent.session.input.message',
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    }],
  });
}
```

**Why:** A follow-up is an **input event** sent to an existing session, not a new session. `events.create` starts another turn in the same session, so the agent can use the earlier conversation as context. The order matters: the server opens `events.stream` first and sends the message second. If it sent first, the earliest events of the new turn could be emitted before anyone was listening. The same event loop from Lab 01 then reads the answer. See [OpenAI Docs: sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions).

### 5. Keep the session ID in React and send it with each question

```tsx
// src/Lab2.tsx, inside submit
const currentSessionId = sessionRef.current;
setMessages((previous) => [
  ...previous,
  { id: crypto.randomUUID(), role: 'user', text: nextPrompt },
  { id: replyId, role: 'assistant', text: '', pending: true },
]);
await runTurn({ prompt: nextPrompt, sessionId: currentSessionId, instructions: activeInstructions }, (item) => {
  if (item.type === 'session') {
    sessionRef.current = item.sessionId;
    setSessionId(item.sessionId);
  }
  if (item.type === 'text') setMessages((previous) => previous.map((message) =>
    message.id === replyId ? { ...message, text: item.text } : message));
});
```

**Why:** The page keeps the session ID in two places. The ref gives the submit handler the current value immediately, and the state shows it on screen. Each question adds a user message and an empty assistant placeholder, and streamed text fills the placeholder by its ID. The turn count shown above the conversation is the number of user messages. `runTurn` reads the newline-delimited JSON stream exactly like Lab 01's `runAgent`.

### 6. Apply new instructions by starting a new conversation

```tsx
// src/Lab2.tsx
function newConversation() {
  sessionRef.current = '';
  setSessionId('');
  setMessages([]);
  setPrompt('');
  setStatus('idle');
  setStatusText('');
}

function applyInstructions() {
  const next = draftInstructions.trim();
  if (!next || next.length > 4000 || status === 'running') return;
  setActiveInstructions(next);
  newConversation();
  setStatusText('Instructions applied. Your next question starts a new session.');
  onFeatureChange('conversation');
}
```

**Why:** A session keeps the instructions it was created with. Instead of pretending to edit it, the page clears its saved session ID, so the next question goes down the `sessions.create` path with the new instructions. The previous session still exists on the server, unchanged. While the draft differs from the applied instructions, `submit` refuses to send (`changedInstructions`), so a question is never sent with instructions the student has not applied. See [OpenAI Docs: configuring agents](https://developers.openai.com/api/docs/guides/agents-api/configuration).

### 7. Teach the code in the page

The **View code** dropdown shows three explained excerpts: start the session, send a follow-up, and change the instructions. Each card has a **Viva voice** button that reads the explanation through browser speech synthesis. `selectNarratorVoice` in `src/speech.ts` chooses an English voice, and no audio API is called.

## Compare the answers

Ask “Explain what an API is in simple terms.” and then “Can you show a JavaScript example?”. The session ID stays the same and the turn count rises. Copy the answer, open **Customize instructions**, ask for explanations aimed at a 12-year-old in two short sentences, and click **Apply & start new session**. Ask the same opening question and compare. This lab clears the visible conversation when it starts a new one, so copy the old answer first.

## Code map

| File | Responsibility |
| --- | --- |
| `server/index.ts` | `handleRun` with `lab2 = true`: validate input, start a session or send a follow-up, forward the session ID and stream events. |
| `src/Lab2.tsx` | Keep the session ID and conversation, edit and apply instructions, render answers, and teach three snippets with Viva voice. |
| `src/App.tsx` | Show the two Lab 02 lessons in the sidebar. |
| `src/styles.css` | Style the conversation, editor, comparison, and teaching cards. |
| `src/speech.ts` | Choose an available narrator voice for code explanations. |

## Check your work

- The displayed session ID stays the same after a follow-up.
- The turn count increases after each question.
- **New conversation** clears the local session ID; the next prompt creates another session.
- Applying instructions starts a fresh local conversation; the next answer follows the new instructions.
- Lab 01 remains available from the sidebar.
