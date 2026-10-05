import { privateMcpPractice, privateMcpTool, verifyPrivateMcp } from './lab36Mcp.ts';
import { recoveryCases, recoveryDecision, recoveryPractice, verifyRecovery } from './lab37Recovery.ts';
import { guardedReport, proposalChecks, simpleDiff } from './lab38Guard.ts';
import { applyDelegationEvent, childOverlap, delegationPractice, delegationRequest, newDelegationTrace, verifyDelegation } from './lab39Delegation.ts';
import { runOperationsSuite } from './operationsLabRules.ts';
export function runAdvancedSuite(lab: number) {
  if (lab >= 41 && lab <= 50) return runOperationsSuite(lab);
  const checks: Array<{ name: string; run: () => boolean }> = [];
  if (lab === 36) {
    for (const kind of ['success', 'service', 'claim', 'stale']) checks.push({ name: `Private MCP evidence: ${kind}`, run: () => verifyPrivateMcp(privateMcpPractice(kind)).every(row => row.passed) === (kind === 'success') });
    checks.push({ name: 'MCP scope is a fixed read-only tool and loopback endpoint', run: () => privateMcpTool().connection_origin === 'environment' && privateMcpTool().allowed_tools.join() === 'get_inventory' && privateMcpTool().transport.server_url === 'http://127.0.0.1:8765/mcp' });
  } else if (lab === 37) {
    const expected = ['reattach-stream', 'reconnect-environment', 'new-run', 'inspect-result', 'stop-and-cleanup'];
    recoveryCases.forEach((row, index) => checks.push({ name: row.title, run: () => recoveryDecision(row.status, row.outcome, row.attempts) === expected[index] && verifyRecovery(recoveryPractice(row.id)).every(check => check.passed) }));
    checks.push({ name: 'Unknown state requires inspection, not automatic input', run: () => recoveryDecision('unrecognized', 'unknown', 0) === 'inspect-state' });
  } else if (lab === 38) {
    checks.push({ name: 'Fixture report meets project convention and exact arithmetic', run: () => proposalChecks({ path: 'report.md', content: guardedReport }).every(row => row.passed) });
    checks.push({ name: 'Outside path cannot be an approved proposal', run: () => !proposalChecks({ path: '../protected.txt', content: guardedReport }).every(row => row.passed) });
    checks.push({ name: 'Incorrect total fails report validation', run: () => !proposalChecks({ path: 'report.md', content: guardedReport.replace('2800', '2801') }).every(row => row.passed) });
    checks.push({ name: 'Diff exposes both previous and proposed content', run: () => simpleDiff('Old', 'New').includes('- Old') && simpleDiff('Old', 'New').includes('+ New') });
    checks.push({ name: 'Unbounded report is rejected', run: () => !proposalChecks({ path: 'report.md', content: guardedReport + 'x'.repeat(4001) }).every(row => row.passed) });
  } else if (lab === 39 || lab === 40) {
    const kinds = ['success', 'claim', 'disabled', ...(lab === 40 ? ['sequential', 'unavailable', 'child-failed'] : [])];
    for (const kind of kinds) checks.push({ name: `Delegation evidence: ${kind}`, run: () => verifyDelegation(delegationPractice(lab, kind), lab, ['unavailable', 'child-failed'].includes(kind), kind !== 'disabled').every(row => row.passed) === !['claim', 'sequential'].includes(kind) });
    checks.push({ name: 'Disabled configuration omits a concurrency limit', run: () => !('max_concurrent_subagents' in delegationRequest(lab, false, false, 'test').agent.multi_agent) });
    checks.push({ name: 'Concurrency is fixed and excludes the coordinator', run: () => (delegationRequest(lab, true, false, 'test').agent.multi_agent as any).max_concurrent_subagents === (lab === 39 ? 1 : 2) });
    checks.push({ name: 'Child completion cannot settle the root', run: () => { const trace = newDelegationTrace(); applyDelegationEvent(trace, { type: 'agent.session.turn.completed', turn: { id: 'childTurn', subagent_id: 'child' } }, 1); return trace.root === 'unknown'; } });
    checks.push({ name: 'Unknown turn text cannot pollute the root answer', run: () => { const trace = newDelegationTrace(); applyDelegationEvent(trace, { type: 'agent.session.turn.output_text.done', turn_id: 'unknown', item_id: 'text', text: 'Child text' }, 1); return trace.answer === ''; } });
    checks.push({ name: 'Repeated events do not duplicate child IDs', run: () => { const trace = newDelegationTrace(); const event = { event_id: 'same', type: 'agent.session.subagent.created', subagent: { id: 'child' } }; applyDelegationEvent(trace, event, 1); applyDelegationEvent(trace, event, 2); return trace.children.length === 1; } });
    checks.push({ name: 'Follow-up budget violations are visible', run: () => { const trace = delegationPractice(lab, 'success'); for (let i = 0; i < 3; i++) trace.items.push({ id: `follow${i}`, type: 'send_subagent_input_call', recipient_agent_id: 'child0' }); return !verifyDelegation(trace, lab, false).every(row => row.passed); } });
    if (lab === 40) checks.push({ name: 'Sequential children do not establish overlap', run: () => !childOverlap(delegationPractice(40, 'sequential')) });
  }
  return checks.map(check => { try { return { name: check.name, passed: check.run() }; } catch { return { name: check.name, passed: false }; } });
}
