// Lab 23: the test page. Every case runs the real functions (checkOrigin, checkAllowlist, buildRestrictedTool,
// visibleTools, isAllowedCall, judgeProbe, summarizeTest) on fixed inputs, so it needs no network and no API key.
import type { DiscoveredTool, McpCall } from './lab22Mcp.ts';
import { recordedDocsTools } from './lab22Scenarios.ts';
import {
  buildRestrictedTool, checkAllowlist, checkOrigin, defaultAllowSettings, isAllowedCall, judgeProbe, parseRestrictedTool, summarizeTest, visibleTools,
  type AllowSettings, type ProbeRun,
} from './lab23Allow.ts';

export type TestGroup = 'declare' | 'visible' | 'probe';
export type AllowTest = { id: string; label: string; group: TestGroup; expect: string; note: string; run: () => { got: string; detail: string } };
export type TestResult = { id: string; got: string; detail: string; pass: boolean };

const levelOf = (findings: Array<{ level: string }>) => (findings.some((item) => item.level === 'error') ? 'error' : findings.some((item) => item.level === 'warn') ? 'warn' : 'ok');
const declared = (patch: Partial<AllowSettings>, discovered: DiscoveredTool[] | null = recordedDocsTools) => {
  const { tool, findings } = buildRestrictedTool({ ...defaultAllowSettings, ...patch }, discovered);
  const shape = !tool ? 'no tool' : tool.allowed_tools ? `[${tool.allowed_tools.join(', ')}]` : 'all tools';
  return { got: `${levelOf(findings)} · ${shape}`, detail: [JSON.stringify(tool, null, 2), ...findings.map((item) => `${item.level}: ${item.text}`)].join('\n') };
};
const call = (name: string, patch: Partial<McpCall> = {}): McpCall => ({ id: `exec_${name}`, server: 'openai_docs', name, status: 'completed', turnId: 't', arguments: {}, output: 'ok', isError: false, error: null, kind: 'tool', ...patch });
const probe = (target: string | null, calls: McpCall[], answer = 'Done.', patch: Partial<ProbeRun> = {}): ProbeRun => ({ probeId: 'p', prompt: 'q', target, sessionId: null, turnStatus: 'completed', calls, answer, durationMs: 1, error: null, stopped: false, ...patch });
const pair = ['search_openai_docs', 'fetch_openai_doc'];
const judged = (run: ProbeRun, allowed: string[] | null) => { const result = judgeProbe(run, allowed); return { got: result.outcome, detail: `${result.title}: ${result.detail}` }; };

