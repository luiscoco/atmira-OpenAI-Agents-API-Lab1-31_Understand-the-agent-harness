# Lab 23 — Restrict MCP tools

In Lab 22 the agent could call every tool that the documentation server offered. Lab 23 uses two fields on the same `mcp` tool to limit what the agent can reach:

- **`connection_origin`** decides where the MCP connection starts. `"service"` (the default) starts it on OpenAI's network. `"environment"` starts it inside the session's environment.
- **`allowed_tools`** decides which of the server's tools the agent can **discover and call**. If you leave it out, every tool is allowed.

Then you test the list with tasks. You do not ask the model. Five probe questions each need one tool. Every probe runs in its own session with the same declaration, and a matrix shows what the agent could and could not call.

The app handles everything around the two fields:

- it builds the declaration from plain settings, and sends `connection_origin` even when it is the default,
- it checks every allowed name against the server's `tools/list`, because the API silently accepts a name that matches nothing,
- it refuses an `environment` origin in a session that has no environment,
- it shows which tools are allowed, which are hidden, and which names match nothing,
- it runs the probes in parallel and cancels any turn that calls a tool outside the list,
- and it judges each probe from the `mcp_call` items, not from what the model says.

The allowlist inspector (twelve recorded runs) and the 27-case test page need no API key.

## Learning goals

1. Choose a `connection_origin`: `"service"` for a public server; `"environment"` only when the session has an environment that can reach the server (Lab 33).
2. Write `allowed_tools` with exact, case-sensitive names from `tools/list`. Explain the difference between leaving it out, `null`, `[]`, and a list.
3. Check the names before sending. The API accepts `[]`, unknown names, and wrong-case names without an error. In each case the agent simply gets no server tools.
4. Explain what "hidden" means. A hidden tool is never discovered, so it never appears in the stream. The MCP resource helpers stay available.
5. Prove an allowlist with probes. An allowed tool that is called means *can*. A hidden tool that is not called means *cannot*. Anything else proves nothing.
6. Tell restricting tools apart from restricting topics. A hidden tool can often be replaced by an allowed one. A list that is too narrow can also lower answer quality.

## Run the lab

Run `npm ci`, put `OPENAI_API_KEY` in a private `.env` file, and start the app with `npm run dev`. Open **Restrict MCP tools** in the sidebar (`#lab23`), under **Search, MCP & plugins**.

**Origin and allowlist.** Pick a policy or build your own:

- **Find and quote a page** (the default): search and fetch.
- **Endpoints only**: the API reference tools.
- **Search only**: too narrow.
- **Everything**: `allowed_tools` left out.
- **Nothing**: `[]`.
- **A typo**, **Wrong case**, and **Environment origin**.

Tick tools in the picker, or type any name with **Add name**. The right-hand panel shows the exact `sessions.create` body and the findings. The first time you open the lab, it fetches today's `tools/list` from the server (once, quietly; **discover again** repeats it). If the server cannot be reached, the picker uses the list recorded on 2026-09-28, and the server still checks the names before every run. **Send anyway** skips the allowlist and origin checks so you can see what the API does with a bad list. The label and URL checks from Lab 22 always apply.

**What the agent can see.** Four columns: the tools it can discover and call, the hidden tools, the names that match nothing, and the three resource helpers that `allowed_tools` does not cover.

**Allowlist inspector (no API key).** Twelve recorded runs. Eleven are shortened from live runs on 2026-09-28, and one is an illustration. The calls, answers, errors, and session IDs are real. The tool outputs are short stand-ins. Change the allowlist beside a sample, and its recorded calls are judged again, so you can see which list would have turned a call into a breach.

