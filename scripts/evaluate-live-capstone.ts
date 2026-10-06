import '../server/env.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore } from '../server/capstoneStore.ts';
import { ResearchRunner, researchApi } from '../server/capstoneRunner.ts';
import { configured, redact } from '../server/courseLabHttp.ts';

// Four sequential, bounded sessions. No synthetic success or model-judge claims.
const root = join(import.meta.dirname, '..');
const dataset = JSON.parse(await readFile(join(root, 'capstone/model-evaluation-dataset.json'), 'utf8'));
if (!Array.isArray(dataset.cases) || dataset.cases.length < 1 || dataset.cases.length > 4) throw new Error('Select a dataset with 1–4 bounded live cases.');
if (!configured()) throw new Error('OPENAI_API_KEY is not configured.');
const stamp = randomUUID(), directory = join(root, '.lab-data');
await mkdir(directory, { recursive: true });
const store = new WorkspaceStore(join(directory, `model-evaluation-${stamp}.sqlite`));
const runner = new ResearchRunner(store);
const report: any = { recordedAt: new Date().toISOString(), datasetVersion: dataset.version, specificationVersion: dataset.specificationVersion, source: dataset.source, runtime: 'Live Agents API; sources profile', results: [], limitations: ['Quote and rubric checks do not establish semantic entailment; human review of claims remains required.', 'This dataset does not evaluate external tools, hosted skills, deployment, latency or cost budgets.'] };
try {
  const user = store.register(`model-eval-${stamp}@example.test`, `verification-${randomUUID()}`).user.id;
  for (const test of dataset.cases) {
    const workspace = store.createWorkspace(user, test.name);
    for (const document of test.documents) store.upload(user, workspace.id, document.name, document.content);
    const investigation = store.createInvestigation(user, workspace.id, test.question);
    const entry = store.createOperation(user, investigation.id, randomUUID(), test.question, 'live');
    runner.start(user, entry.operation.id, false, false);
    await runner.jobs.get(entry.operation.id)!.done;
    let operation = store.publicOperation(user, entry.operation.id);
    if (operation.status === 'unknown') { try { operation = await runner.inspect(user, entry.operation.id); } catch {} }
    const findings = operation.evidence.findings || [];
    const checks = {
      completed: operation.status === 'completed',
      guidanceRead: (operation.evidence.guidanceReads || []).length > 0,
      scopedSourcesRead: (operation.evidence.tools || []).includes('read_sources'),
      supportedFindings: (operation.evidence.unsupported || []).length === 0,
      requiredQuotes: test.requiredQuotes.every(fragment => findings.some(finding => finding.quote.includes(fragment))),
      missingSupport: !test.expectNoFindings || (findings.length === 0 && (operation.evidence.limitations || []).length > 0),
      limitations: !test.requireLimitations || (operation.evidence.limitations || []).length > 0,
      approvalBoundary: operation.approvals.every(approval => approval.status === 'pending'),
      noUnapprovedWrites: store.snapshot(user, workspace.id).findings.length === 0,
      reportCreated: Boolean(operation.report),
    };
    const result: any = { id: test.id, name: test.name, criteria: test.criteria, outcome: operation.status === 'unknown' ? 'unknown' : Object.values(checks).every(Boolean) ? 'pass' : 'fail', checks, operation, cleanup: 'unknown' };
    const session = store.investigation(user, investigation.id).session_id;
    if (session) { try { const api = researchApi(); if (operation.status === 'unknown') await api.send(session, [{ type: 'agent.session.input.cancel' }]); await api.remove(session); store.setSession(investigation.id, ''); result.cleanup = 'session deleted'; } catch (error) { result.cleanupError = String(error.message).slice(0, 500); } }
    report.results.push(result);
    await writeFile(join(directory, `model-evaluation-${stamp}.json`), JSON.stringify(redact(report), null, 2) + '\n');
    console.log(JSON.stringify({ id: test.id, outcome: result.outcome, checks, cleanup: result.cleanup }));
    // An uncertain creation or cleanup needs reconciliation before creating more work.
    if (result.outcome === 'unknown' || result.cleanup !== 'session deleted') break;
  }
} catch (error) { report.error = String(error.message).slice(0, 1000); }
finally { await runner.shutdown(); store.close(); }
report.outcome = report.error || report.results.some(row => row.outcome === 'unknown') || report.results.length !== dataset.cases.length ? 'unknown' : report.results.every(row => row.outcome === 'pass' && row.cleanup === 'session deleted') ? 'pass' : 'fail';
const output = join(directory, `model-evaluation-${stamp}.json`);
await writeFile(output, JSON.stringify(redact(report), null, 2) + '\n');
console.log(JSON.stringify({ outcome: report.outcome, cases: report.results.length, evidence: output }));
if (report.outcome !== 'pass') process.exitCode = 1;
