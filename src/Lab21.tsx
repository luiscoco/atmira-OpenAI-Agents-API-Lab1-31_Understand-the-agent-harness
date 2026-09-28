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
import {
  buildReport, buildSearchTool, canonicalUrl, checkUrl, classifySearchRun, contextSizes, defaultSettings, describeAction, hasErrors, maxDomains, parseDomains, parseSearchCall, parseSummary, reportOfRun, searchInstructions, searchModes,
  type Finding, type Moment, type SearchCall, type SearchRun, type SearchSettings, type SourceCheck, type SourceEntry, type SourceReport, type Verdict,
} from './lab21Search.ts';
import { samples } from './lab21Scenarios.ts';
import { runSearchSuite, searchTests, type TestGroup, type TestResult } from './lab21Tests.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Live = { events: string[]; searches: SearchCall[]; answer: string; timeline: Moment[] };
type Suite = { source: 'browser' | 'server'; runtime: string; durationMs: number; results: Record<string, TestResult> };
type SavedItem = { id: string | null; type: string; role: string | null; text: string | null; status: string | null; search: string | null };

const lessons: Lesson[] = [
  { number: '01', title: 'Turn web search on in agent.tools', file: 'server/lab21.ts', code: "const tool = { type: 'web_search', mode: 'live', context_size: 'medium' };\n\nstream = await api.beta.agents.sessions.create({\n  agent: {\n    model,\n    instructions: searchInstructions(today), // the same with and without the tool\n    ...(tool ? { tools: [tool] } : {}),       // left out → search is off\n  },\n  environment: { type: 'none' },\n  input: prompt,\n  stream: true,\n});", explanation: 'Web search is a built-in tool. You declare it in agent tools, and OpenAI runs it. There is no function to write, no requires action pause, and no tool result to send back. Leaving the tool out is the only way to turn search off. Asking for a search in the prompt does not turn it on: the model then answers from its training data, which has a cutoff date. Keep the instructions identical with and without the tool, so a comparison changes only one thing.' },
  { number: '02', title: 'Configure mode, context, domains, and location', file: 'src/lab21Search.ts', code: "export function buildSearchTool(settings) {\n  const { domains, findings } = parseDomains(settings.domains);   // ≤ 100, cleaned\n  const tool = { type: 'web_search', mode: settings.mode, context_size: settings.contextSize };\n  if (domains.length) tool.allowed_domains = domains;              // [\"nasa.gov\"]\n  if (place.location) tool.location = place.location;              // { country: \"ES\", city: \"Madrid\" }\n  return { tool: hasErrors(findings) ? null : tool, findings };\n}\n// \"https://docs.python.org/3/\" → \"docs.python.org\"  (warning)\n// \"*.mozilla.org\"             → \"mozilla.org\"      (warning)\n// \"127.0.0.1\"                 → error: not a domain", explanation: 'Mode live searches the web now, and it is the default. Cached uses cached results. Disabled declares the tool but switches it off. Context size controls how much page text reaches the model: more context can help the answer, and it costs more tokens. Allowed domains limits search to at most one hundred domains. People paste URLs, so the server cleans them, says what it changed, and refuses anything that is not a domain. Location is a hint for local results, not a filter. The server rebuilds the declaration from plain settings; it never trusts a tool object sent by the browser.' },
  { number: '03', title: 'Watch the searches: web_search_call items', file: 'server/lab21.ts', code: "if ((event.type === 'agent.session.turn.item.added' ||\n     event.type === 'agent.session.turn.item.done') &&\n    event.item.type === 'web_search_call') {\n  const action = parseSearchAction(event.item.action);\n  // { type: 'search', queries: ['length of a day on Mars'] }\n  // { type: 'open_page', url: 'https://science.nasa.gov/mars/facts/' }\n  // { type: 'find_in_page', url, pattern }\n  searches.set(event.item.id, { id: event.item.id, status: event.item.status, action });\n}", explanation: 'The search runs inside the turn. Each one appears as a web search call item: item added when it starts, and item done, with its action, when it finishes. The action says what the agent did: a search with its queries, opening a page, or finding text in a page. It does not list the results, so the log shows what the agent looked for, not everything it read. Keep this log. It lets a reader see the research, and it shows whether an answer came from a search at all.' },
  { number: '04', title: 'Find the citations in the answer', file: 'src/lab21Search.ts', code: "const markdownLink = /(!?)\\[(…)\\]\\(\\s*<?((?:[^()\\s<>]|\\([^()\\s<>]*\\))+)>?…\\)/g;\nconst bareUrl = /\\b(?:https?:\\/\\/|www\\.)[^\\s<>\"'`[\\]]+/gi;\n\nexport function extractCitations(text, annotations = []) {\n  // skip images (![…](…)) and anything inside `code`\n  // trim a final \".\" or an unbalanced \")\" from bare URLs\n  // read url_citation annotations too, if a response ever has them\n}\nexport function canonicalUrl(url) {\n  // drop the #fragment, utm_* parameters, a trailing / and www.\n}", explanation: 'The Agents API puts sources inline, as Markdown links right after the claim they support. The answer text is the citation data, so parse it carefully. A link can contain brackets, as Wikipedia URLs do. A bare URL often ends in a full stop that is not part of it. An image, or a URL in a code example, is not a source. Then group the links by a canonical URL, without the fragment, tracking parameters, or a trailing slash, so the same page cited twice becomes one numbered source.' },
  { number: '05', title: 'Check every source before you trust it', file: 'src/lab21Search.ts', code: "export function checkUrl(url) {\n  const parsed = new URL(url);\n  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')\n    return { href: null, reason: 'Not a web link. Shown as text.' };\n  …\n}\n\n// A dot boundary: evilnasa.gov and nasa.gov.example are not nasa.gov.\nexport const hostMatches = (host, domain) =>\n  host === domain || host.endsWith(`.${domain}`);\n\n// checks: searched · cited · safe · allowlist · labels · coverage · provenance", explanation: 'Search brings in text from pages you do not control, and that text can carry instructions and links. So check every source. It must be a web link, not javascript or data. It must be inside the allowed domains, with a dot boundary, so that evil nasa dot gov does not pass. Its link text must not name a different site. And each paragraph with facts should have a source nearby. Links written with no search at all come from the model’s memory. The allowlist limits search results, not what the model writes, so the check runs again on the answer.' },
  { number: '06', title: 'Render sources safely in React', file: 'src/Lab21.tsx', code: "<ReactMarkdown remarkPlugins={[remarkGfm]} components={{\n  a: ({ href, children }) => {\n    const check = checkUrl(href ?? '');\n    if (!check.href) return <span className=\"lab21-dead\">{children}</span>;\n    const source = byUrl.get(canonicalUrl(check.href));\n    return <><a href={check.href} target=\"_blank\"\n              rel=\"noopener noreferrer nofollow\">{children}</a>\n             {source ? <sup>[{source.n}]</sup> : null}</>;\n  },\n}}>{answer}</ReactMarkdown>", explanation: 'Show the answer with sources a reader can open. Every link opens in a new tab with no opener, no referrer, and nofollow, so the linked page cannot reach back into the app. A link that fails the check is shown as plain text. Each link carries the number of its source. The source list below shows the host, whether the page was opened during the search, and any problem found. The reader can then open a source and confirm that it says what the answer claims.' },
];

