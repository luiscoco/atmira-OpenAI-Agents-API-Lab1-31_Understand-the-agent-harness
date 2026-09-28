import { architectureEdges, classifyStep, parseTrace, projectItem, traceOutcome, traceWarnings, evidenceDocument, validSessionId, type TraceStep } from './lab31Harness.ts';
import { harnessScenarios } from './lab31Scenarios.ts';
const example = harnessScenarios[0].trace;
const row = (kind: TraceStep['kind'], status: string | null = null, root = true): TraceStep => ({ id: 'test', kind, label: 'Test', detail: '', turnId: 'turn_test', callId: null, status, root });
export const harnessTests: Array<{ name: string; run: () => boolean }> = [
  { name: 'A harness exists without a sandbox connection', run: () => !architectureEdges('none').some(edge => edge.to === 'sandbox') && architectureEdges('none').some(edge => edge.to === 'model') },
  { name: 'Hosted commands flow from harness to sandbox', run: () => architectureEdges('openai_hosted').some(edge => edge.from === 'harness' && edge.to === 'sandbox') },
  { name: 'Self-hosted compute adds application lifecycle ownership', run: () => architectureEdges('self_hosted').some(edge => edge.from === 'server' && edge.to === 'sandbox') && !architectureEdges('openai_hosted').some(edge => edge.from === 'server' && edge.to === 'sandbox') },
  ...(['function_call', 'function_result', 'command', 'mcp_call', 'text', 'turn', 'render', 'unknown'] as const).map((kind, index) => ({ name: `Classify ${kind} at the correct boundary`, run: () => classifyStep(row(kind)).owner === ['model', 'server', 'sandbox', 'mcp', 'model', 'harness', 'browser', 'unknown'][index] })),
  { name: 'Child completion cannot replace an active root', run: () => traceOutcome([row('turn', 'in_progress'), row('turn', 'completed', false)]) === 'in_progress' },
  { name: 'Idle cannot establish root success', run: () => traceOutcome([row('session', 'idle')]) === 'unknown' },
  { name: 'Latest root takes precedence over an earlier completed turn', run: () => traceOutcome([row('turn', 'completed'), row('turn', 'waiting')]) === 'waiting' },
  { name: 'A detached reader leaves the root outcome intact', run: () => traceOutcome([row('turn', 'in_progress'), row('disconnect')]) === 'in_progress' },
  { name: 'Cancelled root stays cancelled', run: () => traceOutcome([row('turn', 'cancelled')]) === 'cancelled' },
  { name: 'Partial inventory is explicitly warned', run: () => traceWarnings({ ...example, complete: false }).some(w => w.startsWith('Partial')) },
  { name: 'Sandbox commands in environment none are flagged', run: () => traceWarnings({ ...example, environment: 'none' }).some(w => w.includes('inconsistent')) },
  { name: 'Unknown saved item remains unclassified', run: () => projectItem({ id: 'item_unknown', type: 'future_tool' }).kind === 'unknown' },
  { name: 'Projection omits tool arguments and result bodies', run: () => !JSON.stringify(projectItem({ id: 'item_call', type: 'function_call', name: 'lookup', arguments: { token: 'private_value' }, output: 'private_value' })).includes('private_value') },
  { name: 'JSON imports cannot claim verified live provenance', run: () => parseTrace({ ...example, source: 'live saved state' }).source === 'imported' },
  { name: 'Forged owner annotations are recomputed', run: () => classifyStep(parseTrace({ ...example, steps: [{ ...row('command'), owner: 'browser' }] }).steps[0]).owner === 'sandbox' },
  { name: 'Duplicate step IDs are refused', run: () => { try { parseTrace({ ...example, steps: [row('text'), row('text')] }); return false; } catch { return true; } } },
  { name: 'Malformed root flags are refused', run: () => { try { parseTrace({ ...example, steps: [{ ...row('text'), root: 'yes' }] }); return false; } catch { return true; } } },
  { name: 'Oversized imports are refused', run: () => { try { parseTrace({ ...example, steps: Array.from({ length: 1001 }, (_, i) => ({ ...row('text'), id: String(i) })) }); return false; } catch { return true; } } },
  { name: 'Invalid session IDs never pass the boundary', run: () => validSessionId('sess_abc-123') && !validSessionId('../secret') && !validSessionId(null) },
  { name: 'Exports retain provenance and student explanation', run: () => { const doc = evidenceDocument(example, 'My ownership explanation.'); return doc.includes('synthetic practice') && doc.includes('My ownership explanation.') && doc.includes('Annotated architecture'); } },
  { name: 'Partial exports cannot claim current root completion', run: () => evidenceDocument({ ...example, complete: false }, '').includes('Root outcome: unknown (partial inventory)') },
];
export function runHarnessSuite() {
  return harnessTests.map(test => { try { return { name: test.name, passed: test.run() }; } catch { return { name: test.name, passed: false }; } });
}
