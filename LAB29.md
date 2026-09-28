# Lab 29 — Create and download artifacts

Ask a hosted agent to save its work under `/workspace/outputs`. When the turn completes, list what it published, choose the right file by turn and path, download it through the Node server, and verify it before the user opens it.

## Run the lab

1. Run `npm run dev` and select **Lab 29**.
2. Without an API key, you can use the publish planner, the four recorded runs (their download buttons save the recorded bytes and check their hash), the identify table, the eleven recorded API answers, and the test page. Run the tests in the browser and on the server; both should show **52/52 passed**.
3. For live sessions, add `OPENAI_API_KEY` to `.env` and restart the app. The project needs Agents API access with OpenAI-hosted environments.
4. Click **Run all four**. In live runs, each sandbox took 19–27 s to become ready. Each run took 50–70 s in total.

## How it was built — step by step

Follow these steps in implementation order. The teaching excerpts below are shortened from the listed source files; surrounding types, imports, guards, and UI wiring remain in those files. Read each explanation before tracing the complete handler.

### 1. Ask for outputs in /workspace/outputs

Source: `src/lab29Artifacts.ts`.

```ts
// The prompt names the directory; the platform does the rest.
'Create /workspace/outputs/enrollment-report.md …'
'Create /workspace/outputs/tables/minutes-by-lab.csv …'
'Write your working notes to /workspace/scratch/notes.txt.'

isPublishable('/workspace/outputs/tables/minutes-by-lab.csv') // true
isPublishable('/workspace/scratch/notes.txt')                // false
// Live: 3 artifacts. notes.txt (520 bytes) was never one.
```

**Why:** Reuse the seeded dataset from Lab 27 and define four tasks in `src/lab29Artifacts.ts`: publish, write elsewhere, revise, and cancel. Name `/workspace/outputs` in the prompt for deliverables and `/workspace/scratch` for working notes. `isPublishable` lets the planner explain the path rule before an agent runs.

### 2. List after the turn completes

Source: `server/lab29.ts`.

```ts
// No stream event announces an artifact. Wait for turn.completed, then list.
for await (const item of client.beta.agents.sessions.artifacts.list(sessionId, { order: 'asc', limit: 100 })) {
  artifacts.push(item);
}
// { id: 'artifact_6557…', path: '/workspace/outputs/enrollment-report.md',
//   size_bytes: 229, turn_id: 'turn_03ba…', environment_id: 'ccarenv_…', created_at: … }
// Live: listed 0.2–0.6 s after turn.completed. limit 101 → 400.
```

**Why:** Implement hosted runs in `server/lab29.ts`, waiting for readiness and following each root turn to its outcome. After completion, iterate the artifact listing instead of expecting an artifact stream event. Preserve IDs, paths, turn IDs, and byte sizes so the browser can display the published inventory.

### 3. Identify by turn_id and path

Source: `src/lab29Artifacts.ts`.

```ts
export const pick = (artifacts, turnId, path) =>
  artifacts.find((item) => item.turnId === turnId && item.path === path) ?? null;

// Live, after a second turn rewrote the report:
// turn 1  enrollment-report.md  230 bytes  artifact_80f3…
// turn 1  summary.json           88 bytes  (not published again in turn 2)
// turn 2  enrollment-report.md  242 bytes  artifact_c72a…
firstByPath(artifacts, reportPath)       // artifact_80f3…  the old one
pick(artifacts, turn2, reportPath)       // artifact_c72a…  the revision
```

**Why:** Add selectors for the first path, latest path, and exact turn/path pair. The shared model normalizes the API's `turn_id` to `turnId`; `pick` uses that normalized value. Revision creates a separate immutable artifact, so choosing only by path can hand the student an earlier report.

### 4. Download through your server

Source: `server/lab29.ts`.

```ts
const artifact = await client.beta.agents.sessions.artifacts.retrieve(id, { session_id });
checkDownload(artifact)            // size first: 413 over this proxy's limit
const result = await client.beta.agents.sessions.artifacts.content(id, { session_id });
// Live: content-type application/octet-stream, for Markdown and JSON alike.
response.writeHead(200, {
  'Content-Type': mimeFor(artifact.path),          // text/markdown; charset=utf-8
  'Content-Disposition': 'attachment; filename="enrollment-report.md"',
  'X-Content-Type-Options': 'nosniff',
});
```

