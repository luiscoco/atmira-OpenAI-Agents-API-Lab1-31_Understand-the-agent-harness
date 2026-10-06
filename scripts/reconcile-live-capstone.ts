import '../server/env.ts';
import { resolve, relative, isAbsolute } from 'node:path';
import { WorkspaceStore } from '../server/capstoneStore.ts';
import { researchApi } from '../server/capstoneRunner.ts';
import { redact } from '../server/courseLabHttp.ts';
const file = resolve(process.argv[2] || ''); const root = resolve('.lab-data'); const path = relative(root, file);
if (!process.argv[2] || path.startsWith('..') || isAbsolute(path) || !file.endsWith('.sqlite')) throw new Error('Select a verification SQLite database inside .lab-data.');
const store = new WorkspaceStore(file), api = researchApi();
try {
  for (const inv of store.all('SELECT id,session_id FROM investigations WHERE session_id IS NOT NULL')) {
    const report: any = { investigation: inv.id, inspection: 'unknown', cleanup: 'unknown' };
    try { const saved = await api.inspect(inv.session_id, AbortSignal.timeout(20000)); report.inspection = saved.turns.map(row => ({ id: row.id, status: row.status })); } catch (error) { report.inspectionError = redact(String(error.message).slice(0, 1000)); }
    try { await api.remove(inv.session_id); store.setSession(inv.id, ''); report.cleanup = 'session deleted'; } catch (error) { report.cleanupError = redact(String(error.message).slice(0, 1000)); process.exitCode = 1; }
    console.log(JSON.stringify(report));
  }
} finally { store.close(); }
