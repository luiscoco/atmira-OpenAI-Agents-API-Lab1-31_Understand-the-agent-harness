# OpenAI Agents API: Labs 01–56

This React and Node app introduces the OpenAI Agents API through 56 hands-on labs. The Node server keeps the API key private and streams agent responses to the browser.

Lab 56 now includes connected official web/MCP research and a hosted profile with staged sources and native research/report skills. Lab 25 includes the unavailable-MCP comparison exercise. See [CAPSTONE_INTEGRATIONS.md](CAPSTONE_INTEGRATIONS.md) for the implementation and verification workflow.

## How it was built — step by step

This overview follows the implemented application. Open each linked lab guide for its detailed steps, important code excerpts, explanations, and student checks. Labs 01–56 now have implemented course exercises; runtime and deployment evidence boundaries are recorded in each guide.

### 1. Build the React and Node shell

Use `src/main.tsx` to mount `src/App.tsx`, put lab pages in `src/`, and route browser requests through `server/index.ts`. Load configuration in `server/env.ts` before lab modules initialize. Install with `npm ci`, configure `.env` from `.env.example`, and start with `npm run dev`.

```ts
// server/index.ts
import './env.ts';
```

**Why:** Import order makes server configuration available when modules start. The browser calls local routes; the server owns the OpenAI key and SDK clients.

### 2. Start with sessions and streamed tutor answers

Follow [Lab 01](LAB01.md), then add continuation, lifecycle inspection, recovery, and session history in [Labs 02–05](LAB02.md).

```ts
// server/index.ts, first-turn request excerpt
stream = await client.beta.agents.sessions.create({
  agent, environment: { type: 'none' }, input: prompt, stream: true,
});
```

**Why:** This request creates a fresh session and its first turn. The handler translates SDK events to NDJSON for React; root completion determines success. Lab 02 adds follow-ups to the same session.

### 3. Add types, reusable configuration, and reliable rendering

Use [Lab 06](LAB06.md) for runtime validation and the two TypeScript configurations, [Labs 07–10](LAB07.md) for saved agents and contracts, and [Labs 11–15](LAB11.md) for text buffers, timelines, recovery, controls, and usage.

```json
{
  "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.lab6.json",
  "build": "npm run typecheck && vite build"
}
```

**Why:** These `package.json` script entries check types before bundling. Runtime parsers still validate incoming JSON because TypeScript types are erased during execution.

### 4. Connect tools, search, MCP, and a reusable plugin

Build function execution and approval gates in [Labs 16–20](LAB16.md), then search and MCP in [Labs 21–24](LAB21.md). [Lab 25](LAB25.md) packages the documentation skill and server into the included plugin. Inspect tool calls and results, check source links, and keep credentials on the server.

### 5. Add hosted compute, inputs, outputs, and cleanup

Follow [Lab 26](LAB26.md) to choose compute, [Lab 27](LAB27.md) to stage files, and [Lab 28](LAB28.md) to configure packages and network. [Lab 29](LAB29.md) delivers verified artifacts; [Lab 30](LAB30.md) retains needed outputs and verifies session deletion. Hosted handlers wait for environment readiness before sending work that needs the sandbox.

### 6. Make each implementation inspectable and teachable

Later labs share pure helpers between live handlers, browser inspectors, and offline cases. React teaching cards explain key snippets and use `src/speech.ts` for Viva voice narration. Run the relevant offline suites and `npm run build`, then collect the live evidence named in each student challenge. Course sequencing and recording targets are documented separately in [the curriculum](CURRICULUM.md) and [the recording plan](COURSE_RECORDING_PLAN.md).

## Lab 01 — Create your first agent

Build a programming tutor with a model and instructions. Each question creates a new session, and the app displays the answer as events arrive. The lab introduces agents, sessions, turns, and streaming, with code explanations in the interface. See [LAB01.md](LAB01.md) for the implementation walkthrough and key code snippets.

## Lab 02 — Continue and customize

Ask follow-up questions in the same session so the tutor can use earlier messages as context. Then edit the tutor's instructions and start a new session to compare its answers. See [LAB02.md](LAB02.md) for the walkthrough.

