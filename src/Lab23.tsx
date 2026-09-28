import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import { AnswerPre } from './Lab6.tsx';
import { CallLog, Findings, codeTokens, readLines } from './Lab22.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { shortId } from './lab13Recovery.ts';
import { checkUrl } from './lab21Search.ts';
import { hasErrors, parseDiscovery, parseMcpCall, type DiscoveredTool, type Discovery, type McpCall } from './lab22Mcp.ts';
import { recordedDocsTools } from './lab22Scenarios.ts';
import {
  allowInstructions, allowedOf, buildMatrix, buildRestrictedTool, defaultAllowSettings, judgeProbe, parseProbeRun, parseRestrictedTool, probes, summarizeTest, visibleTools,
  type AllowSettings, type AllowVerdict, type MatrixCell, type MatrixRow, type Origin, type ProbeRun, type RestrictedTool,
} from './lab23Allow.ts';
import { samples } from './lab23Scenarios.ts';
import { allowTests, runAllowSuite, type TestGroup, type TestResult } from './lab23Tests.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Suite = { source: 'browser' | 'server'; runtime: string; durationMs: number; results: Record<string, TestResult> };
type SavedItem = { id: string | null; type: string; role: string | null; text: string | null; status: string | null; call: string | null };
type LiveProbe = { state: 'waiting' | 'running' | 'done'; sessionId: string | null; calls: McpCall[]; answer: string };
type AllowRun = { id: string; settings: AllowSettings; tool: RestrictedTool; runs: ProbeRun[]; toolNames: string[]; durationMs: number | null; skipped: boolean };

const lessons: Lesson[] = [
  { number: '01', title: 'Choose where the connection starts', file: 'src/lab23Allow.ts', code: "const tool = {\n  type: 'mcp',\n  server_label: 'openai_docs',\n  transport: { type: 'http', server_url: 'https://developers.openai.com/mcp' },\n  required: true,\n  connection_origin: 'service',   // OpenAI's network: a public server, no environment\n  // connection_origin: 'environment' → from the session's environment (Lab 33)\n};\n\n// environment: { type: 'none' } + 'environment' →\n// 400 mcp tool connection_origin=environment requires a session environment", explanation: 'Connection origin decides where the M C P connection starts. Service, the default, starts it on OpenAI’s network. The server must be public, and no environment is needed. Environment starts it inside the session’s environment, so it can reach a server that only that environment can see. This lab’s sessions have no environment, and in a live run the API refused an environment origin with a four hundred error before any session existed. So the app writes service explicitly, even though it is the default. The request then says where the connection starts, and a reviewer does not have to remember the default.' },
  { number: '02', title: 'Write the allowlist with exact names', file: 'server/lab23.ts', code: "const tool = {\n  ...docsServer,\n  connection_origin: 'service',\n  allowed_tools: ['search_openai_docs', 'fetch_openai_doc'],\n};\n// left out or null → every tool, including tools the server adds later\n// []             → no server tools (accepted, silently)\n// ['search_docs'] or ['Search_OpenAI_Docs'] → matches nothing (accepted, silently)", explanation: 'Allowed tools limits which of the server’s tools the agent can discover and call. Leaving it out allows everything the server lists, today and tomorrow. If the server adds a delete tool next week, your agent gets it without any change on your side. So list exactly what the task needs. For a find and quote assistant, that is search and fetch. Be careful with the names. In live runs the API accepted an empty list, a name that does not exist, and the right name in the wrong case, all without an error. In each case the agent simply had no server tools, and nothing in the stream said why.' },
  { number: '03', title: 'Check the names against tools/list before sending', file: 'src/lab23Allow.ts', code: "export function checkAllowlist(raw, discovered) {\n  const allowed = unique(raw.map(trim).filter(Boolean));\n  if (!allowed.length) → warn: allows no server tools\n  const unknown = allowed.filter((name) => !names.has(name));\n  caseOnly  → error: “Search_OpenAI_Docs”… did you mean “search_openai_docs”?\n  unknown   → error: not in tools/list, the API would allow nothing\n  destructive / not readOnly → warn\n}\n// server: const discovery = await toolsFor(url);   // cached 5 min\n//         buildRestrictedTool(settings, discovery.tools)  → 400 on any error", explanation: 'Because the API accepts a wrong name silently, the app does the check itself. Before every run, the server gets the tools list, from a five minute cache, and compares each allowed name with it, exactly and case sensitively. A name that only differs in case gets a did you mean hint. A name that matches nothing is an error, and the server answers four hundred instead of starting a session that cannot work. Allowing a tool that says it is destructive, or does not say it is read only, gets a warning. A send anyway switch lets you skip these checks on purpose to watch what the API does.' },
  { number: '04', title: 'What the agent can see', file: 'src/lab23Allow.ts', code: "export function visibleTools(discovered, allowed) {\n  if (!allowed) return { allowed: discovered, hidden: [], unmatched: [] };\n  return {\n    allowed:   discovered.filter((tool) => allowed.includes(tool.name)),\n    hidden:    discovered.filter((tool) => !allowed.includes(tool.name)),\n    unmatched: allowed.filter((name) => !discovered.some((t) => t.name === name)),\n  };\n}\n// Not covered by allowed_tools: list_mcp_resources, list_mcp_resource_templates, read_mcp_resource", explanation: 'A hidden tool is not refused when the agent calls it. It is never discovered, so the model does not know it exists, and no call item ever appears for it. Three helpers stay available whatever the list says: list M C P resources, list resource templates, and read M C P resource. The API adds them, and allowed tools does not cover them. And do not ask the model what it can call. In two live runs with search allowed, the agent said it had no tools at all. In another run with the same list, it called search when a task needed it. What the model says about its tools is not evidence.' },
  { number: '05', title: 'Probe each tool in its own session', file: 'server/lab23.ts', code: "const jobs = chosen.map((probe) => ({ probeId: probe.id, prompt: probe.prompt, target: probe.target }));\nconst runs = await Promise.all(jobs.map((job) => runProbe(api, response, agent, tool, job, streams)));\n\n// inside runProbe, for every mcp_call item:\nif (!isAllowedCall(call, allowed) && !run.stopped) {\n  run.stopped = true;   // the API should never let this happen\n  await api.beta.agents.sessions.events.create(sessionId,\n    { events: [{ type: 'agent.session.input.cancel' }] });\n}", explanation: 'The allowlist test asks five questions, and each one needs a different tool: search, fetch, browse the index, list endpoints, and read an OpenAPI spec. Every probe runs in its own new session with the same declaration and the same instructions, so the allowlist is the only thing that changes. They run in parallel, so the whole test takes about as long as the slowest probe. While a probe runs, the server checks every call item against the list. The API enforces the list, but the app checks anyway. A call outside it would cancel the turn and be kept as evidence.' },
  { number: '06', title: 'Judge the evidence: can, cannot, and gaps', file: 'src/lab23Allow.ts', code: "export function judgeProbe(run, allowed) {\n  breaches.length           → 'breach'   // a hidden tool was called\n  run.turnStatus !== 'completed' → 'failed'\n  target allowed, called     → 'used'     // can call\n  target allowed, not called → 'unused'   // proves nothing: run it again\n  target hidden, not called  → 'blocked'  // cannot call\n}\nsummarizeTest(runs, allowed)  // held · gaps · breach · failed", explanation: 'Each probe gets one outcome, based only on the call items. If the target tool is allowed and was called, the agent can call it. If it is hidden and was not called, the agent cannot. If it is allowed but was not called, that proves nothing, so run it again. A failed probe also proves nothing. The page puts the probes in a matrix, one row per probe and one column per tool, so you can see at a glance what was called, what was allowed, and what was hidden. Then read the answers too. A list that holds can still be too narrow. With search only, the agent could not open pages to check them, and it returned the wrong API’s guide.' },
];

