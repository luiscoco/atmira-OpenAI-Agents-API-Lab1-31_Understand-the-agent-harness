# Lab 37 - Recover an environment failure

Recover observation loss or executor disconnection without blindly replaying the original task. The page includes five failure cases, a recovery decision exercise, a live one-subscription-loss injection, a bounded worker, evidence export and six narrated snippets.

## Run the exercise

Build the existing Lab 32 executor:

```powershell
docker build -t agents-lab32-executor:local sandbox/lab32
```

Set `LAB37_ENABLE_LOCAL_EXECUTOR=true` and both distinct keys in `.env`, then restart. Use the same owner/project and restricted environment-connection permissions as Lab 32. The fixed task only lists deterministic fixture files.

Choose the one-subscription-loss fault. After input acceptance, the application closes only its local event subscription. The executor remains running. The worker retrieves the session, environment, turns and items and either reads the completed result or reattaches once. Select no fault as a comparison.

A real disconnected executor follows the same saved-state decision policy: validate the ownership mapping, remove the old named container and start a replacement against the **same environment ID**. This rebuilds the deterministic input fixture; volatile workspace writes are not preserved. The same session and submission continue only while the remote turn remains resumable. Failed/expired environments or an exhausted one-attempt budget settle with an explained error and cleanup. Input is submitted at most once with an API idempotency key.

The injected stream loss is not an executor-crash claim. Disconnect/replacement, mismatch rejection, exhausted recovery and deadline cases are independently tested with injected API/provider adapters. Five synthetic scenarios explain the UI decisions. A five-minute deadline bounds live work. Retry cleanup separately from task execution; after abrupt termination inspect only Lab 37's exact recorded container/session identifiers.

## Implementation walkthrough

### 1. Save one ownership mapping

Source: [server/lab37Service.ts](server/lab37Service.ts).

```text
spec = { name, nonce, environmentId, remoteUrl };
```

A recovery worker owns the mapping from session to environment and container. Concurrent requests use the same job ID so they cannot launch duplicate compute.

### 2. Send the original input once

Source: [server/lab37.ts](server/lab37.ts).

```text
'Idempotency-Key': `lab37-${id}`
```

The worker marks submission before awaiting acceptance and never blindly resubmits after observation loss. The API idempotency key gives the original message a stable identity; an accepted request is not proof that its turn completed.

### 3. Inspect saved state after loss

Source: [server/lab37Service.ts](server/lab37Service.ts).

```text
const saved = await api.inspect(session.id, signal);
```

A closed subscription does not establish a remote failure. Retrieve the session, environment, saved turns and items before choosing whether to inspect a result, reattach or replace compute.

### 4. Bound reconnection

Source: [src/lab37Recovery.ts](src/lab37Recovery.ts).

```text
if (attempts >= 1) return 'stop-and-cleanup';
```

The course worker allows one recovery attempt. A failed or expired environment asks for a corrected new run. A terminal root needs result inspection rather than more execution.

### 5. Preserve state honestly

Source: [server/lab37Service.ts](server/lab37Service.ts).

```text
await provider.remove(containerName);
await provider.start(spec);
```

A replacement executor uses the same session environment ID and rebuilds deterministic fixture inputs. API session state can survive; volatile temporary files do not. The original turn continues only if the remote service still permits it.

### 6. Clean up independently

Source: [server/lab37Service.ts](server/lab37Service.ts).

```text
await Promise.allSettled([removeCompute(), deleteSession()]);
```

Compute removal and API deletion must both be attempted even if one fails. Keep the remote outcome unknown unless observed, show the retained mapping, and retry cleanup separately from task execution.

## Validation and checkpoint

```powershell
npm run test:lab37
npm run build
```

The page and server share 6 rule checks. Integration tests exercise actual local handlers and injected API/provider failures, rather than making live model calls. TypeScript and production build checks cover the application integration. The live API/model paths need configured credentials and have not been exercised in this workspace.

Choose the correct next step for all five states. Export a live injected-loss trace showing saved-state inspection and no duplicate input. Explain session continuity versus volatile filesystem continuity and how the retry budget ends.

Official references (checked 2026-10-05): [environments/lifecycle](https://developers.openai.com/api/docs/guides/agents-api/environments/lifecycle), [errors](https://developers.openai.com/api/docs/guides/agents-api/errors), [sessions/events](https://developers.openai.com/api/docs/guides/agents-api/sessions/events).
