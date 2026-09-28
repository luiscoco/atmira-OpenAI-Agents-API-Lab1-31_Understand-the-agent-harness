import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import { AnswerPre } from './Lab6.tsx';
import { Findings, codeTokens, readLines } from './Lab22.tsx';
import { CommandLog } from './Lab26.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { shortId } from './lab13Recovery.ts';
import { checkUrl } from './lab21Search.ts';
import { parseCommand, type CommandRun, type NetworkAccess } from './lab26Environment.ts';
import { parseFileRef, type FileRef } from './lab27Files.ts';
import {
  buildEnvironment, checkConfig, checkRequest, comparison, expectedAudit, fingerprint, grounded, hostEvidence, hosts, installEvidence, judgeConfigRun, lockPath,
  outcomeTone, parseAudit, parseConfigRun, parseEcho, policyDocument, presets, provisionReason, setupCommands, taskInfo, unpinned,
  type Config, type ConfigRun, type Echo, type HostId, type Preset, type Setup, type Task,
} from './lab28Packages.ts';
import { requestSamples, samples } from './lab28Scenarios.ts';
import { packageTests, runPackageSuite, type TestGroup, type TestResult } from './lab28Tests.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Suite = { source: 'browser' | 'server'; runtime: string; durationMs: number; results: Record<string, TestResult> };
type RunRecord = { id: string; run: ConfigRun; source: 'live' | 'recorded' };
type LiveRun = { label: string; status: string; events: Array<{ name: string; ms: number }>; sessionId: string | null; echo: Echo | null; listed: FileRef[] | null; commands: CommandRun[]; answer: string };
type Probe = { status: number; message: string } | null;

const lessons: Lesson[] = [
  { number: '01', title: 'Declare pinned packages', file: 'src/lab28Packages.ts', code: "const session = await client.beta.agents.sessions.create({\n  agent: { model, instructions },\n  environment: {\n    type: 'openai_hosted',\n    network: { access: 'disabled' },\n    packages: { python: ['tabulate==0.9.0'], system: ['jq'] },\n  },\n});\nsession.environment.packages  // { python: ['tabulate==0.9.0'], system: ['jq'], npm: [] }", explanation: 'Packages are part of the environment, not something the agent installs mid-task. List them under packages, with python, system, and npm lists, and pin every version you rely on: tabulate equals equals zero point nine point zero, not just tabulate. The platform installs them before environment ready, even with the network disabled. Live, the sandbox took about twenty seconds with nothing declared and up to thirty three with tabulate and j q. The session echoes each package exactly as written: that echo is your first evidence.' },
  { number: '02', title: 'Choose a network policy', file: 'src/lab28Packages.ts', code: "network: { access: 'disabled' }            // no outbound connections\nnetwork: { access: 'restricted',\n           allowed_domains: ['pypi.org', 'files.pythonhosted.org'] }\nnetwork: { access: 'enabled' }             // every host: the beta default\n\n// Refused live (400):\n'*.pypi.org'             // wildcard allowed_domains are not supported\n'https://pypi.org'       // contains an invalid host (so do a path or :443)\n{ access: 'disabled', allowed_domains: [...] }  // cannot be set when disabled\n{ blocked_domains: [...] }  // not enabled for this organization", explanation: 'Network access has three modes. Disabled blocks everything. Restricted allows only the exact host names you list, up to one hundred. Enabled allows every host, and it is what beta requests get when you say nothing, so always say something. The A P I checks the policy before it creates the session: a wildcard, a U R L, a path, or a port is a four hundred, and so is a list of domains with access disabled. A blocklist is in the types, but this organization cannot use it. Allow what the task needs instead.' },
  { number: '03', title: 'Run a confidential setup command', file: 'server/lab28.ts', code: "setup_commands: [{ command: 'mkdir -p /workspace/env && python3 -m pip freeze > /workspace/env/requirements.lock' }]\n// Not in session.environment: setup bodies are never echoed.\n\n// On environment.ready, ask the API (not the agent) what setup left behind:\nconst page = await client.beta.agents.environments.files.list(environmentId, { path: '/workspace/env' });\n// → [{ path: '/workspace/env/requirements.lock', size_bytes: 129 }]\n\n// A failing setup command ('exit 3'), live:\n// environment.failed · environment_connection_failed · 'The environment failed to connect.'", explanation: 'Setup commands run in order after packages and input files, before the agent starts. At most sixteen are accepted. Their bodies are confidential: the session never echoes them, so your own records must hold them. This one writes a lock file with pip freeze. On environment ready, the server lists slash workspace slash env through the A P I, and live the lock file was there, one hundred twenty nine bytes. A nonzero exit stops the agent from starting, and the A P I says only that the environment failed to connect. Test setup in a bare sandbox first.' },
  { number: '04', title: 'Verify from inside the sandbox', file: 'src/lab28Packages.ts', code: "// The audit prompt asks for curl's own status code for each host:\n// curl -sS -m 8 -o /dev/null -w \"%{http_code}\" https://pypi.org/simple/tabulate/\n\nhostEvidence(run.commands, 'pypi')\n// restricted: { code: '200', reach: 'reachable' }\n// disabled:   { code: '000', reach: 'blocked' }   // curl: (56) CONNECT tunnel failed, response 403\n// Live, pinned run: the agent's script printed 'pypi: reachable (000)'.\n// The code says blocked; the label was wrong.", explanation: 'A policy in a request is a claim. The audit checks it from inside the sandbox: python, tabulate, and j q versions, the lock file, and one curl per host that prints the H T T P status code. A code such as two hundred means the host answered. Three zeros means no connection: the sandbox proxy refused it, and curl’s error line mentions a four oh three from the proxy, not from the site. Read the code, not the label. Live, the agent’s own script printed reachable next to three zeros. Its reply said blocked, which is what the code meant.' },
  { number: '05', title: 'An allowlist needs every host', file: 'src/lab28Packages.ts', code: "// allowed_domains: ['pypi.org']\n// pip install tabulate==0.9.0 → exit 1 after 8.0 s:\n//   HTTPSConnectionPool(host='files.pythonhosted.org', port=443)\n//   … ProxyError('Tunnel connection failed: 403 Forbidden')\n\n// allowed_domains: ['pypi.org', 'files.pythonhosted.org']\n// → exit 0 in 0.8 s: Successfully installed tabulate-0.9.0\ninstallEvidence(run.commands).blockedHost  // 'files.pythonhosted.org'", explanation: 'Restricted access matches exact host names, and one service often uses several. Live, with only pypi dot org allowed, pip read the package index and was then sent to files dot python hosted dot org for the file. The proxy refused it, and pip gave up after three retries. Adding the download host made the same command succeed in under a second. Read the failing host from the tool’s own error, add it with a reason, and run again. Better still, declare the package: then the task needs no network at all.' },
  { number: '06', title: 'Reproduce it, and document the policy', file: 'src/lab28Packages.ts', code: "fingerprint(buildEnvironment(config))  // sha256 of the canonical request, 12 hex\n// pinned  30406fcf7381 → tabulate 0.9.0, twice, in two sandboxes\n// unpinned 30a783735444 → tabulate 0.10.0\n\npolicyDocument(run, '2026-09-28')\n// # Sandbox policy · environment b651a11ae106\n// | Allowed host | Why |   · packages declared, pinned, observed\n// | Check | Policy says | Sandbox showed |   · the environment JSON to reproduce it", explanation: 'Reproducible means the same request gives the same sandbox. The app fingerprints the exact environment it sends. Live, the pinned configuration installed tabulate zero point nine point zero in two separate sandboxes. The unpinned one installed zero point ten point zero, whatever the index served that day. Then the app writes the network policy down: every allowed host with the reason it is there, the packages with what was observed, the setup command the A P I will not echo, the checks the sandbox passed, and the request to run it again.' },
];

