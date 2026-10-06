# Curriculum implementation and verification — 2026-10-06

All 56 labs have implemented exercises and guides. Lab 25's unavailable-MCP comparison, connected/hosted research profiles, native research/report skill packaging, hosted source staging, external-source review, bounded observation reconnection, isolated native-hook preparation and verification scripts are implemented. Successful documentation fetches now bind returned text to the requested official URL even when the page has no self-link; outgoing links cannot inherit that page's quote evidence. A separate four-case live model dataset supplements the 24-case deterministic policy dataset.

| Check | Observed result |
| --- | --- |
| Operations, capstone and integration regression suites | 59 passed, zero failed |
| TypeScript checks, including Lab 06 | Passed |
| Production build and Docker image build | Passed on October 6; updated verification container healthy |
| Deterministic evaluation dataset | 24/24 policy cases passed; uncovered criteria remain unknown |
| Deployed localhost smoke | Health, ownership, approval replay and report download passed |
| Persistence across actual container restart | Account, sources, investigation, approval and report restored after updated-image restart on October 6 |
| Live connected research | Passed: completed root, document citation, web search, MCP and exact external quote evidence |
| Live hosted research | Passed: connected checks plus staged-source read and both native research/report skill reads |
| Live model evaluation | 4/4 passed: release grounding, missing support, source prompt injection and conflicting sources; semantic review remains human |
| Native Codex lifecycle dispatch | Isolated exercise prepared; supported runtime trust review and dispatch trace still required |
| Native WebMCP discovery/invocation | Registration and cleanup tested; built-in browser unavailable and browser inventory empty in this session |
| External hosting | Target not selected; external deployment and smoke evidence pending |

The final local container is available at `http://localhost:8187/#lab56`, using the separate Compose project `agents-course-pending-verification`. Its persistent volume retains labelled smoke accounts and sources. Docker smoke and restart checks do not run a model; live provider verification was performed separately with the configured credentials. The Docker build reported one high-severity development-dependency audit finding; the runtime dependency audit reported zero vulnerabilities. Dependency remediation was not part of this course-completion pass.

Local evidence files:

- `.lab-data/pending-deployment-smoke-2026-10-06.json`
- `.lab-data/pending-persistence-2026-10-06.json`
- `.lab-data/pending-evaluation-2026-10-06.json`
- `.lab-data/live-connected-0506c608-a318-48c4-ab06-61c52e00cdbd.json`
- `.lab-data/live-hosted-b05564a4-951f-4048-af56-0f7856bf529f.json`
- `.lab-data/model-evaluation-0626693e-9d1b-4de9-98bf-d32a1475bc1f.json`

All sessions created by the successful October 6 live verifications and model evaluations were deleted. The older provisioning-failed hosted session still refuses deletion with HTTP 409 (`hosted session provisioning or resource creation has not settled`), confirmed by three bounded reconciliation attempts on October 6. The reconciliation script now restricts input to labelled verification databases and retries only HTTP 409, at most three times. Its local record is `.lab-data/live-verification-44f811a1-f81f-44ab-b70a-fa1595b296bc.sqlite`; retry reconciliation after provider provisioning settles:

```powershell
node --import tsx scripts/reconcile-live-capstone.ts .lab-data/live-verification-44f811a1-f81f-44ab-b70a-fa1595b296bc.sqlite
```

See [CAPSTONE_INTEGRATIONS.md](CAPSTONE_INTEGRATIONS.md) for the implementation, narrated snippets and runtime verification instructions. Code implementation, mocked/fixture checks, native execution and external deployment remain separate evidence categories.

Remaining course completion steps: native Codex hook trust/dispatch trace, native WebMCP invocation in a compatible built-in browser, external deployment after a provider/account is selected, and reconciliation of the older provider resource. Email verification, password reset, OIDC/SSO, multi-replica quotas and automated retention remain outside the teaching baseline; the user selected completion of existing course capabilities first.