type Policy = { label: string; patch: Partial<AllowSettings>; note: string };
const policies: Policy[] = [
  { label: 'Find and quote a page', patch: { restrict: true, allowed: ['search_openai_docs', 'fetch_openai_doc'], origin: 'service' }, note: 'Search and fetch. The default.' },
  { label: 'Endpoints only', patch: { restrict: true, allowed: ['list_api_endpoints', 'get_openapi_spec'], origin: 'service' }, note: 'The API reference tools, no guide pages.' },
  { label: 'Search only', patch: { restrict: true, allowed: ['search_openai_docs'], origin: 'service' }, note: 'Too narrow: it cannot open what it finds.' },
  { label: 'Everything', patch: { restrict: false, origin: 'service' }, note: 'allowed_tools left out.' },
  { label: 'Nothing', patch: { restrict: true, allowed: [], origin: 'service' }, note: 'allowed_tools: [].' },
  { label: 'A typo', patch: { restrict: true, allowed: ['search_docs'], origin: 'service' }, note: 'Not in tools/list.' },
  { label: 'Wrong case', patch: { restrict: true, allowed: ['Search_OpenAI_Docs'], origin: 'service' }, note: 'Names are case-sensitive.' },
  { label: 'Environment origin', patch: { restrict: true, allowed: ['search_openai_docs', 'fetch_openai_doc'], origin: 'environment' }, note: 'No environment in this session.' },
];

const groups: Array<{ id: TestGroup; label: string }> = [
  { id: 'declare', label: 'Declare the origin and the allowlist' },
  { id: 'visible', label: 'What the agent can see' },
  { id: 'probe', label: 'Judge the probes' },
];

const cellMark: Record<MatrixCell, { glyph: string; label: string }> = {
  called: { glyph: '●', label: 'allowed and called' },
  allowed: { glyph: '○', label: 'allowed, not called' },
  hidden: { glyph: '—', label: 'hidden' },
  breach: { glyph: '✕', label: 'hidden, yet called' },
};
const outcomeTone: Record<string, string> = { used: 'can', blocked: 'cannot', unused: 'gap', breach: 'breach', failed: 'failed', open: 'open' };

const json = (value: unknown) => codeTokens(Prism.tokenize(JSON.stringify(value, null, 2) ?? 'undefined', Prism.languages.json || Prism.languages.javascript));
const newId = (): string => `test_${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)}`;
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const policyLabel = (settings: AllowSettings) => {
  const allowed = allowedOf(settings);
  return `${settings.origin} · ${allowed === null ? 'all tools' : allowed.length ? allowed.join(', ') : '[]'}`;
};
const probeLabel = (probeId: string) => probes.find((probe) => probe.id === probeId)?.label ?? 'Your question';

function SafeAnswer({ answer }: { answer: string }) {
  return <div className="lab7-answer lab16-answer lab21-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    pre: AnswerPre,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const check = checkUrl(href ?? '');
      return check.href ? <a href={check.href} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span className="lab21-dead" title="Not a web link: shown as text">{children}</span>;
    },
  }}>{answer}</ReactMarkdown></div>;
}

// One checkbox per discovered tool, plus any typed name that matches none of them.
function ToolPicker({ tools, settings, onToggle, disabled }: { tools: DiscoveredTool[]; settings: AllowSettings; onToggle: (name: string) => void; disabled: boolean }) {
  const extra = settings.allowed.filter((name) => name.trim() && !tools.some((tool) => tool.name === name));
  return <div className="lab23-picker">
    {tools.map((tool) => {
      const on = settings.restrict && settings.allowed.includes(tool.name);
      return <label key={tool.name} className={'lab23-pick' + (on || !settings.restrict ? ' on' : '')}>
        <input type="checkbox" checked={!settings.restrict || on} onChange={() => onToggle(tool.name)} disabled={disabled || !settings.restrict} />
        <span><code>{tool.name}</code><small>{tool.readOnly === true ? 'readOnlyHint' : 'not marked read-only'}{tool.destructive ? ' · destructive' : ''}</small></span>
      </label>;
    })}
    {settings.restrict ? extra.map((name) => <label key={name} className="lab23-pick on unknown">
      <input type="checkbox" checked onChange={() => onToggle(name)} disabled={disabled} />
      <span><code>{name}</code><small>not in tools/list</small></span>
    </label>) : null}
  </div>;
}

