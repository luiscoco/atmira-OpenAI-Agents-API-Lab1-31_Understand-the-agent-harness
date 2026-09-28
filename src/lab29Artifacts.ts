// Lab 29: create and download artifacts. Shared by the browser and the server: the tasks, the publish rule for
// /workspace/outputs, artifact identification by turn and path, safe download headers, the report and summary checks,
// and the judge that reads a run from its evidence. No network, no API key.
import type { Finding } from './lab21Search.ts';
import type { TurnStatus } from './lab16Tool.ts';
import { parseCommand, parseUsage, sha256Hex, type CommandRun, type Usage } from './lab26Environment.ts';
import { analyze, briefPath, inlineFiles, parseFileRef, parseReport, type Analysis, type Dataset, type FileRef } from './lab27Files.ts';

// ---- The rule: only files under /workspace/outputs are published, when the turn completes ----

export const outputsDir = '/workspace/outputs';
export const reportPath = `${outputsDir}/enrollment-report.md`;
export const summaryPath = `${outputsDir}/summary.json`;
export const tablePath = `${outputsDir}/tables/minutes-by-lab.csv`;
export const notesPath = '/workspace/scratch/notes.txt';
export const outsideDir = '/workspace/reports';
export const draftPath = `${outputsDir}/draft.md`;
// Documented limits (not probed live): 200 MiB per file, 500 MiB for all outputs of one turn.
export const MiB = 1024 * 1024;
export const limits = { fileBytes: 200 * MiB, turnBytes: 500 * MiB, list: 100 };
// This lab's download proxy buffers a file to hash it, so it refuses anything larger than this. Production code streams.
export const proxyLimit = 20 * MiB;
export const previewLimit = 64_000;

const components = (path: string) => path.split('/').slice(1);
// An absolute path inside /workspace/outputs, with no empty, . or .. components, naming a file (not the directory).
export function isPublishable(path: string): boolean {
  if (!path.startsWith(`${outputsDir}/`) || path.endsWith('/')) return false;
  return components(path).every((part) => part !== '' && part !== '.' && part !== '..');
}

// ---- The tasks: the same dataset and instructions, only the paths and the number of turns change ----

export type Task = 'report' | 'outside' | 'revise' | 'cancel';
export const instructions = 'You are a careful data assistant. Work only from files in the environment, and read them with commands. Never invent figures.';
const reportLines = (dir: string, csvPath: string) => [
  `Read ${csvPath} and ${briefPath} with commands, and follow the brief.`,
  `Create ${dir}/enrollment-report.md: a Markdown report with a title, a table of minutes per lab, and these four lines, each on its own line:`,
  'rows_used: <number>', 'total_minutes: <number>', 'completed: <number>', 'top_lab: <lab>',
  `Create ${dir}/summary.json with the keys rows_used, total_minutes, completed and top_lab.`,
  `Create ${dir}/tables/minutes-by-lab.csv with the header lab,minutes and one row per lab.`,
  `Write your working notes to ${notesPath}.`,
  'Reply with every path you wrote and its size in bytes from wc -c.',
];
export const revisePrompt = `Revise ${reportPath}: add the line "revision: 2" as its first line and keep everything else. Do not touch any other file. Reply with the new size in bytes.`;
export const cancelPrompt = `Run exactly one command: printf "draft\\n" > ${draftPath} && sleep 120. Then reply done.`;
// The server cancels a cancel-task turn this long after its first command starts.
export const cancelAfterMs = 8_000;

export const taskInfo: Record<Task, { label: string; short: string; note: string; turns: number }> = {
  report: { label: 'Write to /workspace/outputs', short: 'outputs', note: 'Report, summary and table under /workspace/outputs; notes in /workspace/scratch.', turns: 1 },
  outside: { label: 'Write somewhere else', short: 'reports', note: 'The same files under /workspace/reports: written, never published.', turns: 1 },
  revise: { label: 'Write, then revise', short: '2 turns', note: 'Turn 2 rewrites the report. Which artifact is the new one?', turns: 2 },
  cancel: { label: 'Cancel mid-turn', short: 'cancel', note: `A file lands in /workspace/outputs; the server cancels the turn ${cancelAfterMs / 1000} s after the command starts.`, turns: 1 },
};
export function promptsFor(task: Task, dataset: Dataset): string[] {
  if (task === 'cancel') return [cancelPrompt];
  const first = reportLines(task === 'outside' ? outsideDir : outputsDir, dataset.csvPath).join('\n');
  return task === 'revise' ? [first, revisePrompt] : [first];
}
// Every task stages the Lab 27 dataset and runs offline: the task needs files, not the internet.
export const buildEnvironment = (dataset: Dataset) => ({ type: 'openai_hosted' as const, network: { access: 'disabled' as const }, files: inlineFiles(dataset) });