| Sample | What it shows |
| --- | --- |
| Allowed: find and quote a page | search → fetch → fetch; the right page is quoted |
| Hidden: asked for `list_api_endpoints` | No call at all; the answer names the two tools it has |
| Endpoints only, asked for a page | No call; the agent says it cannot read guide pages |
| Too narrow: search only | The list held, but without fetch the agent returned the Responses API guide |
| Asked "which tools do you have?" | With search allowed, the model says it has no tools. Self-report is not evidence |
| `allowed_tools: []` | No server tools; the resource helpers remain |
| A name that matches nothing | `search_docs` accepted silently; only failing resource helpers were called |
| The right name, the wrong case | `Search_OpenAI_Docs` accepted silently; no server tools |
| `connection_origin: environment`, no environment | `400 mcp tool connection_origin=environment requires a session environment` |
| A spec that is only a `$ref` | The right tool was called, but the answer is a placeholder object: the spec did not include the schema |
| The same, after the instruction fix | The agent says the schema is a `$ref`, then searches and fetches the sessions guide: correct, but not complete |
| A call outside the allowlist *(illustration)* | What the app does if the API ever lets one through |

**Test page (no API key).** 27 cases run the real functions in the browser or on the server (`POST /api/lab23/test`):

| Group | Cases |
| --- | --- |
| Declare the origin and the allowlist | search and fetch, left out, `[]`, a typo, the wrong case, a duplicate, before discovery, a destructive tool, environment with and without an environment, the origin is always sent, Lab 22's URL rules |
| What the agent can see | two allowed and three hidden, no allowlist, a name that matches nothing, a resource helper, reading the tool back |
| Judge the probes | can, cannot, cannot with a substitute, allowed but unused, breach, refused request, a test that held, a test with gaps, a test where nothing was callable, a test with nothing hidden |

**Live allowlist test.** Choose probes (each needs one tool) and optionally your own question, then click **Run the allowlist test**. Each probe card shows its expected outcome. The server checks the names against `tools/list`, then starts one session per probe, in parallel. Each card fills in with its session, its calls, and its answer. The result has a verdict, a probe × tool matrix (● allowed and called, ○ allowed and not called, — hidden, ✕ hidden but called), and, for each probe, its judgement, answer, call log, and saved items. **Test history** compares allowlists side by side.

Open **View code** for six snippets and explanations. **Viva voice · Read aloud** reads one explanation aloud, and **Viva voice · Read all six** reads them all in order. Both use browser speech synthesis and do not call an audio API.

## How it was built — step by step

### 1. Choose the origin

```ts
// src/lab23Allow.ts
export function checkOrigin(origin: Origin, environment: EnvironmentType = 'none'): Finding[] {
  if (origin === 'service') return [{ level: 'ok', text: 'connection_origin: "service". … It needs no environment.' }];
  if (environment === 'none') return [{ level: 'error', text: '… The API answers 400 “requires a session environment”. …' }];
  return [{ level: 'ok', text: 'connection_origin: "environment". … the executor must be connected …' }];
}
```

The `openai` 7.23.0 types describe `connection_origin` as *"Omitted or `service` uses the Managed Agents service network; `environment` uses the session's selected environment."* This lab's sessions use `environment: { type: 'none' }`, and a live `environment` request failed before a session existed, with `required` either true or false. The app writes `"service"` explicitly, so the request itself shows where the connection starts.

### 2. Write the allowlist, and check it against `tools/list`

```ts
// src/lab23Allow.ts
export function checkAllowlist(raw: string[], discovered: DiscoveredTool[] | null): AllowCheck
// trims, drops blanks and copies; [] → warn; no discovery → warn (names unchecked)
// wrong case → error with “did you mean”; not in tools/list → error
// destructive or not readOnlyHint → warn
export function buildRestrictedTool(settings, discovered): { tool: RestrictedTool | null; findings; check }
```

The SDK says *"The MCP tools the agent may call. All server tools are allowed when omitted."* It does not say what happens with a list that matches nothing. The live runs showed that `[]`, `["search_docs"]`, and `["Search_OpenAI_Docs"]` were all **accepted**. The turn completed with no server tools, and nothing in the stream said why. So `runLab23` first calls `toolsFor(url)`, which is Lab 22's `discover` handshake with a five-minute cache. Then it rebuilds the declaration and answers **400** with the findings if any of them is an error, unless **Send anyway** is on. `uncheckedTool` builds the Send anyway version, and it still refuses an unsafe label or URL.

### 3. See what is hidden

```ts
export function visibleTools(discovered, allowed): { allowed; hidden; unmatched }
export const isAllowedCall = (call, allowed) => call.kind !== 'tool' || allowed === null || allowed.includes(call.name);
```

