// Lab 27: provide input files. Shared by the browser and the server: a seeded sample dataset (a CSV and a text brief),
// the analysis the report must match, base64 for inline files, a files checker that repeats what the API refused live,
// the report parser, and the judge that reads a run from its evidence. No network, no API key.
import type { Finding } from './lab21Search.ts';
import type { TurnStatus } from './lab16Tool.ts';
import { parseCommand, parseUsage, sha256Hex, unwrapCommand, type CommandRun, type Network, type Usage } from './lab26Environment.ts';

export type Mode = 'staged' | 'copied' | 'missing';
export const modeInfo: Record<Mode, { label: string; short: string; note: string }> = {
  staged: { label: 'Staged at creation', short: 'environment.files', note: 'The files go in sessions.create; they are there before the agent starts.' },
  copied: { label: 'Copied into the live sandbox', short: 'environments.files.create', note: 'After environment.ready, copy each file in, then send the task.' },
  missing: { label: 'Control: no files', short: 'no files', note: 'The same task in the same sandbox, with nothing staged.' },
};

// The same instructions and prompt in every run, so what was staged is the only difference.
export const instructions = 'You are a careful data assistant. Work only from files in the environment, and read them with commands. Never invent figures. Name the file every figure came from.';
export const reportPrompt = [
  'Write a short enrollment report from the files in /workspace/data. Follow the rules in brief.txt.',
  'Start with exactly these six lines:',
  'source: <absolute path of the CSV you read>',
  'source_sha256: <SHA-256 of that file>',
  'rows_used: <number>',
  'total_minutes: <number>',
  'completed: <number>',
  'top_lab: <lab>',
  'Then add two sentences of summary. Put the report in your reply, not only in a file.',
  'If the files are not there, say so and report no figures.',
].join('\n');

// ---- The sample dataset: seeded, so a test gets the same file and a live run gets a fresh one ----

export const dataDir = '/workspace/data';
export const briefPath = `${dataDir}/brief.txt`;
export const header = 'enrolled_on,learner_id,lab,minutes,status';
export const statuses = ['completed', 'in_progress', 'refunded'] as const;
export type Status = typeof statuses[number];
export const labNames = ['lab21', 'lab22', 'lab23', 'lab24', 'lab25', 'lab26', 'lab27'];
export const brief = [
  'Enrollment report brief',
  '- Exclude every row whose status is "refunded": a refund is not an enrollment.',
  '- minutes is the time a learner spent in the lab, in whole minutes.',
  '- top_lab is the lab with the most minutes after the exclusion.',
  '',
].join('\n');

export type Dataset = { id: string; csvPath: string; csv: string; notesPath: string; notes: string };
export const idPattern = /^[0-9a-f]{8}$/;
export const csvPathFor = (id: string) => `${dataDir}/enrollments-${id}.csv`;

// mulberry32: small, fast, and identical in the browser and in Node.
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
export function makeDataset(seed: number = Math.floor(Math.random() * 4_294_967_296)): Dataset {
  const random = seeded(seed);
  const id = (seed >>> 0).toString(16).padStart(8, '0');
  const rowCount = 36 + Math.floor(random() * 13);
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const roll = random();
    // Every ninth row is refunded, so the brief always changes the figures.
    const status: Status = index % 9 === 4 || roll < 0.1 ? 'refunded' : roll < 0.45 ? 'in_progress' : 'completed';
    return { day: 1 + Math.floor(random() * 27), learner: `L-${100 + Math.floor(random() * 900)}`, lab: labNames[Math.floor(random() * labNames.length)], minutes: 15 + Math.floor(random() * 106), status };
  }).sort((a, b) => a.day - b.day);
  // One clear top lab: break a tie by adding a minute to the first kept row of the first tied lab.
  const totals = new Map<string, number>();
  for (const row of rows) if (row.status !== 'refunded') totals.set(row.lab, (totals.get(row.lab) ?? 0) + row.minutes);
  const best = Math.max(...totals.values());
  const tied = [...totals].filter(([, minutes]) => minutes === best).map(([lab]) => lab);
  if (tied.length > 1) rows.find((row) => row.lab === tied[0] && row.status !== 'refunded')!.minutes += 1;
  const csv = `${header}\n${rows.map((row) => `2026-09-${String(row.day).padStart(2, '0')},${row.learner},${row.lab},${row.minutes},${row.status}`).join('\n')}\n`;
  return { id, csvPath: csvPathFor(id), csv, notesPath: briefPath, notes: brief };
}

