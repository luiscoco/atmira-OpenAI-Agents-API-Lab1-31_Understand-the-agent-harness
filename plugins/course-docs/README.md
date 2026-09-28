# course-docs plugin

A small plugin for the "OpenAI Agents API with React" course. It bundles:

| File | Purpose |
| --- | --- |
| `.codex-plugin/plugin.json` | Manifest: name, version, description, and where the skills and MCP servers are. |
| `skills/cite-docs/SKILL.md` | A skill: how to answer Agents API questions from the docs, with links. |
| `.mcp.json` | One HTTP MCP server, `openai_docs`, the public OpenAI documentation server. No credentials. |

The skill ends each answer with `Answered with course-docs/cite-docs.` so a run can show that the skill's instructions were followed.

## How it was built — step by step

This is the package built in [Lab 25](../../LAB25.md). Follow that guide for the complete workbench, install handler, readiness deadlines, saved-state fallback, and student verification.

### 1. Declare the package entry points

Create `.codex-plugin/plugin.json` with `name`, `version`, `description`, `skills: "./skills/"`, and `mcpServers: "./.mcp.json"`. Relative paths keep the entry points inside the installed plugin folder.

### 2. Write the skill and connect the tool server

Give `skills/cite-docs/SKILL.md` a discoverable name and description, then define search, fetch, citation, and unavailable-server behavior. `.mcp.json` supplies the server used by those instructions:

```json
{
  "mcpServers": {
    "openai_docs": { "type": "http", "url": "https://developers.openai.com/mcp" }
  }
}
```

**Why:** `openai_docs` is the name used by the skill. HTTP configuration connects the tools; the skill explains when and how to use them. The closing line is an instruction-following check, while calls and returned URLs provide the source evidence.

### 3. Validate and pack the complete folder

Lab 25's `checkPlugin` validates the manifest, skill frontmatter, MCP declarations, paths, and absence of secrets. `packPlugin` prefixes every entry with `course-docs/` and writes a deterministic ZIP. Documentation is packaged too, so editing it changes the archive fingerprint.

### 4. Install before asking the question

Use the shortened session flow below, or store the archive in an environment template. `name`, `description`, and `zipBase64` come from the checked package; `model` and the SDK client are supplied by the server. Wait for readiness and send once because repeated ready events must not create repeated questions. The full Lab 25 handler also covers provisioning failures and timeouts.

### 5. Verify and version the result

Compare installed plugin metadata, capability directory, MCP calls, the skill's closing line, and citations that match tool-returned URLs. Test a baseline without the plugin as well. Bump the manifest version, repack, and update a template after a package change; create a new session to use that update.

## Use it

Lab 25 packs this folder into a ZIP whose top-level folder is `course-docs/`, and installs it in an OpenAI-hosted environment:

```typescript
const session = await client.beta.agents.sessions.create({
  agent: { model },
  environment: {
    type: 'openai_hosted',
    network: { access: 'restricted', allowed_domains: ['developers.openai.com'] },
    plugins: [{
      type: 'inline', name: 'course-docs', description,
      source: { type: 'base64', media_type: 'application/zip', data: zipBase64 },
    }],
  },
});
const stream = await client.beta.agents.sessions.events.stream(session.id);
let sent = false;
for await (const event of stream) {
  if (event.type === 'agent.session.environment.ready' && !sent) {
    sent = true;
    await client.beta.agents.sessions.events.create(session.id, {
      events: [{
        type: 'agent.session.input.message',
        input: [{ role: 'user', content: [{ type: 'input_text', text: question }] }],
      }],
    });
  }
  if (event.type === 'agent.session.turn.completed' && event.turn.subagent_id == null) break;
  if ((event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled')
      && event.turn.subagent_id == null) break;
}
```

Or once in an environment template, which new sessions reference with `environment_template_id`.

## Change it

Bump `version` whenever a file changes, then repack and update the template. Existing sessions keep the plugin they started with; only new sessions pick up the change. Keep secrets out of every file here: an HTTP server that needs a token reads it from an environment variable with `bearer_token_env_var`.
