# Lab 42 — Coordinate reviewer and writer

Open the course application and choose Lab 42, or reload with `#lab42`. Start the server with `npm run dev`; use a free PORT if the default is occupied. No API key is required for local exercises.

## Exercise

Review the flawed writer draft. Inspect findings AC-01 through AC-03. Edit the draft manually or apply the fixture revision, then review again. The report is marked stale until reviewed against the changed draft.

## Evidence and student checkpoint

Export the original reviewed snapshot, reviewer findings and revised draft. All three acceptance checks must pass. Only the writer edits the draft; the reviewer returns its own report.

Use **Export evidence and notes** to save observations. Run the browser and server rule suites and inspect a meaningful failure case. Expand **How this lab was built** for six explained snippets and Viva voice narration.

## Implementation

- `src/OperationsLab.tsx`: React exercise, controls, source labels and evidence export.
- `src/operationsLabRules.ts`: shared deterministic rules and browser/server checks.
- `src/operationsLessons.ts`: six narrated snippets for each lab.
- `server/labs41to50.ts`: same-origin localhost handlers and server test endpoint.
- `server/operationsService.ts`: webhook ledger, ownership store and bounded retry worker.
- `server/operations.integration.test.ts`: signature, replay, rendering, ownership, HTTP and retry regression tests.

Run `npm run test:operations`, `npm run typecheck` and `npm run build`. Lab 40's earlier integration suite remains available with `npm run test:lab40`.

## Runtime boundary

Manual writer/reviewer workflow and deterministic checks. These buttons do not create subagents or write shared files.

Labs 44's live and fixture ledgers are separate ignored files under `.lab-data/` and retained across restart. Auth identities, session mappings and budgets are process-local teaching state and reset on restart. Imported evidence is processed in the browser and sent nowhere by these inspectors.

Reference checked 2026-10-05: [Official multi-agent documentation](https://developers.openai.com/api/docs/guides/agents-api/multi-agent).
