# Lab 27 — Provide input files

Stage a CSV and a text brief in an `openai_hosted` sandbox and ask for a report that uses them and **names its source**. Each run is judged from the evidence in the session, and the report is checked line by line against this app's own analysis of the same bytes. A control run with no files shows what a report built from nothing looks like.

## Run the lab

1. Run `npm run dev` and select **Lab 27**.
2. Without an API key, explore the dataset card, the files checker (with ten recorded API answers), the four recorded runs in the inspector, and the test page. Run the tests in the browser and on the server; both should show **45/45 passed**.
3. For live sessions, add `OPENAI_API_KEY` to `.env` and restart the app. The project needs Agents API access with OpenAI-hosted environments.
4. Click **Run all three**. Each mode starts a new hosted session with network `disabled`. The sandbox takes about 20 seconds to get ready; the report takes another 10–25 seconds.

## How it was built — step by step

Follow these steps in implementation order. The teaching excerpts below are shortened from the listed source files; surrounding types, imports, guards, and UI wiring remain in those files. Read each explanation before tracing the complete handler.

### 1. Stage a file with environment.files

Source: `server/lab27.ts`.

```ts
const session = await client.beta.agents.sessions.create({
  agent: { model, instructions },
  environment: {
    type: 'openai_hosted',
    network: { access: 'disabled' },
    files: [
      { type: 'inline', path: '/workspace/data/enrollments-2c01b358.csv', data: csvBase64 },
      { type: 'inline', path: '/workspace/data/brief.txt', data: briefBase64 },
    ],
  },
});
session.environment.files  // [{ id: 'cfile_…', path, size_bytes: 1482, type: 'inline' }]
```

**Why:** Build a seeded CSV and a separate brief in `src/lab27Files.ts`, including the rule to exclude refunded rows. For the staged route, encode both files and put them in `environment.files` at absolute `/workspace/data` paths. Create the session without input, then wait for readiness before asking the agent to read them.

### 2. Encode the bytes, and respect the rules

Source: `src/lab27Files.ts`.

```ts
// Server side, Node:
const data = Buffer.from(csv, 'utf8').toString('base64');

// What the API refused live (400):
'data/sales.csv'              // must be an absolute POSIX path inside /workspace
'/tmp/sales.csv'              // same
'/workspace/../etc/x.csv'     // cannot contain empty, . or .. path components
'/workspace/data/'            // same: an empty last component
data: 'date,region,units'     // must be a standard-base64 string
data: '-__-'                  // base64url is refused too
// two entries with one path · 51+ files · data over 6,990,508 characters (~5 MiB)
```

**Why:** Add shared path, encoding, count, and size checks before any SDK call. Standard base64 transports the UTF-8 bytes; base64url or unencoded CSV is a different representation. Reject traversal and duplicate destinations so the source path in the report refers to exactly the input the app intended to provide.

### 3. Or copy a file into the live sandbox

Source: `server/lab27.ts`.

```ts
// Session created without files. On the first environment.ready:
for (const file of inlineFiles(dataset)) {
  await client.beta.agents.environments.files.create(environmentId, file);
  // → { object: 'agent.environment.file', path, size_bytes }
}
const listed = await client.beta.agents.environments.files.list(environmentId, { path: '/workspace/data' });
// then send the task with sessions.events.create
```

**Why:** Implement a second route through the same run handler: create an environment without files, wait for its first ready event, then copy the inline entries with `environments.files.create`. List the destination before sending the question. This lets students compare files supplied during provisioning with files copied into a live sandbox.

### 4. Ask for a report that names its source

Source: `src/lab27Files.ts`.

```ts
export const reportPrompt = [
  'Write a short enrollment report from the files in /workspace/data. Follow the rules in brief.txt.',
  'Start with exactly these six lines:',
  'source: <absolute path of the CSV you read>',
  'source_sha256: <SHA-256 of that file>',
  'rows_used: <number>', 'total_minutes: <number>', 'completed: <number>', 'top_lab: <lab>',
  'Then add two sentences of summary. Put the report in your reply, not only in a file.',
  'If the files are not there, say so and report no figures.',
].join('\n');
```

**Why:** Define one report prompt for staged, copied, and no-files control runs. Require source path, source hash, and four figures, and ask for the report in the reply so the checker can read it. The missing-files branch requires an honest absence report rather than invented enrollment totals.

### 5. Evidence: echo, listing, and commands

Source: `src/lab27Files.ts`.

