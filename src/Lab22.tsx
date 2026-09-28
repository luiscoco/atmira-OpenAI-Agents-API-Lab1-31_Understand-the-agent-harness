import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import { AnswerPre } from './Lab6.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { shortId } from './lab13Recovery.ts';
import { canonicalUrl, checkUrl } from './lab21Search.ts';
import {
  buildMcpReport, buildMcpTool, classifyMcpRun, defaultSettings, describeCall, docsInstructions, docsServerUrl, failed, hasErrors, parseDiscovery, parseMcpCall, parseSummary, reviewTools,
  type CitedPage, type DiscoveredTool, type Discovery, type Finding, type McpCall, type McpCheck, type McpReport, type McpRun, type McpSettings, type McpTool, type Moment, type Verdict,
} from './lab22Mcp.ts';
import { recordedDocsTools, samples } from './lab22Scenarios.ts';
import { mcpTests, runMcpSuite, type TestGroup, type TestResult } from './lab22Tests.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Live = { events: string[]; calls: McpCall[]; answer: string; timeline: Moment[] };
type Suite = { source: 'browser' | 'server'; runtime: string; durationMs: number; results: Record<string, TestResult> };
type SavedItem = { id: string | null; type: string; role: string | null; text: string | null; status: string | null; call: string | null };

const lessons: Lesson[] = [
  { number: '01', title: 'Declare an HTTP MCP server in agent.tools', file: 'server/lab22.ts', code: "const tool = {\n  type: 'mcp',\n  server_label: 'openai_docs',            // names the server in every mcp_call\n  transport: { type: 'http', server_url: 'https://developers.openai.com/mcp' },\n  required: true,                          // the first turn waits for it (and fails without it)\n};\n\nstream = await api.beta.agents.sessions.create({\n  agent: { model, instructions: docsInstructions(today, tool.server_label), tools: [tool] },\n  environment: { type: 'none' },\n  input: prompt,\n  stream: true,\n});", explanation: 'An MCP server is a tool you declare, not a function you write. Give it type mcp, a server label, and an HTTP transport with the server URL. The Agents API connects to the server, asks it for its tools, and lets the model call them inside the turn. There is no requires action pause and no tool result to send back. The label matters: it appears in every call item, so you can tell servers apart. Required matters more than its name suggests. With true, the first turn waits until the server has initialized, and fails if it cannot. With false, the default, the first turn does not wait. In this lab’s live runs, most first turns with required false started with no M C P tools at all, and nothing in the stream said so. For a documentation assistant, set required to true.' },
  { number: '02', title: 'Validate the connection on the server', file: 'src/lab22Mcp.ts', code: "export function checkServerUrl(raw) {\n  const parsed = new URL(raw);\n  if (parsed.protocol !== 'https:')      → error: https only\n  if (parsed.username || parsed.password) → error: no credentials in the URL\n  if (host === 'localhost' || isPrivateAddress(host))\n                                          → error: OpenAI's network cannot reach it\n  if (secret-looking query parameter)     → error: use a vault (Lab 24)\n  return { url: parsed.href, findings };\n}", explanation: 'The browser sends plain settings, and the server rebuilds the declaration itself. It refuses plain http, a user name or password in the URL, and a query parameter that looks like a token, because URLs end up in logs and saved sessions. It also refuses localhost and private addresses. With the default connection origin, the connection starts on OpenAI’s network, so a server on your laptop is out of reach. Lab 33 covers servers inside an environment, and Lab 24 moves secrets into a vault.' },
  { number: '03', title: 'See what the agent sees: initialize and tools/list', file: 'server/lab22.ts', code: "await assertPublicHost(url);                    // resolve DNS, refuse private IPs\nconst init = await rpc(url, { jsonrpc: '2.0', id: 1, method: 'initialize',\n  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo } });\nawait rpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, session);\nconst list = await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, session);\nconst { tools } = parseToolList(rpcResult(parseRpcMessages(list.raw), 2).result);\n// search_openai_docs, list_openai_docs, fetch_openai_doc, list_api_endpoints, get_openapi_spec", explanation: 'Discovery happens before the model sees any tool, and the Agents API does not stream it to you. So this lab repeats the handshake from your own server. Initialize agrees on a protocol version. A notification says the client is ready. Then tools list returns each tool’s name, description, and input schema. The reply may be plain JSON or an event stream, so the parser handles both. Because the server fetches a URL typed in the browser, it resolves the host first and refuses private addresses and redirects.' },
  { number: '04', title: 'Watch mcp_call items in the stream', file: 'server/lab22.ts', code: "if ((event.type === 'agent.session.turn.item.added' ||\n     event.type === 'agent.session.turn.item.done') &&\n    event.item.type === 'mcp_call') {\n  const call = parseMcpCall(event.item);\n  // added: { name: 'search_openai_docs', arguments: { query, limit }, status: 'in_progress' }\n  // done:  { status: 'completed', output: { content: [{ type: 'text', text }] } }\n  // down:  { name: 'initialize', status: 'failed', error: { code: 'connection_failed' } }\n}", explanation: 'Each call arrives as an M C P call item, twice. Item added comes when the call starts, with the tool name, the server label, and the arguments. Item done comes when it ends, with the output or an error. When the server cannot connect and it is not required, one call item named initialize arrives with status failed and the code connection failed, and the turn carries on without the server. That item is the only sign, so watch for it.' },
  { number: '05', title: 'Read the result: CallToolResult and errors', file: 'src/lab22Mcp.ts', code: "export function outputText(output) {\n  if (typeof output === 'string') return { text: output, isError: false };\n  const isError = output.isError === true;   // the tool ran, but reports a failure\n  const parts = output.content.map((part) =>\n    part.text ?? `[${part.type}]`);           // text, image, resource…\n  return { text: parts.join('\\n'), isError };\n}\nexport const failed = (call) =>\n  call.status === 'failed' || call.error !== null || call.isError;", explanation: 'The output is an MCP call tool result: a list of content parts, usually text, and sometimes an is error flag. A call can finish with status completed and still report is error true, for example a page that was not found. So a call counts as failed when its status failed, when it has an error, or when its result says is error. Keep the text: it is the evidence the answer should rest on. The server trims long pages before sending them to the browser.' },
  { number: '06', title: 'Check the calls and ground the answer', file: 'src/lab22Mcp.ts', code: "buildMcpReport({ tool, discovered, calls, answer, prompt })\n// connected  no failed initialize item\n// known      every call is in tools/list, from this server_label\n// arguments  required fields present, simple types match the inputSchema\n// succeeded  no failed call, no isError result\n// grounded   every cited link appears in a tool result or a fetch argument\n// scope      a question about the Agents API cites /agents-api/ pages", explanation: 'Now check what happened. Every call should name a tool that discovery returned, from the right server, with the required arguments and the right types. The calls should succeed. Every link in the answer should appear in a tool result, otherwise it came from the model’s memory. And grounded is not the same as correct. In a live run, the agent fetched the Responses API guide for an Agents API question, and answered with the wrong shape. The scope check catches that, but only reading the page confirms it.' },
];