## Lab 03 — Inspect the lifecycle

Use the live event inspector to compare session, turn, event, and saved item IDs, and read the turn outcome. See [LAB03.md](LAB03.md) for the exercise.

## Lab 04 — Handle interrupted work

Inspect API errors, cancellation, and a simulated stream disconnect. Retrieve saved session state before retrying. See [LAB04.md](LAB04.md) for the walkthrough.

## Lab 05 — Manage sessions

List, retrieve, and delete sessions in a paginated history view. The teaching section includes explained code snippets and Viva voice read-aloud controls. See [LAB05.md](LAB05.md) for the walkthrough.


## Lab 06 — Move to TypeScript

Run the typed tutor, inspect validated streamed events, and test a malformed event at the runtime boundary. The teaching section has four explained snippets and Viva voice read-aloud controls. See [LAB06.md](LAB06.md) for the walkthrough.

## Lab 07 — Save and reuse an agent

Create a named tutor preset, retrieve it after a reload, and use its `agent_id` for two new sessions. The teaching section has explained code snippets and Viva voice controls. See [LAB07.md](LAB07.md) for the walkthrough.

## Lab 08 — Override one session

Use the same saved agent for a baseline session and a session with appended instructions. Compare their results, then retrieve the saved preset to verify it is unchanged. The teaching section has explained code snippets and Viva voice controls. See [LAB08.md](LAB08.md) for the walkthrough.

## Lab 09 — Compare models and reasoning settings

Run the same setup and follow-up prompts in two sessions. Update one session's model and reasoning effort before its follow-up, then compare answers, latency, and available usage in a downloadable worksheet. The teaching section includes explained code snippets and Viva voice controls. See [LAB09.md](LAB09.md) for the walkthrough.

## Lab 10 — Design an output contract

Generate a study plan from a saved tutor preset, validate every field on the server, and inspect one repair attempt when output is malformed. An offline playground demonstrates both rejection and acceptance. The teaching section includes explained code snippets and Viva voice controls. See [LAB10.md](LAB10.md) for the walkthrough.

## Lab 11 — Render text events correctly

Stream one answer through a naive renderer and a keyed text buffer side by side. Deltas are kept per content part, replayed events are skipped, and each part is replaced by its completed text. A step-through replayer needs no API key and shows interleaved parts, commentary, and a replayed delta. The teaching section includes five explained snippets and Viva voice controls. See [LAB11.md](LAB11.md) for the walkthrough.

## Lab 12 — Build a turn timeline

Record every event of a live session as metadata and group it by turn: a session lane, one lane per root or subagent turn, and numbered events in arrival order. Send a follow-up to add a second turn to the same session. A step-through replayer needs no API key and shows text deltas without a `turn_id`, two turns in one session, a subagent turn inside the root turn, and a failed turn with replayed and late events. The teaching section includes six explained snippets and Viva voice controls. See [LAB12.md](LAB12.md) for the walkthrough.

## Lab 13 — Recover after a disconnect

Break a live stream with a simulated drop, the Disconnect button, or a page reload, and recover without repeating input. The page saves a pending request with a request ID before sending. The server tags the work with that ID, using session metadata or an `Idempotency-Key`. After a disconnect, the page reads the saved session, turns, and items. It then reattaches to a running turn, shows a saved answer, or sends again with the same ID. A recovery playground needs no API key and walks through six cases, including a blind retry that duplicated a question. The teaching section includes six explained snippets and Viva voice controls. See [LAB13.md](LAB13.md) for the walkthrough.

## Lab 14 — Cancel and steer a turn

Start a long answer, then act on it while it streams. **Cancel turn** sends `agent.session.input.cancel`, and the turn ends as cancelled with its unpublished text abandoned. **Steer** sends an ordinary message while the turn is active, and it joins the same turn instead of starting a new one. **Stop reading** only closes the page's stream: the agent keeps working, and **Follow the turn again** reattaches without sending anything. The API answers 202 Accepted to a cancel or a steer, so the page reads the saved turn and gives each control a verdict: cancelled, too late, steered, new turn, rejected, or kept running. A run state strip and stream markers show where each control landed. A control playground needs no API key and steps through six cases. The teaching section includes six explained snippets and Viva voice controls. See [LAB14.md](LAB14.md) for the walkthrough.

