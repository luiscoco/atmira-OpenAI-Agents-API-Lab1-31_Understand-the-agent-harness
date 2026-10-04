import { defaultOptions, discoverRules, resolveRules, buildRuleRequest, practiceAnswer, verifyReport, validateOptions } from './lab33Rules.ts';
export function runRulesSuite() {
  const checks = [
    { name: 'Root-to-directory discovery excludes sibling data guidance', run: () => resolveRules(defaultOptions).map(file => file.path).join(',') === 'AGENTS.md,reports/AGENTS.override.md' },
    { name: 'Override replaces the same-directory AGENTS.md', run: () => !resolveRules(defaultOptions).some(file => file.path === 'reports/AGENTS.md') },
    { name: 'Removing override restores ordinary guidance', run: () => resolveRules({ ...defaultOptions, override: false })[1].path === 'reports/AGENTS.md' },
    { name: 'Empty instructions allow configured fallback', run: () => resolveRules({ ...defaultOptions, cwd: 'reports/private' }).at(-1)?.path === 'reports/private/TEAM_GUIDE.md' },
    { name: 'Fallback requires explicit configuration', run: () => resolveRules({ ...defaultOptions, cwd: 'reports/private', fallback: false }).length === 2 },
    { name: 'Root task does not discover descendant instructions', run: () => resolveRules({ ...defaultOptions, cwd: '' }).length === 1 },
    { name: 'Empty override falls back to nonempty AGENTS.md', run: () => discoverRules([{ path: 'AGENTS.override.md', content: '' }, { path: 'AGENTS.md', content: 'root' }], '')[0].content === 'root' },
    { name: 'Unguided request omits every project source', run: () => buildRuleRequest(defaultOptions, false).sources.length === 0 && !buildRuleRequest(defaultOptions, false).instructions.includes('Reviewed sales') },
    { name: 'Both arms receive the same CSV task', run: () => buildRuleRequest(defaultOptions, true).prompt === buildRuleRequest(defaultOptions, false).prompt },
    { name: 'Synthetic report satisfies conventions', run: () => verifyReport(practiceAnswer(defaultOptions), resolveRules(defaultOptions)).every(check => check.passed) },
    { name: 'Wrong revenue fails independent validation', run: () => !verifyReport(practiceAnswer(defaultOptions).replace('52 EUR', '53 EUR'), resolveRules(defaultOptions)).at(-1)?.passed },
    { name: 'Malformed JSON fails', run: () => !verifyReport('not JSON', resolveRules(defaultOptions))[0].passed },
    { name: 'Host path traversal rejected', run: () => { try { validateOptions({ ...defaultOptions, cwd: '../' }); return false; } catch { return true; } } },
  ];
  return checks.map(check => { try { return { name: check.name, passed: check.run() }; } catch { return { name: check.name, passed: false }; } });
}
