import { cleanupBlockers, retryDelay, retryDelete, snapshotKey, verificationLabel, type CleanupDecision, type CleanupSnapshot } from '../src/lab30Cleanup.ts';

export class CleanupError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type CleanupApi = {
  inspect: (id: string) => Promise<CleanupSnapshot>;
  delete: (id: string) => Promise<{ deleted: boolean }>;
  retrieve: (id: string) => Promise<unknown>;
};
export const errorStatus = (error: unknown) => typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 0;
export async function verifyCleanup(api: Pick<CleanupApi, 'retrieve'>, id: string) {
  let status = 200;
  try { await api.retrieve(id); } catch (error) { status = errorStatus(error); }
  return { status, verified: status === 404, message: verificationLabel(status) };
}
export async function executeCleanup(api: CleanupApi, inspected: CleanupSnapshot, decision: CleanupDecision, pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  const trace: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const fresh = await api.inspect(inspected.id);
    const blockers = cleanupBlockers(fresh, decision);
    if (blockers.length) throw new CleanupError(409, blockers.join(' '));
    if (snapshotKey(fresh) !== snapshotKey(inspected)) throw new CleanupError(409, 'The session changed since inspection. Inspect again and review its outputs.');
    try {
      const result = await api.delete(inspected.id);
      if (result.deleted !== true) throw new CleanupError(502, 'The API did not confirm deletion.');
      trace.push(`Attempt ${attempt}: API confirmed deletion.`);
      return { id: inspected.id, deleted: true, attempts: attempt, trace, verification: await verifyCleanup(api, inspected.id), at: new Date().toISOString() };
    } catch (error) {
      if (!retryDelete(errorStatus(error), attempt)) throw error;
      trace.push(`Attempt ${attempt}: 409 conflict; recheck after ${retryDelay(attempt)} ms.`);
      await pause(retryDelay(attempt));
    }
  }
  throw new CleanupError(409, 'Cleanup retry limit reached. Inspect again.');
}
