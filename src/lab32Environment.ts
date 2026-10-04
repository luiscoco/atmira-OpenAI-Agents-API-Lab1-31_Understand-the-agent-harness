import { parseCommand, type CommandRun } from './lab26Environment.ts';

export const executorImage = 'agents-lab32-executor:local';
export const environmentRequest = { type: 'self_hosted' as const, workspace_directory: '/workspace' };
export type Connection = 'pending' | 'connected' | 'disconnected' | 'failed';
export type ExecutorTrace = {
  source: 'synthetic practice' | 'live'; sessionId: string | null; environmentId: string | null;
  nonce: string; connection: Connection; inputSent: boolean; inputMs: number | null; outcome: string;
  events: { name: string; ms: number }[]; commands: CommandRun[]; answer: string;
  cleanup: 'not started' | 'removed' | 'failed'; error: string | null;
};
export function fixtureFiles(nonce: string) {
  if (!/^[a-f0-9]{16}$/.test(nonce)) throw new Error('Invalid fixture nonce.');
  return ['.course-marker', 'brief.txt', 'data/sales.csv', `run-${nonce}.txt`];
}
export function listingPrompt(nonce: string) {
  fixtureFiles(nonce);
  return 'Use a shell command to list all regular files recursively under /workspace, including hidden files. ' +
    'Read the run-*.txt file. Do not create or change files. Return only JSON with files (sorted relative paths) ' +
    'and nonce (the exact file contents, trimmed). Do not guess from the prompt.';
}
export function newExecutorTrace(nonce: string, source: ExecutorTrace['source'] = 'live'): ExecutorTrace {
  fixtureFiles(nonce);
  return { source, sessionId: null, environmentId: null, nonce, connection: 'pending', inputSent: false, inputMs: null,
    outcome: 'unknown', events: [], commands: [], answer: '', cleanup: 'not started', error: null };
}
export function connectionEvent(name: string): Connection | null {
  const match = /^agent\.session\.environment\.(pending|connected|disconnected|failed)$/.exec(name);
  return match ? match[1] as Connection : null;
}
export function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
export function applyExecutorEvent(trace: ExecutorTrace, raw: unknown, ms: number) {
  const event = object(raw); const name = String(event.type ?? 'unknown');
  if (!name.endsWith('.delta') && trace.events.length < 500) trace.events.push({ name, ms });
  const connection = connectionEvent(name); if (connection) trace.connection = connection;
  if (name === 'agent.session.environment.failed') { trace.error = 'Environment connection failed. Check the restricted key and executor version.'; }
  if (name === 'agent.session.turn.item.done' && object(event.item).type === 'command_execution' && object(event.item).subagent_id == null) {
    const command = parseCommand(event.item);
    command.output = command.output?.slice(0, 32_000) ?? null;
    const index = trace.commands.findIndex(row => row.id === command.id);
    if (index >= 0) trace.commands[index] = command; else if (trace.commands.length < 100) trace.commands.push(command);
  }
  if (/^agent\.session\.turn\.(completed|failed|cancelled)$/.test(name) && event.turn && event.turn.subagent_id == null) {
    trace.outcome = name.split('.').at(-1)!;
    if (trace.outcome === 'failed') trace.error = 'The root turn failed. Inspect the recorded event names and saved session.';
  }
  if (name === 'error' || name === 'agent.session.failed') { trace.error = 'The API reported a session error. A root-turn outcome was not established.'; }
}
export function verifyListing(trace: ExecutorTrace) {
  const expected = fixtureFiles(trace.nonce);
  let report: Record<string, any> = {};
  try { report = object(JSON.parse(trace.answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))); } catch { /* Invalid JSON is a failed evidence check. */ }
  const files = Array.isArray(report.files) && report.files.every((file: unknown) => typeof file === 'string') ? report.files : [];
  const output = trace.commands.filter(command => command.exitCode === 0).map(command => command.output ?? '').join('\n');
  return [
    { name: 'Executor connected before input', passed: trace.inputSent && trace.inputMs !== null && trace.events.some(event => event.name === 'agent.session.environment.connected' && event.ms <= trace.inputMs!) },
    { name: 'Root turn completed', passed: trace.outcome === 'completed' },
    { name: 'Successful command output contains every fixture file and nonce', passed: expected.every(file => output.includes(file)) && output.includes(trace.nonce) },
    { name: 'Answer matches the exact sorted file inventory', passed: JSON.stringify(files) === JSON.stringify(expected) },
    { name: 'Answer contains the nonce read from the sandbox', passed: report.nonce === trace.nonce },
    { name: 'Disposable container removal confirmed', passed: trace.cleanup === 'removed' },
  ];
}
export function executorEvidence(trace: ExecutorTrace, notes: string) {
  return `# Lab 32 — Self-hosted environment\n\nSource: ${trace.source}\nSession: ${trace.sessionId ?? 'practice'}\nEnvironment: ${trace.environmentId ?? 'practice'}\n\n${verifyListing(trace).map(check => `- ${check.passed ? 'PASS' : 'FAIL'}: ${check.name}`).join('\n')}\n\n## Observed trace\n\n\`\`\`json\n${JSON.stringify(trace, null, 2)}\n\`\`\`\n\n## Student explanation\n\n${notes}\n\nSynthetic practice is not live API evidence. Docker removal and API session deletion are separate operations. No host project directory is mounted; outbound networking remains available.\n`;
}