## Lab 15 — Show usage and duration

End every run with a summary a person can trust. Choose how a run ends: normal, cancelled after 160 characters, an unknown model, or stopped reading early. The summary then shows its tokens (input, cached, output, reasoning, total), where the time went, consistency checks, and error details with retry advice. Usage is best effort, so missing usage is shown as **unknown**, never 0. The page re-reads the saved turn because recorded usage may change. The run history sets an honest total (`≥`, with unknown runs counted) beside a naive total that adds `null` as 0. A playground needs no API key and walks through seven runs. The teaching section includes six explained snippets and Viva voice controls. See [LAB15.md](LAB15.md) for the walkthrough.

## Lab 16 — Declare a function tool

Give the agent a course-calendar lookup it can ask for. Edit a function tool's name, description, and JSON Schema. A linter blocks errors and warns about weak wording, and the page shows exactly what the server sends in `agent.tools`. Then run a question and watch the agent's request arrive: a `function_call` item with a `call_id` and arguments, followed by `agent.session.requires_action`. The page parses the arguments and compares them with the schema. The run is then cancelled, or left waiting so you can read the saved session's `required_actions`. Compare well-described, vague, loose, and absent tools in a run history. A playground needs no API key and walks through six cases. The teaching section includes six explained snippets and Viva voice controls. See [LAB16.md](LAB16.md) for the walkthrough.

## Lab 17 — Complete a required action

Finish the loop Lab 16 started. The server detects `agent.session.requires_action`, reads the waiting calls from `required_actions`, checks each name and its arguments, runs the course-calendar lookup, and sends `agent.session.input.tool_result` with the same `call_id` and `turn_id`. It then keeps reading the same stream until the agent answers. Choose **Run the function** or **Report a failure** (`success: false` with an error), and **Answer automatically** or **Step through**, which stops at the pause until you press the button. The result shows a five-stage flow, a timed trace (prompt → call → result → answer), each call paired with the event that answered it, and the saved session items. A function bench and a six-case playground need no API key. The teaching section includes six explained snippets and Viva voice controls. See [LAB17.md](LAB17.md) for the walkthrough.

## Lab 18 — Validate tool inputs

Protect the function behind the tool. Arguments stay `unknown` until they pass three layers of checks: **parse**, **schema** (enum, lengths, pattern, no extra fields, every issue reported with a path), and **meaning** (real dates, the course window, no control characters). Only then does the function receive a typed `CalendarArgs`. The calendar service runs with a 1,500 ms deadline that aborts slow work. Exceptions are caught and sent as `success: false` with retry guidance, while stack traces stay in the server log under a reference ID. In a live run, choose how the service behaves (works, too slow, throws a bug, fails once) and whether the model sees a strict or a loose schema. The server always validates strictly. A tool test page runs 21 valid and failing cases in the browser or on the server, with no API key. The teaching section includes six explained snippets and Viva voice controls. See [LAB18.md](LAB18.md) for the walkthrough.

## Lab 19 — Connect a read-only service

Put a real external API behind a tool. The free, keyless Open-Meteo weather service is wrapped in one narrow function, `get_weather_forecast`: the model chooses a city, 1–7 days, and the units, and the server chooses everything else. It builds the request with `URLSearchParams`, checks every request against an allowlist (HTTPS, `GET` only, fixed hosts and paths, no redirects), puts one 4 s deadline on the whole call, validates the response so shape drift is caught, and returns a small result with its source, fetch time, and resolved place. Validated responses are cached for 10 minutes. A service probe shows the real requests, the raw responses, and the narrowed output without an OpenAI key. A test page runs 18 cases against recorded responses with no network. In a live run, choose live or recorded data, a fault (too slow, unreachable, HTTP 503, shape changed), or no tool at all, and a grounding check compares every number in the answer with the data. The teaching section includes six explained snippets and Viva voice controls. See [LAB19.md](LAB19.md) for the walkthrough.


