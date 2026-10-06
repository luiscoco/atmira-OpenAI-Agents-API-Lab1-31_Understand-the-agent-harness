# Lab 54 — Test safety and tool boundaries

Open the course at `#lab54`. Labs 51–56 are a continuous specification-to-evidence workflow. Node 24 or later is required for the built-in SQLite capstone database.

## Exercise

Run the red-team split and inspect validator reasons. Try foreign source parameters, .env paths, executable uploads, invalid CSV, fake quote text, self-approved findings and arbitrary URL tools. Rerun after fixes. Use Lab 56 live mode to inspect actual model behavior on adversarial source text if desired.

## Evidence and student checkpoint

The server enforces ownership, strict function arguments, typed uploads, exact owned quotes and separate approval authority. Uploaded instructions do not grant new tools. Review semantic entailment manually; quote existence does not prove a claim. Deterministic boundary results do not certify prompt-injection resistance.

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
