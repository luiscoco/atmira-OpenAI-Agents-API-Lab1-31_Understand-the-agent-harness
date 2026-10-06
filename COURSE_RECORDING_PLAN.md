# Udemy recording plan — 125 lessons / 12 hours

This is the planned video schedule for [CURRICULUM.md](CURRICULUM.md). Lab numbers identify practical units; video numbers identify recordings. Labs 01–56 now include implemented course exercises and a bounded document-research capstone baseline. The schedule does not claim that videos have been recorded or that optional native/external integrations have been verified.

Durations are editing targets in minutes. Exercises, quizzes, coding time, API wait time, and downloadable material are outside the 720-minute video budget. Short explanations sit beside the relevant lab rather than forming a separate theory section. Simple walkthroughs use prepared code checkpoints; advanced exercises remain available in written material.

| Recording category | Videos | Minutes |
| --- | --- | --- |
| Orientation and setup | 5 | 25 |
| Concepts and troubleshooting | 40 | 140 |
| Labs 01–55 walkthroughs | 55 | 330 |
| Lab 56 orientation | 1 | 10 |
| Lab 56 implementation | 24 | 215 |
| **Total** | **125** | **720** |

## How it was built — step by step

This explains how the recording schedule was organized around the lab implementation. The tables are editing targets; they do not assert that the recordings or optional capstone extensions already exist. Use each implemented `LAB01.md`–`LAB56.md` guide for the actual code walkthrough.

### 1. Match each recording to a practical unit

Preserve the lab numbers from [the curriculum](CURRICULUM.md) and assign a separate video number. Start with setup videos, then place short concept explanations beside the walkthrough that uses them.

### 2. Prepare the runnable code and its explanation

For an implemented lab, read its build section, locate the named server handler and React page, and choose a key snippet to show before running it. For example, Lab 02 teaches the input event used for a follow-up:

```ts
// server/index.ts, existing-session branch of handleRun
stream = await client.beta.agents.sessions.events.stream(sessionId);
await client.beta.agents.sessions.events.create(sessionId, {
  events: [{
    type: 'agent.session.input.message',
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
  }],
});
```

**Why:** Open the stream before submitting input so the handler can observe the new turn's earliest events. Reusing `sessionId` continues the existing conversation. Record the unchanged session ID and new turn ID as the completion evidence.

### 3. Pair the happy path with a visible failure

Use the guide's offline inspector or synthetic cases for repeatable failures, clearly label their source, and show which checks still need a live run. Keep the code explanation, run, and resulting evidence together in the walkthrough.

### 4. Budget the sequence

The five categories sum to 125 videos and 720 target minutes: setup, concepts, Labs 01–55 walkthroughs, Lab 56 orientation, and 24 project implementation videos. These are course planning choices; student exercises and provisioning waits are additional time.

### 5. Break the planned project into demonstrable milestones

Videos 102–125 map the Lab 56 specification to architecture, ownership, persistence, inputs, execution, sources, reports, approvals, evaluation, and deployment. Prepare runnable starting and completed checkpoints before recording each milestone and attach the specified acceptance evidence.

### 6. Verify the material before recording

Run the relevant offline checks and build, verify access for any live integration, and retain the trace or downloaded result that proves the demonstrated outcome. Update lesson code and errata when dependencies or API behavior change. The schedule below supplies the order and time targets; the lab guides supply the implementation steps and explanations.

## Orientation and setup

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 001 | Course outcome and finished application tour | Setup | 5 | Ready to follow the course and locate its checkpoints |
| 002 | Prerequisites and access requirements | Setup | 5 | Ready to follow the course and locate its checkpoints |
| 003 | Install and run the teaching application | Setup | 5 | Ready to follow the course and locate its checkpoints |
| 004 | Configure server credentials and inspect a first run | Setup | 5 | Ready to follow the course and locate its checkpoints |
| 005 | Use labs, checkpoints, exercises, and evidence | Setup | 5 | Ready to follow the course and locate its checkpoints |

