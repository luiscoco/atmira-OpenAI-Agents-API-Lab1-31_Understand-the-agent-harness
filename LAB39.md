# Lab 39 - Enable subagents

Enable managed harness delegation and give one child a bounded release-note extraction contract. Verify creation, turn ownership, returned fields and the root result independently. The page includes synthetic valid/claim/disabled cases, an optional live run, evidence export and six narrated snippets.

## Run the exercise

Synthetic cases and browser/server checks require no key. Inspect the single-source contract, then compare valid delegation, a correct root answer with no child evidence, and delegation disabled.

For a live run, configure `OPENAI_API_KEY`, restart and recheck setup. Enable delegation, run the fixed source A task and inspect the creation call, child ID, child turns/messages and root result. Run again with delegation disabled. The request uses `environment.type: none`, includes its initial input at creation and sets `stream: true`. It has no web, shell, function or MCP tools.

The request enables `agent.multi_agent` with a one-active-child limit, excluding the root. The harness supplies coordination tools; the application does not implement or execute those actions. The root verifies returned source fields and preserves them in its final JSON.

Only a root terminal turn settles the UI. Text events do not carry subagent_id: the projector uses turn ownership, and unknown ownership cannot become root output. Saved root and child items/turns are read with explicit bounds. This lab validates the supplied course source, not open-web research quality.

A three-minute deadline bounds the job. Stop requests abort observation and attempt remote cancellation when the outcome is unknown. API deletion is recorded separately and can be retried. Navigation resumes polling the saved job ID; restart loses the in-memory job mapping.

## Implementation walkthrough

### 1. Enable harness delegation

Source: [src/lab39Delegation.ts](src/lab39Delegation.ts).

```text
multi_agent: { enabled: true, max_concurrent_subagents: 1 }
```

The Agents API harness supplies coordination tools when delegation is enabled. This lab limits active children to one, excluding the root coordinator, and uses no filesystem environment.

### 2. Write a delegation contract

Source: [src/lab39Delegation.ts](src/lab39Delegation.ts).

```text
{ task, permittedTools, output, completion }
```

Give the child one labelled source and a bounded extraction question. Define the output fields and how the root will verify the answer rather than asking for vague research.

### 3. Observe creation separately

Source: [src/lab39Delegation.ts](src/lab39Delegation.ts).

```text
event.type === 'agent.session.subagent.created'
```

A child ID establishes that a child exists. A completed creation call is a separate coordination action and does not establish that the child finished its task.

### 4. Attribute output by turn

Source: [src/lab39Delegation.ts](src/lab39Delegation.ts).

```text
trace.turns[turn.id] = { child: turn.subagent_id, status };
```

Output text events do not carry a subagent ID. Store turn ownership and use the turn ID to attribute root and child output. Unknown ownership must not contaminate the root answer.

### 5. Verify the returned work

Source: [src/lab39Delegation.ts](src/lab39Delegation.ts).

```text
verifyDelegation(trace, 39, false);
```

The checker requires child creation and terminal work, then compares root fields with the supplied release note. A correct root answer without child evidence does not prove delegation.

### 6. Run a disabled comparison

Source: [src/lab39Delegation.ts](src/lab39Delegation.ts).

```text
multi_agent: { enabled: false }
```

Disabling delegation also omits the concurrency setting. The root can still answer the small fixture task, but it must not claim child activity. Compare coordination evidence rather than answer plausibility alone.

## Validation and checkpoint

```powershell
npm run test:lab39
npm run build
```

The page and server share 9 rule checks. Integration tests exercise actual local handlers and injected API/provider failures, rather than making live model calls. TypeScript and production build checks cover the application integration. The live API/model paths need configured credentials and have not been exercised in this workspace.

Submit enabled and disabled traces. Identify root versus child output and verify the returned contract against source A. Explain why a create action or a plausible root response alone cannot prove child work.

Official references (checked 2026-10-05): [multi-agent](https://developers.openai.com/api/docs/guides/agents-api/multi-agent), [sessions/events](https://developers.openai.com/api/docs/guides/agents-api/sessions/events).
