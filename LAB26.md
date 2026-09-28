# Lab 26 — Choose an environment

Compare `none` with `openai_hosted` on two tasks: one that only needs the model's knowledge, and one that must be computed to be trusted. Every session uses the same model and instructions, so the environment is the only difference. Each run is judged from the evidence in the session, not from how confident the answer sounds.

## Run the lab

1. Run `npm run dev` and select **Lab 26**.
2. Without an API key, explore the chooser, the request checker (with five recorded API answers), the six recorded runs in the inspector, and the test page. Run the tests in the browser and on the server; both should show **38/38 passed**.
3. For live sessions, add `OPENAI_API_KEY` to `.env` and restart the app. The project needs Agents API access with OpenAI-hosted environments.
4. Choose a task and click **Run in both environments**. The two runs start together, each in a new session. `none` finishes in about 10–25 seconds; `openai_hosted` first waits about 20 seconds for its sandbox.

## How it was built — step by step

Follow these steps in implementation order. The teaching excerpts below are shortened from the listed source files; surrounding types, imports, guards, and UI wiring remain in those files. Read each explanation before tracing the complete handler.

### 1. Two environments, one field

Source: `server/lab26.ts`.

```ts
// Question answering: no sandbox at all
environment: { type: 'none' }

// File and command work: a sandbox with a shell
environment: { type: 'openai_hosted', network: { access: 'disabled' } }

// Everything else in the request stays the same:
agent: { model, instructions }   // identical in every run
```

**Why:** Start with two controlled tasks in `src/lab26Environment.ts`: a conceptual explanation and a fresh computation. Hold model and instructions constant and change only the environment. `none` supplies no shell; `openai_hosted` supplies a sandbox, with network disabled for this computation.

### 2. Choose from what the task needs

Source: `src/lab26Environment.ts`.

```ts
export function recommend(needs: Need[]): Recommendation {
  const hostedNeeds = needs.filter((need) => needInfo[need].hosted);
  if (!hostedNeeds.length) return { kind: 'none', network: 'disabled', reasons: [needs.includes('answer') ? 'The model can answer from what it knows: no sandbox to wait for or pay for.' : 'Nothing here needs a sandbox, so start with none.'] };
  const reasons = hostedNeeds.map((need) => `${needInfo[need].label}: ${need === 'exact' ? 'only a real computation can be checked' : 'this happens inside an execution environment'}.`);
  const network: NetworkAccess = needs.includes('internet') ? 'restricted' : 'disabled';
  reasons.push(network === 'restricted' ? 'Network: restricted to the domains the task needs.' : 'Network: disabled, because nothing here needs it. Say so: the beta default is enabled.');
  return { kind: 'openai_hosted', network, reasons };
}
```

**Why:** Build a chooser from explicit task needs rather than the length of a prompt. `recommend` selects hosted execution for files, commands, packages, plugins, or exact computation, and restricted network only when internet access is needed. Reuse its reasons in the React chooser and validate the resulting request on the server.

### 3. none: ask in sessions.create and stream

Source: `server/lab26.ts`.

```ts
const stream = await client.beta.agents.sessions.create({
  agent: { model, instructions },
  environment: { type: 'none' },
  input: prompt,
  stream: true,
});
for await (const event of stream) {
  // session.created → turn.created → output_text → turn.completed
}
```

**Why:** Implement the `none` branch in `server/lab26.ts` using the first-turn streaming call students learned in Lab 01. There is no provisioning step, so the prompt can be sent in `sessions.create`. Collect the root outcome separately from its answer; a completed turn alone does not prove a computed number is correct.

### 4. openai_hosted: create, wait for ready, then ask

Source: `server/lab26.ts`.

```ts
const session = await sessions.create({ agent, environment });  // no input yet
const stream = await sessions.events.stream(session.id);
for await (const event of stream) {
  if (event.type === 'agent.session.environment.ready') await send(prompt);  // once
  if (event.type === 'agent.session.turn.item.done'
      && event.item.type === 'command_execution') commands.push(event.item);
}
```

