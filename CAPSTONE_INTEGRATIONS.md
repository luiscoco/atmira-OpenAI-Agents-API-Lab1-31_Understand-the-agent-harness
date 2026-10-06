# Research integrations and runtime verification

Lab 56 provides three live research profiles. Select them in the **Research integrations** panel after selecting live execution. A retained session keeps its profile and delegation configuration; create a separate investigation to change either.

| Profile | Sources and capabilities | Evidence |
| --- | --- | --- |
| sources | Owned uploaded documents and versioned application guidance | Scoped function calls and exact document citations |
| connected | Sources plus official OpenAI web search and read-only documentation MCP | Actual search/MCP calls, observed URLs and external findings requiring review |
| hosted | Connected research plus staged documents and an installed research/report skill plugin | Environment readiness, staged-source reads and successful native skill commands |

Fixture execution uses sources only and does not call a model. Live mode uses the configured server key and model. External sources are restricted to developers.openai.com and platform.openai.com; the documentation MCP is restricted to search_openai_docs and fetch_openai_doc. The application never fetches a user-provided arbitrary URL. A provider tool's failed output or a model-authored link cannot establish provenance.

Hosted files are copied from the authenticated workspace into `/workspace/sources/<document-id>/<filename>`. The plugin archive is built from server-owned text, containing grounded-research and report-review skills; source uploads cannot replace its instructions. A new hosted session waits for environment readiness before submitting input. Conversation-only sessions require initial input at creation, so that input uses the persisted request key and its saved initial turn is recovered without a second submission. Later inputs subscribe before submission.

Adding documents changes the workspace fingerprint. A retained hosted investigation rejects another run with changed source files; create a new investigation to stage the current documents. Recovery uses the attributed root turn and retains child failures independently.

External findings have a separate review list. An observed tool URL establishes provenance; only exact text in MCP output establishes quote existence. A successful `openai_docs.fetch_openai_doc` binds its returned text to its requested official URL even when the page has no self-link. Failed or `isError` responses supply no evidence. Other links in a fetched page establish observed URLs but cannot borrow its text for quote verification. Search annotations alone cannot verify the quoted text. Human review must establish whether the source supports the claim. The downloadable report labels external findings as requiring review. Approval proposals still require exact citations to owned uploaded documents.

## Walkthrough snippets and narration

1. `integrationConfiguration(profile, documents)` selects capabilities on the server. **Viva voice:** The user selects a named mode. The server chooses the actual endpoint, tool allowlist, plugin and source paths; a prompt cannot broaden them.
2. `files: documents.map(doc => ({ type: 'inline', path, data }))` stages authenticated files. **Viva voice:** These files are a snapshot. A new investigation is required after changes, so native file reads and application citations describe the same sources.
3. `environment.plugins: [{ type: 'inline', source: { type: 'base64', media_type: 'application/zip', data } }]` installs research and report-review skills. **Viva voice:** Installing a package makes instructions available. Successful native command evidence is still needed to show the agent read them.
4. `initialInput ? { input: operation.question } : {}` handles conversation-only creation. **Viva voice:** The provider requires initial input here. We persist one request identity and recover the saved first turn instead of submitting the question twice.
5. `reviewExternalFindings(report.externalFindings, externalSources(items))` checks external provenance. **Viva voice:** A source URL in actual tool output supports review. A link in generated prose is insufficient. Exact quote existence and semantic support are separate checks.
6. `sourceFingerprint(documents)` protects hosted follow-ups. **Viva voice:** Follow-ups reuse one mapped session and one staged snapshot. Changed capabilities or files require a fresh investigation.

## Repeatable verification

```powershell
node --import tsx --test server/capstone.integration.test.ts server/capstoneIntegrations.integration.test.ts server/operations.integration.test.ts
node --import tsx scripts/verify-live-capstone.ts connected
node --import tsx scripts/verify-live-capstone.ts hosted
node --import tsx scripts/evaluate-live-capstone.ts
node --import tsx scripts/smoke-capstone.ts http://localhost:8080 --out .lab-data/deployment-smoke.json
```

Live verification creates one labelled account/source/investigation in an ignored SQLite file, runs one bounded provider session, exports actual checks and tool-output diagnostics to `.lab-data/live-<profile>-<id>.json`, and deletes that provider session. Local verification databases and JSON evidence remain for review. A missing call or read is a failed check, even if the root completes. Unknown connection outcomes are inspected before any further input. If session cleanup fails, use `scripts/reconcile-live-capstone.ts <verification-database>` to inspect and delete only sessions in that labelled live-verification or model-evaluation database. Cleanup retries only HTTP 409, at most three times; use `--attempts 1` for a single attempt. No session is created by reconciliation.

`capstone/model-evaluation-dataset.json` adds four live model cases: release grounding, missing source support, source prompt injection and conflicting sources. `npm run eval:live` runs sequential bounded sources-profile sessions, checks the explicit quote/support/guidance/approval/report rubric, and retains `.lab-data/model-evaluation-<id>.json` plus its SQLite database. It stops after an uncertain outcome or failed session cleanup. These checks consume model usage and supplement the deterministic policy dataset; they do not establish semantic entailment or evaluate every acceptance criterion. Review the actual claims alongside the sources.

For a deployment restart check, follow `capstone/deploy/README.md`. Use the actual external URL for hosted evidence; a localhost result does not establish external hosting.

## Native Codex hooks and WebMCP

Run `node --import tsx scripts/prepare-native-hooks.ts` to prepare an isolated Lab 45 project under `.lab-data/lab45-native-project`. Open that directory in a supported Codex runtime, review the exact hook using `/hooks`, and edit `report.md` with `apply_patch`. Observe both the passing total 2800 and failing total 2801. Compare `hook-invocations.jsonl` with the runtime lifecycle trace: direct invocation or a ledger entry alone is insufficient evidence of native dispatch. Preparation does not modify the user's global runtime configuration.

The validator ledger now includes session, turn and tool-call IDs without prompt text or credentials. Preparation preserves an existing report and ledger. Export Codex app-server `item/completed` and `hook/completed` notifications in JSONL, then run `npm run verify:hooks -- <notification-export.jsonl>`. The verifier checks completed report edits, matching synchronous project hook runs, exact config paths, time intervals and both outcomes. Imported files do not authenticate native execution; compare `native-hook-review.json` with the original runtime. The notification shapes follow the official [app-server documentation](https://learn.chatgpt.com/docs/app-server).

Lab 46 registers tools in a compatible browser and logs native execute calls separately from local button clicks. Verify discovery, report reading, filter changes and removal on leaving the lab. The registered actions use existing validated React handlers. A browser without the WebMCP API uses the labelled local fallback.

The page now provides a checkpoint for native read/filter/reread within one registration lifetime. **Remove tools and retain evidence** waits for unregister results and retains the calls for export; failed removals remain incomplete. Stale handlers reject calls after closing. Confirm removal in the browser's Available site tools and compare the export with Sources / Recently used. Page-handler observations and local demo buttons alone do not authenticate browser discovery.

## Official references

Configuration was checked against the official [web search guide](https://developers.openai.com/api/docs/guides/agents-api/tools/web-search), [MCP guide](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp), [plugin guide](https://developers.openai.com/api/docs/guides/agents-api/tools/plugins), and [files guide](https://developers.openai.com/api/docs/guides/agents-api/environments/files). Runtime verification follows the [Codex hook documentation](https://learn.chatgpt.com/docs/hooks) and [WebMCP documentation](https://learn.chatgpt.com/docs/webmcp).
