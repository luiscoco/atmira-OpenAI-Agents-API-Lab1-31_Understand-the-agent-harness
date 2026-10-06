import '../server/env.ts';
import { resolve, relative, isAbsolute, basename } from 'node:path';
import { WorkspaceStore } from '../server/capstoneStore.ts';
import { researchApi } from '../server/capstoneRunner.ts';
import { redact } from '../server/courseLabHttp.ts';
const file = resolve(process.argv[2] || ''); const root = resolve('.lab-data'); const path = relative(root, file);
if (!process.argv[2] || path.startsWith('..') || isAbsolute(path) || !/^(live-verification|model-evaluation)-[a-f0-9-]+\.sqlite$/.test(basename(file))) throw new Error('Select a labelled live-verification or model-evaluation SQLite database inside .lab-data.');
const args = process.argv.slice(3), index = args.indexOf('--attempts');
const attempts = index < 0 ? 3 : Number(args[index + 1]);
if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw new Error('Cleanup attempts must be 1–3.');
const store = new WorkspaceStore(file), api = researchApi();
try {
  for (const inv of store.all('SELECT id,session_id FROM investigations WHERE session_id IS NOT NULL')) {
    const report: any = { recordedAt: new Date().toISOString(), investigation: inv.id, inspection: 'unknown', cleanup: 'unknown', cleanupAttempts: 0 };
    try { const saved = await api.inspect(inv.session_id, AbortSignal.timeout(20000)); report.inspection = saved.turns.map(row => ({ id: row.id, status: row.status })); } catch (error) { report.inspectionError = redact(String(error.message).slice(0, 1000)); }
    for (let attempt = 1; attempt <= attempts; attempt++) {
      report.cleanupAttempts = attempt;
      try { await api.remove(inv.session_id); store.setSession(inv.id, ''); report.cleanup = 'session deleted'; delete report.cleanupError; break; }
      catch (error) {
        report.cleanupError = redact(String(error.message).slice(0, 1000));
        report.cleanupStatus = error.status;
        report.cleanupRequestId = error.request_id;
        if (error.status !== 409 || attempt === attempts) break;
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
    if (report.cleanup !== 'session deleted') process.exitCode = 1;
    console.log(JSON.stringify(report));
  }
} finally { store.close(); }
