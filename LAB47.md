# Lab 47 — Read an agent trace

Open the course application and choose Lab 47, or reload with `#lab47`. Start the server with `npm run dev`; use a free PORT if the default is occupied. No API key is required for local exercises.

## Exercise

Inspect the successful synthetic trace, select a tool span, then enable the failed-source fixture. Follow its parent generation and turn. Import OTLP resourceSpans or a session trace export page containing data[].otlp.resourceSpans.

## Evidence and student checkpoint

Explain the failed tool and its containing turn. Unset status remains unset. Partial pages can omit parents; retrieve all pages before claiming a complete trace. Session trace export requires organization enablement and project trace-read or agent-read permissions. Do not use private dashboard endpoints.

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

Synthetic OTLP examples and local imported trace inspection. Imports are bounded to 200 KB and 500 spans.

Labs 44's live and fixture ledgers are separate ignored files under `.lab-data/` and retained across restart. Auth identities, session mappings and budgets are process-local teaching state and reset on restart. Imported evidence is processed in the browser and sent nowhere by these inspectors.

Reference checked 2026-10-05: [Official tracing documentation](https://developers.openai.com/api/docs/guides/agents-api/tracing).