type Preset = { label: string; text: string; patch: Partial<SearchSettings>; note: string };
const presets: Preset[] = [
  { label: 'A current fact', text: 'What is the latest stable release of Node.js, and when was it released?', patch: { offered: true, mode: 'live', domains: '' }, note: 'Live search, no allowlist.' },
  { label: 'The same, no tool', text: 'What is the latest stable release of Node.js, and when was it released?', patch: { offered: false }, note: 'web_search left out: compare the answer and its sources.' },
  { label: 'NASA only', text: 'How long is a day on Mars, and how long is a Martian year?', patch: { offered: true, mode: 'live', domains: 'nasa.gov' }, note: 'allowed_domains: nasa.gov.' },
  { label: 'Official docs only', text: 'How do I turn on web search for an agent in the OpenAI Agents API? Show the JSON.', patch: { offered: true, mode: 'live', domains: 'developers.openai.com' }, note: 'allowed_domains: developers.openai.com.' },
  { label: 'Near me', text: 'Which public holidays are coming up in the next two months where I am?', patch: { offered: true, mode: 'live', domains: '', location: { country: 'ES', region: 'Madrid', city: 'Madrid', timezone: 'Europe/Madrid' } }, note: 'location: Madrid, ES.' },
  { label: 'Ask for a search, tool off', text: 'Search the web and give me today’s top technology headline, with links.', patch: { offered: false }, note: 'The prompt asks for a search; the tool is not declared.' },
];

const groups: Array<{ id: TestGroup; label: string }> = [
  { id: 'declare', label: 'Declare the tool' },
  { id: 'extract', label: 'Find the citations' },
  { id: 'check', label: 'Check the sources' },
];

