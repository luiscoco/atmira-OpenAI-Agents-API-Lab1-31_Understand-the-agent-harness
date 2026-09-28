# Lab 18 — Validate tool inputs

In Lab 17 the server answered every call the agent made. Lab 18 protects the function behind the tool. Arguments stay `unknown` until they pass three checks: **parse**, **schema**, and **meaning**. The service also gets a **deadline** that aborts slow work. Every **exception** is caught and becomes an honest `success: false` result that tells the agent whether to retry, and stack traces stay on the server. A tool test page runs 21 valid and failing cases through the same code, in the browser or on the server, with no API key.

## Learning goals

1. Treat `function_call.arguments` as `unknown`. Validation is the only way from `unknown` to the typed `CalendarArgs` the function receives.
2. Validate in layers: **parse** (a JSON object, sent as an object or a string), **schema** (types, `required`, `enum`, `minLength`/`maxLength`, `pattern`, `additionalProperties: false`), then **meaning** (rules a schema cannot express: real dates, the course window, control characters).
3. Report **every** issue with a path, in text written for the agent, so one retry can fix them all.
4. Put a deadline on the call. Race the work against a timer, and **abort** the work when the timer wins.
5. Catch every exception. Tell the agent whether to retry (a timeout or temporary error: once; a bug: no). Log the details on the server with a reference, and send the agent only that reference.
6. Test valid and failing cases, and state for each one the stage where it must stop.

## Run the lab

Run `npm ci`, put `OPENAI_API_KEY` in a private `.env` file, and start the app with `npm run dev`. Open **Validate tool inputs** in the sidebar (`#lab18`), under **Function tools & human control**.

**The pipeline.** Seven gates: Name → Parse → Schema → Meaning → Deadline → No crash → Result. A call stops at the first gate it fails; the gates after it show *not reached*.

**Tool test page (no API key needed).** 21 cases in three groups:

| Group | Cases | Expected stop |
| --- | --- | --- |
| Valid inputs | a lab by number, with a start date, arguments as a JSON string, extra spaces (normalised) | Result |
| Invalid inputs | not JSON, an array, missing topic, wrong enum, wrong type, extra field, three problems at once, topic too long, wrong date format, 2026-02-30, a date outside the course, control characters, unknown function | Parse, Schema, Meaning, or Name |
| Service failures | too slow, throws a bug, temporary error on attempt 1, the same on attempt 2 | Deadline, No crash, or Result |

**Run all in the browser** and **Run all on the server** (`POST /api/lab18/test`) run the same `runTool` with real timers and a 300 ms deadline. Select a row to see where the call stopped, each issue with its layer and path, the exact `tool_result` event, the validated arguments, and the **server log** that is never sent to the agent. **Write your own case** runs any name, arguments, and fault you type.

**Live run.** Pick a question and choose:

| Option | Effect |
| --- | --- |
| **Works normally** | The lookup answers in about 120 ms. |
| **Too slow** | The lookup would take 6 s. The 1,500 ms deadline aborts it and the agent is told it may try once more. |
| **Throws a bug** | A real `TypeError`. The agent gets `internal error (ref err_…). Do not retry.`; the stack trace goes to the server console. |
| **Fails once** | The first call that reaches the service in a turn throws a `TransientError`. A retry succeeds. |
| **Strict schema** (default) | The model sees the enum, the length limits, and the pattern. |
| **Loose schema** | The model sees no enum or limits. The server **still** validates against the strict schema. |

The server answers every pause automatically, up to 4 rounds, then cancels the turn. If the agent resends arguments that were already rejected, the error says so and does not invite another retry. The result shows a verdict (*valid on the first try*, *recovered after a rejection*, *reported honestly*, or *answered directly*), a timed trace with rejections marked, and every call with its pipeline and the event that answered it. **Read the saved items** shows the `function_call_output` items with their errors.

Open **View code** for six snippets and explanations. **Viva voice · Read aloud** reads one explanation aloud, and **Viva voice · Read all six** reads them all in order. Both use browser speech synthesis and do not call an audio API.

## How it was built — step by step

### 1. Tighten the declaration, and add a loose one for comparison

```ts
// src/lab18Validate.ts
export const strictCalendarTool: FunctionToolDeclaration = {
  ...courseCalendarTool,
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', minLength: 2, maxLength: 60, description: '…' },
      kind: { type: 'string', enum: [...kinds], description: '…' },
      from_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '…' },
    },
    required: ['topic', 'kind'],
    additionalProperties: false,
  },
};
// looseCalendarTool: the same name and description, but no enum, no limits, extra fields allowed.
```