```ts
const csvRef = session.environment.files.find((f) => f.path === dataset.csvPath);
csvRef.size_bytes === byteLength(dataset.csv);            // staged: the right bytes
listed.some((f) => f.path === dataset.csvPath);            // the API sees it in the sandbox
readBy(run.commands, dataset.csvPath, header).length > 0; // a command opened it
// Live: the first awk used the wrong columns and printed
// rows_used=39 total_minutes=2694 top_lab=L-766 (exit 0), then the agent reran it.
```

**Why:** Record three independent observations: the session file echo, the environment listing, and commands that read the source. Byte length checks the staging metadata, while `readBy` connects execution to the named CSV. Keep command failures in the trace so students can see a mistaken calculation followed by a corrected one.

### 6. Check the report against your own analysis

Source: `src/lab27Files.ts`.

```ts
const expected = analyze(dataset.csv).analysis;   // this app, same bytes
const report = parseReport(run.answer);
report.source === dataset.csvPath
  && report.sourceSha256 === sha256Hex(dataset.csv)
  && report.rowsUsed === expected.rowsUsed          // brief.txt applied
  && report.topLab === expected.topLab;
// control run, no files → 'Honest: no file, no figures'
```

**Why:** Parse the finished report and compare it with `analyze` on the same input bytes, including the brief's refund rule. Match the source path and SHA-256 as well as the figures; a plausible total from another file is not accepted. Build the React staging selector, evidence tables, four recorded runs, request samples, 45 shared cases, and narration, then compare the no-files control with both file routes.

**Check your implementation:** Use the offline cases first, then follow the live steps above when access is configured. The student challenge below names the evidence to collect; recorded or synthetic results do not verify a new live run.

## The input files

| File | Path | Role |
| --- | --- | --- |
| CSV | `/workspace/data/enrollments-<8 hex>.csv` | 36–48 rows: `enrolled_on,learner_id,lab,minutes,status` |
| Brief | `/workspace/data/brief.txt` | The one rule the data alone does not state: exclude `refunded` rows |

The dataset is generated from a seed (`makeDataset`), so every **New dataset** is new, and a recorded run can rebuild its exact CSV from its ID. You can also **Edit the CSV**. The app recomputes the expected figures, and the server repeats the checks before it stages anything.

The prompt never names the CSV. It asks for six lines, then two sentences:

```text
source: <absolute path of the CSV you read>
source_sha256: <SHA-256 of that file>
rows_used: <number>
total_minutes: <number>
completed: <number>
top_lab: <lab>
```

It also says: *Put the report in your reply, not only in a file*, and *If the files are not there, say so and report no figures.*

## Three ways to provide the files

```typescript
// Staged: the files are part of sessions.create, and are there before the agent starts.
const session = await client.beta.agents.sessions.create({
  agent: { model, instructions },
  environment: {
    type: 'openai_hosted',
    network: { access: 'disabled' },
    files: [
      { type: 'inline', path: '/workspace/data/enrollments-2c01b358.csv', data: Buffer.from(csv).toString('base64') },
      { type: 'inline', path: '/workspace/data/brief.txt', data: Buffer.from(brief).toString('base64') },
    ],
  },
});
session.environment.files; // [{ type: 'inline', id: 'cfile_…', path, size_bytes: 1482 }, …]

// Copied: the session starts empty. On the first environment.ready, copy each file in, then send the task.
await client.beta.agents.environments.files.create(environmentId, { type: 'inline', path, data });
await client.beta.agents.environments.files.list(environmentId, { path: '/workspace/data' });

// Control: the same session with no files.
```

In every mode the session is created without input, and the task is sent after `environment.ready` (as in Labs 25 and 26). Before sending it, the server calls `environments.files.list`. That listing is the API's own view of the sandbox, independent of anything the agent says.

## What the API accepted (2026-09-28)

| Request | Live result |
| --- | --- |
| `path: 'data/sales.csv'` or `'/tmp/sales.csv'` | 400 `environment.files[0].path must be an absolute POSIX path inside /workspace` |
| `path: '/workspace/../etc/sales.csv'` or `'/workspace/data/'` | 400 `environment.files[0].path cannot contain empty, . or .. path components` |
| `data` as raw text, or as base64url | 400 `environment.files inline data must be a standard-base64 string` |
| The same path twice | 400 `environment.files[1].path duplicates an earlier file path` |
| 101 files | 400 `array too long. Expected an array with maximum length 50` (30 were accepted) |
| 12 MB of data | 400 `string too long. Expected a string with maximum length 6990508` (1 MB was accepted: about 5 MiB decoded is the limit) |
| Empty `data`, a space in the path | accepted (`size_bytes: 0`; quote the path in commands) |
| `file_id` from `files.create` (`user_data`) | 400 `Hosted user_data attachments require a current file_ ID; legacy file- IDs are unsupported` |
| `file_id` from `files.create` (`assistants`) | 400 `File file-… cannot be used as a hosted-environment attachment` |
| An unknown `file_id` | 404 `File … was not found` |
| `{ type: 'none', files: [] }` | 400 `Unknown parameter: 'environment.files'.` |
| A valid inline file | accepted; the session echoed `path`, a `cfile_` ID, and `size_bytes`, never the contents |