**Why:** Implement the hosted branch by creating an empty session and listening before sending input. The real `send` helper uses a boolean guard because readiness events may repeat; it also has a readiness deadline and a saved-state fallback when the stream goes quiet. Collect completed `command_execution` items so the result has execution evidence.

### 5. Evidence: command_execution items

Source: `src/lab26Environment.ts`.

```ts
{
  "type": "command_execution",
  "command": "/bin/bash -lc \"printf %s \\\"$text\\\" | sha256sum\"",
  "cwd": "/workspace",
  "exit_code": 0,
  "output": "d40df0ae…04dc8f  -\n"
}
// commentary: "I’ll compute both directly…"  ← a claim, not evidence
```

**Why:** Preserve command text, working directory, exit code, and output in the run summary. A message promising to compute is only commentary, whereas command output shows what was actually run. Even exit code zero is insufficient: the agent can run a script that prints an error or uses the wrong calculation.

### 6. Check the answer yourself

Source: `src/lab26Environment.ts`.

```ts
const spec = makeSpec();               // lab26-<8 hex>, a fresh limit
const expected = expectedFor(spec);    // sha256Hex + primeSum, in the app
const reported = parseComputeAnswer(run.answer);
const ok = reported.sha256 === expected.sha256
  && grounded(reported.sha256, run.commands);  // it came out of a command
// none → invented · hosted → right fit
```

**Why:** Generate a fresh input with `makeSpec` and compute expected SHA-256 and prime-sum values in the application. The excerpt illustrates checking the hash against both the independent expected result and command output; the full judge checks both requested values. Finish the paired React result cards, recorded inspector, request checker, 38 shared cases, and narration; compare evidence rather than answer confidence.

**Check your implementation:** Use the offline cases first, then follow the live steps above when access is configured. The student challenge below names the evidence to collect; recorded or synthetic results do not verify a new live run.

## The two tasks

| Task | Prompt | Needs | Right environment |
| --- | --- | --- | --- |
| Explain | When is a Python tuple a better choice than a list? | the model's knowledge | `none` |
| Compute | The SHA-256 of `lab26-<8 hex>` and the sum of primes below a limit of 200,000–300,000 | exact values, commands | `openai_hosted`, network `disabled` |

The compute input is new for every comparison (**New input**), so no answer can be remembered. The app computes the expected values itself: a dependency-free SHA-256 and a sieve in `src/lab26Environment.ts`, used by the browser and checked against `node:crypto` on the server.

The instructions are the same in every session:

> You are a careful assistant. If a task needs computation you cannot do reliably in your head, run a command when you have a shell. Never invent results you did not compute. Be concise.

## The requests

```typescript
// none: no sandbox. The question goes in with sessions.create and streams at once.
const stream = await client.beta.agents.sessions.create({
  agent: { model, instructions },
  environment: { type: 'none' },
  input: prompt,
  stream: true,
});

// openai_hosted: create without input, wait for the sandbox, then send the task.
const session = await client.beta.agents.sessions.create({
  agent: { model, instructions },
  environment: { type: 'openai_hosted', network: { access: 'disabled' } },
});
const events = await client.beta.agents.sessions.events.stream(session.id);
// on the first agent.session.environment.ready:
await client.beta.agents.sessions.events.create(session.id, {
  events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }],
});
```

As in Lab 25, a hosted session is created without input so the task does not start before the sandbox is ready. One live session sent `environment.ready` twice (26.1 s and 32.1 s), so the server sends the task only on the first. If the stream goes quiet for 10 seconds after that, the server reads the turn and its saved items from the API.

## What the API accepted (2026-09-28)

| `environment` | Live result |
| --- | --- |
| `{ type: 'none', network: { access: 'disabled' } }` | 400 `Unknown parameter: 'environment.network'.` |
| `{ type: 'none', files: [] }` | 400 `Unknown parameter: 'environment.files'.` |
| `{ type: 'sandbox' }` | 400 `Invalid value: 'sandbox'. Supported values are: 'none', 'openai_hosted', and 'self_hosted'.` |
| `{ type: 'openai_hosted', network: { access: 'restricted' } }` | 400 `environment.network.access=restricted requires allowed_domains or blocked_domains` |
| `{ type: 'openai_hosted' }` | accepted; the session reported network access `enabled` |

