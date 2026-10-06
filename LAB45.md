# Lab 45 — Automate with lifecycle hooks

Open the course application and choose Lab 45, or reload with `#lab45`. Start the server with `npm run dev`; use a free PORT if the default is occupied. No API key is required for local exercises.

## Exercise

Run `node --import tsx scripts/prepare-native-hooks.ts` to create an isolated project under `.lab-data/lab45-native-project`. Open that directory in a supported Codex runtime, review its exact hook in `/hooks`, and compare passing/failing report edits with the local invocation ledger and the native lifecycle trace. Preparation does not install hooks in the current project or change global runtime trust. Direct script execution remains separate from native dispatch evidence.

Run both validation command buttons and inspect exit codes 0 and 2. Copy sandbox/lab45/project-hooks.json to .codex/hooks.json in an isolated project; copy the validator to sandbox/lab45/validate-report.mjs in that project. Create report.md with the Release report header and Total: 2800. In a supported Codex CLI, inspect and trust the command through /hooks; edit the total to 2801 and back using a matching file-edit tool. Record the native hook results.

## Evidence and student checkpoint

Compare the project config with sandbox/lab45/plugin/hooks/hooks.json and its .codex-plugin/plugin.json manifest. Install the plugin through the supported runtime in an isolated exercise. The bundled validator uses PLUGIN_ROOT. Do not install both variants simultaneously: matching hooks merge. Record matcher, trust source, timeout and failure feedback. A post-tool failure cannot undo the preceding edit.

Use **Export evidence and notes** to save observations. Run the browser and server rule suites and inspect a meaningful failure case. Expand **How this lab was built** for six explained snippets and Viva voice narration.

## Implementation

Run `npm run prepare:hooks` to prepare `.lab-data/lab45-native-project` while preserving existing report edits and the ledger. Review and trust the exact hook in the supported runtime, then use `apply_patch` to observe totals 2801 (failure) and 2800 (pass). Export the original Codex app-server JSONL notifications, including completed report edits and `hook/completed`. Run `npm run verify:hooks -- <notification-export.jsonl>` to correlate session, turn, tool-call IDs, project config paths, timestamps and outcomes. The resulting `native-hook-review.json` is an assessment of imported evidence; retain and review the original runtime trace. A direct command result or ledger alone remains insufficient.

For a client that supports launching a custom stdio app-server subprocess, configure its command as `node` with arguments `--import tsx scripts/capture-native-hooks.ts`, using the course repository as its working directory. Pass `--codex <absolute-executable-path>` if Codex is not on PATH. Launch the script directly; npm prints extra text that would corrupt the protocol transport. The wrapper starts `codex app-server --listen stdio://` in the prepared project and passes the client's protocol through unchanged. The client must initialize the connection with experimental APIs enabled, retain normal approval handling, and explicitly request the two report edits. The wrapper starts no thread or turn and changes no trust settings. It cannot attach to an already running CLI or IDE conversation; use the original client export for those sessions.

The wrapper writes `.lab-data/lab45-native-project/runtime-notifications.jsonl` using exclusive creation, so an existing trace must first be reviewed and archived. It records only matching completed report-edit metadata and synchronous project-hook metadata, retaining just the two known validator feedback strings. Conversation text, report diffs, commands, credentials and unrelated project events are omitted. The capture is bounded to 2 MB and 10,000 events; a limit warning means incomplete evidence. The protocol still reaches the client. Run `npm run verify:hooks` afterward and compare the result with the client's original trace. A transport handshake or an empty capture does not establish hook dispatch. See the official [app-server protocol](https://learn.chatgpt.com/docs/app-server) and [hook trust flow](https://learn.chatgpt.com/docs/hooks).

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
