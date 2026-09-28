import { cleanupBlockers, practiceSnapshot, retryDelete, snapshotKey, validSessionId, verificationLabel, type CleanupDecision } from './lab30Cleanup.ts';
const decision: CleanupDecision = { stoppedInput: true, retainedOutputs: true, confirmation: practiceSnapshot.id };
export const cleanupTests: Array<{ name: string; run: () => boolean }> = [
  { name: 'Completed hosted session can be deleted after retention and confirmation', run: () => cleanupBlockers(practiceSnapshot, decision).length === 0 },
  ...['in_progress', 'requires_action', 'unknown'].map(status => ({ name: `Block session status ${status}`, run: () => cleanupBlockers({ ...practiceSnapshot, status }, decision).length > 0 })),
  ...['queued', 'in_progress', 'waiting'].map(status => ({ name: `Block latest turn ${status}`, run: () => cleanupBlockers({ ...practiceSnapshot, turn: { id: 'turn_new', status } }, decision).length > 0 })),
  ...['completed', 'cancelled', 'failed'].map(status => ({ name: `Accept terminal turn ${status}`, run: () => cleanupBlockers({ ...practiceSnapshot, turn: { id: 'turn_done', status } }, decision).length === 0 })),
  ...['provisioning', 'pending', 'unknown'].map(environmentStatus => ({ name: `Block environment ${environmentStatus}`, run: () => cleanupBlockers({ ...practiceSnapshot, environmentStatus }, decision).length > 0 })),
  { name: 'Pending required action blocks cleanup even if idle', run: () => cleanupBlockers({ ...practiceSnapshot, requiredActions: 1 }, decision).length > 0 },
  { name: 'Self-hosted compute is outside this lab', run: () => cleanupBlockers({ ...practiceSnapshot, environmentType: 'self_hosted' }, decision).length > 0 },
  { name: 'Retention acknowledgement is mandatory', run: () => cleanupBlockers(practiceSnapshot, { ...decision, retainedOutputs: false }).length > 0 },
  { name: 'New input must be stopped', run: () => cleanupBlockers(practiceSnapshot, { ...decision, stoppedInput: false }).length > 0 },
  { name: 'Wrong session confirmation rejected', run: () => cleanupBlockers(practiceSnapshot, { ...decision, confirmation: 'sess_other' }).length > 0 },
  { name: 'New artifact invalidates inspected snapshot', run: () => snapshotKey(practiceSnapshot) !== snapshotKey({ ...practiceSnapshot, artifacts: [] }) },
  { name: 'New turn invalidates inspected snapshot', run: () => snapshotKey(practiceSnapshot) !== snapshotKey({ ...practiceSnapshot, turn: { id: 'turn_new', status: 'completed' } }) },
  { name: '409 retries stop after three attempts', run: () => retryDelete(409, 1) && retryDelete(409, 2) && !retryDelete(409, 3) },
  { name: 'Authentication and server errors are not conflict retries', run: () => !retryDelete(401, 1) && !retryDelete(500, 1) },
  { name: 'Only 404 verifies absence', run: () => verificationLabel(404).startsWith('Verified:') && !verificationLabel(403).startsWith('Verified:') && !verificationLabel(0).startsWith('Verified:') },
  { name: 'Session IDs are validated', run: () => validSessionId('sess_abc-123') && !validSessionId('../secrets') && !validSessionId(null) },
];
export function runCleanupSuite() {
  return cleanupTests.map(test => { try { return { name: test.name, passed: test.run() }; } catch { return { name: test.name, passed: false }; } });
}