The request checker (`checkEnvironment`) predicts each of these. **Send it anyway** sends a refused request to the API so students can compare its 400 with the checker. The SDK types say the default network is disabled for GA requests and enabled for alpha/beta requests. Always set the policy you intend to use.

## What happened live

| Run | Environment | Ready | Total | Commands | Tokens | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Explain | `none` | — | 8.9 s | 0 | 6,391 | Right fit |
| Explain | `openai_hosted` | 26.1 s | 36.0 s | 0 | 7,306 | Works, but a sandbox for nothing |
| Compute, fresh input | `none` | — | 27.3 s | 0 | 32,326 | Invented a result |
| Compute, fixed text | `none` | — | 24.1 s | 0 | 29,226 | Right values, no evidence |
| Compute, fresh input | `openai_hosted` | 19.7 s | 33.4 s | 2 | 23,375 | Right fit |
| Compute, fixed text | `openai_hosted` | 21.5 s | 31.7 s | 1 | 15,136 | Right fit |

- In the none sessions, the agent said *"I'll compute both directly"*, but the saved items contained only reasoning and messages. With a fresh input, it returned a well-formed 64-character SHA-256 that was **wrong**, in both probes. The prime sums were correct.
- With the fixed text `atmira-lab-26`, a none session got both values right. Nothing in the session shows how, so the verdict is *no evidence*. That is why the app uses a fresh input.
- In the hosted session, the first command printed the hash, but its Python had a syntax error. It still **exited 0**, because the error happened inside `$(…)`. The agent read the output, said so, and reran only that part. Read the output, not only the exit code.
- For computation, `none` was not cheaper: it used more tokens and gave a wrong answer. For explanation, `none` was four times faster.

## Judge a run

`judgeEnvRun` reads only the session's evidence:

- **Environment**: `session.environment.type`, plus `network.access` for hosted sessions.
- **Waited for the sandbox**: the `environment.ready` time.
- **`command_execution` items**: the command, `cwd`, `exit_code`, and output. Outputs showing `Traceback` or `SyntaxError` are flagged even when the exit code is 0.
- **Claim versus evidence**: commentary that says it computed something, with no command to back it up.
- **Values** (compute): the reported SHA-256 and prime sum compared with the app's own values, and whether each value appears in a command's output (*grounded*).

Outcomes: right fit, works but a sandbox for nothing, honest refusal, invented a result, right values but no evidence, wrong despite a sandbox, incomplete, and failed.

## Code map

| File | Role |
| --- | --- |
| `src/lab26Environment.ts` | Tasks and fresh inputs, SHA-256 and prime sum, chooser, environment builder and checker, run parser, judge. Shared by browser and server. |
| `src/lab26Scenarios.ts` | Six recorded runs and five recorded API answers. |
| `src/lab26Tests.ts` | 38 offline cases shared by the browser and server. |
| `server/lab26.ts` | The live run: none streams at once; hosted waits for `environment.ready`; quiet-stream fallback; best-effort usage. |
| `src/Lab26.tsx` | Chooser, request checker, live two-task runs, result grid, history, inspector, tests, narration. |

**View code** contains six explained snippets. **Viva voice** uses browser speech synthesis to read one explanation or all six; it does not call an audio API.

Hosted sessions remain in the project until they are deleted. Lab 30 covers the environment lifecycle and cleanup.

## Student challenge

1. Show **38/38 passed** on the server test page.
2. In the request checker, predict and then load *none + network* and *restricted, no domains*. Send one of them anyway and compare the API's 400 with the checker.
3. Run both tasks in both environments to fill the grid. For each cell, name the evidence behind its verdict: reported type, ready time, `command_execution` items, and values.
4. Click **New input**, run the compute task in `none` twice, and explain why a correct answer there would still count as *no evidence*.