## Lab 20 — Approve a write action

Let the agent change something, but only with a person's approval. The agent manages a simulated study planner: `list_study_events` runs at once, while `reschedule_study_event` and `cancel_study_event` pause the turn until the student decides. Invalid changes (impossible dates, staff events, outside study hours) are refused before anyone is asked. The approval card shows a before → after preview computed by the server, clash warnings, the agent's reason labelled as unverified, a countdown, and a confirmation step for cancellations. The decision is bound to the exact arguments by a SHA-256 digest and made once. The server re-checks expiry and the event version before running its own stored arguments, records every step in an append-only audit log, and resumes the same turn with a tool result that says what happened. Guard buttons let you try an outside edit (stale), a tampered approval, and a replayed approval. An approval bench and 16 rule scenarios run with no API key. The teaching section includes six explained snippets and Viva voice controls. See [LAB20.md](LAB20.md) for the walkthrough.

## Lab 21 — Add web search

Give the agent current information and check its sources. Declare the built-in `web_search` tool in `agent.tools`, set its `mode` (live, cached, disabled), `context_size`, `allowed_domains`, and an approximate `location`, and see the exact request the server sends. The server rebuilds the declaration from plain settings and refuses one with errors. Leaving the tool out is the only way to turn search off; asking for a search in the prompt does not. OpenAI runs the search inside the turn, so there is no function and no `requires_action`. The page watches each `web_search_call` (queries and pages opened) and finds the citations, which arrive inline as Markdown links. It then checks every source: a web link, not `javascript:`; inside the allowlist, with a dot boundary; link text that does not name another site; and a source near every claim. The sources appear as numbered links that open safely in a new tab. A source inspector with six recorded answers and a 20-case test page need no API key. The teaching section includes six explained snippets and Viva voice controls. See [LAB21.md](LAB21.md) for the walkthrough.

## Lab 22 — Connect a public MCP server

Give the agent someone else's tools. Declare the OpenAI documentation MCP server (`https://developers.openai.com/mcp`) in `agent.tools` with a `server_label`, an HTTP `transport`, and `required`. The server rebuilds the declaration from plain settings and refuses plain http, credentials or tokens in the URL, localhost, and private addresses. The Agents API runs discovery (`initialize`, then `tools/list`) before the turn and does not stream it, so a **Discover tools** button repeats the handshake from the course server (with DNS and redirect guards) and shows each tool's name, description, input schema, and read-only hints. During a run the page watches each `mcp_call` item (tool, arguments, `CallToolResult` output or error), spots a failed `initialize` item when an optional server cannot connect, and checks the calls against the discovered tools: known names, required arguments, types and ranges, and success. It then checks that every link in the answer came from a tool result, and that an Agents API question cites Agents API pages. Live runs showed that `required: false` lets the first turn start before the server is ready, so the lab uses `required: true`. A call inspector with seven recorded runs and a 26-case test page need no API key. The teaching section includes six explained snippets and Viva voice controls. See [LAB22.md](LAB22.md) for the walkthrough.

## Lab 23 — Restrict MCP tools

Give the agent only the tools its task needs. Two fields on the Lab 22 `mcp` tool decide what it can reach: `connection_origin` (`"service"` starts the connection on OpenAI's network; `"environment"` starts it from the session's environment) and `allowed_tools` (the exact tool names the agent can discover and call; left out means every tool, including tools the server adds later). Live runs showed that the API silently accepts `[]`, a name that matches nothing, and the right name in the wrong case: the turn runs with no server tools and nothing says why. So the server checks every name against a fresh `tools/list` (cached for five minutes) and refuses a list that cannot work, with a *did you mean* hint for case mistakes. An `environment` origin in a session with no environment is refused, as the API does with a 400. A **Send anyway** switch skips these checks to show the API's behavior; the URL checks from Lab 22 always apply. The page shows which tools are allowed, hidden (never discovered), or unmatched, and notes that the MCP resource helpers are not covered by the list. The allowlist is proved with tasks, not by asking the model (which, with one tool allowed, twice said it had none): five probes, each needing one tool, run in parallel sessions with the same declaration. The server cancels any turn that calls a tool outside the list, and a probe × tool matrix shows what the agent could and could not call. An allowlist inspector with twelve recorded runs (including a spec whose request body was only a `$ref`, before and after an instruction fix) and a 27-case test page need no API key. The teaching section includes six explained snippets and Viva voice controls. See [LAB23.md](LAB23.md) for the walkthrough.

