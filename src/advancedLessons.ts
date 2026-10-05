import { operationsLessons } from './operationsLessons.ts';
export const advancedLessons: Record<number, Array<{ title: string; file: string; code: string; explanation: string }>> = {
  ...operationsLessons,
  "36": [
    {
      "title": "Select connection origin",
      "file": "src/lab36Mcp.ts",
      "code": "connection_origin: 'environment'",
      "explanation": "The executor opens the MCP HTTP connection from its own network namespace. Service-origin connections instead originate at OpenAI and cannot reach this container-local loopback endpoint."
    },
    {
      "title": "Keep the private server local",
      "file": "sandbox/lab36/mcp.mjs",
      "code": "server.listen(8765, '127.0.0.1');",
      "explanation": "The private server runs beside the executor and publishes no Docker port. A loopback address on the application server would name a different machine from the executor."
    },
    {
      "title": "Allow one read-only tool",
      "file": "src/lab36Mcp.ts",
      "code": "allowed_tools: ['get_inventory'], required: true",
      "explanation": "The session discovers only the inventory tool. Required startup makes a failed initialization visible rather than silently continuing without a grounded tool result."
    },
    {
      "title": "Return fresh fixture evidence",
      "file": "sandbox/lab36/entrypoint.sh",
      "code": "inventory = { marker: nonce, item: 'course-notebook', quantity: 7 };",
      "explanation": "Each disposable run receives a new marker. The private tool returns the marker with its synthetic records, so a cached answer cannot pass the freshness check."
    },
    {
      "title": "Capture completed MCP items",
      "file": "server/lab36.ts",
      "code": "if (event.item?.type === 'mcp_call') job.mcpCalls.push(event.item);",
      "explanation": "The lifecycle worker records completed MCP call items separately from shell commands and final text. The checker requires the expected server label, tool, successful status and output fields."
    },
    {
      "title": "Compare the wrong origin",
      "file": "src/Lab36.tsx",
      "code": "privateMcpTool('service'); // expected private-endpoint failure",
      "explanation": "Run the service-origin comparison with the same endpoint. Explain the failure using network location, then distinguish it from authentication and a missing tool. Synthetic cases remain labelled separately from real API evidence."
    }
  ],
  "37": [
    {
      "title": "Save one ownership mapping",
      "file": "server/lab37Service.ts",
      "code": "spec = { name, nonce, environmentId, remoteUrl };",
      "explanation": "A recovery worker owns the mapping from session to environment and container. Concurrent requests use the same job ID so they cannot launch duplicate compute."
    },
    {
      "title": "Send the original input once",
      "file": "server/lab37.ts",
      "code": "'Idempotency-Key': `lab37-${id}`",
      "explanation": "The worker marks submission before awaiting acceptance and never blindly resubmits after observation loss. The API idempotency key gives the original message a stable identity; an accepted request is not proof that its turn completed."
    },
    {
      "title": "Inspect saved state after loss",
      "file": "server/lab37Service.ts",
      "code": "const saved = await api.inspect(session.id, signal);",
      "explanation": "A closed subscription does not establish a remote failure. Retrieve the session, environment, saved turns and items before choosing whether to inspect a result, reattach or replace compute."
    },
    {
      "title": "Bound reconnection",
      "file": "src/lab37Recovery.ts",
      "code": "if (attempts >= 1) return 'stop-and-cleanup';",
      "explanation": "The course worker allows one recovery attempt. A failed or expired environment asks for a corrected new run. A terminal root needs result inspection rather than more execution."
    },
    {
      "title": "Preserve state honestly",
      "file": "server/lab37Service.ts",
      "code": "await provider.remove(containerName);\nawait provider.start(spec);",
      "explanation": "A replacement executor uses the same session environment ID and rebuilds deterministic fixture inputs. API session state can survive; volatile temporary files do not. The original turn continues only if the remote service still permits it."
    },
    {
      "title": "Clean up independently",
      "file": "server/lab37Service.ts",
      "code": "await Promise.allSettled([removeCompute(), deleteSession()]);",
      "explanation": "Compute removal and API deletion must both be attempted even if one fails. Keep the remote outcome unknown unless observed, show the retained mapping, and retry cleanup separately from task execution."
    }
  ],
  "38": [
    {
      "title": "Load guidance explicitly",
      "file": "server/lab38.ts",
      "code": "instructions: JSON.stringify({ rules, skillResources })",
      "explanation": "The application loads the project rules and standalone skill resources into instructions. This demonstrates a verified loading path without claiming automatic API instruction or skill discovery."
    },
    {
      "title": "Enforce exact tool scope",
      "file": "server/lab38Service.ts",
      "code": "if (!['AGENTS.md', 'sales.csv', 'report.md'].includes(path))\n  throw new Error('ACCESS_DENIED');",
      "explanation": "The agent has no filesystem environment or shell. Function handlers enforce exact fixture names before reading real disposable files. Parent traversal and arbitrary absolute paths cannot reach the filesystem through this broker."
    },
    {
      "title": "Reuse the real report helper",
      "file": "server/lab38Service.ts",
      "code": "execFile(process.execPath, [script, fixedCsv, fixedMarker]);",
      "explanation": "The broker invokes the existing Lab 34 helper with fixed paths and bounded runtime. Its exact integer-cent result is independently checked before the model uses it to write a proposed Markdown report."
    },
    {
      "title": "Propose without applying",
      "file": "server/lab38Service.ts",
      "code": "proposal = { id, content, baseHash, status: 'pending' };",
      "explanation": "A proposal records the current content hash and a full before-and-after diff. The agent cannot apply it because no approval function is exposed to the model."
    },
    {
      "title": "Bind review to current content",
      "file": "server/lab38Service.ts",
      "code": "if (hashContent(current) !== proposal.baseHash)\n  throw new Error('STALE_PROPOSAL');",
      "explanation": "The application accepts only the matching pending proposal ID. It rechecks the base hash and report contract, then applies atomically. Rejection leaves the file unchanged and decided proposals cannot be replayed."
    },
    {
      "title": "Keep evidence and dispose",
      "file": "src/Lab38.tsx",
      "code": "downloadEvidence({ proposal, audit, trace }, 'evidence.json');",
      "explanation": "Export the project sources, helper call, denied read and reviewed change. The local broker exercise executes real handlers without a model; the optional live agent uses the same tools. Dispose the fixture directory after the exercise."
    }
  ],
  "39": [
    {
      "title": "Enable harness delegation",
      "file": "src/lab39Delegation.ts",
      "code": "multi_agent: { enabled: true, max_concurrent_subagents: 1 }",
      "explanation": "The Agents API harness supplies coordination tools when delegation is enabled. This lab limits active children to one, excluding the root coordinator, and uses no filesystem environment."
    },
    {
      "title": "Write a delegation contract",
      "file": "src/lab39Delegation.ts",
      "code": "{ task, permittedTools, output, completion }",
      "explanation": "Give the child one labelled source and a bounded extraction question. Define the output fields and how the root will verify the answer rather than asking for vague research."
    },
    {
      "title": "Observe creation separately",
      "file": "src/lab39Delegation.ts",
      "code": "event.type === 'agent.session.subagent.created'",
      "explanation": "A child ID establishes that a child exists. A completed creation call is a separate coordination action and does not establish that the child finished its task."
    },
    {
      "title": "Attribute output by turn",
      "file": "src/lab39Delegation.ts",
      "code": "trace.turns[turn.id] = { child: turn.subagent_id, status };",
      "explanation": "Output text events do not carry a subagent ID. Store turn ownership and use the turn ID to attribute root and child output. Unknown ownership must not contaminate the root answer."
    },
    {
      "title": "Verify the returned work",
      "file": "src/lab39Delegation.ts",
      "code": "verifyDelegation(trace, 39, false);",
      "explanation": "The checker requires child creation and terminal work, then compares root fields with the supplied release note. A correct root answer without child evidence does not prove delegation."
    },
    {
      "title": "Run a disabled comparison",
      "file": "src/lab39Delegation.ts",
      "code": "multi_agent: { enabled: false }",
      "explanation": "Disabling delegation also omits the concurrency setting. The root can still answer the small fixture task, but it must not claim child activity. Compare coordination evidence rather than answer plausibility alone."
    }
  ],
  "40": [
    {
      "title": "Split independent sources",
      "file": "src/lab39Delegation.ts",
      "code": "{ A: releaseSources.A, B: releaseSources.B }",
      "explanation": "Release notes A and B can be analysed independently. Give one source to each child and keep their outputs separate until the root combines the findings."
    },
    {
      "title": "Bound concurrency",
      "file": "src/lab39Delegation.ts",
      "code": "max_concurrent_subagents: 2",
      "explanation": "The harness limits active children while the root coordinates them. This is a concurrency cap, not proof of simultaneous execution or a limit on all children ever created."
    },
    {
      "title": "Observe parallel intervals",
      "file": "src/lab39Delegation.ts",
      "code": "Math.max(a.start, b.start) < Math.min(a.end, b.end)",
      "explanation": "The course checker requires overlapping child turn intervals from in-progress and terminal events. Child creation order and claims in final text cannot establish parallel work; missing timing remains unknown."
    },
    {
      "title": "Wait for both source results",
      "file": "src/lab39Delegation.ts",
      "code": "{ results: [{ source: 'A' }, { source: 'B' }], complete }",
      "explanation": "The root verifies each returned result against its labelled source before forming the comparison. Both source identities are required, so a duplicate result cannot replace a missing source."
    },
    {
      "title": "Handle child and data failures",
      "file": "src/DelegationLab.tsx",
      "code": "{ source: 'B', status: 'unavailable', change: '', migration: '' }",
      "explanation": "The live missing-source task tests an explicit incomplete comparison. A separate synthetic case demonstrates an actual failed child turn. The root can complete with an honest incomplete result; it must not invent absent details."
    },
    {
      "title": "Audit follow-up and cleanup",
      "file": "server/delegationService.ts",
      "code": "stream.controller.abort();\nawait api.delete(sessionId);",
      "explanation": "The prompt permits one follow-up after initial child input and the checker inspects captured actions for violations. A deadline bounds the whole run, root outcomes stay distinct from child outcomes, and API cleanup can be retried without rerunning the task."
    }
  ]
};
