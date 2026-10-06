# Lab 51 — Build from a specification with SDD

Open the course at `#lab51`. Labs 51–56 are a continuous specification-to-evidence workflow. Node 24 or later is required for the built-in SQLite capstone database.

## Exercise

Review capstone/specification.json in the page editor. Keep AC-01–AC-12 stable, change the version when requirements change, and add concrete evidence links. Validate and mark the current text reviewed. Edit it and observe that the previous review becomes stale.

## Evidence and student checkpoint

The integrated feature is a cited finding proposal that becomes a saved record only after owner approval. Demonstrate it in Lab 56 and locate the AC-09 integration test. A link to a test is not a passing result; retain the executed result and unresolved gaps.

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

The sources profile uses scoped application functions with `environment.type=none`. The connected profile adds official web search and allowlisted documentation MCP; the hosted profile adds staged sources and a native research/report plugin. See [CAPSTONE_INTEGRATIONS.md](CAPSTONE_INTEGRATIONS.md) for repeatable verification and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for observed results. Fixture extraction is labelled. Live requests consume model usage; integration tests use mocked adapters. Run `npm run eval:live` for the separate four-case synthetic model evaluation, then review its claims and limitations.

Prepared boundary evaluations leave uncovered criteria unknown. Exact citations need human semantic review. SQLite deployment uses one application process and one replica. A different commercial workload needs its own authentication, storage, recovery and deployment validation.