**Why:** Lab 16's tool gains length limits on `topic`. The loose declaration exists only for the live run. It lets the model send values the strict schema forbids (such as `kind: "workshop"`), which shows the central lesson: **the declaration is a hint to the model; validation on the server is the guarantee.** The server always validates against the strict schema, whichever one the model saw.

### 2. Check the schema, and collect every issue with a path

```ts
// src/lab18Validate.ts
export type Issue = { layer: 'parse' | 'schema' | 'meaning'; path: string; code: string; message: string };

export function checkSchema(value: unknown, schema: Record<string, unknown>, path = ''): Issue[] {
  if (schema.type === 'object') {
    if (!isObject(value)) return [issue('type', `must be an object, got ${typeOf(value)}.`)];
    const issues: Issue[] = [];
    for (const key of required) if (!(key in value)) issues.push({ layer: 'schema', path: `${path}/${key}`, code: 'required', message: 'is required but missing.' });
    for (const [key, item] of Object.entries(value)) {
      const property = properties[key];
      if (isObject(property)) issues.push(...checkSchema(item, property, `${path}/${key}`));
      else if (schema.additionalProperties === false) issues.push({ layer: 'schema', path: `${path}/${key}`, code: 'additional', message: 'is not a declared argument. Remove it.' });
    }
    return issues;
  }
  // string: type, enum, minLength, maxLength, pattern · integer/number · boolean
}
```

**Why:** Lab 16's `checkArguments` produced a preview. This checker covers every keyword the course uses and returns **all** issues, not just the first, each with a path such as `/kind`. When the model gets every problem at once, a single retry can fix them all.

### 3. Check meaning the schema cannot express

```ts
// src/lab18Validate.ts
// A real calendar date: 2026-02-30 matches the pattern but is not a day that exists.
export function isRealDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function checkMeaning(args: CalendarArgs): Issue[] {
  if (controlCharacters.test(args.topic)) issue('/topic', 'control', 'contains control characters. Send plain text only.');
  if (args.from_date !== undefined) {
    if (!isRealDate(args.from_date)) issue('/from_date', 'date', `${show(args.from_date)} is not a real calendar date.`);
    else if (args.from_date < courseWindow.first || args.from_date > courseWindow.last) issue('/from_date', 'window', `… is outside the course calendar (…).`);
  }
}
```

**Why:** A schema checks **shape**: a ten-character string in the right pattern. It cannot know that 30 February does not exist, that a date is outside the course, or that a topic hides control characters (a common prompt-injection trick). Those rules run in a separate **meaning** layer, only after the schema passes, so the error can say which kind of rule failed.

### 4. One boundary from `unknown` to a typed value

```ts
// src/lab18Validate.ts
export type CalendarArgs = { topic: string; kind: CalendarKind; from_date?: string };
export type Validation = { ok: true; value: CalendarArgs; issues: [] } | { ok: false; value: null; issues: Issue[] };

export function validateCalendarArgs(raw: unknown, schema = strictCalendarTool.parameters): Validation {
  const parsed = parseArguments(raw);                       // 1. parse: an object, or a JSON string
  if (!parsed.value) return { ok: false, value: null, issues: [/* layer 'parse' */] };
  const shape = checkSchema(parsed.value, schema);          // 2. schema
  if (shape.length) return { ok: false, value: null, issues: shape };
  // The schema passed, so these casts are now justified.
  const args: CalendarArgs = { topic: parsed.value.topic as string, kind: parsed.value.kind as CalendarKind };
  if (typeof parsed.value.from_date === 'string') args.from_date = parsed.value.from_date;
  const meaning = checkMeaning(args);                       // 3. meaning
  if (meaning.length) return { ok: false, value: null, issues: meaning };
  return { ok: true, value: { ...args, topic: args.topic.trim().replace(/\s+/g, ' ') }, issues: [] };   // 4. normalise
}
```

**Why:** This is the only door from `unknown` to `CalendarArgs`. The casts appear **after** the schema check that justifies them, and nowhere else. The function receives a typed, normalized value, and it is never called with anything else.

### 5. Put a deadline on the call, and abort the work

```ts
// src/lab18Validate.ts
export async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { const error = new ToolTimeoutError(ms); controller.abort(error); reject(error); }, ms);
  });
  try { return await Promise.race([work(controller.signal), deadline]); }
  finally { clearTimeout(timer); }
}

// the service honours the signal, so a timeout also stops the work
export async function calendarService(args, fault, attempt, timing, signal) {
  await wait(fault === 'slow' ? timing.slowMs : timing.latencyMs, signal);
  if (fault === 'flaky' && attempt === 1) throw new TransientError('ECONNRESET: the calendar backend closed the connection.');
  if (fault === 'throw') { const rows: CalendarEntry[] = []; return { entries: [], note: rows[0].date }; }   // a real TypeError
  return lookupCourseCalendar(args);
}
```

