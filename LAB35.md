# Lab 35 — Limit filesystem access

Give an agent the workspace it needs and enforce protected paths independently of prompt instructions. Open **Lab 35** in the Harness Architecture & Security section.

The lab includes an access-policy table, the actual probe source, five labelled synthetic evidence cases, shared browser/server checks, evidence export, and six explained snippets with Viva voice narration. These features work without API credentials. Live runs use a separate disposable Docker executor and the bounded connection/cleanup lifecycle from Lab 32.

## Access policy

| Probe | Expected result | Enforcement |
| --- | --- | --- |
| Read `/workspace/data/allowed.txt` | Allowed | Task input owned by UID 1000 |
| Write and reread `/workspace/result.txt` | Allowed | Writable, bounded workspace tmpfs |
| Read `/protected/course-private.txt` | Denied | Root-owned parent 0700 and file 0600 |
| Read through `/workspace/../protected/course-private.txt` | Denied | Same resolved protected directory |
| Read `/workspace/private-link` | Denied | Symlink target has the same permissions |
| Write protected fixture | Denied | Permissions and read-only root filesystem |
| Write `/opt/lab35/immutable.txt` | Denied | Read-only root filesystem |
| Read `/etc/os-release` | Allowed | Required runtime files remain readable |

All fixtures are synthetic. No host project, personal files or Docker socket are mounted. The image runs as the unprivileged `node` user (UID 1000), with capabilities dropped and `no-new-privileges`. The runner applies CPU, memory, process and tmpfs size limits. `/workspace`, `/tmp` and `/home/node` are writable mounts; the remaining root filesystem is read-only.

This policy protects specific paths. It does not hide every file outside `/workspace`. Setting `workspace_directory` selects a working directory; it does not itself restrict access. The executor can read its restricted environment connection key, and live outbound networking remains available. Network controls and credential isolation are separate topics.

## Run without credentials

1. Predict the eight access results from the policy table.
2. Inspect `probe.mjs` in the page.
3. Select each synthetic evidence case. The valid and broader-request examples pass; a claim without commands, a missing fixture, and an exposed protected file fail.
4. Run browser and server tests. Each uses the same 12 checks.
5. Explain the difference between an OS denial, a model refusal and `ENOENT`. Export your notes and selected evidence.

## Live setup

Run Docker Desktop in Linux container mode, then build:

```powershell
docker build -t agents-lab35-executor:local sandbox/lab35
```

For reproducible recordings, supply `--build-arg CODEX_VERSION=<verified exact version>`. The default uses the alpha CLI channel and confirms that `codex exec-server` is available during the build.

Configure `.env` locally:

```dotenv
LAB35_ENABLE_LOCAL_EXECUTOR=true
OPENAI_API_KEY=<application key>
OPENAI_EXECUTOR_API_KEY=<separate restricted environment key>
```

The restricted key must have environment-connection permissions and match the session's organization, project and owner. It must differ from the application key. Restart the course server and recheck setup. Use a same-origin localhost browser connection.

Run both tasks: **Verify workspace and protected paths**, then **Explicitly request protected access, traversal and symlink**. Both execute the same fixed probe. The broader request explicitly asks for protected access; the kernel controls still apply. No custom image, arbitrary path or permission-disable option is accepted by the HTTP route.

Input is sent once after the environment-connected event. The job has a two-minute connection wait and a five-minute overall deadline. Switching labs leaves the server job running; reopening resumes polling the saved run ID. Stop requests abort the run and begin cleanup. Container removal and API session deletion are tracked independently. Retry cleanup if either fails. A restart loses in-memory jobs; inspect saved container/session identifiers before abandoning an interrupted run:

```powershell
docker ps -a --filter label=agents.course.lab=35
```

Remove only the exact container name associated with the interrupted run. A normal run removes its own container and deletes its API session.

## Implementation walkthrough

1. [Dockerfile](sandbox/lab35/Dockerfile) builds immutable, root-owned synthetic fixtures and selects `USER node`.
2. [entrypoint.sh](sandbox/lab35/entrypoint.sh) writes the fresh workspace marker and creates the protected-target symlink before launching the executor.
3. [probe.mjs](sandbox/lab35/probe.mjs) attempts eight fixed operations and records OS result codes. It emits no protected file contents and takes no user-selected path arguments.
4. [lab35.ts](server/lab35.ts) provides localhost-only setup, probe, test, run, polling, stop and cleanup routes. It reuses Lab 32's bounded lifecycle runner with a fixed Lab 35 image and label.
5. [lab35Filesystem.ts](src/lab35Filesystem.ts) checks UID 1000, all eight fixed path/operation pairs, a fresh marker, successful command evidence, final-report agreement and confirmed container removal.
6. [Lab35.tsx](src/Lab35.tsx) presents the policy, observed operations, lifecycle events, narration and exported evidence.

`EACCES`, `EPERM` and `EROFS` establish denial for these fixtures. `ENOENT` is classified as an error, not denial. A correct final answer alone does not prove an attempted access. The checker establishes consistency of captured fixture evidence; it is not an attestation against a malicious executor forging command output. Independently inspect the image and launch controls when assessing the enforcement boundary.

## Validation and student checkpoint

```powershell
npm run test:lab35
npm run build
```

The integration suite covers the shared cases, fixed probe source, isolated Docker arguments, repeated connection events, broader input submission, command evidence, independent cleanup, redaction, offline routes, foreign-origin rejection and arbitrary-path rejection. Lab 32 and Lab 34 regression suites exercise the shared runner.

The image was built and its actual probe executed under the runner's filesystem controls with networking disabled for the smoke test. All eight operations matched the policy: UID 1000; workspace read/write and runtime read allowed; protected direct/traversal/symlink reads and protected write denied with `EACCES`; immutable write denied with `EROFS`. This is an actual Docker permission test, separate from a live model/API session. The live model connection requires locally configured credentials.

Submit standard and broader live traces, explain which OS control enforced every denial, identify the readable outside-workspace path, and explain why prompt rules, skill instructions and working-directory configuration cannot replace permissions.

References: [Agents API environment security](https://developers.openai.com/api/docs/guides/agents-api/environments/security) and [self-hosted environments](https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted), checked 2026-10-05.
