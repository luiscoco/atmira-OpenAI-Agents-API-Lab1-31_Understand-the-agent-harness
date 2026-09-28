// Lab 22: recorded traces for the call inspector. They need no API key. Two are shortened from live runs on
// 2026-09-28 (marked below); the others are illustrations written for the course. Each shows one thing to check.
import { docsServerUrl, type DiscoveredTool, type McpCall, type McpTool } from './lab22Mcp.ts';

// tools/list from https://developers.openai.com/mcp, recorded on 2026-09-28. Run discovery to see today's list.
export const recordedDocsTools: DiscoveredTool[] = [
  { name: 'search_openai_docs', title: 'Search OpenAI Docs', description: 'Search across platform.openai.com, developers.openai.com, and learn.chatgpt.com docs. Results include URLs: after search, use fetch_openai_doc to read the exact markdown.', params: [{ name: 'query', type: 'string', required: true, detail: 'min length 1', min: null, max: null }, { name: 'limit', type: 'integer', required: false, detail: '1–50', min: 1, max: 50 }, { name: 'cursor', type: 'string', required: false, detail: '', min: null, max: null }], required: ['query'], readOnly: true, destructive: false },
  { name: 'list_openai_docs', title: 'List OpenAI Docs', description: 'List or browse pages that this server crawls. Results include URLs: after list, use fetch_openai_doc on a result URL.', params: [{ name: 'limit', type: 'integer', required: false, detail: '1–50', min: 1, max: 50 }, { name: 'cursor', type: 'string', required: false, detail: '', min: null, max: null }], required: [], readOnly: true, destructive: false },
  { name: 'fetch_openai_doc', title: 'Fetch OpenAI Doc', description: 'Fetch the markdown for a specific doc page so you can quote or summarize exact, up-to-date guidance. You can pass anchor to fetch just that section.', params: [{ name: 'url', type: 'string', required: true, detail: 'min length 1', min: null, max: null }, { name: 'anchor', type: 'string', required: false, detail: '', min: null, max: null }], required: ['url'], readOnly: true, destructive: false },
  { name: 'list_api_endpoints', title: 'List API Endpoints', description: 'List all OpenAI API endpoint URLs available in the OpenAPI spec.', params: [], required: [], readOnly: true, destructive: false },
  { name: 'get_openapi_spec', title: 'Get OpenAPI Spec', description: 'Return the OpenAPI spec for a specific API endpoint URL. Optionally filter code samples by language, or return only code samples.', params: [{ name: 'url', type: 'string', required: true, detail: 'min length 1', min: null, max: null }, { name: 'languages', type: 'string[]', required: false, detail: '', min: null, max: null }, { name: 'codeExamplesOnly', type: 'boolean', required: false, detail: '', min: null, max: null }], required: ['url'], readOnly: true, destructive: false },
];

export type Sample = {
  id: string;
  label: string;
  prompt: string;
  tool: McpTool | null;
  calls: McpCall[];
  answer: string;
  lesson: string;
  origin: 'live' | 'illustration';
};

const docs: McpTool = { type: 'mcp', server_label: 'openai_docs', transport: { type: 'http', server_url: docsServerUrl }, required: true };
const call = (id: string, name: string, args: unknown, output: string | null, extra: Partial<McpCall> = {}): McpCall => ({
  id, server: 'openai_docs', name, status: 'completed', turnId: 'turn_sample', arguments: args, output, isError: false, error: null, kind: 'tool', ...extra,
});
const hits = (...urls: string[]) => JSON.stringify({ hits: urls.map((url) => ({ url, hierarchy: { lvl1: url.split('/').at(-1) } })) });
const mcpPage = 'https://developers.openai.com/api/docs/guides/agents-api/tools/mcp';
const responsesPage = 'https://developers.openai.com/api/docs/guides/tools-connectors-mcp';