## First run and conversation

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 006 | Agents, sessions, turns, and saved items | Concept 01 | 3 | Explain the decision and recognize its failure boundary |
| 007 | Create your first agent | Lab 01 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 008 | Instructions and conversation context | Concept 02 | 3 | Explain the decision and recognize its failure boundary |
| 009 | Continue and customize | Lab 02 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 010 | Reading lifecycle events | Concept 03 | 3 | Explain the decision and recognize its failure boundary |
| 011 | Inspect the lifecycle | Lab 03 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 012 | Recovery and session retention | Concept 04 | 3 | Explain the decision and recognize its failure boundary |
| 013 | Handle interrupted work | Lab 04 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 014 | Manage sessions | Lab 05 | 6 | Demonstrate the lab checkpoint and inspect its evidence |

## Reusable configuration and TypeScript

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 015 | Static types and runtime validation | Concept 05 | 3 | Explain the decision and recognize its failure boundary |
| 016 | Move the app to TypeScript | Lab 06 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 017 | Saved agents and session overrides | Concept 06 | 3 | Explain the decision and recognize its failure boundary |
| 018 | Save and reuse an agent | Lab 07 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 019 | Comparing models with controlled inputs | Concept 07 | 3 | Explain the decision and recognize its failure boundary |
| 020 | Override one session | Lab 08 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 021 | Output contracts and repair boundaries | Concept 08 | 3 | Explain the decision and recognize its failure boundary |
| 022 | Compare models and reasoning settings | Lab 09 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 023 | Design an output contract | Lab 10 | 6 | Demonstrate the lab checkpoint and inspect its evidence |

## Streaming and the React experience

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 024 | Text deltas and completed content | Concept 09 | 3 | Explain the decision and recognize its failure boundary |
| 025 | Render text events correctly | Lab 11 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 026 | Root outcomes and timeline ordering | Concept 10 | 3 | Explain the decision and recognize its failure boundary |
| 027 | Build a turn timeline | Lab 12 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 028 | Disconnect recovery without duplicate input | Concept 11 | 3 | Explain the decision and recognize its failure boundary |
| 029 | Recover after a disconnect | Lab 13 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 030 | Steering, cancellation, and unknown usage | Concept 12 | 3 | Explain the decision and recognize its failure boundary |
| 031 | Cancel and steer a turn | Lab 14 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 032 | Show usage and duration | Lab 15 | 6 | Demonstrate the lab checkpoint and inspect its evidence |

## Function tools and human control

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 033 | Tool schemas and least privilege | Concept 13 | 3 | Explain the decision and recognize its failure boundary |
| 034 | Declare a function tool | Lab 16 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 035 | Required actions and result submission | Concept 14 | 3 | Explain the decision and recognize its failure boundary |
| 036 | Complete a required action | Lab 17 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 037 | Timeouts, errors, and input validation | Concept 15 | 3 | Explain the decision and recognize its failure boundary |
| 038 | Validate tool inputs | Lab 18 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 039 | Approval state and consequential writes | Concept 16 | 3 | Explain the decision and recognize its failure boundary |
| 040 | Connect a read-only service | Lab 19 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 041 | Approve a write action | Lab 20 | 6 | Demonstrate the lab checkpoint and inspect its evidence |

## Search, MCP, plugins, and credentials

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 042 | Citations and source verification | Concept 17 | 3 | Explain the decision and recognize its failure boundary |
| 043 | Add web search | Lab 21 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 044 | MCP connection origins and allowlists | Concept 18 | 3 | Explain the decision and recognize its failure boundary |
| 045 | Connect a public MCP server | Lab 22 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 046 | Private credentials and rotation | Concept 19 | 3 | Explain the decision and recognize its failure boundary |
| 047 | Restrict MCP tools | Lab 23 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 048 | Plugins versus skills versus tool servers | Concept 20 | 3 | Explain the decision and recognize its failure boundary |
| 049 | Add private MCP authentication | Lab 24 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 050 | Package a reusable plugin | Lab 25 | 6 | Demonstrate the lab checkpoint and inspect its evidence |

## Hosted environments and artifacts

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 051 | Choosing compute for the task | Concept 21 | 4 | Explain the decision and recognize its failure boundary |
| 052 | Choose an environment | Lab 26 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 053 | Staged input files and sandbox paths | Concept 22 | 4 | Explain the decision and recognize its failure boundary |
| 054 | Provide input files | Lab 27 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 055 | Packages and network policy | Concept 23 | 4 | Explain the decision and recognize its failure boundary |
| 056 | Configure packages and network | Lab 28 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 057 | Published artifacts, retention, and cleanup | Concept 24 | 4 | Explain the decision and recognize its failure boundary |
| 058 | Create and download artifacts | Lab 29 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 059 | Clean up sandbox resources | Lab 30 | 6 | Demonstrate the lab checkpoint and inspect its evidence |