A hidden tool is never discovered, so no `mcp_call` ever appears for it. It is not refused at call time. The resource helpers `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource` stayed available under `[]` and under a list that matched nothing. `isAllowedCall` does not count them as breaches (Lab 22 already marks them `kind: 'helper'`).

### 4. Probe each tool in its own session

```ts
// server/lab23.ts
const runs = await Promise.all(jobs.map((job) => runProbe(api, response, agent, tool, job, streams)));
// in runProbe, for every mcp_call item:
if (!isAllowedCall(call, allowed) && !run.stopped && run.sessionId) {
  run.stopped = true;
  await api.beta.agents.sessions.events.create(run.sessionId, { events: [{ type: 'agent.session.input.cancel' }] });
}
```

The five probes are search the docs (`search_openai_docs`), read one page (`fetch_openai_doc`), browse the index (`list_openai_docs`), list endpoints (`list_api_endpoints`), and read an OpenAPI spec (`get_openapi_spec`). Every probe uses the same instructions (`allowInstructions`), so only the allowlist changes. The API enforces the list. The server checks it anyway, and would cancel a turn that stepped outside it. The stream sends `declared`, `probe`, `call`, `text`, `done`, and `summary` lines as NDJSON, and the page fills one card per probe.

### 5. Judge the evidence

```ts
export function judgeProbe(run: ProbeRun, allowed: string[] | null): ProbeJudgement
// breach  → a hidden tool was called          failed → the turn did not complete
// used    → allowed and called (can)          unused → allowed, not called (proves nothing)
// blocked → hidden and not called (cannot)    open   → your own question, judged only on the list
export function buildMatrix(runs, allowed, toolNames): MatrixRow[]
export function summarizeTest(runs, allowed): AllowVerdict   // held · gaps · open · breach · failed
```

The judgement uses only the `mcp_call` items. It also records whether the answer *says* a tool is missing (`admitted`) and which other tools the agent used instead (`substitutes`). Those help the reader but are not evidence. Two results get their own verdicts instead of *Allowlist held*. If no probe could call anything, the verdict is *Held, but nothing was callable*, because a typo gives exactly that result. If no probe asked for a hidden tool, the verdict is *Nothing hidden was probed*, because that test shows what the agent can do, not what the list keeps out.

## What the live runs showed (2026-09-28)

- **Find and quote a page** (`search_openai_docs`, `fetch_openai_doc`): **Allowlist held**, 2 can · 3 cannot, 44 s for five parallel probes. Search and fetch were each called. `list_openai_docs`, `list_api_endpoints`, and `get_openapi_spec` never appeared. The agent still answered the endpoint and spec questions correctly, using search and fetch (the spec probe made 11 calls, 5 of them failed fetches). **Hiding a tool restricts tools, not topics.**
- **Everything** (left out): 5 can, 20 s. Each probe called its own tool. With nothing hidden, this now gets *Nothing hidden was probed*, not *Allowlist held*.
- **Endpoints only**: 2 can · 3 cannot. For "browse the index" the agent listed API endpoints instead of guide pages.
- **Search only**: the list held, but the agent returned the Responses API guide, because it could not open a page to check it.
- **Asking the model**: with only `search_openai_docs` allowed, "list every tool you can call" got *"No `openai_docs` tools are available"* twice. With `null`, it listed all five (as `mcp__openai_docs__…`).
- **`[]`, `["search_docs"]`, `["Search_OpenAI_Docs"]`**: all accepted with no error, and none left any server tools. With `search_docs`, the agent tried `list_mcp_resource_templates` and `list_mcp_resources`, and both failed with `-32601 Unknown method`. Sent again through **Send anyway**, the typo gave *Held, but nothing was callable*.
- **`connection_origin: "environment"`** with `environment: { type: "none" }`: `400 mcp tool connection_origin=environment requires a session environment`, in about 0.5 s, with `required` true or false.

