# Lab 15 — Show usage and duration

Labs 11–14 showed what happened during a turn. Lab 15 ends every run with a **run summary** a person can trust. The summary shows how many tokens the run used, how long it took, and what went wrong. Usage in the Agents API is *best effort*: it can be `null`, and recorded usage may change after the stream ends. So the page shows missing usage as **unknown**, never as 0. It leaves unknown runs out of totals and re-reads the saved turn before trusting a number.

## Learning goals

1. Read `usage` from the root turn's terminal event (`turn.completed`, `turn.failed`, or `turn.cancelled`), falling back to the turn object's own `usage`.
2. Parse usage at the browser's runtime boundary. `null` or malformed usage stays unknown. Cached tokens are part of input, and reasoning tokens are part of output.
3. Measure three clocks and say which is which: wall time and time to first text on our server, and queued and working time from the turn's `created_at`, `started_at`, and `completed_at`, which are whole Unix seconds.
4. Re-read the saved turn and session with `turns.retrieve` and `sessions.retrieve`, because recorded usage may change. Reading sends nothing.
5. Sum usage across runs without pretending: count unknown runs, and label the known sum as a floor (`≥`).
6. Explain an error by where it happened (HTTP request, turn, or stream), its status or stable code, and whether a retry can help.

## Run the lab

Run `npm ci`, put `OPENAI_API_KEY` in a private `.env` file, and start the app with `npm run dev`. Open **Show usage and duration** in the sidebar (`#lab15`).

**Live run.** Choose how the run should end, then press **Run and measure**:

| Mode | What the server does | What the summary should show |
| --- | --- | --- |
| **Normal run** | Runs one turn to its outcome. | `completed`. In the live check the event carried no usage, so tokens came from the saved turn. |
| **Cancel after 160 characters** | Sends `agent.session.input.cancel` once 160 characters have streamed. | `cancelled`, a short working time, and the tokens used before the cancel. |
| **Unknown model** | Creates a new session with the model `lab15-no-such-model`. | `rejected`: in the live check, session creation was refused with HTTP 404 `model_not_found`, so no turn ran. (A turn that starts and then fails would show `failed` with the turn's error code.) |
| **Stop reading early** | Stops reading after 160 characters and sends nothing. | `unknown` outcome and unknown tokens, until a re-read shows the saved turn's real status and usage. Use **Re-read saved usage** if the automatic re-read still says unknown. |

Each run adds a row to the **run history**. The page re-reads the saved turn 1.5 s after each run; **Re-read saved usage** reads it again. The summary shows:

- **Tokens**: input, cached (of input), output, reasoning (of output), and total. It names the source (turn event or saved turn) and when the value was read.
- **Duration**: a bar showing where the time went, plus wall time, first text, start-up, queued (API), and working (API).
- **Checks**, such as `total = input + output`, cached ≤ input, and whether the event and the saved turn agree.
- **Error details**: where it happened, status, code, message, and retry advice.
- **Log line**: a one-line summary that never says 0 for an unknown value.

The history footer shows the **honest total** (for example `≥ 4,289`, 3 runs unknown) next to the **naive total**, which adds `null` as 0. It also shows the session's own `usage` from the latest re-read. **Download JSON** saves every run summary.

**Usage playground (no API key needed).** Pick a case and turn **Re-read the saved turn** on or off:

| Case | Lesson |
| --- | --- |
| Completed, usage reported | Cached and reasoning tokens are breakdowns, not extra tokens. |
| Completed, usage unknown | `null` is not 0. Show unknown and keep it out of sums. |
| Usage changed after the event | Store the latest read and when it was read. |
| Cancelled mid-answer | A cancelled turn is not free. |
| Failed: rate limited | Show the code and message, and say whether retrying can help (`rate_limit_exceeded`: retry later). |
| Rejected: model not available | No turn ran, so there is no usage. That is different from unknown usage. |
| Stopped reading early | Unknown now is not unknown forever: re-read the saved turn. |

The field names and error codes come from the SDK's types (`TokenUsage`, `Turn`, and `SessionTurnError` in `openai` 7.23.0). The numbers, IDs, and timings are fixtures, not recordings, and the page says so. The live run and the playground use the same functions from `src/lab15Usage.ts`.

Open **View code** for six snippets and explanations. **Viva voice · Read aloud** reads one explanation, and **Viva voice · Read all six** reads them in order. Both use browser speech synthesis and do not call an audio API.

## How it was built — step by step

### 1. Run one measured turn in one of four modes

```ts
// server/lab15.ts, runLab15
const model = mode === 'bad_model' ? missingModel : agent.model;
started = performance.now();
stream = await api.beta.agents.sessions.create({ agent: { ...agent, model }, environment: { type: 'none' }, input: prompt, stream: true });

// while text streams
if (mode === 'cancel' && !cancelSent && length >= actAfterChars) {
  cancelSent = true;
  await api.beta.agents.sessions.events.create(sessionId, { events: [{ type: 'agent.session.input.cancel' }] });
}
if (mode === 'stop_early' && length >= actAfterChars) {
  // The page's reader stops; the turn keeps running and keeps using tokens.
  error = { source: 'stream', status: null, code: null, message: `The server stopped reading after ${length} characters. No cancel was sent, so the turn kept running.` };
  break;
}
```

**Why:** A run summary is only interesting when runs end differently. The four modes produce four endings on purpose: a normal run completes, a cancel after 160 characters ends as `cancelled`, stopping early leaves the outcome unknown, and an unknown model is refused. Each ending has different usage and different errors.

### 2. Mark the clocks on our server

```ts
// server/lab15.ts
const since = () => Math.round(performance.now() - started);
const mark = (key: keyof typeof clock, label: string) => {
  if (clock[key] !== null) return;
  clock[key] = since();
  writeEvent(response, { type: 'mark', label, ms: clock[key] });
};

if (event.type === 'agent.session.turn.output_text.delta') { mark('firstTextMs', 'first text'); /* … */ }
```

**Why:** Different people care about different times. **Wall time** is how long the user waited. **First text** is how fast the answer felt. **Start-up** is how long until the turn was in progress. Each mark is recorded once, in milliseconds from when the request was sent, and streamed to the page for the time bar. These are measured on **our server**, so they include network time.

### 3. Capture usage and API timestamps from the root turn's terminal event

```ts
// server/lab15.ts
const terminal = event.type === 'agent.session.turn.completed' || event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled';
if (terminal && rootTurn && rootTurn.id === turnId) {
  mark('endMs', `turn.${rootTurn.status}`);
  outcome = rootTurn.status;
  // Best effort: the event's usage, else the turn's own. null stays null.
  usage = event.usage ?? rootTurn.usage ?? null;
  apiTimes.createdAt = rootTurn.created_at ?? null;
  apiTimes.startedAt = rootTurn.started_at ?? null;
  apiTimes.completedAt = rootTurn.completed_at ?? null;
}
```

**Why:** Usage is read from all three terminal events, not only `completed`, because a cancelled or failed turn can still have used tokens. The turn's own timestamps give the API's side of the story: queued time and working time. Those are whole Unix seconds, so they are shown in seconds. The raw usage goes to the browser untouched, and the browser decides what it means. In the live check below, the terminal events carried `null` usage, so the numbers came from step 5's re-read.

### 4. Parse usage at the boundary: `null` stays unknown

```ts
// src/lab15Usage.ts
export type Usage = { input: number; output: number; total: number; cached: number | null; reasoning: number | null };

export function parseUsage(raw: unknown): Usage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const usage = raw as Record<string, unknown>;
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  if (input === null || output === null) return null;
  return {
    input, output,
    total: count(usage.total_tokens) ?? input + output,
    cached: count(inputDetails?.cached_tokens),
    reasoning: count(outputDetails?.reasoning_tokens),
  };
}

export const tokens = (value: number | null | undefined): string => (value === null || value === undefined ? 'unknown' : value.toLocaleString('en-US'));
```

**Why:** The most important rule in the lab: **missing usage is unknown, not zero**. `parseUsage` returns `null` for anything it cannot trust, and every display goes through `tokens()`, which prints **unknown**. Cached tokens are a **part** of input tokens and reasoning tokens a **part** of output tokens, so they are shown inside those numbers and never added again.

### 5. Re-read the saved turn, and trust it over the stream

```ts
// server/lab15.ts, usageLab15 — reads, sends nothing
const [session, turn] = await Promise.all([
  api.beta.agents.sessions.retrieve(sessionId),
  turnId ? api.beta.agents.sessions.turns.retrieve(turnId, { session_id: sessionId }) : Promise.resolve(null),
]);

// src/lab15Usage.ts
// The value a summary should trust: the saved turn when it was re-read, otherwise the terminal event.
export function bestUsage(run: RunRecord) {
  if (run.usage.turn) return { usage: run.usage.turn, source: 'saved turn' };
  if (run.usage.event) return { usage: run.usage.event, source: 'turn event' };
  return { usage: null, source: null };
}
```

**Why:** Recorded usage can change after the stream ends. After each run the page re-reads the saved turn and session. It prefers the saved numbers, labels where they came from, and shows both when they differ (`usageChecks`). For **Stop reading early**, the re-read is the only way to learn what the turn really used.

### 6. Sum honestly across runs

```ts
// src/lab15Usage.ts
// Sum usage without pretending: unknown runs are counted, not added as zero.
export function sumUsage(list: Array<Usage | null>): UsageTotal {
  return list.reduce<UsageTotal>((sum, usage) => usage
    ? { input: sum.input + usage.input, output: sum.output + usage.output, total: sum.total + usage.total, known: sum.known + 1, unknown: sum.unknown }
    : { ...sum, unknown: sum.unknown + 1 }, { input: 0, output: 0, total: 0, known: 0, unknown: 0 });
}
// "at least" when any run is unknown: the known sum is a floor, not the answer.
export const totalLabel = (value: number, sum: UsageTotal): string => (sum.known === 0 ? 'unknown' : `${sum.unknown ? '≥ ' : ''}${value.toLocaleString('en-US')}`);
```

**Why:** The run history shows two totals side by side. The **honest** total counts unknown runs separately and prefixes the sum with `≥`, because the real total is at least that. The **naive** total adds `null` as 0 and presents a precise-looking number that is wrong.

### 7. Explain errors by where they happened

```ts
// src/lab15Usage.ts
export type RunError = { source: 'http' | 'turn' | 'stream'; status: number | null; code: string | null; message: string };

export function explainError(error: RunError): ErrorHelp {
  if (error.source === 'stream') return { title: 'Stream ended without an outcome', retry: 'no', advice: 'The turn may still be running. Read the saved turn before retrying, or you may pay twice.' };
  return (error.code && codeHelp[error.code]) || statusHelp(error.status);
}
```

**Why:** An error can come from three places: the HTTP request (refused before any turn ran), the turn (failed with a stable `code`), or the stream (ended without an outcome). `codeHelp` maps the SDK's turn error codes, and `statusHelp` maps HTTP statuses, to a title and one retry decision: retry now, retry later, do not retry, or change something first. So the summary can say whether a retry could help, not just that something failed. **View code** holds six snippets with **Viva voice** buttons.

## What a live run showed

These runs used `gpt-5.6-terra` (one session for the first three, a new one for the unknown model), with the question "Explain JavaScript promises in about 200 words with one short example." Run them again before recording, because API behaviour can change.

| Mode | Outcome | Usage on the terminal event | Saved turn after 1.5 s | Saved turn after 13 s |
| --- | --- | --- | --- | --- |
| **Normal run** | `completed` (wall time 10.5 s, first text 7.3 s) | `null` | 6,322 in · 271 out · 6,593 total | unchanged |
| **Cancel after 160 characters** | `cancelled` (wall time 6.7 s) | `null` | 6,613 in (6,319 cached) · 301 out · 6,914 total | unchanged |
| **Stop reading early** | `unknown` on the stream | none (the stream was closed) | status `completed`, usage still `null` | 6,934 in (6,610 cached) · 310 out · 7,244 total |
| **Unknown model** | `rejected`: HTTP 404, `model_not_found` | none: no session or turn was created | — | — |

What this means for the lesson:

- **The terminal events carried no usage** in these runs, even for a completed turn. The usage shown in the summary came from re-reading the saved turn. So "read the event, then re-read the saved turn" is not optional: the re-read is where the numbers came from.
- **A cancelled turn is not free.** It still used almost 7,000 tokens, most of them cached input from the earlier turn in the same session.
- **Unknown now is not unknown forever.** The turn the page stopped watching completed on its own, but its usage appeared only several seconds later. The automatic re-read at 1.5 s still showed **unknown**, and a later **Re-read saved usage** showed 7,244 tokens.
- **The session's own `usage` was `null`** in every re-read, so the history footer shows it as unknown.
- The API timestamps are whole seconds. The completed turn showed 0 s queued and 3 s working, while our server measured 10.5 s of wall time. Most of the difference was session start-up before the turn existed.

## Rules the summary follows

```text
usage null or malformed          → "unknown" (never 0), left out of sums, counted as unknown
request refused before a session → outcome rejected, usage "none (no turn ran)"
stream ended without an outcome  → outcome unknown; re-read the saved turn before retrying
event usage and saved usage      → trust the saved turn; show both when they differ
total across runs                → "≥ known sum" when any run is unknown
cached / reasoning tokens        → shown inside input / output, never added again
API timestamps                   → whole seconds; a duration is shown only when both ends are known
```

## Code map

| File | Role |
| --- | --- |
| `src/lab15Usage.ts` | Pure functions: `parseUsage`, `bestUsage`, `durations`, `sumUsage` and `totalLabel`, `usageChecks`, `explainError`, `summaryLine`, and `parseServerSummary`, the runtime boundary. |
| `src/lab15Scenarios.ts` | Seven scripted runs for the playground, and `beforeReread`, which shows what the stream alone reported. |
| `server/lab15.ts` | `runLab15` runs one measured turn in one of four modes and ends with a summary line (clocks, API timestamps, raw usage, error). `usageLab15` re-reads the saved turn and session. |
| `server/index.ts` | Routes `POST /api/lab15/run` and `GET /api/lab15/usage`. |
| `src/Lab15.tsx` | Live run, run summary, time bar, history with honest and naive totals, playground, code snippets, and Viva voice. |
| `src/App.tsx` | Adds Lab 15 to the Streaming and React stage. |
| `tsconfig.lab6.json` | Type-checks the usage logic and scenarios in strict mode. |

## Student challenge

In one session, make four runs: **Normal run**, **Cancel after 160 characters**, **Stop reading early**, and **Unknown model**. Show the history table and explain four results:

- why the cancelled run still used tokens;
- why the stopped run was unknown until you re-read it;
- why the unknown-model run has no usage at all;
- why the naive total can be lower than the honest one.

See [OpenAI Docs: Observability and usage](https://developers.openai.com/api/docs/guides/agents-api/observability), [Session management](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage#inspect-session-turns), and [Events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events).