**Why:** Add an artifact proxy that accepts only sessions created by this server process. Retrieve metadata and apply `checkDownload` before fetching content, then choose the content type and a sanitized attachment filename. `nosniff` and attachment delivery keep agent-written files out of the app's executable page context; the full handler also includes a SHA-256 header.

### 5. Verify before you hand it over

Source: `src/lab29Artifacts.ts`.

```ts
verifyDownload(artifact, download)
// 229 bytes = size_bytes · sha256 9f5ed92a3268…

reportFigures(text, analyze(csv))
// ✓ rows_used 30  ✓ total_minutes 2079  ✓ completed 17  ✓ top_lab lab22
summaryFigures(json, analysis)   // valid JSON; "39" is not 39
tableFigures(csv, dataset.csv)   // every lab's total

// In the browser, too: crypto.subtle.digest('SHA-256', blob) === X-Artifact-Sha256
```

**Why:** Check delivery and content separately: byte count and SHA-256 detect a damaged download, while `reportFigures`, `summaryFigures`, and `tableFigures` compare the report with the independent dataset analysis. The browser also hashes the downloaded bytes with `crypto.subtle.digest`. Finish the React previews, identify table, verified downloads, delivery manifest, four recorded runs, 52 shared cases, and narration.

### 6. Cancelled turns and deleted copies

Source: `server/lab29.ts`.

```ts
// A cancelled turn publishes nothing. Live:
// printf 'draft' > /workspace/outputs/draft.md && sleep 120   → cancelled after 8 s
// environments.files.list: draft.md 6 bytes   sessions.artifacts.list: nothing

await client.beta.agents.sessions.artifacts.delete(id, { session_id });
// { object: 'agent.session.artifact.deleted', deleted: true }
// retrieve / content → 404 Session artifact … was not found
// environments.files.list → summary.json, 88 bytes: the sandbox copy is untouched
```

**Why:** Implement explicit cancellation for the unfinished task and a separate published-artifact delete route. Cancellation can leave a draft in the live sandbox without publishing it, while deleting an artifact removes the immutable copy and leaves its sandbox file. Show both listings so students can explain these different outcomes before proceeding to session cleanup in Lab 30.

**Check your implementation:** Use the offline cases first, then follow the live steps above when access is configured. The student challenge below names the evidence to collect; recorded or synthetic results do not verify a new live run.

## The rule

```typescript
// 1. The prompt names the directory.
'Create /workspace/outputs/enrollment-report.md …'
// 2. After turn.completed (no event announces artifacts), list them.
for await (const artifact of client.beta.agents.sessions.artifacts.list(sessionId, { order: 'asc', limit: 100 })) { … }
// { id: 'artifact_…', path: '/workspace/outputs/enrollment-report.md', size_bytes: 229, turn_id: 'turn_…', environment_id, created_at }
// 3. Choose by turn and path.
const report = artifacts.find((a) => a.turn_id === turnId && a.path === '/workspace/outputs/enrollment-report.md');
// 4. Download the immutable bytes.
const response = await client.beta.agents.sessions.artifacts.content(report.id, { session_id: sessionId });
```

- Only files under `/workspace/outputs` are published, including files in subdirectories such as `tables/minutes-by-lab.csv`. The OpenAI documentation limits each file to 200 MiB and each turn to 500 MiB; this lab has not tested those limits live.
- Publishing happens **only when the turn completes**. Each artifact is a frozen copy, and it remains available after the sandbox expires.
- Environment files (`environments.files.list`) are live and exist only while the sandbox exists. Artifacts are the files the user can download.

Every task stages a Lab 27 dataset (a CSV and `brief.txt`) with network access `disabled`.

## Four tasks

| Task | What it asks | What happened live |
| --- | --- | --- |
| Write to /workspace/outputs | Report, `summary.json`, `tables/minutes-by-lab.csv` in outputs; notes in `/workspace/scratch` | 3 artifacts, listed 0.2 s after `turn.completed`; `notes.txt` (520 bytes) stayed in the sandbox |
| Write somewhere else | The same prompt with `/workspace/reports` | Correct files, **no artifacts** |
| Write, then revise | Turn 2 adds `revision: 2` to the report | A new artifact (242 bytes) with a new ID. The turn-1 copy (230 bytes) did not change, and `summary.json` was not published again |
| Cancel mid-turn | `printf "draft\n" > /workspace/outputs/draft.md && sleep 120` | The server cancelled after 8 s. `draft.md` (6 bytes) was in outputs but was not published |

## What the API did (2026-09-28)