## Harnesses, self-hosting, and security

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 060 | Harness ownership across API products | Concept 25 | 4 | Explain the decision and recognize its failure boundary |
| 061 | Understand the agent harness | Lab 31 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 062 | Connect a self-hosted environment | Lab 32 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 063 | Instruction scope and enforced permissions | Concept 26 | 4 | Explain the decision and recognize its failure boundary |
| 064 | Apply project rules with AGENTS.md | Lab 33 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 065 | Create and discover standalone skills | Lab 34 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 066 | Skill discovery and activation evidence | Concept 27 | 4 | Explain the decision and recognize its failure boundary |
| 067 | Limit filesystem access | Lab 35 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 068 | Run an environment-origin MCP server | Lab 36 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 069 | Executor lifecycle and isolation | Concept 28 | 4 | Explain the decision and recognize its failure boundary |
| 070 | Recover an environment failure | Lab 37 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 071 | Build a guarded file assistant | Lab 38 | 6 | Demonstrate the lab checkpoint and inspect its evidence |

## Multi-agent work

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 072 | Delegation contracts and bounded concurrency | Concept 29 | 4 | Explain the decision and recognize its failure boundary |
| 073 | Enable subagents | Lab 39 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 074 | Independent tasks and failed children | Concept 30 | 4 | Explain the decision and recognize its failure boundary |
| 075 | Run independent tasks in parallel | Lab 40 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 076 | Root and child event ownership | Concept 31 | 4 | Explain the decision and recognize its failure boundary |
| 077 | Display subagent progress | Lab 41 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 078 | Reviewer findings and coordination cost | Concept 32 | 4 | Explain the decision and recognize its failure boundary |
| 079 | Coordinate reviewer and writer | Lab 42 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 080 | Compare single and multi-agent runs | Lab 43 | 6 | Demonstrate the lab checkpoint and inspect its evidence |

## Observability, integrations, and operations

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 081 | Webhooks, lifecycle hooks, and callbacks | Concept 33 | 4 | Explain the decision and recognize its failure boundary |
| 082 | Receive a webhook | Lab 44 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 083 | Browser WebMCP versus server MCP | Concept 34 | 4 | Explain the decision and recognize its failure boundary |
| 084 | Automate with lifecycle hooks | Lab 45 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 085 | Expose React actions through WebMCP | Lab 46 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 086 | Traces, usage, and bounded retries | Concept 35 | 4 | Explain the decision and recognize its failure boundary |
| 087 | Read an agent trace | Lab 47 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 088 | Record usage carefully | Lab 48 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 089 | Application identity and session ownership | Concept 36 | 4 | Explain the decision and recognize its failure boundary |
| 090 | Add limits and retries | Lab 49 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 091 | Protect user sessions | Lab 50 | 6 | Demonstrate the lab checkpoint and inspect its evidence |

## Specification, evaluation, and capstone readiness

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 092 | Acceptance criteria and requirement IDs | Concept 37 | 4 | Explain the decision and recognize its failure boundary |
| 093 | Build from a specification with SDD | Lab 51 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 094 | Behavioral evaluation versus execution harnesses | Concept 38 | 4 | Explain the decision and recognize its failure boundary |
| 095 | Build an evaluation dataset | Lab 52 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 096 | Run regression checks | Lab 53 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 097 | Regression evidence and safety probes | Concept 39 | 4 | Explain the decision and recognize its failure boundary |
| 098 | Test safety and tool boundaries | Lab 54 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 099 | Deployment foundations and project handoff | Concept 40 | 4 | Explain the decision and recognize its failure boundary |
| 100 | Deploy the React and Node app | Lab 55 | 6 | Demonstrate the lab checkpoint and inspect its evidence |
| 101 | Research and Report Workspace: project orientation and readiness | Lab 56 orientation | 10 | Review prerequisites and reuse prepared checkpoints; implementation follows in videos 102–125 |

## Lab 56 implementation — Research and Report Workspace

These 24 videos replace a separate short capstone implementation. They reuse the specification, evaluation patterns, and deployment foundation from Labs 51–55. A prepared React/Node shell, authentication integration, migrations, source fixture, and sample inputs keep recording focused on the agent application. Each milestone has a runnable starting and completed checkpoint.