function VisibilityView({ tools, allowed }: { tools: DiscoveredTool[]; allowed: string[] | null }) {
  const view = visibleTools(tools, allowed);
  return <div className="lab23-visibility">
    <div className="lab23-column allowed"><h3 className="lab13-subhead">Can discover and call <code>{view.allowed.length}</code></h3>
      {view.allowed.length ? <ul>{view.allowed.map((tool) => <li key={tool.name}><code>{tool.name}</code><small>{tool.title ?? ''}</small></li>)}</ul> : <p className="lab8-note">No server tool.</p>}</div>
    <div className="lab23-column hidden"><h3 className="lab13-subhead">Hidden: never discovered <code>{view.hidden.length}</code></h3>
      {view.hidden.length ? <ul>{view.hidden.map((tool) => <li key={tool.name}><code>{tool.name}</code><small>{tool.title ?? ''}</small></li>)}</ul> : <p className="lab8-note">Nothing hidden.</p>}</div>
    <div className="lab23-column unmatched"><h3 className="lab13-subhead">Names that match nothing <code>{view.unmatched.length}</code></h3>
      {view.unmatched.length ? <ul>{view.unmatched.map((name) => <li key={name}><code>{name}</code><small>allows nothing</small></li>)}</ul> : <p className="lab8-note">None.</p>}</div>
    <div className="lab23-column helpers"><h3 className="lab13-subhead">Always there <code>API helpers</code></h3>
      <ul><li><code>list_mcp_resources</code></li><li><code>list_mcp_resource_templates</code></li><li><code>read_mcp_resource</code></li></ul>
      <p className="lab8-note">Added by the Agents API. allowed_tools does not cover them.</p></div>
  </div>;
}

function Matrix({ rows, toolNames, selected, onSelect }: { rows: MatrixRow[]; toolNames: string[]; selected?: string | null; onSelect?: (probeId: string) => void }) {
  return <div className="lab9-table-wrap lab23-matrix"><table>
    <thead><tr><th>Probe</th><th>Needs</th>{toolNames.map((name) => <th key={name} className="lab23-toolhead"><code>{name.replace(/_/g, '_​')}</code></th>)}<th>Outcome</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.probeId} className={row.probeId === selected ? 'selected' : ''} onClick={() => onSelect?.(row.probeId)}>
      <th>{onSelect ? <button type="button" className="lab15-link" onClick={() => onSelect(row.probeId)} aria-pressed={row.probeId === selected}>{row.label}</button> : row.label}</th>
      <td>{row.target ? <code>{row.target}</code> : '—'}</td>
      {toolNames.map((name) => { const cell = row.cells[name]; return <td key={name} className={'lab23-cell ' + cell + (row.target === name ? ' target' : '')} title={`${name}: ${cellMark[cell].label}`}><span aria-label={cellMark[cell].label}>{cellMark[cell].glyph}</span></td>; })}
      <td><span className={'lab23-outcome ' + outcomeTone[row.judgement.outcome]}>{row.judgement.title}</span></td>
    </tr>)}</tbody>
  </table>
    <p className="lab23-legend">{(Object.keys(cellMark) as MatrixCell[]).map((cell) => <span key={cell} className={'lab23-cell ' + cell}><b>{cellMark[cell].glyph}</b> {cellMark[cell].label}</span>)} · outlined: the tool the probe needs</p>
  </div>;
}

function VerdictBox({ verdict }: { verdict: AllowVerdict }) {
  return <div className={'lab16-verdict lab23-verdict ' + verdict.tone}><strong>{verdict.title}</strong><p>{verdict.text}</p></div>;
}