type Preset = { label: string; text: string; settings: McpSettings; note: string };
const askDocs = 'In the Agents API, how do I connect an agent to a remote MCP server? Show the tool declaration.';
const presets: Preset[] = [
  { label: 'Ask the docs', text: askDocs, settings: defaultSettings, note: 'The OpenAI docs server, required: true.' },
  { label: 'Look up an endpoint', text: 'Which endpoint lists the items saved in an Agents API session, and which query parameters does it take?', settings: defaultSettings, note: 'The OpenAI docs server: watch for list_api_endpoints and get_openapi_spec.' },
  { label: 'The same, server left out', text: askDocs, settings: { ...defaultSettings, offered: false }, note: 'No mcp tool: compare the answer and its links.' },
  { label: 'The same, not required', text: askDocs, settings: { ...defaultSettings, required: false }, note: 'required: false. The first turn does not wait for the server: run it twice.' },
  { label: 'Unreachable, optional', text: 'What does the fetch_openai_doc tool return?', settings: { offered: true, label: 'broken', serverUrl: 'https://example.com/mcp', required: false }, note: 'A server that does not speak MCP, required: false.' },
  { label: 'Unreachable, required', text: 'What does the fetch_openai_doc tool return?', settings: { offered: true, label: 'broken', serverUrl: 'https://example.com/mcp', required: true }, note: 'The same server, required: true.' },
  { label: 'Ask for a tool it lacks', text: 'Use the docs server to open a GitHub issue titled "MCP lab test".', settings: defaultSettings, note: 'The docs server has no tool that writes anything.' },
];

const groups: Array<{ id: TestGroup; label: string }> = [
  { id: 'declare', label: 'Declare the server' },
  { id: 'discover', label: 'Discover its tools' },
  { id: 'calls', label: 'Check the calls' },
];

const steps = [
  { id: 'declare', label: 'Declare', detail: 'agent.tools' },
  { id: 'connect', label: 'Connect', detail: 'initialize' },
  { id: 'discover', label: 'Discover', detail: 'tools/list' },
  { id: 'call', label: 'Call', detail: 'mcp_call' },
  { id: 'ground', label: 'Ground', detail: 'links from results' },
];
type StepState = '' | 'pass' | 'fail' | 'skip' | 'warn';
const stateOf = (check: McpCheck | undefined): StepState => (!check ? '' : check.level === 'ok' ? 'pass' : check.level);

function flowOf(report: McpReport, tool: McpTool | null): StepState[] {
  const find = (id: McpCheck['id']) => report.checks.find((check) => check.id === id);
  const connected = stateOf(find('connected'));
  const call = find('called')?.level === 'warn' ? 'warn' : stateOf(find('succeeded'));
  const known = stateOf(find('known'));
  const argument = stateOf(find('arguments'));
  const grounded = stateOf(find('grounded'));
  const scope = stateOf(find('scope'));
  return [
    tool ? 'pass' : 'skip',
    connected,
    known === 'fail' || argument === 'fail' ? 'fail' : known === 'skip' && report.toolCalls.length ? 'warn' : known,
    call,
    grounded === 'pass' && scope === 'warn' ? 'warn' : grounded,
  ];
}

export function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}
const json = (value: unknown) => codeTokens(Prism.tokenize(JSON.stringify(value, null, 2) ?? 'undefined', Prism.languages.json || Prism.languages.javascript));
const newId = (): string => `run_${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)}`;
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const settingsLabel = (settings: McpSettings) => {
  if (!settings.offered) return 'left out';
  let host = settings.serverUrl;
  try { host = new URL(settings.serverUrl).host; } catch { /* shown as typed */ }
  return `${settings.label} · ${host}${settings.required ? ' · required' : ''}`;
};
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);

export async function readLines(response: Response, onLine: (line: Record<string, unknown>) => void) {
  if (!response.body) throw new Error('The browser could not read the response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop() || '';
    for (const raw of lines) if (raw.trim()) onLine(JSON.parse(raw) as Record<string, unknown>);
  }
}

function Flow({ states }: { states: StepState[] }) {
  return <ol className="lab18-pipeline lab21-flow lab22-flow" aria-label="From declaration to a grounded answer">{steps.map((step, index) => {
    const state = states[index];
    return <li key={step.id} className={state}><span>{state === 'pass' ? '✓' : state === 'fail' ? '✕' : state === 'warn' ? '!' : index + 1}</span><strong>{step.label}</strong><small>{state === 'skip' ? 'not used' : step.detail}</small></li>;
  })}</ol>;
}

