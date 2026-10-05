# Lab 50 — Protect user sessions

Open the course application and choose Lab 50, or reload with `#lab50`. Start the server with `npm run dev`; use a free PORT if the default is occupied. No API key is required for local exercises.

## Exercise

Sign in as Alice and create a fixture session. Preserve the opaque app ID; switch to Bob and attempt read, stop and delete. All must return 404. Switch back to Alice and confirm the session is still idle. Then stop or delete it. Sign out and confirm access is rejected.

## Evidence and student checkpoint

No provider IDs or credentials leave the server mapping. Foreign sessions and unknown IDs return the same response. The token expires in one hour and logout revokes it. Each operation authenticates and checks the owner. Origin checks and SameSite cookies constrain local mutations.

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

Local demo identity selector with real opaque HttpOnly cookie authentication and ownership enforcement. It substitutes for credential/OIDC validation and uses fixture provider IDs. A production deployment needs validated identity, durable mapping, shared budgets, HTTPS and persistent revocation.

Labs 44's live and fixture ledgers are separate ignored files under `.lab-data/` and retained across restart. Auth identities, session mappings and budgets are process-local teaching state and reset on restart. Imported evidence is processed in the browser and sent nowhere by these inspectors.

Reference checked 2026-10-05: [Official sessions/manage documentation](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage).
