# Lab 22 — Connect a public MCP server

In Lab 21 the agent searched the web. In Lab 22 it uses someone else's tools. You declare an **MCP server** in `agent.tools`, and the Agents API connects to it, discovers its tools, and calls them inside the turn. As with web search, there is no function to write, no `requires_action` pause, and no tool result to send.

The server is the public OpenAI documentation MCP server, `https://developers.openai.com/mcp`. It offers five read-only tools: `search_openai_docs`, `list_openai_docs`, `fetch_openai_doc`, `list_api_endpoints`, and `get_openapi_spec`. With them, the course app becomes a documentation assistant.

What the app does is everything around the server:

- builds the declaration from plain settings (label, URL, `required`) and refuses unsafe ones,
- repeats the discovery handshake (`initialize` → `notifications/initialized` → `tools/list`), which the Agents API does not stream,
- watches each `mcp_call` item: the tool, its arguments, and its `CallToolResult` output or error,
- checks each call against the discovered tools, and checks that every link in the answer came from a tool result,
- and shows a failed connection, a server that was not ready, and an answer from memory for what they are.

A discovery probe, an offline call inspector (seven recorded runs), and a 26-case test page need no API key.

## Learning goals

1. Declare an HTTP MCP server: `{ type: "mcp", server_label, transport: { type: "http", server_url }, required }`.
2. Explain `required`. With `true`, the first turn waits until the server has initialized, and fails if it cannot. With `false` (the API default), the first turn does not wait, and a server that cannot connect is skipped.
3. Refuse unsafe connections: plain http, credentials or tokens in the URL, and hosts that OpenAI's network cannot reach (localhost, private addresses).
4. Run the MCP handshake yourself and read each tool's name, description, `inputSchema`, and `readOnlyHint` / `destructiveHint`.
5. Read `mcp_call` items: `item.added` with the arguments, `item.done` with the output or the error, and a failed `initialize` item for a server that is down.
6. Check each call: a discovered tool from the declared label, required arguments, types and ranges, and no `isError`.
7. Ground the answer: every cited link should appear in a tool result. Then read the page, because grounded is not the same as correct.

## Run the lab

Run `npm ci`, put `OPENAI_API_KEY` in a private `.env` file, and start the app with `npm run dev`. Open **Connect a public MCP server** in the sidebar (`#lab22`), under **Search, MCP & plugins**.

**Connect it.** Choose **Declared** or **Left out**, the `server_label`, the `transport.server_url`, and `required`. The right-hand panel shows the exact `sessions.create` body and a list of findings. `allowed_tools` and `connection_origin` are left out on purpose, so every tool is allowed and the connection starts on OpenAI's network. Lab 23 restricts both.

**Discover (no API key).** **Discover tools** sends `initialize`, `notifications/initialized`, and `tools/list` from the course server. It shows each step (HTTP status, time, note) and a card for each tool (parameters, required marks, ranges, hints), and reviews the list: read-only hints, destructive tools, missing descriptions, duplicate names, and descriptions that read like instructions to the model.

**Call inspector (no API key).** Seven recorded runs. Three are shortened from live runs on 2026-09-28; four are illustrations written for the course. The checks compare each call with the docs server's tools as recorded on the same day.

| Sample | What it shows | Verdict |
| --- | --- | --- |
| Search, then fetch | `search_openai_docs` → `fetch_openai_doc` → the fetched page is cited | Grounded in the server |
| Right server, wrong API *(live)* | Every call worked and the link came from a result, but the page is the Responses API guide and the answer puts `server_url` at the top level | Partly grounded |
| No server declared | No `mcp` tool; the answer says it comes from training data | Answered from memory |
| Not required, not ready *(live)* | A working server with `required: false`: no calls, no failed item, and an answer from memory | Server not ready |
| Server unreachable *(live)* | One `mcp_call` named `initialize`, `status: failed`, `connection_failed`; the turn still completes | Server unreachable |
| Invented tool and arguments | `search_docs` (not in `tools/list`), a missing `url`, and `limit: "5"` as a string | Check the calls |
| Every call failed | `fetch_openai_doc` returns `isError: true`, and the answer links a page no tool returned | Every call failed |