export const allowTests: AllowTest[] = [
  { id: 'pair', label: 'Search and fetch, service origin', group: 'declare', expect: 'ok · [search_openai_docs, fetch_openai_doc]', note: 'The default policy for a “find and quote a page” assistant.', run: () => declared({}) },
  { id: 'all', label: 'allowed_tools left out', group: 'declare', expect: 'warn · all tools', note: 'Allowed, with a warning: every tool, including tools the server adds later.', run: () => declared({ restrict: false }) },
  { id: 'empty', label: 'allowed_tools: []', group: 'declare', expect: 'warn · []', note: 'Live: accepted by the API, and the agent had no server tools. Leave the server out instead.', run: () => declared({ allowed: [] }) },
  { id: 'typo', label: 'A name not in tools/list', group: 'declare', expect: 'error · no tool', note: 'Live: the API accepted “search_docs” and allowed nothing. The app refuses it.', run: () => declared({ allowed: ['search_docs'] }) },
  { id: 'case', label: 'The right name, the wrong case', group: 'declare', expect: 'error · no tool', note: 'Live: “Search_OpenAI_Docs” matched nothing. Names are case-sensitive.', run: () => declared({ allowed: ['Search_OpenAI_Docs'] }) },
  { id: 'dupe', label: 'A name listed twice', group: 'declare', expect: 'ok · [search_openai_docs]', note: 'The copy is removed; the finding says so (a warn, reported below the ok).', run: () => { const check = checkAllowlist(['search_openai_docs', ' search_openai_docs '], recordedDocsTools); return { got: `${check.findings.at(-1)?.level} · [${check.allowed.join(', ')}]`, detail: check.findings.map((item) => `${item.level}: ${item.text}`).join('\n') }; } },
  { id: 'unchecked', label: 'Names before discovery', group: 'declare', expect: 'warn · [search_openai_docs, fetch_openai_doc]', note: 'Without tools/list the names cannot be checked. The server always discovers before it sends.', run: () => declared({}, null) },
  { id: 'destructive', label: 'Allowing a destructive tool', group: 'declare', expect: 'warn', note: 'An allowed destructive tool runs with no pause. Lab 20 adds a person.', run: () => { const check = checkAllowlist(['delete_page'], [{ name: 'delete_page', title: null, description: 'Delete a page.', params: [], required: [], readOnly: false, destructive: true }]); return { got: levelOf(check.findings), detail: check.findings.map((item) => item.text).join('\n') }; } },
  { id: 'env-none', label: 'environment origin, no environment', group: 'declare', expect: 'error', note: 'Live: 400 “connection_origin=environment requires a session environment”.', run: () => { const findings = checkOrigin('environment', 'none'); return { got: levelOf(findings), detail: findings[0]?.text ?? '' }; } },
  { id: 'env-hosted', label: 'environment origin, with an environment', group: 'declare', expect: 'ok', note: 'Allowed once the session has an environment (Stages 6 and 7).', run: () => { const findings = checkOrigin('environment', 'openai_hosted'); return { got: levelOf(findings), detail: findings[0]?.text ?? '' }; } },
  { id: 'origin-sent', label: 'The origin is always sent', group: 'declare', expect: 'service', note: 'Even the default is written out, so the request says where the connection starts.', run: () => { const { tool } = buildRestrictedTool(defaultAllowSettings, recordedDocsTools); return { got: tool?.connection_origin ?? 'missing', detail: JSON.stringify(tool, null, 2) }; } },
  { id: 'url', label: 'Lab 22’s URL rules still apply', group: 'declare', expect: 'error · no tool', note: 'Restricting tools does not make an unsafe URL safe.', run: () => declared({ serverUrl: 'http://developers.openai.com/mcp' }) },
  { id: 'visible-pair', label: 'Two allowed, three hidden', group: 'visible', expect: '2 allowed · 3 hidden', note: 'The allowlist decides what the agent discovers.', run: () => { const view = visibleTools(recordedDocsTools, pair); return { got: `${view.allowed.length} allowed · ${view.hidden.length} hidden`, detail: `hidden: ${view.hidden.map((tool) => tool.name).join(', ')}` }; } },
  { id: 'visible-all', label: 'No allowlist', group: 'visible', expect: '5 allowed · 0 hidden', note: 'Left out means everything.', run: () => { const view = visibleTools(recordedDocsTools, null); return { got: `${view.allowed.length} allowed · ${view.hidden.length} hidden`, detail: view.allowed.map((tool) => tool.name).join(', ') }; } },
  { id: 'visible-typo', label: 'A name that matches nothing', group: 'visible', expect: '0 allowed · 5 hidden · 1 unmatched', note: 'An unmatched name hides everything and allows nothing.', run: () => { const view = visibleTools(recordedDocsTools, ['search_docs']); return { got: `${view.allowed.length} allowed · ${view.hidden.length} hidden · ${view.unmatched.length} unmatched`, detail: `unmatched: ${view.unmatched.join(', ')}` }; } },
  { id: 'helper', label: 'A resource helper', group: 'visible', expect: 'true', note: 'list_mcp_resources is added by the API and is not covered by allowed_tools, so it is not a breach.', run: () => ({ got: String(isAllowedCall(call('list_mcp_resources', { kind: 'helper' }), [])), detail: 'kind: helper' }) },
  { id: 'parse', label: 'The browser reads the tool back', group: 'visible', expect: 'environment · 1', note: 'parseRestrictedTool keeps the origin and the list.', run: () => { const tool = parseRestrictedTool({ type: 'mcp', server_label: 'x', transport: { type: 'http', server_url: 'https://a.example/mcp' }, required: true, connection_origin: 'environment', allowed_tools: ['a', 7] }); return { got: `${tool.connection_origin} · ${tool.allowed_tools?.length}`, detail: JSON.stringify(tool, null, 2) }; } },
  { id: 'can', label: 'Allowed and called', group: 'probe', expect: 'used', note: 'The probe needs fetch_openai_doc, which is allowed.', run: () => judged(probe('fetch_openai_doc', [call('search_openai_docs'), call('fetch_openai_doc')]), pair) },
  { id: 'cannot', label: 'Hidden and not called', group: 'probe', expect: 'blocked', note: 'Live: list_api_endpoints was hidden, and the answer named the two tools it had.', run: () => judged(probe('list_api_endpoints', [], 'I can’t: list_api_endpoints is unavailable.'), pair) },
  { id: 'substitute', label: 'Hidden, another tool used', group: 'probe', expect: 'blocked', note: 'The agent searched instead. Still inside the allowlist.', run: () => judged(probe('list_api_endpoints', [call('search_openai_docs')], 'Here is what search found.'), pair) },
  { id: 'unused', label: 'Allowed, not called', group: 'probe', expect: 'unused', note: 'An allowed tool that was not used proves nothing about it.', run: () => judged(probe('fetch_openai_doc', [call('search_openai_docs')]), pair) },
  { id: 'breach', label: 'A hidden tool was called', group: 'probe', expect: 'breach', note: 'Should never happen. The server cancels the turn and keeps the evidence.', run: () => judged(probe('list_api_endpoints', [call('list_api_endpoints')], '', { turnStatus: 'cancelled', stopped: true }), pair) },
  { id: 'failed', label: 'The request was refused', group: 'probe', expect: 'failed', note: 'A failed probe proves nothing either way.', run: () => judged(probe('search_openai_docs', [], '', { turnStatus: 'failed', error: '400 mcp tool connection_origin=environment requires a session environment' }), pair) },
  { id: 'held', label: 'A full test that held', group: 'probe', expect: 'held', note: 'Search and fetch were called; list_api_endpoints was not.', run: () => { const verdict = summarizeTest([probe('search_openai_docs', [call('search_openai_docs')]), probe('fetch_openai_doc', [call('fetch_openai_doc')]), probe('list_api_endpoints', [], 'I can’t.')], pair); return { got: verdict.tone, detail: `${verdict.title}: ${verdict.text}` }; } },
  { id: 'gaps', label: 'A test with an unused tool', group: 'probe', expect: 'gaps', note: 'Nothing left the list, but one allowed tool was never exercised.', run: () => { const verdict = summarizeTest([probe('fetch_openai_doc', [call('search_openai_docs')]), probe('list_api_endpoints', [])], pair); return { got: verdict.tone, detail: `${verdict.title}: ${verdict.text}` }; } },
  { id: 'nothing', label: 'A test where nothing was callable', group: 'probe', expect: 'Held, but nothing was callable', note: 'Live: a typo in the list gave this picture. It held only because nothing was allowed.', run: () => { const verdict = summarizeTest([probe('search_openai_docs', [], 'I don’t have the openai_docs tools.')], ['search_docs']); return { got: verdict.title, detail: verdict.text }; } },
  { id: 'unrestricted', label: 'A test with nothing hidden', group: 'probe', expect: 'Nothing hidden was probed', note: 'Every tool allowed and called: the list was never tested. Not “held”.', run: () => { const verdict = summarizeTest([probe('search_openai_docs', [call('search_openai_docs')]), probe('get_openapi_spec', [call('get_openapi_spec')])], null); return { got: verdict.title, detail: verdict.text }; } },
];

export function runAllowTest(item: AllowTest): TestResult {
  try {
    const { got, detail } = item.run();
    return { id: item.id, got, detail, pass: got === item.expect };
  } catch (error) {
    return { id: item.id, got: 'crashed', detail: error instanceof Error ? error.message : String(error), pass: false };
  }
}

export const runAllowSuite = () => allowTests.map(runAllowTest);
