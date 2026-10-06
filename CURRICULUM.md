# OpenAI Agents API with React — 56 hands-on labs

This is a proposed Udemy course sequence, from a first agent run to a production-ready application. **Labs 01–56 have implemented exercises in this repository. The capstone includes uploaded-document research, persistent records, official web search/MCP, and optional hosted files with native research/report skills. Live and external deployment evidence is identified separately.** The roadmap preserves the implemented lab numbers and adds explicit coverage of harness architecture, project rules, standalone skills, lifecycle hooks, WebMCP, and Specification-Driven Design (SDD).

**Recording target: 125 video lessons, approximately 12 hours.** A lab is a practical learning unit; a video lesson is a recording unit. The recording plan adds short explanations alongside the labs and expands Lab 56 into an integrated application project. These counts and durations are course planning targets, not Udemy platform requirements. The complete ordered video schedule is in [COURSE_RECORDING_PLAN.md](COURSE_RECORDING_PLAN.md).

## How it was built — step by step

This section explains how the course sequence maps to the implemented labs. It is a curriculum walkthrough; the implementation instructions and explained code for each completed unit live in `LAB01.md` through `LAB56.md`. The final units include a bounded, runnable capstone baseline.

### 1. Establish one runnable application

Start with the tutor in [Lab 01](LAB01.md), using React for interaction and Node for credentials and SDK calls. The early lessons extend the same session model with follow-ups, inspection, recovery, and history so students can trace one evolving application.

### 2. Introduce types before complex tools

[Lab 06](LAB06.md) adds TypeScript and runtime parsers. Reusable agent configuration, output contracts, and streaming lessons then provide the foundations needed for tool execution.

```ts
// src/lab6Protocol.ts, selected members of the RunEvent union
type RunEvent =
  | { type: 'text'; text: string }
  | { type: 'complete' }
  | { type: 'error'; message: string };
```

**Why:** The `type` field lets students narrow an event before accessing its fields. This shortened union illustrates the pattern; the full protocol also carries status and session events, and `parseRunEvent` checks the incoming values at runtime.

### 3. Add capability together with its verification

Teach declaration, execution, validation, service access, and approval in Labs 16–20. Next add search, MCP restrictions, private authentication, and plugin packaging in Labs 21–25. Each capability has an observable result such as paired call/results, an approval audit, or links grounded in tool output.

### 4. Extend the app into hosted execution

Labs 26–30 add environment choice, staged inputs, package/network configuration, immutable artifacts, and cleanup. Their guides show the readiness wait, execution evidence, independent result checks, and retention decisions students must implement.

### 5. Extend the implemented foundation through the capstone

Labs 31–56 build on these boundaries with harnesses, self-hosting, standalone skills, subagents, integrations, evaluation, and the integrated project. Acceptance criteria AC-01–AC-12 link implementations to tests and runtime evidence. A passing fixture or policy check does not establish native execution or external deployment.

### 6. Allocate videos and student checkpoints

Use the recording budget below and the ordered [recording plan](COURSE_RECORDING_PLAN.md). For each lab, record the changed file, explain a key snippet, demonstrate a success and a meaningful failure, then show the evidence and student challenge. Keep coding time and API waits outside the stated video-duration budget.

## Video structure and recording budget

| Content | Video lessons | Target minutes |
| --- | --- | --- |
| Introduction, prerequisites, setup, and course navigation | 5 | 25 |
| Concepts, architecture, and troubleshooting, placed beside relevant labs | 40 | 140 |
| Walkthroughs of Labs 01–55 | 55 | 330 |
| Lab 56 project orientation and readiness check | 1 | 10 |
| Lab 56 integrated project implementation | 24 | 215 |
| **Total** | **125** | **720 / 12 hours** |

The 56 lab-related videos comprise 55 walkthroughs and one project orientation. The following 24 videos implement Lab 56; they do not repeat a previously completed capstone. The average lesson is approximately 5 minutes 46 seconds. Student coding, exercises, quizzes, and download time are additional to video duration. Record focused changes from prepared checkpoints; edit environment provisioning and installation waits while explaining what happened.

## Course approach