// ---- Artifacts and downloads, as the API and this app's server return them ----

export type ArtifactRef = { id: string; path: string; sizeBytes: number | null; turnId: string; environmentId: string | null; createdAt: number | null };
export type Download = { artifactId: string; status: number; contentType: string | null; bytes: number | null; sha256: string | null; text: string | null; error: string | null };
export type TurnRef = { id: string; status: TurnStatus; publishMs: number | null };
export type ErrorKind = 'account' | 'environment' | 'api' | null;

const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const stringOrNull = (value: unknown) => (typeof value === 'string' ? value : null);
export function parseArtifact(raw: unknown): ArtifactRef {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(value.id ?? ''), path: String(value.path ?? ''), sizeBytes: numberOrNull(value.size_bytes ?? value.sizeBytes),
    turnId: String(value.turn_id ?? value.turnId ?? ''), environmentId: stringOrNull(value.environment_id ?? value.environmentId), createdAt: numberOrNull(value.created_at ?? value.createdAt),
  };
}
export function parseDownload(raw: unknown): Download {
  const value = (raw ?? {}) as Record<string, unknown>;
  const sha = stringOrNull(value.sha256);
  return {
    artifactId: String(value.artifactId ?? ''), status: numberOrNull(value.status) ?? 0, contentType: stringOrNull(value.contentType), bytes: numberOrNull(value.bytes),
    sha256: sha && /^[0-9a-f]{64}$/.test(sha) ? sha : null, text: stringOrNull(value.text), error: stringOrNull(value.error),
  };
}

// ---- Identify: the docs match turn_id and path. A path alone can name an older, immutable copy ----

export const forTurn = (artifacts: ArtifactRef[], turnId: string) => artifacts.filter((item) => item.turnId === turnId);
export const pick = (artifacts: ArtifactRef[], turnId: string, path: string) => artifacts.find((item) => item.turnId === turnId && item.path === path) ?? null;
// The shortcut that goes wrong: the first artifact with this path, in whatever order the list came back.
export const firstByPath = (artifacts: ArtifactRef[], path: string) => artifacts.find((item) => item.path === path) ?? null;
// The newest copy of each path: later created_at wins; within one second, the later turn in the list wins.
export function latestByPath(artifacts: ArtifactRef[]): Map<string, ArtifactRef> {
  const latest = new Map<string, ArtifactRef>();
  for (const item of artifacts) {
    const seen = latest.get(item.path);
    if (!seen || (item.createdAt ?? 0) >= (seen.createdAt ?? 0)) latest.set(item.path, item);
  }
  return latest;
}

// ---- Download: the API sends application/octet-stream, so the app chooses the type, the name and the disposition ----