export type Analysis = { rowsTotal: number; refunded: number; rowsUsed: number; totalMinutes: number; totalMinutesAll: number; completed: number; topLab: string; topMinutes: number };
export type Analyzed = { analysis: Analysis | null; errors: string[] };
// The figures the report must contain, computed by this app from the same bytes the sandbox receives.
export function analyze(csv: string): Analyzed {
  const errors: string[] = [];
  const lines = csv.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines[0] !== header) return { analysis: null, errors: [`The first line must be exactly: ${header}`] };
  const rows = lines.slice(1);
  if (!rows.length) return { analysis: null, errors: ['The CSV has a header and no rows.'] };
  const totals = new Map<string, number>();
  let refunded = 0; let totalMinutes = 0; let totalMinutesAll = 0; let completed = 0;
  rows.forEach((line, index) => {
    const cells = line.split(',');
    const where = `Line ${index + 2}`;
    if (cells.length !== 5) { errors.push(`${where}: expected 5 fields, found ${cells.length}.`); return; }
    const [date, learner, lab, minutesText, status] = cells;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(`${where}: enrolled_on must be YYYY-MM-DD.`);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(learner)) errors.push(`${where}: learner_id must be letters, digits, - or _.`);
    if (!/^[a-z0-9_-]{1,32}$/.test(lab)) errors.push(`${where}: lab must be lower-case letters, digits, - or _.`);
    if (!/^\d{1,5}$/.test(minutesText)) errors.push(`${where}: minutes must be a whole number.`);
    if (!statuses.includes(status as Status)) errors.push(`${where}: status must be completed, in_progress, or refunded.`);
    const minutes = Number(minutesText);
    totalMinutesAll += minutes;
    if (status === 'refunded') { refunded += 1; return; }
    totalMinutes += minutes;
    if (status === 'completed') completed += 1;
    totals.set(lab, (totals.get(lab) ?? 0) + minutes);
  });
  if (errors.length) return { analysis: null, errors: errors.slice(0, 6) };
  if (!totals.size) return { analysis: null, errors: ['Every row is refunded: there is nothing to report.'] };
  const ranked = [...totals].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return { analysis: null, errors: [`${ranked[0][0]} and ${ranked[1][0]} tie for top lab with ${ranked[0][1]} minutes: change one row.`] };
  return { analysis: { rowsTotal: rows.length, refunded, rowsUsed: rows.length - refunded, totalMinutes, totalMinutesAll, completed, topLab: ranked[0][0], topMinutes: ranked[0][1] }, errors };
}
export const csvLimit = 64_000;
// The server accepts an edited CSV only if it is the same shape: a known path and figures this app can compute.
export function checkDataset(raw: unknown): Dataset | null {
  const value = raw as Partial<Dataset> | null;
  if (typeof value?.id !== 'string' || !idPattern.test(value.id) || typeof value.csv !== 'string' || value.csv.length > csvLimit) return null;
  if (!analyze(value.csv).analysis) return null;
  return { id: value.id, csvPath: csvPathFor(value.id), csv: value.csv, notesPath: briefPath, notes: brief };
}

