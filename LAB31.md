# Lab 31 — Understand the agent harness

Lab 31 connects the earlier session, tool, and sandbox lessons to one architecture. Students identify what the model proposes, what the managed harness coordinates, what the application server implements, and where commands execute. The lab includes an interactive architecture diagram, six synthetic practice traces, read-only inspection of saved sessions, an ownership exercise, an evidence export, and six teaching cards with Viva voice narration.

## Learning goals

1. Distinguish the model, managed harness, application server, browser, sandbox, and MCP service.
2. Compare orchestration and state ownership in the Agents API, Agents SDK, and Responses API.
3. Annotate a session trace without claiming to observe internal model invocations.
4. Distinguish a proposed function call from application execution and sandbox execution.
5. Keep a child outcome, session idle, and a disconnected reader separate from root-turn success.
6. Explain why an evaluation runner is separate from the execution harness.

## Run the lab

Run `npm ci`, then `npm run dev`, and open <http://localhost:5173/#lab31>. Select **31 · Understand the agent harness** in the sidebar or mobile navigation.

Practice, the diagram, runtime comparison, ownership exercise, exports, teaching, narration, and rule tests need no API key. All six practice traces are **synthetic examples**, not recorded API runs.

For live inspection, configure `OPENAI_API_KEY` in the server environment, restart the app, and paste a session ID from an earlier lab. The key needs permission to read sessions, turns, and items in its project. Lab 31 retrieves saved state; it sends no input and does not create, cancel, or delete sessions or environments. Saved-state inspection is different from watching a live event stream.

## How it was built — step by step

These excerpts explain the implementation boundaries. Read the named source files for the complete types, validation, error handling, and UI wiring.

### 1. Describe the architecture independently of the UI

Start with owner descriptions and environment-dependent connections in `src/lab31Harness.ts`.

```ts
const edges = architectureEdges(environment);
// browser ↔ application server ↔ managed harness ↔ model
// openai_hosted: harness ↔ sandbox
// self_hosted: application also manages the executor lifecycle
// none: no built-in sandbox shell or workspace
```

