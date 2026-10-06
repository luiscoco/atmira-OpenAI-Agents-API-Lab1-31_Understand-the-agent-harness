# Deploy the Research and Report Workspace

Use Node 24+ and Docker Desktop in Linux container mode. The image runs as an unprivileged user, exposes capstone routes only, excludes environment files/data from the image and checks SQLite readiness. One process/replica owns this SQLite volume.

## Local deployment

From the repository root:

```powershell
docker compose --project-name agents-course-capstone -f capstone/deploy/compose.yaml up --build -d
node --import tsx scripts/smoke-capstone.ts http://localhost:8080
```

Open http://localhost:8080/#lab56. If the port is occupied, set both the port and origin before starting:

```powershell
$env:CAPSTONE_PORT='8186'
$env:CAPSTONE_PUBLIC_ORIGIN='http://localhost:8186'
docker compose --project-name agents-course-capstone -f capstone/deploy/compose.yaml up --build -d
node --import tsx scripts/smoke-capstone.ts http://localhost:8186
```

To test persistence across a real restart:

```powershell
node --import tsx scripts/check-capstone-persistence.ts record http://localhost:8186
docker restart agents-course-capstone-workspace-1
node --import tsx scripts/check-capstone-persistence.ts verify http://localhost:8186
```

The scripts create labelled temporary course accounts and fixture sources. The persistence script writes an ignored temporary cookie checkpoint, revokes that cookie after verification and removes the checkpoint. Test account data remain in the volume for retention review.

## Optional live API configuration

The local deployment can run entirely without API secrets. Supply OPENAI_API_KEY and OPENAI_MODEL from a secret manager or a private environment file only if live research is needed. With a private root .env file, pass --env-file .env to compose. Never copy credentials into the image or an exported evidence file. OPENAI_WEBHOOK_SECRET enables the signed /api/capstone/webhook endpoint; configure session events in the same OpenAI project. Notifications are deduplicated transactionally and require saved-state inspection rather than being treated as successful turn results.

## Hosted configuration

Build/publish this image through your hosting provider. Set PORT=8080, CAPSTONE_DB_PATH=/data/workspace.sqlite and mount durable storage at /data. Deploy one replica. Configure an HTTPS reverse proxy and CAPSTONE_PUBLIC_ORIGIN to its exact origin; the host and Origin must match. Registration requires explicit CAPSTONE_ALLOW_REGISTRATION=true for a course instance. Disable it again once course accounts are provisioned. The supplied local compose configuration binds to loopback and explicitly enables registration for the exercise.

Health: GET /api/capstone/health. Run the smoke script against the actual external origin, retain the target and result, and separately verify live API access if selected. The smoke script does not run a model. No external host was configured by this task, so hosted evidence remains unknown.

Add `--out .lab-data/deployment-smoke.json` to retain dated target evidence. The integrated live profiles are described in [CAPSTONE_INTEGRATIONS.md](../../CAPSTONE_INTEGRATIONS.md); run `scripts/verify-live-capstone.ts connected` or `hosted` from the repository root to check actual calls, citations and native reads with one temporary provider session. Fixture smoke and persistence checks do not establish those live capabilities.

## Limits, retention and cleanup

Defaults: 100 course accounts, 20 workspaces/account, 40 investigations/workspace, eight sources and 250 KB/workspace, 100 KB/file, two active server jobs, five research requests/account/minute, 20 function calls/turn and three minutes of observation. Password sign-in attempts are rate limited. These application limits are not provider dollar-spend caps. Use provider controls separately.

Keep SQLite plus WAL state on the named volume. Stop the service before copying the complete database for backups; encrypt backups and test restore. Retain course data only for the declared teaching period. Application evidence records run outcomes, guidance/tool reads, citation review and approvals; secrets/password hashes are never returned through API views. Email verification, password reset, OIDC, shared-worker quotas and automated retention jobs are outside this bounded teaching baseline.

Cancel active live work, inspect its outcome and delete retained API sessions in the UI before retiring a workspace. Stopping compose preserves the data volume. Removing the named volume deletes all accounts, investigations and reports in that course instance; export needed evidence and review the exact target first. Do not reset another project's volumes. Session deletion does not replace cancellation or provider-compute cleanup; this baseline uses no sandbox.

## Validation performed

The local image builds and its deployed HTTP smoke verifies health, owner download, cross-user rejection and approval replay. A real container restart preserves the account, investigation, approved finding and report. See the capstone integration suite and the generated local evaluation report for reproducible coverage. Native plugin/skill integrations, web/MCP research and external-host/live-model observations remain distinct extensions or unverified evidence.
