# Lab 32 — Connect a self-hosted environment

Build a file-listing task in a disposable Docker sandbox. Open **Harness architecture & security → Lab 32**, or navigate to `#lab32`.

OpenAI runs the managed harness. Your application creates a self-hosted session and connects your compute with the official `codex exec-server`. The executor receives commands and returns their results through an outbound WebSocket. The application does not implement a replacement shell-tool protocol.

## 1. Explore without credentials

Choose each of the six **synthetic practice** cases: connected and verified, pending, authentication failure, disconnect, an answer without command evidence, and unconfirmed cleanup. Inspect the lifecycle, command, answer, and cleanup checks separately. Run the browser and server rule suites. Synthetic cases are teaching fixtures, not recordings of successful API runs.

## 2. Prepare a disposable Linux container

Start Docker Desktop with Linux containers, then build only the included sandbox context:

```sh
npm run lab32:image
```

The image installs `@openai/codex@alpha`. Capture `codex --version` from the build output; for a repeatable recording, rebuild with an exact version verified to support `exec-server`:

```sh
docker build --build-arg CODEX_VERSION=<verified-version> --tag agents-lab32-executor:local sandbox/lab32
```

Each run uses a new generated container name and a fresh nonce. The fixture includes a hidden marker, a brief, a CSV in a subdirectory, and a `run-<nonce>.txt` file. No host project directory or Docker socket is mounted. Docker supplies the isolation boundary; prompt instructions asking the agent not to modify files are guidance. Network egress remains available for executor registration and WebSocket traffic; this exercise does not claim a network allowlist or hostile multi-tenant isolation.

## 3. Configure two distinct credentials

Keep the application key as `OPENAI_API_KEY` on the Node server. The documented permissions are Agents read/write and Responses write. Create a separate environment key on the platform’s Agents tab, for the same organization, project, and user or service account. Set every other permission to None.

```dotenv
OPENAI_EXECUTOR_API_KEY=<restricted-environment-key>
LAB32_ENABLE_LOCAL_EXECUTOR=true
```

Restart the application. The Docker sandbox receives this restricted value as `CODEX_API_KEY`; it never receives the application key. Sandbox code can read the restricted key, so keep it out of source, images, and exported evidence. Keys are configured on the server, never submitted through the page.

Permit outbound registration at `https://api.openai.com` and command traffic at `wss://codex-cloud-environments.chatgpt.com`. The launcher checks the connection destination and passes the API-returned URL unchanged as a process argument, with no shell expansion.

## 4. Create and connect

The session request contains:

```ts
environment: {
  type: 'self_hosted',
  workspace_directory: '/workspace',
}
```

There is no initial input. Subscribe to session events before starting compute, then connect the executor with the returned environment ID and remote URL:

```sh
codex exec-server --remote '<API-returned-URL>' --environment-id '<environment-ID>'
```

The key is supplied through the environment, not command arguments. Each session needs its own executor. API environment templates belong to OpenAI-hosted compute and are not used here.

## 5. Gate input and verify execution

Review the setup indicators, then use **Connect and list files**. Observe pending → connected. Self-hosted input waits for `agent.session.environment.connected`, rather than the hosted `environment.ready` event. Repeated connected events must never submit another question.

The prompt asks the agent to list all regular files, including hidden files, and read the nonce file. It does not disclose the expected inventory or nonce. Inspect successful `command_execution` output and compare the final JSON with the exact sorted fixture paths and nonce. Only a root turn outcome settles the run; a child completion, connection, or plausible answer is insufficient.

## 6. Observe cleanup separately

Completion, failure, deadline, and user stop all attempt compute removal. Unknown turn outcomes stay unknown, even if a cancel request was accepted. An unavailable Docker daemon cannot prove container absence. Keep the evidence of task execution and compute cleanup distinct from API session deletion, which only manages API state.

Runs have a five-minute deadline and a two-minute connection wait. The localhost-only runner prevents concurrent Lab 32 workloads and blocks new work while cleanup is unresolved. Browser navigation does not stop the background job; reload resumes monitoring the saved run ID. **Stop run and clean up** requests cancellation, while **Retry cleanup** repeats only the failed cleanup operations. Request IDs prevent duplicate compute within the current server process. Raw executor logs and remote connection URLs are not exported to the browser.

The runner attempts container removal and API session deletion automatically, recording each result separately. Export the captured evidence after the job settles. A successful API delete is recorded as deletion accepted; this lab does not claim physical erasure or independent 404 verification.

A normal server shutdown attempts cleanup. After an abrupt crash, identify only Lab 32 containers and remove the exact generated name:

```sh
docker ps -a --filter label=agents.course.lab=32
docker rm -f <exact-agents-lab32-container-name>
```

Never remove unrelated containers. If API cleanup remains unconfirmed after a server restart, inspect the recorded session ID using Lab 30. Persisted browser run IDs cannot reconstruct a job lost with server memory.

## Code and teaching map

| File | Responsibility |
| --- | --- |
| `src/Lab32.tsx` | Practice, live controls, lifecycle inspector, evidence export, narration |
| `src/lab32Environment.ts` | Shared request, fixture inventory, event projection, evidence checks |
| `src/lab32Scenarios.ts` | Six labelled synthetic cases |
| `src/lab32Tests.ts` | Browser/server rule checks |
| `src/lab32Lessons.ts` | Six explained snippets and Viva voice text |
| `server/lab32.ts` | HTTP routes, server-only credentials, SDK adapter |
| `server/lab32Service.ts` | Executor orchestration and cleanup |
| `server/lab32Docker.ts` | Bounded Docker commands and generated cleanup targets |
| `sandbox/lab32/` | Executor image and per-run fixture preparation |

Expand **Under the hood** for six explained snippets. Each supports **Viva voice · Read aloud**; **Read all six** and **Stop narration** control the whole teaching section. Speech uses the browser’s installed voice and stops when the lab closes.

## Student challenge

1. Complete a live run with connection, root outcome, successful command output, exact JSON inventory, and confirmed container cleanup.
2. Export the evidence and identify the application, managed harness, and executor responsibilities.
3. Explain why an answer without command evidence fails, and why deleting API session state does not remove your compute.
4. Inspect a failed connection without blindly resubmitting work. Describe what remains unknown.

## Validation

```sh
npm run test:lab32
npm run build
```

The automated integration suite uses a fake API and executor provider. It checks lifecycle ordering, repeated events, child outcomes, deadlines, input errors, and cleanup failures without credentials, Docker, or network calls. A live run requires Docker, the built image, and the two correctly scoped keys; an offline pass does not establish account access or a successful executor connection.

## Official references

Checked 2026-10-04: [Self-hosted sandboxes](https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted), [Sandbox lifecycle](https://developers.openai.com/api/docs/guides/agents-api/environments/lifecycle), and [Sandbox security](https://developers.openai.com/api/docs/guides/agents-api/environments/security).