## Specification, architecture, and data model

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 102 | Define the user journey and project scope | Lab 56 project | 7 | Reviewed scope and sample user journey |
| 103 | Write acceptance criteria and plan the work | Lab 56 project | 8 | Specification with AC-01–AC-12 |
| 104 | Design the application and agent boundaries | Lab 56 project | 7 | Architecture diagram and runtime ownership |
| 105 | Design workspace records and database migrations | Lab 56 project | 8 | Schema and runnable migration checkpoint |

## Authentication, ownership, persistence, and sessions

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 106 | Connect authentication and create the first workspace | Lab 56 project | 8 | Signed-in workspace creation |
| 107 | Enforce ownership on server routes | Lab 56 project | 9 | Two-user access rejection, AC-02 |
| 108 | Persist investigations and restore saved work | Lab 56 project | 9 | Reload/restart persistence, AC-01 |
| 109 | Map investigations to Agents API sessions | Lab 56 project | 9 | Server-owned session mapping, AC-04 |

## Uploads, execution, streaming, and recovery

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 110 | Validate and stage documents and CSV inputs | Lab 56 project | 10 | Accepted/rejected uploads, AC-03 |
| 111 | Create and continue a research session | Lab 56 project | 10 | Same-session follow-up, AC-04 |
| 112 | Render progress and support steering and cancellation | Lab 56 project | 10 | Visible root outcomes, AC-05 |
| 113 | Recover saved work after a disconnect | Lab 56 project | 10 | Recovery without duplicate submitted input, AC-04 |

## MCP, skills/plugins, subagents, and reports

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 114 | Connect restricted research sources and authenticated MCP | Lab 56 project | 10 | Allowlist and authenticated local fixture evidence |
| 115 | Add web research and verify citations | Lab 56 project | 10 | Source-to-claim check, AC-06 |
| 116 | Package research and report skills in a plugin | Lab 56 project | 10 | Skill discovery and instruction-read evidence, AC-07 |
| 117 | Delegate research and analysis to bounded subagents | Lab 56 project | 10 | Delegation contracts and progress, AC-05/AC-07 |
| 118 | Review findings and reconcile specialist outputs | Lab 56 project | 10 | Reviewer findings and revision, AC-06/AC-07 |
| 119 | Generate, identify, and download the report | Lab 56 project | 10 | Markdown report and owner-scoped download, AC-08 |

## Approvals, evaluation, and failure handling

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 120 | Approve and deduplicate a saved finding | Lab 56 project | 9 | Authorized approve/reject and one persisted write, AC-09 |
| 121 | Receive and deduplicate webhook notifications | Lab 56 project | 8 | Replay-safe records, AC-10 |
| 122 | Handle failed children and reconcile interrupted operations | Lab 56 project | 9 | Bounded recovery and explicit unknown outcomes, AC-05/AC-10 |
| 123 | Evaluate the application against its specification | Lab 56 project | 9 | Versioned regression report, AC-11 |

## Deployment and acceptance

| Video | Title | Lab or role | Minutes | Completion focus |
| --- | --- | --- | --- | --- |
| 124 | Deploy and verify the application configuration | Lab 56 project | 8 | Hosted smoke check and cleanup plan, AC-12 |
| 125 | Demonstrate acceptance criteria and package the submission | Lab 56 project | 7 | AC-01–AC-12 evidence and student handoff |

## Supporting integrations and delivery boundaries

The project uses one managed Agents API execution path and a separate course evaluation runner. Use OpenAI-hosted sandboxes for the baseline and supply a self-hosted adaptation from Labs 32–38. Application database records and Agents API session state have distinct ownership and recovery rules.

Codex project instructions and lifecycle hooks support development using Labs 33 and 45; retain their validation evidence separately from application runtime traces. WebMCP uses the optional Lab 46 demonstration and is not required to pass the main project. Recorded alternatives and offline replays must be identified explicitly; they do not establish that a live integration works for the student.

Maintain sample documents/CSV, an authenticated local MCP source fixture, an event replay, environment setup instructions, API access requirements, and an errata log. Before recording, verify dependencies and current API documentation. Long provisioning waits can be edited, but show the final trace or artifact that establishes the result.

