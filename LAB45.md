# Lab 45 — Automate with lifecycle hooks

Open the course application and choose Lab 45, or reload with `#lab45`. Start the server with `npm run dev`; use a free PORT if the default is occupied. No API key is required for local exercises.

## Exercise

Run both validation command buttons and inspect exit codes 0 and 2. Copy sandbox/lab45/project-hooks.json to .codex/hooks.json in an isolated project; copy the validator to sandbox/lab45/validate-report.mjs in that project. Create report.md with the Release report header and Total: 2800. In a supported Codex CLI, inspect and trust the command through /hooks; edit the total to 2801 and back using a matching file-edit tool. Record the native hook results.

## Evidence and student checkpoint

Compare the project config with sandbox/lab45/plugin/hooks/hooks.json and its .codex-plugin/plugin.json manifest. Install the plugin through the supported runtime in an isolated exercise. The bundled validator uses PLUGIN_ROOT. Do not install both variants simultaneously: matching hooks merge. Record matcher, trust source, timeout and failure feedback. A post-tool failure cannot undo the preceding edit.

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

Direct validator execution is verified locally. Native Codex lifecycle dispatch requires the supported runtime and hook trust review; it is not claimed by the application callback.

Labs 44's live and fixture ledgers are separate ignored files under `.lab-data/` and retained across restart. Auth identities, session mappings and budgets are process-local teaching state and reset on restart. Imported evidence is processed in the browser and sent nowhere by these inspectors.

Reference checked 2026-10-05: [Official hooks documentation](https://learn.chatgpt.com/docs/hooks).