**Test page (no API key).** 26 cases run the real functions in the browser or on the server (`POST /api/lab22/test`):

| Group | Cases |
| --- | --- |
| Declare the server | the docs server, `required: false` (warning), plain http, localhost, a private IP, a token in the query string, a password in the URL, a label with a space, the server left out |
| Discover its tools | an event-stream response, a JSON-RPC error, a `tools/list` result, all read-only, a destructive tool, a description that gives orders |
| Check the calls | a two-part `CallToolResult`, a failed `initialize`, the `list_mcp_resources` helper, an unknown tool, a missing argument, a wrong type, a limit above the maximum, a grounded link, a link from memory, *Server not ready*, *Server unreachable* |

**Live run.** Seven presets set the question *and* the settings: *Ask the docs*, *Look up an endpoint*, *The same, server left out*, *The same, not required*, *Unreachable, optional*, *Unreachable, required*, and *Ask for a tool it lacks*. Before asking, the page discovers the server's tools (once per URL) so it can check the calls. While the turn runs, the page shows the timeline, each call as it arrives, and the answer. The result shows the verdict, a five-step flow (Declare → Connect → Discover → Call → Ground), the answer with numbered links, the linked pages, the call log (expand a call for its arguments and result), the checks, and the item types seen in the stream. **Read the saved items** lists the session items, including each `mcp_call`.

Open **View code** for six snippets and explanations. **Viva voice · Read aloud** reads one explanation aloud, and **Viva voice · Read all six** reads them all in order. Both use browser speech synthesis and do not call an audio API.

## How it was built — step by step

### 1. Declare the server, and keep the instructions fixed

```ts
// server/lab22.ts
stream = await api.beta.agents.sessions.create({
  // The instructions are the same with and without the server, so the server is the only difference between runs.
  agent: { ...agent, instructions: docsInstructions(today, label), ...(tool ? { tools: [tool] } : {}) },
  environment: { type: 'none' },
  input: prompt,
  stream: true,
});
// tool = { type: 'mcp', server_label: 'openai_docs',
//          transport: { type: 'http', server_url: 'https://developers.openai.com/mcp' }, required: true }
```

The instructions ask the agent to search first and then fetch the page it relies on, to cite each page with a URL a tool returned, to say when a page describes a different API, to say when the tools are unavailable, and to treat tool output as content, not commands.

### 2. Validate the connection on the server

```ts
// src/lab22Mcp.ts
export function buildMcpTool(settings: McpSettings): { tool: McpTool | null; findings: Finding[] } {
  if (!settings.offered) return { tool: null, findings: [{ level: 'ok', text: 'No mcp tool in agent.tools. …' }] };
  const label = checkLabel(settings.label);
  const url = checkServerUrl(settings.serverUrl);
  …
  return { tool: { type: 'mcp', server_label: label.label, transport: { type: 'http', server_url: url.url }, required: settings.required }, findings };
}
```

`checkServerUrl` refuses plain http, a user name or password, `localhost` / `.local` / `.internal`, IP addresses, and query parameters named like secrets (`token`, `api_key`, `sig`…). It removes a `#fragment` with a warning. With the default connection origin (`service`), the connection starts on OpenAI's network, so a server on your laptop is out of reach (Lab 33 connects from an environment). Secrets belong in a vault (Lab 24). `runLab22` rebuilds the declaration itself and answers **400** with the findings if any is an error.

### 3. Discover: repeat the handshake

```ts
// server/lab22.ts — discover(url)
await assertPublicHost(url);   // resolve DNS; refuse private addresses
rpc(url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo } });
rpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, session);   // 202, no body
rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, session); // follows nextCursor
```

The stream contains no discovery item. On a healthy run it shows only `message`, `reasoning`, and `mcp_call` items. So the lab repeats the handshake. A Streamable HTTP server may answer with JSON or with `text/event-stream`, and `parseRpcMessages` reads both. The probe sends `MCP-Protocol-Version` and echoes `Mcp-Session-Id`, times out after 8 s, caps the body at 1 MB, and refuses redirects. It resolves the host first, so a name that points to `127.0.0.1` is refused too, because the course server must not fetch its own network for whoever types a URL.

