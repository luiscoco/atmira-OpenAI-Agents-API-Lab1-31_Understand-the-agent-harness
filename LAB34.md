# Lab 34 — Create and discover standalone skills

Open **Harness architecture & security → Lab 34**, or navigate to `#lab34`. Author a narrow `SKILL.md`, register the skill parent inside a self-hosted sandbox, and inspect command evidence for relevant and unrelated tasks.

## 1. Inspect and author the skill

The bundled skill is under `sandbox/lab34/skills/course-sales-report/`:

```text
course-sales-report/
  SKILL.md
  references/report-contract.md
  scripts/report.mjs
```

The name and description are discovery metadata. The body links to the report contract and explains the helper. The reference specifies input columns and JSON fields. The helper validates CSV rows, uses integer arithmetic with `BigInt`, and prints a report without writing files.

Use the file selector to inspect the actual source files. Edit and download a manifest draft. Browser authoring checks cover the fixture's plain, single-line front matter fields; they are not a complete YAML parser. Drafts do not alter the reviewed live image. To test changes, edit the on-disk skill files, validate the manifest, test the helper, and rebuild the image. Skill instructions are ordinary Markdown after YAML front matter.

## 2. Explore without Docker or credentials

Choose five labelled synthetic evidence cases: relevant read/execution, unrelated nonactivation, correct JSON without skill evidence, unnecessary activation, and missing registration. Inspect manifest reads, reference reads, helper commands, final reports, and cleanup separately. Run the shared browser/server test suite.

Synthetic traces are teaching fixtures, not recorded API runs. A passing report without read evidence does not prove skill use. “No observed activation” for an unrelated task applies to the captured commands, not to invisible model reasoning.

## 3. Prepare the self-hosted executor

Start Docker Desktop in Linux container mode and build:

```powershell
npm run lab34:image
# Equivalent:
docker build -t agents-lab34-executor:local sandbox/lab34
```

The build installs `@openai/codex@alpha` and verifies `exec-server` help. For a reproducible recording, supply a verified exact `CODEX_VERSION` build argument. The image copies the skill into `/opt/lab34/skills/course-sales-report`, outside the writable workspace. Its root filesystem is read-only; bounded tmpfs directories provide the CLI home, temporary storage, and fresh workspace. No host project, Docker socket, or application key is mounted.

Configure the same two distinct server-side credentials used in Lab 32:

```dotenv
OPENAI_API_KEY=<application-key>
OPENAI_EXECUTOR_API_KEY=<restricted-environment-key>
LAB34_ENABLE_LOCAL_EXECUTOR=true
```

The environment key must belong to the same organization, project, and user/service-account owner as the session, with only environment-connection permissions. It is passed to the container as `CODEX_API_KEY`. The application key stays on the Node server. Restart the server and select **Recheck setup**. Each live run can incur API usage.

Outbound connections remain available for registration and executor traffic. Container code can read its restricted executor key. This local runner does not claim hostile multi-tenant isolation or an outbound domain allowlist.

## 4. Register capabilities explicitly

The session request uses:

```ts
environment: {
  type: 'self_hosted',
  workspace_directory: '/workspace',
  capability_directories: ['/opt/lab34/skills'],
}
```

The capability directory must already exist inside the executor environment when it becomes available. Register the skill's parent directory, not its manifest file or a path on the application host. Paths must be absolute and unique, contain no `.` or `..` segments, and number at most 32. The managed harness discovers skill metadata; the model may select relevant skills and read their instructions and supporting files.

The server does not paste the skill body into `agent.instructions`. It creates a session without initial input, opens the stream, launches the executor with the API-returned environment ID and URL, waits for `agent.session.environment.connected`, and sends the task once. A root terminal event settles the task; a child completion or connection event alone does not.

## 5. Test the relevant revenue task

Choose **Relevant: revenue report from a fresh CSV**, leave registration enabled, and run. The prompt asks for the report and does not disclose the skill name, marker, or expected amount. The entrypoint varies book units using the fresh server-generated marker and writes `data/sales.csv` and `run-marker.txt`.

Collect successful command evidence of:

