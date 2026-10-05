# Lab 44 — Receive a webhook

Open the course application and choose Lab 44, or reload with `#lab44`. Start the server with `npm run dev`; use a free PORT if the default is occupied. No API key is required for local exercises.

## Exercise

Run valid, duplicate, tampered and expired deliveries. Inspect the separate fixture log. Restart the server and confirm the logged event remains. Configure OPENAI_WEBHOOK_SECRET for actual provider deliveries to POST /api/lab44/webhook. Register an HTTPS endpoint and select supported session events in your OpenAI project.

## Evidence and student checkpoint

One event ID appears once despite duplicate or concurrent delivery. Tampered payloads and expired timestamps are rejected by the official SDK verifier. Idle notifications retain an instruction to inspect the turn, rather than asserting success.

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

Local signed fixtures and a real provider signature endpoint. Actual remote delivery requires endpoint registration and a signing secret; it has not been verified without these.

Labs 44's live and fixture ledgers are separate ignored files under `.lab-data/` and retained across restart. Auth identities, session mappings and budgets are process-local teaching state and reset on restart. Imported evidence is processed in the browser and sent nowhere by these inspectors.

Reference checked 2026-10-05: [Official sessions/webhooks documentation](https://developers.openai.com/api/docs/guides/agents-api/sessions/webhooks).
