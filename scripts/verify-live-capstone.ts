import '../server/env.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore } from '../server/capstoneStore.ts';
import { ResearchRunner, researchApi } from '../server/capstoneRunner.ts';
import { researchProfile } from '../server/capstoneIntegrations.ts';
import { configured, redact } from '../server/courseLabHttp.ts';

const profile = researchProfile(process.argv[2] || 'connected');
const directory = join(import.meta.dirname, '..', '.lab-data'); await mkdir(directory, { recursive: true });
const stamp = randomUUID(); const store = new WorkspaceStore(join(directory, `live-verification-${stamp}.sqlite`));
const report: any = { recordedAt: new Date().toISOString(), runtime: 'live Agents API', profile, outcome: 'unknown', checks: {}, cleanup: 'unknown' };
report.apiSteps = [];
const runner = new ResearchRunner(store, () => { const api = researchApi(); return Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, async (...args: any[]) => { report.apiSteps.push({ action: name, phase: 'started', time: new Date().toISOString() }); try { const result = await (fn as any)(...args); report.apiSteps.push({ action: name, phase: 'returned', time: new Date().toISOString() }); return result; } catch (error) { report.apiSteps.push({ action: name, phase: 'failed', status: error.status, message: redact(String(error.message).slice(0, 1000)) }); throw error; } }])) as any; });
try {
  if (!configured()) throw new Error('OPENAI_API_KEY is not configured.');
  const user = store.register(`live-${stamp}@example.test`, `verification-${randomUUID()}`).user.id;
  const workspace = store.createWorkspace(user, 'Labelled integration verification');
  store.upload(user, workspace.id, 'release.md', 'The course workspace preserves uploaded sources and requires owner approval before saving findings.');
  const question = 'Explain how Agents API web search and MCP differ. Read the workspace source, use the built-in web_search tool (not just MCP search), and fetch a page using openai_docs. Return one document finding and one external finding with a single short exact source quote under 200 characters from the fetched page. Preserve literal punctuation. If native skills are available, read grounded-research and report-review and inspect the staged source.';
  const investigation = store.createInvestigation(user, workspace.id, question);
  const entry = store.createOperation(user, investigation.id, randomUUID(), question, 'live', { delegation: false, failure: false, profile });
  runner.start(user, entry.operation.id, false, false); await runner.jobs.get(entry.operation.id)!.done;
  let operation = store.publicOperation(user, entry.operation.id);
  if (operation.status === 'unknown' && store.investigation(user, investigation.id).session_id) { try { operation = await runner.inspect(user, entry.operation.id); } catch {} }
  report.operation = operation;
  report.checks = {
    completed: operation.status === 'completed',
    documentCitation: operation.approvals.length > 0,
    webSearch: (operation.evidence.integrationCalls || []).some(row => row.type === 'web_search_call' && row.status === 'completed'),
    mcp: (operation.evidence.integrationCalls || []).some(row => row.type === 'mcp_call' && row.status === 'completed' && !row.failed),
    externalCitation: (operation.evidence.externalFindings || []).some(row => row.quoteVerified),
    ...(profile === 'hosted' ? { stagedRead: Boolean(operation.evidence.native?.stagedReads?.length), researchSkill: Boolean(operation.evidence.native?.skillReads?.some(row => /grounded-research/.test(JSON.stringify(row.command)))), reviewSkill: Boolean(operation.evidence.native?.skillReads?.some(row => /report-review/.test(JSON.stringify(row.command)))) } : {}),
  };
  report.outcome = operation.status === 'unknown' ? 'unknown' : Object.values(report.checks).every(Boolean) ? 'pass' : 'fail';
  // Clean only the session created by this labelled verification. Keep evidence/SQLite locally.
  const session = store.investigation(user, investigation.id).session_id;
  if (session) { try { const api = researchApi(); if (operation.status === 'unknown') await api.send(session, [{ type: 'agent.session.input.cancel' }]); await api.remove(session); report.cleanup = 'session deleted'; } catch { report.cleanup = 'Session cleanup failed; reconcile retained verification database.'; } }
  else if (operation.status === 'failed' && operation.evidence.apiError?.status >= 400 && operation.evidence.apiError?.status < 500) report.cleanup = 'creation rejected; no session created';
} catch (error) { report.error = error.message; report.outcome = 'unknown'; }
finally {
  await runner.shutdown(); store.close();
  const path = join(directory, `live-${profile}-${stamp}.json`); await writeFile(path, JSON.stringify(redact(report), null, 2));
  console.log(JSON.stringify({ profile, outcome: report.outcome, checks: report.checks, cleanup: report.cleanup, evidence: path }));
  if (report.outcome !== 'pass' || report.cleanup !== 'session deleted') process.exitCode = 1;
}
