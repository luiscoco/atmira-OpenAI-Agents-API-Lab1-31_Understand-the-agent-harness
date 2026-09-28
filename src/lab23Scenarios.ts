// Lab 23: recorded allowlist runs for the inspector. They need no API key. Eleven are shortened from live runs on
// 2026-09-28 against https://developers.openai.com/mcp (marked below); one is an illustration written for the course.
// Tool outputs were not recorded in full: the ones shown are short stand-ins, and the calls, answers, and errors are real.
import type { McpCall } from './lab22Mcp.ts';
import { defaultAllowSettings, type AllowSettings, type ProbeRun } from './lab23Allow.ts';

export type Sample = {
  id: string;
  label: string;
  origin: 'live' | 'illustration';
  settings: AllowSettings;
  run: ProbeRun;
  lesson: string;
};

const pair = defaultAllowSettings;
const endpointsOnly: AllowSettings = { ...defaultAllowSettings, allowed: ['list_api_endpoints', 'get_openapi_spec'] };
const searchOnly: AllowSettings = { ...defaultAllowSettings, allowed: ['search_openai_docs'] };
const call = (id: string, name: string, args: unknown, output: string | null, extra: Partial<McpCall> = {}): McpCall => ({
  id, server: 'openai_docs', name, status: 'completed', turnId: 'turn_sample', arguments: args, output, isError: false, error: null, kind: 'tool', ...extra,
});
const run = (patch: Partial<ProbeRun> & Pick<ProbeRun, 'probeId' | 'prompt' | 'target' | 'answer'>): ProbeRun => ({
  sessionId: null, turnStatus: 'completed', calls: [], durationMs: null, error: null, stopped: false, ...patch,
});
const mcpPage = 'https://developers.openai.com/api/docs/guides/agents-api/tools/mcp';
const responsesPage = 'https://developers.openai.com/api/docs/guides/tools-connectors-mcp';
const hits = (...urls: string[]) => JSON.stringify({ hits: urls.map((url) => ({ url })) });