const steps = [
  { id: 'declare', label: 'Declare', detail: 'agent.tools' },
  { id: 'search', label: 'Search', detail: 'web_search_call' },
  { id: 'cite', label: 'Cite', detail: 'links in the text' },
  { id: 'check', label: 'Check', detail: 'safe · allowed · labelled' },
  { id: 'render', label: 'Render', detail: 'numbered, safe links' },
];
type StepState = '' | 'pass' | 'fail' | 'skip' | 'warn';

function flowOf(report: SourceReport | null, offered: boolean, searched: number): StepState[] {
  if (!report) return steps.map((): StepState => '');
  const failing = report.checks.some((check) => check.level === 'fail' && check.id !== 'cited');
  const warning = report.checks.some((check) => check.level === 'warn' && check.id !== 'cited' && check.id !== 'searched');
  return [
    offered ? 'pass' : 'skip',
    searched ? 'pass' : offered ? 'warn' : 'skip',
    report.sources.length ? 'pass' : searched ? 'fail' : 'warn',
    !report.sources.length ? 'skip' : failing ? 'fail' : warning ? 'warn' : 'pass',
    report.sources.length ? (failing ? 'warn' : 'pass') : 'skip',
  ];
}

function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
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
const settingsLabel = (settings: SearchSettings) => {
  if (!settings.offered) return 'off';
  const domains = parseDomains(settings.domains).domains;
  return `${settings.mode}${domains.length ? ` · ${domains.length === 1 ? domains[0] : `${domains.length} domains`}` : ''}${settings.location.country ? ` · ${settings.location.country}` : ''}`;
};

async function readLines(response: Response, onLine: (line: Record<string, unknown>) => void) {
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
  return <ol className="lab18-pipeline lab21-flow" aria-label="From search to a sourced answer">{steps.map((step, index) => {
    const state = states[index];
    return <li key={step.id} className={state}><span>{state === 'pass' ? '✓' : state === 'fail' ? '✕' : state === 'warn' ? '!' : index + 1}</span><strong>{step.label}</strong><small>{state === 'skip' ? 'not used' : step.detail}</small></li>;
  })}</ol>;
}

function Findings({ findings }: { findings: Finding[] }) {
  if (!findings.length) return null;
  return <ul className="lab21-findings">{findings.map((finding, index) => <li key={index} className={finding.level}><b>{finding.level === 'ok' ? '✓' : finding.level === 'warn' ? '!' : '✕'}</b>{finding.text}</li>)}</ul>;
}

// The answer, with each safe link numbered by its source. A link that fails the check stays text.
function SourcedAnswer({ answer, sources }: { answer: string; sources: SourceEntry[] }) {
  const byUrl = useMemo(() => new Map(sources.map((source) => [source.canonical, source])), [sources]);
  return <div className="lab7-answer lab16-answer lab21-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    pre: AnswerPre,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const check = checkUrl(href ?? '');
      if (!check.href) return <span className="lab21-dead" title="Not a web link: shown as text, never as a link">{children}</span>;
      const source = byUrl.get(canonicalUrl(check.href));
      const bad = source?.problems.some((problem) => problem.level === 'error');
      return <><a href={check.href} target="_blank" rel="noopener noreferrer nofollow" className={bad ? 'lab21-flagged' : undefined}>{children}</a>{source ? <sup className={'lab21-cite' + (bad ? ' bad' : '')}>[{source.n}]</sup> : null}</>;
    },
  }}>{answer}</ReactMarkdown></div>;
}

