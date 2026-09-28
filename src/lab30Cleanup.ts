// Shared lifecycle policy. An artifact download is not proof that a user retained it.
export type CleanupArtifact = { id: string; path: string; size: number; turnId: string };
export type CleanupSnapshot = {
  id: string; status: string; environmentType: string; environmentId: string | null;
  environmentStatus: string; lastActiveAt: number; requiredActions: number;
  turn: { id: string; status: string } | null; artifacts: CleanupArtifact[];
};
export type CleanupDecision = { stoppedInput: boolean; retainedOutputs: boolean; confirmation: string };
export const validSessionId = (id: unknown): id is string => typeof id === 'string' && id.length <= 200 && /^sess_[A-Za-z0-9_-]+$/.test(id);
export const terminalTurn = (status: string) => ['completed', 'failed', 'cancelled'].includes(status);
export function cleanupBlockers(snapshot: CleanupSnapshot, decision: CleanupDecision): string[] {
  const reasons: string[] = [];
  if (snapshot.environmentType !== 'openai_hosted') reasons.push('This lab deletes only OpenAI-hosted sessions.');
  if (!['idle', 'failed'].includes(snapshot.status) || snapshot.requiredActions > 0 || (snapshot.turn && !terminalTurn(snapshot.turn.status))) reasons.push('Work is still active or waiting. Cancel if appropriate, then inspect again.');
  if (['provisioning', 'pending'].includes(snapshot.environmentStatus)) reasons.push('Sandbox setup is still running. Wait and inspect again.');
  if (snapshot.environmentStatus === 'unknown') reasons.push('Environment state could not be verified. Inspect again.');
  if (!decision.stoppedInput) reasons.push('Stop sending new input before cleanup.');
  if (!decision.retainedOutputs) reasons.push('Save needed outputs, or explicitly decide that none are needed.');
  if (decision.confirmation !== snapshot.id) reasons.push('Type the selected session ID to confirm deletion.');
  return reasons;
}
// Re-inspect immediately before each attempt. Reject a changed turn, artifact, or session state.
export function snapshotKey(snapshot: CleanupSnapshot): string {
  return JSON.stringify({ ...snapshot, artifacts: [...snapshot.artifacts].sort((a, b) => a.id.localeCompare(b.id)) });
}
export const retryDelete = (status: number, attempt: number) => status === 409 && attempt < 3;
export const retryDelay = (attempt: number) => 500 * 2 ** (attempt - 1);
export function verificationLabel(status: number): string {
  if (status === 404) return 'Verified: session retrieval returned 404. Physical cleanup may still be in progress.';
  if (status === 200) return 'Verification pending: session is still retrievable. Inspect again.';
  return `Verification inconclusive (${status || 'network error'}). A failed request is not proof of deletion.`;
}
export const practiceSnapshot: CleanupSnapshot = {
  id: 'sess_practice_cleanup', status: 'idle', environmentType: 'openai_hosted', environmentId: 'env_practice',
  environmentStatus: 'connected', lastActiveAt: 1_800_000_000, requiredActions: 0,
  turn: { id: 'turn_practice', status: 'completed' },
  artifacts: [{ id: 'artifact_practice', path: '/workspace/outputs/report.md', size: 37, turnId: 'turn_practice' }],
};
export const practiceReport = '# Lab 30 report\nTotal enrollment: 30.\n';
