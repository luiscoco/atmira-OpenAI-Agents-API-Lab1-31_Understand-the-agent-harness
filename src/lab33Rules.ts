export type RuleFile = { path: string; content: string };
export type RuleOptions = { cwd: string; override: boolean; fallback: boolean; root: string };
export const defaultRules = '# Repository guidance\n\n- Title: Sales summary\n- Output: summary.md\n- Sections: Summary, Totals\n- Cite data/sales.csv and report the exact revenue total.\n- Do not change the input CSV.\n';
export const salesCsv = 'product,units,price_eur\nbook,3,12\npen,8,2\n';
export const defaultOptions: RuleOptions = { cwd: 'reports', override: true, fallback: true, root: defaultRules };
export function validateOptions(raw: unknown): RuleOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Send rule options.');
  const value = raw as RuleOptions;
  if (!['', 'reports', 'reports/private', 'data'].includes(value.cwd) || typeof value.override !== 'boolean' || typeof value.fallback !== 'boolean' || typeof value.root !== 'string' || !value.root.trim() || value.root.length > 4000 || Object.keys(value).some(key => !['cwd', 'override', 'fallback', 'root'].includes(key))) throw new Error('Choose a fixture directory and guidance of 1–4000 characters.');
  return { cwd: value.cwd, override: value.override, fallback: value.fallback, root: value.root };
}
export function ruleFiles(options: RuleOptions): RuleFile[] {
  return [
    { path: 'AGENTS.md', content: options.root },
    { path: 'reports/AGENTS.md', content: '# Report conventions\n\n- Title: Regional sales\n- Output: regional-summary.md\n' },
    ...(options.override ? [{ path: 'reports/AGENTS.override.md', content: '# Report override\n\n- Title: Reviewed sales\n- Output: reviewed-summary.md\n' }] : []),
    { path: 'reports/private/AGENTS.md', content: '' },
    { path: 'reports/private/TEAM_GUIDE.md', content: '# Private report conventions\n\n- Title: Private sales\n- Output: private-summary.md\n- Sections: Summary, Totals, Review\n' },
    { path: 'data/AGENTS.md', content: '# Data conventions\n\n- Title: Data audit\n- Output: data-summary.md\n' },
    { path: 'data/sales.csv', content: salesCsv },
  ];
}
// A bounded in-memory teaching model. This never reads host project files.
export function discoverRules(files: RuleFile[], cwd: string, fallbackNames: string[] = []) {
  if (cwd && !/^[a-z]+(?:\/[a-z]+)*$/.test(cwd)) throw new Error('Invalid fixture working directory.');
  const directories = ['', ...cwd.split('/').filter(Boolean).map((_, index, parts) => parts.slice(0, index + 1).join('/'))];
  const sources: RuleFile[] = [];
  for (const directory of directories) {
    for (const name of ['AGENTS.override.md', 'AGENTS.md', ...fallbackNames]) {
      const path = [directory, name].filter(Boolean).join('/');
      const file = files.find(file => file.path === path && file.content.trim());
      if (file) { sources.push(file); break; }
    }
  }
  return sources;
}
export function resolveRules(options: RuleOptions) {
  return discoverRules(ruleFiles(options), options.cwd, options.fallback ? ['TEAM_GUIDE.md'] : []);
}
// These three fields belong to the lab fixture, not to an AGENTS.md file format.
export function conventions(sources: RuleFile[]) {
  const expected = { title: '', path: '', sections: [] as string[] };
  for (const source of sources) {
    const title = /^- Title: (.+)$/m.exec(source.content)?.[1]?.trim();
    const path = /^- Output: (.+)$/m.exec(source.content)?.[1]?.trim();
    const sections = /^- Sections: (.+)$/m.exec(source.content)?.[1];
    if (title) expected.title = title;
    if (path) expected.path = path;
    if (sections) expected.sections = sections.split(',').map(part => part.trim()).filter(Boolean);
  }
  return expected;
}
export function buildRuleRequest(options: RuleOptions, guided: boolean) {
  const sources = guided ? resolveRules(options) : [];
  return { sources, instructions: 'Prepare a proposed Markdown report from the supplied CSV. Return only JSON with exactly three string fields: path (a filename relative to the working directory), title, markdown. Do not claim to have read or written files.\n' + sources.map(file => `\n# Project guidance from ${file.path}\n${file.content}`).join('\n'),
    prompt: `Working directory: /fixture/${options.cwd}\nTask: summarize product revenue in EUR and its grand total. Propose a report file.\nSource file data/sales.csv:\n${salesCsv}` };
}
export function verifyReport(answer: string, sources: RuleFile[]) {
  let report: Record<string, unknown> = {};
  try { report = JSON.parse(answer); } catch { /* Failed contract below. */ }
  if (!report || typeof report !== 'object' || Array.isArray(report)) report = {};
  const expected = conventions(sources); const markdown = typeof report.markdown === 'string' ? report.markdown : '';
  return [
    { name: 'JSON report contract', passed: Object.keys(report).sort().join(',') === 'markdown,path,title' && ['path', 'title', 'markdown'].every(key => typeof report[key] === 'string') },
    { name: 'Scoped title and first heading', passed: Boolean(expected.title) && report.title === expected.title && markdown.split('\n')[0].trim() === `# ${expected.title}` },
    { name: 'Scoped output filename', passed: Boolean(expected.path) && report.path === expected.path },
    { name: 'Required Markdown sections', passed: expected.sections.length > 0 && expected.sections.every(section => markdown.split('\n').some(line => line.trim() === `## ${section}`)) },
    { name: 'Source attribution', passed: markdown.includes('data/sales.csv') },
    { name: 'Independent revenue check: 52 EUR', passed: /\b(?:total|revenue)\b[^\n]*\b52(?:\.00)?\s*(?:EUR|€)/i.test(markdown) },
  ];
}
export function practiceAnswer(options: RuleOptions) {
  const expected = conventions(resolveRules(options));
  return JSON.stringify({ path: expected.path, title: expected.title, markdown: `# ${expected.title}\n\n${expected.sections.map(section => `## ${section}\n${section === 'Totals' ? 'Grand total: 52 EUR (book: 36 EUR; pen: 16 EUR).' : 'Source: data/sales.csv. Two products reviewed.'}`).join('\n\n')}` }, null, 2);
}
export function workspaceScript(options: RuleOptions) {
  const files = JSON.stringify(ruleFiles(options));
  return `// Creates a standalone exercise; refuses to overwrite an existing directory.\nimport { existsSync, mkdirSync, writeFileSync } from 'node:fs';\nimport { join, dirname } from 'node:path';\nimport { execFileSync } from 'node:child_process';\nconst root = join(process.cwd(), 'lab33-workspace');\nif (existsSync(root)) throw new Error('lab33-workspace already exists. Choose a fresh directory.');\nexecFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true });\nmkdirSync(root);\nconst files = ${files};\nfor (const file of files) {\n  const target = join(root, file.path);\n  mkdirSync(dirname(target), { recursive: true });\n  writeFileSync(target, file.content, { encoding: 'utf8', flag: 'wx' });\n}\nexecFileSync('git', ['-C', root, 'init'], { stdio: 'inherit', windowsHide: true });\nconsole.log('Open this workspace in Codex. See LAB33.md for the root and scoped comparison.');\n`;
}