## Lab 24 — Add private MCP authentication

Authenticate a private course-records MCP server with an inline bearer header or a write-only vault credential. Compare access logs, rotate the token with overlap, and continue existing sessions to observe which credential they use. Eleven recorded runs and 40 browser/server rule cases work without an API key. Eight integration tests cover HTTP authentication, request validation, vault recovery, pagination, and redaction. The teaching section includes six explained snippets and Viva voice controls. See [LAB24.md](LAB24.md) for setup, the walkthrough, and the student challenge.

## Lab 25 — Package a reusable plugin

Bundle a skill and an MCP server into one plugin and reuse it in new sessions. The folder `plugins/course-docs` holds a manifest (`.codex-plugin/plugin.json`), a `cite-docs` skill, and `.mcp.json` for the OpenAI documentation server. A workbench checks the folder as the API does (manifest paths, SKILL.md frontmatter, MCP settings, no secrets or `.env` files) and packs a deterministic ZIP with one top-level folder, shown entry by entry with a fingerprint. The plugin is installed in an OpenAI-hosted environment inline (`environment.plugins`) or once in an environment template (`environment_template_id`), with network restricted to the plugin's domain. Live runs showed that a question sent with `sessions.create` runs before the environment is ready, without the skill or its server, so the lab creates the session without input and asks at `agent.session.environment.ready`. Each run is judged from the session: the installed plugin and capability directory, calls to the plugin's server, the skill's closing line, and grounded links. A plugin inspector with nine recorded runs (including six API refusals) and a 38-case test page need no API key. The teaching section includes six explained snippets and Viva voice controls. See [LAB25.md](LAB25.md) for the walkthrough.

## Lab 26 — Choose an environment

Compare `environment: { type: "none" }` with `openai_hosted` on two tasks, using the same model and instructions in every session. An explanation (tuple or list?) needs only the model's knowledge. A computation (the SHA-256 of a fresh `lab26-<hex>` input and a prime sum) must be run to be trusted. A chooser turns the task's needs into an environment and the smallest network policy. A request checker repeats what the API refused live: `none` takes only `type`, `restricted` needs domains, and a hosted session without `network` reported access `enabled`. A none session asks in `sessions.create` and streams at once. A hosted session is created without input, waits for `agent.session.environment.ready` (20–26 s live), then gets the task. Each run is judged from its evidence: the reported environment type, the ready time, `command_execution` items and their output, and values checked against the app's own SHA-256 and prime sum. Live, the none session said it would compute both values and returned a confident, wrong hash. The hosted session ran two commands, noticed a Python error that still exited 0, reran the command, and got both values right. An inspector with six recorded runs and five recorded API answers, and a 38-case test page, need no API key. The teaching section includes six explained snippets and Viva voice controls. See [LAB26.md](LAB26.md) for the walkthrough.

## Lab 27 — Provide input files

Stage a CSV and a text brief in an `openai_hosted` sandbox and ask for a report that names its source. Each dataset is generated from a seed, so no answer can be remembered, and the app computes the expected figures from the same bytes it stages. The brief holds a rule the CSV does not: exclude refunded rows. Three runs share one prompt and one set of instructions. **Staged** puts both files in `environment.files` in `sessions.create`. **Copied** waits for `environment.ready`, then calls `environments.files.create`. **Control** stages nothing. A files checker repeats what the API refused live: relative paths, paths outside `/workspace`, `..` components, raw text or base64url data, duplicate paths, more than 50 files, data over 6,990,508 characters, and `file-` IDs from `files.create`. Each run is judged from its evidence: the session's file echo (`cfile_` ID and `size_bytes`), `environments.files.list`, `command_execution` items that read the files, and the report's `source` path, `source_sha256`, and figures. Live, both staging routes produced grounded reports, and the control run said the files were missing and reported no figures. One agent's first `awk` used the wrong columns and still exited 0; it noticed and reran it. With an earlier prompt, another agent saved the report to `/workspace/outputs/` and replied with only a link. An inspector with four recorded runs and ten recorded API answers, and a 45-case test page, need no API key. The teaching section includes six explained snippets and Viva voice controls. See [LAB27.md](LAB27.md) for the walkthrough.

