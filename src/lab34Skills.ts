import { newExecutorTrace, type ExecutorTrace } from './lab32Environment.ts';
export const skillImage = 'agents-lab34-executor:local';
export const capabilityDirectory = '/opt/lab34/skills';
export const skillDirectory = `${capabilityDirectory}/course-sales-report`;
export type SkillTask = 'revenue' | 'unrelated';
export type SkillEvidence = { task: SkillTask; registered: boolean; trace: ExecutorTrace };
export function skillEnvironment(registered: boolean) {
  return { type: 'self_hosted' as const, workspace_directory: '/workspace', capability_directories: registered ? [capabilityDirectory] : [] };
}
export function checkCapabilityPaths(paths: string[]) {
  return paths.length <= 32 && paths.every(path => typeof path === 'string' && path.startsWith('/') && !path.includes('\\') && !path.split('/').some(part => part === '.' || part === '..')) && new Set(paths.map(path => path.replace(/\/+$/, '').replace(/\/+/g, '/'))).size === paths.length;
}
export function inspectManifest(text: string) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
  const name = /^name:[ \t]*([a-z0-9-]+)[ \t]*$/m.exec(front?.[1] ?? '')?.[1] ?? '';
  const description = /^description:[ \t]*(.+)$/m.exec(front?.[1] ?? '')?.[1]?.trim() ?? '';
  return { name, description, checks: [
    { name: 'YAML front matter followed by instructions', passed: Boolean(front?.[2]?.trim()) },
    { name: 'Name uses lowercase letters, digits and single hyphens (max 64)', passed: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64 },
    { name: 'Single-line discovery description (max 1024)', passed: Boolean(description) && description.length <= 1024 },
  ] };
}
export function revenueTotal(nonce: string) {
  if (!/^[a-f0-9]{16}$/.test(nonce)) throw new Error('Invalid run marker.');
  return (parseInt(nonce.slice(0, 2), 16) % 9 + 1) * 1200 + 8 * 200;
}
export function skillPrompt(task: SkillTask) {
  return task === 'revenue' ? 'Summarize revenue from /workspace/data/sales.csv. Read /workspace/run-marker.txt. Return only JSON with total_cents (integer), currency (EUR), source (data/sales.csv), and marker (trimmed run-marker contents). Do not change input files.' : 'In one sentence, explain the difference between a Python tuple and a list.';
}
function successful(trace: ExecutorTrace) { return trace.commands.filter(command => command.exitCode === 0); }
export function skillObservations(trace: ExecutorTrace) {
  const commands = successful(trace);
  return {
    manifestRead: commands.some(command => /(?:cat|head|sed|read|Get-Content)\b/.test(command.command) && command.command.includes('SKILL.md') && (command.command.includes('course-sales-report') || command.cwd?.includes('course-sales-report')) && command.output?.includes('LAB34_SKILL_READ')),
    referenceRead: commands.some(command => /(?:cat|head|sed|read|Get-Content)\b/.test(command.command) && command.command.includes('report-contract.md') && command.output?.includes('LAB34_REFERENCE_READ')),
    helperRun: commands.some(command => /\bnode\s/.test(command.command) && command.command.includes('report.mjs') && command.output?.split('\n').some(line => { try { const report = JSON.parse(line); return report?.marker === trace.nonce && report?.total_cents === revenueTotal(trace.nonce); } catch { return false; } })),
    anyUse: trace.commands.some(command => /course-sales-report|SKILL\.md|report-contract\.md|report\.mjs/.test(command.command)),
  };
}
export function verifySkillEvidence(evidence: SkillEvidence) {
  const { trace, task, registered } = evidence; const observed = skillObservations(trace);
  let report: Record<string, unknown> = {};
  try { report = JSON.parse(trace.answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* Failed report below. */ }
  const checks = [
    { name: 'Connected before task input', passed: trace.inputSent && trace.inputMs !== null && trace.events.some(event => event.name === 'agent.session.environment.connected' && event.ms <= trace.inputMs!) },
    { name: 'Completed root turn observed', passed: trace.outcome === 'completed' },
  ];
  if (task === 'revenue') checks.push(
    { name: 'Standalone capability directory registered', passed: registered },
    { name: 'Successful command read SKILL.md and its marker', passed: observed.manifestRead },
    { name: 'Successful command read the supporting reference', passed: observed.referenceRead },
    { name: 'Bundled helper produced the independent total and run marker', passed: observed.helperRun },
    { name: 'Final report matches exact cents, source and fresh marker', passed: Boolean(report && typeof report === 'object') && report.total_cents === revenueTotal(trace.nonce) && report.currency === 'EUR' && report.source === 'data/sales.csv' && report.marker === trace.nonce },
  );
  else checks.push({ name: 'No skill read or helper use observed for unrelated question', passed: trace.outcome === 'completed' && !observed.anyUse }, { name: 'Unrelated answer supplied', passed: /tuple/i.test(trace.answer) && /list/i.test(trace.answer) });
  checks.push({ name: 'Container removal confirmed', passed: trace.cleanup === 'removed' });
  return checks;
}
export function skillPractice(kind: 'revenue' | 'unrelated' | 'guessed' | 'overuse' | 'unregistered'): SkillEvidence {
  const trace = newExecutorTrace('a1b2c3d4e5f60718', 'synthetic practice');
  trace.connection = 'connected'; trace.inputSent = true; trace.inputMs = 5; trace.events = [{ name: 'agent.session.environment.connected', ms: 2 }]; trace.outcome = 'completed'; trace.cleanup = 'removed';
  const command = (id: string, command: string, output: string) => ({ id, command, output, cwd: '/workspace', exitCode: 0, durationMs: 1, status: 'completed' });
  const report = JSON.stringify({ total_cents: revenueTotal(trace.nonce), currency: 'EUR', source: 'data/sales.csv', marker: trace.nonce });
  if (['revenue', 'overuse'].includes(kind)) trace.commands = [command('manifest', `cat ${skillDirectory}/SKILL.md`, 'LAB34_SKILL_READ'), command('reference', `cat ${skillDirectory}/references/report-contract.md`, 'LAB34_REFERENCE_READ'), command('helper', `node ${skillDirectory}/scripts/report.mjs /workspace/data/sales.csv /workspace/run-marker.txt`, report)];
  trace.answer = ['unrelated', 'overuse'].includes(kind) ? 'A tuple is immutable, while a list is mutable.' : report;
  return { task: ['unrelated', 'overuse'].includes(kind) ? 'unrelated' : 'revenue', registered: kind !== 'unregistered', trace };
}
export const skillCases = [
  { id: 'revenue' as const, title: 'Relevant task: read and executed' },
  { id: 'unrelated' as const, title: 'Unrelated task: no observed activation' },
  { id: 'guessed' as const, title: 'Correct JSON without skill evidence' },
  { id: 'overuse' as const, title: 'Unnecessary activation for unrelated task' },
  { id: 'unregistered' as const, title: 'Skill files exist but parent is unregistered' },
];
