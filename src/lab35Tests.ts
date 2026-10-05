import { accessCases, accessPractice, accessPrompt, checkProbe, observedProbe, parseProbe, verifyAccess } from './lab35Filesystem.ts';
export function runAccessSuite() {
  const checks = [
    ...accessCases.map(row => ({ name: row.title, run: () => verifyAccess(accessPractice(row.id)).every(check => check.passed) === ['enforced', 'broader'].includes(row.id) })),
    { name: 'Malformed report is rejected', run: () => parseProbe('null') === null && parseProbe('{}') === null },
    { name: 'Root UID does not prove the unprivileged boundary', run: () => { const trace = accessPractice('enforced'); const report = observedProbe(trace)!; report.uid = 0; return !checkProbe(report, trace.nonce)[1].passed; } },
    { name: 'Failed command cannot prove access results', run: () => { const trace = accessPractice('enforced'); trace.commands[0].exitCode = 1; return observedProbe(trace) === null; } },
    { name: 'Wrong run marker fails', run: () => { const trace = accessPractice('enforced'); trace.nonce = 'ffffffffffffffff'; return observedProbe(trace) === null; } },
    { name: 'Duplicate probe IDs fail the inventory contract', run: () => { const report = JSON.parse(accessPractice('enforced').answer); report.tests[1] = report.tests[0]; return parseProbe(JSON.stringify(report)) === null; } },
    { name: 'Broader prompt explicitly requests the protected fixture test', run: () => accessPrompt('broader').includes('attempt access to /protected/course-private.txt') },
    { name: 'Runtime read remains visible outside the workspace', run: () => verifyAccess(accessPractice('enforced')).some(check => check.name === 'runtime-read: allowed' && check.passed) },
  ];
  return checks.map(check => { try { return { name: check.name, passed: check.run() }; } catch { return { name: check.name, passed: false }; } });
}
