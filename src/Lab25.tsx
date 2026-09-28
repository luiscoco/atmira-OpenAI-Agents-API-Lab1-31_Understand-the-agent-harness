import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markdown';
import { AnswerPre } from './Lab6.tsx';
import { CallLog, Findings, codeTokens, readLines } from './Lab22.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { shortId } from './lab13Recovery.ts';
import { checkUrl } from './lab21Search.ts';
import { hasErrors, parseMcpCall, type McpCall } from './lab22Mcp.ts';
import {
  buildEnvironment, judgePluginRun, packPlugin, parsePluginRun, parseTemplate,
  type HostedEnvironment, type InstallMode, type NetworkAccess, type PluginFile, type PluginRun, type PluginVerdict, type TemplateView,
} from './lab25Plugin.ts';
import { samples } from './lab25Scenarios.ts';
import { pluginTests, runPluginSuite, type TestGroup, type TestResult } from './lab25Tests.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string; spoken?: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Suite = { source: 'browser' | 'server'; runtime: string; durationMs: number; results: Record<string, TestResult> };
type Expected = { name: string; signature: string | null; server: string | null };
type RunRecord = { id: string; run: PluginRun; environment: HostedEnvironment | null; expected: Expected };
type LiveRun = { status: string; events: Array<{ name: string; ms: number }>; sessionId: string | null; installed: string[]; calls: McpCall[]; answer: string };

const lessons: Lesson[] = [
  { number: '01', title: 'The plugin folder and its manifest', file: 'plugins/course-docs/.codex-plugin/plugin.json', code: "course-docs/\n├── .codex-plugin/plugin.json\n├── .mcp.json\n├── README.md\n└── skills/cite-docs/SKILL.md\n\n{\n  \"name\": \"course-docs\",\n  \"version\": \"1.0.0\",\n  \"description\": \"Answer OpenAI Agents API questions from the official docs…\",\n  \"skills\": \"./skills/\",\n  \"mcpServers\": \"./.mcp.json\"\n}", explanation: 'A plugin is a folder you can hand to any session. The manifest at dot codex plugin slash plugin dot json says what it is: a name, a semantic version, a one-sentence description, and where its parts live. Both paths start with dot slash and stay inside the folder. The name matters three times: it is the folder inside the ZIP, it is repeated in the session request, and the session lists the installed plugin by it. Bump the version on every change, so you can tell which copy a template holds.' },
  { number: '02', title: 'A skill and an MCP server, bundled together', file: 'plugins/course-docs/skills/cite-docs/SKILL.md', code: "---\nname: cite-docs\ndescription: Answer questions about the OpenAI Agents API from the official documentation…\n---\n1. Search the `openai_docs` MCP server. Fetch the page you rely on.\n3. Link each page inline, using only URLs a tool returned.\n6. End the answer with: `Answered with course-docs/cite-docs.`\n\n// .mcp.json\n{ \"mcpServers\": { \"openai_docs\": { \"type\": \"http\", \"url\": \"https://developers.openai.com/mcp\" } } }", explanation: 'The skill is the how, and the M C P server is the with what. The skill’s frontmatter gives the agent a name and a description, so it knows when to use it. Its body names the openai docs server, so the agent knows which tools to call. The closing line is a teaching trick: only the skill asks for it, so an answer that ends with it proves the instructions were followed. The server needs no credentials. If one did, the file would name an environment variable with bearer token env var, and never hold the token itself.' },
  { number: '03', title: 'Pack it: one top folder, the same bytes every time', file: 'src/lab25Plugin.ts', code: "export function packPlugin(files) {\n  const check = checkPlugin(files);            // manifest, skills, .mcp.json, secrets\n  if (!check.manifest) return { packed: null, check };\n  const root = check.manifest.name;             // course-docs/…\n  const zip = buildZip(files.map((f) => ({ path: `${root}/${f.path}`, data: utf8(f.text) })));\n  // sorted entries, stored, fixed 1980-01-01 timestamp → deterministic\n  return { packed: { entries: readZip(zip), fingerprint: hex8(crc32(zip)), base64: toBase64(zip) }, check };\n}", explanation: 'Before packing, the app checks the folder the way the API will: a manifest, skills with frontmatter, a valid dot M C P dot json, and no secrets or dot env files, because everything in the folder goes into the archive. Then it writes a ZIP with no dependencies. Two rules came from live refusals: the archive must contain exactly one top-level folder, and that folder must contain the manifest. Entries are sorted and share a fixed timestamp, so the same files always give the same bytes, and the fingerprint changes only when a file does.' },
  { number: '04', title: 'Install it inline: environment.plugins', file: 'server/lab25.ts', code: "const session = await client.beta.agents.sessions.create({\n  agent: { model, instructions },\n  environment: {\n    type: 'openai_hosted',\n    network: { access: 'restricted', allowed_domains: ['developers.openai.com'] },\n    plugins: [{ type: 'inline', name, description,\n      source: { type: 'base64', media_type: 'application/zip', data: zipBase64 } }],\n  },\n});\n// session.environment.plugins → [{ type: 'inline', name: 'course-docs', … }]", explanation: 'Plugins install into an execution environment, so the session uses an OpenAI hosted one. Environment type none has no plugins field at all: the API answered unknown parameter. The name and description must match the manifest, or the API refuses with a four hundred. The network is restricted to the one domain the plugin’s server needs, and live, that was enough. The browser only sees a placeholder for the archive; the server adds the bytes at the last moment. The session’s own environment report is the proof: it lists the plugin and a capability directory.' },
  { number: '05', title: 'Store it once: an environment template', file: 'server/lab25.ts', code: "const template = await client.beta.agents.environments.templates.create({\n  name: 'Agents API labs - Lab 25',\n  network: { access: 'restricted', allowed_domains: ['developers.openai.com'] },\n  plugins: [pluginParam(packed, packed.base64)],\n});\n// later, in any new session:\nenvironment: { type: 'openai_hosted', environment_template_id: template.id }\n// templates.update(id, { plugins }) → only NEW sessions get the new version", explanation: 'Inline means every session carries the whole archive again. A template stores the plugin and the network policy once, and each new session names only the template I D. Live, the template session listed the same capability directory hash as the inline one: the same archive, reused. The template’s responses list the plugin’s name and description, never the archive. A session may narrow the template’s network but never widen it; the API refused that with a four hundred. Existing sessions do not reload a plugin, so after an update, start a new session.' },
  { number: '06', title: 'Wait for the environment, then ask', file: 'server/lab25.ts', code: "const session = await sessions.create({ agent, environment });  // no input yet\nconst stream = await sessions.events.stream(session.id);\nfor await (const event of stream) {\n  if (event.type === 'agent.session.environment.ready') await sendQuestion();\n  // mcp_call from openai_docs, text, turn.completed …\n}\n// judge: environment.plugins lists it · its server was called ·\n//        the skill's closing line is there · every link came from a tool", explanation: 'This is the lesson the live runs taught. When the question went in with sessions create, the turn finished in twelve seconds, before the hosted environment was ready, with no skill and no docs server, and the answer was wrong. The environment reported ready about nineteen seconds after the session was created. So the app creates the session without input, opens the event stream, waits for environment ready, and only then sends the question. Then it judges the run from evidence: the installed plugin, calls to the plugin’s server, the skill’s closing line, and links that came from tool results.' },
];

