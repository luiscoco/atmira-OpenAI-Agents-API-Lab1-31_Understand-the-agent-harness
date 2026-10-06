# Lab 56 — Capstone: Research and Report Workspace

Open the course at `#lab56`. Labs 51–56 are a continuous specification-to-evidence workflow. Node 24 or later is required for the built-in SQLite capstone database.

## Exercise

For connected or hosted research, select live execution and choose a profile in **Research integrations**. See [CAPSTONE_INTEGRATIONS.md](CAPSTONE_INTEGRATIONS.md) for configuration, six narrated snippets, source-review boundaries and repeatable live verification. Use `npm run test:integrations` for the integration regression suite.

Create a password account, workspace and sample source or upload .txt/.md/.csv. Create an investigation and run the deterministic fixture. Inspect root/child statuses, proposals and limitations. Approve or reject findings and download the cited Markdown report. Sign out/in and reopen the saved investigation. Try a follow-up and a cancelled or failed-source run.

## Evidence and student checkpoint

Optional live mode uses the configured Agents API key with environment none, scoped source/guidance functions and at most two children. Session IDs remain server-mapped; browser disconnect does not submit another task. Unknown server outcomes are inspected without resubmission. An unknown creation ID requires project-log reconciliation. Verify cross-user access rejection, approve replay, saved evaluations and deployment evidence.

The page includes shared browser/server checks, six explained snippets with Viva voice narration, and evidence export. Record the source of evidence: pure policy, actual application integration, fixture research, mocked API contract, live provider response, local deployment or external target.

## Implementation

- `src/FinalLab.tsx`: specification, dataset, regression, red-team and deployment exercises.
- `src/ResearchWorkspace.tsx`: accounts, uploads, investigations, progress, approvals and downloads.
- `src/capstoneRules.ts`: shared spec/dataset schemas, upload/tool/citation validators and evaluation runner.
- `src/finalLessons.ts`: narrated walkthroughs for all six final units.
- `server/capstoneStore.ts` and `capstone/migrations/001-workspace.sql`: SQLite persistence, password/token hashing, ownership and transactional approvals.
- `server/capstoneRunner.ts`: scoped function tools, optional live session mapping, fixture runs and saved-state recovery.
- `server/capstoneRoutes.ts`: authentication, per-account budgets, signed webhook deduplication and owner-scoped APIs.
- `server/capstoneServer.ts`: bounded standalone deployment entry point.
- `server/capstone.integration.test.ts`: criterion-linked integration checks.
- `scripts/evaluate-capstone.ts`, `scripts/smoke-capstone.ts`, `scripts/check-capstone-persistence.ts`: reproducible policy and deployment evidence.

Run `npm run test:capstone`, `npm run typecheck`, `npm run eval:capstone` and `npm run build`.

## Runtime scope and gaps

The sources profile researches uploaded documents through authenticated application functions. The connected profile adds domain-restricted web search and an allowlisted official documentation MCP. The hosted profile also stages owned documents under `/workspace/sources` and installs a native plugin containing grounded-research and report-review skills. New hosted sessions wait for readiness before input. Conversation-only sessions submit initial input at creation; follow-ups use the same mapped session. Skill reads and external source evidence are inspected separately from application guidance. Existing hosted sessions reject changed sources until a new investigation is created. External findings enter the report as review-required evidence; only exact owned-document findings create approval proposals. Fixture extraction is labelled and does not claim to answer arbitrary questions. Optional live requests consume model usage and require Agents API access; tests use a mocked adapter rather than charging the provider.

Prepared boundary evaluations leave uncovered criteria unknown. Exact citations need human semantic review. SQLite deployment uses one application process and one replica. A different commercial workload needs its own authentication, storage, recovery and deployment validation.
