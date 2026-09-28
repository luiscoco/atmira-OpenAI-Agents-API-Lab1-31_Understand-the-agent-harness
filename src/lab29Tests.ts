// Lab 29: the test page. Every case runs the real functions (isPublishable, parsePlan, checkPlan, pick, firstByPath,
// latestByPath, mimeFor, safeFilename, downloadHeaders, checkDownload, reportFigures, summaryFigures, tableFigures,
// verifyDownload, resolveLink, parseArtifactRun, judgeArtifactRun, manifest) on fixed inputs: no network, no API key.
import { sha256Hex } from './lab26Environment.ts';
import { analyze, makeDataset } from './lab27Files.ts';
import {
  checkDownload, checkPlan, downloadHeaders, firstByPath, forTurn, formatBytes, isPublishable, judgeArtifactRun, latestByPath, manifest, mentionedPaths, mimeFor,
  notesPath, outsideDir, parseArtifact, parseArtifactRun, parsePlan, pick, promptsFor, reportFigures, reportPath, resolveLink, safeFilename, summaryFigures, summaryPath,
  tableFigures, tablePath, verifyDownload, draftPath, MiB, type ArtifactRef, type ArtifactRun,
} from './lab29Artifacts.ts';
import { samples } from './lab29Scenarios.ts';

export type TestGroup = 'publish' | 'identify' | 'download' | 'verify' | 'judge';
export type ArtifactTest = { id: string; label: string; group: TestGroup; expect: string; note: string; run: () => { got: string; detail: string } };
export type TestResult = { id: string; got: string; detail: string; pass: boolean };

// ---- Fixtures: the live probe of 2026-09-28 (dataset 29a11ce5), with IDs, sizes and bytes as the API returned them ----
const dataset = makeDataset(0x29a11ce5);
const analysis = analyze(dataset.csv).analysis!;
const turn1 = 'turn_0d642d2a65313663006aba516297208195b508713d8cb6d17b';
const turn2 = 'turn_0d642d2a65313663006aba5182ece08195922a47da2d324191';
const env = 'ccarenv_b64_Y2NhcmVudl82YWJhNTE0YTJhZjg4MTkxODE2ZDg0MzM0ZjRjZWNmYQ';
const reportText = '# Enrollment Report\n\nMinutes by lab, excluding rows with a status of `refunded`.\n\n| Lab | Minutes |\n| --- | ---: |\n| lab21 | 260 |\n| lab22 | 129 |\n| lab23 | 925 |\n| lab24 | 331 |\n| lab25 | 432 |\n| lab26 | 142 |\n| lab27 | 419 |\n\nrows_used: 39\n\ntotal_minutes: 2638\n\ncompleted: 26\n\ntop_lab: lab23\n';
const summaryText = '{\n  "rows_used": 39,\n  "total_minutes": 2638,\n  "completed": 26,\n  "top_lab": "lab23"\n}\n';
// Synthetic: the probe did not ask for the table. This is what a correct one holds.
const tableText = 'lab,minutes\nlab21,260\nlab22,129\nlab23,925\nlab24,331\nlab25,432\nlab26,142\nlab27,419\n';
const art = (id: string, path: string, size: number, turnId: string, createdAt: number): ArtifactRef => ({ id, path, sizeBytes: size, turnId, environmentId: env, createdAt });
const report1 = art('artifact_8b234bcf07c2465699cd3102b11cf6d928889dba3c584ea4b3', reportPath, 294, turn1, 1790595446);
const summary1 = art('artifact_9891b4db12c942eab8c0fe6622048b0dca3b1c60048b46eebc', summaryPath, 88, turn1, 1790595446);
const report2 = art('artifact_5915633175e444e7957a8737ced76ec53c89193d3e19457eb6', reportPath, 306, turn2, 1790595462);
const table1 = art('artifact_00000000000000000000synthetictable0000000000000', tablePath, tableText.length, turn1, 1790595446);
const revised = [report1, summary1, report2];
const down = (artifact: ArtifactRef, text: string) => ({ artifactId: artifact.id, status: 200, contentType: 'application/octet-stream', bytes: new TextEncoder().encode(text).length, sha256: sha256Hex(text), text, error: null });

