import { checkCapabilityPaths, capabilityDirectory, inspectManifest, skillCases, skillPractice, verifySkillEvidence, revenueTotal, skillPrompt } from './lab34Skills.ts';
export function runSkillSuite() {
  const checks = [
    { name: 'Absolute capability parent accepted', run: () => checkCapabilityPaths([capabilityDirectory]) },
    { name: 'Relative, traversal and duplicate paths rejected', run: () => !checkCapabilityPaths(['skills']) && !checkCapabilityPaths(['/a/../b']) && !checkCapabilityPaths(['/a', '/a/']) },
    { name: 'At most 32 directories', run: () => !checkCapabilityPaths(Array.from({ length: 33 }, (_, index) => `/skills/${index}`)) },
    { name: 'Missing description fails authoring checks', run: () => !inspectManifest('---\nname: report\n---\nBody').checks.every(check => check.passed) },
    { name: 'Malformed name fails authoring checks', run: () => !inspectManifest('---\nname: Bad_Name\ndescription: Revenue reports\n---\nBody').checks[1].passed },
    { name: 'Fresh dataset total varies by marker', run: () => revenueTotal('0000000000000000') !== revenueTotal('0100000000000000') },
    { name: 'Prompt does not reveal the skill name or expected total', run: () => !skillPrompt('revenue').includes('course-sales-report') && !skillPrompt('revenue').includes(String(revenueTotal('a1b2c3d4e5f60718'))) },
    ...skillCases.map(row => ({ name: row.title, run: () => verifySkillEvidence(skillPractice(row.id)).every(check => check.passed) === ['revenue', 'unrelated'].includes(row.id) })),
    { name: 'Failed command cannot prove a successful manifest read', run: () => { const evidence = skillPractice('revenue'); evidence.trace.commands[0].exitCode = 1; return !verifySkillEvidence(evidence)[3].passed; } },
  ];
  return checks.map(check => { try { return { name: check.name, passed: check.run() }; } catch { return { name: check.name, passed: false }; } });
}