const types: Record<string, string> = { md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', zip: 'application/zip' };
// Agent-written HTML, SVG, XML or script served from this origin could run as this app. Those are only ever bytes.
const active = new Set(['html', 'htm', 'svg', 'xml', 'xhtml', 'js', 'mjs']);
export const extensionOf = (path: string) => { const name = basenameOf(path); const dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''; };
export const basenameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
export function mimeFor(path: string): string {
  const extension = extensionOf(path);
  return active.has(extension) ? 'application/octet-stream' : types[extension] ?? 'application/octet-stream';
}
export const isText = (path: string) => /^(text\/|application\/json)/.test(mimeFor(path));
export function safeFilename(path: string): string {
  const name = basenameOf(path).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._]+/, '').slice(0, 100);
  return name || 'artifact';
}
export function downloadHeaders(path: string, bytes: number): Record<string, string> {
  const name = safeFilename(path);
  return {
    'Content-Type': mimeFor(path), 'Content-Length': String(bytes),
    'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
  };
}
export const artifactIdPattern = /^artifact_[A-Za-z0-9]{8,80}$/;
export const sessionIdPattern = /^sess_[A-Za-z0-9]{8,80}$/;
// Before the bytes: is this a download the proxy should make? The metadata's size decides, not the response.
export function checkDownload(artifact: ArtifactRef): { ok: boolean; status: number; reason: string } {
  if (!artifactIdPattern.test(artifact.id)) return { ok: false, status: 400, reason: 'Not an artifact ID.' };
  if (artifact.sizeBytes === null) return { ok: false, status: 502, reason: 'The API gave no size for this artifact.' };
  if (artifact.sizeBytes > proxyLimit) return { ok: false, status: 413, reason: `${formatBytes(artifact.sizeBytes)} is over this lab’s ${formatBytes(proxyLimit)} proxy limit. Stream it instead of buffering it.` };
  return { ok: true, status: 200, reason: `${formatBytes(artifact.sizeBytes)}, ${mimeFor(artifact.path)}, saved as ${safeFilename(artifact.path)}.` };
}
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} bytes`;
  return bytes < MiB ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / MiB).toFixed(1)} MiB`;
}

// ---- Will these outputs publish? The planner the page offers before any run ----

export type PlannedFile = { path: string; bytes: number };
export function parsePlan(text: string): { files: PlannedFile[]; errors: string[] } {
  const files: PlannedFile[] = []; const errors: string[] = [];
  text.split('\n').map((line) => line.trim()).filter(Boolean).forEach((line, index) => {
    const match = /^(\S+)\s+(\d+(?:\.\d+)?)\s*(b|bytes|kib|kb|mib|mb)?$/i.exec(line);
    if (!match) { errors.push(`Line ${index + 1}: write a path, then a size such as 294 or 12 MiB.`); return; }
    const unit = (match[3] ?? 'b').toLowerCase();
    files.push({ path: match[1], bytes: Math.round(Number(match[2]) * (unit.startsWith('m') ? MiB : unit.startsWith('k') ? 1024 : 1)) });
  });
  return { files, errors };
}
export function checkPlan(files: PlannedFile[]): Finding[] {
  const findings: Finding[] = [];
  let total = 0; let publishing = 0;
  for (const file of files) {
    if (!file.path.startsWith('/')) findings.push({ level: 'error', text: `${file.path}: not absolute. The sandbox works in /workspace; name the full path.` });
    else if (!isPublishable(file.path)) findings.push({ level: 'warn', text: `${file.path}: stays in the sandbox. Only files under ${outputsDir}/ are published (live: ${notesPath} was never an artifact).` });
    else if (file.bytes > limits.fileBytes) findings.push({ level: 'error', text: `${file.path}: ${formatBytes(file.bytes)} is over the 200 MiB per-file limit.` });
    else { total += file.bytes; publishing += 1; findings.push({ level: 'ok', text: `${file.path}: published as an immutable artifact when the turn completes (${formatBytes(file.bytes)}).` }); }
  }
  if (total > limits.turnBytes) findings.push({ level: 'error', text: `The published files total ${formatBytes(total)}: over the 500 MiB per-turn limit.` });
  if (!publishing) findings.push({ level: 'warn', text: 'Nothing here would be published: the user could download nothing.' });
  return findings;
}

// ---- Verify what was downloaded: bytes, hash, and the figures against this app's own analysis ----