function ProbeDetail({ run, allowed }: { run: ProbeRun; allowed: string[] | null }) {
  const judgement = judgeProbe(run, allowed);
  return <div className="lab23-probe-detail">
    <p className="lab16-prompt-line">“{run.prompt}”</p>
    <p className="lab15-ids">{run.target ? <>needs <code>{run.target}</code> · expected <b>{judgement.expected === 'can' ? 'can call' : 'cannot call'}</b> · </> : null}turn <code>{run.turnStatus}</code>{run.sessionId ? <> · session <code>{shortId(run.sessionId)}</code></> : null} · {seconds(run.durationMs)}</p>
    <div className={'lab23-judgement ' + outcomeTone[judgement.outcome]}><strong>{judgement.title}</strong><span>{judgement.detail}</span></div>
    <div className="lab21-report-grid">
      <div><h3 className="lab13-subhead">Answer</h3>{run.answer ? <SafeAnswer answer={run.answer} /> : <p className="lab8-note">No answer text.</p>}
        {run.error ? <p className="lab2-error" role="alert">{run.error}</p> : null}</div>
      <div><h3 className="lab13-subhead">Call log <code>mcp_call</code></h3><CallLog calls={run.calls} /></div>
    </div>
  </div>;
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

export default function Lab23({ active, health }: { active: boolean; health: Health }) {
  const [settings, setSettings] = useState<AllowSettings>(defaultAllowSettings);
  const [policy, setPolicy] = useState<string | null>(policies[0].label);
  const [extraName, setExtraName] = useState('');
  const [skipChecks, setSkipChecks] = useState(false);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [sampleId, setSampleId] = useState(samples[0].id);
  const [sampleSettings, setSampleSettings] = useState<AllowSettings>(samples[0].settings);
  const [suite, setSuite] = useState<Suite | null>(null);
  const [suiteBusy, setSuiteBusy] = useState<'browser' | 'server' | null>(null);
  const [testId, setTestId] = useState(allowTests[0].id);
  const [chosen, setChosen] = useState<string[]>(probes.map((probe) => probe.id));
  const [question, setQuestion] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [live, setLive] = useState<Record<string, LiveProbe> | null>(null);
  const [tests, setTests] = useState<AllowRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [probeId, setProbeId] = useState<string | null>(null);
  const [items, setItems] = useState<{ key: string; list: SavedItem[] } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const abort = useRef<AbortController | null>(null);
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  // Discovery counts only for the URL it was taken from. Before discovery the picker shows the recorded list.
  const discovered = discovery && !discovery.error && discovery.url === settings.serverUrl.trim() ? discovery.tools : null;
  const pickerTools = discovered ?? recordedDocsTools;
  const declared = useMemo(() => buildRestrictedTool(settings, discovered), [settings, discovered]);
  const blocked = hasErrors(declared.findings);
  const allowedNow = allowedOf(settings);
  const today = new Date().toISOString().slice(0, 10);
  const shownTool = declared.tool ?? (skipChecks ? { type: 'mcp', server_label: settings.label, transport: { type: 'http', server_url: settings.serverUrl }, required: settings.required, connection_origin: settings.origin, ...(allowedNow ? { allowed_tools: allowedNow } : {}) } : null);
  const request = { agent: { model: health?.model ?? 'your-model', instructions: `${allowInstructions(today, settings.label).slice(0, 72)}…`, tools: shownTool ? [shownTool] : [] }, environment: { type: 'none' }, input: '<one probe question per session>', stream: true };

  const sample = samples.find((item) => item.id === sampleId) ?? samples[0];
  const sampleAllowed = allowedOf(sampleSettings);
  const sampleDeclared = useMemo(() => buildRestrictedTool(sampleSettings, recordedDocsTools), [sampleSettings]);
  const sampleRows = useMemo(() => buildMatrix([sample.run], sampleAllowed, recordedDocsTools.map((tool) => tool.name)), [sample, sampleAllowed]);
  const sampleEdited = JSON.stringify(sampleSettings) !== JSON.stringify(sample.settings);

  const selected = tests.find((item) => item.id === selectedId) ?? tests.at(-1) ?? null;
  const selectedAllowed = selected ? selected.tool.allowed_tools ?? null : null;
  const selectedRows = useMemo(() => (selected ? buildMatrix(selected.runs, selectedAllowed, selected.toolNames) : []), [selected, selectedAllowed]);
  const selectedProbe = selected ? selected.runs.find((run) => run.probeId === probeId) ?? selected.runs[0] : null;
  const test = allowTests.find((item) => item.id === testId) ?? allowTests[0];
  const testResult = suite?.results[test.id] ?? null;
  const passed = suite ? Object.values(suite.results).filter((item) => item.pass).length : 0;

  const patchSettings = (patch: Partial<AllowSettings>) => { setPolicy(null); setSettings((previous) => ({ ...previous, ...patch })); };
  function choosePolicy(chosenPolicy: Policy) {
    setPolicy(chosenPolicy.label);
    setSettings((previous) => ({ ...previous, ...chosenPolicy.patch }));
  }
  function toggle(name: string) {
    patchSettings({ allowed: settings.allowed.includes(name) ? settings.allowed.filter((item) => item !== name) : [...settings.allowed, name] });
  }
  function addName() {
    const name = extraName.trim();
    if (!name) return;
    if (!settings.allowed.includes(name)) patchSettings({ allowed: [...settings.allowed, name], restrict: true });
    setExtraName('');
  }
  function chooseSample(id: string) {
    const next = samples.find((item) => item.id === id) ?? samples[0];
    setSampleId(next.id); setSampleSettings(next.settings);
  }
  function toggleSample(name: string) {
    setSampleSettings((previous) => ({ ...previous, restrict: true, allowed: previous.allowed.includes(name) ? previous.allowed.filter((item) => item !== name) : [...previous.allowed, name] }));
  }

  // quiet: the automatic discovery on first open keeps the recorded list and shows no error if the server is down.
  async function discover(fresh = true, quiet = false) {
    setDiscovering(true); if (!quiet) setError('');
    try {
      const response = await fetch('/api/lab23/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mcp: settings, fresh }) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
      setDiscovery(parseDiscovery(body));
    } catch (caught) { if (!quiet) setError(caught instanceof Error ? caught.message : 'Discovery failed.'); }
    finally { setDiscovering(false); }
  }

  function runInBrowser() {
    setSuiteBusy('browser'); setError('');
    const started = performance.now();
    try {
      const results = runAllowSuite();
      setSuite({ source: 'browser', runtime: 'this browser', durationMs: Math.round(performance.now() - started), results: Object.fromEntries(results.map((item) => [item.id, item])) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The suite crashed.'); }
    finally { setSuiteBusy(null); }
  }
  async function runOnServer() {
    setSuiteBusy('server'); setError('');
    try {
      const response = await fetch('/api/lab23/test', { method: 'POST' });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
      setSuite(parseSuite(body));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not run the suite on the server.'); }
    finally { setSuiteBusy(null); }
  }

  async function runTest() {
    const custom = question.trim();
    const jobs = [...probes.filter((probe) => chosen.includes(probe.id)).map((probe) => probe.id), ...(custom ? ['custom'] : [])];
    if (!jobs.length || running || (blocked && !skipChecks)) return;
    const id = newId();
    const used = settings;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true); setError(''); setNotice(''); setItems(null);
    setStatus('Checking the allowlist against tools/list, then starting one session per probe…');
    setLive(Object.fromEntries(jobs.map((job) => [job, { state: 'waiting', sessionId: null, calls: [], answer: '' } satisfies LiveProbe])));
    const patchLive = (key: string, patch: (probe: LiveProbe) => Partial<LiveProbe>) => setLive((previous) => (previous && previous[key] ? { ...previous, [key]: { ...previous[key], ...patch(previous[key]) } } : previous));
    try {
      const response = await fetch('/api/lab23/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ mcp: used, probes: jobs.filter((job) => job !== 'custom'), prompt: custom, skipChecks }) });
      if (!response.ok) {
        const failure = await response.json() as { error?: string; findings?: Array<{ level: string; text: string }> };
        throw new Error([failure.error || `Request failed (${response.status}).`, ...(failure.findings ?? []).filter((item) => item.level === 'error').map((item) => item.text)].join(' '));
      }
      let summary: { tool: unknown; runs: unknown; durationMs: unknown } | null = null;
      let toolNames: string[] = pickerTools.map((tool) => tool.name);
      let skipped = false;
      await readLines(response, (line) => {
        const key = typeof line.probeId === 'string' ? line.probeId : '';
        if (line.type === 'declared') {
          if (Array.isArray(line.discovered)) toolNames = line.discovered.filter((name): name is string => typeof name === 'string');
          skipped = line.skipped === true;
          setStatus(`Sent ${skipped ? 'without the app’s checks' : 'after checking every name against tools/list'}. ${jobs.length} session${jobs.length === 1 ? '' : 's'} running in parallel…`);
        }
        if (line.type === 'probe') patchLive(key, () => ({ state: 'running', ...(typeof line.sessionId === 'string' ? { sessionId: line.sessionId } : {}) }));
        if (line.type === 'call') { const call = parseMcpCall(line.call); patchLive(key, (probe) => ({ calls: [...probe.calls.filter((item) => item.id !== call.id), call] })); }
        if (line.type === 'text' && typeof line.text === 'string') { const text = line.text; patchLive(key, () => ({ answer: text })); }
        if (line.type === 'done') patchLive(key, () => ({ state: 'done' }));
        if (line.type === 'summary') summary = line as typeof summary;
      });
      const final = summary as { tool: unknown; runs: unknown; durationMs: unknown } | null;
      if (!final || !Array.isArray(final.runs)) throw new Error('The stream ended without a summary.');
      const result: AllowRun = { id, settings: used, tool: parseRestrictedTool(final.tool), runs: final.runs.map(parseProbeRun), toolNames, durationMs: typeof final.durationMs === 'number' ? final.durationMs : null, skipped };
      setTests((previous) => [...previous, result]);
      setSelectedId(id); setProbeId(result.runs[0]?.probeId ?? null);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error ? caught.message : 'The test failed.');
    } finally {
      if (abort.current === controller) abort.current = null;
      setRunning(false); setLive(null); setStatus('');
    }
  }
  async function readItems(run: ProbeRun, key: string) {
    if (!run.sessionId) return;
    try {
      const response = await fetch(`/api/lab23/items?${new URLSearchParams({ sessionId: run.sessionId })}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      setItems({ key, list: Array.isArray(body.items) ? body.items as SavedItem[] : [] });
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
  // Discover once, the first time the lab is opened (every lab is mounted at start-up), so the names are checked
  // against today's tools/list without a click. The server caches it for five minutes.
  const autoDiscovered = useRef(false);
  useEffect(() => { if (active && !autoDiscovered.current) { autoDiscovered.current = true; void discover(false, true); } }, [active]);

  function stopSpeech() { speechRun.current += 1; if (speechAvailable) window.speechSynthesis.cancel(); setSpeaking(null); }
  // Queue one or more explanations; the run counter ignores callbacks from cancelled narrations.
  function speak(queue: Lesson[], speechMode: 'one' | 'all') {
    if (!speechAvailable) return;
    stopSpeech();
    const run = speechRun.current;
    const narrator = selectNarratorVoice(voices.length ? voices : window.speechSynthesis.getVoices());
    queue.forEach((lesson, index) => {
      const utterance = new SpeechSynthesisUtterance(`${speechMode === 'all' ? `Snippet ${Number(lesson.number)}. ` : ''}${lesson.title.replace('tools/list', 'tools list')}. ${lesson.explanation}`);
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

  const jobCount = chosen.length + (question.trim() ? 1 : 0);

  return <div className="lab16-page lab17-page lab18-page lab21-page lab22-page lab23-page">
    <div className="lab2-hero"><span className="lab2-badge lab23-badge">23/50</span><div><div className="eyebrow">LAB 23 / RESTRICT MCP TOOLS</div><h1>Give the agent <em>only the tools</em> its task needs.</h1><p>In Lab 22 the agent could call every tool the docs server offered. Two fields change that. <code>connection_origin</code> chooses where the connection starts, and <code>allowed_tools</code> chooses which tools the agent can <b>discover and call</b>. Then you prove the list works: one probe per tool, and a matrix of what the agent could and could not call.</p></div></div>

    <section className="lab7-card"><span className="eyebrow">ORIGIN AND ALLOWLIST</span><h2>Declare what the agent may reach</h2>
      <p>The same docs server as Lab 22, with two more fields. The server rebuilds this declaration, checks every name against <code>tools/list</code>, and refuses a list the API would accept but that cannot work.</p>
      <div className="lab16-prompts">{policies.map((item) => <button type="button" key={item.label} className={policy === item.label ? 'selected' : ''} onClick={() => choosePolicy(item)} disabled={running} title={item.note}>{item.label}</button>)}</div>
      <div className="lab21-config">
        <div>
          <fieldset className="lab15-modes lab21-modes lab22-modes" disabled={running}><legend>connection_origin</legend>
            {(['service', 'environment'] as Origin[]).map((origin) => <label key={origin} className={settings.origin === origin ? 'selected' : ''}><input type="radio" name="lab23-origin" checked={settings.origin === origin} onChange={() => patchSettings({ origin })} /><span><strong>{origin}</strong><small>{origin === 'service' ? 'OpenAI’s network. Public servers. No environment needed.' : 'The session’s environment. This session has none.'}</small></span></label>)}
          </fieldset>
          <fieldset className="lab15-modes lab21-modes lab22-modes" disabled={running}><legend>allowed_tools</legend>
            <label className={!settings.restrict ? 'selected' : ''}><input type="radio" name="lab23-restrict" checked={!settings.restrict} onChange={() => patchSettings({ restrict: false })} /><span><strong>Left out</strong><small>Every tool, now and later.</small></span></label>
            <label className={settings.restrict ? 'selected' : ''}><input type="radio" name="lab23-restrict" checked={settings.restrict} onChange={() => patchSettings({ restrict: true })} /><span><strong>A list</strong><small>Only these exact names.</small></span></label>
          </fieldset>
          <p className="lab15-ids">{discovered ? <>tools/list from <code>{discovery?.url}</code>, discovered today · <button type="button" className="lab15-link" onClick={() => void discover()} disabled={discovering || running}>{discovering ? 'discovering…' : 'discover again'}</button></> : <>{discovering ? 'Discovering today’s tools/list…' : `tools/list recorded on 2026-09-28${discovery?.error ? ' (discovery failed: the names are checked again on the server before a run)' : ''}`} · <button type="button" className="lab15-link" onClick={() => void discover()} disabled={discovering || running}>{discovering ? 'discovering…' : 'discover today’s list'}</button></>}</p>
          <ToolPicker tools={pickerTools} settings={settings} onToggle={toggle} disabled={running} />
          <div className="lab23-add">
            <input className="lab22-input" value={extraName} onChange={(event) => setExtraName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addName(); } }} placeholder="Type any name, e.g. search_docs" maxLength={128} spellCheck={false} disabled={running} aria-label="Add a tool name" />
            <button type="button" className="lab8-secondary" onClick={addName} disabled={running || !extraName.trim()}>Add name</button>
          </div>
          <details className="lab16-preview"><summary>Server label, URL, and required <small>{settings.label} · {settings.required ? 'required' : 'optional'}</small></summary>
            <label htmlFor="lab23-label">server_label</label>
            <input id="lab23-label" className="lab22-input" value={settings.label} onChange={(event) => patchSettings({ label: event.target.value })} maxLength={100} spellCheck={false} disabled={running} />
            <label htmlFor="lab23-url">transport.server_url</label>
            <input id="lab23-url" className="lab22-input" value={settings.serverUrl} onChange={(event) => patchSettings({ serverUrl: event.target.value })} maxLength={2000} spellCheck={false} disabled={running} />
            <label className="lab23-check"><input type="checkbox" checked={settings.required} onChange={(event) => patchSettings({ required: event.target.checked })} disabled={running} /> required: true <small>(Lab 22: the first turn waits for the server)</small></label>
          </details>
        </div>
        <div>
          <h3 className="lab13-subhead">What the server sends <code>sessions.create</code></h3>
          <pre className="lab19-decl lab21-decl"><code>{json(request)}</code></pre>
          <Findings findings={declared.findings} />
          {blocked ? <p className={skipChecks ? 'lab20-notice' : 'lab2-error'}>{skipChecks ? 'Send anyway is on: the server will skip the allowlist and origin checks and send this as it is.' : 'The server refuses these errors with a 400. Fix them, or turn on Send anyway to watch what the API does.'}</p> : null}
          <label className="lab23-check lab23-skip"><input type="checkbox" checked={skipChecks} onChange={(event) => setSkipChecks(event.target.checked)} disabled={running} /> <span><b>Send anyway</b>: skip the allowlist and origin checks, to see what the API does. The label and URL checks from Lab 22 always apply.</span></label>
        </div>
      </div>
    </section>

    <section className="lab7-card"><span className="eyebrow">WHAT THE AGENT CAN SEE</span><h2>Allowed, hidden, and names that match nothing</h2>
      <p>A hidden tool is not refused when the agent calls it. It is never discovered, so the agent does not know it exists. {allowedNow === null ? 'With allowed_tools left out, nothing is hidden.' : `${allowedNow.length} name${allowedNow.length === 1 ? '' : 's'} in the list.`}</p>
      <VisibilityView tools={pickerTools} allowed={allowedNow} />
      <p className="lab8-note">Do not ask the agent which tools it has. In two live runs with <code>search_openai_docs</code> allowed, it answered “no tools are available”. In another run with the same list, it called that tool when a task needed it. Test with tasks, and read the <code>mcp_call</code> items.</p>
    </section>

    <section className="lab7-card" id="lab23-inspector"><span className="eyebrow">ALLOWLIST INSPECTOR · NO API KEY NEEDED</span><h2>Read a recorded run against its allowlist</h2>
      <p>{samples.length} recorded runs. {samples.filter((item) => item.origin === 'live').length} are shortened from live runs on 2026-09-28; the other is an illustration. Change the allowlist below: the recorded calls are judged again, so you can see which list would have made a call a breach.</p>
      <div className="lab16-prompts">{samples.map((item) => <button type="button" key={item.id} className={item.id === sample.id ? 'selected' : ''} onClick={() => chooseSample(item.id)}>{item.label}</button>)}</div>
      <p className="lab16-prompt-line">“{sample.run.prompt}” <span className="lab15-ids">{policyLabel(sample.settings)} · <span className={'lab22-origin ' + sample.origin}>{sample.origin === 'live' ? 'from a live run' : 'illustration'}</span></span></p>
      <p className="lab8-note">{sample.lesson}</p>
      <div className="lab21-config">
        <div>
          <h3 className="lab13-subhead">Allowlist <code>{sampleAllowed === null ? 'left out' : `${sampleAllowed.length} names`}</code></h3>
          <ToolPicker tools={recordedDocsTools} settings={sampleSettings} onToggle={toggleSample} disabled={false} />
          <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => setSampleSettings(sample.settings)} disabled={!sampleEdited}>Restore the recorded allowlist</button></div>
        </div>
        <div><h3 className="lab13-subhead">What the app would say</h3><Findings findings={sampleDeclared.findings} /></div>
      </div>
      <Matrix rows={sampleRows} toolNames={recordedDocsTools.map((tool) => tool.name)} />
      <ProbeDetail run={sample.run} allowed={sampleAllowed} />
    </section>

    <section className="lab7-card" id="lab23-tests"><span className="eyebrow">TEST PAGE · NO API KEY NEEDED</span><h2>{allowTests.length} cases, one function each</h2><p>Every case runs the real <code>checkOrigin</code>, <code>checkAllowlist</code>, <code>buildRestrictedTool</code>, <code>visibleTools</code>, <code>isAllowedCall</code>, <code>judgeProbe</code>, or <code>summarizeTest</code>, in this browser or on the server. Cases marked <em>Live</em> in their notes repeat what the API did on 2026-09-28.</p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={runInBrowser} disabled={Boolean(suiteBusy)}>{suiteBusy === 'browser' ? 'Running…' : 'Run all in the browser'}</button><button type="button" className="lab8-secondary" onClick={() => void runOnServer()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'server' ? 'Running…' : 'Run all on the server'}</button></div>
      {suite ? <p className={'lab18-score ' + (passed === allowTests.length ? 'ok' : 'fail')}><b>{passed}/{allowTests.length} passed</b> · ran in {suite.runtime} · {suite.durationMs} ms</p> : <p className="lab8-note">Not run yet. Each row states the result it must produce.</p>}
      <div className="lab18-tests">
        <div className="lab9-table-wrap lab18-table lab21-table"><table>
          <thead><tr><th>Case</th><th>Expect</th><th>Got</th><th /></tr></thead>
          {groups.map((group) => <tbody key={group.id}><tr className="lab18-group"><th colSpan={4}>{group.label}</th></tr>{allowTests.filter((item) => item.group === group.id).map((item) => { const result = suite?.results[item.id]; return <tr key={item.id} className={item.id === test.id ? 'selected' : ''} onClick={() => setTestId(item.id)}>
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

    <section className="lab7-card"><span className="eyebrow">LIVE ALLOWLIST TEST</span><h2>Probe every tool with the same allowlist</h2>
      <p>Each probe is a question that needs one tool. Every probe runs in its own new session with the declaration above, in parallel. Allowed tools should be called. Hidden tools should not be.</p>
      <div className="lab23-probes">{probes.map((probe) => { const on = chosen.includes(probe.id); const hidden = allowedNow !== null && !allowedNow.includes(probe.target); return <label key={probe.id} className={'lab23-probe' + (on ? ' on' : '')}>
        <input type="checkbox" checked={on} onChange={() => setChosen((previous) => (previous.includes(probe.id) ? previous.filter((item) => item !== probe.id) : [...previous, probe.id]))} disabled={running} />
        <span><strong>{probe.label}</strong><code>{probe.target}</code><span className={'lab23-expect ' + (hidden ? 'cannot' : 'can')}>{hidden ? 'expect: cannot' : 'expect: can'}</span><small>{probe.prompt}</small></span>
      </label>; })}</div>
      <label htmlFor="lab23-question">Your own question <small>optional · runs as one more session, judged only on the allowlist</small></label>
      <textarea id="lab23-question" value={question} maxLength={2000} onChange={(event) => setQuestion(event.target.value)} disabled={running} placeholder="e.g. Use get_openapi_spec to show the request body of POST /v1/agents/sessions." />
      <p className="lab15-ids">policy <code>{policyLabel(settings)}</code> · {jobCount} session{jobCount === 1 ? '' : 's'} · change it in <a href="#lab23" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Origin and allowlist</a></p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void runTest()} disabled={running || !health?.configured || !jobCount || jobCount > 6 || (blocked && !skipChecks)}>{running ? 'Running…' : `Run the allowlist test (${jobCount})`}</button>{running ? <button type="button" className="lab8-secondary" onClick={() => abort.current?.abort()}>Stop</button> : null}</div>
      {!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env and restart the server for a live test. Discovery, the inspector, and the test page work without a key.</p> : <p className="lab8-note">Five probes take about as long as the slowest one, usually 10–25 seconds.</p>}
      {status ? <p className="lab7-session-id">{status}</p> : null}
      {live ? <div className="lab23-live">{Object.entries(live).map(([key, probe]) => <article key={key} className={'lab23-live-card ' + probe.state}>
        <div className="lab23-live-head"><strong>{probeLabel(key)}</strong><span>{probe.state === 'done' ? 'done' : probe.state === 'running' ? 'running…' : 'waiting'}</span></div>
        <p className="lab15-ids">{probe.sessionId ? <code>{shortId(probe.sessionId)}</code> : 'no session yet'} · {probe.calls.filter((call) => call.kind === 'tool').length} call{probe.calls.filter((call) => call.kind === 'tool').length === 1 ? '' : 's'}{probe.calls.length ? `: ${[...new Set(probe.calls.map((call) => call.name))].join(', ')}` : ''}</p>
        {probe.answer ? <p className="lab23-live-answer">{probe.answer.length > 220 ? `${probe.answer.slice(0, 220)}…` : probe.answer}</p> : null}
      </article>)}</div> : null}
      {notice ? <p className="lab20-notice" role="status">{notice}</p> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    <section className="lab7-card"><span className="eyebrow">RESULT</span><h2>{selected ? `Test #${tests.indexOf(selected) + 1}` : 'No test yet'}</h2>
      {selected ? <>
        <p className="lab15-ids">policy <code>{policyLabel(selected.settings)}</code> · {selected.runs.length} probe{selected.runs.length === 1 ? '' : 's'} · total <b>{seconds(selected.durationMs)}</b>{selected.skipped ? <> · <em>sent without the app’s checks</em></> : null}</p>
        <VerdictBox verdict={summarizeTest(selected.runs, selectedAllowed)} />
        <Matrix rows={selectedRows} toolNames={selected.toolNames} selected={selectedProbe?.probeId ?? null} onSelect={(id) => { setProbeId(id); setItems(null); }} />
        {selectedProbe ? <>
          <h3 className="lab13-subhead">{probeLabel(selectedProbe.probeId)}</h3>
          <ProbeDetail run={selectedProbe} allowed={selectedAllowed} />
          <details className="lab16-preview"><summary>The tool that was sent <small>same for every probe</small></summary><pre className="lab19-decl"><code>{json({ tools: [selected.tool] })}</code></pre></details>
          <div className="lab8-actions">{selectedProbe.sessionId ? <button type="button" className="lab8-secondary" onClick={() => void readItems(selectedProbe, `${selected.id}:${selectedProbe.probeId}`)} disabled={running}>Read the saved items</button> : null}</div>
          {items && items.key === `${selected.id}:${selectedProbe.probeId}` ? <div className="lab16-saved"><h3 className="lab13-subhead">Saved items <code>sessions.items.list</code></h3>{items.list.length ? <ol className="lab17-items">{items.list.map((item, index) => <li key={item.id ?? index} className={item.type}>
            <div><code className="lab17-item-type">{item.type}</code>{item.role ? <span className="lab17-role">{item.role}</span> : null}{item.status ? <span className="lab15-ids">{item.status}</span> : null}</div>
            {item.call ? <p><b>{item.call}</b></p> : null}
            {item.text ? <p>{item.text.length > 400 ? `${item.text.slice(0, 400)}…` : item.text}</p> : null}
          </li>)}</ol> : <p className="lab8-note">No items yet.</p>}</div> : null}
        </> : null}
      </> : <p className="lab8-note">Run the test with <em>Find and quote a page</em>, then with <em>Everything</em> and <em>Endpoints only</em>. Compare the matrices.</p>}
    </section>

    <section className="lab7-card"><span className="eyebrow">TEST HISTORY</span><h2>Compare allowlists</h2>
      {tests.length ? <div className="lab9-table-wrap lab15-history lab16-history"><table>
        <thead><tr><th>Test</th><th>Policy</th><th>Can</th><th>Cannot</th><th>Gaps</th><th>Breaches</th><th>Time</th><th>Verdict</th></tr></thead>
        <tbody>{tests.map((item, index) => { const allowed = item.tool.allowed_tools ?? null; const outcomes = item.runs.map((run) => judgeProbe(run, allowed).outcome); const verdict = summarizeTest(item.runs, allowed); const count = (outcome: string) => outcomes.filter((value) => value === outcome).length; return <tr key={item.id} className={item.id === selected?.id ? 'selected' : ''} onClick={() => { setSelectedId(item.id); setProbeId(item.runs[0]?.probeId ?? null); setItems(null); }}>
          <th><button type="button" className="lab15-link" onClick={() => { setSelectedId(item.id); setProbeId(item.runs[0]?.probeId ?? null); setItems(null); }} aria-pressed={item.id === selected?.id}>#{index + 1}</button></th>
          <td><code>{policyLabel(item.settings)}</code>{item.skipped ? <small> · unchecked</small> : null}</td><td>{count('used')}</td><td>{count('blocked')}</td><td>{count('unused') + count('failed')}</td><td>{count('breach')}</td><td>{seconds(item.durationMs)}</td><td><span className={'lab16-tone lab23-tone ' + verdict.tone}>{verdict.title}</span></td></tr>; })}</tbody>
      </table></div> : <p className="lab8-note">No tests yet. Run two allowlists and compare what each one let the agent do.</p>}
    </section>

    <section className="lab3-guide lab16-guide"><h2>Read the evidence</h2><div><article><strong>Origin</strong><p><code>service</code> for a public server. <code>environment</code> needs a session environment, or the API answers 400.</p></article><article><strong>Allowlist</strong><p>Exact, case-sensitive names from <code>tools/list</code>. The API accepts a wrong name silently.</p></article><article><strong>Hidden</strong><p>Never discovered, so never called. Resource helpers stay. The model’s own account of its tools is not evidence.</p></article><article><strong>Probe</strong><p>One task per tool. Allowed and called is <em>can</em>; hidden and not called is <em>cannot</em>. Anything else, run again.</p></article></div><p className="lab3-guide-note">Least privilege for agents: list what the task needs, check the names before you send, and prove the list with tasks, not by asking the model.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 23</span><span className="code-lessons-title" role="heading" aria-level={2}>The code that restricts MCP tools</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Choose the origin, write the allowlist, check its names, see what is hidden, probe each tool, and judge the evidence. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, (lesson.file.endsWith('.tsx') ? Prism.languages.tsx : Prism.languages.typescript) || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Run the test page on the server and show <em>{allowTests.length}/{allowTests.length} passed</em>. In the inspector, open <em>Allowed: find and quote a page</em> and untick <code>fetch_openai_doc</code>: explain the new outcome. Live, run the allowlist test with <em>Find and quote a page</em> and show a matrix with two <em>Can call</em> and three <em>Cannot call</em> rows. Then turn on <em>Send anyway</em>, choose <em>A typo</em>, and explain why the API’s silence is the reason the app checks names. Finally, choose <em>Environment origin</em> and say in one sentence when you would use it.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/tools/mcp" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
