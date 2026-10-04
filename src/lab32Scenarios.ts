import { applyExecutorEvent, newExecutorTrace, fixtureFiles, type ExecutorTrace } from './lab32Environment.ts';
const nonce = 'a1b2c3d4e5f60718';
function practice(kind: string): ExecutorTrace {
  const trace = newExecutorTrace(nonce, 'synthetic practice');
  const event = (type: string, fields = {}) => applyExecutorEvent(trace, { type, ...fields }, trace.events.length * 250);
  event('agent.session.environment.pending');
  if (kind === 'pending') return trace;
  if (kind === 'failed') { event('agent.session.environment.failed'); trace.cleanup = 'removed'; return trace; }
  event('agent.session.environment.connected'); trace.inputSent = true; trace.inputMs = trace.events.length * 250;
  if (kind === 'disconnected') { event('agent.session.environment.disconnected'); trace.error = 'Connection lost; no completed root turn was observed.'; trace.cleanup = 'removed'; return trace; }
  const files = fixtureFiles(nonce);
  if (kind !== 'guessed') event('agent.session.turn.item.done', { item: { type: 'command_execution', id: 'cmd_practice', command: 'find /workspace -type f; cat /workspace/run-*.txt', cwd: '/workspace', exit_code: 0, output: files.join('\n') + '\n' + nonce } });
  event('agent.session.turn.completed', { turn: { id: 'turn_practice', subagent_id: null } });
  trace.answer = JSON.stringify({ files, nonce }, null, 2); trace.cleanup = kind === 'cleanup' ? 'failed' : 'removed';
  if (kind === 'cleanup') trace.error = 'Container removal was not confirmed. Operator intervention is required.';
  return trace;
}
export const executorScenarios = [
  { id: 'success', title: 'Connected and verified', explanation: 'A successful command lists the generated files and reads the nonce; the answer matches.', trace: practice('success') },
  { id: 'pending', title: 'Waiting for an executor', explanation: 'Session creation alone does not connect compute or send the task.', trace: practice('pending') },
  { id: 'failed', title: 'Executor authentication failure', explanation: 'A failed connection stops the run before input is sent. Check the key owner, project, and permissions.', trace: practice('failed') },
  { id: 'disconnected', title: 'Connection lost', explanation: 'A disconnect does not establish a turn outcome. This lab stops rather than resending input.', trace: practice('disconnected') },
  { id: 'guessed', title: 'Correct answer without command evidence', explanation: 'Matching JSON alone does not prove that the agent used your filesystem.', trace: practice('guessed') },
  { id: 'cleanup', title: 'Unconfirmed container cleanup', explanation: 'A correct task can still leave cleanup incomplete. API deletion does not remove your compute.', trace: practice('cleanup') },
];
