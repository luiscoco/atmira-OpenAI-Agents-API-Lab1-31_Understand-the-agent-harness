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
import { analyze, makeDataset, parseFileRef, type Dataset, type FileRef } from './lab27Files.ts';
import {
  analysisOf, basenameOf, checkPlan, downloadOf, firstByPath, forTurn, formatBytes, isPublishable, judgeArtifactRun, lastTurn, manifest, mimeFor, notesPath, outcomeTone, outputsDir,
  parseArtifact, parseArtifactRun, parsePlan, pick, promptsFor, reportFigures, reportPath, resolveLink, safeFilename, sandboxOnly, summaryPath, tablePath, taskInfo,
  type ArtifactRef, type ArtifactRun, type Task,
} from './lab29Artifacts.ts';
import { apiSamples, samples } from './lab29Scenarios.ts';
import { artifactTests, runArtifactSuite, type TestGroup, type TestResult } from './lab29Tests.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Suite = { source: 'browser' | 'server'; runtime: string; durationMs: number; results: Record<string, TestResult> };
type RunRecord = { id: string; run: ArtifactRun; source: 'live' | 'recorded' };
type LiveRun = { label: string; status: string; events: Array<{ name: string; ms: number }>; sessionId: string | null; artifacts: ArtifactRef[]; listed: FileRef[] | null; commands: CommandRun[]; answer: string; turns: number };
// What the browser itself saw when it saved a file: its own byte count and hash, against the artifact's metadata.
type Saved = { bytes: number; sha256: string | null; ok: boolean; note: string } | { error: string };

const lessons: Lesson[] = [
  { number: '01', title: 'Ask for outputs in /workspace/outputs', file: 'src/lab29Artifacts.ts', code: "// The prompt names the directory; the platform does the rest.\n'Create /workspace/outputs/enrollment-report.md …'\n'Create /workspace/outputs/tables/minutes-by-lab.csv …'\n'Write your working notes to /workspace/scratch/notes.txt.'\n\nisPublishable('/workspace/outputs/tables/minutes-by-lab.csv') // true\nisPublishable('/workspace/scratch/notes.txt')                // false\n// Live: 3 artifacts. notes.txt (520 bytes) was never one.", explanation: 'An artifact is a file the agent saved under slash workspace slash outputs. When the turn completes, the platform copies every file there into an immutable artifact. Anything else in the sandbox, like scratch notes, is not published, and it disappears with the sandbox. So the prompt names the directory. Live, the report, the summary, and a table in a subdirectory were all published, and the notes file written in the same turn was not. The same prompt pointed at slash workspace slash reports produced correct files and no artifacts at all.' },
  { number: '02', title: 'List after the turn completes', file: 'server/lab29.ts', code: "// No stream event announces an artifact. Wait for turn.completed, then list.\nfor await (const item of client.beta.agents.sessions.artifacts.list(sessionId, { order: 'asc', limit: 100 })) {\n  artifacts.push(item);\n}\n// { id: 'artifact_6557…', path: '/workspace/outputs/enrollment-report.md',\n//   size_bytes: 229, turn_id: 'turn_03ba…', environment_id: 'ccarenv_…', created_at: … }\n// Live: listed 0.2–0.6 s after turn.completed. limit 101 → 400.", explanation: 'The event stream never mentions artifacts. Live, a whole turn produced ready, turn created, items, text, and turn completed, and nothing else. So the server waits for turn completed and then calls sessions dot artifacts dot list. Live, the files were already there, two tenths to six tenths of a second later. Each artifact has its own I D, the original path, its size in bytes, and the I D of the turn that published it. The list is paginated, a hundred at most per page, so let the S D K iterate.' },
  { number: '03', title: 'Identify by turn_id and path', file: 'src/lab29Artifacts.ts', code: "export const pick = (artifacts, turnId, path) =>\n  artifacts.find((item) => item.turnId === turnId && item.path === path) ?? null;\n\n// Live, after a second turn rewrote the report:\n// turn 1  enrollment-report.md  230 bytes  artifact_80f3…\n// turn 1  summary.json           88 bytes  (not published again in turn 2)\n// turn 2  enrollment-report.md  242 bytes  artifact_c72a…\nfirstByPath(artifacts, reportPath)       // artifact_80f3…  the old one\npick(artifacts, turn2, reportPath)       // artifact_c72a…  the revision", explanation: 'Artifacts are immutable, so a rewrite does not change one. It creates another. Live, a second turn revised the report, and the session then held two artifacts with the same path: two hundred thirty bytes from turn one and two hundred forty two from turn two. The summary, untouched, was not published again. If you find a file by path alone, in ascending order you hand the user the old report. The documentation pattern matches both the turn I D and the path, so you get the file from the turn the user just ran.' },
  { number: '04', title: 'Download through your server', file: 'server/lab29.ts', code: "const artifact = await client.beta.agents.sessions.artifacts.retrieve(id, { session_id });\ncheckDownload(artifact)            // size first: 413 over this proxy's limit\nconst result = await client.beta.agents.sessions.artifacts.content(id, { session_id });\n// Live: content-type application/octet-stream, for Markdown and JSON alike.\nresponse.writeHead(200, {\n  'Content-Type': mimeFor(artifact.path),          // text/markdown; charset=utf-8\n  'Content-Disposition': 'attachment; filename=\"enrollment-report.md\"',\n  'X-Content-Type-Options': 'nosniff',\n});", explanation: 'The browser never holds the A P I key, so the React app downloads through the Node server. The server reads the metadata first, so the size decides before any bytes move. Then it streams the content. Live, the A P I sent application octet stream for every file, so the server chooses the type from the path, the file name from the base name with unsafe characters replaced, and always sends it as an attachment with no sniffing. Agent-written H T M L or S V G is only ever bytes. The server also refuses any session it did not create.' },
  { number: '05', title: 'Verify before you hand it over', file: 'src/lab29Artifacts.ts', code: "verifyDownload(artifact, download)\n// 229 bytes = size_bytes · sha256 9f5ed92a3268…\n\nreportFigures(text, analyze(csv))\n// ✓ rows_used 30  ✓ total_minutes 2079  ✓ completed 17  ✓ top_lab lab22\nsummaryFigures(json, analysis)   // valid JSON; \"39\" is not 39\ntableFigures(csv, dataset.csv)   // every lab's total\n\n// In the browser, too: crypto.subtle.digest('SHA-256', blob) === X-Artifact-Sha256", explanation: 'Published means the file exists, not that it is right. So the server downloads each artifact once, checks that the byte count equals size bytes, and hashes it. Then it reads the figures in the report, the summary, and the table, and compares them with the app’s own analysis of the same C S V. A report that counted refunded rows would download perfectly and still be wrong. When you click download, the browser hashes the file it received and compares that with the hash the server sent in a header.' },
  { number: '06', title: 'Cancelled turns and deleted copies', file: 'server/lab29.ts', code: "// A cancelled turn publishes nothing. Live:\n// printf 'draft' > /workspace/outputs/draft.md && sleep 120   → cancelled after 8 s\n// environments.files.list: draft.md 6 bytes   sessions.artifacts.list: nothing\n\nawait client.beta.agents.sessions.artifacts.delete(id, { session_id });\n// { object: 'agent.session.artifact.deleted', deleted: true }\n// retrieve / content → 404 Session artifact … was not found\n// environments.files.list → summary.json, 88 bytes: the sandbox copy is untouched", explanation: 'Publishing happens only when a turn completes. Live, a turn wrote a draft into slash workspace slash outputs and was cancelled while its command was still running. The draft was in the sandbox, in the right directory, and it never became an artifact. Retry the turn instead of looking for the file. Deleting works the other way. It removes the published copy at once, and every later call gets a four oh four, but the file in the sandbox stays. Artifacts outlive the sandbox, so download what the user needs before you delete anything. Lab thirty covers cleanup.' },
];

