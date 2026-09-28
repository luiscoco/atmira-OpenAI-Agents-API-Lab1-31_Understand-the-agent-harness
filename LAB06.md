# Lab 06 — Move the app to TypeScript

Lab 06 builds on [Lab 05](LAB05.md). The React pages and Node server now use `.tsx` and `.ts` source files. The build runs TypeScript checks before Vite bundles the app.

## Learning goals

1. Describe a browser request and a streamed event with TypeScript types.
2. Narrow a discriminated event union by its `type` field.
3. Treat parsed JSON as `unknown` and validate it before updating React state.
4. Run a typecheck and explain the difference between build-time and runtime checks.

## Run the lab

Use Node.js 22 or newer. Run `npm ci`, add `OPENAI_API_KEY` to a private `.env` file, then run `npm run dev`. Open <http://localhost:5173> and select **Move to TypeScript**. The live tutor uses the existing Lab 02 server route (`/api/lab2/run`) and keeps the API key on the server.

Run `npm run typecheck` to check the full application and, under strict mode, the teaching modules. Run `npm run build` to typecheck and create the production bundle.

## How it was built — step by step

### 1. Rename the files and add the TypeScript toolchain

```json
// package.json
"scripts": {
  "dev": "tsx server/index.ts",
  "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.lab6.json",
  "build": "npm run typecheck && vite build",
  "start": "tsx server/index.ts --production"
}
```

```json
// tsconfig.json (the whole app)
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "jsx": "react-jsx", "allowImportingTsExtensions": true,
    "strict": false, "noEmit": true, "types": ["node", "vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "server/**/*.ts"]
}
```

**Why:** Every `.js`/`.jsx` source file became `.ts`/`.tsx`. `tsx` runs the Node server directly from TypeScript, so there is no separate compile step in development. Vite compiles the React code. `tsc --noEmit` only **checks** types and writes no files. `npm run build` runs it first and stops on any type error before Vite bundles the app. The whole app starts with `strict: false` so the migration could happen in one lab without rewriting every earlier file.

### 2. Apply strict mode to the teaching modules

```json
// tsconfig.lab6.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "strict": true },
  "include": ["src/Lab6.tsx", "src/lab6Protocol.ts", "src/speech.ts", "src/lab11TextBuffer.ts", "…"]
}
```

**Why:** Strict mode turns on the checks that matter most, such as `null` handling and implicit `any`. A second config extends the first and switches strict mode on for a chosen list of files. It started with the Lab 06 files. Every later lab has added its pure logic modules (for example `src/lab17Action.ts` and `src/lab18Validate.ts`), so the code that the course teaches is always checked strictly.

### 3. Type the request and the streamed events

```ts
// src/lab6Protocol.ts
export type RunRequest = { prompt: string; instructions: string; sessionId?: string };

export type RunEvent =
  | { type: 'status'; label: string }
  | { type: 'session'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'complete' }
  | { type: 'error'; message: string };
```

**Why:** `RunRequest` describes what the browser sends to the server. `RunEvent` is a **discriminated union**: every member has a literal `type`, and that field decides which other fields exist. This small union is the course's own protocol between server and browser. It is not the Agents API's event list, which the server translates into these five shapes.

### 4. Validate unknown JSON at the runtime boundary

```ts
// src/lab6Protocol.ts
export function parseRunEvent(value: unknown): RunEvent {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    throw new Error('Stream event must be an object with a type.');
  }
  const event = value as Record<string, unknown>;
  switch (event.type) {
    case 'status':
      if (typeof event.label === 'string') return { type: 'status', label: event.label };
      break;
    case 'session':
      if (typeof event.sessionId === 'string' && /^sess_[A-Za-z0-9_-]+$/.test(event.sessionId)) {
        return { type: 'session', sessionId: event.sessionId };
      }
      break;
    case 'text':
      if (typeof event.text === 'string') return { type: 'text', text: event.text };
      break;
    case 'complete':
      return { type: 'complete' };
    case 'error':
      if (typeof event.message === 'string') return { type: 'error', message: event.message };
      break;
  }
  throw new Error(`Invalid streamed event: ${String(event.type)}.`);
}
```

**Why:** TypeScript types disappear when the code runs. `JSON.parse` can return anything, so its result is typed `unknown`, which forces a check before use. `parseRunEvent` checks every required field and builds a **new** object with only the known fields. It returns a `RunEvent` only when the data really has that shape, and throws otherwise. Later labs follow the same pattern for every server summary: `parseActionRun`, `parseValidationRun`, and others.

