# Lab 40 - Run independent tasks in parallel

Give independent labelled sources to two children and observe whether their work overlaps. Verify each returned result and preserve an explicitly incomplete comparison if a source or child fails. The page includes valid, sequential, missing-source and failed-child cases, an optional live run and six narrated snippets.

## Run the exercise

Inspect the two-source contract and compare the synthetic successful parallel run with a sequential run. Creation order alone is not proof of overlap. The checker needs child in-progress and terminal intervals and separate source reports.

For a live run, configure `OPENAI_API_KEY`, restart and enable delegation. The root receives release notes A and B, delegates one source per child, launches both before waiting, verifies results and returns a source-labelled comparison. `max_concurrent_subagents: 2` caps active children, excluding the coordinator. The cap does not force simultaneous work or limit the total children ever created.

Select unavailable source B for the live data-failure comparison. The final report must include B as unavailable, with empty change/migration fields and `complete: false`. This is a missing-data test, not an injected child-turn failure. A distinct labelled synthetic case includes a genuine-shaped failed child event and a completed root with an honest incomplete result.

The contract permits one follow-up after initial child input. This retry budget is prompt guidance, not an API-enforced retry setting; captured send-input items are checked for violations. The application deadline bounds the full run. The failed-child checkpoint can end with an explicitly incomplete result rather than pretending a retry succeeded.

Child completion/failure cannot settle the root UI. Saved child history supports attribution and report agreement, but missing stream intervals remain unknown; inventory order never manufactures timing. A three-minute deadline bounds live work, API cleanup is independently retryable, and navigation resumes the same saved job while the server process remains alive.

## Implementation walkthrough

### 1. Split independent sources

Source: [src/lab39Delegation.ts](src/lab39Delegation.ts).

```text
{ A: releaseSources.A, B: releaseSources.B }
```

Release notes A and B can be analysed independently. Give one source to each child and keep their outputs separate until the root combines the findings.

### 2. Bound concurrency

Source: [src/lab39Delegation.ts](src/lab39Delegation.ts).

```text
max_concurrent_subagents: 2
```

The harness limits active children while the root coordinates them. This is a concurrency cap, not proof of simultaneous execution or a limit on all children ever created.

### 3. Observe parallel intervals

Source: [src/lab39Delegation.ts](src/lab39Delegation.ts).

```text
Math.max(a.start, b.start) < Math.min(a.end, b.end)
```

The course checker requires overlapping child turn intervals from in-progress and terminal events. Child creation order and claims in final text cannot establish parallel work; missing timing remains unknown.

### 4. Wait for both source results

Source: [src/lab39Delegation.ts](src/lab39Delegation.ts).

```text
{ results: [{ source: 'A' }, { source: 'B' }], complete }
```

The root verifies each returned result against its labelled source before forming the comparison. Both source identities are required, so a duplicate result cannot replace a missing source.

### 5. Handle child and data failures

Source: [src/DelegationLab.tsx](src/DelegationLab.tsx).

```text
{ source: 'B', status: 'unavailable', change: '', migration: '' }
```

The live missing-source task tests an explicit incomplete comparison. A separate synthetic case demonstrates an actual failed child turn. The root can complete with an honest incomplete result; it must not invent absent details.

### 6. Audit follow-up and cleanup

Source: [server/delegationService.ts](server/delegationService.ts).

```text
stream.controller.abort();
await api.delete(sessionId);
```

The prompt permits one follow-up after initial child input and the checker inspects captured actions for violations. A deadline bounds the whole run, root outcomes stay distinct from child outcomes, and API cleanup can be retried without rerunning the task.

## Validation and checkpoint

```powershell
npm run test:lab40
npm run build
```

The page and server share 13 rule checks. Integration tests exercise actual local handlers and injected API/provider failures, rather than making live model calls. TypeScript and production build checks cover the application integration. The live API/model paths need configured credentials and have not been exercised in this workspace.

Submit two-source comparison evidence, identify observed overlap or its absence, and explain both unavailable-source and failed-child scenarios. Show an explicitly incomplete result and the bounded follow-up policy.

Official references (checked 2026-10-05): [multi-agent](https://developers.openai.com/api/docs/guides/agents-api/multi-agent), [sessions/events](https://developers.openai.com/api/docs/guides/agents-api/sessions/events).