`checkRequest` predicts each of these. **Send it anyway** sends a request the checker refuses, so you can compare the API's answer with the checker's. Requests the checker accepts are not sent, because they would provision a sandbox. Deleting a hosted session straight after creating it returned 409 `hosted session provisioning or resource creation has not settled` (Lab 30).

## What happened live

| Run | Files | Ready | Total | Commands | Verdict |
| --- | --- | --- | --- | --- | --- |
| Staged, dataset `2c01b358` | `environment.files` | 23.2 s | 47.5 s | 4 | Grounded report |
| Copied, dataset `2c01b358` | `environments.files.create` | 19.7 s | 41.1 s | 4 | Grounded report |
| Control, no files | — | 16.6 s | 29.6 s | 2 | Honest: no file, no figures |
| Staged, dataset `7bd9ca06`, first prompt | `environment.files` | 18.5 s | 45.6 s | 5 | Report saved in the sandbox, not in the answer |

- Both staging routes gave the same report. The path and `source_sha256` matched the staged bytes, every figure matched, and the 5 refunded rows were excluded. Each copy with `environments.files.create` took about 1.3 s.
- In the staged run, the agent's first `awk` used the wrong columns. It printed `rows_used=39 total_minutes=2694 top_lab=L-766` with exit code 0. It noticed and reran with the right columns. **Read the output, not only the exit code**, as in Lab 26.
- The control agent listed `/workspace`, printed its own `DATA_DIRECTORY_MISSING` marker, and replied that the files were missing, with no figures.
- With the first prompt, the agent computed everything correctly but wrote the report to `/workspace/outputs/enrollment_report.txt`. Its reply was only a Markdown link. The judge finds the report in a command's output and marks the run incomplete. Lab 29 downloads generated files.
- `rg` is not installed in the sandbox. Several first commands printed `rg: command not found` and the agent fell back to `find`.
- `environment.ready` arrived twice in every session. The server stages files and sends the task on the first one only.
- Usage was `null` in every live run, even after retrieving the turn. It is shown as unknown, not zero (Lab 15).

## Judge a run

`judgeFileRun` reads only the session's evidence:

- **Files in the environment**: `session.environment.files` (staged) or the `environments.files.create` responses (copied) must list the CSV at exactly the byte size this app sent, and the brief. `environments.files.list` is shown beside them.
- **Read by a command**: a `command_execution` item that names the file and printed something, or whose output contains the CSV header or the brief's title. A `find` listing is not a read.
- **Names its source**: `source:` is the absolute staged path, and `source_sha256` matches the SHA-256 of the staged bytes.
- **Figures**: `rows_used`, `total_minutes`, `completed`, and `top_lab` match `analyze(csv)`.
- **Followed brief.txt**: figures that include refunded rows are recognised as such.
- **Grounded**: the figures appear in some command's output.

Outcomes: grounded report, honest (control), right figures but source not named, read the CSV but ignored the brief, wrong figures, invented (figures without a file, or without reading it), incomplete (including a report saved only to a file), and failed.

## Code map

| File | Role |
| --- | --- |
| `src/lab27Files.ts` | Seeded dataset, CSV analysis, base64, files request checker, report parser, evidence judge. Shared by browser and server. |
| `src/lab27Scenarios.ts` | Four recorded runs and ten recorded API answers. |
| `src/lab27Tests.ts` | 45 offline cases shared by the browser and server. |
| `server/lab27.ts` | The live run (staged, copied, or control), the file listing, the refused-request probe, the quiet-stream fallback, and best-effort usage. |
| `src/Lab27.tsx` | Dataset card, files checker, live runs, result grid, report and file tables, inspector, tests, and narration. |

**View code** contains six explained snippets. **Viva voice** uses browser speech synthesis to read one explanation or all six; it does not call an audio API.

Hosted sessions remain in the project until they are deleted. Lab 30 covers the environment lifecycle and cleanup.

## Student challenge

1. Show **45/45 passed** on the server test page.
2. In the files checker, predict and then load *A .. escape* and *base64url data*. Send one of them anyway and compare the API's 400 with the checker.
3. Click **Run all three**. For both grounded reports, show that the path and SHA-256 match the dataset card, and that `size_bytes` matches what the app sent. For the control run, name the command that shows the files were missing.
4. Click **Edit the CSV**, change one refunded row to `completed`, predict the new figures, and run the staged mode again.
