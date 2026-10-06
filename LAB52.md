# Lab 52 — Build an evaluation dataset

Open the course at `#lab52`. Labs 51–56 are a continuous specification-to-evidence workflow. Node 24 or later is required for the built-in SQLite capstone database.

## Exercise

Inspect capstone/evaluation-dataset.json. Its 24 cases include representative text/Markdown/CSV inputs, malformed files, grounded and invented quotes, guidance reads, foreign-owner parameters, unsafe tool names and metadata URLs. Add domain examples, increment the dataset version and preserve the specification version.

## Evidence and student checkpoint

Validate 20–80 unique cases, meaningful prompts, expected accept/reject outcomes and known criterion IDs. Export the JSON. The prepared dataset evaluates application policy; live model quality requires a separate recorded run and review.

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

The baseline researches uploaded documents through authenticated application functions. It uses `environment.type=none`; it does not claim sandbox staging, web search, an external MCP service or native plugin/skill discovery. Application guidance reads are recorded under their actual runtime. These adjacent integrations remain documented extensions using the earlier labs. Fixture extraction is labelled and does not claim to answer arbitrary questions. Optional live requests consume model usage and require Agents API access; tests use a mocked adapter rather than charging the provider.

Prepared boundary evaluations leave uncovered criteria unknown. Exact citations need human semantic review. SQLite deployment uses one application process and one replica. A different commercial workload needs its own authentication, storage, recovery and deployment validation.