## Lab 28 — Configure packages and network

Build an `openai_hosted` environment from `packages` (python, system, npm), a confidential `setup_commands` list, and a `network` policy, then verify each part from inside the sandbox and write the policy down. One audit prompt asks the agent for the Python, tabulate, and jq versions, whether the setup command's lock file exists, and the `curl` status code for `pypi.org` and `example.com`. Five configurations run side by side: pinned and offline, unpinned, a PyPI allowlist, an open network, and a control with nothing declared. A request checker repeats what the API refused live: wildcard, URL, path, or port hosts; more than 100 domains; domains with `disabled`; `blocked_domains` (not enabled for the organization); package specs with URLs, credentials, options, or shell characters; and more than 16 setup commands. Each run is judged from its evidence: the session's package and network echo (setup bodies are never echoed), the lock file seen by `environments.files.list`, and the status codes in `command_execution` output. Live, declared packages installed even with the network disabled; the pinned configuration gave tabulate 0.9.0 in two sandboxes while the unpinned one gave 0.10.0; the allowlist let `pypi.org` answer 200 while `example.com` got 000 from the proxy; and an allowlist with only `pypi.org` could not download from `files.pythonhosted.org`. An unknown package failed once with pip's own error and once with only `environment.failed`. The app fingerprints each environment, groups runs by fingerprint, and exports a Markdown policy document. An inspector with eleven recorded runs and fourteen recorded API answers, and a 55-case test page, need no API key. The teaching section includes six explained snippets and Viva voice controls. See [LAB28.md](LAB28.md) for the walkthrough.

## Lab 29 — Create and download artifacts

Ask a hosted agent to save its work under `/workspace/outputs`, then list, identify, download, and verify what was published. When a turn completes, every file there becomes an immutable artifact with its own ID, path, `size_bytes`, and `turn_id`. Four tasks share one Lab 27 dataset. **Write to /workspace/outputs** publishes a Markdown report, `summary.json`, and a table in a subdirectory, while the scratch notes stay in the sandbox. **Write somewhere else** gives correct files and no artifacts. **Write, then revise** publishes a second, separate report artifact, so the lab matches `turn_id` and path instead of the path alone. **Cancel mid-turn** leaves `draft.md` in `/workspace/outputs` unpublished. The Node server downloads through `sessions.artifacts.content`. It checks the metadata first, chooses a safe file name and content type (the API sent `application/octet-stream` for every file), sends the file as an attachment with `nosniff`, and serves only sessions it created. The browser hashes each saved file against the server's SHA-256. Each run is judged by its bytes and by its figures, compared with the app's own analysis. Live, artifacts were listed 0.2–0.6 s after `turn.completed`, and no stream event announced them. A deleted artifact returned 404, and its sandbox file remained. A publish planner, four recorded runs with working downloads, eleven recorded API answers, and a 52-case test page need no API key. The teaching section includes six explained snippets and Viva voice controls. See [LAB29.md](LAB29.md) for the walkthrough.

## Lab 30 — Clean up sandbox resources

Inspect a hosted session from earlier labs, retain needed artifacts, stop incoming work, then delete and verify API absence. The cleanup workbench lists project sessions with pagination, retrieves the latest turn and environment state, and blocks active work, provisioning, unknown environment state, missing retention acknowledgements, and incorrect session confirmation. Downloads go through the server with safe attachment headers and browser SHA-256 verification. Inspection tickets expire after ten minutes; deletion rechecks the reviewed state before every attempt and retries only 409, at most three times. The audit separates deletion confirmation from 404 verification and never claims physical cleanup has finished. Five synthetic practice scenarios, a working local report download, and a 24-case policy test page need no API key. The six teaching snippets have explanations, individual Viva voice narration, and Read all six. Integration tests exercise the actual cleanup service using a fake API. See [LAB30.md](LAB30.md) for the walkthrough and student challenge.