| Call | Result |
| --- | --- |
| Event stream for a whole turn | No artifact event |
| `artifacts.list` after `turn.completed` | Already populated after 0.2–0.6 s |
| `artifacts.content` | 200, `content-type: application/octet-stream` for Markdown, JSON, and CSV, `cache-control: private, no-store` |
| `content` of the turn-1 report after the live file changed | The same 294 bytes and the same SHA-256 |
| `artifacts.delete` | `{ object: 'agent.session.artifact.deleted', deleted: true }` |
| `retrieve` or `content` after delete | 404 `Session artifact … was not found`; the sandbox file was still 88 bytes |
| An unknown artifact ID | 404 `Session artifact artifact_doesnotexist was not found` |
| A real artifact with another session ID | 404 `No managed agent resource found: sess_…` |
| `list` with `limit: 101` | 400 `limit must be between 1 and 100` |

## Download through the server

The browser never has the API key. `GET /api/lab29/artifact?session=…&artifact=…` does the following:

1. The server accepts only well-formed IDs and **only sessions this server process created** (403 otherwise).
2. It reads the metadata first with `artifacts.retrieve`. `checkDownload` rejects a malformed ID (400), missing size information (502), or a file larger than this lab's 20 MiB buffer (413). A production server would stream large files instead.
3. It gets the bytes with `artifacts.content`.
4. It sends the file with `mimeFor(path)`, a `safeFilename` (the base name with only letters, digits, `._-`, and no leading dot), `Content-Disposition: attachment`, and `X-Content-Type-Options: nosniff`. HTML, SVG, XML, and JavaScript are always sent as `application/octet-stream`, so agent-written code cannot run in this app. The response also includes `X-Artifact-Sha256`.

The browser hashes the downloaded blob with `crypto.subtle` and shows whether its size and SHA-256 match. `POST /api/lab29/delete` deletes the published copy. It then shows the 404 and the sandbox copy that remains.

## Judge a run

`judgeArtifactRun` uses only the evidence:

- **Turn outcome**: completed, or cancelled on purpose.
- **Artifacts from this turn**: `turn_id` matches the last turn; the listing time is shown.
- **Sandbox only**: files in `environments.files.list` with no artifact from any turn.
- **Identified by turn and path** (revise): in ascending order, the path alone finds the turn-1 copy.
- **Downloaded bytes**: each download's byte count equals `size_bytes`.
- **Report figures, summary.json, minutes-by-lab.csv**: compared with `analyze()` on the same CSV.
- **Paths in the reply**: sandbox paths are not URLs. The page turns published paths into download buttons and labels other paths as *sandbox only*.

Outcomes are: delivered, revised, unpublished, abandoned, partial, wrong (published but wrong), corrupt (bytes do not match), incomplete, and failed. **Delivery manifest** downloads JSON with the session, turn, and each artifact's ID, path, size, SHA-256, and content type.

## Code map

| File | Role |
| --- | --- |
| `src/lab29Artifacts.ts` | Tasks and prompts, the publish rule and planner, `pick`/`firstByPath`/`latestByPath`, MIME types, file names, headers, download checks, figure checks, link resolution, the run parser, the judge, and the manifest. Shared by the browser and the server. |
| `src/lab29Scenarios.ts` | Four recorded runs through this lab's server, and eleven recorded API answers. |
| `src/lab29Tests.ts` | 52 offline cases, with the live probe's IDs and bytes as fixtures. |
| `server/lab29.ts` | Multi-turn runs (one stream per turn), the timed cancel, artifact listing after each turn, the sandbox listing, downloads with SHA-256, the download proxy, delete, and the suite endpoint. |
| `src/Lab29.tsx` | Planner, live runs, result grid, artifact and sandbox tables, report preview, identify table, inspector, API table, tests, and narration. |

**View code** contains six explained snippets. **Viva voice** uses browser speech synthesis to read one explanation or all six. It does not call an audio API.

Artifacts remain in the project until you delete them. Lab 30 covers session and environment cleanup.

## Student challenge

1. Show **52/52 passed** on the server test page.
2. In the planner, predict which of your files can be downloaded. Then add a 250 MiB file.
3. Click **Run all four**. From the outputs run, download the report and show that the browser reports *sha256 matches*. Name the file that stayed in the sandbox.
4. In the revise run, use the identify table to show which artifact the path alone would return.
5. Explain from the cancel run's sandbox listing why `draft.md` was never published.
6. Delete the summary's published copy. Show the 404 and the sandbox copy that remains.