const groups: Array<{ id: TestGroup; label: string }> = [
  { id: 'publish', label: 'What gets published' },
  { id: 'identify', label: 'Identify the right artifact' },
  { id: 'download', label: 'Download it safely' },
  { id: 'verify', label: 'Verify the bytes and the figures' },
  { id: 'judge', label: 'Judge a run from its evidence' },
];
const tasks: Task[] = ['report', 'outside', 'revise', 'cancel'];
const today = '2026-09-28';
const defaultPlan = [`${reportPath} 229`, `${tablePath} 81`, `${notesPath} 520`, '/workspace/reports/summary.json 88', `${outputsDir}/recording.mp4 250 MiB`].join('\n');

const json = (value: unknown) => codeTokens(Prism.tokenize(JSON.stringify(value, null, 2) ?? 'undefined', Prism.languages.json || Prism.languages.javascript));
const newId = (): string => `run_${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)}`;
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const turnLabel = (run: ArtifactRun, turnId: string) => { const index = run.turns.findIndex((turn) => turn.id === turnId); return index < 0 ? '?' : `#${index + 1}`; };
const Mark = ({ ok }: { ok: boolean | null }) => (ok === null ? <span className="lab27-na">—</span> : <span className={'lab18-pass ' + (ok ? 'ok' : 'fail')}>{ok ? 'MATCH' : 'NO'}</span>);

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
async function hashBlob(blob: Blob): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// The reply, with sandbox paths turned into what they are: a download (published), or a path the browser cannot open.
function SafeAnswer({ answer, run, onDownload }: { answer: string; run: ArtifactRun; onDownload: (artifact: ArtifactRef) => void }) {
  const turnId = lastTurn(run)?.id ?? null;
  return <div className="lab7-answer lab16-answer lab21-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    pre: AnswerPre,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const target = resolveLink(href ?? '', run.artifacts, turnId);
      if (target.kind === 'artifact') return <button type="button" className="lab29-link" onClick={() => onDownload(target.artifact)} title={`Download ${target.artifact.id}`}>⤓ {children}</button>;
      if (target.kind === 'sandbox') return <span className="lab29-sandbox" title={`${target.path}: a sandbox path, not published`}>{children} <small>sandbox only</small></span>;
      const check = checkUrl(target.href);
      return check.href ? <a href={check.href} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span className="lab21-dead" title={href}>{children}</span>;
    },
  }}>{answer.replace(/([^\n])\n(?=[^\n])/g, '$1  \n')}</ReactMarkdown></div>;
}

function Checks({ run }: { run: ArtifactRun }) {
  const verdict = judgeArtifactRun(run);
  return <>
    <div className={'lab23-judgement ' + outcomeTone[verdict.outcome]}><strong>{verdict.title}</strong><span>{verdict.text}</span></div>
    <ul className="lab21-findings lab25-checks">{verdict.checks.map((check) => <li key={check.id} className={check.level === 'fail' ? 'error' : check.level}><b>{check.level === 'ok' ? '✓' : check.level === 'skip' ? '–' : check.level === 'warn' ? '!' : '✕'}</b><span><strong>{check.label}.</strong> {check.detail}</span></li>)}</ul>
  </>;
}

type Actions = { onDownload: (artifact: ArtifactRef) => void; onDelete: ((artifact: ArtifactRef) => void) | null; saved: Record<string, Saved>; busy: string | null; confirming: string | null };