## Lab 31 — Understand the agent harness

Explore an annotated architecture diagram and six synthetic ownership traces. Compare the Agents API, Agents SDK, and Responses API; identify model proposals, application function handlers, managed orchestration, and sandbox commands. A read-only inspector projects saved sessions from earlier labs with bounded pagination and explicit limitations. Complete the ownership exercise and export an annotated evidence document or trace JSON. Six explained teaching snippets include individual Viva voice narration, Read all six, and Stop. See [LAB31.md](LAB31.md) for the step-by-step build guide and student challenge.

## Lab 32 — Connect a self-hosted environment

Connect the official `codex exec-server` in a disposable local Docker container. The server creates a self-hosted session, subscribes before starting compute, and sends a fixed file task once the environment connects. Verify command output, a hidden file, the exact JSON inventory, and a fresh nonce. Background jobs survive browser navigation, use bounded deadlines, and track container removal separately from API session deletion. Six synthetic practice cases, browser/server rule checks, integration tests, and six explained snippets with Viva voice work without live credentials. Live execution requires Docker and a separate restricted environment key. See [LAB32.md](LAB32.md) for setup and the student challenge.

## Lab 33 — Apply project rules with AGENTS.md

Explore repository instruction discovery, scoped overrides, empty files, and configured fallbacks. Write root guidance and compare reports against independently checked conventions and revenue. A labelled synthetic comparison works offline; the optional live Agents API comparison explicitly loads fixture sources through `agent.instructions` and produces proposed file content without filesystem tools. Download a fresh Codex workspace scaffold to verify native discovery and a real report file separately. Export evidence, run browser/server and integration tests, and read six explained snippets with Viva voice. See [LAB33.md](LAB33.md) for the walkthrough and runtime boundaries.

## Lab 34 — Create and discover standalone skills

Author a focused SKILL.md and inspect its supporting reference and exact-cents helper. Register the immutable skill parent in a self-hosted sandbox through `environment.capability_directories`. Compare relevant, unrelated and unregistered runs with captured read/helper command evidence, independent totals and a fresh marker. Five labelled synthetic cases, browser/server checks and six Viva voice lessons work without credentials. Live runs use a separate disposable Docker image and the restricted environment key from Lab 32. See [LAB34.md](LAB34.md) for setup, validation and the student challenge.

## Lab 35 - Limit filesystem access

Test enforced filesystem boundaries with an unprivileged disposable executor, root-owned protected fixtures and a read-only root filesystem. Verify workspace reads and writes, direct/traversal/symlink denials and an explicit broader-access request using captured probe output. Five synthetic cases, shared tests, evidence export and six Viva voice lessons work without credentials. See [LAB35.md](LAB35.md) for setup and the access-policy limits.

## Lab 36 - Run an environment-origin MCP server

Connect an MCP HTTP server from the executor network namespace and verify a fresh private tool result. The page includes the exact transport configuration, four synthetic evidence cases, a live origin comparison, shared tests, evidence export and six narrated snippets. See [LAB36.md](LAB36.md) for setup, the implementation walkthrough and the student checkpoint.

## Lab 37 - Recover an environment failure

Recover observation loss or executor disconnection without blindly replaying the original task. The page includes five failure cases, a recovery decision exercise, a live one-subscription-loss injection, a bounded worker, evidence export and six narrated snippets. See [LAB37.md](LAB37.md) for setup, the implementation walkthrough and the student checkpoint.

## Lab 38 - Build a guarded file assistant

Combine explicit project guidance, a standalone report helper, enforced function-tool scope and human review. The exercise creates real disposable files and applies only an approved, current proposal. It includes a key-free local broker exercise, optional live agent, audit export and six narrated snippets. See [LAB38.md](LAB38.md) for setup, the implementation walkthrough and the student checkpoint.

## Lab 39 - Enable subagents

