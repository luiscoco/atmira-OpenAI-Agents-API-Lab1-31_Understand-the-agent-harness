# Lab 30 — Clean up sandbox resources

The final hosted-environment lab adds a reviewable cleanup checklist for sessions from Labs 26–29. Students retain needed outputs, settle work, delete one selected session, and verify API absence. Physical sandbox cleanup may continue asynchronously.

## Run the lab

Start the application with `npm run dev` and select **30 · Clean up sandbox resources**. Practice mode, local report downloads, teaching, Viva voice, and the shared policy tests need no API key. Live operations use `OPENAI_API_KEY` from the server environment; the key never reaches React.

1. Select **Practice**. These are synthetic scenarios, not recorded API runs.
2. Try **Active turn** and **Setup still running**. Completing the checkboxes alone cannot enable deletion.
3. In the active scenario, stop input, type the displayed session ID, and request simulated cancellation. Review the checklist again after the turn settles.
4. Select **Completed report**. Download the local Markdown report. The browser computes its SHA-256. Confirm retention separately: a download offered by the browser is not proof it was saved.
5. Stop input, acknowledge retention, and type the selected session ID. Enable the simulated 409 and delete. Export the JSON audit.
6. Select **Sandbox expired**. Explain why the published artifact still downloads. Expiry and session deletion are different operations.
7. Run the browser and server policy suites.

## How it was built — step by step

Follow these steps in implementation order. The teaching excerpts below are shortened from the listed source files; surrounding types, imports, guards, and UI wiring remain in those files. Read each explanation before tracing the complete handler.

### 1. Inspect the session, turn, and sandbox

Source: `server/lab30.ts`.

```ts
const session = await api.beta.agents.sessions.retrieve(id);
const turns = await api.beta.agents.sessions.turns.list(id, {
  order: 'desc', limit: 1,
});
const environment = await api.beta.agents.environments.retrieve(
  session.environment.id,
);
// Session idle does not prove sandbox setup has finished.
```

**Why:** Define `CleanupSnapshot` and `CleanupDecision` in `src/lab30Cleanup.ts`, then build the live inspection adapter in `server/lab30.ts`. Read the session, latest turn, environment, and paginated artifact inventory, and issue a ten-minute inspection ticket. An idle session is only one observation: provisioning, required actions, and unknown environment state can still block cleanup.

### 2. Keep the outputs you need

Source: `server/lab30.ts`.

```ts
for await (const artifact of api.beta.agents.sessions.artifacts.list(id)) {
  // Review path AND turn_id, including previous versions.
  const response = await api.beta.agents.sessions.artifacts.content(
    artifact.id, { session_id: id },
  );
  // Download through your server; verify size and SHA-256.
}
// The checklist asks the user to confirm retention separately.
```

**Why:** Reuse Lab 29's download checks for the inspected artifact inventory and verify byte count and SHA-256. Include previous turns' versions so a revised path cannot hide an earlier deliverable. Keep retention as a separate checklist acknowledgement because offering a browser download does not establish that the student saved it.

### 3. Stop input and cancel active work explicitly

Source: `server/lab30.ts`.

```ts
await api.beta.agents.sessions.events.create(id, {
  events: [{ type: 'agent.session.input.cancel' }],
});
// Request accepted is not the same as turn cancelled.
// Wait, then retrieve session and latest turn again.
// stream.controller.abort() closes the reader only.
```

**Why:** Add a stop-input acknowledgement and an explicit cancellation action bound to the selected session ID. Send `agent.session.input.cancel`, then inspect again until work is terminal; do not infer cancellation from a closed reader. Serialize this app's download, cancel, and delete operations per session to avoid its own operations racing.

### 4. Recheck before deletion and bound retries

Source: `server/lab30Service.ts`.

```ts
export async function executeCleanup(api: CleanupApi, inspected: CleanupSnapshot, decision: CleanupDecision, pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  const trace: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const fresh = await api.inspect(inspected.id);
    const blockers = cleanupBlockers(fresh, decision);
    if (blockers.length) throw new CleanupError(409, blockers.join(' '));
    if (snapshotKey(fresh) !== snapshotKey(inspected)) throw new CleanupError(409, 'The session changed since inspection. Inspect again and review its outputs.');
    try {
      const result = await api.delete(inspected.id);
      if (result.deleted !== true) throw new CleanupError(502, 'The API did not confirm deletion.');
      trace.push(`Attempt ${attempt}: API confirmed deletion.`);
      return { id: inspected.id, deleted: true, attempts: attempt, trace, verification: await verifyCleanup(api, inspected.id), at: new Date().toISOString() };
    } catch (error) {
      if (!retryDelete(errorStatus(error), attempt)) throw error;
      trace.push(`Attempt ${attempt}: 409 conflict; recheck after ${retryDelay(attempt)} ms.`);
      await pause(retryDelay(attempt));
    }
  }
  throw new CleanupError(409, 'Cleanup retry limit reached. Inspect again.');
}
```

**Why:** Separate the cleanup algorithm from the SDK behind the injected `CleanupApi` interface in `server/lab30Service.ts`. Re-inspect and check blockers and the reviewed snapshot before every attempt, require `deleted === true`, and retry only API 409 conflicts, at most three times. Disable SDK retries so the demonstrated bound matches the actual number of attempts.

### 5. Verify API absence and export evidence

Source: `server/lab30Service.ts`.

```ts
export async function verifyCleanup(api: Pick<CleanupApi, 'retrieve'>, id: string) {
  let status = 200;
  try { await api.retrieve(id); }
  catch (error) { status = errorStatus(error); }
  return { status, verified: status === 404, message: verificationLabel(status) };
}
```

