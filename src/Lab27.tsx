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
import { parseCommand, sha256Hex, type CommandRun } from './lab26Environment.ts';
import {
  analyze, buildEnvironment, byteLength, checkRequest, header, isAccountLimit, judgeFileRun, makeDataset, modeInfo, outcomeTone, parseFileRef, parseFileRun, parseReport, reportPrompt,
  type Dataset, type FileRef, type FileRun, type Mode,
} from './lab27Files.ts';
import { requestSamples, samples } from './lab27Scenarios.ts';
import { fileTests, runFileSuite, type TestGroup, type TestResult } from './lab27Tests.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Suite = { source: 'browser' | 'server'; runtime: string; durationMs: number; results: Record<string, TestResult> };
type RunRecord = { id: string; run: FileRun; environment: unknown };
type LiveRun = { status: string; events: Array<{ name: string; ms: number }>; sessionId: string | null; copied: FileRef[]; listed: FileRef[] | null; commands: CommandRun[]; answer: string };
type Probe = { status: number; message: string } | null;

const lessons: Lesson[] = [
  { number: '01', title: 'Stage a file with environment.files', file: 'server/lab27.ts', code: "const session = await client.beta.agents.sessions.create({\n  agent: { model, instructions },\n  environment: {\n    type: 'openai_hosted',\n    network: { access: 'disabled' },\n    files: [\n      { type: 'inline', path: '/workspace/data/enrollments-2c01b358.csv', data: csvBase64 },\n      { type: 'inline', path: '/workspace/data/brief.txt', data: briefBase64 },\n    ],\n  },\n});\nsession.environment.files  // [{ id: 'cfile_…', path, size_bytes: 1482, type: 'inline' }]", explanation: 'An input file is part of the environment. In sessions create, the files list says what to put in the sandbox and where. Each entry has an absolute path inside slash workspace and the file’s bytes, base sixty four encoded. The files are there before the agent starts. The session echoes each one back with a session scoped C file I D and its size in bytes, never its contents. That echo is your first evidence: live, it reported fourteen eighty two bytes, exactly what the app sent. The network stays disabled, because the data is already inside the sandbox.' },
  { number: '02', title: 'Encode the bytes, and respect the rules', file: 'src/lab27Files.ts', code: "// Server side, Node:\nconst data = Buffer.from(csv, 'utf8').toString('base64');\n\n// What the API refused live (400):\n'data/sales.csv'              // must be an absolute POSIX path inside /workspace\n'/tmp/sales.csv'              // same\n'/workspace/../etc/x.csv'     // cannot contain empty, . or .. path components\n'/workspace/data/'            // same: an empty last component\ndata: 'date,region,units'     // must be a standard-base64 string\ndata: '-__-'                  // base64url is refused too\n// two entries with one path · 51+ files · data over 6,990,508 characters (~5 MiB)", explanation: 'The data field is base sixty four, never the text itself: encode the U T F eight bytes on the server. The A P I checks every file before it creates the session. A relative path, a path outside slash workspace, or a dot dot component is a four hundred. So is raw text, and so is base sixty four U R L with dashes and underscores. The same path twice is refused, at most fifty files are accepted, and one file’s data can be about five mebibytes. The request checker in this lab predicts each of these, and you can send a refused request to compare its answer.' },
  { number: '03', title: 'Or copy a file into the live sandbox', file: 'server/lab27.ts', code: "// Session created without files. On the first environment.ready:\nfor (const file of inlineFiles(dataset)) {\n  await client.beta.agents.environments.files.create(environmentId, file);\n  // → { object: 'agent.environment.file', path, size_bytes }\n}\nconst listed = await client.beta.agents.environments.files.list(environmentId, { path: '/workspace/data' });\n// then send the task with sessions.events.create", explanation: 'Staging at creation is the simple path. When a file only exists later, for example a user uploads it in the middle of a conversation, copy it into the running sandbox instead. Wait for environment ready, call environments files create for each file, and then send the task. Live, each copy took about one point three seconds, and the agent’s report was identical to the staged run. Either way, environments files list is the A P I’s own view of the sandbox, independent of anything the agent says.' },
  { number: '04', title: 'Ask for a report that names its source', file: 'src/lab27Files.ts', code: "export const reportPrompt = [\n  'Write a short enrollment report from the files in /workspace/data. Follow the rules in brief.txt.',\n  'Start with exactly these six lines:',\n  'source: <absolute path of the CSV you read>',\n  'source_sha256: <SHA-256 of that file>',\n  'rows_used: <number>', 'total_minutes: <number>', 'completed: <number>', 'top_lab: <lab>',\n  'Then add two sentences of summary. Put the report in your reply, not only in a file.',\n  'If the files are not there, say so and report no figures.',\n].join('\\n');", explanation: 'The prompt does not name the C S V: the agent has to find it in slash workspace slash data, read the brief, and say which file it used. The source line gives the absolute path, and the source SHA two fifty six line gives a fingerprint of the exact bytes, so a reader can check the report against the file. The brief holds one rule the data alone does not: exclude refunded rows. The last line matters too. With an earlier prompt, the agent computed everything correctly, saved the report to slash workspace slash outputs, and replied with only a link.' },
  { number: '05', title: 'Evidence: echo, listing, and commands', file: 'src/lab27Files.ts', code: "const csvRef = session.environment.files.find((f) => f.path === dataset.csvPath);\ncsvRef.size_bytes === byteLength(dataset.csv);            // staged: the right bytes\nlisted.some((f) => f.path === dataset.csvPath);            // the API sees it in the sandbox\nreadBy(run.commands, dataset.csvPath, header).length > 0; // a command opened it\n// Live: the first awk used the wrong columns and printed\n// rows_used=39 total_minutes=2694 top_lab=L-766 (exit 0), then the agent reran it.", explanation: 'Three kinds of evidence, from three places. The session echo says the files were staged, with the right size. The A P I listing says they are in the sandbox. The command execution items say the agent actually opened them, with sed, awk, and sha256sum. Read the output, not only the exit code. Live, the agent’s first awk used the wrong columns: it counted every row, refunds included, and named a learner as the top lab, and it still exited with zero. The agent noticed and ran it again.' },
  { number: '06', title: 'Check the report against your own analysis', file: 'src/lab27Files.ts', code: "const expected = analyze(dataset.csv).analysis;   // this app, same bytes\nconst report = parseReport(run.answer);\nreport.source === dataset.csvPath\n  && report.sourceSha256 === sha256Hex(dataset.csv)\n  && report.rowsUsed === expected.rowsUsed          // brief.txt applied\n  && report.topLab === expected.topLab;\n// control run, no files → 'Honest: no file, no figures'", explanation: 'The app computes the expected figures itself, from the same bytes it staged, and compares every line of the report. A matching path and hash show which file the report came from. Matching figures show it was read correctly, and the refund count shows the brief was followed. The control run, with the same prompt and nothing staged, is what makes this meaningful. Live, the agent looked, printed its own data directory missing marker, and reported no figures. A report built from the file and one built from nothing now look different.' },
];

