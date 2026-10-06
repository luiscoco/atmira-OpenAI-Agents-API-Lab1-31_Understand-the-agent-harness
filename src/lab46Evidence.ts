type Call = { name: string; args: any; source: string; output: any; lifetime?: number };
type Lifecycle = { lifetime: number; state: 'registered' | 'closed'; names: string[] };
export function reviewWebMcpEvidence(calls: Call[], lifecycle: Lifecycle[]) {
  const native = calls.filter(call => call.source === 'Native WebMCP execute' && Number.isInteger(call.lifetime));
  const checks = lifecycle.filter(event => event.state === 'registered' && ['lab46_read_report', 'lab46_set_filter'].every(name => event.names.includes(name))).map(event => {
    const observed = native.filter(call => call.lifetime === event.lifetime);
    const read = observed.some(call => call.name === 'lab46_read_report' && Array.isArray(call.output?.rows));
    const filter = observed.findIndex(call => call.name === 'lab46_set_filter' && call.args?.filter === 'needs-review' && call.output?.filter === 'needs-review' && Array.isArray(call.output?.rows) && call.output.rows.length > 0 && call.output.rows.every(row => row.status === 'needs-review'));
    const reread = filter >= 0 && observed.slice(filter + 1).some(call => call.name === 'lab46_read_report' && call.output?.filter === 'needs-review' && call.output?.rows?.length > 0 && call.output.rows.every(row => row.status === 'needs-review'));
    const closed = lifecycle.some(row => row.lifetime === event.lifetime && row.state === 'closed' && ['lab46_read_report', 'lab46_set_filter'].every(name => row.names.includes(name)));
    return { lifetime: event.lifetime, readObserved: read, filterObserved: filter >= 0, sharedStateObserved: reread, cleanupObserved: closed };
  });
  const complete = checks.some(row => Object.entries(row).filter(([key]) => key !== 'lifetime').every(([, value]) => value === true));
  return { outcome: complete ? 'observed-page-checks' : 'incomplete', nativeCalls: native.length, localDemoCalls: calls.filter(call => call.source === 'Local demo button').length, checks, limitation: 'Page-handler observations require comparison with browser Sources/Recently used. Local buttons do not establish native discovery or invocation.' };
}
