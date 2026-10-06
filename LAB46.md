# Lab 46 — Expose React actions through WebMCP

Open the course application and choose Lab 46, or reload with `#lab46`. Start the server with `npm run dev`; use a free PORT if the default is occupied. No API key is required for local exercises.

## Exercise

Open Lab 46 in a compatible ChatGPT browser. Inspect Available site tools. Ask the agent to read the report and set its filter to needs-review. Inspect the visible React filter and invocation log. Leave the lab and confirm the tools disappear. If registration is unavailable, use the clearly labelled local buttons.

## Evidence and student checkpoint

Native handler calls must be labelled Native WebMCP execute; local demo buttons are not native evidence. Capture browser discovery separately. Registered actions use the page API and shared React handlers, not an Agents API HTTP MCP connection.

Use **Export evidence and notes** to save observations. Run the browser and server rule suites and inspect a meaningful failure case. Expand **How this lab was built** for six explained snippets and Viva voice narration.

## Implementation

The native verification checkpoint records registration lifetimes separately from local demo calls. In a compatible browser, invoke read-report, set-filter to needs-review, then read-report again. Click **Remove tools and retain evidence**, confirm removal in Available site tools, and export the evidence. A complete checkpoint requires the same registration lifetime for native read/filter/reread and successful removal of both tools. Compare the export with browser Sources / Recently used. Re-registering creates a new lifetime; stale handlers reject execution and observations from different lifetimes cannot complete the checkpoint.

- `src/OperationsLab.tsx`: React exercise, controls, source labels and evidence export.
- `src/operationsLabRules.ts`: shared deterministic rules and browser/server checks.
- `src/operationsLessons.ts`: six narrated snippets for each lab.
- `server/labs41to50.ts`: same-origin localhost handlers and server test endpoint.
- `server/operationsService.ts`: webhook ledger, ownership store and bounded retry worker.
- `server/operations.integration.test.ts`: signature, replay, rendering, ownership, HTTP and retry regression tests.

Run `npm run test:operations`, `npm run typecheck` and `npm run build`. Lab 40's earlier integration suite remains available with `npm run test:lab40`.

## Runtime boundary

Feature-detected document.modelContext registration and local fallback. Native browser invocation was not verified in this environment.

Labs 44's live and fixture ledgers are separate ignored files under `.lab-data/` and retained across restart. Auth identities, session mappings and budgets are process-local teaching state and reset on restart. Imported evidence is processed in the browser and sent nowhere by these inspectors.

Reference checked 2026-10-05: [Official webmcp documentation](https://learn.chatgpt.com/docs/webmcp).