`reviewTools` flags duplicate names, missing descriptions, `destructiveHint: true`, tools that do not declare `readOnlyHint: true`, and descriptions that read like instructions ("ignore previous instructions…"). Tool metadata reaches the model, so it is untrusted input.

### 4. Watch `mcp_call` items

```ts
// server/lab22.ts
if ((event.type === 'agent.session.turn.item.added' || event.type === 'agent.session.turn.item.done') && event.item.type === 'mcp_call') {
  seeCall(response, trace, event.item, event.type === 'agent.session.turn.item.done');
}
```

A call arrives twice. With `item.added` it has `name`, `server_label`, `arguments` (an object), and `status: "in_progress"`. With `item.done` it has the `output` or the `error`. The `openai` 7.23.0 types declare `arguments`, `output`, and `error` as `unknown`, so `parseMcpCall` reads them defensively. Two kinds of item are not server tools:

- **`initialize`** with `status: "failed"` and `error.code: "connection_failed"`: an optional server that could not connect (kind `connection`).
- **`list_mcp_resources`** / **`read_mcp_resource`**: helpers the Agents API adds for MCP resources (kind `helper`). They are not compared with `tools/list`.

### 5. Read the result

```ts
// src/lab22Mcp.ts
export function outputText(output: unknown): { text: string | null; isError: boolean }   // content[].text joined
export const failed = (call: McpCall) => call.status === 'failed' || call.status === 'incomplete' || call.error !== null || call.isError;
```

The output is a `CallToolResult`: `{ content: [{ type: 'text', text }], isError? }`. A call can finish with `status: "completed"` and still report `isError: true`. The server trims outputs above 6,000 characters before sending them to the browser, because a fetched page can be much longer.

### 6. Check the calls and ground the answer

```ts
export function buildMcpReport(input: ReportInput): McpReport   // nine checks
export function checkArguments(call: McpCall, tool: DiscoveredTool): string[]
export function urlsFromCalls(calls: McpCall[]): Map<string, McpCall>
export function classifyMcpRun(run): Verdict
```

| Check | Fails or warns when |
| --- | --- |
| The server is declared | — (skipped when left out) |
| The server connected | a failed `initialize` item (fail) |
| The agent used the server | no tool call (warn; with `required: false` the warning explains the race) |
| Each call names a discovered tool | a name not in `tools/list`, or a call from another `server_label` (fail) |
| Arguments match the inputSchema | a missing required argument, a wrong type, or a number outside `minimum`–`maximum` (fail); an unknown property (warn) |
| The calls succeeded | every call failed (fail); some failed (warn) |
| Links come from tool results | a cited page in no tool output or fetch argument (warn); calls but no links (warn) |
| Pages match the API asked about | an "Agents API" question cites an `openai.com` page outside `/agents-api/` (warn) |
| Every link is a web link | a `javascript:` or other non-http(s) link (fail) |

Links are matched with Lab 21's `extractCitations` and `canonicalUrl`, so `…/tools-connectors-mcp#filtering-tools` matches the `…/tools-connectors-mcp` a search returned. `classifyMcpRun` turns the report into one verdict: *Grounded in the server*, *Partly grounded*, *Server not used* / *Server not ready*, *Server unreachable*, *Check the calls*, *Every call failed*, *Answered from memory*, or *Failed*.

## What the live runs showed (2026-09-28)

