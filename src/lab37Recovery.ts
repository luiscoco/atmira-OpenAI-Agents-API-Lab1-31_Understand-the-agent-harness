export type RecoveryState = { source: string; sessionId: string | null; environmentId: string | null; inputAttempts: number; reconnects: number; outcome: string; phase: string; log: string[]; cleanup: string; answer: string; error: string | null };
export function recoveryDecision(status: string, outcome: string, attempts: number) {
  if (['completed', 'failed', 'cancelled'].includes(outcome)) return 'inspect-result';
  if (['expired', 'failed'].includes(status)) return 'new-run';
  if (attempts >= 1) return 'stop-and-cleanup';
  if (status === 'disconnected' || status === 'pending') return 'reconnect-environment';
  if (status === 'connected') return 'reattach-stream';
  return 'inspect-state';
}
export const recoveryCases = [
  { id: 'stream', title: 'Observation stream closes; same session continues', status: 'connected', outcome: 'unknown', attempts: 0 },
  { id: 'disconnect', title: 'Executor disconnects; reconnect once', status: 'disconnected', outcome: 'unknown', attempts: 0 },
  { id: 'setup', title: 'Setup failed; correct configuration and start a new run', status: 'failed', outcome: 'unknown', attempts: 0 },
  { id: 'completed', title: 'Saved root already completed; inspect its result', status: 'disconnected', outcome: 'completed', attempts: 0 },
  { id: 'budget', title: 'Second loss; stop after the retry budget', status: 'disconnected', outcome: 'unknown', attempts: 1 },
];
export function recoveryPractice(id: string): RecoveryState {
  const row = recoveryCases.find(row => row.id === id) ?? recoveryCases[0]; const action = recoveryDecision(row.status, row.outcome, row.attempts);
  return { source: 'synthetic practice', sessionId: 'sess_practice', environmentId: 'env_practice', inputAttempts: 1, reconnects: action.startsWith('re') ? 1 : row.attempts, outcome: row.outcome, phase: action, log: ['Store session/environment/container mapping', `Inspect saved state: ${row.status}, ${row.outcome}`, action, 'Never blindly resubmit input'], cleanup: 'confirmed', answer: '', error: null };
}
export function verifyRecovery(state: RecoveryState) {
  return [{ name: 'Session and environment mapping retained', passed: Boolean(state.sessionId && state.environmentId) }, { name: 'Input submitted at most once', passed: state.inputAttempts <= 1 }, { name: 'Recovery budget bounded to one attempt', passed: state.reconnects <= 1 }, { name: 'Saved state inspected before recovery', passed: state.log.some(line => line.startsWith('Inspect saved state')) }, { name: 'Cleanup confirmed', passed: state.cleanup === 'confirmed' }];
}