**Why:** While the function runs, the turn is paused and the user is waiting. The timer races the work. When the timer wins, it rejects **and** aborts the work through its `AbortSignal`, because otherwise the work keeps running and its late result is thrown away. `finally` clears the timer, so a fast call leaves nothing behind. The service can fail on purpose in three ways, so every failure path can be exercised.

### 6. Catch every exception; keep internals on the server

```ts
// src/lab18Validate.ts, runTool
try {
  const result = await withTimeout((signal) => calendarService(args, options.fault, options.attempt, options.timing, signal), options.timing.timeoutMs);
  return { stage: 'ok', success: true, output: JSON.stringify(result), /* … */ };
} catch (caught) {
  if (caught instanceof ToolTimeoutError) return outcome('timeout', `… did not answer within ${caught.ms} ms. You may try once more; …`, true, …);
  if (caught instanceof TransientError) return outcome('exception', '… hit a temporary error. Try the same call once more.', true, …);
  // A bug: log the details with a reference, and give the agent only the reference.
  const ref = errorRef();
  return outcome('exception', `… failed with an internal error (ref ${ref}). Do not retry. Tell the user the calendar is unavailable right now.`, false, `[${ref}] ${detail}`);
}
```

```ts
// server/lab18.ts, answer()
if (outcome.internal) console.warn(`[lab18] ${call.callId} ${outcome.internal}`);   // server log only
```

**Why:** Every call ends as a `ToolOutcome` with a **stage**: where it stopped, one of `name`, `parse`, `schema`, `meaning`, `timeout`, `exception`, or `ok`. It also carries two separate messages:

- **`error` goes to the agent.** It is short, it says what to do next, and `retryable` records whether trying again can help.
- **`internal` goes only to the server log.** Stack traces and file paths can leak secrets, and the model may repeat them to the user, so the agent gets a reference ID (`err_…`) instead.

### 7. Answer every call in the live loop, and sharpen repeated rejections

```ts
// server/lab18.ts, answer()
for (const call of waiting) {
  const signature = callSignature(call);
  const outcome = await runTool(call, { fault: trace.fault, attempt: trace.attempts + 1, timing: liveTiming, repeated: trace.rejected.has(signature) });
  if (outcome.stage !== 'name' && outcome.stage !== 'parse' && outcome.stage !== 'schema' && outcome.stage !== 'meaning') trace.attempts += 1;
  else trace.rejected.add(signature);
  results.push({ ...outcome, callId: call.callId, turnId: call.turnId ?? trace.turnId ?? '', name: call.name, round: trace.rounds, attempt: trace.attempts });
}
await api.beta.agents.sessions.events.create(trace.sessionId, { events: results.map(toolResultEvent) });
```

**Why:** The loop is Lab 17's, with `runTool` in place of `executeCall`. Every call still gets exactly one `tool_result`. Calls run one after another, so **Fails once** means the first call that reaches the service. `callSignature` (the name plus the arguments with sorted keys) recognises a call that repeats arguments already rejected. That call gets a sharper error that does not invite another retry. Lab 17's four-round cap still applies.

### 8. Test valid and failing cases with the same code

```ts
// src/lab18Tests.ts
export const toolTests: ToolTest[] = [
  test('valid-lab', 'A lab by number', 'valid', { topic: 'lab 18', kind: 'lab' }, 'ok', 'Required fields only.'),
  test('enum', 'Wrong enum', 'invalid', { topic: 'lab 18', kind: 'workshop' }, 'schema', '"workshop" is not an allowed kind.'),
  test('feb30', 'A date that does not exist', 'invalid', { topic: 'lab 18', kind: 'any', from_date: '2026-02-30' }, 'meaning', '…'),
  test('slow', 'Service too slow', 'failure', { topic: 'lab 18', kind: 'lab' }, 'timeout', '…', { fault: 'slow' }),
  // …21 cases
];

export async function runTest(item, timing = testTiming): Promise<TestResult> {
  const outcome = await runTool({ name: item.name, arguments: item.args }, { fault: item.fault, attempt: item.attempt, timing });
  return { id: item.id, outcome, pass: outcome.stage === item.expect };
}
export const runSuite = (timing = testTiming) => Promise.all(toolTests.map((item) => runTest(item, timing)));
```