- **One evolving application:** students build on a React 19.3 + Vite interface and a server-side Node application. Lab 06 introduces TypeScript so later labs can teach typed API events and tool schemas.
- **One concept per lab:** explain the API feature, run a small example, inspect the resulting session or event, change one input, and verify the effect.
- **Visible evidence:** every lab ends with a screen, artifact, trace, or test result students can show in a course submission.
- **Secrets stay on the server:** the browser calls the course backend; it never receives the OpenAI API key.
- **API scope:** this course focuses on the managed **Agents API** (`client.beta.agents` in the current JavaScript SDK). The Agents SDK, Responses API, and ChatKit are related products, but their APIs and orchestration patterns should not be presented as interchangeable.

The Agents API is evolving. Before recording a lesson, verify model access, permissions, request fields, and examples against the [Agents API overview](https://developers.openai.com/api/docs/guides/agents-api/overview) and [quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart). Use a model available to the student's project; do not rely on one model name throughout the course.

**Runtime boundaries:** Labs 33 and 45 include Codex integration exercises for `AGENTS.md` and lifecycle hooks; Lab 46 is an optional WebMCP browser integration. Verify instruction loading in the selected runtime rather than assuming every Codex configuration applies to an Agents API session. SDD in Lab 51 is a development methodology, not an API feature. The managed agent harness in Lab 31 and the evaluation harness in Labs 52–53 serve different purposes.

## Capability coverage

The capstone's connected and hosted profiles, Lab 25 reinforcement, and runtime verification scripts are described in [CAPSTONE_INTEGRATIONS.md](CAPSTONE_INTEGRATIONS.md). External hosting, native Codex hook dispatch, and WebMCP invocation require actual target/runtime evidence; a local fixture result does not mark these checks passed.

Status refers to lessons in this repository, not product availability. Each lesson has an implemented exercise; verify the selected live runtime and recording evidence separately.

| Capability | Lessons | Runtime or product | Status |
| --- | --- | --- | --- |
| Rules / `AGENTS.md` | 33; applied again in 38 | Codex project discovery exercise and explicit application-loaded API guidance | 33 and 38 implemented |
| Subagents | 39–43 | Agents API multi-agent orchestration | Live 39–40; replay/manual/imported exercises 41–43 |
| MCP | 22–24; 36 | Agents API service-origin and environment-origin MCP | 22–24 and 36 implemented |
| WebMCP | 46 | Website tools in a compatible ChatGPT Work / Codex browser; optional adjacent integration | Registration and local fallback implemented; native invocation requires compatible browser |
| Skills | 25; 34; applied again in 38 | Agents API sandbox skills and capability directories | Plugin-bundled skill implemented in 25; standalone skill implemented in 34 |
| Hooks | 45; compared with webhooks in 44 | Codex lifecycle hooks; application callbacks explained separately | Script and project/plugin scaffolds implemented; native dispatch requires runtime verification |
| Plugins | 25; reinforced in 34 and 45 | Agents API environment plugins; Codex hook packaging is runtime-specific | Skill + MCP packaging and Lab 45 hook scaffolds implemented; native hook verification requires runtime setup |
| Harnesses | 31; 52–53 | Managed Agents API execution harness; separate course-owned evaluation harness | 31 and course policy evaluation harnesses 52–53 implemented |
| SDD — Specification-Driven Design | 51–53; 56 | Course development workflow, independent of API choice | Specification, dataset, regression and integrated workspace implemented |

## Stage 1 — First run and conversation (Labs 01–05)

**Checkpoint:** a two-turn tutor chat that shows session state and handles a failed run. Reference: [sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions) and [events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events).

| Lab | What students learn | What they build or verify |
| --- | --- | --- |
| **01. Create your first agent** *(implemented)* | Configure a model and instructions; create a session with `environment.type: "none"`; stream the first turn. | The current programming-tutor app shows a streamed Markdown answer and completion state. |
| **02. Continue and customize** *(implemented)* | Send a follow-up to the **same** session; start a **new** session to compare different instructions. | A conversation view and a side-by-side explanation of why instructions require a new session. |
| **03. Inspect the lifecycle** *(implemented)* | Distinguish session, turn, event, and saved item IDs; recognize idle, completed, failed, and cancelled states. | A small event inspector beside the chat. |
| **04. Handle interrupted work** *(implemented)* | Show API errors, turn failures, cancellation, and a stream that disconnects before completion. | An error/retry panel that retrieves saved state before offering another run. |
| **05. Manage sessions** *(implemented)* | List, retrieve, and delete sessions; explain what should be retained. | A session history page with a working delete action. |

## Stage 2 — Reusable configuration and TypeScript (Labs 06–10)

**Checkpoint:** a typed tutor with reusable agent presets. Reference: [configuring agents](https://developers.openai.com/api/docs/guides/agents-api/configuration).

| Lab | What students learn | What they build or verify |
| --- | --- | --- |
| **06. Move the app to TypeScript** *(implemented)* | Type React state, backend requests, streamed events, and validation boundaries. | The same Lab 05 app builds with TypeScript checks. |
| **07. Save and reuse an agent** *(implemented)* | Create a saved agent and use its `agent_id` in new sessions. | A named tutor preset used by two separate sessions. |
| **08. Override one session** *(implemented)* | Apply a session-specific override without changing the saved agent. | Two sessions with different behavior from one saved preset. |
| **09. Compare models and reasoning settings** *(implemented)* | Change supported model and reasoning settings for later turns; measure quality and latency. | A comparison worksheet populated by real runs. |
| **10. Design an output contract** *(implemented)* | Give precise instructions and validate the returned data in application code. | A study-plan form that rejects malformed results and explains the repair path. |

## Stage 3 — Streaming and the React experience (Labs 11–15)

**Checkpoint:** a resilient chat interface that displays exactly what happened during a turn. Reference: [events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events) and [session management](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage).

| Lab | What students learn | What they build or verify |
| --- | --- | --- |
| **11. Render text events correctly** *(implemented)* | Combine output text deltas and replace partial buffers with completed content parts. | A response panel that handles multiple output parts without duplicated text. |
| **12. Build a turn timeline** *(implemented)* | Group status and item events by turn and display their order. | A visual timeline of one agent run. |
| **13. Recover after a disconnect** *(implemented)* | Reconnect, retrieve the session, and read saved items without blindly repeating input. | A refresh-safe answer recovery flow. |
| **14. Cancel and steer a turn** *(implemented)* | Distinguish cancellation from a message sent while work is active. | Cancel and steer controls with visible outcome states. |
| **15. Show usage and duration** *(implemented)* | Read best-effort usage and timing, treating missing usage as unknown. | A run summary with tokens, duration, and error details. |

## Stage 4 — Function tools and human control (Labs 16–20)

**Checkpoint:** a task assistant that calls server functions safely. Reference: [function tools](https://developers.openai.com/api/docs/guides/agents-api/tools/functions).

| Lab | What students learn | What they build or verify |
| --- | --- | --- |
| **16. Declare a function tool** *(implemented)* | Define a tool name, description, and input schema. | An agent that requests a course-calendar lookup. |
| **17. Complete a required action** *(implemented)* | Detect `agent.session.requires_action`, execute the function on the server, and return its result. | A full request → tool call → result → answer trace. |
| **18. Validate tool inputs** *(implemented)* | Reject invalid arguments and handle timeouts and exceptions. | A tool test page with both valid and failing cases. |
| **19. Connect a read-only service** *(implemented)* | Wrap a real external API in a narrow, typed function. | An agent answer grounded in live service data. |
| **20. Approve a write action** *(implemented)* | Pause before a consequential operation and record the user's decision. | An approval screen for a simulated calendar change. |

## Stage 5 — Search, MCP, plugins, and credentials (Labs 21–25)

**Checkpoint:** a documentation assistant that can cite sources and use a controlled MCP tool set. References: [web search](https://developers.openai.com/api/docs/guides/agents-api/tools/web-search), [MCP connections](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp), [plugins](https://developers.openai.com/api/docs/guides/agents-api/tools/plugins), and [vaults](https://developers.openai.com/api/docs/guides/agents-api/tools/vaults).

| Lab | What students learn | What they build or verify |
| --- | --- | --- |
| **21. Add web search** *(implemented)* | Give the agent current information and inspect its citations. | A sourced answer with links students can open. |
| **22. Connect a public MCP server** *(implemented)* | Add an HTTP MCP server and observe tool discovery and calls. | A docs assistant using the OpenAI documentation MCP. |
| **23. Restrict MCP tools** *(implemented)* | Choose connection origin and limit discoverable tools with `allowed_tools`. | An allowlist test showing what the agent can and cannot call. |
| **24. Add private MCP authentication** *(implemented)* | Attach a vault-backed credential where supported; avoid exposing secrets in React. | A private-data lookup with credential rotation notes. |
| **25. Package a reusable plugin** *(implemented)* | Bundle a skill and MCP configuration for reuse. | A small, documented course plugin used in a new session. |

**Implemented reinforcement of Lab 25:** the availability comparison distinguishes plugin packaging, skill instructions, and MCP tools. Toggle an explicitly injected unavailable server, inspect retained skill text and failed tool evidence, and export the comparison. Use the existing disabled-network live workbench for the runtime comparison; the injected result is not live evidence. Lab 34 revisits standalone skills; Lab 45 covers hook packaging in a supported Codex runtime.

## Stage 6 — OpenAI-hosted environments and artifacts (Labs 26–30)

**Checkpoint:** an agent creates a report from an input file and the user downloads the artifact. References: [OpenAI-hosted sandboxes](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted) and [files and artifacts](https://developers.openai.com/api/docs/guides/agents-api/environments/files).

| Lab | What students learn | What they build or verify |
| --- | --- | --- |
| **26. Choose an environment** *(implemented)* | Compare `none` with `openai_hosted` for question answering versus file and command work. | A two-task demonstration with the appropriate environment for each. |
| **27. Provide input files** *(implemented)* | Stage a sample CSV or text file in a hosted environment. | A report that uses the provided file and names its source. |
| **28. Configure packages and network** *(implemented)* | Set dependencies and disabled or restricted network access. | A reproducible run with a documented network policy. |
| **29. Create and download artifacts** *(implemented)* | List, identify, and download a generated file. | A downloadable report in the React app. |
| **30. Clean up sandbox resources** *(implemented)* | Understand environment lifecycle, retention, and cleanup. | A cleanup checklist verified against a completed session. |

## Stage 7 — Harness architecture, self-hosted environments, and security (Labs 31–38)

**Implementation status:** [Lab 31](LAB31.md) and [Lab 32](LAB32.md) are implemented with architecture practice, executor lifecycle inspection, explained snippets, and Viva voice. Lab 33 is implemented with project-rule discovery, an explicit API instruction-loading comparison, and a native Codex workspace exercise. Lab 34 is implemented with standalone skill authoring, capability registration and self-hosted read/helper evidence. Lab 35 is implemented with enforced filesystem permissions, eight fixed access probes and captured command evidence. Labs 36–38 are implemented with private environment-origin MCP, bounded saved-state recovery, and a guarded file broker with reviewed diffs and approval. Live Lab 32 evidence requires Docker and correctly scoped credentials.

**Checkpoint:** students explain the execution architecture, then run a file task with project guidance, a reusable skill, and enforced access limits. References: [Agents API architecture](https://developers.openai.com/api/docs/guides/agents-api/architecture), [self-hosted sandboxes](https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted), [sandbox security](https://developers.openai.com/api/docs/guides/agents-api/environments/security), [Codex project instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md), and [Agent Skills](https://developers.openai.com/api/docs/guides/tools-skills).

| Lab | What students learn | What they build or verify |
| --- | --- | --- |
| **31. Understand the agent harness** | Explain the model, managed harness, application server, and sandbox; compare Agents API, Agents SDK, and Responses API ownership of orchestration and state. | An annotated architecture diagram and a session trace identifying which component performs each step. |
| **32. Connect a self-hosted environment** | Supply an executor and observe the environment connection lifecycle. | A file-listing task in a disposable local sandbox. |
| **33. Apply project rules with AGENTS.md** *(implemented)* | Write repository guidance, compare directory scope and precedence in Codex, and verify how the selected runtime loads instructions; distinguish guidance from enforced permissions. | A file task follows repository conventions, with recorded instruction sources and a scoped override comparison. |
| **34. Create and discover standalone skills** *(implemented)* | Author `SKILL.md`, add references and scripts, register `environment.capability_directories` in a self-hosted Agents API sandbox, and compare standalone skills with plugin-bundled skills from Lab 25. | A reusable report skill is discovered and read for a relevant task; an unrelated task checks unnecessary activation, with tool or file-read evidence. |
| **35. Limit filesystem access** *(implemented)* | Provide a task workspace and enforce protected paths with unprivileged ownership permissions and a read-only root filesystem. | Eight fixed probes verify workspace access, protected direct/traversal/symlink denials, denied writes and a readable runtime path, including an explicit broader-access request. |
| **36. Run an environment-origin MCP server** *(implemented)* | Connect a private or local MCP server from the environment. | A tool call that cannot be made from the public network. |
| **37. Recover an environment failure** *(implemented)* | Handle connection loss, setup errors, and resumable session state. | A clear retry or recovery path in the UI. |
| **38. Build a guarded file assistant** *(implemented)* | Reuse verified project guidance and skills while combining enforced filesystem scope, tool limits, and user review. | A proposed file change with a visible diff and approval step; an access-denied case proves enforcement is independent of instructions. |

For Lab 33, the documented Codex instruction-discovery exercise is the baseline. An Agents API variant must show the actual loading path and evidence; do not assume Codex directory precedence is automatically provided by the API.

## Stage 8 — Multi-agent work (Labs 39–43)

**Implementation status:** Labs 39–43 are implemented with bounded delegation contracts, root/child attribution, child report verification, observed overlap and explicit incomplete-result cases. Labs 41–43 now provide progress replay, a manual writer/reviewer workflow and matched evidence comparison. Live model evidence requires configured credentials.

**Checkpoint:** a lead agent delegates two independent tasks and combines their results. Reference: [multi-agent](https://developers.openai.com/api/docs/guides/agents-api/multi-agent).

| Lab | What students learn | What they build or verify |
| --- | --- | --- |
| **39. Enable subagents** *(implemented)* | Turn on multi-agent orchestration, identify root versus subagent work, and define a delegation contract: task, permitted tools, expected output, and completion criteria. | A root agent delegates a bounded research task and checks its returned output against the contract. |
| **40. Run independent tasks in parallel** *(implemented)* | Delegate separate questions, bound concurrency, wait for both results, and decide how to handle one failed child. | A two-source comparison plus a failed-child case with a bounded retry or an explicitly incomplete result. |
| **41. Display subagent progress** | Interpret subagent events without ending the UI on a child's completion or failure; distinguish child outcomes from the root outcome. | A progress panel showing each child's status and the root's recovery decision. |
| **42. Coordinate reviewer and writer** | Assign distinct outputs, define review acceptance criteria, avoid shared-file conflicts, and return revisions to the writer. | A draft, a review report, and a revised draft with resolved findings. |
| **43. Compare single and multi-agent runs** | Measure quality, duration, and token usage on the same task, including coordination cost and failure recovery. | A short evidence-based recommendation on when delegation helps. |

## Stage 9 — Observability, integrations, and operations (Labs 44–50)

**Implementation status:** Labs 44–50 are implemented with local exercises, shared checks, narrated snippets and guides. Live webhook delivery, native Codex hook dispatch and WebMCP calls require the documented setup. Authentication uses explicitly labelled local demo identities.

**Checkpoint:** a deployed-like app can explain a failed run and account for its use; separate integration exercises demonstrate lifecycle automation and optional website tools. References: [observability and usage](https://developers.openai.com/api/docs/guides/agents-api/observability), [tracing](https://developers.openai.com/api/docs/guides/agents-api/tracing), [session webhooks](https://developers.openai.com/api/docs/guides/agents-api/sessions/webhooks), [Codex hooks](https://learn.chatgpt.com/docs/hooks), and [WebMCP site tools](https://learn.chatgpt.com/docs/webmcp).

| Lab | What students learn | What they build or verify |
| --- | --- | --- |
| **44. Receive a webhook** | Verify signatures and handle session outcome notifications; explain why delivery notifications differ from lifecycle hooks. | A server endpoint with a replay-safe event log. |
| **45. Automate with lifecycle hooks** | Distinguish Agents API webhooks, Codex lifecycle hooks, and application callbacks; configure a validation command and inspect matching, trust, timeouts, and failure behavior in Codex. | A supported lifecycle event runs a validation command, records pass and fail results, and demonstrates the difference between project and plugin-bundled hook configuration. |
| **46. Expose React actions through WebMCP** *(optional integration)* | Expose a small website tool set to a compatible browser agent; inspect discovery, page-scoped availability, and invocation; compare browser tools with server MCP. | The agent reads a report and changes a React filter through website tools, with the invocation and resulting UI state visible. |
| **47. Read an agent trace** | Inspect sessions, turns, model generations, and tool spans. | A trace walkthrough for one successful and one failed run. |
| **48. Record usage carefully** | Store available token counts without treating `null` as zero or a final bill. | A usage dashboard with unknown values labeled honestly. |
| **49. Add limits and retries** | Handle rate limits, transient failures, and application spending controls. | A bounded retry policy and a per-user request budget. |
| **50. Protect user sessions** | Add authentication, ownership checks, and server-side session mapping. | A test showing one user cannot access another user's session. |

Lab 45 runs the hook exercise in a supported Codex runtime and does not assume the Agents API accepts Codex hook configuration. An application callback variant must be labeled separately. Lab 46 uses a compatible browser and website registration supported at recording time; it does not configure WebMCP as an Agents API HTTP MCP server. Provide a clearly labeled recorded demonstration when browser support is unavailable.

## Stage 10 — Specification, evaluation, deployment, and capstone (Labs 51–56)

**Implementation status:** Labs 51–56 provide a versioned specification, 24-case dataset, deterministic policy regression/red-team runners, Docker deployment and SQLite research workspace with connected web/MCP and hosted file/native skill profiles. Local deployment, persistence and ownership are verified. External hosting and live model/native integration evidence require their actual selected runtime.

**Checkpoint:** students specify a domain-specific agent app, implement it, and show evidence against its acceptance criteria. References: [Agents API tracing](https://developers.openai.com/api/docs/guides/agents-api/tracing), [production best practices](https://developers.openai.com/api/docs/guides/production-best-practices), and [Agents API overview](https://developers.openai.com/api/docs/guides/agents-api/overview). Labs 52–53 use a course-owned evaluation harness: a test runner that measures behavior, distinct from the managed execution harness in Lab 31. SDD is the course's specification-to-verification workflow and requires no dedicated API endpoint.

| Lab | What students learn | What they build or verify |
| --- | --- | --- |
| **51. Build from a specification with SDD** | Write requirements, constraints, acceptance criteria with stable IDs, and a task plan before implementation; review the specification and verify each criterion after building. | A versioned specification and an implemented feature with every acceptance criterion linked to a test or demonstration, including unresolved gaps. |
| **52. Build an evaluation dataset** | Derive representative prompts, expected behaviors, and failure cases from the specification; include skill selection, delegation quality, and tool boundaries where applicable. | A versioned JSON dataset with at least 20 realistic examples mapped to acceptance criterion IDs. |
| **53. Run regression checks** | Use a small Node evaluation script to compare agent settings on the same examples, inspect failures, and retain criterion-to-result links. | A before-and-after report with reproducible runs and a pass/fail/unknown result for each acceptance criterion. |
| **54. Test safety and tool boundaries** | Probe prompt injection, unauthorized tool use, and unsafe outputs; verify project guidance does not replace enforced boundaries. | A documented red-team report, fixes, and rerun evidence linked to the specification. |
| **55. Deploy the React and Node app** | Set secrets, health checks, logging, and access limits in a hosted environment. | A deployed app with a deployment checklist. |
| **56. Capstone: Research and Report Workspace** | Build the integrated application across one orientation and 24 project videos; apply specification, persistence, sessions, tools, files, skills, delegation, evaluation, and observability. | A deployed research workspace with accounts, resumable investigations, cited findings, downloadable reports, and acceptance evidence. |

Begin the capstone specification in Lab 51 and carry it through Labs 52–56. Students choose capabilities that suit their domain; the capstone does not require every integration. For each selected capability, document its purpose, runtime, permissions, and verification evidence.

## Lab 56 — Integrated application project

**Project: Research and Report Workspace.** A user signs in, creates a workspace, uploads text/Markdown documents or a CSV, asks a research question, watches progress, reviews cited findings, and downloads a generated report. The user can return later and continue the same investigation. The required deliverable is a deployed course application with evidence against its specification; readiness for a particular commercial workload requires validation for that workload.

Use the existing React and Node teaching foundation, then provide a prepared application shell with authentication integration and database migrations. Students implement ownership checks and agent integration rather than spend the recording budget building general UI controls or an authentication provider. The server owns database access, API credentials, upload validation, and consequential writes. Application records store users, workspaces, investigations, approvals, and artifact references; Agents API sessions store agent conversation and work. Teach the mapping and recovery between these two sources of state.

### Project milestones

| Milestone | Videos | Minutes | Completion evidence |
| --- | --- | --- | --- |
| Specification, acceptance criteria, architecture, and data model | 4 | 30 | Reviewed specification, architecture diagram, and schema |
| Authentication, ownership, persistence, and session mapping | 4 | 35 | Two users cannot access each other's workspaces; reload restores an investigation |
| Uploads, agent execution, streaming, and recovery | 4 | 40 | Uploaded input reaches the sandbox; disconnect recovery avoids blindly resending input |
| MCP, skills/plugins, subagents, and report generation | 6 | 60 | Cited findings, delegation evidence, reviewer feedback, and a downloadable report |
| Approvals, evaluation, and failure handling | 4 | 35 | Approved writes are recorded once; replay and failure tests pass; evaluation results are saved |
| Deployment and acceptance demonstration | 2 | 15 | Hosted application and criterion-by-criterion demonstration |
| **Total implementation** | **24** | **215** | **Lab 56 completed** |

### The 24 project implementation lessons

These lessons expand Lab 56 and correspond to videos 102–125 in [COURSE_RECORDING_PLAN.md](COURSE_RECORDING_PLAN.md). Project lesson numbers P01–P24 identify the implementation sequence; they do not change the 56 lab numbers. The integrated workspace has three profiles: uploaded sources, connected official web/MCP research, and hosted research with staged files and native research/report skills. Run scripts/verify-live-capstone.ts for actual provider evidence; baseline fixtures do not establish these integrations.

| Project lesson | Course video | Title | Minutes | What students build or verify |
| --- | --- | --- | --- | --- |
| P01 | 102 | Define the user journey and project scope | 7 | Reviewed scope and sample user journey |
| P02 | 103 | Write acceptance criteria and plan the work | 8 | Specification with AC-01–AC-12 |
| P03 | 104 | Design the application and agent boundaries | 7 | Architecture diagram and runtime ownership |
| P04 | 105 | Design workspace records and database migrations | 8 | Schema and runnable migration checkpoint |
| P05 | 106 | Connect authentication and create the first workspace | 8 | Signed-in workspace creation |
| P06 | 107 | Enforce ownership on server routes | 9 | Two-user access rejection, AC-02 |
| P07 | 108 | Persist investigations and restore saved work | 9 | Reload/restart persistence, AC-01 |
| P08 | 109 | Map investigations to Agents API sessions | 9 | Server-owned session mapping, AC-04 |
| P09 | 110 | Validate and stage documents and CSV inputs | 10 | Accepted/rejected uploads, AC-03 |
| P10 | 111 | Create and continue a research session | 10 | Same-session follow-up, AC-04 |
| P11 | 112 | Render progress and support steering and cancellation | 10 | Visible root outcomes, AC-05 |
| P12 | 113 | Recover saved work after a disconnect | 10 | Recovery without duplicate submitted input, AC-04 |
| P13 | 114 | Connect restricted research sources and authenticated MCP | 10 | Allowlist and authenticated local fixture evidence |
| P14 | 115 | Add web research and verify citations | 10 | Source-to-claim check, AC-06 |
| P15 | 116 | Package research and report skills in a plugin | 10 | Skill discovery and instruction-read evidence, AC-07 |
| P16 | 117 | Delegate research and analysis to bounded subagents | 10 | Delegation contracts and progress, AC-05/AC-07 |
| P17 | 118 | Review findings and reconcile specialist outputs | 10 | Reviewer findings and revision, AC-06/AC-07 |
| P18 | 119 | Generate, identify, and download the report | 10 | Markdown report and owner-scoped download, AC-08 |
| P19 | 120 | Approve and deduplicate a saved finding | 9 | Authorized approve/reject and one persisted write, AC-09 |
| P20 | 121 | Receive and deduplicate webhook notifications | 8 | Replay-safe records, AC-10 |
| P21 | 122 | Handle failed children and reconcile interrupted operations | 9 | Bounded recovery and explicit unknown outcomes, AC-05/AC-10 |
| P22 | 123 | Evaluate the application against its specification | 9 | Versioned regression report, AC-11 |
| P23 | 124 | Deploy and verify the application configuration | 8 | Hosted smoke check and cleanup plan, AC-12 |
| P24 | 125 | Demonstrate acceptance criteria and package the submission | 7 | AC-01–AC-12 evidence and student handoff |
| **Total** | **102–125** | **24 project lessons** | **215** | **Completed Research and Report Workspace** |

### Capability use in the project

| Capability | Role and evidence |
| --- | --- |
| Sessions, saved configuration, streaming, and steering | Persistent investigations, reusable researcher settings, progress UI, and cancellation/steering demonstrations |
| Function tools, validation, and human approval | Read workspace records and propose a saved finding; authorize, validate, and deduplicate the approved server-side write |
| MCP, web search, and credentials | Retrieve research sources with a restricted tool set; use a local/private source fixture to exercise authenticated access without requiring a paid third-party account |
| Skills and plugins | Package research and report guidance with MCP configuration; record discovery, relevant instruction reads, and actual tool use |
| Sandbox files, packages, network policy, and artifacts | Analyze staged documents/CSV and generate a downloadable Markdown report and optional CSV summary; document cleanup |
| Subagents | Delegate independent research/analysis, then review and combine findings; show one failed-child recovery |
| Webhooks, traces, usage, and limits | Deduplicate outcome notifications, inspect a failed run, label unknown usage, and bound retries and requests |
| SDD and evaluation | Carry stable acceptance criterion IDs from the specification to datasets, regression results, and the final demo |
| `AGENTS.md` and Codex hooks | Apply development conventions and run a validation command in a supported Codex environment; keep their evidence separate from application runtime evidence |
| WebMCP | Reuse the optional Lab 46 browser exercise to inspect a report and change a filter; a recorded demonstration is acceptable when live support is unavailable |

Use one sandbox approach for the main project recording, with an OpenAI-hosted baseline and a documented self-hosted adaptation from Labs 32–38. Avoid implementing both infrastructure paths again. The project uses the managed execution harness taught in Lab 31 and a separate evaluation runner from Labs 52–53.

### Project acceptance criteria

| ID | Criterion | Required evidence |
| --- | --- | --- |
| AC-01 | A user can create a workspace and reopen its saved investigations. | Persistence test across browser reload and server restart |
| AC-02 | Users cannot read, change, or download another user's workspace data through the server. | Two-user authorization tests for records, sessions, approvals, and artifacts |
| AC-03 | Supported uploads are validated and staged for analysis; invalid or oversized files are rejected. | Valid document/CSV run and rejected upload cases |
| AC-04 | A follow-up uses the mapped session; disconnect recovery reads saved state before resubmission. | Same-session trace and recovery case with no duplicate submitted task |
| AC-05 | The UI shows root and child progress, plus cancellation and failure outcomes correctly. | Successful run, cancelled run, and failed-child demonstration |
| AC-06 | Research findings cite retrieved sources and expose unsupported claims for review. | Source-to-claim review and a missing-evidence case |
| AC-07 | Relevant skill use and bounded delegation can be verified from run evidence. | Skill discovery/read evidence, task contracts, and reviewer findings |
| AC-08 | A report can be identified and downloaded by its authorized owner. | Artifact metadata, download, and cross-user rejection tests |
| AC-09 | A proposed write executes only after an authorized approval and is recorded at most once. | Approve/reject tests and repeated-request test with one persisted write |
| AC-10 | Duplicate webhooks and failed operations do not duplicate application records; retries are bounded. | Replay, timeout, and recovery cases with explicit unknown outcomes where reconciliation is needed |
| AC-11 | Evaluation cases trace to requirements and produce reproducible pass/fail/unknown results. | Versioned dataset, run settings, and regression report |
| AC-12 | The deployed application passes a smoke check and documents secrets, limits, retention, and cleanup. | Deployment checklist and completed acceptance walkthrough |

Final submissions include the repository, setup instructions, sample inputs, reviewed specification, architecture diagram, evaluation report, and a short demonstration. The demonstration must show an approved write, rejected access, and recovery from an interruption as well as a successful report.

### Student reproducibility and recording checkpoints

- Provide runnable starting and completed checkpoints for each project milestone, plus migrations and deterministic sample data.
- Include `.env.example` with variable names and setup instructions; keep credentials outside downloadable course materials.
- Use a small local source service for authenticated MCP exercises and clearly label fixtures, recorded runs, and live integrations.
- Supply an offline event replay for the progress UI and clearly state which checks still require live Agents API access.
- Record the dependency versions, API documentation verification date, and expected access requirements before recording; maintain an errata/update log.
- Use downloaded reports and saved traces as evidence so provisioning waits and long runs can be edited without hiding the outcome.

## Recording checklist for every lab

1. State the learning objective and prerequisite lab.
2. Show the exact file and API call students will change.
3. Run a successful case and one meaningful failure case.
4. Inspect the session, event, tool call, artifact, or trace that proves the feature worked.
5. Give a short student challenge and an observable completion criterion.
6. Name the runtime and distinguish live verification, recorded evidence, and mock behavior. For specification-driven work, link the evidence to acceptance criterion IDs.

Some advanced labs require additional permissions, infrastructure, or API access. Provide a mock or a read-only variant where students cannot use the live resource, and label that variant clearly.