function SourceList({ sources }: { sources: SourceEntry[] }) {
  if (!sources.length) return <p className="lab8-note">No sources in this answer.</p>;
  return <ol className="lab21-sources">{sources.map((source) => {
    const bad = source.problems.some((problem) => problem.level === 'error');
    return <li key={source.canonical} className={bad ? 'bad' : source.problems.length ? 'warn' : 'ok'}>
      <span className="lab21-n">{source.n}</span>
      <div>
        <strong>{source.title}</strong>
        <p className="lab21-url">{source.href ? <a href={source.href} target="_blank" rel="noopener noreferrer nofollow">{source.url}</a> : <code>{source.url}</code>}</p>
        <div className="lab21-badges">
          {source.host ? <span className="lab21-badge host">{source.host}</span> : null}
          {source.inAllowlist === true ? <span className="lab21-badge ok">inside the allowlist</span> : source.inAllowlist === false ? <span className="lab21-badge bad">outside the allowlist</span> : null}
          {source.opened ? <span className="lab21-badge ok">opened during the search</span> : null}
          {source.uses > 1 ? <span className="lab21-badge">cited {source.uses}×</span> : null}
          {source.kinds.includes('bare') ? <span className="lab21-badge">bare URL</span> : null}
          {source.kinds.includes('annotation') ? <span className="lab21-badge">annotation</span> : null}
        </div>
        {source.problems.map((problem, index) => <p key={index} className={'lab21-problem ' + problem.level}>{problem.text}</p>)}
      </div>
      {source.href ? <a className="lab21-open" href={source.href} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open source ${source.n} in a new tab`}>Open ↗</a> : <span className="lab21-open off">not a link</span>}
    </li>;
  })}</ol>;
}

function SearchLog({ searches }: { searches: SearchCall[] }) {
  if (!searches.length) return <p className="lab8-note">No web_search_call items: the agent did not search.</p>;
  return <ol className="lab21-searches">{searches.map((call) => <li key={call.id} className={call.action?.type ?? 'pending'}>
    <span className="lab21-action">{call.action?.type ?? 'searching'}</span>
    <span className="lab21-what">{describeAction(call.action, call.status)}</span>
    <code>{shortId(call.id)}</code>{call.status ? <span className="lab21-status">{call.status}</span> : null}
  </li>)}</ol>;
}

function Checks({ checks }: { checks: SourceCheck[] }) {
  return <ul className="lab21-checks">{checks.map((check) => <li key={check.id} className={check.level}><b>{check.level === 'ok' ? '✓' : check.level === 'fail' ? '✕' : check.level === 'warn' ? '!' : '–'}</b><strong>{check.label}</strong><span>{check.detail}</span></li>)}</ul>;
}

function VerdictBox({ verdict }: { verdict: Verdict }) {
  return <div className={'lab16-verdict lab21-verdict ' + verdict.tone}><strong>{verdict.title}</strong><p>{verdict.text}</p></div>;
}

// Everything about one answer: the verdict, the flow, the answer with numbered links, the sources, the searches, and the checks.
function ReportView({ answer, searches, report, verdict, offered }: { answer: string; searches: SearchCall[]; report: SourceReport; verdict: Verdict; offered: boolean }) {
  return <div className="lab21-report">
    <VerdictBox verdict={verdict} />
    <Flow states={flowOf(report, offered, searches.length)} />
    <div className="lab21-report-grid">
      <div>
        <h3 className="lab13-subhead">Answer <code>{report.citations.length} link{report.citations.length === 1 ? '' : 's'}</code></h3>
        {answer ? <SourcedAnswer answer={answer} sources={report.sources} /> : <p className="lab8-note">No answer text.</p>}
        <h3 className="lab13-subhead">Sources <code>{report.sources.length}</code></h3>
        <SourceList sources={report.sources} />
      </div>
      <div>
        <h3 className="lab13-subhead">Search log <code>web_search_call</code></h3>
        <SearchLog searches={searches} />
        <h3 className="lab13-subhead">Checks</h3>
        <Checks checks={report.checks} />
      </div>
    </div>
  </div>;
}

function Timeline({ moments }: { moments: Moment[] }) {
  if (!moments.length) return null;
  const first = moments[0].at;
  return <ol className="lab17-timeline lab21-timeline">{moments.map((moment, index) => <li key={index} className={moment.kind}><span className="lab17-at">+{((moment.at - first) / 1000).toFixed(1)}s</span><span className="lab17-kind">{moment.kind}</span><span className="lab17-label">{moment.label}</span></li>)}</ol>;
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

export default function Lab21({ active, health }: { active: boolean; health: Health }) {
  const [settings, setSettings] = useState<SearchSettings>(defaultSettings);
  const [sampleId, setSampleId] = useState(samples[0].id);
  const [draft, setDraft] = useState(samples[0].answer);
  const [suite, setSuite] = useState<Suite | null>(null);
  const [suiteBusy, setSuiteBusy] = useState<'browser' | 'server' | null>(null);
  const [testId, setTestId] = useState(searchTests[0].id);
  const [prompt, setPrompt] = useState(presets[0].text);
  const [preset, setPreset] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [live, setLive] = useState<Live | null>(null);
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<{ runId: string; list: SavedItem[] } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const abort = useRef<AbortController | null>(null);
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const declared = useMemo(() => buildSearchTool(settings), [settings]);
  const blocked = hasErrors(declared.findings);
  const today = new Date().toISOString().slice(0, 10);
  const request = { agent: { model: health?.model ?? 'your-model', instructions: `${searchInstructions(today).slice(0, 72)}…`, ...(declared.tool ? { tools: [declared.tool] } : {}) }, environment: { type: 'none' }, input: prompt.trim() || '…', stream: true };

  const sample = samples.find((item) => item.id === sampleId) ?? samples[0];
  const sampleDomains = parseDomains(sample.domains).domains;
  const sampleReport = useMemo(() => buildReport({ answer: draft, searches: sample.searches, allowedDomains: sampleDomains, toolOffered: sample.toolOffered, mode: sample.mode }), [draft, sample]);
  const sampleVerdict = classifySearchRun({ tool: sample.toolOffered ? { type: 'web_search', mode: sample.mode, context_size: 'medium', ...(sampleDomains.length ? { allowed_domains: sampleDomains } : {}) } : null, searches: sample.searches, answer: draft, annotations: [], turnStatus: 'completed', error: null });

  const selected = runs.find((run) => run.id === selectedId) ?? runs.at(-1) ?? null;
  const selectedReport = useMemo(() => (selected ? reportOfRun(selected) : null), [selected]);
  const liveReport = useMemo(() => (live ? buildReport({ answer: live.answer, searches: live.searches, allowedDomains: declared.domains, toolOffered: Boolean(declared.tool), mode: declared.tool?.mode ?? 'disabled' }) : null), [live, declared]);
  const test = searchTests.find((item) => item.id === testId) ?? searchTests[0];
  const testResult = suite?.results[test.id] ?? null;
  const passed = suite ? Object.values(suite.results).filter((item) => item.pass).length : 0;

  const patchSettings = (patch: Partial<SearchSettings>) => { setPreset(null); return setSettings((previous) => ({ ...previous, ...patch, location: { ...previous.location, ...(patch.location ?? {}) } })); };
  function choosePreset(chosen: Preset) {
    setPrompt(chosen.text); setPreset(chosen.label);
    setSettings((previous) => ({ ...previous, ...chosen.patch, location: chosen.patch.location ?? (chosen.patch.offered === false ? previous.location : defaultSettings.location) }));
    setNotice(`Settings changed for this preset: ${chosen.note}`);
  }
  function chooseSample(id: string) {
    const next = samples.find((item) => item.id === id) ?? samples[0];
    setSampleId(next.id); setDraft(next.answer);
  }

  function runInBrowser() {
    setSuiteBusy('browser'); setError('');
    const started = performance.now();
    try {
      const results = runSearchSuite();
      setSuite({ source: 'browser', runtime: 'this browser', durationMs: Math.round(performance.now() - started), results: Object.fromEntries(results.map((item) => [item.id, item])) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The suite crashed.'); }
    finally { setSuiteBusy(null); }
  }
  async function runOnServer() {
    setSuiteBusy('server'); setError('');
    try {
      const response = await fetch('/api/lab21/test', { method: 'POST' });
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
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true); setError(''); setNotice(''); setStatus(''); setItems(null); setLive({ events: [], searches: [], answer: '', timeline: [] });
    try {
      const response = await fetch('/api/lab21/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ prompt: question, search: used }) });
      if (!response.ok) {
        const failure = await response.json() as { error?: string; findings?: Finding[] };
        throw new Error([failure.error || `Request failed (${response.status}).`, ...(failure.findings ?? []).filter((item) => item.level === 'error').map((item) => item.text)].join(' '));
      }
      let summary: unknown = null;
      await readLines(response, (line) => {
        if (line.type === 'status' && typeof line.label === 'string') setStatus(line.label);
        if (line.type === 'event' && typeof line.name === 'string') { const name = line.name; setLive((previous) => previous && { ...previous, events: [...previous.events, name] }); }
        if (line.type === 'text' && typeof line.text === 'string') { const answer = line.text; setLive((previous) => previous && { ...previous, answer }); }
        if (line.type === 'search') { const call = parseSearchCall(line.call); setLive((previous) => previous && { ...previous, searches: [...previous.searches.filter((item) => item.id !== call.id), call] }); }
        if (line.type === 'moment' && typeof line.moment === 'object' && line.moment) { const moment = line.moment as Moment; setLive((previous) => previous && { ...previous, timeline: [...previous.timeline, moment] }); }
        if (line.type === 'summary') summary = line.summary;
      });
      if (!summary) throw new Error('The stream ended without a summary.');
      const run: SearchRun = { ...parseSummary(summary), id, prompt: question, settings: used };
      setRuns((previous) => [...previous, run]);
      setSelectedId(id);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error ? caught.message : 'The run failed.');
    } finally {
      if (abort.current === controller) abort.current = null;
      setRunning(false); setLive(null);
    }
  }
  async function readItems(run: SearchRun) {
    if (!run.sessionId) return;
    try {
      const response = await fetch(`/api/lab21/items?${new URLSearchParams({ sessionId: run.sessionId })}`);
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
      const utterance = new SpeechSynthesisUtterance(`${speechMode === 'all' ? `Snippet ${Number(lesson.number)}. ` : ''}${lesson.title}. ${lesson.explanation}`);
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

  return <div className="lab16-page lab17-page lab18-page lab21-page">
    <div className="lab2-hero"><span className="lab2-badge lab21-badge">21/50</span><div><div className="eyebrow">LAB 21 / ADD WEB SEARCH</div><h1>Add <em>web search</em>, and check its sources.</h1><p>Until now the agent knew only its training data and what your own functions returned. Declare the built-in <code>web_search</code> tool and it can look things up now. OpenAI runs the search; your app sees each <code>web_search_call</code>, finds the links in the answer, <b>checks every source</b>, and shows them as numbered links a student can open.</p></div></div>

    <section className="lab7-card"><span className="eyebrow">TURN IT ON</span><h2>Declare web search in <code>agent.tools</code></h2>
      <p>No function, no <code>requires_action</code>, no tool result: OpenAI runs the tool inside the turn. Leaving it out is the only way to turn search off. Asking for a search in the prompt does not turn it on.</p>
      <div className="lab21-config">
        <div>
          <fieldset className="lab15-modes lab21-modes"><legend>web_search</legend>
            <label className={settings.offered ? 'selected' : ''}><input type="radio" name="lab21-offered" checked={settings.offered} onChange={() => patchSettings({ offered: true })} disabled={running} /><span><strong>Declared</strong><small>In agent.tools.</small></span></label>
            <label className={!settings.offered ? 'selected' : ''}><input type="radio" name="lab21-offered" checked={!settings.offered} onChange={() => patchSettings({ offered: false })} disabled={running} /><span><strong>Left out</strong><small>No tools at all.</small></span></label>
          </fieldset>
          <fieldset className="lab15-modes lab21-modes" disabled={!settings.offered || running}><legend>mode</legend>
            {searchModes.map((item) => <label key={item.id} className={settings.mode === item.id ? 'selected' : ''}><input type="radio" name="lab21-mode" checked={settings.mode === item.id} onChange={() => patchSettings({ mode: item.id })} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>)}
          </fieldset>
          <fieldset className="lab15-modes lab21-modes" disabled={!settings.offered || running}><legend>context_size</legend>
            {contextSizes.map((item) => <label key={item.id} className={settings.contextSize === item.id ? 'selected' : ''}><input type="radio" name="lab21-context" checked={settings.contextSize === item.id} onChange={() => patchSettings({ contextSize: item.id })} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>)}
          </fieldset>
          <label htmlFor="lab21-domains">allowed_domains <small>optional · up to {maxDomains}, separated by commas or spaces</small></label>
          <textarea id="lab21-domains" className="lab21-domains" value={settings.domains} onChange={(event) => patchSettings({ domains: event.target.value })} placeholder="nasa.gov, developers.openai.com" disabled={!settings.offered || running} />
          <div className="lab21-location">
            <span className="lab21-location-title">location <small>optional · a hint for local results</small></span>
            {(['country', 'region', 'city', 'timezone'] as const).map((field) => <label key={field}>{field}<input value={settings.location[field]} onChange={(event) => patchSettings({ location: { ...settings.location, [field]: event.target.value } })} placeholder={{ country: 'ES', region: 'Madrid', city: 'Madrid', timezone: 'Europe/Madrid' }[field]} disabled={!settings.offered || running} maxLength={100} /></label>)}
          </div>
        </div>
        <div>
          <h3 className="lab13-subhead">What the server sends <code>sessions.create</code></h3>
          <pre className="lab19-decl lab21-decl"><code>{json(request)}</code></pre>
          <Findings findings={declared.findings} />
          {blocked ? <p className="lab2-error">Fix the errors above: the server rebuilds this declaration and refuses the same errors.</p> : null}
        </div>
      </div>
    </section>

    <section className="lab7-card" id="lab21-inspector"><span className="eyebrow">SOURCE INSPECTOR · NO API KEY NEEDED</span><h2>Read an answer the way the page does</h2>
      <p>Six recorded answers, written for the course as illustrations (not live results). Each shows something to check before trusting a sourced answer. Edit the text and the report updates as you type.</p>
      <div className="lab16-prompts">{samples.map((item) => <button type="button" key={item.id} className={item.id === sample.id ? 'selected' : ''} onClick={() => chooseSample(item.id)}>{item.label}</button>)}</div>
      <p className="lab16-prompt-line">“{sample.prompt}” <span className="lab15-ids">web_search <code>{sample.toolOffered ? sample.mode : 'left out'}</code>{sampleDomains.length ? <> · allowed_domains <code>{sampleDomains.join(', ')}</code></> : null}</span></p>
      <p className="lab8-note">{sample.lesson}</p>
      <label htmlFor="lab21-draft">Answer text <small>Markdown, as the agent returns it</small></label>
      <textarea id="lab21-draft" className="lab21-draft" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />
      <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => setDraft(sample.answer)} disabled={draft === sample.answer}>Restore the recorded answer</button></div>
      <ReportView answer={draft} searches={sample.searches} report={sampleReport} verdict={sampleVerdict} offered={sample.toolOffered} />
    </section>

    <section className="lab7-card" id="lab21-tests"><span className="eyebrow">TEST PAGE · NO API KEY NEEDED</span><h2>{searchTests.length} cases, one function each</h2><p>Every case runs the real <code>buildSearchTool</code>, <code>extractCitations</code>, <code>buildReport</code>, or <code>classifySearchRun</code>, in this browser or on the server.</p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={runInBrowser} disabled={Boolean(suiteBusy)}>{suiteBusy === 'browser' ? 'Running…' : 'Run all in the browser'}</button><button type="button" className="lab8-secondary" onClick={() => void runOnServer()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'server' ? 'Running…' : 'Run all on the server'}</button></div>
      {suite ? <p className={'lab18-score ' + (passed === searchTests.length ? 'ok' : 'fail')}><b>{passed}/{searchTests.length} passed</b> · ran in {suite.runtime} · {suite.durationMs} ms</p> : <p className="lab8-note">Not run yet. Each row states the result it must produce.</p>}
      <div className="lab18-tests">
        <div className="lab9-table-wrap lab18-table lab21-table"><table>
          <thead><tr><th>Case</th><th>Expect</th><th>Got</th><th /></tr></thead>
          {groups.map((group) => <tbody key={group.id}><tr className="lab18-group"><th colSpan={4}>{group.label}</th></tr>{searchTests.filter((item) => item.group === group.id).map((item) => { const result = suite?.results[item.id]; return <tr key={item.id} className={item.id === test.id ? 'selected' : ''} onClick={() => setTestId(item.id)}>
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

    <section className="lab7-card"><span className="eyebrow">LIVE RUN</span><h2>Ask something that needs the web</h2>
      <div className="lab16-prompts">{presets.map((item) => <button type="button" key={item.label} className={preset === item.label ? 'selected' : ''} onClick={() => choosePreset(item)} disabled={running}>{item.label}</button>)}</div>
      <label htmlFor="lab21-prompt">Your question</label>
      <textarea id="lab21-prompt" value={prompt} maxLength={2000} onChange={(event) => { setPrompt(event.target.value); setPreset(null); }} disabled={running} />
      <p className="lab15-ids">web_search <code>{settingsLabel(settings)}</code> · change it in <a href="#lab21" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Turn it on</a></p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void runOnce()} disabled={running || !health?.configured || !prompt.trim() || blocked}>{running ? 'Running…' : 'Ask the agent'}</button>{running ? <button type="button" className="lab8-secondary" onClick={() => abort.current?.abort()}>Stop reading</button> : null}</div>
      {!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env and restart the server for a live run. The inspector and the test page above work without a key.</p> : <p className="lab8-note">A search can take tens of seconds. Web search is billed on top of tokens, so compare settings on a few questions, not many.</p>}
      {status ? <p className="lab7-session-id">{status}</p> : null}
      {live ? <div className="lab16-live lab21-live">
        <Timeline moments={live.timeline} />
        {live.searches.length ? <SearchLog searches={live.searches} /> : null}
        {live.answer && liveReport ? <SourcedAnswer answer={live.answer} sources={liveReport.sources} /> : null}
      </div> : null}
      {notice ? <p className="lab20-notice" role="status">{notice}</p> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    <section className="lab7-card"><span className="eyebrow">RESULT</span><h2>{selected ? `Run #${runs.indexOf(selected) + 1}` : 'No run yet'}</h2>
      {selected && selectedReport ? <>
        <p className="lab16-prompt-line">“{selected.prompt}”</p>
        <p className="lab15-ids">web_search <code>{settingsLabel(selected.settings)}</code>{selected.sessionId ? <> · session <code>{shortId(selected.sessionId)}</code></> : null} · turn <code>{selected.turnStatus}</code> · first search <b>{seconds(selected.firstSearchMs)}</b> · first text <b>{seconds(selected.firstTextMs)}</b> · total <b>{seconds(selected.durationMs)}</b></p>
        <ReportView answer={selected.answer} searches={selected.searches} report={selectedReport} verdict={classifySearchRun(selected)} offered={selected.tool !== null} />
        {selected.error ? <p className="lab2-error" role="alert">{selected.error}</p> : null}
        <details className="lab16-preview"><summary>Timeline and the tool that was sent <small>{selected.timeline.length} moments</small></summary><Timeline moments={selected.timeline} /><pre className="lab19-decl"><code>{json({ tools: selected.tool ? [selected.tool] : [] })}</code></pre><p className="lab8-note">annotations: {selected.annotations.length ? `${selected.annotations.length} url_citation` : 'none. The Agents API puts sources inline, as Markdown links.'} · {selected.events.length} events</p></details>
        <div className="lab8-actions">{selected.sessionId ? <button type="button" className="lab8-secondary" onClick={() => void readItems(selected)} disabled={running}>Read the saved items</button> : null}</div>
        {items && items.runId === selected.id ? <div className="lab16-saved"><h3 className="lab13-subhead">Saved items <code>sessions.items.list</code></h3>{items.list.length ? <ol className="lab17-items">{items.list.map((item, index) => <li key={item.id ?? index} className={item.type}>
          <div><code className="lab17-item-type">{item.type}</code>{item.role ? <span className="lab17-role">{item.role}</span> : null}{item.status ? <span className="lab15-ids">{item.status}</span> : null}</div>
          {item.search ? <p>{item.search}</p> : null}
          {item.text ? <p>{item.text.length > 400 ? `${item.text.slice(0, 400)}…` : item.text}</p> : null}
        </li>)}</ol> : <p className="lab8-note">No items yet.</p>}</div> : null}
      </> : <p className="lab8-note">Ask <em>A current fact</em> with search declared, then <em>The same, no tool</em>. Compare the searches, the sources, and what each answer admits it does not know.</p>}
    </section>

    <section className="lab7-card"><span className="eyebrow">RUN HISTORY</span><h2>Compare runs</h2>
      {runs.length ? <div className="lab9-table-wrap lab15-history lab16-history"><table>
        <thead><tr><th>Run</th><th>Question</th><th>web_search</th><th>Searches</th><th>Sources</th><th>Time</th><th>Verdict</th></tr></thead>
        <tbody>{runs.map((run, index) => { const verdict = classifySearchRun(run); const report = reportOfRun(run); return <tr key={run.id} className={run.id === selected?.id ? 'selected' : ''} onClick={() => { setSelectedId(run.id); setItems(null); }}>
          <th><button type="button" className="lab15-link" onClick={() => { setSelectedId(run.id); setItems(null); }} aria-pressed={run.id === selected?.id}>#{index + 1}</button></th>
          <td className="lab16-q">{run.prompt}</td><td><code>{settingsLabel(run.settings)}</code></td><td>{run.searches.length}</td><td>{report.sources.length}</td><td>{seconds(run.durationMs)}</td><td><span className={'lab16-tone lab21-tone ' + verdict.tone}>{verdict.title}</span></td></tr>; })}</tbody>
      </table></div> : <p className="lab8-note">No runs yet. Run one question with search declared and left out, and one with an allowlist.</p>}
    </section>

    <section className="lab3-guide lab16-guide"><h2>Read the evidence</h2><div><article><strong>Declare</strong><p>The tool is in <code>agent.tools</code>, or it is off. The prompt cannot turn it on.</p></article><article><strong>Search</strong><p>Each <code>web_search_call</code> shows a query or a page. It does not list what came back.</p></article><article><strong>Cite</strong><p>Sources arrive inline as Markdown links. The answer text is the citation data.</p></article><article><strong>Check</strong><p>Safe scheme, inside the allowlist, honest link text, and a source near every claim.</p></article></div><p className="lab3-guide-note">A link is a claim that a page says something. It is only a source once someone can open it and check.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 21</span><span className="code-lessons-title" role="heading" aria-level={2}>The code that adds web search</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Declare the tool, configure it, watch the searches, find the citations, check every source, and render the links safely. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, (lesson.file.endsWith('.tsx') ? Prism.languages.tsx : Prism.languages.typescript) || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Run the test page on the server and show <em>{searchTests.length}/{searchTests.length} passed</em>. In the inspector, edit the <em>Sourced answer</em> so its link goes to <code>nasa.gov.example</code> and explain which check fails. Live, ask <em>A current fact</em> with search declared, then with it left out, and compare the searches, the sources, and the verdicts. Then set <code>allowed_domains</code> to <code>nasa.gov</code>, ask about Mars, open two sources, and confirm that each says what the answer claims.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/tools/web-search" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