const base: ArtifactRun = {
  task: 'report', prompts: promptsFor('report', dataset), model: 'gpt-5.6-terra', dataset: { id: dataset.id, csvPath: dataset.csvPath, csv: dataset.csv },
  sessionId: 'sess_0d642d2a65313663006aba514a276881958b7cafc8c50bc0a1', environmentId: env, turns: [{ id: turn1, status: 'completed', publishMs: 581 }],
  artifacts: [report1, summary1, table1],
  listed: [{ path: notesPath, sizeBytes: 361, id: null, type: 'listed' }, { path: summaryPath, sizeBytes: 88, id: null, type: 'listed' }, { path: reportPath, sizeBytes: 294, id: null, type: 'listed' }, { path: tablePath, sizeBytes: tableText.length, id: null, type: 'listed' }, { path: dataset.csvPath, sizeBytes: 1760, id: null, type: 'listed' }],
  downloads: [down(report1, reportText), down(summary1, summaryText), down(table1, tableText)],
  readyMs: 20_993, durationMs: 53_575, commands: [], commentary: [], answer: `Created [enrollment-report.md](${reportPath}) — 294 bytes, [summary.json](${summaryPath}) — 88 bytes, [notes.txt](${notesPath}) — 361 bytes.`, answers: [],
  error: null, errorKind: null, usage: null, deleted: [],
};
const variant = (patch: Partial<ArtifactRun>): ArtifactRun => ({ ...base, ...patch });
const judged = (run: ArtifactRun) => { const verdict = judgeArtifactRun(run); return { got: verdict.outcome, detail: `${verdict.title}: ${verdict.text}\n${verdict.checks.map((check) => `${check.level} · ${check.label}: ${check.detail}`).join('\n')}` }; };
const levels = (text: string) => checkPlan(parsePlan(text).files).map((item) => item.level).join(',');
const planDetail = (text: string) => checkPlan(parsePlan(text).files).map((item) => `${item.level}: ${item.text}`).join('\n');
const figures = (rows: Array<{ field: string; got: string | null; want: string; ok: boolean }> | null) => (rows ? rows.map((row) => `${row.ok ? '✓' : '✕'} ${row.field}: ${row.got ?? 'missing'} (want ${row.want})`).join('\n') : 'null');
const sample = (id: string) => samples.find((item) => item.id === id)?.run ?? null;