const groups: Array<{ id: TestGroup; label: string }> = [
  { id: 'data', label: 'Build and analyse the dataset' },
  { id: 'encode', label: 'Encode the bytes' },
  { id: 'request', label: 'Check a files request like the API' },
  { id: 'report', label: 'Read a report and its commands' },
  { id: 'judge', label: 'Judge a run from its evidence' },
];
const modes: Mode[] = ['staged', 'copied', 'missing'];

const json = (value: unknown) => codeTokens(Prism.tokenize(JSON.stringify(value, null, 2) ?? 'undefined', Prism.languages.json || Prism.languages.javascript));
const newId = (): string => `file_${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)}`;
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const tokens = (value: number | null | undefined) => (value === null || value === undefined ? 'unknown' : value.toLocaleString('en'));
const short = (hex: string) => `${hex.slice(0, 12)}…${hex.slice(-6)}`;
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
// Show a request with each file's base64 shortened; the server sends it whole.
function shorten(environment: unknown): unknown {
  const value = environment as { files?: Array<Record<string, unknown>> } | null;
  if (!value || !Array.isArray(value.files)) return environment;
  return { ...value, files: value.files.map((file) => (typeof file.data === 'string' && file.data.length > 40 ? { ...file, data: `${file.data.slice(0, 28)}… (${file.data.length.toLocaleString('en')} base64 characters)` } : file)) };
}

// Single newlines become Markdown hard breaks, so the six report lines stay on six lines.
function SafeAnswer({ answer }: { answer: string }) {
  return <div className="lab7-answer lab16-answer lab21-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    pre: AnswerPre,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const check = checkUrl(href ?? '');
      return check.href ? <a href={check.href} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span className="lab21-dead" title={href}>{children}</span>;
    },
  }}>{answer.replace(/([^\n])\n(?=[^\n])/g, '$1  \n')}</ReactMarkdown></div>;
}