const groups: Array<{ id: TestGroup; label: string }> = [
  { id: 'config', label: 'Build a configuration and fingerprint it' },
  { id: 'request', label: 'Check packages, hosts, and setup like the API' },
  { id: 'evidence', label: 'Read the sandbox’s evidence' },
  { id: 'judge', label: 'Judge a run from its evidence' },
  { id: 'policy', label: 'Write the policy document' },
];
const ecosystems = ['python', 'system', 'npm'] as const;
const accesses: NetworkAccess[] = ['disabled', 'restricted', 'enabled'];
const setups: Array<{ id: Setup; label: string }> = [{ id: 'lock', label: 'Write a lock file (pip freeze)' }, { id: 'none', label: 'No setup command' }, { id: 'fail', label: 'A failing command (exit 3)' }];
const presetIds = Object.keys(presets) as Preset[];
const today = '2026-09-28';

const json = (value: unknown) => codeTokens(Prism.tokenize(JSON.stringify(value, null, 2) ?? 'undefined', Prism.languages.json || Prism.languages.javascript));
const newId = (): string => `run_${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)}`;
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const tokens = (value: number | null | undefined) => (value === null || value === undefined ? 'unknown' : value.toLocaleString('en'));
const toLines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);
const labelFor = (run: ConfigRun) => (run.preset && same(run.config, presets[run.preset].config) ? presets[run.preset].label : 'Custom configuration');
const same = (a: Config, b: Config) => JSON.stringify(buildEnvironment(a)) === JSON.stringify(buildEnvironment(b));

// Single newlines become Markdown hard breaks, so the six audit lines stay on six lines.
function SafeAnswer({ answer }: { answer: string }) {
  return <div className="lab7-answer lab16-answer lab21-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    pre: AnswerPre,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const check = checkUrl(href ?? '');
      return check.href ? <a href={check.href} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span className="lab21-dead" title={href}>{children}</span>;
    },
  }}>{answer.replace(/([^\n])\n(?=[^\n])/g, '$1  \n')}</ReactMarkdown></div>;
}

function Checks({ run }: { run: ConfigRun }) {
  const verdict = judgeConfigRun(run);
  return <>
    <div className={'lab23-judgement ' + outcomeTone[verdict.outcome]}><strong>{verdict.title}</strong><span>{verdict.text}</span></div>
    <ul className="lab21-findings lab25-checks">{verdict.checks.map((check) => <li key={check.id} className={check.level === 'fail' ? 'error' : check.level}><b>{check.level === 'ok' ? '✓' : check.level === 'skip' ? '–' : check.level === 'warn' ? '!' : '✕'}</b><span><strong>{check.label}.</strong> {check.detail}</span></li>)}</ul>
  </>;
}

const Mark = ({ ok }: { ok: boolean | null }) => (ok === null ? <span className="lab27-na">—</span> : <span className={'lab18-pass ' + (ok ? 'ok' : 'fail')}>{ok ? 'MATCH' : 'NO'}</span>);
const list = (items: string[]) => (items.length ? items.map((item) => <code key={item}>{item}</code>) : <span className="lab27-na">none</span>);

function EchoTable({ run }: { run: ConfigRun }) {
  const sent = buildEnvironment(run.config, run.task);
  const echo = run.echo;
  const listedLock = run.listed?.find((file) => file.path === lockPath) ?? null;
  const rows: Array<[string, React.ReactNode, React.ReactNode, boolean | null]> = [
    ...ecosystems.map((key): [string, React.ReactNode, React.ReactNode, boolean | null] => [`packages.${key}`, list(sent.packages?.[key] ?? []), echo ? list(echo.packages[key]) : '—', echo ? JSON.stringify(echo.packages[key]) === JSON.stringify(sent.packages?.[key] ?? []) : null]),
    ['network.access', <code>{sent.network.access}</code>, echo ? <code>{echo.network.access}</code> : '—', echo ? echo.network.access === sent.network.access : null],
    ['allowed_domains', list(sent.network.allowed_domains ?? []), echo ? list(echo.network.allowed_domains) : '—', echo ? JSON.stringify(echo.network.allowed_domains) === JSON.stringify(sent.network.allowed_domains ?? []) : null],
    ['setup_commands', sent.setup_commands ? `${sent.setup_commands.length} command` : <span className="lab27-na">none</span>, sent.setup_commands ? <em>not echoed (confidential)</em> : '—', null],
  ];
  return <div className="lab9-table-wrap lab28-table"><table>
    <thead><tr><th>Field</th><th>This app sent</th><th><code>session.environment</code></th><th /></tr></thead>
    <tbody>{rows.map(([name, sentCell, echoCell, ok]) => <tr key={name}><th><code>{name}</code></th><td>{sentCell}</td><td>{echoCell}</td><td><Mark ok={ok} /></td></tr>)}
      {run.task === 'audit' && run.config.setup === 'lock' ? <tr><th><code>{lockPath}</code></th><td>written by setup</td><td>{run.listed === null ? <span className="lab27-na">not listed</span> : listedLock ? <><code>environments.files.list</code>: {listedLock.sizeBytes} bytes</> : <span className="lab27-no">absent</span>}</td><td><Mark ok={run.listed === null ? null : Boolean(listedLock)} /></td></tr> : null}</tbody>
  </table></div>;
}