Enable managed harness delegation and give one child a bounded release-note extraction contract. Verify creation, turn ownership, returned fields and the root result independently. The page includes synthetic valid/claim/disabled cases, an optional live run, evidence export and six narrated snippets. See [LAB39.md](LAB39.md) for setup, the implementation walkthrough and the student checkpoint.

## Lab 40 - Run independent tasks in parallel

Give independent labelled sources to two children and observe whether their work overlaps. Verify each returned result and preserve an explicitly incomplete comparison if a source or child fails. The page includes valid, sequential, missing-source and failed-child cases, an optional live run and six narrated snippets. See [LAB40.md](LAB40.md) for setup, the implementation walkthrough and the student checkpoint.

## Labs 41–50 — Progress, integrations and operations

| Lab | Exercise | Guide |
| --- | --- | --- |
| 41 | Step through root and child progress with failure recovery decisions | [LAB41.md](LAB41.md) |
| 42 | Writer-owned draft, reviewer findings and revised acceptance checks | [LAB42.md](LAB42.md) |
| 43 | Compare matched single/multi evidence, quality, duration and nullable usage | [LAB43.md](LAB43.md) |
| 44 | Signed webhook receiver, durable replay ledger and failure fixtures | [LAB44.md](LAB44.md) |
| 45 | Runnable validation command plus project/plugin Codex hook scaffolds | [LAB45.md](LAB45.md) |
| 46 | Optional page-scoped WebMCP report tools and labelled local fallback | [LAB46.md](LAB46.md) |
| 47 | Success/failure trace walkthrough and OTLP export import | [LAB47.md](LAB47.md) |
| 48 | Nullable root/child token accounting with snapshot replacement | [LAB48.md](LAB48.md) |
| 49 | Bounded retries and server-enforced per-identity request budgets | [LAB49.md](LAB49.md) |
| 50 | Local cookie authentication, opaque session mapping and ownership rejection | [LAB50.md](LAB50.md) |

These labs include runnable local exercises, browser/server checks, evidence exports and six narrated snippets each. Labs 41–43 use replay, manual roles or imported measurements. Native Codex hook dispatch, WebMCP browser invocation and real webhook delivery require their documented runtime setup; local fixtures do not claim those observations. Lab 50's identity selector is a localhost teaching fixture, not production credential authentication.

Run `npm run test:operations` for all new integration tests. Set `OPENAI_WEBHOOK_SECRET` only for actual Lab 44 provider deliveries; the server verifies raw signatures before recording notifications. Ledger files under `.lab-data/` are ignored by Git.
## Labs 51–56 — Specification, evaluation, deployment and capstone

| Lab | Implemented exercise | Guide |
| --- | --- | --- |
| 51 | Versioned reviewed specification linked to AC-01–AC-12 | [LAB51.md](LAB51.md) |
| 52 | Versioned 24-case representative and adversarial dataset | [LAB52.md](LAB52.md) |
| 53 | Node/browser regression comparisons with pass/fail/unknown coverage | [LAB53.md](LAB53.md) |
| 54 | Enforced upload, tool, citation and approval boundary probes | [LAB54.md](LAB54.md) |
| 55 | Standalone Docker deployment, health, origin policy and target smoke | [LAB55.md](LAB55.md) |
| 56 | Persistent Research and Report Workspace with accounts and optional live sessions | [LAB56.md](LAB56.md) |

Lab 56 includes password accounts, owned documents/investigations, source-scoped function tools, saved session mapping, root/child evidence, citation review, approved writes, report downloads, signed notification deduplication and retained evaluation reports. SQLite records survive restart. Fixture mode needs no key; optional live mode uses OPENAI_API_KEY. Source functions use environment none; sandbox, web/MCP and native plugin/skill integrations remain explicitly separate extensions.

Use Node 24 or later. Run `npm run test:capstone`, `npm run eval:capstone` and `npm run build`. The existing course starts with `npm run dev`; the separate deployment starts with `npm run start:capstone` or the supplied Docker compose file. See [deployment instructions](capstone/deploy/README.md) for persistence, hosting, secrets, limits and cleanup. The local Docker target is verified; external hosting and live model execution are not claimed by fixture or contract tests.