export const samples: Sample[] = [
  {
    id: 'grounded', label: 'Search, then fetch', origin: 'illustration',
    prompt: 'In the Agents API, how do I connect an agent to a remote MCP server?',
    tool: docs,
    calls: [
      call('exec_s1', 'search_openai_docs', { query: 'Agents API MCP connection', limit: 5 }, hits(mcpPage, 'https://developers.openai.com/api/docs/guides/agents-api/tools/plugins')),
      call('exec_s2', 'fetch_openai_doc', { url: mcpPage }, '# MCP connections\n\nAdd an MCP server to agent.tools with type "mcp", a server_label, and a transport. The Agents API discovers the tools, calls the server, and returns results to the agent. …'),
    ],
    answer: `Add an entry with \`type: "mcp"\`, a \`server_label\`, and an HTTP \`transport\` with the \`server_url\` to \`agent.tools\`. The Agents API discovers the server's tools and calls them inside the turn ([MCP connections](${mcpPage})).`,
    lesson: 'The healthy pattern: search, then fetch the page, then cite the page that was fetched. Every link appears in a tool result, and every call is one of the discovered tools.',
  },
  {
    id: 'wrong-api', label: 'Right server, wrong API', origin: 'live',
    prompt: 'In the Agents API, how do I restrict which MCP tools an agent may call? One short paragraph.',
    tool: docs,
    calls: [
      call('exec_445060a6', 'search_openai_docs', { limit: 5, query: 'Agents API MCP tool restrictions allowed_tools' }, hits('https://developers.openai.com/api/docs/guides/tools', responsesPage)),
      call('exec_7d213ceb', 'fetch_openai_doc', { url: responsesPage }, '# MCP servers\n\nIn addition to tools you make available to the model with function calling, you can give models new capabilities using remote MCP servers … This guide shows how to use MCP tools with the Responses API. … For Agents API sessions, see MCP connections.'),
    ],
    answer: `Set the MCP tool’s \`allowed_tools\` allowlist to the exact server tool names; only those tools are imported and therefore callable, e.g. \`tools: [{ type: "mcp", server_label: "my_mcp", server_url: "...", allowed_tools: ["search", "get_record"] }]\`. See [MCP tool filtering](${responsesPage}#filtering-tools).`,
    lesson: 'Shortened from a live run. Every call worked and the link came from a tool result, but the fetched page is the Responses API guide, and the answer puts server_url at the top level. In the Agents API it goes inside transport. Grounded is not the same as correct: read the page.',
  },
  {
    id: 'memory', label: 'No server declared', origin: 'illustration',
    prompt: 'In the Agents API, how do I connect an agent to a remote MCP server?',
    tool: null,
    calls: [],
    answer: 'I cannot look this up in this session, so this comes from training data and may be out of date: add the server to the agent’s tools with its URL, and the API will list its tools for the model.',
    lesson: 'Without an mcp tool in agent.tools there is no server to discover and nothing to call. The honest answer says it comes from training data.',
  },
  {
    id: 'not-ready', label: 'Not required, not ready', origin: 'live',
    prompt: 'In the Agents API, how do I connect an agent to a remote MCP server? Show the tool declaration.',
    tool: { ...docs, required: false },
    calls: [],
    answer: 'The docs tool is unavailable, so this is from training data and may be out of date.\n\nDeclare the remote MCP server as an `mcp` tool: `{ type: "mcp", server_label: "my_mcp_server", server_url: "https://example.com/mcp", require_approval: "never" }`.',
    lesson: 'From a live run. The same working server, but required: false: the first turn did not wait for it, so the agent had no MCP tools, and no item says so. In this lab’s runs that happened in 4 of 5 first turns, and 0 of 3 with required: true. The answer from memory also uses the Responses API shape.',
  },
  {
    id: 'unreachable', label: 'Server unreachable', origin: 'live',
    prompt: 'What does the list_openai_docs tool do?',
    tool: { type: 'mcp', server_label: 'broken', transport: { type: 'http', server_url: 'https://example.com/mcp' }, required: false },
    calls: [call('mcp_78d8bd0f', 'initialize', {}, null, { server: 'broken', status: 'failed', kind: 'connection', error: { code: 'connection_failed', message: "Could not connect to MCP server 'broken'. Check its URL, availability, and network access." } })],
    answer: 'It lists available OpenAI documentation resources so I can find and read relevant docs before answering implementation or API questions. It isn’t available in this session.',
    lesson: 'From a live run. The server could not initialize, and required is false, so the turn completed anyway. The only sign is an mcp_call named initialize with status failed. With required: true the turn fails instead.',
  },
  {
    id: 'invented', label: 'Invented tool and arguments', origin: 'illustration',
    prompt: 'Find the docs page about MCP connections.',
    tool: docs,
    calls: [
      call('exec_i1', 'search_docs', { q: 'MCP connections' }, null, { status: 'failed', error: { code: 'tool_not_found', message: 'Unknown tool: search_docs' } }),
      call('exec_i2', 'fetch_openai_doc', { anchor: '#transport' }, 'Invalid arguments: url is required.', { isError: true }),
      call('exec_i3', 'search_openai_docs', { query: 'MCP connections', limit: '5' }, hits(mcpPage)),
    ],
    answer: `The page is [MCP connections](${mcpPage}).`,
    lesson: 'The agent can only call what tools/list returned, with the arguments its inputSchema allows. Compare each call with the discovered tools: an unknown name, a missing required argument, and a string where an integer belongs are all visible here.',
  },
  {
    id: 'tool-error', label: 'Every call failed', origin: 'illustration',
    prompt: 'What does the Agents API sessions endpoint return?',
    tool: docs,
    calls: [call('exec_e1', 'fetch_openai_doc', { url: 'https://developers.openai.com/api/docs/guides/agents-api/sessions/old' }, 'Error: page not found (404).', { isError: true, status: 'completed' })],
    answer: 'It returns the session object with its ID and status ([Sessions](https://platform.openai.com/docs/api-reference/agents/sessions)).',
    lesson: 'A tool can finish its call and still report isError: true in its result. The only call failed, yet the answer links a page that no tool returned. That link comes from the model’s memory.',
  },
];