function ArtifactTable({ record, actions }: { record: RunRecord; actions: Actions }) {
  const { run } = record;
  const final = lastTurn(run);
  const deleted = new Map(run.deleted.map((item) => [item.artifactId, item]));
  if (!run.artifacts.length) return <p className="lab8-note">No artifacts in this session. {final?.status === 'cancelled' ? 'The turn was cancelled: its outputs were abandoned.' : `Nothing was saved under ${outputsDir}.`}</p>;
  return <div className="lab9-table-wrap lab28-table lab29-table"><table>
    <thead><tr><th>Path</th><th>Turn</th><th>Artifact</th><th>size_bytes</th><th>Server download</th><th /></tr></thead>
    <tbody>{run.artifacts.map((artifact) => {
      const download = downloadOf(run, artifact.id);
      const gone = deleted.get(artifact.id);
      const saved = actions.saved[artifact.id];
      const current = final ? pick(run.artifacts, final.id, artifact.path)?.id === artifact.id : false;
      return <tr key={artifact.id} className={gone ? 'lab29-gone' : current ? 'selected' : ''}>
        <th><code>{artifact.path.replace(`${outputsDir}/`, '')}</code><small className="lab29-type">{mimeFor(artifact.path).split(';')[0]}</small></th>
        <td>{turnLabel(run, artifact.turnId)}{current && run.turns.length > 1 ? <small> latest</small> : null}</td>
        <td><code title={artifact.id}>{shortId(artifact.id)}</code></td>
        <td>{artifact.sizeBytes ?? '—'}</td>
        <td>{download ? download.error ? <span className="lab27-no">{download.error}</span> : <><Mark ok={download.bytes === artifact.sizeBytes} /> <small>{download.bytes} bytes · {download.contentType ?? '?'} · <code>{download.sha256?.slice(0, 10)}…</code></small></> : <span className="lab27-na">not downloaded</span>}</td>
        <td className="lab29-actions">{gone ? <small className="lab27-no">deleted · then {gone.after.slice(0, 3)}{gone.liveBytes !== null ? ` · sandbox copy ${gone.liveBytes} bytes` : ''}</small> : <>
          <button type="button" className="lab8-secondary lab29-dl" onClick={() => actions.onDownload(artifact)} disabled={actions.busy === artifact.id}>{actions.busy === artifact.id ? 'Saving…' : `⤓ ${safeFilename(artifact.path)}`}</button>
          {actions.onDelete ? <button type="button" className="lab8-secondary lab24-danger lab29-dl" onClick={() => actions.onDelete?.(artifact)} disabled={actions.busy === artifact.id}>{actions.confirming === artifact.id ? 'Confirm: delete' : 'Delete copy'}</button> : null}
          {saved ? 'error' in saved ? <small className="lab27-no">{saved.error}</small> : <small className={saved.ok ? 'lab29-ok' : 'lab27-no'}>browser: {saved.bytes} bytes · {saved.note}</small> : null}
        </>}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

function SandboxTable({ run }: { run: ArtifactRun }) {
  if (!run.listed) return <p className="lab8-note">The sandbox was not listed.</p>;
  const latest = new Map(run.artifacts.map((item) => [item.path, item]));
  return <div className="lab9-table-wrap lab28-table"><table>
    <thead><tr><th><code>environments.files.list /workspace</code></th><th>Live size</th><th>Under outputs</th><th>Published</th></tr></thead>
    <tbody>{run.listed.map((file) => { const artifact = latest.get(file.path); const input = file.path.startsWith('/workspace/data/'); return <tr key={file.path}>
      <th><code>{file.path}</code></th><td>{file.sizeBytes ?? '—'}</td><td>{isPublishable(file.path) ? 'yes' : 'no'}</td>
      <td>{input ? <span className="lab27-na">staged input</span> : artifact ? <><code>{shortId(artifact.id)}</code> <small>{artifact.sizeBytes} bytes{artifact.sizeBytes !== file.sizeBytes ? ' (an older copy)' : ''}</small></> : <span className="lab27-no">sandbox only</span>}</td></tr>; })}</tbody>
  </table></div>;
}

function Preview({ run }: { run: ArtifactRun }) {
  const turn = lastTurn(run);
  const report = turn ? pick(run.artifacts, turn.id, reportPath) : null;
  const text = report ? downloadOf(run, report.id)?.text ?? null : null;
  const analysis = analysisOf(run);
  if (!report || text === null) return null;
  return <div className="lab21-report-grid">
    <div><h3 className="lab13-subhead">The report, as downloaded <small>(artifact {shortId(report.id)})</small></h3><div className="lab28-doc"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre, a: ({ children }) => <span>{children}</span> }}>{text.replace(/^([a-z_]+: [^\n]*)\n(?=[a-z_]+: )/gm, '$1  \n')}</ReactMarkdown></div></div>
    <div><h3 className="lab13-subhead">Its figures, against this app’s analysis</h3>{analysis ? <div className="lab9-table-wrap lab28-table"><table><thead><tr><th>Line</th><th>The artifact says</th><th>The data says</th><th /></tr></thead>
      <tbody>{reportFigures(text, analysis).map((figure) => <tr key={figure.field}><th><code>{figure.field}</code></th><td>{figure.got ?? <em>missing</em>}</td><td>{figure.want}</td><td><Mark ok={figure.ok} /></td></tr>)}</tbody></table></div> : <p className="lab8-note">The dataset could not be analysed.</p>}
      <p className="lab8-note">Refunded rows excluded, per the brief. The analysis runs in this browser on the same CSV the sandbox received.</p></div>
  </div>;
}

function RunDetail({ record, actions }: { record: RunRecord; actions: Actions }) {
  const { run } = record;
  const turn = lastTurn(run);
  const mine = turn ? forTurn(run.artifacts, turn.id) : [];
  const stopped = Boolean(run.error) || turn?.status === 'failed' || turn?.status === 'cancelled';
  return <div className="lab25-run">
    <p className="lab15-ids"><b>{taskInfo[run.task].label}</b>{run.sessionId ? <> · session <code>{shortId(run.sessionId)}</code></> : null} · {run.turns.map((item, index) => <span key={item.id || index}>turn {index + 1} <code>{item.status}</code>{index < run.turns.length - 1 ? ' · ' : ''}</span>)} · dataset <code>{run.dataset.id}</code> · {record.source}</p>
    <Checks run={run} />
    <div className="lab25-facts">
      <span><small>Sandbox ready</small><b>{seconds(run.readyMs)}</b></span>
      <span><small>Total time</small><b>{seconds(run.durationMs)}</b></span>
      <span><small>Published by the last turn</small><b>{mine.length}</b><small>{run.artifacts.length} in the session</small></span>
      <span><small>Listed after turn end</small><b>{seconds(turn?.publishMs ?? null)}</b><small>no artifact event in the stream</small></span>
      <span><small>Sandbox only</small><b>{sandboxOnly(run).length}</b><small>{sandboxOnly(run).map((file) => basenameOf(file.path)).join(', ') || 'nothing'}</small></span>
    </div>
    <h3 className="lab13-subhead"><code>sessions.artifacts.list</code> · the downloads</h3>
    <ArtifactTable record={record} actions={actions} />
    <h3 className="lab13-subhead">The sandbox, next to what was published</h3>
    <SandboxTable run={run} />
    <Preview run={run} />
    <div className="lab21-report-grid">
      <div><h3 className="lab13-subhead">Reply</h3>{run.answer ? <SafeAnswer answer={run.answer} run={run} onDownload={actions.onDownload} /> : <p className="lab8-note">No answer text.</p>}
        {run.answers.length > 1 ? <details className="lab16-preview"><summary>Earlier turns’ replies</summary>{run.answers.slice(0, -1).map((answer, index) => <div key={index}><h4 className="lab13-subhead">Turn {index + 1}</h4><SafeAnswer answer={answer} run={{ ...run, turns: run.turns.slice(0, index + 1) }} onDownload={actions.onDownload} /></div>)}</details> : null}
        {run.commentary.length ? <><h3 className="lab13-subhead">Commentary <small>(a claim, not evidence)</small></h3><ul className="lab26-commentary">{run.commentary.map((line, index) => <li key={index}>{line}</li>)}</ul></> : null}
        {run.error ? <p className="lab2-error" role="alert">{run.error}</p> : null}</div>
      <div><h3 className="lab13-subhead">Evidence <code>command_execution</code></h3><CommandLog commands={run.commands} kind="openai_hosted" stopped={stopped} /></div>
    </div>
    <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => saveBlob(new Blob([manifest(run)], { type: 'application/json' }), `delivery-${run.sessionId ? shortId(run.sessionId).replace(/[^A-Za-z0-9]/g, '') : run.dataset.id}.json`)}>⤓ Delivery manifest (JSON)</button></div>
    <details className="lab16-preview"><summary>The prompt{run.prompts.length > 1 ? 's' : ''}</summary>{run.prompts.map((prompt, index) => <pre key={index} className="lab19-decl lab27-prompt">{run.prompts.length > 1 ? `Turn ${index + 1}\n` : ''}{prompt}</pre>)}</details>
  </div>;
}

// Which artifact is "the report"? Every copy of one path, and what each way of choosing returns.
function Identify({ run }: { run: ArtifactRun }) {
  const paths = [...new Set(run.artifacts.map((item) => item.path))];
  const [path, setPath] = useState(paths.includes(reportPath) ? reportPath : paths[0] ?? '');
  const turn = lastTurn(run);
  const copies = run.artifacts.filter((item) => item.path === path);
  const asc = firstByPath([...run.artifacts].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)), path);
  const desc = firstByPath([...run.artifacts].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)), path);
  const chosen = turn ? pick(run.artifacts, turn.id, path) : null;
  if (!paths.length) return <p className="lab8-note">This run has no artifacts to choose from.</p>;
  return <>
    <div className="lab16-prompts">{paths.map((item) => <button type="button" key={item} className={item === path ? 'selected' : ''} onClick={() => setPath(item)}>{item.replace(`${outputsDir}/`, '')}</button>)}</div>
    <div className="lab9-table-wrap lab28-table"><table>
      <thead><tr><th>Artifact</th><th>Turn</th><th>size_bytes</th><th>created_at</th><th>First by path, asc</th><th>First by path, desc</th><th><code>pick(turn_id, path)</code></th></tr></thead>
      <tbody>{copies.map((item) => <tr key={item.id} className={item.id === chosen?.id ? 'selected' : ''}><th><code>{shortId(item.id)}</code></th><td>{turnLabel(run, item.turnId)}</td><td>{item.sizeBytes}</td><td>{item.createdAt ? new Date(item.createdAt * 1000).toISOString().slice(11, 19) : '—'}</td>
        <td>{item.id === asc?.id ? '←' : ''}</td><td>{item.id === desc?.id ? '←' : ''}</td><td>{item.id === chosen?.id ? <span className="lab18-pass ok">THIS TURN</span> : ''}</td></tr>)}</tbody>
    </table></div>
    <p className="lab8-note">{chosen ? copies.length > 1 ? `${copies.length} artifacts share this path. The last turn (${turnLabel(run, turn!.id)}) published ${shortId(chosen.id)}; ${asc?.id === chosen.id ? 'ascending order happens to agree' : `ascending order picks ${shortId(asc!.id)}, an older copy`}.` : 'One copy: every way of choosing agrees, for now.' : `The last turn did not publish ${path}: its only copy is from ${turnLabel(run, copies[0].turnId)}. Asking for this turn’s copy correctly finds none.`}</p>
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