export const artifactTests: ArtifactTest[] = [
  { id: 'publish-report', label: 'A file in outputs', group: 'publish', expect: 'true', note: 'Live: enrollment-report.md was published when the turn completed.', run: () => ({ got: String(isPublishable(reportPath)), detail: `isPublishable('${reportPath}')` }) },
  { id: 'publish-nested', label: 'A subdirectory of outputs', group: 'publish', expect: 'true', note: 'The docs say “under /workspace/outputs”. The report task writes tables/minutes-by-lab.csv to check it live.', run: () => ({ got: String(isPublishable(tablePath)), detail: `isPublishable('${tablePath}')` }) },
  { id: 'publish-scratch', label: 'Scratch notes', group: 'publish', expect: 'false', note: 'Live: /workspace/scratch/notes.txt (361 bytes) was written in the same turn and never listed as an artifact.', run: () => ({ got: String(isPublishable(notesPath)), detail: `isPublishable('${notesPath}')` }) },
  { id: 'publish-dir', label: 'The directory itself', group: 'publish', expect: 'false,false', note: 'Artifacts are files.', run: () => ({ got: `${isPublishable('/workspace/outputs')},${isPublishable('/workspace/outputs/')}`, detail: "'/workspace/outputs', '/workspace/outputs/'" }) },
  { id: 'publish-dotdot', label: 'An escape with ..', group: 'publish', expect: 'false', note: 'The prefix matches, the path does not stay inside.', run: () => ({ got: String(isPublishable('/workspace/outputs/../secrets.txt')), detail: "isPublishable('/workspace/outputs/../secrets.txt')" }) },
  { id: 'publish-prefix', label: 'A look-alike directory', group: 'publish', expect: 'false', note: 'outputs-old is not outputs.', run: () => ({ got: String(isPublishable('/workspace/outputs-old/report.md')), detail: "isPublishable('/workspace/outputs-old/report.md')" }) },
  { id: 'plan-parse', label: 'Plan sizes with units', group: 'publish', expect: '294,12582912,1536', note: 'bytes by default; KiB and MiB accepted.', run: () => { const plan = parsePlan(`${reportPath} 294\n${outputsFile('chart.png')} 12 MiB\n${summaryPath} 1.5 KiB`); return { got: plan.files.map((file) => file.bytes).join(','), detail: JSON.stringify(plan, null, 2) }; } },
  { id: 'plan-bad-line', label: 'A line with no size', group: 'publish', expect: '1', note: 'The planner says which line to fix.', run: () => { const plan = parsePlan('/workspace/outputs/report.md'); return { got: String(plan.errors.length), detail: plan.errors.join('\n') }; } },
  { id: 'plan-mixed', label: 'Report, notes, relative path', group: 'publish', expect: 'ok,warn,error', note: 'Published, sandbox-only, and not a sandbox path at all.', run: () => { const text = `${reportPath} 294\n${notesPath} 361\nreport.md 294`; return { got: levels(text), detail: planDetail(text) }; } },
  { id: 'plan-file-limit', label: 'One 250 MiB file', group: 'publish', expect: 'error,warn', note: 'The documented per-file limit is 200 MiB. Nothing else would publish.', run: () => { const text = `${outputsFile('video.mp4')} 250 MiB`; return { got: levels(text), detail: planDetail(text) }; } },
  { id: 'plan-turn-limit', label: 'Three 180 MiB files', group: 'publish', expect: 'ok,ok,ok,error', note: 'Each is under 200 MiB; together they pass the 500 MiB per-turn limit.', run: () => { const text = [1, 2, 3].map((n) => `${outputsFile(`part${n}.bin`)} 180 MiB`).join('\n'); return { got: levels(text), detail: planDetail(text) }; } },
  { id: 'prompt-outside', label: 'The outside task’s paths', group: 'publish', expect: 'reports only', note: 'The control task is the same prompt with another directory.', run: () => { const prompt = promptsFor('outside', dataset)[0]; return { got: prompt.includes('/workspace/outputs') ? 'mentions outputs' : prompt.includes(outsideDir) ? 'reports only' : 'neither', detail: prompt }; } },

  { id: 'pick-revised', label: 'Turn 2’s report, by turn and path', group: 'identify', expect: 'artifact_5915…306', note: 'Live: the revise probe’s three artifacts. The docs pattern: match turn_id and path.', run: () => { const found = pick(revised, turn2, reportPath); return { got: found ? `${found.id.slice(0, 13)}…${found.sizeBytes}` : 'null', detail: JSON.stringify(found, null, 2) }; } },
  { id: 'first-by-path', label: 'The path alone, ascending', group: 'identify', expect: 'artifact_8b23…294', note: 'The shortcut finds the turn-1 copy: an old report the user did not ask for.', run: () => { const found = firstByPath(revised, reportPath); return { got: found ? `${found.id.slice(0, 13)}…${found.sizeBytes}` : 'null', detail: JSON.stringify(found, null, 2) }; } },
  { id: 'latest-by-path', label: 'The newest copy of each path', group: 'identify', expect: 'report 306 · summary 88', note: 'summary.json’s only artifact is from turn 1: turn 2 did not change it, so it was not published again.', run: () => { const latest = latestByPath(revised); return { got: `report ${latest.get(reportPath)?.sizeBytes} · summary ${latest.get(summaryPath)?.sizeBytes}`, detail: [...latest.entries()].map(([path, item]) => `${path} → ${item.id} (${item.turnId.slice(0, 12)}…)`).join('\n') }; } },
  { id: 'for-turn', label: 'Artifacts of turn 2 only', group: 'identify', expect: '1', note: 'Only what changed was published again.', run: () => ({ got: String(forTurn(revised, turn2).length), detail: forTurn(revised, turn2).map((item) => item.path).join('\n') }) },
  { id: 'pick-missing', label: 'summary.json in turn 2', group: 'identify', expect: 'null', note: 'Not every path has an artifact in every turn.', run: () => ({ got: String(pick(revised, turn2, summaryPath)), detail: 'pick(revised, turn2, summaryPath)' }) },
  { id: 'parse-artifact', label: 'The API’s artifact object', group: 'identify', expect: 'report · 294 · turn_0d642d2a', note: 'Recorded response from sessions.artifacts.retrieve.', run: () => { const item = parseArtifact({ id: report1.id, object: 'agent.session.artifact', session_id: base.sessionId, environment_id: env, turn_id: turn1, path: reportPath, size_bytes: 294, created_at: 1790595446 }); return { got: `${item.path === reportPath ? 'report' : item.path} · ${item.sizeBytes} · ${item.turnId.slice(0, 13)}`, detail: JSON.stringify(item, null, 2) }; } },

  { id: 'mime-text', label: 'Types from the path', group: 'download', expect: 'text/markdown · application/json · text/csv', note: 'Live: the API sent application/octet-stream for every file.', run: () => ({ got: [reportPath, summaryPath, tablePath].map((path) => mimeFor(path).split(';')[0]).join(' · '), detail: [reportPath, summaryPath, tablePath].map((path) => `${path} → ${mimeFor(path)}`).join('\n') }) },
  { id: 'mime-active', label: 'HTML and SVG from an agent', group: 'download', expect: 'application/octet-stream ×3', note: 'Served from this origin, agent-written HTML could run as the app. It is only ever bytes to download.', run: () => { const types = ['report.html', 'chart.svg', 'x.js'].map((name) => mimeFor(outputsFile(name))); return { got: types.every((type) => type === 'application/octet-stream') ? 'application/octet-stream ×3' : types.join(', '), detail: types.join('\n') }; } },
  { id: 'filename-hostile', label: 'A hostile file name', group: 'download', expect: 'rm_-rf_.md', note: 'The base name only; anything but letters, digits, . _ - becomes _, with no leading dot.', run: () => ({ got: safeFilename('/workspace/outputs/..;rm -rf .md'), detail: "safeFilename('/workspace/outputs/..;rm -rf .md')" }) },
  { id: 'filename-dotfile', label: 'A dot file', group: 'download', expect: 'env', note: 'Saved files are never hidden.', run: () => ({ got: safeFilename('/workspace/outputs/.env'), detail: "safeFilename('/workspace/outputs/.env')" }) },
  { id: 'headers', label: 'Download headers', group: 'download', expect: 'attachment · nosniff · 294', note: 'Always an attachment, never sniffed, with the real length.', run: () => { const headers = downloadHeaders(reportPath, 294); return { got: `${headers['Content-Disposition'].split(';')[0]} · ${headers['X-Content-Type-Options']} · ${headers['Content-Length']}`, detail: JSON.stringify(headers, null, 2) }; } },
  { id: 'check-ok', label: 'A 294-byte report', group: 'download', expect: '200', note: 'Metadata first: the size decides before any bytes move.', run: () => { const check = checkDownload(report1); return { got: String(check.status), detail: check.reason }; } },
  { id: 'check-big', label: 'A 25 MiB artifact', group: 'download', expect: '413', note: 'Within the API’s 200 MiB, over this lab proxy’s 20 MiB buffer.', run: () => { const check = checkDownload({ ...report1, sizeBytes: 25 * MiB }); return { got: String(check.status), detail: check.reason }; } },
  { id: 'check-id', label: 'Not an artifact ID', group: 'download', expect: '400', note: 'The proxy never forwards a malformed ID.', run: () => { const check = checkDownload({ ...report1, id: '../files/file_123' }); return { got: String(check.status), detail: check.reason }; } },
  { id: 'format-bytes', label: 'Human sizes', group: 'download', expect: '294 bytes · 1.5 KiB · 200.0 MiB', note: '', run: () => ({ got: [294, 1536, 200 * MiB].map((n) => formatBytes(n)).join(' · '), detail: 'formatBytes' }) },

  { id: 'figures-ok', label: 'The live report’s figures', group: 'verify', expect: '4/4', note: 'Live bytes of artifact_8b23… against this app’s analysis of the same CSV.', run: () => { const rows = reportFigures(reportText, analysis); return { got: `${rows.filter((row) => row.ok).length}/4`, detail: figures(rows) }; } },
  { id: 'figures-wrong', label: 'A report with refunds counted', group: 'verify', expect: 'total_minutes', note: '3100 is the total before the brief’s exclusion.', run: () => { const rows = reportFigures(reportText.replace('total_minutes: 2638', 'total_minutes: 3100'), analysis); return { got: rows.filter((row) => !row.ok).map((row) => row.field).join(',') || 'none', detail: figures(rows) }; } },
  { id: 'summary-ok', label: 'The live summary.json', group: 'verify', expect: '4/4', note: 'Live bytes of artifact_9891….', run: () => { const rows = summaryFigures(summaryText, analysis); return { got: rows ? `${rows.filter((row) => row.ok).length}/4` : 'null', detail: figures(rows) }; } },
  { id: 'summary-strings', label: 'Numbers written as strings', group: 'verify', expect: '1/4', note: '"39" is not 39: a program reading the JSON would notice.', run: () => { const rows = summaryFigures('{"rows_used":"39","total_minutes":"2638","completed":"26","top_lab":"lab23"}', analysis); return { got: rows ? `${rows.filter((row) => row.ok).length}/4` : 'null', detail: figures(rows) }; } },
  { id: 'summary-invalid', label: 'Not JSON', group: 'verify', expect: 'null', note: '', run: () => ({ got: String(summaryFigures('rows_used: 39', analysis)), detail: "summaryFigures('rows_used: 39')" }) },
  { id: 'table-ok', label: 'minutes-by-lab.csv', group: 'verify', expect: 'true', note: 'Every lab’s total after the exclusion.', run: () => { const result = tableFigures(tableText, dataset.csv); return { got: String(result.ok), detail: result.detail }; } },
  { id: 'table-header', label: 'A table with another header', group: 'verify', expect: 'false', note: '', run: () => { const result = tableFigures(tableText.replace('lab,minutes', 'Lab,Minutes'), dataset.csv); return { got: String(result.ok), detail: result.detail }; } },
  { id: 'bytes-ok', label: 'Bytes equal size_bytes', group: 'verify', expect: 'ok', note: '', run: () => { const result = verifyDownload(report1, down(report1, reportText)); return { got: result.level, detail: result.detail }; } },
  { id: 'bytes-short', label: 'A truncated download', group: 'verify', expect: 'fail', note: 'Stop before handing the user half a file.', run: () => { const result = verifyDownload(report1, down(report1, reportText.slice(0, 200))); return { got: result.level, detail: result.detail }; } },
  { id: 'link-artifact', label: 'A published path in the reply', group: 'verify', expect: 'artifact · artifact · sandbox · external', note: 'Live: the reply linked [enrollment-report.md](/workspace/outputs/…). Only this page can make that a download.', run: () => { const kinds = [reportPath, `file://${summaryPath}`, notesPath, 'https://developers.openai.com'].map((href) => resolveLink(href, base.artifacts, turn1).kind); return { got: kinds.join(' · '), detail: kinds.join('\n') }; } },
  { id: 'mentioned', label: 'Paths named in a reply', group: 'verify', expect: '3', note: '', run: () => { const paths = mentionedPaths(base.answer); return { got: String(paths.length), detail: paths.join('\n') }; } },
  { id: 'parse-garbage', label: 'A malformed summary', group: 'verify', expect: 'report · 0 turns · 0 artifacts', note: 'The browser checks the server’s summary before trusting it.', run: () => { const run = parseArtifactRun({ task: 'rm', turns: 'x', artifacts: null }); return { got: `${run.task} · ${run.turns.length} turns · ${run.artifacts.length} artifacts`, detail: JSON.stringify(run, null, 2).slice(0, 600) }; } },
  { id: 'manifest', label: 'The delivery manifest', group: 'verify', expect: '3 artifacts, hashed', note: 'What was delivered, from which turn, with its hash.', run: () => { const text = manifest(base); const value = JSON.parse(text) as { artifacts: Array<{ sha256: string | null }> }; return { got: `${value.artifacts.length} artifacts${value.artifacts.every((item) => item.sha256) ? ', hashed' : ''}`, detail: text }; } },

  { id: 'judge-delivered', label: 'Report, summary, table, notes', group: 'judge', expect: 'delivered', note: 'Live bytes for the report and summary; a synthetic table.', run: () => judged(base) },
  { id: 'judge-wrong', label: 'The same run with refunds counted', group: 'judge', expect: 'wrong', note: 'Published and downloadable is not the same as right.', run: () => { const text = reportText.replace('total_minutes: 2638', 'total_minutes: 3100'); return judged(variant({ artifacts: [{ ...report1, sizeBytes: text.length }, summary1, table1], downloads: [down(report1, text), down(summary1, summaryText), down(table1, tableText)] })); } },
  { id: 'judge-corrupt', label: 'A download shorter than size_bytes', group: 'judge', expect: 'corrupt', note: '', run: () => judged(variant({ downloads: [down(report1, reportText.slice(0, 100)), down(summary1, summaryText), down(table1, tableText)] })) },
  { id: 'judge-partial', label: 'No summary.json', group: 'judge', expect: 'partial', note: '', run: () => judged(variant({ artifacts: [report1, table1], downloads: [down(report1, reportText), down(table1, tableText)] })) },
  { id: 'judge-outside', label: 'Written under /workspace/reports', group: 'judge', expect: 'unpublished', note: 'The work exists and cannot be downloaded.', run: () => judged(variant({ task: 'outside', artifacts: [], downloads: [], listed: [{ path: `${outsideDir}/enrollment-report.md`, sizeBytes: 294, id: null, type: 'listed' }] })) },
  { id: 'judge-revised', label: 'The live revise probe', group: 'judge', expect: 'revised', note: 'Two reports on one path; the revision is the turn-2 artifact.', run: () => judged(variant({ task: 'revise', turns: [{ id: turn1, status: 'completed', publishMs: 581 }, { id: turn2, status: 'completed', publishMs: 1_788 }], artifacts: revised, downloads: [down(report1, reportText), down(summary1, summaryText), down(report2, `revision: 2\n${reportText}`)], listed: null })) },
  { id: 'judge-cancel', label: 'The live cancel probe', group: 'judge', expect: 'abandoned', note: 'draft.md was in /workspace/outputs and was never published.', run: () => judged(variant({ task: 'cancel', turns: [{ id: 'turn_0d642d2a65313663006aba51c95c6081958b60d12ee9d0d3b7', status: 'cancelled', publishMs: null }], artifacts: revised, downloads: [], listed: [{ path: draftPath, sizeBytes: 6, id: null, type: 'listed' }] })) },
  { id: 'judge-account', label: 'A billing refusal', group: 'judge', expect: 'failed', note: '', run: () => judged(variant({ turns: [], error: '429 You exceeded your current quota, please check your plan and billing details.', errorKind: 'account' })) },
  ...(['report', 'outside', 'revise', 'cancel'] as const).map((id): ArtifactTest => ({
    id: `recorded-${id}`, label: `Recorded run: ${id}`, group: 'judge', expect: id === 'report' ? 'delivered' : id === 'outside' ? 'unpublished' : id === 'revise' ? 'revised' : 'abandoned',
    note: 'A live run through this lab’s server, judged from its summary.',
    run: () => { const run = sample(id); return run ? judged(run) : { got: 'no recording', detail: 'This sample was not recorded.' }; },
  })),
];

function outputsFile(name: string) { return `/workspace/outputs/${name}`; }

export function runArtifactSuite(): TestResult[] {
  return artifactTests.map((test) => {
    try {
      const { got, detail } = test.run();
      return { id: test.id, got, detail, pass: got === test.expect };
    } catch (error) {
      return { id: test.id, got: 'threw', detail: error instanceof Error ? error.stack ?? error.message : String(error), pass: false };
    }
  });
}