function AuditTable({ run }: { run: ConfigRun }) {
  const audit = parseAudit(run.answer);
  const expected = expectedAudit(run.config);
  const version = (value: string | null) => (value === null ? null : value === 'none' ? 'none' : grounded(value, run.commands) ? `printed ${value}` : 'not in any output');
  const host = (id: HostId) => { const evidence = hostEvidence(run.commands, id); return evidence.code ? `${evidence.code} → ${evidence.reach}${evidence.mislabeled ? ' (labelled “reachable”)' : ''}` : 'not traced'; };
  const versionOk = (value: string | null, want: string) => (value === null ? false : want === 'any' ? value !== 'none' : want === 'present' ? value !== 'none' : value === want);
  const rows: Array<[string, string | null, string, string, boolean]> = [
    ['python', audit.python, version(audit.python) ?? '—', 'any', audit.python !== null],
    ['tabulate', audit.tabulate, version(audit.tabulate) ?? '—', expected.tabulate, versionOk(audit.tabulate, expected.tabulate)],
    ['jq', audit.jq, version(audit.jq) ?? '—', expected.jq, versionOk(audit.jq, expected.jq)],
    ['lock_file', audit.lockFile, run.listed === null ? 'not listed' : run.listed.some((file) => file.path === lockPath) ? 'listed by the API' : 'not listed by the API', expected.lockFile, audit.lockFile === expected.lockFile],
    ...(Object.keys(hosts) as HostId[]).map((id): [string, string | null, string, string, boolean] => [id, audit[id], host(id), expected[id], audit[id] === expected[id] && (hostEvidence(run.commands, id).reach ?? audit[id]) === expected[id]]),
  ];
  return <div className="lab9-table-wrap lab28-table"><table>
    <thead><tr><th>Line</th><th>The reply says</th><th>A command printed</th><th>The configuration expects</th><th /></tr></thead>
    <tbody>{rows.map(([name, said, evidence, want, ok]) => <tr key={name}><th><code>{name}</code></th><td>{said === null ? <em>missing</em> : <code>{said}</code>}</td><td>{evidence}</td><td><code>{want}</code></td><td><Mark ok={ok} /></td></tr>)}</tbody>
  </table></div>;
}

function RunDetail({ record }: { record: RunRecord }) {
  const { run } = record;
  const stopped = Boolean(run.error) || run.turnStatus === 'failed' || run.turnStatus === 'cancelled';
  const install = run.task === 'install' ? installEvidence(run.commands) : null;
  const declared = [...run.config.python, ...run.config.system, ...run.config.npm];
  return <div className="lab25-run">
    <p className="lab15-ids"><b>{labelFor(run)}</b> · <b>{taskInfo[run.task].label}</b> · environment <code>{run.fingerprint}</code>{run.sessionId ? <> · session <code>{shortId(run.sessionId)}</code></> : null} · turn <code>{run.turnStatus}</code>{run.completion === 'polled' ? <> · outcome <b>read from the API</b></> : null}</p>
    <Checks run={run} />
    <div className="lab25-facts">
      <span><small>Declared</small><b>{run.task === 'install' ? 'no packages' : `${declared.length} package${declared.length === 1 ? '' : 's'}`}</b><small>network {run.config.access}{run.config.access === 'restricted' ? ` · ${run.config.domains.length} host${run.config.domains.length === 1 ? '' : 's'}` : ''}</small></span>
      <span><small>Sandbox ready</small><b>{seconds(run.readyMs)}</b></span>
      <span><small>Total time</small><b>{seconds(run.durationMs)}</b></span>
      <span><small>Tokens</small><b>{tokens(run.usage?.total)}</b>{run.usage ? <small>{tokens(run.usage.input)} in · {tokens(run.usage.output)} out</small> : <small>not reported (best-effort)</small>}</span>
    </div>
    <h3 className="lab13-subhead">Declared, and what the API echoed</h3>
    <EchoTable run={run} />
    {run.task === 'audit' && !run.error ? <><h3 className="lab13-subhead">The audit, line by line</h3><AuditTable run={run} /></> : null}
    {install?.command ? <p className="lab8-note"><code>pip install</code>: exit {install.command.exitCode ?? '—'} in {seconds(install.command.durationMs)}{install.blockedHost ? <> · could not reach <code>{install.blockedHost}</code></> : install.succeeded ? ' · Successfully installed' : ''}</p> : null}
    {run.errorKind === 'provision' && run.error ? <><h3 className="lab13-subhead">Why the sandbox never became ready</h3><pre className="lab19-decl lab25-raw lab27-refused"><code>{run.error}</code></pre>{provisionReason(run.error) ? <p className="lab8-note">pip’s reason: <code>{provisionReason(run.error)}</code></p> : null}</> : null}
    <div className="lab21-report-grid">
      <div><h3 className="lab13-subhead">Reply</h3>{run.answer ? <SafeAnswer answer={run.answer} /> : <p className="lab8-note">No answer text.</p>}
        {run.commentary.length ? <><h3 className="lab13-subhead">Commentary <small>(a claim, not evidence)</small></h3><ul className="lab26-commentary">{run.commentary.map((line, index) => <li key={index}>{line}</li>)}</ul></> : null}
        {run.error && run.errorKind !== 'provision' ? <p className="lab2-error" role="alert">{run.error}</p> : null}</div>
      <div><h3 className="lab13-subhead">Evidence <code>command_execution</code></h3><CommandLog commands={run.commands} kind="openai_hosted" stopped={stopped} /></div>
    </div>
    <details className="lab16-preview"><summary>The prompt</summary><pre className="lab19-decl lab27-prompt">{run.prompt}</pre></details>
    <details className="lab16-preview"><summary>The environment the server sent</summary><pre className="lab19-decl"><code>{json(buildEnvironment(run.config, run.task))}</code></pre></details>
  </div>;
}