```ts
// server/lab18.ts — POST /api/lab18/test, no API key needed
const results = await runSuite();
sendJson(response, 200, { results, runtime: `Node ${process.version}`, durationMs: Math.round(performance.now() - started) });
```

**Why:** Each case states the **stage** where the call must stop, so a test fails if a call stops at the wrong gate, not only if it errors. The suite uses real timers with a short 300 ms deadline, so the timeout case really waits, and the whole suite finishes in about a third of a second. The same `runTool` runs in the browser, on the Node server, and in the live agent loop, so a green suite is evidence about the code the agent actually calls. **View code** holds six snippets with **Viva voice** buttons.

## What a live run showed

These runs used `gpt-5.6-terra` while the lab was being built. Run them again before recording, because model behaviour can change.

- **"Check the course calendar for anything on or after 2026-02-30." (strict):** the first call sent `topic: ""` and stopped at **Schema** (`topic must be at least 2 characters`). The retry used `topic: "calendar"` and stopped at **Meaning** (`"2026-02-30" is not a real calendar date`). The agent then told the user that February 2026 has only 28 days.
- **"What is on the course calendar from 30 February 2026 onwards?":** the agent spotted the impossible date itself and **did not call the tool**. That is why the page's *Impossible date* prompt uses the ISO wording above.
- **"List all course deadlines from 1 January 2031." (strict):** the call stopped at **Meaning** (outside 2026-09-01 to 2026-12-31). The agent said the calendar only runs through 31 December 2026.
- **"When is the Lab 18 workshop?" (loose):** the model sent `kind: "workshop"`. The server rejected it at **Schema**, the model retried with `kind: "lab"`, and the agent answered 19 October 2026.
- **Too slow:** two calls, each aborted at about 1,510 ms. After the second timeout, the agent said the calendar was unavailable instead of guessing.
- **Throws a bug:** one call, no retry, and the answer "The course calendar is unavailable right now". The server console logged `[err_…] TypeError: Cannot read properties of undefined (reading 'date')` with the stack; the agent saw only the reference.
- **Fails once:** a temporary error, then a successful retry, and the correct date.

## Rules the page follows

```text
name not implemented              → stage name,    success: false, do not retry
arguments not a JSON object       → stage parse,   success: false, fix and retry
schema violations (all of them)   → stage schema,  success: false, fix and retry
real date / window / control chars→ stage meaning, success: false, fix and retry
same rejected arguments again     → same stage, "you already sent these", no retry invited
no answer within the deadline     → stage timeout, work aborted, try once more
TransientError                    → stage exception, try the same call once more
any other exception               → stage exception, ref err_…, do not retry; details only in the server log
every call                        → exactly one tool_result, matched by call_id
more than 4 pauses in one turn    → cancel the turn
```

## Code map

| File | Role |
| --- | --- |
| `src/lab18Validate.ts` | `strictCalendarTool` and `looseCalendarTool`; `checkSchema`, `checkMeaning`, and `validateCalendarArgs` (unknown → `CalendarArgs`); `calendarService` with faults; `withTimeout`; `runTool`; `classifyValidationRun` and `parseValidationRun` (the runtime boundary). |
| `src/lab18Tests.ts` | The 21 test cases, `runTest`, and `runSuite`. |
| `server/lab18.ts` | `runLab18` validates and runs each call inside the Lab 17 loop, and logs internals. `testLab18` runs the suite on the server and never calls OpenAI. |
| `server/index.ts` | Routes `POST /api/lab18/run`, `POST /api/lab18/test`, and `GET /api/lab18/items` (which reuses Lab 17's item reader). |
| `src/Lab18.tsx` | The pipeline, test page, custom case, live run, result, run history, code snippets, and Viva voice. |
| `src/App.tsx`, `src/styles.css`, `tsconfig.lab6.json` | The sidebar entry, Lab 18 styles, and strict type checking for the new modules. |

## Student challenge

1. Run the whole suite on the server and show **21/21 passed**.
2. In **Write your own case**, make a call that stops at **Meaning**. Then make one that has three issues and reports them all at once.
3. Ask the *Impossible date* question live. Show the rejected call, its `tool_result` with `success: false`, and what the agent did next.
4. Ask *When is the Lab 18 session?* with **Too slow** and with **Throws a bug**. Explain why one error says "try once more" and the other says "do not retry", and why neither contains a stack trace.

See [OpenAI Docs: Function tools](https://developers.openai.com/api/docs/guides/agents-api/tools/functions).
