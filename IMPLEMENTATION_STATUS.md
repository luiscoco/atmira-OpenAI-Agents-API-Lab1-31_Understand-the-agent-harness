# Curriculum implementation and verification — 2026-10-05

All 56 labs have implemented exercises and guides. The pending implementation work adds Lab 25's unavailable-MCP comparison, the capstone's connected and hosted research profiles, native research/report skill packaging, hosted source staging, separate external-source review, bounded observation reconnection, isolated native-hook preparation, and repeatable live/deployment verification scripts. Stale curriculum status labels have been corrected. The specification and dataset now target version 1.1.0.

| Check | Observed result |
| --- | --- |
| Operations, capstone and integration regression suites | 58 passed, zero failed |
| TypeScript checks, including Lab 06 | Passed |
| Production build and Docker image build | Passed |
| Deterministic evaluation dataset | 24/24 policy cases passed; uncovered criteria remain unknown |
| Deployed localhost smoke | Health, ownership, approval replay and report download passed |
| Persistence across actual container restart | Account, sources, investigation, approval and report restored |
| Live connected research | Root completed; document citation, web search and MCP calls observed; external exact quote check failed and was labelled unverified |
| Live hosted research | Completed runs observed with MCP and command execution; required native skill/staged reads did not all pass; other attempts had provisioning/connection failures |
| Native Codex lifecycle dispatch | Isolated exercise prepared; supported runtime trust review and dispatch trace still required |
| Native WebMCP discovery/invocation | Existing registration and cleanup tested; no compatible browser was connected for native invocation |
| External hosting | Target not selected; external deployment and smoke evidence pending |

The final local container is available at `http://localhost:8187/#lab56`, using the separate Compose project `agents-course-pending-verification`. Its persistent volume retains labelled smoke accounts and sources. These checks do not run a model.

Local evidence files:

- `.lab-data/pending-deployment-smoke.json`
- `.lab-data/pending-evaluation.json`
- `.lab-data/live-connected-277cb47d-122e-48e6-a60d-6425c9b98003.json`
- `.lab-data/live-hosted-b441703d-8bb7-4160-90c6-f4651e711c7f.json`

Temporary provider sessions were deleted after settled runs. One hosted session from the last provisioning-failed attempt refused deletion with HTTP 409 (`hosted session provisioning or resource creation has not settled`). Its local record is `.lab-data/live-verification-44f811a1-f81f-44ab-b70a-fa1595b296bc.sqlite`; retry reconciliation after provider provisioning settles:

```powershell
node --import tsx scripts/reconcile-live-capstone.ts .lab-data/live-verification-44f811a1-f81f-44ab-b70a-fa1595b296bc.sqlite
```

See [CAPSTONE_INTEGRATIONS.md](CAPSTONE_INTEGRATIONS.md) for the implementation, narrated snippets and runtime verification instructions. Code implementation, mocked/fixture checks, native execution and external deployment remain separate evidence categories.