function PolicyDoc({ run, config, task, model }: { run: ConfigRun | null; config: Config; task: Task; model: string }) {
  const markdown = run ? policyDocument(run, today) : policyDocument({ config, task, model }, today);
  const [copied, setCopied] = useState(false);
  const name = `sandbox-policy-${run?.fingerprint ?? fingerprint(buildEnvironment(config, task))}.md`;
  function download() {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  async function copy() { try { await navigator.clipboard.writeText(markdown); setCopied(true); setTimeout(() => setCopied(false), 1_500); } catch { setCopied(false); } }
  return <>
    <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={download}>Download {name}</button><button type="button" className="lab8-secondary" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy Markdown'}</button></div>
    <div className="lab28-doc"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{markdown}</ReactMarkdown></div>
  </>;
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

export default function Lab28({ active, health }: { active: boolean; health: Health }) {
  const [config, setConfig] = useState<Config>(presets.pinned.config);
  const [presetId, setPresetId] = useState<Preset | null>('pinned');
  const [task, setTask] = useState<Task>('audit');
  const [editor, setEditor] = useState(() => JSON.stringify(requestSamples[0].environment, null, 2));
  const [requestId, setRequestId] = useState<string | null>(requestSamples[0].id);
  const [probe, setProbe] = useState<Probe>(null);
  const [probing, setProbing] = useState(false);
  const [live, setLive] = useState<Record<string, LiveRun>>({});
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState(samples[0].id);
  const [docSource, setDocSource] = useState<'run' | 'config'>('run');
  const [suite, setSuite] = useState<Suite | null>(null);
  const [suiteBusy, setSuiteBusy] = useState<'browser' | 'server' | null>(null);
  const [testId, setTestId] = useState(packageTests[0].id);
  const [error, setError] = useState('');
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const aborts = useRef<Set<AbortController>>(new Set());
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const configCheck = useMemo(() => checkConfig(config), [config]);
  const environment = useMemo(() => buildEnvironment(config, task), [config, task]);
  const print = useMemo(() => fingerprint(environment), [environment]);
  const expected = useMemo(() => expectedAudit(config), [config]);
  const parsedEditor = useMemo(() => { try { return { value: JSON.parse(editor) as unknown, error: null }; } catch (caught) { return { value: null, error: caught instanceof Error ? caught.message : 'Invalid JSON.' }; } }, [editor]);
  const editorCheck = useMemo(() => (parsedEditor.error ? { environment: null, findings: [{ level: 'error' as const, text: `Not JSON: ${parsedEditor.error}` }] } : checkRequest(parsedEditor.value)), [parsedEditor]);
  const requestSample = requestSamples.find((item) => item.id === requestId) ?? null;
  const running = Object.keys(live).length > 0;
  const chosen = records.find((item) => item.id === selectedId) ?? records.at(-1) ?? null;
  const sample = samples.find((item) => item.id === sampleId) ?? samples[0];
  const test = packageTests.find((item) => item.id === testId) ?? packageTests[0];
  const testResult = suite?.results[test.id] ?? null;
  const passed = suite ? Object.values(suite.results).filter((item) => item.pass).length : 0;
  const noKey = !health?.configured;
  const model = health?.model ?? '';
  const lastError = records.at(-1)?.run.error ?? null;
  const accountLimited = lastError && /usage or billing limit|insufficient_quota|billing/i.test(lastError) ? lastError.split('. ')[0] : null;
  // Reproducibility: every audit that produced versions, live and recorded, grouped by environment fingerprint.
  const reproRows = useMemo(() => {
    const audits = [...samples.map((item): RunRecord => ({ id: item.id, run: item.run, source: 'recorded' })), ...records].filter((item) => item.run.task === 'audit' && !item.run.error && parseAudit(item.run.answer).tabulate !== null);
    const byPrint = new Map<string, RunRecord[]>();
    for (const item of audits) byPrint.set(item.run.fingerprint, [...(byPrint.get(item.run.fingerprint) ?? []), item]);
    return [...byPrint.entries()].map(([key, items]) => {
      const versions = items.map((item) => parseAudit(item.run.answer));
      const tabulate = [...new Set(versions.map((item) => item.tabulate ?? '—'))];
      const jq = [...new Set(versions.map((item) => item.jq ?? '—'))];
      const net = [...new Set(versions.map((item) => `${item.pypi ?? '—'}/${item.example ?? '—'}`))];
      return { key, items, tabulate, jq, net, config: items[0].run.config, stable: tabulate.length === 1 && jq.length === 1 && net.length === 1 };
    });
  }, [records]);

  function update(patch: Partial<Config>) { setConfig((previous) => ({ ...previous, ...patch })); setPresetId(null); }
  function loadPreset(id: Preset) { setConfig(presets[id].config); setPresetId(id); }
  function loadRequest(id: string) { const item = requestSamples.find((entry) => entry.id === id); if (!item) return; setRequestId(id); setProbe(null); setEditor(JSON.stringify(item.environment, null, 2)); }

  // One task in one new hosted session. Several may run at once; each has its own live pane.
  async function runOne(runConfig: Config, runPreset: Preset | null, runTask: Task) {
    const controller = new AbortController();
    aborts.current.add(controller);
    const key = newId();
    const label = runPreset && same(runConfig, presets[runPreset].config) ? presets[runPreset].label : 'Custom configuration';
    setLive((previous) => ({ ...previous, [key]: { label: `${label} · ${taskInfo[runTask].label.toLowerCase()}`, status: 'Starting…', events: [], sessionId: null, echo: null, listed: null, commands: [], answer: '' } }));
    const patch = (next: Partial<LiveRun> | ((current: LiveRun) => Partial<LiveRun>)) => setLive((previous) => {
      const current = previous[key];
      return current ? { ...previous, [key]: { ...current, ...(typeof next === 'function' ? next(current) : next) } } : previous;
    });
    try {
      const response = await fetch('/api/lab28/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: runConfig, preset: runPreset, task: runTask }), signal: controller.signal });
      if (!response.ok) {
        const failure = await response.json() as { error?: string; findings?: Array<{ level: string; text: string }> };
        throw new Error([failure.error || `Request failed (${response.status}).`, ...(failure.findings ?? []).filter((item) => item.level === 'error').map((item) => item.text)].join(' '));
      }
      let summary: unknown = null;
      await readLines(response, (line) => {
        if (line.type === 'status' && typeof line.label === 'string') patch({ status: line.label });
        if (line.type === 'event' && typeof line.name === 'string') { const entry = { name: line.name, ms: Number(line.ms ?? 0) }; patch((current) => ({ events: [...current.events, entry].slice(-60) })); }
        if (line.type === 'session' && typeof line.sessionId === 'string') patch({ sessionId: line.sessionId, echo: parseEcho(line.echo) });
        if (line.type === 'listed' && Array.isArray(line.files)) patch({ listed: line.files.map(parseFileRef) });
        if (line.type === 'command') { const next = parseCommand(line.command); patch((current) => ({ commands: [...current.commands.filter((item) => item.id !== next.id), next] })); }
        if (line.type === 'text' && typeof line.text === 'string') patch({ answer: line.text });
        if (line.type === 'summary') summary = line.run;
      });
      if (!summary) throw new Error('The stream ended without a summary.');
      const record: RunRecord = { id: key, run: parseConfigRun(summary), source: 'live' };
      setRecords((previous) => [...previous, record]);
      setSelectedId(record.id);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error ? caught.message : 'The run failed.');
    } finally {
      aborts.current.delete(controller);
      setLive((previous) => { const next = { ...previous }; delete next[key]; return next; });
    }
  }
  async function runComparison() { setError(''); await Promise.all(comparison.map((id) => runOne(presets[id].config, id, 'audit'))); }
  async function runInstallPair() { setError(''); await Promise.all([runOne({ ...presets.restricted.config, domains: ['pypi.org'] }, null, 'install'), runOne(presets.restricted.config, 'restricted', 'install')]); }
  function stopAll() { aborts.current.forEach((controller) => controller.abort()); }
  async function sendProbe() {
    setProbing(true); setProbe(null); setError('');
    try {
      const response = await fetch('/api/lab28/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ environment: parsedEditor.value }) });
      const body = await response.json() as { status?: number; message?: string; error?: string };
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      setProbe({ status: Number(body.status ?? 0), message: String(body.message ?? '') });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not send the request.'); }
    finally { setProbing(false); }
  }

  function runInBrowser() {
    setSuiteBusy('browser'); setError('');
    const started = performance.now();
    try {
      const results = runPackageSuite();
      setSuite({ source: 'browser', runtime: 'this browser', durationMs: Math.round(performance.now() - started), results: Object.fromEntries(results.map((item) => [item.id, item])) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The suite crashed.'); }
    finally { setSuiteBusy(null); }
  }
  async function runOnServer() {
    setSuiteBusy('server'); setError('');
    try {
      const response = await fetch('/api/lab28/test', { method: 'POST' });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
      setSuite(parseSuite(body));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not run the suite on the server.'); }
    finally { setSuiteBusy(null); }
  }

  useEffect(() => {
    if (!speechAvailable) return;
    const synthesis = window.speechSynthesis;
    const refresh = () => setVoices(synthesis.getVoices());
    refresh(); synthesis.addEventListener('voiceschanged', refresh);
    return () => synthesis.removeEventListener('voiceschanged', refresh);
  }, [speechAvailable]);
  useEffect(() => () => { aborts.current.forEach((controller) => controller.abort()); if (speechAvailable) window.speechSynthesis.cancel(); }, [speechAvailable]);
  useEffect(() => { if (!active) stopSpeech(); }, [active]);

  function stopSpeech() { speechRun.current += 1; if (speechAvailable) window.speechSynthesis.cancel(); setSpeaking(null); }
  // Queue one or more explanations; the run counter ignores callbacks from cancelled narrations.
  function speak(queue: Lesson[], speechMode: 'one' | 'all') {
    if (!speechAvailable) return;
    stopSpeech();
    const current = speechRun.current;
    const narrator = selectNarratorVoice(voices.length ? voices : window.speechSynthesis.getVoices());
    queue.forEach((lesson, index) => {
      const utterance = new SpeechSynthesisUtterance(`${speechMode === 'all' ? `Snippet ${Number(lesson.number)}. ` : ''}${lesson.title}. ${lesson.explanation}`);
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

  const latest = (id: Preset) => [...records].reverse().find((item) => item.run.preset === id && item.run.task === 'audit' && same(item.run.config, presets[id].config)) ?? null;
  const docRun = docSource === 'run' ? chosen?.run ?? null : null;

  return <div className="lab16-page lab21-page lab22-page lab23-page lab25-page lab26-page lab27-page lab28-page">
    <div className="lab2-hero"><span className="lab2-badge lab28-badge">28/50</span><div><div className="eyebrow">LAB 28 / CONFIGURE PACKAGES AND NETWORK</div><h1>Pin what it needs, <em>allow only what it reaches</em>.</h1><p>An <code>openai_hosted</code> sandbox is built from its <code>environment</code>: <code>packages</code> installed before it is ready, <code>setup_commands</code> run before the agent starts, and a <code>network</code> policy that is <code>disabled</code>, <code>restricted</code> to named hosts, or <code>enabled</code>. Declare them, verify each one from inside the sandbox, and write the policy down so the same request gives the same sandbox next time.</p></div></div>

    <section className="lab3-guide lab25-flow lab28-flow" aria-label="From configuration to documented policy"><h2>From configuration to documented policy</h2><div>
      <article><strong>Pin</strong><p><code>packages.python</code>, <code>system</code>, <code>npm</code>, each with an exact version where it can have one.</p></article>
      <article><strong>Policy</strong><p><code>network.access</code>: <code>disabled</code>, or <code>restricted</code> to the hosts the task names.</p></article>
      <article><strong>Setup</strong><p>Ordered, confidential <code>setup_commands</code>. A nonzero exit stops the agent.</p></article>
      <article><strong>Verify</strong><p>The echo, <code>environments.files.list</code>, and <code>curl</code> status codes from inside.</p></article>
      <article className="proof"><strong>Document</strong><p>A fingerprint, observed versions, and each allowed host with its reason.</p></article>
    </div><p className="lab3-guide-note">Declared packages are installed even with the network disabled. That is the point: the task itself needs no network, so the sandbox gets none.</p></section>

    <section className="lab7-card"><span className="eyebrow">CONFIGURATION · NO API KEY NEEDED</span><h2>Build the environment</h2>
      <p>Start from a preset or edit the lists. The checker applies the rules the API enforced live, and the expected audit shows what the sandbox must report under this configuration.</p>
      <div className="lab16-prompts">{presetIds.map((id) => <button type="button" key={id} className={id === presetId ? 'selected' : ''} onClick={() => loadPreset(id)} disabled={running} title={presets[id].note}>{presets[id].label}</button>)}</div>
      <div className="lab21-config">
        <div>
          <div className="lab28-lists">{ecosystems.map((key) => <label key={key} className="lab28-list"><span className="lab24-label"><code>packages.{key}</code> <small>one per line</small></span><textarea className="lab25-textarea lab28-textarea" value={config[key].join('\n')} onChange={(event) => update({ [key]: toLines(event.target.value) } as Partial<Config>)} spellCheck={false} disabled={running} placeholder={key === 'python' ? 'tabulate==0.9.0' : key === 'system' ? 'jq' : 'left-pad@1.3.0'} /></label>)}</div>
          <fieldset className="lab15-modes lab21-modes lab28-access" disabled={running}><legend><code>network.access</code></legend>
            {accesses.map((item) => <label key={item} className={config.access === item ? 'selected' : ''}><input type="radio" name="lab28-access" checked={config.access === item} onChange={() => update({ access: item, domains: item === 'restricted' && !config.domains.length ? ['pypi.org', 'files.pythonhosted.org'] : config.domains })} /><span><code>{item}</code><small>{item === 'disabled' ? 'No outbound connections.' : item === 'restricted' ? 'Only the hosts listed below.' : 'Every host (the beta default).'}</small></span></label>)}
          </fieldset>
          {config.access === 'restricted' ? <label className="lab28-list"><span className="lab24-label"><code>allowed_domains</code> <small>exact host names, one per line</small></span><textarea className="lab25-textarea lab28-textarea" value={config.domains.join('\n')} onChange={(event) => update({ domains: toLines(event.target.value) })} spellCheck={false} disabled={running} /></label> : null}
          <label className="lab28-list"><span className="lab24-label"><code>setup_commands</code></span><select className="lab28-select" value={config.setup} onChange={(event) => update({ setup: event.target.value as Setup })} disabled={running}>{setups.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          {setupCommands[config.setup] ? <pre className="lab19-decl lab27-prompt">{setupCommands[config.setup]}</pre> : null}
        </div>
        <div><h3 className="lab13-subhead">Checker</h3><Findings findings={configCheck.findings} />
          <div className="lab25-facts lab27-facts">
            <span><small>Environment fingerprint</small><b><code>{print}</code></b><small>SHA-256 of the canonical request</small></span>
            <span><small>Unpinned</small><b>{unpinned(config).length}</b><small>{unpinned(config).join(', ') || 'every version fixed'}</small></span>
          </div>
          <h3 className="lab13-subhead">The audit must report</h3>
          <pre className="lab19-decl lab27-expected">{`python: <whatever the image has>\ntabulate: ${expected.tabulate === 'any' ? '<any version: unpinned>' : expected.tabulate}\njq: ${expected.jq === 'present' ? '<a version>' : 'none'}\nlock_file: ${expected.lockFile}\npypi: ${expected.pypi}\nexample: ${expected.example}`}</pre>
          <details className="lab16-preview"><summary>The <code>environment</code> this app sends</summary><pre className="lab19-decl"><code>{json(environment)}</code></pre></details>
        </div>
      </div>
    </section>

    <section className="lab7-card"><span className="eyebrow">REQUEST CHECKER · NO API KEY NEEDED</span><h2>Will the API accept this environment?</h2>
      <p>Edit any <code>environment</code>. The {requestSamples.length} recorded requests were sent live on {today}; compare the checker’s prediction with the API’s answer.</p>
      <div className="lab16-prompts">{requestSamples.map((item) => <button type="button" key={item.id} className={item.id === requestId ? 'selected' : ''} onClick={() => loadRequest(item.id)}>{item.label}</button>)}</div>
      <div className="lab21-config">
        <div><label htmlFor="lab28-editor" className="lab24-label"><code>environment</code></label>
          <textarea id="lab28-editor" className="lab25-textarea lab26-editor" value={editor} onChange={(event) => { setEditor(event.target.value); setRequestId(null); setProbe(null); }} spellCheck={false} />
          <div className="lab8-actions"><button type="button" className="lab8-secondary lab24-danger" onClick={() => void sendProbe()} disabled={probing || noKey || Boolean(parsedEditor.error) || Boolean(editorCheck.environment)}>{probing ? 'Sending…' : 'Send it anyway, to see the API’s answer'}</button></div>
          <p className="lab8-note">Only requests the checker refuses are sent. An accepted one would provision a sandbox for nothing; use the live run for that.</p>
        </div>
        <div><h3 className="lab13-subhead">Checker</h3><Findings findings={editorCheck.findings} />
          {probe ? <><h3 className="lab13-subhead">The API just answered <code>{probe.status}</code></h3><pre className={'lab19-decl lab25-raw' + (probe.status >= 400 ? ' lab27-refused' : '')}><code>{probe.message}</code></pre></> : null}
          {requestSample ? <><h3 className="lab13-subhead">Recorded answer <code>{requestSample.status}</code></h3><pre className={'lab19-decl lab25-raw' + (requestSample.status >= 400 ? ' lab27-refused' : '')}><code>{requestSample.status >= 400 ? requestSample.response : json(JSON.parse(requestSample.response))}</code></pre><p className="lab8-note">{requestSample.lesson}</p></> : null}
        </div>
      </div>
      <div className="lab9-table-wrap lab27-limits"><table>
        <thead><tr><th>Rule</th><th>Accepted live</th><th>Refused live</th></tr></thead>
        <tbody>
          <tr><th>Package spec</th><td><code>tabulate==0.9.0</code>, <code>numpy&gt;=1.26,&lt;3</code>, <code>left-pad@1.3.0</code>, <code>jq</code>; 101 names</td><td>empty, URLs, <code>user:pw@</code>, newlines, <code>--option</code>, <code>; rm -rf /</code>; a string instead of a list; <code>packages.pip</code></td></tr>
          <tr><th><code>allowed_domains</code></th><td>host names; also an IP, <code>PyPI.org</code>, <code>pypi.org.</code>, <code>localhost</code> (echoed as written)</td><td><code>*.pypi.org</code>, <code>https://…</code>, <code>…/simple</code>, <code>:443</code>; more than 100; any list with <code>disabled</code>; none with <code>restricted</code></td></tr>
          <tr><th><code>blocked_domains</code></th><td>—</td><td>not enabled for this organization</td></tr>
          <tr><th><code>setup_commands</code></th><td>up to 16 <code>{'{ command, cwd? }'}</code>; never echoed</td><td>17 or more, a bare string, no <code>command</code>, a relative <code>cwd</code></td></tr>
          <tr><th>Provisioning</th><td>a real package: installed before <code>environment.ready</code></td><td>an unknown package: the stream ends with pip’s error; a failing setup command: <code>environment_connection_failed</code></td></tr>
        </tbody>
      </table></div>
    </section>

    <section className="lab7-card"><span className="eyebrow">LIVE · ONE AUDIT, FIVE CONFIGURATIONS</span><h2>Run it in a real sandbox</h2>
      <fieldset className="lab15-modes lab21-modes lab28-access" disabled={running}><legend>Task</legend>
        {(['audit', 'install'] as Task[]).map((item) => <label key={item} className={task === item ? 'selected' : ''}><input type="radio" name="lab28-task" checked={task === item} onChange={() => setTask(item)} /><span><strong>{taskInfo[item].label}</strong><small>{taskInfo[item].note}</small></span></label>)}
      </fieldset>
      <details className="lab16-preview"><summary>The prompt, the same in every run</summary><pre className="lab19-decl lab27-prompt">{taskInfo[task].prompt}</pre></details>
      <div className="lab8-actions">
        <button type="button" className="lab7-primary" onClick={() => { setError(''); void runOne(config, presetId, task); }} disabled={running || noKey || !configCheck.config}>{running ? 'Running…' : `Run this configuration (${presetId ? presets[presetId].label : 'custom'})`}</button>
        <button type="button" className="lab8-secondary" onClick={() => void runComparison()} disabled={running || noKey}>Run the comparison (5 audits)</button>
        <button type="button" className="lab8-secondary" onClick={() => void runInstallPair()} disabled={running || noKey}>Run the allowlist pair (2 installs)</button>
        {running ? <button type="button" className="lab8-secondary" onClick={stopAll}>Stop</button> : null}
      </div>
      {noKey ? <p className="lab8-note">Add OPENAI_API_KEY to .env to run sessions. The builder, the request checker, the inspector, the policy document, and the test page work without a key.</p> : <p className="lab8-note">Each run is a new <code>openai_hosted</code> session: about 15–26 seconds to become ready with no packages, 23–33 seconds with tabulate and jq, then 10–20 seconds of work. Hosted sessions stay in your project until they are deleted; Lab 30 covers cleanup.</p>}
      {!configCheck.config ? <p className="lab8-note">Fix the configuration’s errors to run it.</p> : null}
      {accountLimited ? <p className="lab20-notice" role="status">The last run was refused with <em>“{accountLimited}”</em>. That is an account limit, not a configuration problem. The recorded runs in the inspector show what these runs produce.</p> : null}
      {running ? <div className="lab26-live">{Object.entries(live).map(([key, pane]) => <div key={key} className="lab24-live"><p className="lab7-session-id"><b>{pane.label}</b> · {pane.sessionId ? `session ${shortId(pane.sessionId)} · ` : ''}{pane.status}</p>
        {pane.events.length ? <ol className="lab25-events">{pane.events.filter((event) => !/content_part|output_text|item\.added/.test(event.name)).map((event, index) => <li key={index} className={/environment/.test(event.name) ? 'env' : ''}><code>{event.name.replace('agent.session.', '')}</code><small>{seconds(event.ms)}</small></li>)}</ol> : null}
        {pane.echo ? <p className="lab8-note">Echo: packages {[...pane.echo.packages.python, ...pane.echo.packages.system, ...pane.echo.packages.npm].map((item) => <code key={item}>{item} </code>)}{![...pane.echo.packages.python, ...pane.echo.packages.system, ...pane.echo.packages.npm].length ? 'none' : null} · network <code>{pane.echo.network.access}</code></p> : null}
        {pane.listed ? <p className="lab8-note"><code>environments.files.list /workspace/env</code>: {pane.listed.length ? pane.listed.map((file) => <code key={file.path}>{file.path} ({file.sizeBytes} bytes) </code>) : 'no files'}</p> : null}
        {pane.commands.length ? <CommandLog commands={pane.commands} kind="openai_hosted" /> : null}
        {pane.answer ? <SafeAnswer answer={pane.answer} /> : null}</div>)}</div> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    <section className="lab7-card"><span className="eyebrow">RESULT · A REPRODUCIBLE RUN WITH A KNOWN NETWORK POLICY</span><h2>Which configuration did what it declared?</h2>
      <div className="lab28-grid" role="list" aria-label="Latest audit for each configuration">
        {comparison.map((id) => {
          const record = latest(id);
          const head = <span className="lab27-grid-mode"><strong>{presets[id].label}</strong><code>{presets[id].short}</code></span>;
          if (!record) return <div role="listitem" key={id} className="lab26-cell empty">{head}<small>not run yet</small></div>;
          const verdict = judgeConfigRun(record.run);
          return <button type="button" role="listitem" key={id} className={'lab26-cell ' + outcomeTone[verdict.outcome]} onClick={() => setSelectedId(record.id)}>{head}<strong>{verdict.title}</strong><small>ready {seconds(record.run.readyMs)} · tabulate {parseAudit(record.run.answer).tabulate ?? '—'}</small></button>;
        })}
      </div>
      {chosen ? <><h3 className="lab13-subhead">Run #{records.indexOf(chosen) + 1}</h3><RunDetail record={chosen} /></> : <p className="lab8-note">Run the comparison. The goal: two reproducible runs (offline and allowlist), an unpinned run that drifts, an open run that works but is too wide, and a control with nothing in it.</p>}
      {records.length ? <div className="lab9-table-wrap lab15-history lab16-history"><table>
        <thead><tr><th>Run</th><th>Configuration</th><th>Task</th><th>Fingerprint</th><th>Session</th><th>Ready</th><th>Total</th><th>Verdict</th></tr></thead>
        <tbody>{records.map((item, index) => { const verdict = judgeConfigRun(item.run); return <tr key={item.id} className={item.id === chosen?.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}>
          <th><button type="button" className="lab15-link" onClick={() => setSelectedId(item.id)} aria-pressed={item.id === chosen?.id}>#{index + 1}</button></th>
          <td>{labelFor(item.run)}</td><td>{item.run.task}</td><td><code>{item.run.fingerprint}</code></td><td>{item.run.sessionId ? <code>{shortId(item.run.sessionId)}</code> : '—'}</td>
          <td>{seconds(item.run.readyMs)}</td><td>{seconds(item.run.durationMs)}</td>
          <td><span className={'lab23-outcome ' + outcomeTone[verdict.outcome]}>{verdict.title}</span></td></tr>; })}</tbody>
      </table></div> : null}
    </section>

    <section className="lab7-card"><span className="eyebrow">REPRODUCIBILITY · RECORDED AND LIVE</span><h2>Same fingerprint, same sandbox?</h2>
      <p>Every audit, grouped by the fingerprint of the exact <code>environment</code> it sent. A reproducible configuration shows one version and one network result per fingerprint, however many times it runs. Live runs join the recorded ones as you make them.</p>
      <div className="lab9-table-wrap lab28-table"><table>
        <thead><tr><th>Fingerprint</th><th>Configuration</th><th>Runs</th><th>tabulate</th><th>jq</th><th>pypi / example</th><th /></tr></thead>
        <tbody>{reproRows.map((row) => <tr key={row.key}><th><code>{row.key}</code></th><td>{labelFor(row.items[0].run)}{unpinned(row.config).length ? <small className="lab28-flag"> unpinned: {unpinned(row.config).join(', ')}</small> : null}</td>
          <td>{row.items.length} <small>({row.items.filter((item) => item.source === 'live').length} live)</small></td><td>{row.tabulate.join(' / ')}</td><td>{row.jq.join(' / ')}</td><td>{row.net.join(' · ')}</td>
          <td><span className={'lab18-pass ' + (row.stable && !unpinned(row.config).length ? 'ok' : 'fail')}>{!row.stable ? 'DRIFT' : unpinned(row.config).length ? 'UNPINNED' : row.items.length > 1 ? 'STABLE' : 'ONCE'}</span></td></tr>)}</tbody>
      </table></div>
      <p className="lab8-note">Recorded: the pinned configuration ran in two sandboxes and got tabulate 0.9.0 both times. Without the pin, the same day gave 0.10.0: a different fingerprint, and a version nobody chose.</p>
    </section>

    <section className="lab7-card" id="lab28-policy"><span className="eyebrow">DELIVERABLE · THE DOCUMENTED NETWORK POLICY</span><h2>Write the policy down</h2>
      <p>The API never echoes setup commands, and a policy with no reasons cannot be reviewed. This document holds both: every allowed host with why it is there, the packages with what the sandbox reported, the checks it passed, and the request to reproduce it.</p>
      <fieldset className="lab15-modes lab21-modes lab28-access"><legend>Document</legend>
        <label className={docSource === 'run' ? 'selected' : ''}><input type="radio" name="lab28-doc" checked={docSource === 'run'} onChange={() => setDocSource('run')} /><span><strong>The selected live run</strong><small>{chosen ? `${labelFor(chosen.run)} · ${chosen.run.sessionId ? shortId(chosen.run.sessionId) : 'no session'}` : 'No live run yet: showing the configuration.'}</small></span></label>
        <label className={docSource === 'config' ? 'selected' : ''}><input type="radio" name="lab28-doc" checked={docSource === 'config'} onChange={() => setDocSource('config')} /><span><strong>The configuration above</strong><small>Not verified until it runs.</small></span></label>
      </fieldset>
      <PolicyDoc run={docRun} config={config} task={task} model={model} />
    </section>

    <section className="lab7-card" id="lab28-inspector"><span className="eyebrow">INSPECTOR · NO API KEY NEEDED</span><h2>Recorded runs, judged from the session</h2>
      <p>{samples.length} runs from live probes on {today}. Session IDs, echoes, file listings, commands, outputs, replies, errors, and timings are real.</p>
      <div className="lab16-prompts">{samples.map((item) => <button type="button" key={item.id} className={item.id === sample.id ? 'selected' : ''} onClick={() => setSampleId(item.id)}>{item.label}</button>)}</div>
      <p className="lab8-note">{sample.lesson}</p>
      <RunDetail record={{ id: sample.id, run: sample.run, source: 'recorded' }} />
      <details className="lab16-preview"><summary>This recorded run’s policy document</summary><PolicyDoc run={sample.run} config={sample.run.config} task={sample.run.task} model={sample.run.model} /></details>
    </section>

    <section className="lab7-card" id="lab28-tests"><span className="eyebrow">TEST PAGE · NO API KEY NEEDED</span><h2>{packageTests.length} cases, one function each</h2><p>Every case runs the real <code>buildEnvironment</code>, <code>fingerprint</code>, <code>checkPackage</code>, <code>checkDomain</code>, <code>checkRequest</code>, <code>checkConfig</code>, <code>parseAudit</code>, <code>hostEvidence</code>, <code>installEvidence</code>, <code>parseConfigRun</code>, <code>judgeConfigRun</code>, or <code>policyDocument</code>, in this browser or on the server. Notes marked <em>Live</em> repeat what the API or the sandbox did on {today}.</p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={runInBrowser} disabled={Boolean(suiteBusy)}>{suiteBusy === 'browser' ? 'Running…' : 'Run all in the browser'}</button><button type="button" className="lab8-secondary" onClick={() => void runOnServer()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'server' ? 'Running…' : 'Run all on the server'}</button></div>
      {suite ? <p className={'lab18-score ' + (passed === packageTests.length ? 'ok' : 'fail')}><b>{passed}/{packageTests.length} passed</b> · ran in {suite.runtime} · {suite.durationMs} ms</p> : <p className="lab8-note">Not run yet. Each row states the result it must produce.</p>}
      <div className="lab18-tests">
        <div className="lab9-table-wrap lab18-table lab21-table"><table>
          <thead><tr><th>Case</th><th>Expect</th><th>Got</th><th /></tr></thead>
          {groups.map((group) => <tbody key={group.id}><tr className="lab18-group"><th colSpan={4}>{group.label}</th></tr>{packageTests.filter((item) => item.group === group.id).map((item) => { const result = suite?.results[item.id]; return <tr key={item.id} className={item.id === test.id ? 'selected' : ''} onClick={() => setTestId(item.id)}>
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

    <section className="lab3-guide lab16-guide"><h2>Read the evidence</h2><div><article><strong>Echo</strong><p><code>session.environment</code>: packages exactly as written and the effective network. No setup commands.</p></article><article><strong>Listing</strong><p><code>environments.files.list</code> shows what setup wrote, without asking the agent.</p></article><article><strong>Status codes</strong><p><code>200</code> answered; <code>000</code> never connected. The proxy’s <code>403</code> is in curl’s error line.</p></article><article><strong>Fingerprint</strong><p>Same request, same versions, same hosts. Anything unpinned can drift.</p></article></div><p className="lab3-guide-note">A policy in a request is a claim, and a reply is another claim. The status code printed inside the sandbox is the evidence.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 28</span><span className="code-lessons-title" role="heading" aria-level={2}>The code that pins packages, sets the network policy, and proves both</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Declare pinned packages, choose a network policy, run a confidential setup command and confirm it through the API, verify every host from inside the sandbox, fix an allowlist from the tool’s own error, and write the policy down with a fingerprint. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Run the test page on the server and show <em>{packageTests.length}/{packageTests.length} passed</em>. In the request checker, predict and then load <em>Wildcard *.pypi.org</em> and <em>tabulate; rm -rf /</em>; send one anyway and compare the API’s 400. Then, live: click <em>Run the comparison</em>. Show that the pinned runs report tabulate 0.9.0 and the unpinned run reports whatever PyPI serves today, and name the status code that proves example.com was blocked in the allowlist run. Click <em>Run the allowlist pair</em> and read, from pip’s own error, the host the one-host allowlist is missing. Finally, download the policy document for your reproducible run and fill in a reason for every host.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