const prompts = [
  'How do I attach a vault to an Agents API session? Give one link.',
  'What does environment_template_id do in an Agents API session? One link.',
  'Use the cite-docs skill: how do I restrict which MCP tools an Agents API session can call?',
];
const groups: Array<{ id: TestGroup; label: string }> = [
  { id: 'manifest', label: 'Read the manifest' },
  { id: 'skill', label: 'Read the skills' },
  { id: 'mcp', label: 'Check the MCP settings and secrets' },
  { id: 'pack', label: 'Pack the archive' },
  { id: 'install', label: 'Build the environment' },
  { id: 'judge', label: 'Judge a run from the session' },
];
const modeInfo: Record<InstallMode, { label: string; note: string }> = {
  inline: { label: 'Inline', note: 'environment.plugins: the archive travels with this session.' },
  template: { label: 'From the template', note: 'environment_template_id: stored once, reused by every new session.' },
  none: { label: 'No plugin', note: 'The same hosted environment with nothing installed, to compare.' },
};
const networkInfo: Record<NetworkAccess, string> = { restricted: 'Only the plugin’s domains', enabled: 'Any domain', disabled: 'No network' };
const outcomeTone: Record<string, string> = { used: 'can', partial: 'gap', early: 'breach', unused: 'gap', missing: 'breach', baseline: 'gap', refused: 'failed', failed: 'failed' };

const json = (value: unknown) => codeTokens(Prism.tokenize(JSON.stringify(value, null, 2) ?? 'undefined', Prism.languages.json || Prism.languages.javascript));
const newId = (): string => `plg_${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)}`;
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const dirHash = (dirs: string[]) => dirs.map((dir) => dir.split('/').pop() ?? dir).join(', ') || '—';
const languageOf = (path: string) => (path.endsWith('.json') ? Prism.languages.json : path.endsWith('.md') ? Prism.languages.markdown : null);

function SafeAnswer({ answer }: { answer: string }) {
  return <div className="lab7-answer lab16-answer lab21-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    pre: AnswerPre,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const check = checkUrl(href ?? '');
      return check.href ? <a href={check.href} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span className="lab21-dead">{children}</span>;
    },
  }}>{answer}</ReactMarkdown></div>;
}

function Checks({ verdict }: { verdict: PluginVerdict }) {
  return <ul className="lab21-findings lab25-checks">{verdict.checks.map((check) => <li key={check.id} className={check.level === 'fail' ? 'error' : check.level}><b>{check.level === 'ok' ? '✓' : check.level === 'skip' ? '–' : check.level === 'warn' ? '!' : '✕'}</b><span><strong>{check.label}.</strong> {check.detail}</span></li>)}</ul>;
}

