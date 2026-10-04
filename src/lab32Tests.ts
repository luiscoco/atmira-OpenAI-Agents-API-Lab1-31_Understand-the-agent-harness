import { connectionEvent, fixtureFiles, listingPrompt, verifyListing } from './lab32Environment.ts';
import { executorScenarios } from './lab32Scenarios.ts';
export function runExecutorSuite() {
  const checks: { name: string; run: () => boolean }[] = [
    { name: 'Connected is the self-hosted input gate', run: () => connectionEvent('agent.session.environment.connected') === 'connected' },
    { name: 'Hosted ready is not a self-hosted connection', run: () => connectionEvent('agent.session.environment.ready') === null },
    { name: 'Disconnect stays distinct from failed', run: () => connectionEvent('agent.session.environment.disconnected') === 'disconnected' },
    { name: 'Fixture paths are sorted and include a hidden file', run: () => JSON.stringify(fixtureFiles('0123456789abcdef')) === JSON.stringify(['.course-marker', 'brief.txt', 'data/sales.csv', 'run-0123456789abcdef.txt']) },
    { name: 'Nonce is not revealed in the user prompt', run: () => !listingPrompt('0123456789abcdef').includes('0123456789abcdef') },
    { name: 'Invalid fixture nonce rejected', run: () => { try { fixtureFiles('../secret'); return false; } catch { return true; } } },
    ...executorScenarios.map(scenario => ({ name: scenario.title, run: () => verifyListing(scenario.trace).every(check => check.passed) === (scenario.id === 'success') })),
    { name: 'Duplicate inventory fails', run: () => { const trace = structuredClone(executorScenarios[0].trace); const answer = JSON.parse(trace.answer); answer.files.push(answer.files[0]); trace.answer = JSON.stringify(answer); return !verifyListing(trace)[3].passed; } },
    { name: 'Wrong nonce fails', run: () => { const trace = structuredClone(executorScenarios[0].trace); const report = JSON.parse(trace.answer); report.nonce = 'wrong'; trace.answer = JSON.stringify(report); return !verifyListing(trace)[4].passed; } },
    { name: 'Malformed answer fails', run: () => { const trace = structuredClone(executorScenarios[0].trace); trace.answer = 'I listed the files'; return !verifyListing(trace)[3].passed; } },
    { name: 'Nonzero exit is not execution evidence', run: () => { const trace = structuredClone(executorScenarios[0].trace); trace.commands[0].exitCode = 1; return !verifyListing(trace)[2].passed; } },
    { name: 'A late connection cannot prove input was gated', run: () => { const trace = structuredClone(executorScenarios[0].trace); trace.inputMs = -1; return !verifyListing(trace)[0].passed; } },
  ];
  return checks.map(check => { try { return { name: check.name, passed: check.run() }; } catch { return { name: check.name, passed: false }; } });
}