export const samples: Sample[] = [
  {
    id: 'pair-page', label: 'Allowed: find and quote a page', origin: 'live', settings: pair,
    run: run({
      probeId: 'fetch', target: 'fetch_openai_doc', sessionId: 'sess_01e6b4ae04c3e608006ab9e45ed0c88193afd7fa3d031faa3a', durationMs: 18_835,
      prompt: 'Find and quote the first sentence of the Agents API MCP connections guide.',
      calls: [
        call('exec_p1', 'search_openai_docs', { limit: 5, query: 'Agents API MCP connections guide' }, hits(responsesPage, mcpPage)),
        call('exec_p2', 'fetch_openai_doc', { url: responsesPage }, '# MCP servers\n\n… This guide shows how to use MCP tools with the Responses API. …'),
        call('exec_p3', 'fetch_openai_doc', { url: mcpPage }, '# MCP connections\n\nAn MCP server publishes tool definitions and runs tool calls. …'),
      ],
      answer: `“An MCP server publishes tool definitions and runs tool calls.” — [MCP connections guide](${mcpPage})`,
    }),
    lesson: 'Search and fetch are allowed, so the agent searched, read two pages, and quoted the right one. Both calls are inside the allowlist: this is what the two-tool policy is for.',
  },
  {
    id: 'pair-hidden', label: 'Hidden: asked for list_api_endpoints', origin: 'live', settings: pair,
    run: run({
      probeId: 'endpoints', target: 'list_api_endpoints', sessionId: 'sess_058122de9e7bf16b006ab9e45439648193a547b7416bca8c8d', durationMs: 10_632,
      prompt: 'Use list_api_endpoints to list the Agents API session endpoints. If you cannot, say exactly which tools you have.',
      answer: 'I can’t: `list_api_endpoints` is unavailable.\n\nI have these OpenAI Docs tools:\n- `search_openai_docs`\n- `fetch_openai_doc`',
    }),
    lesson: 'The question names a hidden tool, and the agent could not call it: there is no mcp_call for it at all. A hidden tool is not refused at call time. It was never discovered.',
  },
  {
    id: 'endpoints-only', label: 'Endpoints only, asked for a page', origin: 'live', settings: endpointsOnly,
    run: run({
      probeId: 'fetch', target: 'fetch_openai_doc', sessionId: 'sess_01b99655d56d0b70006ab9e471b5ec8193957c9a3f7f37d964', durationMs: 10_928,
      prompt: 'Find the Agents API MCP connections guide page and quote its first sentence.',
      answer: 'I don’t have a documentation-page search tool available—only OpenAI API OpenAPI-spec tools—so I can’t reliably retrieve or quote that guide’s first sentence.',
    }),
    lesson: 'With only the endpoint tools allowed, the agent cannot read guide pages. It made no call and said why, without inventing a quote.',
  },
  {
    id: 'search-only', label: 'Too narrow: search only', origin: 'live', settings: searchOnly,
    run: run({
      probeId: 'search', target: 'search_openai_docs', sessionId: 'sess_045b0d6074a80765006ab9e4ac03448193971cbae012064f9a', durationMs: 14_572,
      prompt: 'Search the docs for the Agents API MCP connections guide and give me its URL.',
      calls: [call('exec_s1', 'search_openai_docs', { limit: 10, query: 'Agents API MCP connections guide' }, hits(responsesPage, mcpPage))],
      answer: responsesPage,
    }),
    lesson: 'The allowlist held, and the answer is still wrong: the agent returned the Responses API guide. Without fetch_openai_doc it could not open a page to check it. Too narrow a list costs quality, so test the tasks you allow as well as the tools you hide.',
  },
  {
    id: 'self-report', label: 'Asked “which tools do you have?”', origin: 'live', settings: searchOnly,
    run: run({
      probeId: 'custom', target: null, sessionId: 'sess_0ec8d34243d1de35006ab9e4a4140081958365ace6fea56734', durationMs: 8_017,
      prompt: 'List every tool you can call from openai_docs, names only. Do not call any.',
      answer: 'No `openai_docs` tools are available in this session.',
    }),
    lesson: 'The same allowlist as “Too narrow”, where the agent did call search_openai_docs. Asked what it has, it said it has nothing, in two separate runs. What the model says about its tools is not evidence: test with tasks and read the mcp_call items.',
  },
  {
    id: 'empty', label: 'allowed_tools: []', origin: 'live', settings: { ...defaultAllowSettings, allowed: [] },
    run: run({
      probeId: 'custom', target: null, sessionId: 'sess_0e645d772bf4acd9006ab9e42921b0819789d504254b665d11', durationMs: 13_075,
      prompt: 'List every tool you can call from openai_docs.',
      answer: 'No `openai_docs` tools are currently available.\n\nThe available MCP-related tools are: `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource`.',
    }),
    lesson: 'An empty list is accepted and hides every server tool. The MCP resource helpers are still there: allowed_tools does not cover them. If you want nothing from a server, leave the server out.',
  },
  {
    id: 'typo', label: 'A name that matches nothing', origin: 'live', settings: { ...defaultAllowSettings, allowed: ['search_docs'] },
    run: run({
      probeId: 'search', target: 'search_openai_docs', sessionId: 'sess_000b5500164aceab006ab9e435d13c8197816f6642b2d6498a', durationMs: 12_700,
      prompt: 'Search the docs for MCP connections.',
      calls: [
        call('exec_t1', 'list_mcp_resource_templates', { server: 'openai_docs' }, null, { status: 'failed', kind: 'helper', error: { code: null, message: 'resources/templates/list failed for `openai_docs`: Mcp error: -32601: Unknown method: resources/templates/list' } }),
        call('exec_t2', 'list_mcp_resources', { server: 'openai_docs' }, null, { status: 'failed', kind: 'helper', error: { code: null, message: 'resources/list failed for `openai_docs`: Mcp error: -32601: Unknown method: resources/list' } }),
      ],
      answer: 'The `openai_docs` server is unavailable (it doesn’t support the docs/resource search methods here). I only have MCP resource listing and file-download tools, so I can’t search the docs directly.',
    }),
    lesson: '“search_docs” is not a tool on this server. The API accepted it without an error, and the agent had no server tools, so it tried the resource helpers, which failed. Nothing in the stream says the allowlist was wrong. That is why this app checks names against tools/list before sending.',
  },
  {
    id: 'case', label: 'The right name, the wrong case', origin: 'live', settings: { ...defaultAllowSettings, allowed: ['Search_OpenAI_Docs'] },
    run: run({
      probeId: 'search', target: 'search_openai_docs', sessionId: 'sess_04df181c06a5a961006ab9e44342c08194b34bcabe6cb90054', durationMs: 10_225,
      prompt: 'Search the docs for MCP connections.',
      answer: 'The `openai_docs` MCP tools aren’t available in this session, so I can’t search the docs directly.',
    }),
    lesson: 'Names match exactly: “Search_OpenAI_Docs” allows nothing. The API accepted it, and the turn ran with no server tools.',
  },
  {
    id: 'env-origin', label: 'connection_origin: environment, no environment', origin: 'live', settings: { ...defaultAllowSettings, origin: 'environment' },
    run: run({
      probeId: 'search', target: 'search_openai_docs', durationMs: 555, turnStatus: 'failed',
      prompt: 'Search the docs for MCP connections.',
      answer: '',
      error: '400 mcp tool connection_origin=environment requires a session environment',
    }),
    lesson: 'An environment origin connects from the session’s environment, and environment { type: "none" } has none. The API refuses the request before a session exists, with required true or false. For a public server, use "service".',
  },
  {
    id: 'ref-before', label: 'A spec that is only a $ref', origin: 'live', settings: { ...defaultAllowSettings, restrict: false },
    run: run({
      probeId: 'custom', target: null, sessionId: 'sess_0543d6f597456ce7006ab9e8fc2a208195ab4c9de4a2835ae5',
      prompt: 'Use get_openapi_spec to show the request body POST /v1/agents/sessions',
      calls: [call('exec_r1', 'get_openapi_spec', { url: '/v1/agents/sessions' }, '{ "openapi": "3.1.0", … "paths": { "/agents/sessions": { "post": { "requestBody": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/CreateAgentSessionParams" } } } } } } } }\n(no components section: the referenced schema is not included)')],
      answer: '`POST /v1/agents/sessions` accepts an `application/json` body using the `CreateAgentSessionParams` schema:\n\n```json\n{\n  "...": "CreateAgentSessionParams fields"\n}\n```\n\nThe endpoint spec returned does not expand that referenced schema’s fields; it states the body is optional and creates a managed session, optionally with initial input. [OpenAI API reference](https://platform.openai.com/docs/api-reference)',
    }),
    lesson: 'The allowlist was fine and the right tool was called, but the answer is not. The spec’s request body was only a $ref, with no schema to follow, and the agent printed a placeholder object that looks like an answer. It also called the body optional, but the SDK requires environment. The real fields are environment (required), agent or agent_id, input (required with environment none), metadata, stream, and vault_ids. A call that succeeded is not proof of a correct answer: read what the tool actually returned.',
  },
  {
    id: 'ref-after', label: 'The same, after the instruction fix', origin: 'live', settings: { ...defaultAllowSettings, restrict: false },
    run: run({
      probeId: 'custom', target: null, sessionId: 'sess_04be7cfc274ddc29006ab9ea2ecc988194b54cb63dc485639c', durationMs: 18_500,
      prompt: 'Use get_openapi_spec to show the request body POST /v1/agents/sessions',
      calls: [
        call('exec_r2', 'get_openapi_spec', { url: '/v1/agents/sessions' }, '{ … "schema": { "$ref": "#/components/schemas/CreateAgentSessionParams" } … }'),
        call('exec_r3', 'search_openai_docs', { limit: 5, query: 'CreateAgentSessionParams POST /v1/agents/sessions request body' }, hits('https://developers.openai.com/api/docs/guides/agents-api/sessions')),
        call('exec_r4', 'fetch_openai_doc', { url: 'https://developers.openai.com/api/docs/guides/agents-api/sessions' }, '# Run and continue sessions\n\n… client.beta.agents.sessions.create({ agent: { model, instructions }, environment: { type: "openai_hosted" }, input, stream: true }) …'),
      ],
      answer: '`POST /v1/agents/sessions` accepts `application/json` with schema `CreateAgentSessionParams`. The endpoint spec returns this schema as a `$ref`, rather than inlining its fields.\n\n```json\n{\n  "agent": {\n    "model": "gpt-6-astra",\n    "instructions": "Write clean code, run it, and report the actual output."\n  },\n  "environment": { "type": "openai_hosted" },\n  "input": "Create tree.py and run it.",\n  "stream": true\n}\n```\n\n`stream: true` returns an SSE event stream; otherwise it returns the created session. [Run and continue sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions)',
    }),
    lesson: 'The instructions now say: when a result points to something it does not include, say so, look it up with another tool, and never show placeholder fields. The agent said the schema was a $ref, then searched and fetched the sessions guide, and showed its documented request. It is correct but not complete: agent_id, metadata, and vault_ids are missing, because no tool on this server returns the full schema. When an answer can only be as complete as its source, it should say so.',
  },
  {
    id: 'breach', label: 'A call outside the allowlist', origin: 'illustration', settings: pair,
    run: run({
      probeId: 'endpoints', target: 'list_api_endpoints', turnStatus: 'cancelled', stopped: true,
      prompt: 'Which endpoint lists the items saved in an Agents API session?',
      calls: [call('exec_b1', 'list_api_endpoints', {}, null, { status: 'in_progress' })],
      answer: '',
      error: 'list_api_endpoints is not in allowed_tools. The server cancelled the turn.',
    }),
    lesson: 'An illustration: it did not happen in any live run. If an mcp_call ever named a tool outside the allowlist, the app would treat it as a breach, cancel the turn, and keep the evidence. The API enforces the list; the app checks it anyway.',
  },
];
