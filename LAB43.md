# Lab 43 — Compare single and multi-agent runs

Open the course application and choose Lab 43, or reload with `#lab43`. Start the server with `npm run dev`; use a free PORT if the default is occupied. No API key is required for local exercises.

## Exercise

Inspect the paired synthetic records. Import a JSON array containing one single and one multi run with the displayed task, the same model, source, durationMs, draft, turns, coordinationCalls and recoveryAttempts. Use the fixture JSON as the schema.

## Evidence and student checkpoint

Repeat matched runs and include failed attempts. Compare quality against the same three criteria, wall-clock duration, coordination and recovery overhead. Unknown child usage prevents a complete token-cost conclusion.

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

Synthetic fixtures plus local import of recorded evidence. The inspector does not authenticate imported measurements or launch a benchmark.

Labs 44's live and fixture ledgers are separate ignored files under `.lab-data/` and retained across restart. Auth identities, session mappings and budgets are process-local teaching state and reset on restart. Imported evidence is processed in the browser and sent nowhere by these inspectors.

Reference checked 2026-10-05: [Official observability documentation](https://developers.openai.com/api/docs/guides/agents-api/observability).