function RunDetail({ record }: { record: RunRecord }) {
  const { run } = record;
  const verdict = judgePluginRun(run, record.expected);
  return <div className="lab25-run">
    <p className="lab16-prompt-line">“{run.prompt}”</p>
    <p className="lab15-ids"><b>{modeInfo[run.mode].label}</b>{run.sessionId ? <> · session <code>{shortId(run.sessionId)}</code></> : null}{run.templateId ? <> · template <code>{shortId(run.templateId)}</code></> : null} · turn <code>{run.turnStatus}</code> · {seconds(run.durationMs)} · environment ready {seconds(run.readyMs)} · question sent <b>{run.sent === 'early' ? 'right away' : run.sent === 'timeout' ? 'after a timeout' : 'at ready'}</b>{run.completion === 'polled' ? <> · outcome <b>read from the API</b> (the stream went quiet)</> : null}</p>
    <div className={'lab23-judgement ' + outcomeTone[verdict.outcome]}><strong>{verdict.title}</strong><span>{verdict.text}</span></div>
    <Checks verdict={verdict} />
    <div className="lab25-facts">
      <span><small>Installed</small><b>{run.installed.map((plugin) => plugin.name).join(', ') || 'nothing'}</b></span>
      <span><small>Capability directory</small><code>{dirHash(run.capabilityDirs)}</code></span>
      <span><small>Archive fingerprint</small><code>{run.fingerprint ?? 'unknown'}</code></span>
      <span><small>Environment in the request</small><b>{run.requestChars.toLocaleString('en')} characters</b></span>
    </div>
    <div className="lab21-report-grid">
      <div><h3 className="lab13-subhead">Answer</h3>{run.answer ? <SafeAnswer answer={run.answer} /> : <p className="lab8-note">No answer text.</p>}
        {run.error ? <p className="lab2-error" role="alert">{run.error}</p> : null}</div>
      <div><h3 className="lab13-subhead">Plugin’s MCP calls <code>mcp_call</code></h3><CallLog calls={run.calls} /></div>
    </div>
    {record.environment ? <details className="lab16-preview"><summary>The environment, as the browser sees it <small>{record.environment.environment_template_id ? 'environment_template_id' : record.environment.plugins ? 'inline plugin, archive held on the server' : 'no plugin'}</small></summary><pre className="lab19-decl"><code>{json(record.environment)}</code></pre></details> : null}
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

const parseFiles = (raw: unknown): PluginFile[] => (Array.isArray(raw) ? raw.filter((item): item is PluginFile => typeof item?.path === 'string' && typeof item?.text === 'string') : []);

export default function Lab25({ active, health }: { active: boolean; health: Health }) {
  const [disk, setDisk] = useState<PluginFile[]>([]);
  const [files, setFiles] = useState<PluginFile[]>([]);
  const [selected, setSelected] = useState('.codex-plugin/plugin.json');
  const [newPath, setNewPath] = useState('');
  const [template, setTemplate] = useState<TemplateView | null>(null);
  const [templateRaw, setTemplateRaw] = useState<unknown>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<InstallMode>('inline');
  const [network, setNetwork] = useState<NetworkAccess>('restricted');
  const [sendEarly, setSendEarly] = useState(false);
  const [prompt, setPrompt] = useState(prompts[0]);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState(samples[0].id);
  const [suite, setSuite] = useState<Suite | null>(null);
  const [suiteBusy, setSuiteBusy] = useState<'browser' | 'server' | null>(null);
  const [testId, setTestId] = useState(pluginTests[0].id);
  const [error, setError] = useState('');
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const abort = useRef<AbortController | null>(null);
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const { packed, check } = useMemo(() => packPlugin(files), [files]);
  const declared = useMemo(() => buildEnvironment({ mode, network, templateId: template?.id ?? null }, packed, check), [mode, network, template?.id, packed, check]);
  const blocked = hasErrors(declared.findings) || !declared.environment;
  const edited = files.length !== disk.length || files.some((file) => disk.find((item) => item.path === file.path)?.text !== file.text);
  const file = files.find((item) => item.path === selected) ?? files[0] ?? null;
  const expected: Expected = { name: check.manifest?.name ?? 'course-docs', signature: check.skills.find((skill) => skill.signature)?.signature ?? null, server: check.servers[0]?.label ?? null };
  const staleTemplate = Boolean(template && packed && template.fingerprint && template.fingerprint !== packed.fingerprint);
  const chosen = records.find((item) => item.id === selectedId) ?? records.at(-1) ?? null;
  const sample = samples.find((item) => item.id === sampleId) ?? samples[0];
  const test = pluginTests.find((item) => item.id === testId) ?? pluginTests[0];
  const testResult = suite?.results[test.id] ?? null;
  const passed = suite ? Object.values(suite.results).filter((item) => item.pass).length : 0;
  const noKey = !health?.configured;
  const today = new Date().toISOString().slice(0, 10);
  const shownRequest = declared.environment ? { agent: { model: health?.model ?? 'your-model', instructions: `Documentation assistant, ${today}. When a skill covers the question, follow it…` }, environment: declared.environment } : null;

  async function load() {
    setBusy('load'); setError('');
    try {
      const response = await fetch('/api/lab25/plugin');
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(String(body.error ?? `Request failed (${response.status}).`));
      const next = parseFiles(body.files);
      setDisk(next); setFiles(next);
      setTemplate(parseTemplate(body.template));
      setTemplateError(typeof body.templateError === 'string' ? body.templateError : null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not read the plugin.'); }
    finally { setBusy(null); }
  }

  function edit(text: string) { setFiles((previous) => previous.map((item) => (item.path === file?.path ? { ...item, text } : item))); }
  function addFile() {
    const path = newPath.trim();
    if (!path || files.some((item) => item.path === path)) return;
    setFiles((previous) => [...previous, { path, text: path.endsWith('.json') ? '{}\n' : '' }]);
    setSelected(path); setNewPath('');
  }
  function removeFile(path: string) { setFiles((previous) => previous.filter((item) => item.path !== path)); if (selected === path) setSelected('.codex-plugin/plugin.json'); }
  function download() {
    if (!packed) return;
    const binary = atob(packed.base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url; link.download = `${packed.name}-${packed.version}.zip`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function saveTemplate() {
    setBusy('template'); setTemplateError(null);
    try {
      const response = await fetch('/api/lab25/template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files, network }) });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error([body.error, ...((body.findings as Array<{ level: string; text: string }> | undefined) ?? []).filter((item) => item.level === 'error').map((item) => item.text)].filter(Boolean).join(' ') || `Request failed (${response.status}).`);
      setTemplate(parseTemplate(body.template)); setTemplateRaw(body.raw);
    } catch (caught) { setTemplateError(caught instanceof Error ? caught.message : 'Could not save the template.'); }
    finally { setBusy(null); }
  }
  async function deleteTemplate() {
    if (!window.confirm('Delete the Lab 25 environment template? Running sessions keep their environment; new sessions can no longer use its ID.')) return;
    setBusy('delete'); setTemplateError(null);
    try {
      const response = await fetch('/api/lab25/template', { method: 'DELETE' });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(String(body.error ?? `Request failed (${response.status}).`));
      setTemplate(null); setTemplateRaw(null);
      if (mode === 'template') setMode('inline');
    } catch (caught) { setTemplateError(caught instanceof Error ? caught.message : 'Could not delete the template.'); }
    finally { setBusy(null); }
  }

  async function run() {
    const question = prompt.trim();
    if (!question || running || blocked) return;
    const controller = new AbortController();
    abort.current = controller;
    const environment = declared.environment;
    const expectedNow = expected;
    setRunning(true); setError('');
    setLive({ status: 'Starting…', events: [], sessionId: null, installed: [], calls: [], answer: '' });
    try {
      const response = await fetch('/api/lab25/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, network, prompt: question, files, sendEarly }), signal: controller.signal });
      if (!response.ok) {
        const failure = await response.json() as { error?: string; findings?: Array<{ level: string; text: string }> };
        throw new Error([failure.error || `Request failed (${response.status}).`, ...(failure.findings ?? []).filter((item) => item.level === 'error').map((item) => item.text)].join(' '));
      }
      let summary: unknown = null;
      await readLines(response, (line) => {
        if (line.type === 'status' && typeof line.label === 'string') { const status = line.label; setLive((previous) => (previous ? { ...previous, status } : previous)); }
        if (line.type === 'event' && typeof line.name === 'string') { const entry = { name: line.name, ms: Number(line.ms ?? 0) }; setLive((previous) => (previous ? { ...previous, events: [...previous.events, entry].slice(-60) } : previous)); }
        if (line.type === 'session' && typeof line.sessionId === 'string') {
          const id = line.sessionId;
          const installed = Array.isArray(line.installed) ? line.installed.map((item: { name?: unknown }) => String(item?.name ?? '')) : [];
          setLive((previous) => (previous ? { ...previous, sessionId: id, installed } : previous));
        }
        if (line.type === 'call') { const next = parseMcpCall(line.call); setLive((previous) => (previous ? { ...previous, calls: [...previous.calls.filter((item) => item.id !== next.id), next] } : previous)); }
        if (line.type === 'text' && typeof line.text === 'string') { const text = line.text; setLive((previous) => (previous ? { ...previous, answer: text } : previous)); }
        if (line.type === 'summary') summary = line.run;
      });
      if (!summary) throw new Error('The stream ended without a summary.');
      const record: RunRecord = { id: newId(), run: parsePluginRun(summary), environment, expected: expectedNow };
      setRecords((previous) => [...previous, record]);
      setSelectedId(record.id);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error ? caught.message : 'The run failed.');
    } finally {
      if (abort.current === controller) abort.current = null;
      setRunning(false); setLive(null);
    }
  }

  function runInBrowser() {
    setSuiteBusy('browser'); setError('');
    const started = performance.now();
    try {
      const results = runPluginSuite();
      setSuite({ source: 'browser', runtime: 'this browser', durationMs: Math.round(performance.now() - started), results: Object.fromEntries(results.map((item) => [item.id, item])) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The suite crashed.'); }
    finally { setSuiteBusy(null); }
  }
  async function runOnServer() {
    setSuiteBusy('server'); setError('');
    try {
      const response = await fetch('/api/lab25/test', { method: 'POST' });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
      setSuite(parseSuite(body));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not run the suite on the server.'); }
    finally { setSuiteBusy(null); }
  }

  useEffect(() => {
    if (!speechAvailable) return;
    const synthesis = window.speechSynthesis;
    const update = () => setVoices(synthesis.getVoices());
    update(); synthesis.addEventListener('voiceschanged', update);
    return () => synthesis.removeEventListener('voiceschanged', update);
  }, [speechAvailable]);
  useEffect(() => () => { abort.current?.abort(); if (speechAvailable) window.speechSynthesis.cancel(); }, [speechAvailable]);
  useEffect(() => { if (!active) stopSpeech(); }, [active]);
  // Read the plugin folder the first time the lab is opened. Reading sends nothing to OpenAI except the template lookup.
  const loaded = useRef(false);
  useEffect(() => { if (active && !loaded.current) { loaded.current = true; void load(); } }, [active]);

  function stopSpeech() { speechRun.current += 1; if (speechAvailable) window.speechSynthesis.cancel(); setSpeaking(null); }
  // Queue one or more explanations; the run counter ignores callbacks from cancelled narrations.
  function speak(queue: Lesson[], speechMode: 'one' | 'all') {
    if (!speechAvailable) return;
    stopSpeech();
    const current = speechRun.current;
    const narrator = selectNarratorVoice(voices.length ? voices : window.speechSynthesis.getVoices());
    queue.forEach((lesson, index) => {
      const spokenTitle = lesson.title.replace('environment.plugins', 'environment plugins').replace('MCP', 'M C P');
      const utterance = new SpeechSynthesisUtterance(`${speechMode === 'all' ? `Snippet ${Number(lesson.number)}. ` : ''}${spokenTitle}. ${lesson.explanation}`);
      if (narrator) utterance.voice = narrator;
      utterance.lang = narrator?.lang || 'en-US';
      utterance.pitch = narrator && masculineVoiceName.test(narrator.name) ? 1 : 0.78;
      utterance.rate = 0.95;
      utterance.onstart = () => { if (speechRun.current === current) setSpeaking({ mode: speechMode, lesson: lesson.number }); };
      utterance.onerror = () => { if (speechRun.current === current) setSpeaking(null); };
      if (index === queue.length - 1) utterance.onend = () => { if (speechRun.current === current) setSpeaking(null); };
      window.speechSynthesis.speak(utterance);
    });
    setSpeaking({ mode: speechMode, lesson: queue[0].number });
  }
  function readLesson(lesson: Lesson) { if (speaking?.lesson === lesson.number) stopSpeech(); else speak([lesson], 'one'); }
  function readAll() { if (speaking?.mode === 'all') stopSpeech(); else speak(lessons, 'all'); }

  return <div className="lab16-page lab21-page lab22-page lab23-page lab24-page lab25-page">
    <div className="lab2-hero"><span className="lab2-badge lab25-badge">25/50</span><div><div className="eyebrow">LAB 25 / PACKAGE A REUSABLE PLUGIN</div><h1>Bundle a skill and an MCP server <em>once, reuse them everywhere</em>.</h1><p>A plugin is a folder: a manifest, a <b>skill</b> that says how to answer, and <code>.mcp.json</code> that says which server to use. You check it, pack it into a ZIP, and install it in an <b>OpenAI-hosted environment</b>, inline for one session or once in an <b>environment template</b>. Then you prove, from the session itself, that a brand-new session used it.</p></div></div>

    <section className="lab3-guide lab25-flow" aria-label="From folder to session"><h2>From folder to answer</h2><div>
      <article><strong>Folder</strong><p><code>plugins/course-docs</code>: manifest, skill, <code>.mcp.json</code>, README.</p></article>
      <article><strong>Check &amp; pack</strong><p>One top folder, the manifest inside, no secrets. Same files, same fingerprint.</p></article>
      <article><strong>Install</strong><p><code>environment.plugins</code> per session, or a template stored once.</p></article>
      <article><strong>Wait for ready</strong><p>Create the session without input; ask at <code>environment.ready</code>.</p></article>
      <article className="proof"><strong>Prove it</strong><p>Installed, its server called, the skill’s closing line, grounded links.</p></article>
    </div><p className="lab3-guide-note">The browser never holds the archive in a request: it sees a placeholder, a size, and a fingerprint. The server packs the files again and adds the bytes last.</p></section>

    <section className="lab7-card"><span className="eyebrow">THE PLUGIN FOLDER · NO API KEY NEEDED</span><h2>course-docs, file by file</h2>
      <p>Loaded from <code>plugins/course-docs</code> on the server. Edit any file here to see the checks react; the live run and the template use your edited copy. {edited ? <b>You have unsaved edits.</b> : null}</p>
      <div className="lab25-workbench">
        <div className="lab25-tree" role="tablist" aria-label="Plugin files">
          {files.map((item) => <div key={item.path} className="lab25-tree-row"><button type="button" role="tab" aria-selected={item.path === file?.path} className={item.path === file?.path ? 'selected' : ''} onClick={() => setSelected(item.path)}><code>{item.path}</code><small>{new TextEncoder().encode(item.text).length} B</small></button>{disk.some((d) => d.path === item.path) ? null : <button type="button" className="lab25-remove" aria-label={`Remove ${item.path}`} onClick={() => removeFile(item.path)}>×</button>}</div>)}
          <div className="lab25-add"><input className="lab22-input" value={newPath} onChange={(event) => setNewPath(event.target.value)} placeholder="add a file, e.g. .env" spellCheck={false} maxLength={200} aria-label="New file path" /><button type="button" className="lab8-secondary" onClick={addFile} disabled={!newPath.trim()}>Add</button></div>
          <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => setFiles(disk)} disabled={!edited}>Reset to disk</button><button type="button" className="lab8-secondary" onClick={() => void load()} disabled={Boolean(busy)}>Reload</button></div>
        </div>
        <div className="lab25-editor">
          {file ? <>
            <label htmlFor="lab25-file" className="lab24-label"><code>{file.path}</code></label>
            <textarea id="lab25-file" className="lab25-textarea" value={file.text} onChange={(event) => edit(event.target.value)} spellCheck={false} disabled={running} />
            <details className="lab16-preview"><summary>Highlighted</summary><pre className="lab19-decl"><code>{languageOf(file.path) ? codeTokens(Prism.tokenize(file.text, languageOf(file.path)!)) : file.text}</code></pre></details>
          </> : <p className="lab8-note">{busy === 'load' ? 'Loading…' : 'No files.'}</p>}
        </div>
      </div>
      <div className="lab21-config">
        <div><h3 className="lab13-subhead">Checks</h3><Findings findings={check.findings} /></div>
        <div><h3 className="lab13-subhead">What it bundles</h3>
          {check.skills.length ? <ul className="lab24-creds">{check.skills.map((skill) => <li key={skill.path} className="match"><strong>skill · {skill.name}</strong><span>{skill.description}</span><small>{skill.signature ? `closing line: “${skill.signature}”` : 'no closing line'}</small></li>)}</ul> : null}
          {check.servers.length ? <ul className="lab24-creds">{check.servers.map((server) => <li key={server.label} className="match"><strong>MCP · {server.label}</strong><span>{server.type} · {server.url ?? 'stdio'}</span><small>{server.envVar ? `bearer token from $${server.envVar}` : 'no credentials'}</small></li>)}</ul> : null}
          {!check.skills.length && !check.servers.length ? <p className="lab8-note">Nothing yet: fix the errors on the left.</p> : null}
        </div>
      </div>
    </section>

    <section className="lab7-card"><span className="eyebrow">PACK IT · NO API KEY NEEDED</span><h2>The archive the API will open</h2>
      {packed ? <>
        <p className="lab15-ids"><b>{packed.name} {packed.version}</b> · {kb(packed.zipBytes)} zipped · {packed.base64Chars.toLocaleString('en')} base64 characters · fingerprint <code>{packed.fingerprint}</code> (CRC-32 of the ZIP)</p>
        <div className="lab9-table-wrap lab25-zip"><table><thead><tr><th>Path in the ZIP</th><th>Size</th><th>CRC-32</th></tr></thead>
          <tbody>{packed.entries.map((entry) => <tr key={entry.path} className={entry.directory ? 'dir' : ''}><td><code>{entry.path}</code></td><td>{entry.directory ? 'folder' : `${entry.size} B`}</td><td>{entry.directory ? '—' : <code>{entry.crc}</code>}</td></tr>)}</tbody></table></div>
        <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={download}>Download {packed.name}-{packed.version}.zip</button></div>
        <p className="lab8-note">One top-level folder named after the plugin, with the manifest inside. Live, a ZIP with the files at its root got <em>400 capability archives must contain one top-level directory</em>, and one without the manifest got <em>400 plugin archive must contain .codex-plugin/plugin.json</em>.</p>
      </> : <p className="lab2-error">The plugin does not pack: fix the errors above.</p>}
    </section>

    <section className="lab7-card"><span className="eyebrow">INSTALL IT</span><h2>Inline, from a template, or not at all</h2>
      <fieldset className="lab15-modes lab21-modes lab22-modes" disabled={running}><legend>Where the plugin comes from</legend>
        {(Object.keys(modeInfo) as InstallMode[]).map((item) => <label key={item} className={mode === item ? 'selected' : ''}><input type="radio" name="lab25-mode" checked={mode === item} onChange={() => setMode(item)} /><span><strong>{modeInfo[item].label}</strong><small>{modeInfo[item].note}</small></span></label>)}
      </fieldset>
      <fieldset className="lab15-modes lab21-modes lab22-modes lab25-network" disabled={running || mode === 'template'}><legend>environment.network {mode === 'template' ? '(comes from the template)' : ''}</legend>
        {(Object.keys(networkInfo) as NetworkAccess[]).map((item) => <label key={item} className={network === item ? 'selected' : ''}><input type="radio" name="lab25-network" checked={network === item} onChange={() => setNetwork(item)} /><span><strong>{item}</strong><small>{networkInfo[item]}</small></span></label>)}
      </fieldset>
      <div className="lab21-config">
        <div><h3 className="lab13-subhead">What the server sends <code>sessions.create</code></h3>
          {shownRequest ? <pre className="lab19-decl lab21-decl"><code>{json(shownRequest)}</code></pre> : <p className="lab8-note">No request: fix the errors on the right.</p>}
        </div>
        <div><h3 className="lab13-subhead">Findings</h3><Findings findings={declared.findings} />
          {staleTemplate ? <p className="lab20-notice">The template holds fingerprint <code>{template?.fingerprint}</code>; your plugin is now <code>{packed?.fingerprint}</code>. Update the template, then start a new session: existing sessions never reload a plugin.</p> : null}
        </div>
      </div>
      <h3 className="lab13-subhead">Environment template <code>{template ? shortId(template.id) : 'none'}</code></h3>
      <div className="lab8-actions">
        <button type="button" className="lab7-primary" onClick={() => void saveTemplate()} disabled={Boolean(busy) || running || noKey || !packed}>{busy === 'template' ? 'Saving…' : template ? 'Update the template with this plugin' : 'Save the plugin in a template'}</button>
        {template ? <button type="button" className="lab8-secondary lab24-danger" onClick={() => void deleteTemplate()} disabled={Boolean(busy) || running}>Delete the template</button> : null}
      </div>
      {noKey ? <p className="lab8-note">Add OPENAI_API_KEY to .env to create a template or run a session. The workbench, the archive, the inspector, and the test page work without a key.</p> : null}
      {templateError ? <p className="lab2-error">{templateError}</p> : null}
      <div className="lab21-config">
        <div>{template ? <p className="lab15-ids">{template.name} · plugins <b>{template.plugins.map((plugin) => plugin.name).join(', ') || 'none'}</b> · network <b>{template.network.access}</b>{template.network.allowed_domains.length ? ` (${template.network.allowed_domains.join(', ')})` : ''} · holds <b>{template.fingerprint ? `${template.version} · ${template.fingerprint}` : 'unknown version (update it to know)'}</b> · updated {new Date(template.updatedAt * 1000).toLocaleString()}</p> : <p className="lab8-note">No Lab 25 template yet. Templates have no metadata, so the app finds its own by name: <code>Agents API labs - Lab 25</code>.</p>}</div>
        <div>{templateRaw ? <><pre className="lab19-decl lab25-raw"><code>{json(templateRaw)}</code></pre><p className="lab8-note">The API’s response: the plugin’s name and description, never the archive.</p></> : null}</div>
      </div>
    </section>

    <section className="lab7-card"><span className="eyebrow">LIVE · A BRAND-NEW SESSION</span><h2>Ask a question the skill covers</h2>
      <div className="lab16-prompts">{prompts.map((item) => <button type="button" key={item} className={prompt === item ? 'selected' : ''} onClick={() => setPrompt(item)} disabled={running}>{item}</button>)}</div>
      <label htmlFor="lab25-question">Question</label>
      <textarea id="lab25-question" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} disabled={running} />
      <label className="lab23-check lab23-skip"><input type="checkbox" checked={sendEarly} onChange={(event) => setSendEarly(event.target.checked)} disabled={running} /> <span><b>Ask right away</b>: send the question without waiting for <code>environment.ready</code>, to see the race the live runs found.</span></label>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void run()} disabled={running || noKey || blocked || !prompt.trim()}>{running ? 'Running…' : `Run: ${modeInfo[mode].label.toLowerCase()}`}</button>{running ? <button type="button" className="lab8-secondary" onClick={() => abort.current?.abort()}>Stop</button> : null}</div>
      <p className="lab8-note">A hosted environment takes about 20 seconds to get ready, so a run takes 30–60 seconds. Every run is a new session: that is the point of a reusable plugin.</p>
      {live ? <div className="lab24-live"><p className="lab7-session-id">{live.sessionId ? `Session ${shortId(live.sessionId)} · installed: ${live.installed.join(', ') || 'nothing'} · ` : ''}{live.status}</p>
        {live.events.length ? <ol className="lab25-events">{live.events.filter((event) => !/content_part|output_text/.test(event.name)).map((event, index) => <li key={index} className={/environment/.test(event.name) ? 'env' : ''}><code>{event.name.replace('agent.session.', '')}</code><small>{seconds(event.ms)}</small></li>)}</ol> : null}
        {live.calls.length ? <CallLog calls={live.calls} /> : null}
        {live.answer ? <SafeAnswer answer={live.answer} /> : null}</div> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    <section className="lab7-card"><span className="eyebrow">RESULT</span><h2>{chosen ? `Run #${records.indexOf(chosen) + 1}` : 'No run yet'}</h2>
      {chosen ? <RunDetail record={chosen} /> : <p className="lab8-note">Run the same question with No plugin, Inline, and From the template. Then compare what each session installed.</p>}
      {records.length ? <div className="lab9-table-wrap lab15-history lab16-history"><table>
        <thead><tr><th>Run</th><th>Source</th><th>Session</th><th>Installed</th><th>Capability dir</th><th>Fingerprint</th><th>Request</th><th>Ready</th><th>Verdict</th></tr></thead>
        <tbody>{records.map((item, index) => { const verdict = judgePluginRun(item.run, item.expected); return <tr key={item.id} className={item.id === chosen?.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}>
          <th><button type="button" className="lab15-link" onClick={() => setSelectedId(item.id)} aria-pressed={item.id === chosen?.id}>#{index + 1}</button></th>
          <td>{modeInfo[item.run.mode].label}{item.run.sent === 'early' ? <small> · right away</small> : null}</td><td>{item.run.sessionId ? <code>{shortId(item.run.sessionId)}</code> : '—'}</td>
          <td>{item.run.installed.map((plugin) => plugin.name).join(', ') || '—'}</td><td><code>{dirHash(item.run.capabilityDirs)}</code></td><td><code>{item.run.fingerprint ?? '?'}</code></td>
          <td>{item.run.requestChars.toLocaleString('en')}</td><td>{seconds(item.run.readyMs)}</td>
          <td><span className={'lab23-outcome ' + outcomeTone[verdict.outcome]}>{verdict.title}</span></td></tr>; })}</tbody>
      </table></div> : null}
      {records.length > 1 ? <p className="lab8-note">Reuse shows up as the same capability directory and fingerprint in different sessions, and as a much smaller request when the plugin comes from the template.</p> : null}
    </section>

    <section className="lab7-card" id="lab25-inspector"><span className="eyebrow">PLUGIN INSPECTOR · NO API KEY NEEDED</span><h2>Recorded runs, judged from the session</h2>
      <p>{samples.length} runs from live probes on 2026-09-28 with this plugin. The session IDs, environment reports, errors, and answers are real; tool outputs are shortened.</p>
      {(['install', 'refused'] as const).map((group) => <div key={group} className="lab24-sample-group"><span className="lab15-ids">{group === 'install' ? 'Install and use' : 'Refused by the API'}</span><div className="lab16-prompts">{samples.filter((item) => item.group === group).map((item) => <button type="button" key={item.id} className={item.id === sample.id ? 'selected' : ''} onClick={() => setSampleId(item.id)}>{item.label}</button>)}</div></div>)}
      <p className="lab8-note">{sample.lesson}</p>
      <RunDetail record={{ id: sample.id, run: sample.run, environment: sample.environment, expected: { name: 'course-docs', signature: 'Answered with course-docs/cite-docs.', server: 'openai_docs' } }} />
    </section>

    <section className="lab7-card" id="lab25-tests"><span className="eyebrow">TEST PAGE · NO API KEY NEEDED</span><h2>{pluginTests.length} cases, one function each</h2><p>Every case runs the real <code>parseManifest</code>, <code>parseSkill</code>, <code>parseMcpConfig</code>, <code>checkPlugin</code>, <code>buildZip</code>, <code>readZip</code>, <code>packPlugin</code>, <code>buildEnvironment</code>, or <code>judgePluginRun</code>, in this browser or on the server. Notes marked <em>Live</em> repeat what the API did on 2026-09-28.</p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={runInBrowser} disabled={Boolean(suiteBusy)}>{suiteBusy === 'browser' ? 'Running…' : 'Run all in the browser'}</button><button type="button" className="lab8-secondary" onClick={() => void runOnServer()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'server' ? 'Running…' : 'Run all on the server'}</button></div>
      {suite ? <p className={'lab18-score ' + (passed === pluginTests.length ? 'ok' : 'fail')}><b>{passed}/{pluginTests.length} passed</b> · ran in {suite.runtime} · {suite.durationMs} ms</p> : <p className="lab8-note">Not run yet. Each row states the result it must produce.</p>}
      <div className="lab18-tests">
        <div className="lab9-table-wrap lab18-table lab21-table"><table>
          <thead><tr><th>Case</th><th>Expect</th><th>Got</th><th /></tr></thead>
          {groups.map((group) => <tbody key={group.id}><tr className="lab18-group"><th colSpan={4}>{group.label}</th></tr>{pluginTests.filter((item) => item.group === group.id).map((item) => { const result = suite?.results[item.id]; return <tr key={item.id} className={item.id === test.id ? 'selected' : ''} onClick={() => setTestId(item.id)}>
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

    <section className="lab3-guide lab16-guide"><h2>Read the evidence</h2><div><article><strong>Installed</strong><p><code>session.environment.plugins</code> lists it, with a capability directory. The request alone proves nothing.</p></article><article><strong>Ready first</strong><p>A question sent before <code>environment.ready</code> runs without the skill or its servers.</p></article><article><strong>Used</strong><p>Calls to the plugin’s server, and the skill’s closing line in the answer.</p></article><article><strong>Reused</strong><p>Same capability directory and fingerprint across new sessions; a template request carries no archive.</p></article></div><p className="lab3-guide-note">Keep secrets out of plugin files: everything in the folder is copied into every session and template that uses it.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 25</span><span className="code-lessons-title" role="heading" aria-level={2}>The code that packages and installs a plugin</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Write the manifest, bundle a skill with an MCP server, pack a deterministic ZIP, install it inline, store it once in a template, and wait for the environment before asking. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Run the test page on the server and show <em>{pluginTests.length}/{pluginTests.length} passed</em>. In the workbench, add a <code>.env</code> file, put a literal <code>Authorization</code> header in <code>.mcp.json</code>, and rename <code>mcpServers</code>: explain each finding. Then, live: ask the same question with <em>No plugin</em>, <em>Inline</em>, and <em>From the template</em>, and use the capability directory and fingerprint columns to show that two new sessions used the same package. Try <em>Ask right away</em> once and explain the verdict. Finally, change the skill, bump the version to 1.0.1, update the template, and show which sessions got the new version.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/tools/plugins" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
