const pathKey = (value: unknown) => typeof value === 'string' ? value.replaceAll('\\', '/').replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`) : '';
export function parseEvidenceLines(text: string): any[] {
  if (text.length > 2000000) throw new Error('Evidence exceeds the 2 MB import limit.');
  const rows = text.trim() ? text.trim().split(/\r?\n/).map(line => JSON.parse(line)) : [];
  if (rows.length > 10000) throw new Error('Evidence exceeds the event limit.');
  return rows;
}
// Imported files are corroboration, never authenticated proof of native execution.
export function reviewNativeHookEvidence(ledger: any[], notifications: any[], configPath: string, reportPath: string) {
  if (!Array.isArray(ledger) || !Array.isArray(notifications) || ledger.length > 10000 || notifications.length > 10000) throw new Error('Supply bounded ledger and notification arrays.');
  const hooks = notifications.filter(row => row?.method === 'hook/completed' && typeof row.params?.threadId === 'string' && row.params?.run);
  const edits = notifications.filter(row => row?.method === 'item/completed' && row.params?.item?.type === 'fileChange' && row.params.item.status === 'completed');
  const usedRuns = new Set<string>(), usedCalls = new Set<string>();
  const observations = ledger.filter(row => row?.event === 'PostToolUse').map(row => {
    const key = `${row.sessionId}:${row.turnId}:${row.toolUseId}`;
    const timestamp = Date.parse(row.recordedAt);
    const identified = typeof row.sessionId === 'string' && row.sessionId.length > 0 && typeof row.turnId === 'string' && row.turnId.length > 0 && typeof row.toolUseId === 'string' && row.toolUseId.length > 0 && ['apply_patch', 'Edit', 'Write'].includes(row.tool) && typeof row.passed === 'boolean' && Number.isFinite(timestamp);
    const edit = identified && edits.find(event => event.params.threadId === row.sessionId && event.params.turnId === row.turnId && event.params.item.id === row.toolUseId && Array.isArray(event.params.item.changes) && event.params.item.changes.some(change => pathKey(change?.path) === pathKey(reportPath)));
    const hook = identified && hooks.find(event => {
      const run = event.params?.run;
      const expectedText = row.passed ? 'Report validation passed: header and total.' : 'Report must contain the Release report header and Total: 2800.';
      return event.params.threadId === row.sessionId && event.params.turnId === row.turnId && run?.eventName === 'postToolUse' && run.handlerType === 'command' && run.executionMode === 'sync' && run.source === 'project' && pathKey(run.sourcePath) === pathKey(configPath) && typeof run.id === 'string' && !usedRuns.has(run.id) && Number.isSafeInteger(run.startedAt) && Number.isSafeInteger(run.completedAt) && run.startedAt <= timestamp && timestamp <= run.completedAt && (row.passed ? run.status === 'completed' : ['blocked', 'failed'].includes(run.status)) && Array.isArray(run.entries) && run.entries.some(entry => typeof entry?.text === 'string' && entry.text.includes(expectedText));
    });
    const matched = Boolean(edit && hook && !usedCalls.has(key));
    if (matched) { usedRuns.add(hook.params.run.id); usedCalls.add(key); }
    return { sessionId: row.sessionId || null, turnId: row.turnId || null, toolUseId: row.toolUseId || null, passed: row.passed, matched, reason: matched ? 'Ledger, completed report edit and synchronous project hook agree.' : 'Missing, duplicate or mismatched runtime edit/hook evidence.' };
  });
  const passObserved = observations.some(row => row.matched && row.passed === true), failureObserved = observations.some(row => row.matched && row.passed === false);
  return { source: 'Imported hook ledger and Codex app-server notifications', outcome: passObserved && failureObserved ? 'consistent' : 'incomplete', passObserved, failureObserved, observations, limitation: 'Imported evidence can be edited. Review the original runtime trace and exact trusted hook definition; this assessment does not authenticate native dispatch.' };
}