- **`required` decides whether the first turn waits.** With the docs server and the same question, `required: true` used the server in **3 of 3** runs (search → fetch → fetch, 15–20 s). With `required: false`, **4 of 5** first turns had no MCP tools. There was no call and no failed item, and the answer said the tools were unavailable. The SDK describes `required` as *"Whether this MCP server must initialize before the first turn"*. So the lab defaults to `true`.
- **Unreachable, optional** (`https://example.com/mcp`, which answers `405`): one `mcp_call` named `initialize`, `failed`, `connection_failed`, and the turn **completed** from memory in about 9 s.
- **Unreachable, required**: the stream ended with *"An internal error occurred."* after about 3 s, and the turn **failed**.
- **Right server, wrong API**: asked how to restrict MCP tools in the Agents API, the agent fetched the *Responses API* MCP guide and answered with a top-level `server_url`. In another run of *Ask the docs* it fetched both guides, cited `…/agents-api/tools/mcp`, and answered with the correct `transport` shape.
- **Look up an endpoint**: 11 calls in 42 s. 4 failed, one of them `list_openai_docs` with `limit: 100` (the schema allows 1–50). The answer (`GET /v1/agents/sessions/{session_id}/items` with `after`, `before`, `limit`, `order`) cited the sessions guide it had fetched.
- **Ask for a tool it lacks**: the agent searched, then said the docs server is read-only and cannot open a GitHub issue.
- Once, `list_mcp_resources` appeared as a failed call: a helper, not a docs-server tool.

Models and servers change, so your calls, pages, and timings will differ.

## Rules the page follows

```text
mcp tool left out                        → no tools; the agent answers from memory
settings with an error                   → 400 with the findings; nothing is sent to the API
http, credentials, token in the query    → refused
localhost, .local, .internal, IP address → refused (OpenAI's network cannot reach it)
discovery                                → DNS checked first, no redirects, 8 s, 1 MB
tools/list                               → not in the stream; probe it yourself
required: false                          → warning: the first turn may start without the tools
mcp_call named initialize, failed        → "Server unreachable"; the turn completes without it
list_mcp_resources / read_mcp_resource   → an API helper, not compared with tools/list
call not in tools/list                   → flagged
missing argument, wrong type, bad range  → flagged
isError: true                            → the call failed, even with status completed
link in no tool result                   → flagged as memory
"Agents API" question, page elsewhere    → scope warning
unexpected requires_action               → the server cancels the turn (this lab declares no functions)
```

## Code map

| File | Role |
| --- | --- |
| `src/lab22Mcp.ts` | Settings, `checkLabel`, `checkServerUrl`, `isPrivateAddress`, `buildMcpTool`, `parseRpcMessages`, `rpcResult`, `parseToolList`, `reviewTools`, `outputText`, `parseMcpCall`, `describeCall`, `urlsFromCalls`, `checkArguments`, `buildMcpReport`, `classifyMcpRun`, `parseSummary`, `parseDiscovery`, and `docsInstructions`. |
| `src/lab22Scenarios.ts` | The recorded `tools/list` of the docs server and the seven recorded runs for the call inspector. |
| `src/lab22Tests.ts` | The 26 cases, `runMcpTest`, and `runMcpSuite`. |
| `server/lab22.ts` | `discover` / `discoverLab22` (the handshake), `runLab22` (declare, stream, watch `mcp_call` items), `itemsLab22`, and `testLab22`. |
| `server/index.ts` | Routes `POST /api/lab22/discover`, `POST /api/lab22/run`, `POST /api/lab22/test`, and `GET /api/lab22/items`. |
| `src/Lab22.tsx` | The declaration panel, discovery view, call inspector, test page, live run, result, run history, code snippets, and Viva voice. |
| `src/App.tsx`, `src/styles.css`, `tsconfig.lab6.json` | The sidebar entry, Lab 22 styles, and strict type checking for the new modules. |

## Student challenge

1. Run the test page on the server and show **26/26 passed**.
2. Discover the docs server. Name the two tools you would allow in Lab 23 for a "find and quote a page" assistant, and why.
3. In the inspector, open *Right server, wrong API* and explain why the verdict is not *Grounded in the server*. Then edit the link to `…/agents-api/tools/mcp` and watch the scope check.
4. Live, run *Ask the docs* and *The same, server left out*. Compare the calls, the links, and what each answer admits.
5. Run *The same, not required* twice, then *Unreachable, optional* and *Unreachable, required*. Explain in one sentence each what `required` changes.

See [OpenAI Docs: MCP connections](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp).