export function Findings({ findings }: { findings: Finding[] }) {
  if (!findings.length) return null;
  return <ul className="lab21-findings">{findings.map((finding, index) => <li key={index} className={finding.level}><b>{finding.level === 'ok' ? '✓' : finding.level === 'warn' ? '!' : '✕'}</b>{finding.text}</li>)}</ul>;
}

function ToolCards({ tools }: { tools: DiscoveredTool[] }) {
  return <div className="lab22-tools">{tools.map((tool) => <article key={tool.name} className="lab22-tool">
    <div className="lab22-tool-head"><code>{tool.name}</code>{tool.title ? <span>{tool.title}</span> : null}</div>
    <div className="lab21-badges">
      {tool.readOnly === true ? <span className="lab21-badge ok">readOnlyHint</span> : <span className="lab21-badge bad">not marked read-only</span>}
      {tool.destructive === true ? <span className="lab21-badge bad">destructiveHint</span> : null}
    </div>
    <p>{clip(tool.description, 220)}</p>
    {tool.params.length ? <ul className="lab22-params">{tool.params.map((param) => <li key={param.name}><code>{param.name}{param.required ? '*' : ''}</code><span>{param.type}</span>{param.detail ? <small>{clip(param.detail, 80)}</small> : null}</li>)}</ul> : <p className="lab22-noparams">No arguments.</p>}
  </article>)}</div>;
}

function DiscoveryView({ discovery }: { discovery: Discovery }) {
  const review = useMemo(() => (discovery.error ? [] : reviewTools(discovery.tools)), [discovery]);
  return <div className="lab22-discovery">
    <ol className="lab22-steps">{discovery.steps.map((step, index) => <li key={index} className={step.ok ? 'ok' : 'fail'}><code>{step.method}</code><span className="lab22-http">{step.status === null ? '—' : `HTTP ${step.status}`}</span><span className="lab22-ms">{step.ms} ms</span><span className="lab22-note">{step.note}</span></li>)}</ol>
    {discovery.error ? <p className="lab2-error" role="alert">Discovery failed: {discovery.error}</p> : <>
      <p className="lab15-ids">{discovery.serverName ?? 'server'} {discovery.serverVersion ?? ''} · protocol <code>{discovery.protocolVersion ?? '?'}</code> · {discovery.tools.length} tools · {discovery.durationMs} ms · * = required</p>
      <ToolCards tools={discovery.tools} />
      <Findings findings={review} />
    </>}
  </div>;
}

// The answer, with each safe link numbered. A link that no tool returned is marked; a link that fails the check stays text.
function GroundedAnswer({ answer, pages }: { answer: string; pages: CitedPage[] }) {
  const byUrl = useMemo(() => new Map(pages.map((page) => [page.canonical, page])), [pages]);
  return <div className="lab7-answer lab16-answer lab21-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    pre: AnswerPre,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const check = checkUrl(href ?? '');
      if (!check.href) return <span className="lab21-dead" title="Not a web link: shown as text, never as a link">{children}</span>;
      const page = byUrl.get(canonicalUrl(check.href));
      const loose = page && !page.fromCall;
      return <><a href={check.href} target="_blank" rel="noopener noreferrer nofollow" className={loose ? 'lab22-loose' : undefined}>{children}</a>{page ? <sup className={'lab21-cite' + (loose ? ' lab22-cite-loose' : '')}>[{page.n}]</sup> : null}</>;
    },
  }}>{answer}</ReactMarkdown></div>;
}

