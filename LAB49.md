# Lab 49 — Add limits and retries

Open the course application and choose Lab 49, or reload with `#lab49`. Start the server with `npm run dev`; use a free PORT if the default is occupied. No API key is required for local exercises.

## Exercise

Sign in as Alice directly in Lab 49 using the demo identity buttons. This sign-in tracks the local request budget and is separate from OPENAI_API_KEY. Run recovery, exhausted, permanent-authentication and long-Retry-After cases. Clear the safe-read checkbox to verify that unsafe writes do not retry. Exhaust three application requests; the fourth returns 429. Sign in as Bob on the same page to check an independent budget. Sign out to confirm the run button is disabled.

## Evidence and student checkpoint

Export the attempt log, delays and budget reservation. The policy allows four attempts maximum. A long provider delay stops this bounded request instead of retrying too early. These request limits do not enforce a dollar-spend cap. Do not resubmit uncertain session creation without reconciliation or a supported idempotency contract.

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

Actual bounded worker and server-side per-identity request budget over injected local HTTP statuses; no model charges. Budget windows last one minute.

Labs 44's live and fixture ledgers are separate ignored files under `.lab-data/` and retained across restart. Auth identities, session mappings and budgets are process-local teaching state and reset on restart. Imported evidence is processed in the browser and sent nowhere by these inspectors.

Reference checked 2026-10-05: [Official errors documentation](https://developers.openai.com/api/docs/guides/agents-api/errors).
