# Lab 36 - Run an environment-origin MCP server

Connect an MCP HTTP server from the executor network namespace and verify a fresh private tool result. The page includes the exact transport configuration, four synthetic evidence cases, a live origin comparison, shared tests, evidence export and six narrated snippets.

## Run the exercise

Start Docker Desktop in Linux container mode, then build:

```powershell
docker build -t agents-lab36-executor:local sandbox/lab36
```

Set `LAB36_ENABLE_LOCAL_EXECUTOR=true`, `OPENAI_API_KEY` and a separate restricted `OPENAI_EXECUTOR_API_KEY` in `.env`. The executor key must match the session owner/project and have environment-connection permission only. Restart the Node server and recheck setup. Pin `CODEX_VERSION` to a verified exact CLI version when recording.

Choose environment origin for the successful run, then service origin for the expected private-endpoint failure. The MCP server binds to `127.0.0.1:8765` **inside the container**. No port, host directory or Docker socket is published or mounted. It exposes only the synthetic `get_inventory({})` tool. `required: true` makes startup failure visible. The local data has no secrets; authentication is outside this fixture's scope.

Each live run creates an API session, launches the unprivileged executor, sends input once after connection, and tracks container removal and API deletion separately. A two-minute connection wait and five-minute deadline bound the job. Switching labs preserves the server job; reopening resumes polling the saved ID. Retry cleanup before another run if either removal or deletion fails. After abrupt termination inspect `docker ps -a --filter label=agents.course.lab=36` and remove only the exact interrupted container name.

Live outbound networking remains available and the executor can read its restricted key. The loopback MCP service cannot be reached from the public network; a private address alone is not a general authentication system.

## Implementation walkthrough

### 1. Select connection origin

Source: [src/lab36Mcp.ts](src/lab36Mcp.ts).

```text
connection_origin: 'environment'
```

The executor opens the MCP HTTP connection from its own network namespace. Service-origin connections instead originate at OpenAI and cannot reach this container-local loopback endpoint.

### 2. Keep the private server local

Source: [sandbox/lab36/mcp.mjs](sandbox/lab36/mcp.mjs).

```text
server.listen(8765, '127.0.0.1');
```

The private server runs beside the executor and publishes no Docker port. A loopback address on the application server would name a different machine from the executor.

### 3. Allow one read-only tool

Source: [src/lab36Mcp.ts](src/lab36Mcp.ts).

```text
allowed_tools: ['get_inventory'], required: true
```

The session discovers only the inventory tool. Required startup makes a failed initialization visible rather than silently continuing without a grounded tool result.

### 4. Return fresh fixture evidence

Source: [sandbox/lab36/entrypoint.sh](sandbox/lab36/entrypoint.sh).

```text
inventory = { marker: nonce, item: 'course-notebook', quantity: 7 };
```

Each disposable run receives a new marker. The private tool returns the marker with its synthetic records, so a cached answer cannot pass the freshness check.

### 5. Capture completed MCP items

Source: [server/lab36.ts](server/lab36.ts).

```text
if (event.item?.type === 'mcp_call') job.mcpCalls.push(event.item);
```

The lifecycle worker records completed MCP call items separately from shell commands and final text. The checker requires the expected server label, tool, successful status and output fields.

### 6. Compare the wrong origin

Source: [src/Lab36.tsx](src/Lab36.tsx).

```text
privateMcpTool('service'); // expected private-endpoint failure
```

Run the service-origin comparison with the same endpoint. Explain the failure using network location, then distinguish it from authentication and a missing tool. Synthetic cases remain labelled separately from real API evidence.

## Validation and checkpoint

```powershell
npm run test:lab36
npm run build
```

The page and server share 5 rule checks. Integration tests exercise actual local handlers and injected API/provider failures, rather than making live model calls. TypeScript and production build checks cover the application integration. The live API/model paths need configured credentials and have not been exercised in this workspace.

Explain why environment-origin succeeds and service-origin cannot reach this loopback tool. Identify a successful MCP item, fresh marker and both cleanup states. A final answer without a call must fail verification.

The Docker image was built and tested as UID 1000 under read-only/capability/resource controls with networking disabled. Six actual MCP HTTP checks passed, including initialization, tool discovery, inventory result, forbidden tool/argument rejection and browser-origin denial. The entrypoint also started its loopback server before the executor help command and exited cleanly. This proves the local MCP behavior, separately from a model/API run.

Official references (checked 2026-10-05): [tools/mcp](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp), [environments/self-hosted](https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted).
