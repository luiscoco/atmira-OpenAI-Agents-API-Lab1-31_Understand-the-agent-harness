import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardedCsv, guardedRules, proposalChecks, simpleDiff } from '../src/lab38Guard.ts';
export type GuardWorkspace = { id: string; directory: string; marker: string; before: string; proposal: null | { id: string; path: string; content: string; baseHash: string; status: 'pending' | 'approved' | 'rejected'; diff: string }; audit: Array<{ tool: string; arguments: unknown; success: boolean; result: unknown }>; busy: boolean; closed: boolean; source: string; trace?: any };
export const hashContent = (text: string) => createHash('sha256').update(text).digest('hex');
export async function createGuardWorkspace(): Promise<GuardWorkspace> {
  const directory = await mkdtemp(join(tmpdir(), 'agents-lab38-')); const marker = randomBytes(8).toString('hex'); const before = '# Revenue report\n\nAwaiting calculation.\n';
  await Promise.all([writeFile(join(directory, 'AGENTS.md'), guardedRules), writeFile(join(directory, 'sales.csv'), guardedCsv), writeFile(join(directory, 'report.md'), before), writeFile(join(directory, 'marker.txt'), marker)]);
  return { id: randomUUID(), directory, marker, before, proposal: null, audit: [], busy: false, closed: false, source: 'application tool broker' };
}
export async function guardResources() { return Promise.all(['SKILL.md', 'references/report-contract.md'].map(async path => ({ path, content: await readFile(new URL(`../sandbox/lab34/skills/course-sales-report/${path}`, import.meta.url), 'utf8') }))); }
async function calculate(workspace: GuardWorkspace) {
  const script = fileURLToPath(new URL('../sandbox/lab34/skills/course-sales-report/scripts/report.mjs', import.meta.url));
  const output = await new Promise<string>((resolve, reject) => execFile(process.execPath, [script, join(workspace.directory, 'sales.csv'), join(workspace.directory, 'marker.txt')], { timeout: 5000, maxBuffer: 16000, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  const result = JSON.parse(output); if (result.total_cents !== 2800 || result.marker !== workspace.marker) throw new Error('Fixture helper result mismatch'); return result;
}
export async function executeGuardTool(workspace: GuardWorkspace, tool: string, args: any) {
  let result: any; let success = false;
  try {
    if (workspace.closed || workspace.audit.length >= 20) throw new Error('Workspace closed or tool budget exhausted');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Object arguments required');
    if (tool === 'read_workspace') {
      if (Object.keys(args).length !== 1 || !['AGENTS.md', 'sales.csv', 'report.md'].includes(args.path)) throw new Error('ACCESS_DENIED: only the three fixed workspace files may be read');
      result = { path: args.path, content: await readFile(join(workspace.directory, args.path), 'utf8') };
    } else if (tool === 'calculate_revenue') { if (Object.keys(args).length) throw new Error('No arguments allowed'); result = await calculate(workspace); }
    else if (tool === 'propose_report') {
      if (Object.keys(args).length !== 1 || !proposalChecks({ path: 'report.md', content: args.content }).every(row => row.passed)) throw new Error('Invalid report proposal');
      if (workspace.proposal?.status === 'pending') throw new Error('Review the pending proposal first');
      const before = await readFile(join(workspace.directory, 'report.md'), 'utf8');
      workspace.proposal = { id: randomUUID(), path: 'report.md', content: args.content, baseHash: hashContent(before), status: 'pending', diff: simpleDiff(before, args.content) };
      result = { proposalId: workspace.proposal.id, status: 'pending', fileChanged: false };
    } else throw new Error('TOOL_DENIED: unknown tool');
    success = true;
  } catch (error) { result = { error: String((error as Error).message) }; }
  if (workspace.audit.length < 21) workspace.audit.push({ tool, arguments: args, success, result }); return { success, result };
}
export async function reviewGuardProposal(workspace: GuardWorkspace, id: string, decision: 'approve' | 'reject') {
  const proposal = workspace.proposal;
  if (workspace.busy || workspace.closed || !proposal || proposal.id !== id || proposal.status !== 'pending') throw new Error('No matching pending proposal, or workspace is busy');
  workspace.busy = true;
  try {
    if (decision === 'reject') { proposal.status = 'rejected'; return; }
    const current = await readFile(join(workspace.directory, 'report.md'), 'utf8');
    if (hashContent(current) !== proposal.baseHash) throw new Error('STALE_PROPOSAL: review a new diff against the current content');
    if (!proposalChecks(proposal).every(row => row.passed)) throw new Error('Invalid proposal');
    await writeFile(join(workspace.directory, 'report.next'), proposal.content); await rename(join(workspace.directory, 'report.next'), join(workspace.directory, 'report.md')); proposal.status = 'approved';
  } finally { workspace.busy = false; }
}
export async function guardView(workspace: GuardWorkspace) { return { id: workspace.id, source: workspace.source, before: workspace.before, current: await readFile(join(workspace.directory, 'report.md'), 'utf8'), proposal: workspace.proposal, audit: workspace.audit, trace: workspace.trace ?? null, checks: proposalChecks(workspace.proposal), protectedAccessDenied: workspace.audit.some(row => row.tool === 'read_workspace' && !row.success && (row.result as any)?.error?.startsWith('ACCESS_DENIED')) }; }
export async function disposeGuard(workspace: GuardWorkspace) {
  const target = resolve(workspace.directory);
  if (dirname(target).toLowerCase() !== resolve(tmpdir()).toLowerCase() || !/^agents-lab38-[a-zA-Z0-9]+$/.test(basename(target))) throw new Error('Unexpected disposable workspace cleanup target');
  workspace.closed = true; await rm(target, { recursive: true, force: true });
}