**Why:** Verify deletion with a separate read and export the checklist, download hashes, attempts, and verification in the audit. Only retrieval 404 marks API absence; a permission error or timeout remains inconclusive. Keep a Verify again action that does not repeat deletion, and explain that API absence does not observe physical sandbox destruction.

### 6. Build the shared cleanup policy, workbench, and tests

Source: `src/lab30Cleanup.ts`.

```ts
export function cleanupBlockers(snapshot: CleanupSnapshot, decision: CleanupDecision): string[] {
  const reasons: string[] = [];
  if (snapshot.environmentType !== 'openai_hosted') reasons.push('This lab deletes only OpenAI-hosted sessions.');
  if (!['idle', 'failed'].includes(snapshot.status) || snapshot.requiredActions > 0 || (snapshot.turn && !terminalTurn(snapshot.turn.status))) reasons.push('Work is still active or waiting. Cancel if appropriate, then inspect again.');
  if (['provisioning', 'pending'].includes(snapshot.environmentStatus)) reasons.push('Sandbox setup is still running. Wait and inspect again.');
  if (snapshot.environmentStatus === 'unknown') reasons.push('Environment state could not be verified. Inspect again.');
  if (!decision.stoppedInput) reasons.push('Stop sending new input before cleanup.');
  if (!decision.retainedOutputs) reasons.push('Save needed outputs, or explicitly decide that none are needed.');
  if (decision.confirmation !== snapshot.id) reasons.push('Type the selected session ID to confirm deletion.');
  return reasons;
}
```

**Why:** Build the React checklist around the same `cleanupBlockers` policy used by the server. Add five clearly labelled synthetic scenarios, a local report download, policy suites, and six teaching cards from `src/lab30Lessons.ts` with browser narration. Inject a fake API into integration tests to check conflicts, changed state, active-work races, and inconclusive verification without deleting live resources.

**Check your implementation:** Use the offline cases first, then follow the live steps above when access is configured. The student challenge below names the evidence to collect; recorded or synthetic results do not verify a new live run.

## Live cleanup

Use an existing completed hosted session from a previous lab. This lab creates no sandbox and makes no inference requests.

Select **Live**, refresh the hosted-session list, or paste a session ID from Lab 29. The list is project-wide and paginated; a page with no hosted sessions can still have a next page. Inspect the intended session and review its latest turn, required actions, environment state, and all published artifact versions.

Download needed artifacts before deleting. The server restricts downloads to the inspected inventory, checks metadata against the inherited 20 MiB proxy limit, verifies byte count, and sends an attachment with `nosniff`. The browser verifies SHA-256 against the server header before offering a save. Larger files need an application that streams them. Scratch files are not artifacts; publish any needed scratch work before starting cleanup.

Stop all writers to the selected session. Active turns require explicit cancellation if you intend to abandon their unpublished work. Cancellation is a request, so wait and inspect again until work has settled. Closing a stream does not cancel execution. Provisioning and unknown environment state block deletion.

Complete the checklist and type the selected session ID. The inspection ticket expires after ten minutes. The server re-inspects immediately before each deletion attempt and rejects changed state or artifacts. It serializes its own downloads, cancellation, and deletion per session. Other applications can still race; API conflicts must be handled. Only 409 is retried, with at most three attempts and delays of 500 ms and 1000 ms. SDK automatic retries are disabled for this lab.

The result records deletion confirmation and a separate verification outcome. Only retrieval returning 404 verifies API absence. Permission errors, network failures, or a still-retrievable session leave verification inconclusive or pending. **Verify again** checks without reissuing deletion. Export the audit, which includes inspected IDs, checklist decisions, download hashes, attempts, timestamp, and verification. Tickets and locks are in memory: inspect again after server restart or ticket expiry. This lab is a course workbench; a deployed application needs per-user authorization and durable audit storage.

## Teaching and Viva voice audio

Open **Under the hood · Lab 30** for six syntax-highlighted TypeScript snippets and explanations:

1. Inspect session, latest turn, and sandbox.
2. Retain the needed published outputs.
3. Stop input and explicitly cancel active work.
4. Recheck before deletion and bound conflict retries.
5. Verify API absence and export evidence.
6. Understand retention and environment ownership.

Each snippet has **Viva voice · Read aloud** and a stop control. **Read all six** narrates them sequentially. Narration stops when the teaching section closes or another lab is selected. It uses browser speech synthesis and installed voices, with no audio API call or generated audio file. Unsupported browsers show a fallback message; playback errors are displayed.

## Verification

`npm run test:lab30` runs the shared policy suite and integration tests with a fake API. Integration tests exercise the actual cleanup service, retries, changed-state rejection, active-work races, retention gates, false deletion confirmation, and inconclusive verification. They make no network calls or resource deletions. Run `npm run build` for both TypeScript configurations and the production build.

## Student challenge

Export a practice audit with a simulated conflict. Explain why an idle session can still be unsafe to delete. Inspect a completed Lab 29 session live, retain its report, and export an audit showing deletion and retrieval 404. Explain why 404 does not prove the container was physically destroyed. Show both policy suites passing and read one explanation aloud.

## Official references

Lifecycle and expiry behavior: [OpenAI-hosted sandboxes](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted). Session deletion and asynchronous cleanup: [Manage sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage). Artifact lifetime and downloads: [Files and artifacts](https://developers.openai.com/api/docs/guides/agents-api/environments/files). Separate self-hosted shutdown: [Sandbox lifecycle](https://developers.openai.com/api/docs/guides/agents-api/environments/lifecycle).

Documentation checked on 2026-09-28. Synthetic practice results are not claims of a live API probe. Live resource deletion is performed only when a student explicitly confirms it in the page.