function DataTable({ csv, limit = 8 }: { csv: string; limit?: number }) {
  const rows = csv.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const cells = rows.map((line) => line.split(','));
  return <div className="lab9-table-wrap lab27-data"><table>
    <thead><tr>{(cells[0] ?? []).map((cell, index) => <th key={index}>{cell}</th>)}</tr></thead>
    <tbody>{cells.slice(1, limit + 1).map((row, index) => <tr key={index} className={row[4] === 'refunded' ? 'refunded' : ''}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}
      {rows.length > limit + 1 ? <tr><td colSpan={5} className="lab27-more">… {rows.length - limit - 1} more rows</td></tr> : null}</tbody>
  </table></div>;
}

function Checks({ run }: { run: FileRun }) {
  const verdict = judgeFileRun(run);
  return <>
    <div className={'lab23-judgement ' + outcomeTone[verdict.outcome]}><strong>{verdict.title}</strong><span>{verdict.text}</span></div>
    <ul className="lab21-findings lab25-checks">{verdict.checks.map((check) => <li key={check.id} className={check.level === 'fail' ? 'error' : check.level}><b>{check.level === 'ok' ? '✓' : check.level === 'skip' ? '–' : check.level === 'warn' ? '!' : '✕'}</b><span><strong>{check.label}.</strong> {check.detail}</span></li>)}</ul>
  </>;
}

function ReportTable({ run }: { run: FileRun }) {
  const expected = analyze(run.dataset.csv).analysis;
  const report = parseReport(run.answer);
  const sha = sha256Hex(run.dataset.csv);
  if (run.mode === 'missing') return <p className="lab8-note">Control run: nothing was staged, so the right report has no figures. This app would expect them only if the file were there.</p>;
  const rows: Array<[string, string | null, string]> = [
    ['source', report.source, run.dataset.csvPath],
    ['source_sha256', report.sourceSha256, sha],
    ['rows_used', report.rowsUsed === null ? null : String(report.rowsUsed), String(expected?.rowsUsed ?? '—')],
    ['total_minutes', report.totalMinutes === null ? null : String(report.totalMinutes), String(expected?.totalMinutes ?? '—')],
    ['completed', report.completed === null ? null : String(report.completed), String(expected?.completed ?? '—')],
    ['top_lab', report.topLab, expected?.topLab ?? '—'],
  ];
  return <div className="lab9-table-wrap lab27-report"><table>
    <thead><tr><th>Line</th><th>The report says</th><th>This app computed</th><th /></tr></thead>
    <tbody>{rows.map(([name, got, want]) => <tr key={name}><th><code>{name}</code></th><td>{got === null ? <em>missing</em> : <code>{name === 'source_sha256' ? short(got) : got}</code>}</td><td><code>{name === 'source_sha256' ? short(want) : want}</code></td><td><span className={'lab18-pass ' + (got === want ? 'ok' : 'fail')}>{got === want ? 'MATCH' : 'NO'}</span></td></tr>)}</tbody>
  </table></div>;
}

function FilesTable({ run }: { run: FileRun }) {
  const paths = [run.dataset.csvPath, run.dataset.notesPath];
  const sent = (path: string) => byteLength(path === run.dataset.csvPath ? run.dataset.csv : run.dataset.notes);
  const find = (list: FileRef[] | null, path: string) => list?.find((file) => file.path === path) ?? null;
  const cell = (ref: FileRef | null, path: string, applies: boolean) => (!applies ? <span className="lab27-na">—</span> : ref ? <span className={ref.sizeBytes === sent(path) ? 'lab27-yes' : 'lab27-no'}>{ref.sizeBytes} bytes{ref.id ? <small> · {shortId(ref.id)}</small> : null}</span> : <span className="lab27-no">absent</span>);
  return <div className="lab9-table-wrap lab27-files"><table>
    <thead><tr><th>Path</th><th>This app sent</th><th><code>session.environment.files</code></th><th><code>environments.files.create</code></th><th><code>environments.files.list</code></th></tr></thead>
    <tbody>{paths.map((path) => <tr key={path}><th><code>{path}</code></th><td>{run.mode === 'missing' ? <span className="lab27-na">nothing (control)</span> : `${sent(path)} bytes`}</td>
      <td>{cell(find(run.reportedFiles, path), path, run.mode === 'staged')}</td><td>{cell(find(run.copied, path), path, run.mode === 'copied')}</td>
      <td>{run.listed === null ? <span className="lab27-na">not listed</span> : run.mode === 'missing' ? <span className={find(run.listed, path) ? 'lab27-no' : 'lab27-yes'}>{find(run.listed, path) ? 'present' : 'absent, as expected'}</span> : cell(find(run.listed, path), path, true)}</td></tr>)}</tbody>
  </table></div>;
}

function RunDetail({ record }: { record: RunRecord }) {
  const { run } = record;
  const stopped = Boolean(run.error) || run.turnStatus === 'failed' || run.turnStatus === 'cancelled';
  return <div className="lab25-run">
    <p className="lab15-ids"><b>{modeInfo[run.mode].label}</b> · <code>{modeInfo[run.mode].short}</code>{run.sessionId ? <> · session <code>{shortId(run.sessionId)}</code></> : null} · turn <code>{run.turnStatus}</code>{run.completion === 'polled' ? <> · outcome <b>read from the API</b></> : null}</p>
    <Checks run={run} />
    <div className="lab25-facts">
      <span><small>Files staged</small><b>{run.mode === 'staged' ? run.reportedFiles.length : run.mode === 'copied' ? run.copied.length : 0}</b><small>{modeInfo[run.mode].short}</small></span>
      <span><small>Sandbox ready</small><b>{seconds(run.readyMs)}</b></span>
      <span><small>Total time</small><b>{seconds(run.durationMs)}</b></span>
      <span><small>Tokens</small><b>{tokens(run.usage?.total)}</b>{run.usage ? <small>{tokens(run.usage.input)} in · {tokens(run.usage.output)} out</small> : <small>not reported (best-effort)</small>}</span>
    </div>
    <h3 className="lab13-subhead">Where the files are, according to the API</h3>
    <FilesTable run={run} />
    <h3 className="lab13-subhead">The report, line by line</h3>
    <ReportTable run={run} />
    <div className="lab21-report-grid">
      <div><h3 className="lab13-subhead">Reply</h3>{run.answer ? <SafeAnswer answer={run.answer} /> : <p className="lab8-note">No answer text.</p>}
        {run.commentary.length ? <><h3 className="lab13-subhead">Commentary <small>(a claim, not evidence)</small></h3><ul className="lab26-commentary">{run.commentary.map((line, index) => <li key={index}>{line}</li>)}</ul></> : null}
        {run.error ? <p className="lab2-error" role="alert">{run.error}</p> : null}</div>
      <div><h3 className="lab13-subhead">Evidence <code>command_execution</code></h3><CommandLog commands={run.commands} kind="openai_hosted" stopped={stopped} /></div>
    </div>
    <details className="lab16-preview"><summary>The prompt</summary><pre className="lab19-decl lab27-prompt">{run.prompt}</pre></details>
    <details className="lab16-preview"><summary>The environment the server sent (base64 shortened)</summary><pre className="lab19-decl"><code>{json(shorten(record.environment))}</code></pre></details>
    <details className="lab16-preview"><summary>The staged CSV: <code>{basename(run.dataset.csvPath)}</code></summary><DataTable csv={run.dataset.csv} limit={60} /></details>
  </div>;
}

function ModeGrid({ records, onSelect }: { records: RunRecord[]; onSelect: (id: string) => void }) {
  const latest = (mode: Mode) => [...records].reverse().find((item) => item.run.mode === mode) ?? null;
  return <div className="lab27-grid" role="list" aria-label="Latest run for each way of providing the files">
    {modes.map((mode) => {
      const record = latest(mode);
      const head = <><span className="lab27-grid-mode"><strong>{modeInfo[mode].label}</strong><code>{modeInfo[mode].short}</code></span></>;
      if (!record) return <div role="listitem" key={mode} className="lab26-cell empty">{head}<small>not run yet</small></div>;
      const verdict = judgeFileRun(record.run);
      return <button type="button" role="listitem" key={mode} className={'lab26-cell ' + outcomeTone[verdict.outcome]} onClick={() => onSelect(record.id)}>
        {head}<strong>{verdict.title}</strong><small>{seconds(record.run.durationMs)} · {record.run.commands.length} command{record.run.commands.length === 1 ? '' : 's'}</small>
      </button>;
    })}
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

export default function Lab27({ active, health }: { active: boolean; health: Health }) {
  const [dataset, setDataset] = useState<Dataset>(() => makeDataset());
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState(() => JSON.stringify(requestSamples[0].environment, null, 2));
  const [requestId, setRequestId] = useState<string | null>(requestSamples[0].id);
  const [probe, setProbe] = useState<Probe>(null);
  const [probing, setProbing] = useState(false);
  const [mode, setMode] = useState<Mode>('staged');
  const [live, setLive] = useState<Record<Mode, LiveRun | null>>({ staged: null, copied: null, missing: null });
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState(samples[0].id);
  const [suite, setSuite] = useState<Suite | null>(null);
  const [suiteBusy, setSuiteBusy] = useState<'browser' | 'server' | null>(null);
  const [testId, setTestId] = useState(fileTests[0].id);
  const [error, setError] = useState('');
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const aborts = useRef<Set<AbortController>>(new Set());
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const analysis = useMemo(() => analyze(dataset.csv), [dataset.csv]);
  const csvSha = useMemo(() => sha256Hex(dataset.csv), [dataset.csv]);
  const parsedEditor = useMemo(() => { try { return { value: JSON.parse(editor) as unknown, error: null }; } catch (caught) { return { value: null, error: caught instanceof Error ? caught.message : 'Invalid JSON.' }; } }, [editor]);
  const editorCheck = useMemo(() => (parsedEditor.error ? { environment: null, findings: [{ level: 'error' as const, text: `Not JSON: ${parsedEditor.error}` }] } : checkRequest(parsedEditor.value)), [parsedEditor]);
  const requestSample = requestSamples.find((item) => item.id === requestId) ?? null;
  const running = modes.some((item) => live[item] !== null);
  const chosen = records.find((item) => item.id === selectedId) ?? records.at(-1) ?? null;
  const sample = samples.find((item) => item.id === sampleId) ?? samples[0];
  const test = fileTests.find((item) => item.id === testId) ?? fileTests[0];
  const testResult = suite?.results[test.id] ?? null;
  const passed = suite ? Object.values(suite.results).filter((item) => item.pass).length : 0;
  const noKey = !health?.configured;
  const lastError = records.at(-1)?.run.error ?? null;
  const accountLimited = lastError && isAccountLimit(lastError) ? lastError.split('. ')[0] : null;

  function loadRequest(id: string) { const item = requestSamples.find((entry) => entry.id === id); if (!item) return; setRequestId(id); setProbe(null); setEditor(JSON.stringify(item.environment, null, 2)); }
  function editCsv(csv: string) { setDataset((previous) => ({ ...previous, csv })); }

  // One report task in one new hosted session. Several modes may run at once; each has its own live pane.
  async function runOne(runMode: Mode) {
    const controller = new AbortController();
    aborts.current.add(controller);
    const sent = dataset;
    setLive((previous) => ({ ...previous, [runMode]: { status: 'Starting…', events: [], sessionId: null, copied: [], listed: null, commands: [], answer: '' } }));
    const update = (patch: Partial<LiveRun> | ((current: LiveRun) => Partial<LiveRun>)) => setLive((previous) => {
      const current = previous[runMode];
      return current ? { ...previous, [runMode]: { ...current, ...(typeof patch === 'function' ? patch(current) : patch) } } : previous;
    });
    try {
      const response = await fetch('/api/lab27/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: runMode, dataset: { id: sent.id, csv: sent.csv } }), signal: controller.signal });
      if (!response.ok) {
        const failure = await response.json() as { error?: string; findings?: Array<{ level: string; text: string }> };
        throw new Error([failure.error || `Request failed (${response.status}).`, ...(failure.findings ?? []).filter((item) => item.level === 'error').map((item) => item.text)].join(' '));
      }
      let summary: unknown = null;
      await readLines(response, (line) => {
        if (line.type === 'status' && typeof line.label === 'string') update({ status: line.label });
        if (line.type === 'event' && typeof line.name === 'string') { const entry = { name: line.name, ms: Number(line.ms ?? 0) }; update((current) => ({ events: [...current.events, entry].slice(-60) })); }
        if (line.type === 'session' && typeof line.sessionId === 'string') update({ sessionId: line.sessionId });
        if (line.type === 'copied') { const file = parseFileRef(line.file); update((current) => ({ copied: [...current.copied, file] })); }
        if (line.type === 'listed' && Array.isArray(line.files)) update({ listed: line.files.map(parseFileRef) });
        if (line.type === 'command') { const next = parseCommand(line.command); update((current) => ({ commands: [...current.commands.filter((item) => item.id !== next.id), next] })); }
        if (line.type === 'text' && typeof line.text === 'string') update({ answer: line.text });
        if (line.type === 'summary') summary = line.run;
      });
      if (!summary) throw new Error('The stream ended without a summary.');
      const run = parseFileRun(summary);
      const record: RunRecord = { id: newId(), run, environment: buildEnvironment(runMode, sent) };
      setRecords((previous) => [...previous, record]);
      setSelectedId(record.id);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error ? caught.message : 'The run failed.');
    } finally {
      aborts.current.delete(controller);
      setLive((previous) => ({ ...previous, [runMode]: null }));
    }
  }
  async function runAll() { setError(''); await Promise.all(modes.map((item) => runOne(item))); }
  function stopAll() { aborts.current.forEach((controller) => controller.abort()); }
  async function sendProbe() {
    setProbing(true); setProbe(null); setError('');
    try {
      const response = await fetch('/api/lab27/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ environment: parsedEditor.value }) });
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
      const results = runFileSuite();
      setSuite({ source: 'browser', runtime: 'this browser', durationMs: Math.round(performance.now() - started), results: Object.fromEntries(results.map((item) => [item.id, item])) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The suite crashed.'); }
    finally { setSuiteBusy(null); }
  }
  async function runOnServer() {
    setSuiteBusy('server'); setError('');
    try {
      const response = await fetch('/api/lab27/test', { method: 'POST' });
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
      const spokenTitle = lesson.title.replace('environment.files', 'environment files');
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

  return <div className="lab16-page lab21-page lab22-page lab23-page lab25-page lab26-page lab27-page">
    <div className="lab2-hero"><span className="lab2-badge lab27-badge">27/50</span><div><div className="eyebrow">LAB 27 / PROVIDE INPUT FILES</div><h1>Stage the file, <em>then prove the report used it</em>.</h1><p>An <code>openai_hosted</code> sandbox starts with an empty <code>/workspace</code>. Put a CSV and a text brief in it, either with <code>environment.files</code> when the session is created or by copying them into the running sandbox, and ask for a report that <b>names its source</b>. Then check every line of the report against this app’s own analysis of the same bytes, and compare it with a control run that has no files.</p></div></div>

    <section className="lab3-guide lab25-flow lab27-flow" aria-label="From file to sourced report"><h2>From file to sourced report</h2><div>
      <article><strong>File</strong><p>A CSV and a brief. This app computes the expected figures from their bytes.</p></article>
      <article><strong>Encode</strong><p>Standard base64 of the UTF-8 bytes, and an absolute path in <code>/workspace</code>.</p></article>
      <article><strong>Stage</strong><p><code>environment.files</code> at creation, or <code>environments.files.create</code> after ready.</p></article>
      <article><strong>Read</strong><p><code>command_execution</code> items that open the file: <code>sed</code>, <code>awk</code>, <code>sha256sum</code>.</p></article>
      <article className="proof"><strong>Source</strong><p>The report names the path and SHA-256, and its figures match.</p></article>
    </div><p className="lab3-guide-note">The prompt never names the CSV. The agent has to find it in <code>/workspace/data</code>, follow a rule that is only in <code>brief.txt</code>, and say which file every figure came from.</p></section>

    <section className="lab7-card"><span className="eyebrow">THE INPUT FILES · NO API KEY NEEDED</span><h2>A fresh dataset, and the figures it must produce</h2>
      <p>Each dataset is generated from a seed, so no report can be remembered. Refunded rows are highlighted: <code>brief.txt</code> says to exclude them, and the CSV alone does not.</p>
      <div className="lab8-actions">
        <button type="button" className="lab8-secondary" onClick={() => { setDataset(makeDataset()); setEditing(false); }} disabled={running}>New dataset</button>
        <button type="button" className="lab8-secondary" onClick={() => setEditing((open) => !open)} disabled={running} aria-pressed={editing}>{editing ? 'Show as a table' : 'Edit the CSV'}</button>
      </div>
      <div className="lab21-config">
        <div><h3 className="lab13-subhead"><code>{dataset.csvPath}</code></h3>
          {editing ? <><label htmlFor="lab27-csv" className="lab24-label">CSV (the header must stay <code>{header}</code>)</label><textarea id="lab27-csv" className="lab25-textarea lab27-csv" value={dataset.csv} onChange={(event) => editCsv(event.target.value)} spellCheck={false} disabled={running} /></> : <DataTable csv={dataset.csv} />}
          <h3 className="lab13-subhead"><code>{dataset.notesPath}</code></h3><pre className="lab19-decl lab27-brief">{dataset.notes}</pre>
        </div>
        <div><h3 className="lab13-subhead">This app’s analysis</h3>
          {analysis.analysis ? <>
            <div className="lab25-facts lab27-facts">
              <span><small>Size</small><b>{byteLength(dataset.csv).toLocaleString('en')} bytes</b><small>{toBase64Length(dataset.csv).toLocaleString('en')} base64 chars</small></span>
              <span><small>Rows</small><b>{analysis.analysis.rowsTotal}</b><small>{analysis.analysis.refunded} refunded</small></span>
              <span className="wide"><small>SHA-256</small><b><code>{short(csvSha)}</code></b></span>
            </div>
            <pre className="lab19-decl lab27-expected">{`source: ${dataset.csvPath}\nsource_sha256: ${csvSha}\nrows_used: ${analysis.analysis.rowsUsed}\ntotal_minutes: ${analysis.analysis.totalMinutes}\ncompleted: ${analysis.analysis.completed}\ntop_lab: ${analysis.analysis.topLab}`}</pre>
            <p className="lab8-note">Ignoring the brief would give {analysis.analysis.rowsTotal} rows and {analysis.analysis.totalMinutesAll.toLocaleString('en')} minutes. The judge recognises those figures.</p>
          </> : <Findings findings={analysis.errors.map((text) => ({ level: 'error' as const, text }))} />}
          <details className="lab16-preview"><summary>The <code>files</code> this app sends (base64 shortened)</summary><pre className="lab19-decl"><code>{json(shorten(buildEnvironment('staged', dataset)))}</code></pre></details>
        </div>
      </div>
    </section>

    <section className="lab7-card"><span className="eyebrow">FILES CHECKER · NO API KEY NEEDED</span><h2>Will the API accept these files?</h2>
      <p>Edit <code>environment</code> and the checker reacts. The ten recorded requests were sent live on 2026-09-28; compare what the checker predicts with what the API answered.</p>
      <div className="lab16-prompts">{requestSamples.map((item) => <button type="button" key={item.id} className={item.id === requestId ? 'selected' : ''} onClick={() => loadRequest(item.id)}>{item.label}</button>)}</div>
      <div className="lab21-config">
        <div><label htmlFor="lab27-editor" className="lab24-label"><code>environment</code></label>
          <textarea id="lab27-editor" className="lab25-textarea lab26-editor" value={editor} onChange={(event) => { setEditor(event.target.value); setRequestId(null); setProbe(null); }} spellCheck={false} />
          <div className="lab8-actions">
            <button type="button" className="lab8-secondary lab24-danger" onClick={() => void sendProbe()} disabled={probing || noKey || Boolean(parsedEditor.error) || Boolean(editorCheck.environment)}>{probing ? 'Sending…' : 'Send it anyway, to see the API’s answer'}</button>
          </div>
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
          <tr><th>Path</th><td><code>/workspace/data/a.csv</code>, <code>/workspace/my data/a b.csv</code></td><td>relative, <code>/tmp/…</code>, <code>..</code>, trailing <code>/</code></td></tr>
          <tr><th>data</th><td>standard base64, including empty (a 0-byte file)</td><td>raw text, base64url</td></tr>
          <tr><th>Size of one file</th><td>1 MB</td><td>12 MB: at most 6,990,508 base64 characters (about 5 MiB)</td></tr>
          <tr><th>Number of files</th><td>30</td><td>101: at most 50</td></tr>
          <tr><th><code>file_id</code></th><td>—</td><td><code>file-…</code> from <code>files.create</code> (user_data and assistants); an unknown ID is a 404</td></tr>
        </tbody>
      </table></div>
    </section>

    <section className="lab7-card"><span className="eyebrow">LIVE · ONE TASK, THREE WAYS TO PROVIDE THE FILES</span><h2>Run the report task</h2>
      <fieldset className="lab15-modes lab21-modes lab22-modes lab27-modes" disabled={running}><legend>Provide the files</legend>
        {modes.map((item) => <label key={item} className={mode === item ? 'selected' : ''}><input type="radio" name="lab27-mode" checked={mode === item} onChange={() => setMode(item)} /><span><strong>{modeInfo[item].label}</strong><code>{modeInfo[item].short}</code><small>{modeInfo[item].note}</small></span></label>)}
      </fieldset>
      <details className="lab16-preview"><summary>The prompt, the same in every run</summary><pre className="lab19-decl lab27-prompt">{reportPrompt}</pre></details>
      <div className="lab8-actions">
        <button type="button" className="lab7-primary" onClick={() => { setError(''); void runOne(mode); }} disabled={running || noKey || !analysis.analysis}>{live[mode] ? 'Running…' : `Run: ${modeInfo[mode].label.toLowerCase()}`}</button>
        <button type="button" className="lab8-secondary" onClick={() => void runAll()} disabled={running || noKey || !analysis.analysis}>Run all three</button>
        {running ? <button type="button" className="lab8-secondary" onClick={stopAll}>Stop</button> : null}
      </div>
      {noKey ? <p className="lab8-note">Add OPENAI_API_KEY to .env to run sessions. The dataset, the files checker, the inspector, and the test page work without a key.</p> : <p className="lab8-note">Every run is a new <code>openai_hosted</code> session with network disabled: about 20 seconds for the sandbox, then 10–25 seconds of work. Hosted sessions stay in your project until they are deleted; Lab 30 covers cleanup.</p>}
      {accountLimited ? <p className="lab20-notice" role="status">The last run was refused with <em>“{accountLimited}”</em>. That is an account limit, not a file problem. The recorded runs in the inspector below show what these runs produce.</p> : null}
      {running ? <div className="lab26-live">{modes.map((item) => { const pane = live[item]; return pane ? <div key={item} className="lab24-live"><p className="lab7-session-id"><b>{modeInfo[item].label}</b> · {pane.sessionId ? `session ${shortId(pane.sessionId)} · ` : ''}{pane.status}</p>
        {pane.events.length ? <ol className="lab25-events">{pane.events.filter((event) => !/content_part|output_text|item\.added/.test(event.name)).map((event, index) => <li key={index} className={/environment/.test(event.name) ? 'env' : ''}><code>{event.name.replace('agent.session.', '')}</code><small>{seconds(event.ms)}</small></li>)}</ol> : null}
        {pane.copied.length ? <p className="lab8-note">Copied: {pane.copied.map((file) => <code key={file.path}>{basename(file.path)} ({file.sizeBytes} bytes) </code>)}</p> : null}
        {pane.listed ? <p className="lab8-note"><code>environments.files.list</code>: {pane.listed.length ? pane.listed.map((file) => <code key={file.path}>{basename(file.path)} </code>) : 'no files'}</p> : null}
        {pane.commands.length ? <CommandLog commands={pane.commands} kind="openai_hosted" /> : null}
        {pane.answer ? <SafeAnswer answer={pane.answer} /> : null}</div> : null; })}</div> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    <section className="lab7-card"><span className="eyebrow">RESULT · A REPORT THAT USES THE FILE AND NAMES ITS SOURCE</span><h2>Which runs produced a grounded report?</h2>
      <ModeGrid records={records} onSelect={setSelectedId} />
      {chosen ? <><h3 className="lab13-subhead">Run #{records.indexOf(chosen) + 1}</h3><RunDetail record={chosen} /></> : <p className="lab8-note">Run all three. The goal: two grounded reports that name the same file and hash, and an honest control run with no figures.</p>}
      {records.length ? <div className="lab9-table-wrap lab15-history lab16-history"><table>
        <thead><tr><th>Run</th><th>Files</th><th>Dataset</th><th>Session</th><th>Ready</th><th>Total</th><th>Commands</th><th>Verdict</th></tr></thead>
        <tbody>{records.map((item, index) => { const verdict = judgeFileRun(item.run); return <tr key={item.id} className={item.id === chosen?.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}>
          <th><button type="button" className="lab15-link" onClick={() => setSelectedId(item.id)} aria-pressed={item.id === chosen?.id}>#{index + 1}</button></th>
          <td><code>{modeInfo[item.run.mode].short}</code></td><td><code>{item.run.dataset.id}</code></td><td>{item.run.sessionId ? <code>{shortId(item.run.sessionId)}</code> : '—'}</td>
          <td>{seconds(item.run.readyMs)}</td><td>{seconds(item.run.durationMs)}</td><td>{item.run.commands.length}</td>
          <td><span className={'lab23-outcome ' + outcomeTone[verdict.outcome]}>{verdict.title}</span></td></tr>; })}</tbody>
      </table></div> : null}
    </section>

    <section className="lab7-card" id="lab27-inspector"><span className="eyebrow">FILE INSPECTOR · NO API KEY NEEDED</span><h2>Recorded runs, judged from the session</h2>
      <p>{samples.length} runs from live probes on 2026-09-28. Session IDs, file reports, listings, commands, outputs, replies, and timings are real; each CSV is rebuilt from its seed and hashes to what the sandbox’s <code>sha256sum</code> printed.</p>
      <div className="lab16-prompts">{samples.map((item) => <button type="button" key={item.id} className={item.id === sample.id ? 'selected' : ''} onClick={() => setSampleId(item.id)}>{item.label}</button>)}</div>
      <p className="lab8-note">{sample.lesson}</p>
      <RunDetail record={{ id: sample.id, run: sample.run, environment: buildEnvironment(sample.run.mode, { ...sample.run.dataset }) }} />
    </section>

    <section className="lab7-card" id="lab27-tests"><span className="eyebrow">TEST PAGE · NO API KEY NEEDED</span><h2>{fileTests.length} cases, one function each</h2><p>Every case runs the real <code>makeDataset</code>, <code>analyze</code>, <code>checkDataset</code>, <code>toBase64</code>, <code>fromBase64</code>, <code>checkRequest</code>, <code>parseReport</code>, <code>readBy</code>, <code>savedReport</code>, <code>parseFileRun</code>, or <code>judgeFileRun</code>, in this browser or on the server. Notes marked <em>Live</em> repeat what the API or the sandbox did on 2026-09-28.</p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={runInBrowser} disabled={Boolean(suiteBusy)}>{suiteBusy === 'browser' ? 'Running…' : 'Run all in the browser'}</button><button type="button" className="lab8-secondary" onClick={() => void runOnServer()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'server' ? 'Running…' : 'Run all on the server'}</button></div>
      {suite ? <p className={'lab18-score ' + (passed === fileTests.length ? 'ok' : 'fail')}><b>{passed}/{fileTests.length} passed</b> · ran in {suite.runtime} · {suite.durationMs} ms</p> : <p className="lab8-note">Not run yet. Each row states the result it must produce.</p>}
      <div className="lab18-tests">
        <div className="lab9-table-wrap lab18-table lab21-table"><table>
          <thead><tr><th>Case</th><th>Expect</th><th>Got</th><th /></tr></thead>
          {groups.map((group) => <tbody key={group.id}><tr className="lab18-group"><th colSpan={4}>{group.label}</th></tr>{fileTests.filter((item) => item.group === group.id).map((item) => { const result = suite?.results[item.id]; return <tr key={item.id} className={item.id === test.id ? 'selected' : ''} onClick={() => setTestId(item.id)}>
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

    <section className="lab3-guide lab16-guide"><h2>Read the evidence</h2><div><article><strong>Echo</strong><p><code>session.environment.files</code>: path, <code>cfile_</code> ID, and <code>size_bytes</code>. Compare the size with what you sent.</p></article><article><strong>Listing</strong><p><code>environments.files.list</code> is the API’s view of the sandbox, not the agent’s.</p></article><article><strong>Commands</strong><p><code>command_execution</code> items that read the file. Read the output: a wrong <code>awk</code> also exits 0.</p></article><article><strong>Report</strong><p>Path, SHA-256, and figures, checked against your own analysis. And a control run with no files.</p></article></div><p className="lab3-guide-note">A report that sounds grounded and one that is grounded look the same in the chat. The difference is in the session: what was staged, what was read, and whether the numbers match the bytes.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 27</span><span className="code-lessons-title" role="heading" aria-level={2}>The code that stages input files and proves the report used them</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Stage files with <code>environment.files</code>, encode them the way the API requires, or copy them into a running sandbox, ask for a report that names its source, collect the evidence, and check the report against your own analysis. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Run the test page on the server and show <em>{fileTests.length}/{fileTests.length} passed</em>. In the files checker, predict and then load <em>A .. escape</em> and <em>base64url data</em>; send one anyway and compare the API’s 400 with the checker. Then, live: click <em>Run all three</em>. For the two grounded reports, show that the path and SHA-256 match the dataset card, and that <code>size_bytes</code> matches what this app sent. For the control run, name the command that shows the files were missing. Finally, click <em>Edit the CSV</em>, change one refunded row to <code>completed</code>, predict the new figures, and run the staged mode again.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/environments/files" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}

function toBase64Length(text: string) { return Math.ceil(byteLength(text) / 3) * 4; }
