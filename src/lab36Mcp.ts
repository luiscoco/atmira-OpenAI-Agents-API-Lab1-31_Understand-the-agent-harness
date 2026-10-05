export const privateMcpImage = 'agents-lab36-executor:local';
export const privateMcpUrl = 'http://127.0.0.1:8765/mcp';
export function privateMcpTool(origin: 'environment' | 'service' = 'environment') {
  return { type: 'mcp' as const, server_label: 'private_inventory', transport: { type: 'http' as const, server_url: privateMcpUrl }, connection_origin: origin, allowed_tools: ['get_inventory'], required: true };
}
export const inventoryPrompt = 'Call private_inventory.get_inventory with an empty object. Return its exact JSON including the fresh marker, item and quantity. Do not substitute a shell read for the MCP call.';
export function inventoryResult(nonce: string) { return { marker: nonce, item: 'course-notebook', quantity: 7 }; }
export function decodeMcpOutput(value: unknown): Record<string, any> | null {
  try {
    if (typeof value === 'string') return decodeMcpOutput(JSON.parse(value));
    if (!value || typeof value !== 'object') return null;
    const row = value as any;
    if (row.marker) return row;
    if (row.structuredContent) return decodeMcpOutput(row.structuredContent);
    for (const part of row.content ?? []) { const decoded = decodeMcpOutput(part.text); if (decoded) return decoded; }
  } catch { /* An invalid output is not evidence. */ }
  return null;
}
export function verifyPrivateMcp(job: any) {
  const call = job.mcpCalls?.find((row: any) => row.server_label === 'private_inventory' && row.name === 'get_inventory' && row.status === 'completed' && !row.error);
  const report = decodeMcpOutput(call?.output); const answer = decodeMcpOutput(job.trace?.answer);
  return [
    { name: 'Connection originates in the environment', passed: job.origin === 'environment' },
    { name: 'Completed private MCP call observed', passed: Boolean(call) },
    { name: 'Tool output matches fresh private inventory', passed: JSON.stringify(report) === JSON.stringify(inventoryResult(job.trace.nonce)) },
    { name: 'Final fields agree with tool output', passed: Boolean(answer && report) && ['marker', 'item', 'quantity'].every(key => answer[key] === report[key]) },
    { name: 'Root turn completed', passed: job.trace.outcome === 'completed' },
    { name: 'Compute and session cleanup confirmed', passed: job.trace.cleanup === 'removed' && job.sessionCleanup === 'deleted' },
  ];
}
export function privateMcpPractice(kind: string) {
  const report = inventoryResult('0123456789abcdef');
  return { source: 'synthetic practice', origin: kind === 'service' ? 'service' : 'environment', mcpCalls: kind === 'claim' || kind === 'service' ? [] : [{ id: 'mcp_1', type: 'mcp_call', server_label: 'private_inventory', name: 'get_inventory', status: 'completed', error: null, output: { content: [{ type: 'text', text: JSON.stringify({ ...report, ...(kind === 'stale' ? { marker: 'ffffffffffffffff' } : {}) }) }] } }], trace: { nonce: report.marker, answer: JSON.stringify(report), outcome: kind === 'service' ? 'failed' : 'completed', cleanup: 'removed', events: [] }, sessionCleanup: 'deleted' };
}