export type Figure = { field: string; got: string | null; want: string; ok: boolean };
export function reportFigures(text: string, analysis: Analysis): Figure[] {
  const report = parseReport(text);
  const row = (field: string, got: number | string | null, want: number | string): Figure => ({ field, got: got === null ? null : String(got), want: String(want), ok: got === want });
  return [row('rows_used', report.rowsUsed, analysis.rowsUsed), row('total_minutes', report.totalMinutes, analysis.totalMinutes), row('completed', report.completed, analysis.completed), row('top_lab', report.topLab, analysis.topLab)];
}
export function summaryFigures(text: string, analysis: Analysis): Figure[] | null {
  let value: Record<string, unknown>;
  try { const parsed: unknown = JSON.parse(text); if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null; value = parsed as Record<string, unknown>; } catch { return null; }
  const row = (field: string, want: number | string): Figure => ({ field, got: value[field] === undefined ? null : String(value[field]), want: String(want), ok: value[field] === want });
  return [row('rows_used', analysis.rowsUsed), row('total_minutes', analysis.totalMinutes), row('completed', analysis.completed), row('top_lab', analysis.topLab)];
}
// lab,minutes with one row per lab, refunded rows excluded.
export function tableFigures(text: string, csv: string): { ok: boolean; detail: string } {
  const totals = new Map<string, number>();
  for (const line of csv.trim().split('\n').slice(1)) { const [, , lab, minutes, status] = line.split(','); if (status !== 'refunded') totals.set(lab, (totals.get(lab) ?? 0) + Number(minutes)); }
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  if (lines[0]?.replace(/"/g, '').trim() !== 'lab,minutes') return { ok: false, detail: `The header is “${lines[0] ?? ''}”, not lab,minutes.` };
  const got = new Map(lines.slice(1).map((line) => { const [lab, minutes] = line.replace(/"/g, '').split(','); return [lab?.trim(), Number(minutes)] as [string, number]; }));
  const wrong = [...totals].filter(([lab, minutes]) => got.get(lab) !== minutes).map(([lab, minutes]) => `${lab} ${got.get(lab) ?? 'missing'} (want ${minutes})`);
  const extra = [...got.keys()].filter((lab) => !totals.has(lab));
  return wrong.length || extra.length ? { ok: false, detail: [...wrong, ...extra.map((lab) => `${lab} is not a lab in the data`)].join('; ') } : { ok: true, detail: `${totals.size} labs, every total matches.` };
}
// A download is verified when its byte count equals the artifact's size_bytes and, for text, its hash is the text's hash.
export function verifyDownload(artifact: ArtifactRef, download: Download | null): { level: 'ok' | 'fail' | 'skip'; detail: string } {
  if (!download) return { level: 'skip', detail: 'Not downloaded.' };
  if (download.error || download.status !== 200) return { level: 'fail', detail: `HTTP ${download.status}: ${download.error ?? 'no bytes'}.` };
  if (download.bytes !== artifact.sizeBytes) return { level: 'fail', detail: `${download.bytes ?? '?'} bytes downloaded; size_bytes says ${artifact.sizeBytes ?? '?'}.` };
  if (download.text !== null && download.sha256 && sha256Hex(download.text) !== download.sha256) return { level: 'fail', detail: 'The text does not hash to the recorded SHA-256.' };
  return { level: 'ok', detail: `${download.bytes} bytes = size_bytes${download.sha256 ? ` · sha256 ${download.sha256.slice(0, 12)}…` : ''}.` };
}

// ---- Links in the reply: a sandbox path is not a URL the browser can open ----

export type LinkTarget = { kind: 'artifact'; artifact: ArtifactRef } | { kind: 'sandbox'; path: string } | { kind: 'external'; href: string };
export function resolveLink(href: string, artifacts: ArtifactRef[], turnId: string | null): LinkTarget {
  const path = href.replace(/^file:\/\//, '').replace(/[?#].*$/, '');
  if (!path.startsWith('/workspace/')) return { kind: 'external', href };
  const found = (turnId ? pick(artifacts, turnId, path) : null) ?? latestByPath(artifacts).get(path) ?? null;
  return found ? { kind: 'artifact', artifact: found } : { kind: 'sandbox', path };
}
export const mentionedPaths = (answer: string) => [...new Set(answer.match(/\/workspace\/[A-Za-z0-9._/-]+[A-Za-z0-9_-]/g) ?? [])];

// ---- A run and its evidence ----

export type ArtifactRun = {
  task: Task; prompts: string[]; model: string; dataset: { id: string; csvPath: string; csv: string };
  sessionId: string | null; environmentId: string | null; turns: TurnRef[];
  artifacts: ArtifactRef[]; listed: FileRef[] | null; downloads: Download[];
  readyMs: number | null; durationMs: number | null; commands: CommandRun[]; commentary: string[]; answer: string; answers: string[];
  error: string | null; errorKind: ErrorKind; usage: Usage | null; deleted: Array<{ artifactId: string; after: string; liveBytes: number | null }>;
};
const tasks: Task[] = ['report', 'outside', 'revise', 'cancel'];
const turnStatuses: TurnStatus[] = ['completed', 'failed', 'cancelled', 'waiting', 'unknown'];
// The browser checks the server's summary before trusting it.
export function parseArtifactRun(raw: unknown): ArtifactRun {
  const value = (raw ?? {}) as Record<string, unknown>;
  const dataset = (value.dataset ?? {}) as Record<string, unknown>;
  const list = (items: unknown) => (Array.isArray(items) ? items : []);
  return {
    task: tasks.includes(value.task as Task) ? value.task as Task : 'report', prompts: list(value.prompts).map(String), model: String(value.model ?? ''),
    dataset: { id: String(dataset.id ?? ''), csvPath: String(dataset.csvPath ?? ''), csv: String(dataset.csv ?? '') },
    sessionId: stringOrNull(value.sessionId), environmentId: stringOrNull(value.environmentId),
    turns: list(value.turns).map((turn) => { const item = (turn ?? {}) as Record<string, unknown>; return { id: String(item.id ?? ''), status: turnStatuses.includes(item.status as TurnStatus) ? item.status as TurnStatus : 'unknown', publishMs: numberOrNull(item.publishMs) }; }),
    artifacts: list(value.artifacts).map(parseArtifact), listed: Array.isArray(value.listed) ? value.listed.map(parseFileRef) : null, downloads: list(value.downloads).map(parseDownload),
    readyMs: numberOrNull(value.readyMs), durationMs: numberOrNull(value.durationMs),
    commands: list(value.commands).map(parseCommand), commentary: list(value.commentary).map(String), answer: String(value.answer ?? ''), answers: list(value.answers).map(String),
    error: stringOrNull(value.error), errorKind: (['account', 'environment', 'api'] as const).find((kind) => kind === value.errorKind) ?? null, usage: parseUsage(value.usage),
    deleted: list(value.deleted).map((item) => { const entry = (item ?? {}) as Record<string, unknown>; return { artifactId: String(entry.artifactId ?? ''), after: String(entry.after ?? ''), liveBytes: numberOrNull(entry.liveBytes) }; }),
  };
}

export const lastTurn = (run: ArtifactRun) => run.turns.at(-1) ?? null;
export const downloadOf = (run: ArtifactRun, artifactId: string) => run.downloads.find((item) => item.artifactId === artifactId) ?? null;
export const analysisOf = (run: ArtifactRun) => analyze(run.dataset.csv).analysis;
// Files the sandbox holds that no turn ever published (the staged inputs aside). They are gone with the sandbox.
export function sandboxOnly(run: ArtifactRun): FileRef[] {
  if (!run.listed) return [];
  const published = new Set(run.artifacts.map((item) => item.path));
  return run.listed.filter((file) => !file.path.startsWith('/workspace/data/') && !published.has(file.path));
}

// ---- Judge a run from its evidence ----

export type Outcome = 'delivered' | 'revised' | 'unpublished' | 'abandoned' | 'partial' | 'wrong' | 'corrupt' | 'incomplete' | 'failed';
export type CheckLevel = 'ok' | 'warn' | 'fail' | 'skip';
export type Check = { id: string; label: string; level: CheckLevel; detail: string };
export type Verdict = { outcome: Outcome; title: string; text: string; checks: Check[] };
export const outcomeTone: Record<Outcome, string> = { delivered: 'can', revised: 'can', unpublished: 'gap', abandoned: 'gap', partial: 'gap', incomplete: 'gap', wrong: 'breach', corrupt: 'breach', failed: 'failed' };
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const listing = (files: FileRef[]) => files.map((file) => `${file.path} (${file.sizeBytes ?? '?'} bytes)`).join(', ');

export function judgeArtifactRun(run: ArtifactRun): Verdict {
  const checks: Check[] = [];
  const turn = lastTurn(run);
  if (run.error && (!turn || turn.status !== 'cancelled')) {
    checks.push({ id: 'turn', label: 'Turn outcome', level: 'fail', detail: run.error });
    if (run.errorKind === 'account') return { outcome: 'failed', title: 'Blocked: usage or billing limit', text: 'The API refused the turn. This is an account limit, not an artifact problem.', checks };
    return { outcome: 'failed', title: 'Failed', text: run.error, checks };
  }
  if (!turn) return { outcome: 'incomplete', title: 'No turn', text: 'The run ended before a turn started.', checks: [{ id: 'turn', label: 'Turn outcome', level: 'fail', detail: 'No turn was recorded.' }] };
  const mine = forTurn(run.artifacts, turn.id);
  const onlySandbox = sandboxOnly(run);
  const publishedIn = turn.publishMs === null ? '' : ` Listed ${seconds(turn.publishMs)} after the turn ended.`;

  // 1. Only a completed turn publishes. Live: a cancelled turn left draft.md in the sandbox and published nothing.
  if (turn.status === 'cancelled') {
    const draft = run.listed?.find((file) => file.path === draftPath) ?? null;
    checks.push({ id: 'turn', label: 'Turn outcome', level: run.task === 'cancel' ? 'ok' : 'fail', detail: run.task === 'cancel' ? 'Cancelled on purpose, while the command was still running.' : 'The turn was cancelled.' });
    checks.push({ id: 'published', label: 'Artifacts from this turn', level: mine.length ? 'fail' : 'ok', detail: mine.length ? `${mine.length} published: a cancelled turn should publish nothing.` : 'None: outputs of a cancelled turn are abandoned, not published.' });
    checks.push({ id: 'sandbox', label: 'Still in the sandbox', level: draft ? 'ok' : run.listed ? 'warn' : 'skip', detail: draft ? `${draft.path} (${draft.sizeBytes ?? '?'} bytes) is in environments.files.list, under ${outputsDir}, and is still not an artifact.` : run.listed ? `${draftPath} was not listed: the command may not have written it before the cancel.` : 'The environment was not listed.' });
    return { outcome: mine.length ? 'wrong' : 'abandoned', title: mine.length ? 'Published from a cancelled turn' : 'Cancelled: nothing published', text: mine.length ? 'Artifacts appeared for a turn that did not complete.' : 'The file is in the right directory, but publishing happens only when a turn completes. Retry the turn; do not look for the file in the artifacts.', checks };
  }
  if (turn.status !== 'completed') {
    checks.push({ id: 'turn', label: 'Turn outcome', level: 'fail', detail: `The turn ended ${turn.status}.` });
    return { outcome: turn.status === 'failed' ? 'failed' : 'incomplete', title: turn.status === 'failed' ? 'Turn failed' : 'No outcome', text: `The final turn is ${turn.status}: only completed turns publish outputs.`, checks };
  }
  checks.push({ id: 'turn', label: 'Turn outcome', level: 'ok', detail: `completed${run.turns.length > 1 ? ` (turn ${run.turns.length} of ${run.turns.length})` : ''}.` });

  // 2. What was published, and what stayed behind.
  if (run.task === 'outside') {
    const written = run.listed?.filter((file) => file.path.startsWith(`${outsideDir}/`)) ?? [];
    checks.push({ id: 'published', label: 'Artifacts from this turn', level: mine.length ? 'warn' : 'ok', detail: mine.length ? `${mine.length} published, though the task wrote under ${outsideDir}.` : `None.${publishedIn}` });
    checks.push({ id: 'sandbox', label: 'Written, but only in the sandbox', level: written.length ? 'ok' : run.listed ? 'warn' : 'skip', detail: written.length ? `${listing(written)}. They exist, and no artifact covers them: outside ${outputsDir}, a file is never published.` : run.listed ? `Nothing under ${outsideDir} was listed.` : 'The environment was not listed.' });
    return { outcome: 'unpublished', title: 'Written, never published', text: `The agent did the work, and the user can download none of it. The files live only as long as the sandbox. Save outputs under ${outputsDir}.`, checks };
  }
  const report = pick(mine, turn.id, reportPath);
  const summary = run.task === 'revise' ? null : pick(mine, turn.id, summaryPath);
  const table = run.task === 'revise' ? null : pick(mine, turn.id, tablePath);
  const missing = [reportPath, ...(run.task === 'revise' ? [] : [summaryPath])].filter((path) => !pick(mine, turn.id, path));
  checks.push({ id: 'published', label: 'Artifacts from this turn', level: missing.length ? (mine.length ? 'warn' : 'fail') : 'ok', detail: `${mine.length} with turn_id ${turn.id.slice(0, 10)}…: ${mine.map((item) => `${item.path} (${item.sizeBytes ?? '?'} bytes)`).join(', ') || 'none'}.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}${publishedIn}` });
  if (run.task === 'report') checks.push({ id: 'nested', label: 'A subdirectory of outputs', level: table ? 'ok' : 'warn', detail: table ? `${tablePath} was published with its directory in the path.` : `${tablePath} was not published.` });
  const notes = run.listed?.find((file) => file.path === notesPath) ?? null;
  if (run.task === 'report') checks.push({ id: 'sandbox', label: 'Scratch stayed in the sandbox', level: notes ? 'ok' : run.listed ? 'warn' : 'skip', detail: notes ? `${notesPath} (${notes.sizeBytes ?? '?'} bytes) is listed and has no artifact.${onlySandbox.length > 1 ? ` Also sandbox-only: ${listing(onlySandbox.filter((file) => file.path !== notesPath))}.` : ''}` : run.listed ? `${notesPath} was not listed: the agent skipped the notes.` : 'The environment was not listed.' });

  // 3. Revise: a new artifact for the new turn; the old one is unchanged.
  if (run.task === 'revise') {
    const first = run.turns[0] ? pick(run.artifacts, run.turns[0].id, reportPath) : null;
    const firstSummary = run.turns[0] ? pick(run.artifacts, run.turns[0].id, summaryPath) : null;
    const reposted = pick(mine, turn.id, summaryPath);
    checks.push({ id: 'immutable', label: 'The first version is unchanged', level: first && report && first.id !== report.id ? 'ok' : 'fail', detail: first && report ? `Turn 1: ${first.id.slice(0, 16)}… (${first.sizeBytes ?? '?'} bytes). Turn 2: ${report.id.slice(0, 16)}… (${report.sizeBytes ?? '?'} bytes). Same path, two artifacts.` : 'The report is missing from one of the turns.' });
    checks.push({ id: 'unchanged', label: 'Untouched files', level: 'ok', detail: reposted ? `summary.json was published again in turn 2 (${reposted.id.slice(0, 16)}…).` : firstSummary ? 'summary.json was not published again: turn 2 did not change it. Its only artifact is from turn 1.' : 'summary.json was never published.' });
    const byPath = firstByPath([...run.artifacts].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)), reportPath);
    if (byPath && report && byPath.id !== report.id) checks.push({ id: 'identify', label: 'Identified by turn and path', level: 'ok', detail: `Matching by path alone, in ascending order, finds ${byPath.id.slice(0, 16)}…, the turn-1 copy. Matching turn_id and path finds the revision.` });
  }

  // 4. The bytes: every artifact of this turn downloaded, and each download equals its size_bytes.
  const verified = mine.map((item) => ({ item, result: verifyDownload(item, downloadOf(run, item.id)) }));
  const badBytes = verified.filter((entry) => entry.result.level === 'fail');
  const notDownloaded = verified.filter((entry) => entry.result.level === 'skip');
  checks.push({ id: 'download', label: 'Downloaded bytes', level: badBytes.length ? 'fail' : notDownloaded.length || !mine.length ? 'warn' : 'ok', detail: badBytes.length ? badBytes.map((entry) => `${basenameOf(entry.item.path)}: ${entry.result.detail}`).join(' ') : notDownloaded.length ? `${notDownloaded.length} not downloaded.` : mine.length ? `${mine.length} downloaded with sessions.artifacts.content; each byte count equals size_bytes.` : 'Nothing to download.' });

  // 5. The content: the figures in the files against this app's own analysis of the same CSV.
  const analysis = analysisOf(run);
  const reportText = report ? downloadOf(run, report.id)?.text ?? null : null;
  const wrongFigures = reportText !== null && analysis ? reportFigures(reportText, analysis).filter((figure) => !figure.ok) : [];
  checks.push({ id: 'figures', label: 'Report figures', level: reportText === null || !analysis ? 'skip' : wrongFigures.length ? 'fail' : 'ok', detail: reportText === null ? 'No report text to check.' : !analysis ? 'The dataset could not be analysed.' : wrongFigures.length ? wrongFigures.map((figure) => `${figure.field} ${figure.got ?? 'missing'} (want ${figure.want})`).join('; ') : 'rows_used, total_minutes, completed and top_lab match this app’s analysis.' });
  if (summary) {
    const text = downloadOf(run, summary.id)?.text ?? null;
    const figures = text !== null && analysis ? summaryFigures(text, analysis) : null;
    checks.push({ id: 'summary', label: 'summary.json', level: text === null ? 'skip' : !figures ? 'fail' : figures.every((figure) => figure.ok) ? 'ok' : 'fail', detail: text === null ? 'Not downloaded.' : !figures ? 'Not a JSON object.' : figures.every((figure) => figure.ok) ? 'Valid JSON; every value matches.' : figures.filter((figure) => !figure.ok).map((figure) => `${figure.field} ${figure.got ?? 'missing'} (want ${figure.want})`).join('; ') });
  }
  if (table) {
    const text = downloadOf(run, table.id)?.text ?? null;
    const result = text === null ? null : tableFigures(text, run.dataset.csv);
    checks.push({ id: 'table', label: 'minutes-by-lab.csv', level: result ? (result.ok ? 'ok' : 'fail') : 'skip', detail: result?.detail ?? 'Not downloaded.' });
  }

  // 6. The reply: the paths it names, against what was published.
  const named = mentionedPaths(run.answer).filter((path) => !path.startsWith('/workspace/data/'));
  const unpublishedNamed = named.filter((path) => !mine.some((item) => item.path === path));
  checks.push({ id: 'reply', label: 'Paths in the reply', level: unpublishedNamed.some((path) => isPublishable(path)) ? 'warn' : 'ok', detail: !named.length ? 'The reply names no sandbox path.' : `${named.length} named. ${unpublishedNamed.length ? `Not downloadable: ${unpublishedNamed.join(', ')}. ` : ''}A sandbox path is not a URL: this page turns published ones into download buttons.` });

  if (badBytes.length) return { outcome: 'corrupt', title: 'Download does not match', text: 'A downloaded file is not the size the artifact reports. Do not hand it to the user.', checks };
  if (wrongFigures.length || checks.some((check) => (check.id === 'summary' || check.id === 'table') && check.level === 'fail')) return { outcome: 'wrong', title: 'Published, but wrong', text: 'The file downloads, and its figures do not match the data. Publishing proves where a file is, not that it is right.', checks };
  if (!report) return { outcome: mine.length ? 'partial' : 'incomplete', title: mine.length ? 'Report missing' : 'Nothing published', text: mine.length ? `The turn published ${mine.length} file(s), but not ${reportPath}.` : `The turn completed and published nothing. Check the agent wrote under ${outputsDir}.`, checks };
  if (missing.length || notDownloaded.length) return { outcome: 'partial', title: 'Partly delivered', text: missing.length ? `Missing: ${missing.join(', ')}.` : 'Some artifacts were not downloaded.', checks };
  if (run.task === 'revise') return { outcome: 'revised', title: 'Revision delivered', text: 'Two immutable reports now share one path. The download is the one whose turn_id is the revising turn.', checks };
  return { outcome: 'delivered', title: 'Delivered and verified', text: 'Every output was published when the turn completed, downloaded, and checked against the data. The scratch file stayed in the sandbox.', checks };
}

// ---- A manifest for the user: what was delivered, from which turn, and its hash ----

export function manifest(run: ArtifactRun): string {
  const turn = lastTurn(run);
  const mine = turn ? forTurn(run.artifacts, turn.id) : [];
  return JSON.stringify({
    session_id: run.sessionId, turn_id: turn?.id ?? null, source: run.dataset.csvPath,
    artifacts: mine.map((item) => ({ id: item.id, path: item.path, size_bytes: item.sizeBytes, sha256: downloadOf(run, item.id)?.sha256 ?? null, content_type: mimeFor(item.path) })),
  }, null, 2);
}