### 5. Read the stream through the validator

```ts
// src/lab6Protocol.ts, inside streamRun
for (const line of lines) {
  if (!line.trim()) continue;
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { throw new Error('The server sent invalid JSON.'); }
  const event = parseRunEvent(raw);
  onEvent(event);
  if (event.type === 'error') throw new Error(event.message);
  if (event.type === 'complete') completed = true;
}
// …after the loop
if (!completed) throw new Error('The stream closed before a completed turn. Retrieve session state before retrying.');
```

**Why:** This is Lab 01's NDJSON reader, now typed. Each line goes `string → unknown → RunEvent`, and the callback only ever receives validated events. The non-JSON case and the "no completed event" case each produce their own clear message.

### 6. Type React state and narrow the union

```tsx
// src/Lab6.tsx
const [sessionId, setSessionId] = useState<string | null>(null);
const [events, setEvents] = useState<RunEvent[]>([]);

const request: RunRequest = { prompt: prompt.trim(), instructions: 'You are a concise TypeScript tutor.' };
await streamRun(request, (event) => {
  setEvents((previous) => [...previous, event]);
  if (event.type === 'status') setStatus(event.label);
  if (event.type === 'session') setSessionId(event.sessionId);
  if (event.type === 'text') { setAnswer(event.text); setStatus('Streaming answer'); }
  if (event.type === 'complete') setStatus('Completed');
});
```

**Why:** The explicit state types say that the session ID can be `null` and that the event list holds `RunEvent`s. Inside each `if`, TypeScript **narrows** `event` to one member of the union. So `event.sessionId` is only available after checking `type === 'session'`, and reading `event.text` there would be a compile error.

### 7. Show the runtime boundary in the page

```tsx
// src/Lab6.tsx
const sampleJson = sample === 'valid'
  ? '{"type":"text","text":"Hello from a typed event"}'
  : '{"type":"text","message":"Missing text"}';
let sampleResult: string;
try { sampleResult = `Accepted: ${parseRunEvent(JSON.parse(sampleJson)).type} event`; }
catch (caught) { sampleResult = caught instanceof Error ? caught.message : 'Invalid event'; }
```

**Why:** The **Runtime boundary** panel runs the same validator on two samples. The second one is valid JSON that the compiler could never see, because it only exists at runtime. `parseRunEvent` rejects it. This is the difference between build-time checks (your code) and runtime checks (other people's data). `AnswerPre`, exported from this file, highlights TypeScript and JavaScript code in answers, and later labs reuse it.

### 8. Teach the code

**View code** holds four explained snippets: type the request and state, check unknown data, narrow the union, and typecheck before building. Each has a **Viva voice · Read aloud** button that uses browser speech synthesis.

## Exercises

1. Run the default tutor question. Watch the typed `status`, `session`, `text`, and `complete` events appear under the answer.
2. In the runtime boundary panel, select **Missing text**. The JSON is syntactically valid, but `parseRunEvent` rejects it because a text event needs a string `text` field.
3. Open **View code**. Read the four snippets and use **Viva voice · Read aloud** to hear each explanation through browser speech synthesis. No audio API call is made.
4. In `src/lab6Protocol.ts`, temporarily change the returned text event to use `message` instead of `text`. Run `npm run typecheck`, observe the error, and undo the change.
5. Explain why the compiler catches the edit in step 4 but only the runtime parser can reject the malformed JSON in step 2.

## Code map

| File | Role |
| --- | --- |
| `src/lab6Protocol.ts` | Defines the typed request and event union, validates unknown stream values, and reads NDJSON. |
| `src/Lab6.tsx` | Uses typed React state and event narrowing; renders the exercises, snippets, and Viva voice controls. Exports `AnswerPre`. |
| `src/App.tsx` | Adds Lab 06 navigation. |
| `server/index.ts` | Keeps the Agents API request and streaming logic on the server. |
| `package.json` | `typecheck` runs both configs; `build` typechecks before bundling. |
| `tsconfig.json`, `tsconfig.lab6.json` | Check the whole app, and apply strict checking to the teaching modules (extended by every later lab). |

See [OpenAI Docs: Events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events) for the underlying Agents API event stream. The browser receives a smaller, course-specific event union from this app's server.
