# Lab 38 - Build a guarded file assistant

Combine explicit project guidance, a standalone report helper, enforced function-tool scope and human review. The exercise creates real disposable files and applies only an approved, current proposal. It includes a key-free local broker exercise, optional live agent, audit export and six narrated snippets.

## Run the exercise

No Docker or key is needed for the local broker exercise. Create a fresh fixture workspace, then run the local broker exercise. It reads the real course fixtures, invokes Lab 34's actual helper, records an outside-path denial and saves a pending proposal. Inspect the complete diff before approving or rejecting it. Download the approved report and export the audit, then dispose the workspace.

For the optional live agent, configure `OPENAI_API_KEY` and restart. The session uses `environment.type: none` and exactly three function tools. The model has no shell or filesystem environment. Function handlers read only `AGENTS.md`, `sales.csv` and `report.md`; arbitrary paths and unknown tools fail before filesystem access. `calculate_revenue` invokes the existing helper with fixed input and marker paths, a five-second process timeout and bounded output. A 20-call budget and two-minute live deadline bound the exercise.

Project rules and the Lab 34 manifest/reference are **explicitly loaded** into instructions. This is not automatic API discovery. The application adapts the skill's shell helper to `calculate_revenue`; the skill's JSON result becomes a Markdown proposal. The path broker enforces the file scope independently of instructions. Lab 35 separately demonstrates OS-enforced permissions.

`propose_report` never writes report.md. The application stores a proposal ID, complete content diff, base hash and pending status. Human approval rechecks ID, status, hash and report contract, then atomically replaces only report.md. Rejection preserves current content; stale or replayed approval fails. No approval tool is exposed to the model.

These are real files in a dedicated temporary course directory, not your repository files. Workspaces and jobs are mapped in memory and survive browser navigation, not a server restart. Normal disposal/shutdown removes the dedicated fixture directory after verifying its cleanup target. Abrupt process termination can leave temporary fixture directories. A failed live API deletion must be retried before disposing or starting another proposal.

## Implementation walkthrough

### 1. Load guidance explicitly

Source: [server/lab38.ts](server/lab38.ts).

```text
instructions: JSON.stringify({ rules, skillResources })
```

The application loads the project rules and standalone skill resources into instructions. This demonstrates a verified loading path without claiming automatic API instruction or skill discovery.

### 2. Enforce exact tool scope

Source: [server/lab38Service.ts](server/lab38Service.ts).

```text
if (!['AGENTS.md', 'sales.csv', 'report.md'].includes(path))
  throw new Error('ACCESS_DENIED');
```

The agent has no filesystem environment or shell. Function handlers enforce exact fixture names before reading real disposable files. Parent traversal and arbitrary absolute paths cannot reach the filesystem through this broker.

### 3. Reuse the real report helper

Source: [server/lab38Service.ts](server/lab38Service.ts).

```text
execFile(process.execPath, [script, fixedCsv, fixedMarker]);
```

The broker invokes the existing Lab 34 helper with fixed paths and bounded runtime. Its exact integer-cent result is independently checked before the model uses it to write a proposed Markdown report.

### 4. Propose without applying

Source: [server/lab38Service.ts](server/lab38Service.ts).

```text
proposal = { id, content, baseHash, status: 'pending' };
```

A proposal records the current content hash and a full before-and-after diff. The agent cannot apply it because no approval function is exposed to the model.

### 5. Bind review to current content

Source: [server/lab38Service.ts](server/lab38Service.ts).

```text
if (hashContent(current) !== proposal.baseHash)
  throw new Error('STALE_PROPOSAL');
```

The application accepts only the matching pending proposal ID. It rechecks the base hash and report contract, then applies atomically. Rejection leaves the file unchanged and decided proposals cannot be replayed.

### 6. Keep evidence and dispose

Source: [src/Lab38.tsx](src/Lab38.tsx).

```text
downloadEvidence({ proposal, audit, trace }, 'evidence.json');
```

Export the project sources, helper call, denied read and reviewed change. The local broker exercise executes real handlers without a model; the optional live agent uses the same tools. Dispose the fixture directory after the exercise.

## Validation and checkpoint

```powershell
npm run test:lab38
npm run build
```

The page and server share 5 rule checks. Integration tests exercise actual local handlers and injected API/provider failures, rather than making live model calls. TypeScript and production build checks cover the application integration. The live API/model paths need configured credentials and have not been exercised in this workspace.

Show project rules, loaded skill resources, exact-cents helper output, outside-path denial, unchanged preapproval content, a reviewed diff and the approved file. Reject another proposal and explain the stale/replay checks.

Official references (checked 2026-10-05): [tools/functions](https://developers.openai.com/api/docs/guides/agents-api/tools/functions), [environments/security](https://developers.openai.com/api/docs/guides/agents-api/environments/security).