1. Reading the skill manifest, including its `LAB34_SKILL_READ` marker.
2. Reading the reference, including `LAB34_REFERENCE_READ`.
3. Running the bundled helper with the fresh inputs and seeing its exact cents and run marker.
4. Returning JSON that agrees with the independent fixture calculation.

The checker supports command-based reads. If your runtime loads a skill through another read mechanism or output is truncated, inspect its runtime evidence manually rather than treating a missing check as proof of nonuse. The markers establish consistency with visible output; they are not a cryptographic guarantee of model behavior.

## 6. Test relevance and missing registration

Run the unrelated tuple/list question in a fresh session with registration enabled. Inspect whether a manifest read or helper execution was observed. General knowledge questions should not need this revenue skill. The check reports unnecessary observed activation separately from answer quality.

Disable **Register the standalone skill parent** and repeat the relevant task. The image still contains the files, but the request passes an empty capability-directory list. This is a configuration comparison, not an access-denial test: shell commands could still find the files. A correct report can pass its data check while failing registration and skill-use checks.

Run each case separately and export its evidence. Fresh datasets vary by marker; compare evidence quality rather than expecting identical numeric totals across separate runs.

## 7. Compare standalone and plugin-bundled packaging

Lab 25 bundles a documentation skill and MCP integration using a plugin manifest and hosted installation options. This lab uses a standalone skill folder with references and a helper, registered by its parent capability directory. A self-hosted plugin can instead register a plugin root containing its manifest in `capability_directories`.

Neither skill nor plugin guidance replaces sandbox access controls. A skill's request to preserve the CSV is instruction, not filesystem enforcement. Lab 35 adds that enforcement exercise.

## 8. Keep lifecycle and cleanup evidence

Jobs have a five-minute deadline and a two-minute connection wait. The server retains run IDs for retry deduplication, permits one Lab 34 job at a time, blocks another run while cleanup is unresolved, and supports stop and cleanup retry controls. Browser navigation leaves the job running; reopening the lab polls its saved ID. A normal server shutdown stops both Lab 32 and Lab 34 jobs.

Container removal and API-session deletion are separate operations. Unknown root outcomes stay unknown after a cancel request. Exact credentials are redacted from exported command output and answer text. Remote connection URLs and raw Docker logs are not sent to the page.

After an abrupt server crash, inspect only Lab 34 containers and remove the exact generated name:

```powershell
docker ps -a --filter label=agents.course.lab=34
docker rm -f <exact-agents-lab34-container-name>
```

Use a saved session ID with Lab 30 if API deletion needs further investigation. Browser IDs cannot reconstruct a server job lost on restart.

## How it was built

| File | Responsibility |
| --- | --- |
| `src/Lab34.tsx` | Manifest workbench, live setup, practice, evidence and narration |
| `src/lab34Skills.ts` | Registration, fixture math and observed-use checks |
| `src/lab34Tests.ts` | Shared browser/server rule cases |
| `src/lab34Lessons.ts` | Six explained snippets with Viva voice |
| `server/lab34.ts` | Bounded localhost routes, fixed SDK requests and skill bundle reader |
| `server/lab32Service.ts` | Shared connection, task, deadline and cleanup lifecycle |
| `server/lab32Docker.ts` | Shared bounded Docker adapter with independent lab names/labels |
| `sandbox/lab34/` | Skill-bearing image, helper and per-run input preparation |
| `server/lab34.integration.test.ts` | Real helper tests, fake API lifecycle and HTTP checks |

## Validation and student checkpoint

```powershell
npm run test:lab34
npm run test:lab32
npm run build
```

Automated checks use fake API events and a real local helper process. They do not prove live model access or skill discovery. Docker image/startup validation also does not establish a successful API connection.

Submit one relevant-task trace and one unrelated-task trace, identify the discovery metadata and progressively loaded resources, compare missing registration, and explain why a correct answer alone does not prove skill use. Include independent totals and confirmed cleanup.

## Official references

Checked 2026-10-04: [Skills and Agents API capability directories](https://developers.openai.com/api/docs/guides/tools-skills), [Plugins](https://developers.openai.com/api/docs/guides/agents-api/tools/plugins), and [Self-hosted sandboxes](https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted).