function PageList({ pages }: { pages: CitedPage[] }) {
  if (!pages.length) return <p className="lab8-note">No links in this answer.</p>;
  return <ol className="lab21-sources">{pages.map((page) => {
    const bad = page.problems.some((problem) => problem.level === 'error');
    return <li key={page.canonical} className={bad ? 'bad' : page.problems.length ? 'warn' : 'ok'}>
      <span className="lab21-n">{page.n}</span>
      <div>
        <strong>{page.title}</strong>
        <p className="lab21-url">{page.href ? <a href={page.href} target="_blank" rel="noopener noreferrer nofollow">{page.url}</a> : <code>{page.url}</code>}</p>
        <div className="lab21-badges">
          {page.host ? <span className="lab21-badge host">{page.host}</span> : null}
          {page.fromCall ? <span className="lab21-badge ok">from {page.fromCall.split(' ')[0]}</span> : page.href ? <span className="lab21-badge bad">in no tool result</span> : null}
          {page.inScope === true ? <span className="lab21-badge ok">in scope</span> : null}
          {page.uses > 1 ? <span className="lab21-badge">cited {page.uses}×</span> : null}
        </div>
        {page.problems.map((problem, index) => <p key={index} className={'lab21-problem ' + problem.level}>{problem.text}</p>)}
      </div>
      {page.href ? <a className="lab21-open" href={page.href} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open page ${page.n} in a new tab`}>Open ↗</a> : <span className="lab21-open off">not a link</span>}
    </li>;
  })}</ol>;
}

export function CallLog({ calls }: { calls: McpCall[] }) {
  if (!calls.length) return <p className="lab8-note">No mcp_call items: the agent did not call the server.</p>;
  return <ol className="lab22-calls">{calls.map((call) => {
    const tone = call.status === 'in_progress' ? 'pending' : call.kind === 'helper' ? 'helper' : failed(call) ? 'fail' : call.kind;
    return <li key={call.id} className={tone}>
      <div className="lab22-call-head"><span className="lab22-kind">{call.kind}</span><code className="lab22-name">{call.name}</code><span className="lab22-server">{call.server}</span><span className="lab21-status">{call.status ?? '—'}</span><code className="lab22-id">{shortId(call.id)}</code></div>
      <p className="lab22-what">{describeCall(call)}</p>
      {call.kind === 'tool' ? <details className="lab22-io"><summary>arguments and result{call.output ? ` · ${call.output.length.toLocaleString('en')} characters` : ''}{call.isError ? ' · isError' : ''}</summary>
        <pre className="lab19-decl"><code>{json(call.arguments)}</code></pre>
        {call.error ? <p className="lab21-problem error">{call.error.code ? `${call.error.code}: ` : ''}{call.error.message}</p> : null}
        {call.output !== null ? <pre className="lab22-output">{clip(call.output, 1_500)}</pre> : <p className="lab8-note">{call.status === 'in_progress' ? 'Waiting for the result…' : 'No output.'}</p>}
      </details> : null}
    </li>;
  })}</ol>;
}

function Checks({ checks }: { checks: McpCheck[] }) {
  return <ul className="lab21-checks">{checks.map((check) => <li key={check.id} className={check.level}><b>{check.level === 'ok' ? '✓' : check.level === 'fail' ? '✕' : check.level === 'warn' ? '!' : '–'}</b><strong>{check.label}</strong><span>{check.detail}</span></li>)}</ul>;
}

function VerdictBox({ verdict }: { verdict: Verdict }) {
  return <div className={'lab16-verdict lab22-verdict ' + verdict.tone}><strong>{verdict.title}</strong><p>{verdict.text}</p></div>;
}

function ReportView({ answer, calls, report, verdict, tool }: { answer: string; calls: McpCall[]; report: McpReport; verdict: Verdict; tool: McpTool | null }) {
  return <div className="lab21-report">
    <VerdictBox verdict={verdict} />
    <Flow states={flowOf(report, tool)} />
    <div className="lab21-report-grid">
      <div>
        <h3 className="lab13-subhead">Answer <code>{report.pages.length} page{report.pages.length === 1 ? '' : 's'}</code></h3>
        {answer ? <GroundedAnswer answer={answer} pages={report.pages} /> : <p className="lab8-note">No answer text.</p>}
        <h3 className="lab13-subhead">Linked pages</h3>
        <PageList pages={report.pages} />
      </div>
      <div>
        <h3 className="lab13-subhead">Call log <code>mcp_call</code></h3>
        <CallLog calls={calls} />
        <h3 className="lab13-subhead">Checks</h3>
        <Checks checks={report.checks} />
      </div>
    </div>
  </div>;
}

function Timeline({ moments }: { moments: Moment[] }) {
  if (!moments.length) return null;
  const first = moments[0].at;
  return <ol className="lab17-timeline lab22-timeline">{moments.map((moment, index) => <li key={index} className={moment.kind}><span className="lab17-at">+{((moment.at - first) / 1000).toFixed(1)}s</span><span className="lab17-kind">{moment.kind}</span><span className="lab17-label">{moment.label}</span></li>)}</ol>;
}

function parseSuite(body: unknown): Suite {
  const value = body as { results?: unknown; runtime?: unknown; durationMs?: unknown };
  if (!Array.isArray(value.results)) throw new Error('Invalid test results.');
  const results: Record<string, TestResult> = {};
  for (const raw of value.results as TestResult[]) {
    if (typeof raw?.id !== 'string' || typeof raw.pass !== 'boolean' || typeof raw.got !== 'string') throw new Error('Invalid test result.');
    results[raw.id] = { id: raw.id, pass: raw.pass, got: raw.got, detail: typeof raw.detail === 'string' ? raw.detail : '' };
  }
  return { source: 'server', runtime: typeof value.runtime === 'string' ? value.runtime : 'Node', durationMs: typeof value.durationMs === 'number' ? value.durationMs : 0, results };
}

export default function Lab22({ active, health }: { active: boolean; health: Health }) {
  const [settings, setSettings] = useState<McpSettings>(defaultSettings);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [sampleId, setSampleId] = useState(samples[0].id);
  const [draft, setDraft] = useState(samples[0].answer);
  const [suite, setSuite] = useState<Suite | null>(null);
  const [suiteBusy, setSuiteBusy] = useState<'browser' | 'server' | null>(null);
  const [testId, setTestId] = useState(mcpTests[0].id);
  const [prompt, setPrompt] = useState(presets[0].text);
  const [preset, setPreset] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [live, setLive] = useState<Live | null>(null);
  const [runs, setRuns] = useState<McpRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<{ runId: string; list: SavedItem[] } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const abort = useRef<AbortController | null>(null);
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const declared = useMemo(() => buildMcpTool(settings), [settings]);
  const blocked = hasErrors(declared.findings);
  const today = new Date().toISOString().slice(0, 10);
  const request = { agent: { model: health?.model ?? 'your-model', instructions: `${docsInstructions(today, declared.tool?.server_label ?? settings.label).slice(0, 72)}…`, ...(declared.tool ? { tools: [declared.tool] } : {}) }, environment: { type: 'none' }, input: prompt.trim() || '…', stream: true };
  // Discovery results only count for the URL they were taken from.
  const discoveredFor = (tool: McpTool | null) => (tool && discovery && !discovery.error && discovery.url === tool.transport.server_url ? discovery.tools : null);

  const sample = samples.find((item) => item.id === sampleId) ?? samples[0];
  const sampleDiscovered = sample.tool?.transport.server_url === docsServerUrl ? recordedDocsTools : null;
  const sampleReport = useMemo(() => buildMcpReport({ tool: sample.tool, discovered: sampleDiscovered, calls: sample.calls, answer: draft, prompt: sample.prompt }), [draft, sample, sampleDiscovered]);
  const sampleVerdict = classifyMcpRun({ tool: sample.tool, calls: sample.calls, answer: draft, turnStatus: 'completed', error: null, discovered: sampleDiscovered, prompt: sample.prompt });

  const selected = runs.find((run) => run.id === selectedId) ?? runs.at(-1) ?? null;
  const selectedReport = useMemo(() => (selected ? buildMcpReport({ tool: selected.tool, discovered: selected.discovered, calls: selected.calls, answer: selected.answer, prompt: selected.prompt }) : null), [selected]);
  const liveReport = useMemo(() => (live ? buildMcpReport({ tool: declared.tool, discovered: discoveredFor(declared.tool), calls: live.calls, answer: live.answer, prompt }) : null), [live, declared, discovery, prompt]);
  const test = mcpTests.find((item) => item.id === testId) ?? mcpTests[0];
  const testResult = suite?.results[test.id] ?? null;
  const passed = suite ? Object.values(suite.results).filter((item) => item.pass).length : 0;

  const patchSettings = (patch: Partial<McpSettings>) => { setPreset(null); setSettings((previous) => ({ ...previous, ...patch })); };
  function choosePreset(chosen: Preset) {
    setPrompt(chosen.text); setPreset(chosen.label); setSettings(chosen.settings);
    setNotice(`Settings changed for this preset: ${chosen.note}`);
  }
  function chooseSample(id: string) {
    const next = samples.find((item) => item.id === id) ?? samples[0];
    setSampleId(next.id); setDraft(next.answer);
  }

  async function discover(): Promise<Discovery | null> {
    if (!declared.tool) return null;
    setDiscovering(true); setError('');
    try {
      const response = await fetch('/api/lab22/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mcp: settings }) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
      const found = parseDiscovery(body);
      setDiscovery(found);
      return found;
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Discovery failed.'); return null; }
    finally { setDiscovering(false); }
  }

  function runInBrowser() {
    setSuiteBusy('browser'); setError('');
    const started = performance.now();
    try {
      const results = runMcpSuite();
      setSuite({ source: 'browser', runtime: 'this browser', durationMs: Math.round(performance.now() - started), results: Object.fromEntries(results.map((item) => [item.id, item])) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The suite crashed.'); }
    finally { setSuiteBusy(null); }
  }
  async function runOnServer() {
    setSuiteBusy('server'); setError('');
    try {
      const response = await fetch('/api/lab22/test', { method: 'POST' });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
      setSuite(parseSuite(body));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not run the suite on the server.'); }
    finally { setSuiteBusy(null); }
  }

  async function runOnce() {
    const question = prompt.trim();
    if (!question || running || blocked) return;
    const id = newId();
    const used = settings;
    const tool = declared.tool;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true); setError(''); setNotice(''); setStatus(''); setItems(null); setLive({ events: [], calls: [], answer: '', timeline: [] });
    try {
      // Discover first (if not done for this URL), so the calls can be compared with the tools the server offers.
      let tools = discoveredFor(tool);
      if (tool && !tools) { setStatus('Discovering the server’s tools first (initialize, tools/list)…'); tools = (await discover())?.tools ?? null; }
      const response = await fetch('/api/lab22/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ prompt: question, mcp: used }) });
      if (!response.ok) {
        const failure = await response.json() as { error?: string; findings?: Finding[] };
        throw new Error([failure.error || `Request failed (${response.status}).`, ...(failure.findings ?? []).filter((item) => item.level === 'error').map((item) => item.text)].join(' '));
      }
      let summary: unknown = null;
      await readLines(response, (line) => {
        if (line.type === 'status' && typeof line.label === 'string') setStatus(line.label);
        if (line.type === 'event' && typeof line.name === 'string') { const name = line.name; setLive((previous) => previous && { ...previous, events: [...previous.events, name] }); }
        if (line.type === 'text' && typeof line.text === 'string') { const answer = line.text; setLive((previous) => previous && { ...previous, answer }); }
        if (line.type === 'call') { const call = parseMcpCall(line.call); setLive((previous) => previous && { ...previous, calls: [...previous.calls.filter((item) => item.id !== call.id), call] }); }
        if (line.type === 'moment' && typeof line.moment === 'object' && line.moment) { const moment = line.moment as Moment; setLive((previous) => previous && { ...previous, timeline: [...previous.timeline, moment] }); }
        if (line.type === 'summary') summary = line.summary;
      });
      if (!summary) throw new Error('The stream ended without a summary.');
      const run: McpRun = { ...parseSummary(summary), id, prompt: question, settings: used, discovered: tools };
      setRuns((previous) => [...previous, run]);
      setSelectedId(id);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error ? caught.message : 'The run failed.');
    } finally {
      if (abort.current === controller) abort.current = null;
      setRunning(false); setLive(null);
    }
  }
  async function readItems(run: McpRun) {
    if (!run.sessionId) return;
    try {
      const response = await fetch(`/api/lab22/items?${new URLSearchParams({ sessionId: run.sessionId })}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      setItems({ runId: run.id, list: Array.isArray(body.items) ? body.items as SavedItem[] : [] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not read the saved items.'); }
  }

  useEffect(() => {
    if (!speechAvailable) return;
    const synthesis = window.speechSynthesis;
    const refresh = () => setVoices(synthesis.getVoices());
    refresh(); synthesis.addEventListener('voiceschanged', refresh);
    return () => synthesis.removeEventListener('voiceschanged', refresh);
  }, [speechAvailable]);
  useEffect(() => () => { abort.current?.abort(); if (speechAvailable) window.speechSynthesis.cancel(); }, [speechAvailable]);
  useEffect(() => { if (!active) stopSpeech(); }, [active]);

  function stopSpeech() { speechRun.current += 1; if (speechAvailable) window.speechSynthesis.cancel(); setSpeaking(null); }
  // Queue one or more explanations; the run counter ignores callbacks from cancelled narrations.
  function speak(queue: Lesson[], speechMode: 'one' | 'all') {
    if (!speechAvailable) return;
    stopSpeech();
    const run = speechRun.current;
    const narrator = selectNarratorVoice(voices.length ? voices : window.speechSynthesis.getVoices());
    queue.forEach((lesson, index) => {
      const utterance = new SpeechSynthesisUtterance(`${speechMode === 'all' ? `Snippet ${Number(lesson.number)}. ` : ''}${lesson.title.replace('mcp_call', 'M C P call').replace('tools/list', 'tools list').replace('agent.tools', 'agent tools')}. ${lesson.explanation}`);
      if (narrator) utterance.voice = narrator;
      utterance.lang = narrator?.lang || 'en-US';
      utterance.pitch = narrator && masculineVoiceName.test(narrator.name) ? 1 : 0.78;
      utterance.rate = 0.95;
      utterance.onstart = () => { if (speechRun.current === run) setSpeaking({ mode: speechMode, lesson: lesson.number }); };
      utterance.onerror = () => { if (speechRun.current === run) setSpeaking(null); };
      if (index === queue.length - 1) utterance.onend = () => { if (speechRun.current === run) setSpeaking(null); };
      window.speechSynthesis.speak(utterance);
    });
    setSpeaking({ mode: speechMode, lesson: queue[0].number });
  }
  function readLesson(lesson: Lesson) { if (speaking?.lesson === lesson.number) stopSpeech(); else speak([lesson], 'one'); }
  function readAll() { if (speaking?.mode === 'all') stopSpeech(); else speak(lessons, 'all'); }

  const currentDiscovery = discovery && declared.tool && discovery.url === declared.tool.transport.server_url ? discovery : null;

  return <div className="lab16-page lab17-page lab18-page lab21-page lab22-page">
    <div className="lab2-hero"><span className="lab2-badge lab22-badge">22/50</span><div><div className="eyebrow">LAB 22 / CONNECT A PUBLIC MCP SERVER</div><h1>Connect an <em>MCP server</em>, and watch what the agent calls.</h1><p>Web search gave the agent the open web. An MCP server gives it someone else’s tools. Declare the OpenAI documentation server in <code>agent.tools</code>; the Agents API connects, <b>discovers its tools</b>, and calls them inside the turn. Your app sees each <code>mcp_call</code>, checks it against what the server offers, and shows whether the answer rests on what the tools returned.</p></div></div>

    <section className="lab7-card"><span className="eyebrow">CONNECT IT</span><h2>Declare the server in <code>agent.tools</code></h2>
      <p>No function to write and no <code>requires_action</code>: OpenAI connects to the server and runs its tools. You choose the label, the URL, and what happens if the server is down.</p>
      <div className="lab21-config">
        <div>
          <fieldset className="lab15-modes lab21-modes lab22-modes"><legend>mcp tool</legend>
            <label className={settings.offered ? 'selected' : ''}><input type="radio" name="lab22-offered" checked={settings.offered} onChange={() => patchSettings({ offered: true })} disabled={running} /><span><strong>Declared</strong><small>In agent.tools.</small></span></label>
            <label className={!settings.offered ? 'selected' : ''}><input type="radio" name="lab22-offered" checked={!settings.offered} onChange={() => patchSettings({ offered: false })} disabled={running} /><span><strong>Left out</strong><small>No tools at all.</small></span></label>
          </fieldset>
          <label htmlFor="lab22-label">server_label <small>names the server in every mcp_call</small></label>
          <input id="lab22-label" className="lab22-input" value={settings.label} onChange={(event) => patchSettings({ label: event.target.value })} disabled={!settings.offered || running} maxLength={100} spellCheck={false} />
          <label htmlFor="lab22-url">transport.server_url <small>type: http · a public https URL</small></label>
          <input id="lab22-url" className="lab22-input" value={settings.serverUrl} onChange={(event) => patchSettings({ serverUrl: event.target.value })} disabled={!settings.offered || running} maxLength={2000} spellCheck={false} />
          <fieldset className="lab15-modes lab21-modes lab22-modes" disabled={!settings.offered || running}><legend>required</legend>
            <label className={!settings.required ? 'selected' : ''}><input type="radio" name="lab22-required" checked={!settings.required} onChange={() => patchSettings({ required: false })} /><span><strong>false</strong><small>API default. The first turn does not wait; a failed connection is skipped.</small></span></label>
            <label className={settings.required ? 'selected' : ''}><input type="radio" name="lab22-required" checked={settings.required} onChange={() => patchSettings({ required: true })} /><span><strong>true</strong><small>The first turn waits for the server, and fails without it.</small></span></label>
          </fieldset>
          <p className="lab8-note"><code>allowed_tools</code> and <code>connection_origin</code> are left out, so every tool is allowed and the connection starts on OpenAI’s network. Lab 23 restricts them.</p>
          <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => setSettings(defaultSettings)} disabled={running}>Use the OpenAI docs server</button></div>
        </div>
        <div>
          <h3 className="lab13-subhead">What the server sends <code>sessions.create</code></h3>
          <pre className="lab19-decl lab21-decl"><code>{json(request)}</code></pre>
          <Findings findings={declared.findings} />
          {blocked ? <p className="lab2-error">Fix the errors above: the server rebuilds this declaration and refuses the same errors.</p> : null}
        </div>
      </div>
    </section>

    <section className="lab7-card" id="lab22-discover"><span className="eyebrow">DISCOVER · NO API KEY NEEDED</span><h2>See the tools the agent will see</h2>
      <p>Before the model sees any tool, the Agents API runs an MCP handshake with the server: <code>initialize</code>, <code>notifications/initialized</code>, then <code>tools/list</code>. It does not stream this to you. This button repeats the same handshake from your server, so you can read each tool’s name, description, and input schema.</p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void discover()} disabled={discovering || running || !declared.tool}>{discovering ? 'Discovering…' : 'Discover tools'}</button></div>
      {!declared.tool ? <p className="lab8-note">{settings.offered ? 'Fix the settings to discover this server.' : 'Declare a server to discover its tools.'}</p> : null}
      {currentDiscovery ? <DiscoveryView discovery={currentDiscovery} /> : declared.tool ? <p className="lab8-note">Not run yet for {declared.tool.transport.server_url}. The probe resolves the host first and refuses private addresses and redirects.</p> : null}
    </section>

    <section className="lab7-card" id="lab22-inspector"><span className="eyebrow">CALL INSPECTOR · NO API KEY NEEDED</span><h2>Read a run the way the page does</h2>
      <p>{samples.length} recorded runs. {samples.filter((item) => item.origin === 'live').length} are shortened from live runs; the others are illustrations written for the course. The checks compare each call with the tools the docs server returned on 2026-09-28. Edit the answer and the report updates as you type.</p>
      <div className="lab16-prompts">{samples.map((item) => <button type="button" key={item.id} className={item.id === sample.id ? 'selected' : ''} onClick={() => chooseSample(item.id)}>{item.label}</button>)}</div>
      <p className="lab16-prompt-line">“{sample.prompt}” <span className="lab15-ids">{sample.tool ? <>mcp <code>{sample.tool.server_label}</code> · <code>{sample.tool.transport.server_url}</code></> : <>mcp <code>left out</code></>} · <span className={'lab22-origin ' + sample.origin}>{sample.origin === 'live' ? 'from a live run' : 'illustration'}</span></span></p>
      <p className="lab8-note">{sample.lesson}</p>
      <label htmlFor="lab22-draft">Answer text <small>Markdown, as the agent returns it</small></label>
      <textarea id="lab22-draft" className="lab21-draft" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />
      <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => setDraft(sample.answer)} disabled={draft === sample.answer}>Restore the recorded answer</button></div>
      <ReportView answer={draft} calls={sample.calls} report={sampleReport} verdict={sampleVerdict} tool={sample.tool} />
    </section>

    <section className="lab7-card" id="lab22-tests"><span className="eyebrow">TEST PAGE · NO API KEY NEEDED</span><h2>{mcpTests.length} cases, one function each</h2><p>Every case runs the real <code>buildMcpTool</code>, <code>parseRpcMessages</code>, <code>parseToolList</code>, <code>reviewTools</code>, <code>parseMcpCall</code>, <code>buildMcpReport</code>, or <code>classifyMcpRun</code>, in this browser or on the server.</p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={runInBrowser} disabled={Boolean(suiteBusy)}>{suiteBusy === 'browser' ? 'Running…' : 'Run all in the browser'}</button><button type="button" className="lab8-secondary" onClick={() => void runOnServer()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'server' ? 'Running…' : 'Run all on the server'}</button></div>
      {suite ? <p className={'lab18-score ' + (passed === mcpTests.length ? 'ok' : 'fail')}><b>{passed}/{mcpTests.length} passed</b> · ran in {suite.runtime} · {suite.durationMs} ms</p> : <p className="lab8-note">Not run yet. Each row states the result it must produce.</p>}
      <div className="lab18-tests">
        <div className="lab9-table-wrap lab18-table lab21-table"><table>
          <thead><tr><th>Case</th><th>Expect</th><th>Got</th><th /></tr></thead>
          {groups.map((group) => <tbody key={group.id}><tr className="lab18-group"><th colSpan={4}>{group.label}</th></tr>{mcpTests.filter((item) => item.group === group.id).map((item) => { const result = suite?.results[item.id]; return <tr key={item.id} className={item.id === test.id ? 'selected' : ''} onClick={() => setTestId(item.id)}>
            <th><button type="button" className="lab15-link" onClick={() => setTestId(item.id)} aria-pressed={item.id === test.id}>{item.label}</button></th>
            <td><span className="lab18-expect">{item.expect}</span></td><td>{result ? <span className="lab18-expect">{result.got}</span> : '—'}</td>
            <td>{result ? <span className={'lab18-pass ' + (result.pass ? 'ok' : 'fail')}>{result.pass ? 'PASS' : 'FAIL'}</span> : null}</td></tr>; })}</tbody>)}
        </table></div>
        <div className="lab18-detail lab21-detail">
          <h3 className="lab13-subhead">{test.label} <code>expect {test.expect}</code></h3>
          <p className="lab8-note">{test.note}</p>
          {testResult ? <pre className="lab19-scroll lab21-detail-pre"><code>{testResult.detail}</code></pre> : <p className="lab8-note">Run the suite to see what this case produced.</p>}
        </div>
      </div>
    </section>

    <section className="lab7-card"><span className="eyebrow">LIVE RUN</span><h2>Ask the documentation assistant</h2>
      <div className="lab16-prompts">{presets.map((item) => <button type="button" key={item.label} className={preset === item.label ? 'selected' : ''} onClick={() => choosePreset(item)} disabled={running}>{item.label}</button>)}</div>
      <label htmlFor="lab22-prompt">Your question</label>
      <textarea id="lab22-prompt" value={prompt} maxLength={2000} onChange={(event) => { setPrompt(event.target.value); setPreset(null); }} disabled={running} />
      <p className="lab15-ids">mcp <code>{settingsLabel(settings)}</code> · change it in <a href="#lab22" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Connect it</a></p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void runOnce()} disabled={running || !health?.configured || !prompt.trim() || blocked}>{running ? 'Running…' : 'Ask the agent'}</button>{running ? <button type="button" className="lab8-secondary" onClick={() => abort.current?.abort()}>Stop reading</button> : null}</div>
      {!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env and restart the server for a live run. Discovery, the inspector, and the test page work without a key.</p> : <p className="lab8-note">The page discovers the server’s tools before asking, so it can check each call. A run with a few calls takes 10–30 seconds.</p>}
      {status ? <p className="lab7-session-id">{status}</p> : null}
      {live ? <div className="lab16-live lab21-live">
        <Timeline moments={live.timeline} />
        {live.calls.length ? <CallLog calls={live.calls} /> : null}
        {live.answer && liveReport ? <GroundedAnswer answer={live.answer} pages={liveReport.pages} /> : null}
      </div> : null}
      {notice ? <p className="lab20-notice" role="status">{notice}</p> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    <section className="lab7-card"><span className="eyebrow">RESULT</span><h2>{selected ? `Run #${runs.indexOf(selected) + 1}` : 'No run yet'}</h2>
      {selected && selectedReport ? <>
        <p className="lab16-prompt-line">“{selected.prompt}”</p>
        <p className="lab15-ids">mcp <code>{settingsLabel(selected.settings)}</code>{selected.sessionId ? <> · session <code>{shortId(selected.sessionId)}</code></> : null} · turn <code>{selected.turnStatus}</code> · first call <b>{seconds(selected.firstCallMs)}</b> · first text <b>{seconds(selected.firstTextMs)}</b> · total <b>{seconds(selected.durationMs)}</b>{selected.tool && !selected.discovered ? <> · <em>not discovered: call checks skipped</em></> : null}</p>
        <ReportView answer={selected.answer} calls={selected.calls} report={selectedReport} verdict={classifyMcpRun(selected)} tool={selected.tool} />
        {selected.error ? <p className="lab2-error" role="alert">{selected.error}</p> : null}
        <details className="lab16-preview"><summary>Timeline, item types, and the tool that was sent <small>{selected.timeline.length} moments</small></summary><Timeline moments={selected.timeline} />
          <p className="lab8-note">Item types in the stream: {selected.itemTypes.length ? selected.itemTypes.map((type) => <code key={type} className="lab22-type">{type}</code>) : 'none'}. There is no item for tools/list: discovery happens before the turn and is not streamed.</p>
          <pre className="lab19-decl"><code>{json({ tools: selected.tool ? [selected.tool] : [] })}</code></pre><p className="lab8-note">{selected.events.length} events</p></details>
        <div className="lab8-actions">{selected.sessionId ? <button type="button" className="lab8-secondary" onClick={() => void readItems(selected)} disabled={running}>Read the saved items</button> : null}</div>
        {items && items.runId === selected.id ? <div className="lab16-saved"><h3 className="lab13-subhead">Saved items <code>sessions.items.list</code></h3>{items.list.length ? <ol className="lab17-items">{items.list.map((item, index) => <li key={item.id ?? index} className={item.type}>
          <div><code className="lab17-item-type">{item.type}</code>{item.role ? <span className="lab17-role">{item.role}</span> : null}{item.status ? <span className="lab15-ids">{item.status}</span> : null}</div>
          {item.call ? <p><b>{item.call}</b></p> : null}
          {item.text ? <p>{item.text.length > 400 ? `${item.text.slice(0, 400)}…` : item.text}</p> : null}
        </li>)}</ol> : <p className="lab8-note">No items yet.</p>}</div> : null}
      </> : <p className="lab8-note">Ask <em>Ask the docs</em> with the server declared, then <em>The same, server left out</em>. Compare the calls, the links, and what each answer admits it does not know.</p>}
    </section>

    <section className="lab7-card"><span className="eyebrow">RUN HISTORY</span><h2>Compare runs</h2>
      {runs.length ? <div className="lab9-table-wrap lab15-history lab16-history"><table>
        <thead><tr><th>Run</th><th>Question</th><th>mcp</th><th>Calls</th><th>Pages</th><th>Time</th><th>Verdict</th></tr></thead>
        <tbody>{runs.map((run, index) => { const verdict = classifyMcpRun(run); const report = buildMcpReport({ tool: run.tool, discovered: run.discovered, calls: run.calls, answer: run.answer, prompt: run.prompt }); return <tr key={run.id} className={run.id === selected?.id ? 'selected' : ''} onClick={() => { setSelectedId(run.id); setItems(null); }}>
          <th><button type="button" className="lab15-link" onClick={() => { setSelectedId(run.id); setItems(null); }} aria-pressed={run.id === selected?.id}>#{index + 1}</button></th>
          <td className="lab16-q">{run.prompt}</td><td><code>{settingsLabel(run.settings)}</code></td><td>{report.toolCalls.length}</td><td>{report.pages.length}</td><td>{seconds(run.durationMs)}</td><td><span className={'lab16-tone lab22-tone ' + verdict.tone}>{verdict.title}</span></td></tr>; })}</tbody>
      </table></div> : <p className="lab8-note">No runs yet. Run one question with the server declared and left out, and one with an unreachable server.</p>}
    </section>

    <section className="lab3-guide lab16-guide"><h2>Read the evidence</h2><div><article><strong>Declare</strong><p>An <code>mcp</code> entry in <code>agent.tools</code>: a label, an https URL, and <code>required</code>.</p></article><article><strong>Discover</strong><p><code>tools/list</code> decides what the agent can call. It is not streamed: probe it yourself.</p></article><article><strong>Call</strong><p>Each <code>mcp_call</code> shows the tool, the arguments, and the result. A failed <code>initialize</code> means the server was skipped.</p></article><article><strong>Ground</strong><p>Every link should appear in a tool result. Then read the page: grounded is not the same as correct.</p></article></div><p className="lab3-guide-note">An MCP server is someone else’s code answering inside your agent’s turn. Its tool list, descriptions, and results are input to check, not instructions to trust.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 22</span><span className="code-lessons-title" role="heading" aria-level={2}>The code that connects an MCP server</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Declare the server, validate the connection, repeat the discovery handshake, watch the calls, read their results, and check that the answer rests on them. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, (lesson.file.endsWith('.tsx') ? Prism.languages.tsx : Prism.languages.typescript) || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Run the test page on the server and show <em>{mcpTests.length}/{mcpTests.length} passed</em>. Discover the docs server and name the two tools you would allow in Lab 23. In the inspector, open <em>Right server, wrong API</em> and explain why the verdict is not <em>Grounded</em>. Live, ask <em>Ask the docs</em> with the server declared, then left out, and compare the calls and links. Run <em>The same, not required</em> twice and explain why the server may not be used. Then run <em>Unreachable, optional</em> and <em>Unreachable, required</em>, and explain the difference in one sentence.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/tools/mcp" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