// ---- Inline files: standard base64, as the API requires ----

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const byteLength = (text: string) => new TextEncoder().encode(text).length;
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + (i + 1 < bytes.length ? alphabet[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? alphabet[n & 63] : '=');
  }
  return out;
}
export function fromBase64(data: string): string | null {
  if (!standardBase64.test(data)) return null;
  const bytes: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const n = [0, 1, 2, 3].reduce((acc, k) => (acc << 6) | Math.max(alphabet.indexOf(data[i + k]), 0), 0);
    bytes.push((n >> 16) & 255);
    if (data[i + 2] !== '=') bytes.push((n >> 8) & 255);
    if (data[i + 3] !== '=') bytes.push(n & 255);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
// Live, 2026-09-28: "environment.files inline data must be a standard-base64 string" for raw text and for base64url.
export const standardBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
export const decodedSize = (data: string) => (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);

// ---- The request: build it, and check an edited one the way the API did live ----

export type InlineFile = { type: 'inline'; path: string; data: string };
export type FileParam = InlineFile | { type: 'file_id'; path: string; file_id: string };
export type EnvironmentParam = { type: 'openai_hosted'; network: { access: 'disabled' }; files?: FileParam[] };
export const inlineFiles = (dataset: Dataset): InlineFile[] => [
  { type: 'inline', path: dataset.csvPath, data: toBase64(dataset.csv) },
  { type: 'inline', path: dataset.notesPath, data: toBase64(dataset.notes) },
];
// staged: the files ride in sessions.create. copied and missing: the session starts empty.
export const buildEnvironment = (mode: Mode, dataset: Dataset): EnvironmentParam => (mode === 'staged'
  ? { type: 'openai_hosted', network: { access: 'disabled' }, files: inlineFiles(dataset) }
  : { type: 'openai_hosted', network: { access: 'disabled' } });

export const limits = { files: 50, dataChars: 6_990_508 };
// Live 400 messages, 2026-09-28.
const outsideMessage = 'must be an absolute POSIX path inside /workspace';
const componentMessage = 'cannot contain empty, . or .. path components';
export function checkPath(path: unknown): { level: 'error' | 'warn'; text: string } | null {
  if (typeof path !== 'string' || !path) return { level: 'error', text: 'path must be a non-empty string.' };
  if (!path.startsWith('/workspace/') && path !== '/workspace') return { level: 'error', text: outsideMessage };
  if (path.split('/').slice(1).some((part) => part === '' || part === '.' || part === '..')) return { level: 'error', text: componentMessage };
  if (path === '/workspace') return { level: 'error', text: 'path names the workspace itself, not a file inside it.' };
  if (/\s/.test(path)) return { level: 'warn', text: 'Spaces were accepted live, but every command the agent writes must quote this path.' };
  return null;
}

const hostedKeys = ['type', 'capability_directories', 'env', 'environment_template_id', 'files', 'network', 'packages', 'plugins', 'setup_commands', 'skills'];
const size = (bytes: number) => (bytes < 1_024 ? `${bytes} bytes` : bytes < 1_048_576 ? `${(bytes / 1_024).toFixed(1)} KiB` : `${(bytes / 1_048_576).toFixed(2)} MiB`);
export function checkRequest(raw: unknown): { environment: unknown; findings: Finding[] } {
  const findings: Finding[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { environment: null, findings: [{ level: 'error', text: 'environment must be a JSON object.' }] };
  const value = raw as Record<string, unknown>;
  // Live: 400 Unknown parameter: 'environment.files'. A none environment has nowhere to put a file.
  if (value.type === 'none') return { environment: null, findings: [{ level: 'error', text: `${'files' in value ? "Unknown parameter: 'environment.files'. " : ''}A none environment has no sandbox, so it cannot hold a file. Use openai_hosted.` }] };
  if (value.type !== 'openai_hosted') return { environment: null, findings: [{ level: 'error', text: value.type === 'self_hosted' ? 'self_hosted reads files from your own workspace_directory: Lab 31.' : `Invalid value: '${String(value.type ?? '')}'. Supported values are: 'none', 'openai_hosted', and 'self_hosted'.` }] };
  for (const key of Object.keys(value).filter((item) => !hostedKeys.includes(item))) findings.push({ level: 'error', text: `Unknown parameter: 'environment.${key}'.` });
  const network = value.network as { access?: unknown } | undefined;
  if (!network) findings.push({ level: 'warn', text: 'No network policy: beta requests default to enabled. Reading a staged file needs none: set access disabled.' });
  else if (network.access === 'restricted' && !(network as { allowed_domains?: unknown[] }).allowed_domains?.length) findings.push({ level: 'error', text: 'environment.network.access=restricted requires allowed_domains or blocked_domains (live 400).' });
  else if (network.access !== 'disabled') findings.push({ level: 'warn', text: `network ${String(network.access)}: the files are already inside the sandbox, so nothing here needs the internet.` });
  const files = value.files;
  if (files === undefined || files === null || (Array.isArray(files) && !files.length)) {
    findings.push({ level: 'warn', text: 'No files: /workspace/data will not exist. That is the control run; the agent should say so and report no figures.' });
  } else if (!Array.isArray(files)) {
    findings.push({ level: 'error', text: 'environment.files must be an array.' });
  } else {
    // Live: 400 Invalid 'environment.files': array too long. Expected an array with maximum length 50.
    if (files.length > limits.files) findings.push({ level: 'error', text: `Invalid 'environment.files': array too long. Expected an array with maximum length ${limits.files}, but got ${files.length}.` });
    const seen = new Set<string>();
    files.slice(0, limits.files + 1).forEach((file, index) => {
      const where = `environment.files[${index}]`;
      if (typeof file !== 'object' || file === null || Array.isArray(file)) { findings.push({ level: 'error', text: `${where} must be an object.` }); return; }
      const entry = file as Record<string, unknown>;
      const pathIssue = checkPath(entry.path);
      if (pathIssue) findings.push({ level: pathIssue.level, text: `${where}.path ${pathIssue.text.replace(/^path /, '')}` });
      if (typeof entry.path === 'string') {
        // Live: 400 environment.files[1].path duplicates an earlier file path.
        if (seen.has(entry.path)) findings.push({ level: 'error', text: `${where}.path duplicates an earlier file path.` });
        seen.add(entry.path);
      }
      for (const key of Object.keys(entry).filter((item) => !['type', 'path', 'data', 'file_id'].includes(item))) findings.push({ level: 'warn', text: `${where}.${key} is not a field of a hosted file.` });
      if (entry.type === 'inline') {
        if (typeof entry.data !== 'string') { findings.push({ level: 'error', text: `${where}.data must be a base64 string.` }); return; }
        if (entry.data.length > limits.dataChars) { findings.push({ level: 'error', text: `Invalid '${where}.data': string too long. Expected a maximum length of ${limits.dataChars.toLocaleString('en')} (about 5 MiB decoded), got ${entry.data.length.toLocaleString('en')}.` }); return; }
        if (!standardBase64.test(entry.data)) { findings.push({ level: 'error', text: 'environment.files inline data must be a standard-base64 string (A–Z, a–z, 0–9, + and /, padded with =).' }); return; }
        if (!pathIssue || pathIssue.level === 'warn') findings.push({ level: 'ok', text: `${entry.path}: ${size(decodedSize(entry.data))}, in the sandbox before the agent starts.` });
      } else if (entry.type === 'file_id') {
        if (typeof entry.file_id !== 'string' || !entry.file_id) findings.push({ level: 'error', text: `${where}.file_id must be the ID of an uploaded file.` });
        // Live: files.create returned file-… IDs, and the API refused both: user_data "legacy file- IDs are unsupported"; assistants "cannot be used".
        else if (entry.file_id.startsWith('file-')) findings.push({ level: 'error', text: 'Hosted user_data attachments require a current file_ ID; legacy file- IDs are unsupported (live 400). This lab stages files inline.' });
        else findings.push({ level: 'warn', text: `${where}: file_id ${entry.file_id} must exist in this project (an unknown ID was a live 404). Not checked offline.` });
      } else {
        findings.push({ level: 'error', text: `${where}.type must be inline or file_id.` });
      }
    });
  }
  if (findings.some((item) => item.level === 'error')) return { environment: null, findings };
  findings.unshift({ level: 'ok', text: 'openai_hosted with files: the API validates every path and every byte before it creates the session.' });
  return { environment: value, findings };
}

// ---- A run and its evidence ----

export type FileRef = { path: string; sizeBytes: number | null; id: string | null; type: string };
export type DatasetRef = { id: string; csvPath: string; notesPath: string; csv: string; notes: string };
export type FileRun = {
  mode: Mode; prompt: string; dataset: DatasetRef; sessionId: string | null; environmentId: string | null; network: Network | null;
  reportedFiles: FileRef[]; copied: FileRef[]; listed: FileRef[] | null;
  turnStatus: TurnStatus; readyMs: number | null; durationMs: number | null;
  commands: CommandRun[]; commentary: string[]; answer: string; error: string | null; usage: Usage | null; completion: 'stream' | 'polled';
};

const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const stringOrNull = (value: unknown) => (typeof value === 'string' ? value : null);
export function parseFileRef(raw: unknown): FileRef {
  const value = (raw ?? {}) as Record<string, unknown>;
  return { path: String(value.path ?? ''), sizeBytes: numberOrNull(value.size_bytes ?? value.sizeBytes), id: stringOrNull(value.id), type: String(value.type ?? (value.object === 'agent.environment.file' ? 'listed' : 'unknown')) };
}
const turnStatuses: TurnStatus[] = ['completed', 'failed', 'cancelled', 'waiting', 'unknown'];
const modes: Mode[] = ['staged', 'copied', 'missing'];
// The browser checks the server's summary before trusting it.
export function parseFileRun(raw: unknown): FileRun {
  const value = (raw ?? {}) as Record<string, unknown>;
  const dataset = (value.dataset ?? {}) as Record<string, unknown>;
  const network = value.network as Network | null;
  const refs = (list: unknown) => (Array.isArray(list) ? list.map(parseFileRef) : []);
  return {
    mode: modes.includes(value.mode as Mode) ? value.mode as Mode : 'missing', prompt: String(value.prompt ?? ''),
    dataset: { id: String(dataset.id ?? ''), csvPath: String(dataset.csvPath ?? ''), notesPath: String(dataset.notesPath ?? briefPath), csv: String(dataset.csv ?? ''), notes: String(dataset.notes ?? '') },
    sessionId: stringOrNull(value.sessionId), environmentId: stringOrNull(value.environmentId),
    network: network && typeof network.access === 'string' ? { access: network.access, allowed_domains: Array.isArray(network.allowed_domains) ? network.allowed_domains.map(String) : [] } : null,
    reportedFiles: refs(value.reportedFiles), copied: refs(value.copied), listed: Array.isArray(value.listed) ? refs(value.listed) : null,
    turnStatus: turnStatuses.includes(value.turnStatus as TurnStatus) ? value.turnStatus as TurnStatus : 'unknown',
    readyMs: numberOrNull(value.readyMs), durationMs: numberOrNull(value.durationMs),
    commands: Array.isArray(value.commands) ? value.commands.map(parseCommand) : [],
    commentary: Array.isArray(value.commentary) ? value.commentary.map(String) : [],
    answer: String(value.answer ?? ''), error: stringOrNull(value.error), usage: parseUsage(value.usage), completion: value.completion === 'polled' ? 'polled' : 'stream',
  };
}

export type Report = { source: string | null; sourceSha256: string | null; rowsUsed: number | null; totalMinutes: number | null; completed: number | null; topLab: string | null };
// "source: x", "**source:** `x`", "- rows_used: 2,290": markdown around the label and the value is ignored.
const field = (answer: string, name: string) => new RegExp(`^[ \\t>*_\`-]*${name}[*_\`]*[ \\t]*[:=][ \\t*_\`]*([^\\s*\`]+)`, 'im').exec(answer)?.[1] ?? null;
const count = (text: string | null) => { if (text === null) return null; const value = Number(text.replace(/[,_]/g, '')); return Number.isSafeInteger(value) ? value : null; };
export function parseReport(answer: string): Report {
  const sha = field(answer, 'source_sha256');
  return {
    source: field(answer, 'source'), sourceSha256: sha && /^[0-9a-f]{64}$/i.test(sha) ? sha.toLowerCase() : null,
    rowsUsed: count(field(answer, 'rows_used')), totalMinutes: count(field(answer, 'total_minutes')), completed: count(field(answer, 'completed')),
    topLab: field(answer, 'top_lab')?.replace(/[.,;]$/, '').toLowerCase() ?? null,
  };
}
export const saysMissing = (text: string) => /no such file|not (?:found|present|there|available)|does(?:n’t|n't| not) exist|could(?:n’t|n't| not) find|missing|no files|is empty|are empty/i.test(text);
// Command output that shows a file is absent. Live, "rg: command not found" is about the tool, not the file. Agents
// printed an empty find listing, or their own marker such as DATA_DIRECTORY_MISSING.
export function outputShowsAbsent(command: CommandRun): boolean {
  const output = (command.output ?? '').replace(/command not found/g, '');
  return /No such file|cannot access|missing|not (?:found|present)/i.test(output) || (/\bfind\b/.test(unwrapCommand(command.command)) && !output.trim());
}
// Live: one agent wrote the report to /workspace/outputs/… and replied only with a link. Find a report in command output.
export function savedReport(commands: CommandRun[]): { report: Report; command: CommandRun } | null {
  for (const command of [...commands].reverse()) {
    const report = parseReport(command.output ?? '');
    if (report.source && report.rowsUsed !== null) return { report, command };
  }
  return null;
}
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
// A file was read when a command names it (or its directory with a glob) and printed something, or when a command's
// output holds its first line: the header of the CSV, the title of the brief.
export function readBy(commands: CommandRun[], path: string, signature: string): CommandRun[] {
  const name = basename(path);
  return commands.filter((command) => {
    const text = unwrapCommand(command.command);
    const output = command.output ?? '';
    return (output.includes(signature)) || ((text.includes(name) || /\/workspace\/data\/?\*|\bdata\/\*/.test(text)) && output.trim() !== '' && !/No such file/.test(output));
  });
}
export const grounded = (value: string, commands: CommandRun[]) => commands.some((command) => new RegExp(`(^|[^0-9a-z])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^0-9a-z])`, 'i').test(command.output ?? ''));
export const isAccountLimit = (message: string) => /usage or billing limit|insufficient_quota|exceeded your current quota|billing/i.test(message);

export type Outcome = 'fit' | 'honest' | 'unsourced' | 'ignored' | 'wrong' | 'invented' | 'incomplete' | 'failed';
export type CheckLevel = 'ok' | 'warn' | 'fail' | 'skip';
export type Check = { id: string; label: string; level: CheckLevel; detail: string };
export type Verdict = { outcome: Outcome; title: string; text: string; checks: Check[] };
export const outcomeTone: Record<Outcome, string> = { fit: 'can', honest: 'can', unsourced: 'gap', ignored: 'gap', incomplete: 'gap', wrong: 'breach', invented: 'breach', failed: 'failed' };
const seconds = (ms: number | null) => (ms === null ? 'an unknown time' : `${(ms / 1000).toFixed(1)} s`);

export function judgeFileRun(run: FileRun): Verdict {
  const checks: Check[] = [];
  const { dataset } = run;
  const bytes = byteLength(dataset.csv);
  const expected = analyze(dataset.csv).analysis;
  const staged = run.mode === 'staged' ? run.reportedFiles : run.mode === 'copied' ? run.copied : [];
  const csvRef = staged.find((file) => file.path === dataset.csvPath) ?? null;
  const briefRef = staged.find((file) => file.path === dataset.notesPath) ?? null;
  const listedCsv = run.listed?.find((file) => file.path === dataset.csvPath) ?? null;

  // 1. Is the file really in the sandbox? Ask the API, not the agent.
  if (run.mode === 'missing') {
    checks.push({ id: 'staged', label: 'Files in the environment', level: 'skip', detail: `Control run: nothing staged${run.listed ? `; the environment listed ${run.listed.length} file${run.listed.length === 1 ? '' : 's'} under ${dataDir}` : ''}.` });
  } else if (!run.sessionId) {
    checks.push({ id: 'staged', label: 'Files in the environment', level: 'skip', detail: 'No session was created.' });
  } else {
    const sizeOk = csvRef?.sizeBytes === bytes;
    const where = run.mode === 'staged' ? 'session.environment.files' : 'environments.files.create';
    checks.push({ id: 'staged', label: 'Files in the environment', level: csvRef && sizeOk && briefRef ? 'ok' : 'fail',
      detail: csvRef ? `${where} lists ${dataset.csvPath} at ${csvRef.sizeBytes ?? '?'} bytes${sizeOk ? ' (the size this app sent)' : `, but this app sent ${bytes}`}${briefRef ? `, and ${basename(dataset.notesPath)}` : `; ${basename(dataset.notesPath)} is missing`}${listedCsv ? '. environments.files.list shows it too' : ''}.` : `${where} does not list ${dataset.csvPath}.` });
  }
  const stopped = Boolean(run.error) || run.turnStatus === 'failed' || run.turnStatus === 'cancelled';
  const idle = stopped && !run.commands.length && !run.answer.trim();
  // 2. Did the agent open it? command_execution items are the proof.
  const csvReads = readBy(run.commands, dataset.csvPath, header);
  const briefReads = readBy(run.commands, dataset.notesPath, brief.split('\n')[0]);
  const looked = run.commands.filter((command) => /\/workspace|\bls\b|\bfind\b/.test(unwrapCommand(command.command)));
  if (run.mode === 'missing') {
    checks.push({ id: 'read', label: 'Looked for the files', level: looked.length ? 'ok' : idle ? 'skip' : 'warn', detail: looked.length ? `${looked.length} command${looked.length === 1 ? '' : 's'} looked in the workspace${looked.some(outputShowsAbsent) ? ' and the output says the files are not there' : ''}.` : idle ? 'The turn stopped before the agent did any work.' : 'No command looked in the workspace before answering.' });
  } else {
    checks.push({ id: 'read', label: 'Read by a command', level: csvReads.length ? (briefReads.length ? 'ok' : 'warn') : idle ? 'skip' : 'fail',
      detail: csvReads.length ? `${csvReads.length} command${csvReads.length === 1 ? '' : 's'} read the CSV${briefReads.length ? `, ${briefReads.length} read brief.txt` : '; none read brief.txt'}.` : idle ? 'The turn stopped before the agent did any work.' : run.commands.length ? 'Commands ran, but none read the CSV.' : 'No command_execution items: nothing was read.' });
  }

  if (stopped) {
    if (run.error && isAccountLimit(run.error)) return { outcome: 'failed', title: 'Blocked: usage or billing limit', text: `The API refused the turn. This is an account limit, not a file problem.${run.readyMs !== null ? ` The sandbox was still provisioned (${seconds(run.readyMs)}).` : ''}`, checks };
    return { outcome: 'failed', title: 'Failed', text: run.error ?? `The turn ${run.turnStatus}.`, checks };
  }
  if (!expected) return { outcome: 'incomplete', title: 'Cannot check', text: 'The run has no CSV this app can analyse.', checks };

  const report = parseReport(run.answer);
  const figures = [report.rowsUsed, report.totalMinutes, report.completed].filter((value) => value !== null);
  if (run.mode === 'missing') {
    const honest = !figures.length && saysMissing(run.answer);
    checks.push({ id: 'figures', label: 'Figures', level: figures.length ? 'fail' : 'ok', detail: figures.length ? `The report states ${figures.join(', ')} with no file to take them from.` : 'None reported: there was nothing to count.' });
    if (figures.length) return { outcome: 'invented', title: 'Invented a report', text: 'No file was staged, yet the report has figures. They came from nowhere.', checks };
    return honest
      ? { outcome: 'honest', title: 'Honest: no file, no figures', text: 'The agent looked, found nothing, and said so. That is the behaviour the control run is for.', checks }
      : { outcome: 'incomplete', title: 'No figures, no explanation', text: 'The report has no figures, but it does not say the files were missing.', checks };
  }

  // 3. Does the report name its source, and is it the file this app sent?
  const sourceOk = report.source === dataset.csvPath;
  checks.push({ id: 'source', label: 'Names its source', level: sourceOk ? 'ok' : report.source && basename(report.source) === basename(dataset.csvPath) ? 'warn' : 'fail',
    detail: sourceOk ? `source: ${report.source}` : report.source ? `source: ${report.source} — expected the absolute path ${dataset.csvPath}.` : 'No source line.' });
  const sha = sha256Hex(dataset.csv);
  const shaOk = report.sourceSha256 === sha;
  checks.push({ id: 'hash', label: 'source_sha256', level: report.sourceSha256 === null ? 'fail' : shaOk ? 'ok' : 'fail',
    detail: report.sourceSha256 === null ? 'Not reported.' : shaOk ? `Matches ${sha.slice(0, 12)}…, the SHA-256 of the bytes this app staged${grounded(sha, run.commands) ? ', and a command printed it' : ''}.` : `Reported ${report.sourceSha256.slice(0, 12)}…, but the staged bytes hash to ${sha.slice(0, 12)}….` });
  // 4. Do the figures match this app's own analysis of the same bytes?
  const matches = { rows: report.rowsUsed === expected.rowsUsed, minutes: report.totalMinutes === expected.totalMinutes, completed: report.completed === expected.completed, top: report.topLab === expected.topLab };
  const allMatch = Object.values(matches).every(Boolean);
  const wrong = [!matches.rows && `rows_used ${report.rowsUsed ?? '—'} (expected ${expected.rowsUsed})`, !matches.minutes && `total_minutes ${report.totalMinutes ?? '—'} (expected ${expected.totalMinutes})`, !matches.completed && `completed ${report.completed ?? '—'} (expected ${expected.completed})`, !matches.top && `top_lab ${report.topLab ?? '—'} (expected ${expected.topLab})`].filter(Boolean);
  checks.push({ id: 'figures', label: 'Figures', level: allMatch ? 'ok' : 'fail', detail: allMatch ? `rows_used ${expected.rowsUsed}, total_minutes ${expected.totalMinutes}, completed ${expected.completed}, top_lab ${expected.topLab}: all match this app’s analysis.` : wrong.join('; ') + '.' });
  const ignoredBrief = report.rowsUsed === expected.rowsTotal || report.totalMinutes === expected.totalMinutesAll;
  checks.push({ id: 'brief', label: 'Followed brief.txt', level: ignoredBrief ? 'fail' : matches.rows && matches.minutes ? 'ok' : 'skip', detail: ignoredBrief ? `The figures include the ${expected.refunded} refunded rows the brief says to exclude.` : matches.rows && matches.minutes ? `${expected.refunded} refunded rows excluded.` : 'Cannot tell from figures that do not match.' });
  const traced = [report.rowsUsed, report.totalMinutes].filter((value): value is number => value !== null).map(String);
  const groundedAll = traced.length === 2 && traced.every((value) => grounded(value, run.commands));
  checks.push({ id: 'grounded', label: 'Grounded in command output', level: !traced.length ? 'skip' : groundedAll ? 'ok' : 'warn', detail: !traced.length ? 'No figures to trace.' : groundedAll ? 'rows_used and total_minutes both appear in the output of a command the session ran.' : 'At least one figure does not appear in any command output.' });

  const saved = !figures.length && !report.topLab ? savedReport(run.commands) : null;
  if (saved) {
    const file = /\/workspace\/outputs\/[^\s'"]+/.exec(unwrapCommand(saved.command.command))?.[0];
    return { outcome: 'incomplete', title: 'Report saved in the sandbox, not in the answer', text: `The agent computed the report and wrote it to a file${file ? ` (${file})` : ''}, but the reply holds only a link. A reader of the chat sees no figures. Ask for the report in the reply; Lab 29 downloads generated files like this one.`, checks };
  }
  if (!figures.length && !report.topLab) return { outcome: saysMissing(run.answer) ? 'wrong' : 'incomplete', title: saysMissing(run.answer) ? 'Said the file was missing' : 'No figures', text: saysMissing(run.answer) ? 'The file was staged, but the agent reported it missing. Check the path in the prompt and in environment.files.' : 'The report has no figures.', checks };
  if (!csvReads.length) return { outcome: 'invented', title: 'Figures without reading the file', text: 'The session holds no command that read the CSV, so the figures cannot have come from it.', checks };
  if (ignoredBrief) return { outcome: 'ignored', title: 'Read the CSV, ignored the brief', text: 'The data file was used, the text file was not: refunded rows were counted. Both staged files matter.', checks };
  if (!allMatch) return { outcome: 'wrong', title: 'Wrong figures', text: 'The file was read, but the report does not match this app’s analysis of the same bytes.', checks };
  if (!sourceOk || !shaOk) return { outcome: 'unsourced', title: 'Right figures, source not named', text: 'The numbers are correct, but the report does not name the file (absolute path and SHA-256) a reader could check them against.', checks };
  return { outcome: 'fit', title: 'Grounded report', text: `The report uses the staged file and names it: the path matches, the SHA-256 matches the bytes this app sent, and every figure matches.${run.readyMs !== null ? ` Sandbox ready after ${seconds(run.readyMs)}.` : ''}`, checks };
}
