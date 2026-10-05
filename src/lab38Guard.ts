export const guardedRules = '# Course project rules\nUse integer cents. Propose only report.md. Preserve sales.csv. Require human approval before writing.\n';
export const guardedCsv = 'product,units,price_cents\nbook,1,1200\npen,8,200\n';
export const guardedReport = '# Revenue report\n\nTotal revenue: 2800 cents.\n';
export function proposalChecks(proposal: any) { return [{ name: 'Only report.md may change', passed: proposal?.path === 'report.md' }, { name: 'Report has the project heading', passed: typeof proposal?.content === 'string' && proposal.content.startsWith('# Revenue report\n') }, { name: 'Exact fixture revenue is 2800 cents', passed: proposal?.content?.includes('Total revenue: 2800 cents.') === true }, { name: 'Content is bounded', passed: typeof proposal?.content === 'string' && proposal.content.length <= 4000 }]; }
export function simpleDiff(before: string, after: string) { return ['--- report.md (current)', '+++ report.md (proposed)', ...before.split('\n').map(line => `- ${line}`), ...after.split('\n').map(line => `+ ${line}`)].join('\n'); }
export const guardedTools = [
  { type: 'function' as const, name: 'read_workspace', description: 'Read one allowed fixture: AGENTS.md, sales.csv or report.md. Other paths are denied.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { type: 'function' as const, name: 'calculate_revenue', description: 'Run the bundled standalone report helper on the immutable course CSV.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function' as const, name: 'propose_report', description: 'Save report.md content as a proposal for human review. Does not write the file.', parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false } },
];
export const guardedPrompt = 'Read AGENTS.md and sales.csv, run calculate_revenue, attempt read_workspace on ../protected.txt to demonstrate enforced denial, then propose report.md with the exact total in integer cents. Do not apply the change. Explain that approval is pending.';