export default function Lab29({ active, health }: { active: boolean; health: Health }) {
  const [dataset, setDataset] = useState<Dataset>(() => makeDataset());
  const [task, setTask] = useState<Task>('report');
  const [plan, setPlan] = useState(defaultPlan);
  const [live, setLive] = useState<Record<string, LiveRun>>({});
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState(samples[0]?.id ?? '');
  const [saved, setSaved] = useState<Record<string, Saved>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [suite, setSuite] = useState<Suite | null>(null);
  const [suiteBusy, setSuiteBusy] = useState<'browser' | 'server' | null>(null);
  const [testId, setTestId] = useState(artifactTests[0].id);
  const [error, setError] = useState('');
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const aborts = useRef<Set<AbortController>>(new Set());
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const analysis = useMemo(() => analyze(dataset.csv).analysis, [dataset]);
  const planned = useMemo(() => parsePlan(plan), [plan]);
  const planFindings = useMemo(() => [...planned.errors.map((text) => ({ level: 'error' as const, text })), ...checkPlan(planned.files)], [planned]);
  const running = Object.keys(live).length > 0;
  const chosen = records.find((item) => item.id === selectedId) ?? records.at(-1) ?? null;
  const sample = samples.find((item) => item.id === sampleId) ?? samples[0];
  const identifyRun = chosen && chosen.run.artifacts.length ? chosen.run : samples.find((item) => item.id === 'revise')?.run ?? null;
  const test = artifactTests.find((item) => item.id === testId) ?? artifactTests[0];
  const testResult = suite?.results[test.id] ?? null;
  const passed = suite ? Object.values(suite.results).filter((item) => item.pass).length : 0;
  const noKey = !health?.configured;
  const lastError = records.at(-1)?.run.error ?? null;
  const accountLimited = lastError && /usage or billing limit|insufficient_quota|billing/i.test(lastError) ? lastError.split('. ')[0] : null;

  // One task in one new hosted session. Several may run at once; each has its own live pane.
  async function runOne(runTask: Task) {
    const controller = new AbortController();
    aborts.current.add(controller);
    const key = newId();
    setLive((previous) => ({ ...previous, [key]: { label: taskInfo[runTask].label, status: 'Starting…', events: [], sessionId: null, artifacts: [], listed: null, commands: [], answer: '', turns: 0 } }));
    const patch = (next: Partial<LiveRun> | ((current: LiveRun) => Partial<LiveRun>)) => setLive((previous) => {
      const current = previous[key];
      return current ? { ...previous, [key]: { ...current, ...(typeof next === 'function' ? next(current) : next) } } : previous;
    });
    try {
      const response = await fetch('/api/lab29/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: runTask, dataset: { id: dataset.id, csv: dataset.csv } }), signal: controller.signal });
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error || `Request failed (${response.status}).`);
      let summary: unknown = null;
      await readLines(response, (line) => {
        if (line.type === 'status' && typeof line.label === 'string') patch({ status: line.label });
        if (line.type === 'event' && typeof line.name === 'string') { const entry = { name: line.name, ms: Number(line.ms ?? 0) }; patch((current) => ({ events: [...current.events, entry].slice(-60) })); }
        if (line.type === 'session' && typeof line.sessionId === 'string') patch({ sessionId: line.sessionId });
        if (line.type === 'turn') patch((current) => ({ turns: current.turns + 1 }));
        if (line.type === 'artifacts' && Array.isArray(line.artifacts)) patch({ artifacts: line.artifacts.map(parseArtifact) });
        if (line.type === 'listed' && Array.isArray(line.files)) patch({ listed: line.files.map(parseFileRef) });
        if (line.type === 'command') { const next = parseCommand(line.command); patch((current) => ({ commands: [...current.commands.filter((item) => item.id !== next.id), next] })); }
        if (line.type === 'text' && typeof line.text === 'string') patch({ answer: line.text });
        if (line.type === 'summary') summary = line.run;
      });
      if (!summary) throw new Error('The stream ended without a summary.');
      const record: RunRecord = { id: key, run: parseArtifactRun(summary), source: 'live' };
      setRecords((previous) => [...previous, record]);
      setSelectedId(record.id);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error ? caught.message : 'The run failed.');
    } finally {
      aborts.current.delete(controller);
      setLive((previous) => { const next = { ...previous }; delete next[key]; return next; });
    }
  }
  async function runAll() { setError(''); await Promise.all(tasks.map((item) => runOne(item))); }
  function stopAll() { aborts.current.forEach((controller) => controller.abort()); }

  // Save one artifact. Live: through the server proxy, then hash what the browser got. Recorded: from the bytes on the page.
  function actionsFor(record: RunRecord): Actions {
    const onDownload = async (artifact: ArtifactRef) => {
      setBusy(artifact.id); setError('');
      const name = safeFilename(artifact.path);
      try {
        let blob: Blob; let expected: string | null;
        if (record.source === 'live' && record.run.sessionId) {
          const response = await fetch(`/api/lab29/artifact?session=${encodeURIComponent(record.run.sessionId)}&artifact=${encodeURIComponent(artifact.id)}`);
          if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || `Download failed (${response.status}).`);
          blob = await response.blob();
          expected = response.headers.get('X-Artifact-Sha256');
        } else {
          const download = downloadOf(record.run, artifact.id);
          if (download?.text == null) throw new Error('This recording kept no bytes for that file.');
          blob = new Blob([download.text], { type: mimeFor(artifact.path) });
          expected = download.sha256;
        }
        const sha = await hashBlob(blob) ?? (record.source === 'recorded' ? sha256Hex(await blob.text()) : null);
        const sizeOk = blob.size === artifact.sizeBytes;
        const shaOk = sha !== null && sha === expected;
        saveBlob(blob, name);
        setSaved((previous) => ({ ...previous, [artifact.id]: { bytes: blob.size, sha256: sha, ok: sizeOk && shaOk, note: `${sizeOk ? '= size_bytes' : `≠ size_bytes ${artifact.sizeBytes}`} · ${sha === null ? 'no hash (not a secure context)' : shaOk ? 'sha256 matches' : 'sha256 differs'}` } }));
      } catch (caught) {
        setSaved((previous) => ({ ...previous, [artifact.id]: { error: caught instanceof Error ? caught.message : 'Download failed.' } }));
      } finally { setBusy(null); }
    };
    const onDelete = record.source === 'live' ? async (artifact: ArtifactRef) => {
      if (confirming !== artifact.id) { setConfirming(artifact.id); return; }
      setConfirming(null); setBusy(artifact.id); setError('');
      try {
        const response = await fetch('/api/lab29/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: record.run.sessionId, artifactId: artifact.id }) });
        const body = await response.json() as { after?: string; liveBytes?: number | null; error?: string };
        if (!response.ok) throw new Error(body.error || `Delete failed (${response.status}).`);
        const entry = { artifactId: artifact.id, after: String(body.after ?? ''), liveBytes: typeof body.liveBytes === 'number' ? body.liveBytes : null };
        setRecords((previous) => previous.map((item) => (item.id === record.id ? { ...item, run: { ...item.run, deleted: [...item.run.deleted, entry] } } : item)));
      } catch (caught) { setError(caught instanceof Error ? caught.message : 'Delete failed.'); }
      finally { setBusy(null); }
    } : null;
    return { onDownload: (artifact) => void onDownload(artifact), onDelete: onDelete ? (artifact) => void onDelete(artifact) : null, saved, busy, confirming };
  }

  function runInBrowser() {
    setSuiteBusy('browser'); setError('');
    const started = performance.now();
    try {
      const results = runArtifactSuite();
      setSuite({ source: 'browser', runtime: 'this browser', durationMs: Math.round(performance.now() - started), results: Object.fromEntries(results.map((item) => [item.id, item])) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The suite crashed.'); }
    finally { setSuiteBusy(null); }
  }
  async function runOnServer() {
    setSuiteBusy('server'); setError('');
    try {
      const response = await fetch('/api/lab29/test', { method: 'POST' });
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
      const utterance = new SpeechSynthesisUtterance(`${speechMode === 'all' ? `Snippet ${Number(lesson.number)}. ` : ''}${lesson.title.replace(/\/workspace\/outputs/g, 'slash workspace slash outputs').replace(/_/g, ' ')}. ${lesson.explanation}`);
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

  const latest = (id: Task) => [...records].reverse().find((item) => item.run.task === id) ?? null;

  return <div className="lab16-page lab21-page lab22-page lab23-page lab25-page lab26-page lab27-page lab28-page lab29-page">
    <div className="lab2-hero"><span className="lab2-badge lab29-badge">29/50</span><div><div className="eyebrow">LAB 29 / CREATE AND DOWNLOAD ARTIFACTS</div><h1>Save it to <em>/workspace/outputs</em>, then hand the user the right file.</h1><p>When a hosted turn completes, every file under <code>/workspace/outputs</code> becomes an immutable <strong>artifact</strong>: a copy with its own ID, path, size, and <code>turn_id</code> that outlives the sandbox. List them with <code>sessions.artifacts.list</code>, pick one by turn and path, download it with <code>sessions.artifacts.content</code> through your server, and check it before the user opens it.</p></div></div>

    <section className="lab3-guide lab25-flow lab29-flow" aria-label="From a file in the sandbox to a download in the browser"><h2>From a file in the sandbox to a download in the browser</h2><div>
      <article><strong>Write</strong><p>The prompt names <code>/workspace/outputs/…</code>. Scratch work goes elsewhere.</p></article>
      <article><strong>Complete</strong><p>Only a <code>completed</code> turn publishes. A cancelled one abandons its outputs.</p></article>
      <article><strong>List</strong><p><code>sessions.artifacts.list</code> after <code>turn.completed</code>. No event announces them.</p></article>
      <article><strong>Identify</strong><p>Match <code>turn_id</code> and <code>path</code>. A rewrite is a new artifact.</p></article>
      <article className="proof"><strong>Download</strong><p>Through the server, with a safe name and type, verified by size, hash, and content.</p></article>
    </div><p className="lab3-guide-note">An environment file is live and dies with the sandbox. An artifact is a frozen copy you can still download after the sandbox expires, until you delete it.</p></section>

    <section className="lab7-card"><span className="eyebrow">PLAN · NO API KEY NEEDED</span><h2>Which of these files will the user be able to download?</h2>
      <p>One file per line: an absolute path and a size. The planner applies the rule that held live (only <code>{outputsDir}/</code> is published) and the documented limits: 200 MiB per file, 500 MiB per turn.</p>
      <div className="lab21-config">
        <div><label htmlFor="lab29-plan" className="lab24-label">Planned files <small>path size</small></label>
          <textarea id="lab29-plan" className="lab25-textarea lab28-textarea lab29-plan" value={plan} onChange={(event) => setPlan(event.target.value)} spellCheck={false} />
          <h3 className="lab13-subhead">The dataset every run stages</h3>
          <p className="lab8-note">The Lab 27 enrollments CSV and brief, as inline files in <code>environment.files</code>, network <code>disabled</code>. This browser computes the figures the report must contain.</p>
          <div className="lab25-facts lab27-facts">
            <span><small>CSV</small><b><code>{basenameOf(dataset.csvPath)}</code></b><small>{analysis ? `${analysis.rowsTotal} rows · ${analysis.refunded} refunded` : 'invalid'}</small></span>
            <span><small>Expected</small><b>{analysis ? `${analysis.rowsUsed} rows · ${analysis.totalMinutes.toLocaleString('en')} min` : '—'}</b><small>{analysis ? `${analysis.completed} completed · top ${analysis.topLab}` : ''}</small></span>
          </div>
          <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => setDataset(makeDataset())} disabled={running}>New dataset</button></div>
        </div>
        <div><h3 className="lab13-subhead">Planner</h3><Findings findings={planFindings} />
          <details className="lab16-preview"><summary>The CSV</summary><pre className="lab19-decl lab27-prompt">{dataset.csv}</pre></details>
        </div>
      </div>
    </section>

    <section className="lab7-card"><span className="eyebrow">LIVE · FOUR TASKS, ONE DATASET</span><h2>Run it in a real sandbox</h2>
      <fieldset className="lab15-modes lab21-modes lab29-tasks" disabled={running}><legend>Task</legend>
        {tasks.map((item) => <label key={item} className={task === item ? 'selected' : ''}><input type="radio" name="lab29-task" checked={task === item} onChange={() => setTask(item)} /><span><strong>{taskInfo[item].label}</strong><small>{taskInfo[item].note}</small></span></label>)}
      </fieldset>
      <details className="lab16-preview"><summary>The prompt{taskInfo[task].turns > 1 ? 's' : ''} for this task</summary>{promptsFor(task, dataset).map((prompt, index) => <pre key={index} className="lab19-decl lab27-prompt">{taskInfo[task].turns > 1 ? `Turn ${index + 1}\n` : ''}{prompt}</pre>)}</details>
      <div className="lab8-actions">
        <button type="button" className="lab7-primary" onClick={() => { setError(''); void runOne(task); }} disabled={running || noKey || !analysis}>{running ? 'Running…' : `Run: ${taskInfo[task].label.toLowerCase()}`}</button>
        <button type="button" className="lab8-secondary" onClick={() => void runAll()} disabled={running || noKey || !analysis}>Run all four</button>
        {running ? <button type="button" className="lab8-secondary" onClick={stopAll}>Stop</button> : null}
      </div>
      {noKey ? <p className="lab8-note">Add OPENAI_API_KEY to .env to run sessions. The planner, the recorded runs (with working downloads), the identify table, and the test page work without a key.</p> : <p className="lab8-note">Each run is a new <code>openai_hosted</code> session: about 20–27 seconds to become ready, then 20–45 seconds of work. Downloads and deletes go through this server, and only for sessions it created since it started. Hosted sessions stay in your project until they are deleted; Lab 30 covers cleanup.</p>}
      {accountLimited ? <p className="lab20-notice" role="status">The last run was refused with <em>“{accountLimited}”</em>. That is an account limit, not an artifact problem. The recorded runs below show what these tasks produce.</p> : null}
      {running ? <div className="lab26-live">{Object.entries(live).map(([key, pane]) => <div key={key} className="lab24-live"><p className="lab7-session-id"><b>{pane.label}</b> · {pane.sessionId ? `session ${shortId(pane.sessionId)} · ` : ''}{pane.status}</p>
        {pane.events.length ? <ol className="lab25-events">{pane.events.filter((event) => !/content_part|output_text|item\.added|item\.done/.test(event.name)).map((event, index) => <li key={index} className={/environment|completed|cancelled/.test(event.name) ? 'env' : ''}><code>{event.name.replace('agent.session.', '')}</code><small>{seconds(event.ms)}</small></li>)}</ol> : null}
        {pane.artifacts.length ? <p className="lab8-note"><code>sessions.artifacts.list</code>: {pane.artifacts.map((item) => <code key={item.id}>{item.path.replace(`${outputsDir}/`, '')} ({item.sizeBytes} bytes) </code>)}</p> : pane.turns ? <p className="lab8-note"><code>sessions.artifacts.list</code>: none yet.</p> : null}
        {pane.listed ? <p className="lab8-note"><code>environments.files.list</code>: {pane.listed.filter((file) => !file.path.startsWith('/workspace/data/')).map((file) => <code key={file.path}>{file.path} </code>)}</p> : null}
        {pane.commands.length ? <CommandLog commands={pane.commands} kind="openai_hosted" /> : null}
        {pane.answer ? <div className="lab7-answer lab21-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span>{children}</span> }}>{pane.answer}</ReactMarkdown></div> : null}</div>)}</div> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    <section className="lab7-card"><span className="eyebrow">RESULT · A DOWNLOADABLE REPORT IN THE REACT APP</span><h2>Which task delivered a file the user can download?</h2>
      <div className="lab29-grid" role="list" aria-label="Latest run for each task">
        {tasks.map((id) => {
          const record = latest(id);
          const head = <span className="lab27-grid-mode"><strong>{taskInfo[id].label}</strong><code>{taskInfo[id].short}</code></span>;
          if (!record) return <div role="listitem" key={id} className="lab26-cell empty">{head}<small>not run yet</small></div>;
          const verdict = judgeArtifactRun(record.run);
          const turn = lastTurn(record.run);
          return <button type="button" role="listitem" key={id} className={'lab26-cell ' + outcomeTone[verdict.outcome]} onClick={() => setSelectedId(record.id)}>{head}<strong>{verdict.title}</strong><small>{turn ? forTurn(record.run.artifacts, turn.id).length : 0} published by the last turn · {sandboxOnly(record.run).length} sandbox-only</small></button>;
        })}
      </div>
      {chosen ? <><h3 className="lab13-subhead">Run #{records.indexOf(chosen) + 1}</h3><RunDetail record={chosen} actions={actionsFor(chosen)} /></> : <p className="lab8-note">Run all four. The goal: a verified report you download from this page; files that exist and cannot be downloaded; a revision you find by turn; and a cancelled turn that published nothing. The recorded runs below show each one.</p>}
      {records.length ? <div className="lab9-table-wrap lab15-history lab16-history"><table>
        <thead><tr><th>Run</th><th>Task</th><th>Session</th><th>Turns</th><th>Artifacts</th><th>Total</th><th>Verdict</th></tr></thead>
        <tbody>{records.map((item, index) => { const verdict = judgeArtifactRun(item.run); return <tr key={item.id} className={item.id === chosen?.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}>
          <th><button type="button" className="lab15-link" onClick={() => setSelectedId(item.id)} aria-pressed={item.id === chosen?.id}>#{index + 1}</button></th>
          <td>{taskInfo[item.run.task].label}</td><td>{item.run.sessionId ? <code>{shortId(item.run.sessionId)}</code> : '—'}</td><td>{item.run.turns.map((turn) => turn.status).join(', ')}</td>
          <td>{item.run.artifacts.length}</td><td>{seconds(item.run.durationMs)}</td>
          <td><span className={'lab23-outcome ' + outcomeTone[verdict.outcome]}>{verdict.title}</span></td></tr>; })}</tbody>
      </table></div> : null}
    </section>

    <section className="lab7-card"><span className="eyebrow">IDENTIFY · NO API KEY NEEDED</span><h2>Which artifact is “the report”?</h2>
      <p>Every copy of one path in {chosen && chosen.run.artifacts.length ? 'the selected run' : 'the recorded revise run'}, and what each way of choosing returns. The docs match <code>turn_id</code> and <code>path</code>; the list’s own order is not a version number.</p>
      {identifyRun ? <Identify key={identifyRun.sessionId ?? 'none'} run={identifyRun} /> : <p className="lab8-note">No run with artifacts yet.</p>}
    </section>

    {sample ? <section className="lab7-card" id="lab29-inspector"><span className="eyebrow">INSPECTOR · NO API KEY NEEDED</span><h2>Recorded runs, judged from the session</h2>
      <p>{samples.length} runs through this lab’s server on {today}. Session and artifact IDs, listings, commands, replies, and the downloaded bytes are real. Downloads here save the recorded bytes and check their hash.</p>
      <div className="lab16-prompts">{samples.map((item) => <button type="button" key={item.id} className={item.id === sample.id ? 'selected' : ''} onClick={() => setSampleId(item.id)}>{item.label}</button>)}</div>
      <p className="lab8-note">{sample.lesson}</p>
      <RunDetail record={{ id: sample.id, run: sample.run, source: 'recorded' }} actions={actionsFor({ id: sample.id, run: sample.run, source: 'recorded' })} />
    </section> : null}

    <section className="lab7-card"><span className="eyebrow">API · RECORDED {today}</span><h2>What the artifacts API did</h2>
      <p>A probe session (<code>{shortId('sess_0d642d2a65313663006aba514a276881958b7cafc8c50bc0a1')}</code>) wrote a report, revised it, cancelled a third turn, and deleted one artifact.</p>
      <div className="lab9-table-wrap lab28-table lab29-api"><table>
        <thead><tr><th>Call</th><th>Answer</th><th>So</th></tr></thead>
        <tbody>{apiSamples.map((item) => <tr key={item.id}><th>{item.call}</th><td><pre className="lab19-decl lab25-raw">{item.answer}</pre></td><td>{item.lesson}</td></tr>)}</tbody>
      </table></div>
    </section>

    <section className="lab7-card" id="lab29-tests"><span className="eyebrow">TEST PAGE · NO API KEY NEEDED</span><h2>{artifactTests.length} cases, one function each</h2><p>Every case runs the real <code>isPublishable</code>, <code>checkPlan</code>, <code>pick</code>, <code>firstByPath</code>, <code>latestByPath</code>, <code>mimeFor</code>, <code>safeFilename</code>, <code>downloadHeaders</code>, <code>checkDownload</code>, <code>reportFigures</code>, <code>summaryFigures</code>, <code>tableFigures</code>, <code>verifyDownload</code>, <code>resolveLink</code>, <code>parseArtifactRun</code>, <code>judgeArtifactRun</code>, or <code>manifest</code>, in this browser or on the server. Fixtures are the live probe’s IDs and bytes from {today}.</p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={runInBrowser} disabled={Boolean(suiteBusy)}>{suiteBusy === 'browser' ? 'Running…' : 'Run all in the browser'}</button><button type="button" className="lab8-secondary" onClick={() => void runOnServer()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'server' ? 'Running…' : 'Run all on the server'}</button></div>
      {suite ? <p className={'lab18-score ' + (passed === artifactTests.length ? 'ok' : 'fail')}><b>{passed}/{artifactTests.length} passed</b> · ran in {suite.runtime} · {suite.durationMs} ms</p> : <p className="lab8-note">Not run yet. Each row states the result it must produce.</p>}
      <div className="lab18-tests">
        <div className="lab9-table-wrap lab18-table lab21-table"><table>
          <thead><tr><th>Case</th><th>Expect</th><th>Got</th><th /></tr></thead>
          {groups.map((group) => <tbody key={group.id}><tr className="lab18-group"><th colSpan={4}>{group.label}</th></tr>{artifactTests.filter((item) => item.group === group.id).map((item) => { const result = suite?.results[item.id]; return <tr key={item.id} className={item.id === test.id ? 'selected' : ''} onClick={() => setTestId(item.id)}>
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

    <section className="lab3-guide lab16-guide"><h2>Read the evidence</h2><div><article><strong>Artifact list</strong><p>What the user can download: ID, path, <code>size_bytes</code>, <code>turn_id</code>. Nothing else is.</p></article><article><strong>Sandbox listing</strong><p><code>environments.files.list</code>: what exists now, published or not, until the sandbox goes.</p></article><article><strong>The bytes</strong><p>Downloaded length equals <code>size_bytes</code>; the browser’s SHA-256 equals the server’s.</p></article><article><strong>The content</strong><p>Figures checked against the data. A published file can still be wrong.</p></article></div><p className="lab3-guide-note">The reply says where the agent put things. The artifact list says what the user can have.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 29</span><span className="code-lessons-title" role="heading" aria-level={2}>The code that publishes, finds, downloads, and checks an artifact</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Ask for outputs in the published directory, list them once the turn completes, identify the right copy by turn and path, download through the server with a safe name and type, verify the bytes and the figures, and handle cancelled turns and deleted copies. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Run the test page on the server and show <em>{artifactTests.length}/{artifactTests.length} passed</em>. In the planner, predict which of your own files a user could download, then add one that is 250 MiB. Live: click <em>Run all four</em>. From the <em>Write to /workspace/outputs</em> run, download the report from this page and show the browser’s <em>sha256 matches</em>; name the file that stayed in the sandbox. In the revise run, use the identify table to show which artifact the path alone would have given the user. Explain, from the cancel run’s sandbox listing, why draft.md was never published. Finally, delete the summary’s published copy and show the 404 and the sandbox copy that survived.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/environments/files" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