- **A spec that is only a `$ref`**: *Use get_openapi_spec to show the request body POST /v1/agents/sessions* called the right tool, but the returned spec gave the request body as `$ref: CreateAgentSessionParams` and had no `components` section. The agent printed a placeholder object and called the body optional. Both were wrong: the SDK requires `environment`, and the full body is `environment`, `agent` or `agent_id`, `input`, `metadata`, `stream`, `vault_ids`. The instructions now say to report a missing reference, look it up with another tool, and never show placeholder fields. In two runs after the change, the agent said the schema was a `$ref` and searched. One run showed the documented request from the sessions guide; the other said it could not find the schema. An extra hint to fetch the API reference page made the agent guess a reference URL, which the docs server could not fetch, so that hint was removed. No tool on this server returns the full schema, so the best grounded answer is correct but incomplete, and says so.

Models and servers change, so your calls and timings will differ.

## Rules the page follows

```text
connection_origin                        → always sent; "service" unless the session has an environment
"environment" + environment none         → refused (the API answers 400)
allowed_tools left out                   → warning: every tool, including tools the server adds later
allowed_tools: []                        → warning: no server tools; leave the server out instead
name not in tools/list                   → refused (the API would accept it and allow nothing)
name in the wrong case                   → refused, with “did you mean”
duplicate or blank name                  → removed
destructive / not readOnlyHint           → warning
names checked against                    → tools/list, fetched by the server (cached 5 min) before every run;
                                           the page also discovers once when the lab is first opened
Send anyway                              → skips the allowlist and origin checks, never the URL checks
probe                                    → one new session per probe, same declaration, in parallel (max 6)
mcp_call outside the allowlist           → breach; the server cancels the turn
list_mcp_resources and friends           → API helpers, not covered by allowed_tools, not a breach
allowed + called / hidden + not called   → can / cannot
allowed + not called, or failed          → proves nothing: run it again
no probe for a hidden tool               → "Nothing hidden was probed", not "held"
a $ref or a missing piece in a result    → say so, look it up with another tool, no placeholder fields
the model's own list of its tools        → not evidence
```

## Code map

| File | Role |
| --- | --- |
| `src/lab23Allow.ts` | `AllowSettings`, `RestrictedTool`, `checkOrigin`, `checkAllowlist`, `buildRestrictedTool`, `uncheckedTool`, `allowedOf`, `visibleTools`, `isAllowedCall`, `probes`, `judgeProbe`, `buildMatrix`, `summarizeTest`, `parseProbeRun`, `parseRestrictedTool`, and `allowInstructions`. |
| `src/lab23Scenarios.ts` | The twelve recorded runs for the allowlist inspector. |
| `src/lab23Tests.ts` | The 27 cases, `runAllowTest`, and `runAllowSuite`. |
| `server/lab23.ts` | `toolsFor` (cached discovery), `discoverLab23`, `runLab23` (check, then one session per probe in parallel, with the breach guard), and `testLab23`. |
| `server/index.ts` | Routes `POST /api/lab23/discover`, `POST /api/lab23/run`, `POST /api/lab23/test`, and `GET /api/lab23/items` (Lab 22's item reader). |
| `src/Lab23.tsx` | The declaration panel, tool picker, visibility view, inspector, test page, live allowlist test, matrix, result, test history, code snippets, and Viva voice. |
| `src/Lab22.tsx` | Now exports `CallLog`, `Findings`, `codeTokens`, and `readLines`, which Lab 23 reuses. |
| `src/App.tsx`, `src/styles.css`, `tsconfig.lab6.json` | The sidebar entry, Lab 23 styles, and strict type checking for the new modules. |

## Student challenge

1. Run the test page on the server and show **27/27 passed**.
2. In the inspector, open *Allowed: find and quote a page* and untick `fetch_openai_doc`. Explain the new outcome and why the recorded fetch calls are now marked ✕.
3. Live, run the allowlist test with *Find and quote a page*. Show a matrix with two *Can call* and three *Cannot call* rows. Then read the *Read an OpenAPI spec* answer and explain how the agent answered without `get_openapi_spec`.
4. Turn on **Send anyway**, choose *A typo*, and run the *Search the docs* probe. Explain in one sentence why the API's silence is the reason the app checks names.
5. Choose *Environment origin* and say when you would use it (hint: Lab 33).

See [OpenAI Docs: MCP connections](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp).