**Why:** The model produces text and proposes actions. The managed harness coordinates the model/tool loop and maintains session progress. The environment supplies compute and files. The application server connects the agent to product policy and function implementations. Changing the environment changes compute responsibilities without moving the managed harness into the sandbox. See [OpenAI's architecture guide](https://developers.openai.com/api/docs/guides/agents-api/architecture).

Build the React diagram from these connections. Clicking a component shows its responsibilities; selecting a trace step highlights its annotated owner. A self-hosted connection in this lab is an architecture preview, not a provisioned executor. Lab 32 implements that connection.

### 2. Compare runtime ownership and state

Keep the comparison data beside the architecture rules, then render it as a table.

```ts
const comparison = runtimeComparison;
// Agents API: OpenAI-managed harness and saved sessions.
// Agents SDK: SDK runner inside your application.
// Responses API: your integration, with optional hosted orchestration.
```

**Why:** The Agents API manages the execution harness; an SDK runner runs in the application you deploy; a Responses integration owns its surrounding workflow while using supported hosted capabilities. Their state choices differ. A managed Agents API session, SDK session, Responses conversation, and sandbox are different resources. The comparison follows [OpenAI's runtime overview](https://developers.openai.com/api/docs/guides/agents). An evaluation runner measures behavior and produces regression results; it is separate from the harness executing a task.

### 3. Read saved evidence through a bounded server adapter

`server/lab31Service.ts` receives a small inspection interface so pagination and projection can be tested without OpenAI calls. `server/lab31.ts` supplies the real SDK adapter.

```ts
const session = await api.retrieve(sessionId);
const [turns, items] = await Promise.all([
  readPages(after => api.turns(sessionId, after)),
  readPages(after => api.items(sessionId, after)),
]);
```

**Why:** Retrieval reads existing work without starting another turn. Each collection is limited to five pages of up to 100 entries; partial reads are explicitly labelled. The server projects selected metadata rather than forwarding raw agent settings, tool arguments, or message bodies. Saved items show persisted work, but cannot reconstruct exact stream timing. See [Events and saved items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events).

Live inspection belongs to the API key's project. This teaching app has no user accounts; a deployed product must enforce user ownership before allowing session reads.

### 4. Annotate proposals and execution separately

Normalize saved item types into trace steps, then classify each step with the shared pure function.

```ts
const annotation = classifyStep(step);
// function_call        → model proposal
// function_call_output → application handler result
// command_execution    → sandbox execution
// mcp_call             → MCP service tool
// unknown              → review instead of guessing
```

**Why:** A proposed function is not its implementation. The application validates the call and supplies its result; the model cannot grant itself approval. Commands execute in the environment, and remote MCP tools are implemented by their service. The harness coordinates these exchanges. Classifying a saved proposal as model work is an architectural inference, not an exposed internal model-call event. A saved function result does not alone prove that a person approved a consequential write; inspect the originating lab's audit for that evidence.

Keep call IDs and turn IDs so students can connect a proposal with its result. Unknown item types remain visible as unclassified.

### 5. Establish outcomes from the latest observed root turn

Use the same outcome function for practice, imported traces, and saved-state inspection.

```ts
const latest = [...steps].reverse().find(
  step => step.kind === 'turn' && step.root,
);
// A completed child does not finish the root.
// Session idle does not establish turn success.
// Reader closure does not cancel remote work.
```

**Why:** Only a root-turn outcome supports the task's success, failure, or cancellation. A failed environment may prevent a turn from starting at all. Missing evidence remains unknown; an active observed root remains in progress after the reader disconnects. Inspect the synthetic disconnect and provisioning cases to see the distinction. A partial inventory cannot establish the current/latest outcome for the whole session.

Validate imported JSON before using it. The importer marks its source as **imported**, ignores claimed owner annotations, and recomputes ownership. An imported file cannot claim that this browser performed a verified live read.

### 6. Teach, narrate, and export the student's explanation

`src/lab31Lessons.ts` defines the six teaching cards. `src/Lab31.tsx` renders syntax-highlighted snippets, explanatory text, individual read-aloud buttons, and **Read all six**.

```ts
const markdown = evidenceDocument(trace, notes);
const utterance = new SpeechSynthesisUtterance(lesson.explanation);
const voice = selectNarratorVoice(voices);
if (voice) utterance.voice = voice;
window.speechSynthesis.speak(utterance);
```

**Why:** The evidence document combines annotated architecture connections, trace ownership, source labels, limitations, and the student's own explanation. Viva voice uses browser speech synthesis and installed English voices. It makes no audio API call and creates no audio file. Stop cancels narration; closing the teaching section, switching labs, or unmounting also stops it. Unsupported browsers and playback errors show explanatory messages.

## Practice and student challenge

1. Step through **Hosted computation** and identify the model, coordinating harness, and execution environment.
2. Compare **Application function boundary** with **Remote MCP without a sandbox**. Explain who implements each tool and why neither requires a built-in shell.
3. Load **Reader disconnect and child completion**. Explain why the root remains in progress despite a completed child and an idle observation.
4. Load **Provisioning failure** and identify the missing root-turn outcome.
5. Switch the architecture to `self_hosted`. Identify the additional lifecycle connection; explain why the managed harness stays on OpenAI.
6. Complete the ownership exercise, add your explanation, and export an annotated Markdown evidence document.
7. Inspect a completed session from Lab 17 or Lab 29. Identify the saved function exchange or command execution and explain what the projection cannot prove.
8. Read one teaching explanation aloud, try **Read all six**, and use Stop. Switch labs during narration and confirm playback stops.
9. Run both the browser and server rule suites. Imported/synthetic evidence must remain labelled when exported.

## Verification

`npm run test:lab31` runs the shared ownership rules and the actual inspection service with a fake API. Tests cover root/child outcomes, unknown item types, partial pagination, repeated cursors, input validation, projection, and imported-source handling. They create no live sessions and make no OpenAI requests. `npm run build` checks both TypeScript configurations and creates the production bundle.

## Code map

| File | Role |
| --- | --- |
| `src/lab31Harness.ts` | Architecture, runtime comparison, classification, parsing, warnings, and evidence document. |
| `src/lab31Scenarios.ts` | Six synthetic traces and the ownership exercise. |
| `src/lab31Lessons.ts` | Six code excerpts and narration explanations. |
| `src/lab31Tests.ts` | Shared browser/server ownership and evidence cases. |
| `server/lab31Service.ts` | Read-only inspection, bounded pagination, and selected saved-state projection. |
| `server/lab31.ts` | SDK adapter and inspection/test HTTP routes. |
| `server/lab31.integration.test.ts` | Offline regression tests of the inspection service. |
| `src/Lab31.tsx` | Interactive diagram, trace inspector, imports, exports, exercise, tests, and Viva voice. |

## Official references

The architecture and runtime comparison were checked against [Agents API architecture](https://developers.openai.com/api/docs/guides/agents-api/architecture), [agent runtime options](https://developers.openai.com/api/docs/guides/agents), and [events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events) on 2026-09-28. Synthetic examples establish teaching behavior, not a live API result.
