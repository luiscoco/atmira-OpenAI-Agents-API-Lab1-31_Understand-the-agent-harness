// Lab 25: the test page. Every case runs the real functions (parseManifest, parseSkill, parseMcpConfig, checkPlugin,
// buildZip, readZip, packPlugin, buildEnvironment, withArchive, judgePluginRun) on fixed inputs: no network, no API key.
import type { McpCall } from './lab22Mcp.ts';
import {
  archivePlaceholder, buildEnvironment, buildZip, checkManifestPath, checkPlugin, crc32, defaultInstall, hex8, packPlugin, parseFrontmatter, parseManifest, parseMcpConfig, parseSkill, readZip, toBase64, withArchive, judgePluginRun,
  type InstallSettings, type PluginFile, type PluginRun,
} from './lab25Plugin.ts';

export type TestGroup = 'manifest' | 'skill' | 'mcp' | 'pack' | 'install' | 'judge';
export type PluginTest = { id: string; label: string; group: TestGroup; expect: string; note: string; run: () => { got: string; detail: string } };
export type TestResult = { id: string; got: string; detail: string; pass: boolean };

const levelOf = (findings: Array<{ level: string }>) => (findings.some((item) => item.level === 'error') ? 'error' : findings.some((item) => item.level === 'warn') ? 'warn' : 'ok');
const lines = (findings: Array<{ level: string; text: string }>) => findings.map((item) => `${item.level}: ${item.text}`).join('\n') || 'no findings';
const manifest = (patch: Record<string, unknown> = {}) => JSON.stringify({ name: 'course-docs', version: '1.0.0', description: 'Answer Agents API questions from the docs.', skills: './skills/', mcpServers: './.mcp.json', ...patch });
const skill = (name = 'cite-docs', body = 'Search `openai_docs`, then answer. End with `Answered with course-docs/cite-docs.`') => `---\nname: ${name}\ndescription: Answer from the docs.\n---\n\n${body}\n`;
const mcp = (servers: Record<string, unknown> = { openai_docs: { type: 'http', url: 'https://developers.openai.com/mcp' } }) => JSON.stringify({ mcpServers: servers });
const plugin = (patch: Record<string, string | null> = {}): PluginFile[] => {
  const base: Record<string, string | null> = { '.codex-plugin/plugin.json': manifest(), '.mcp.json': mcp(), 'skills/cite-docs/SKILL.md': skill(), 'README.md': '# course-docs\n', ...patch };
  return Object.entries(base).filter((entry): entry is [string, string] => entry[1] !== null).map(([path, text]) => ({ path, text }));
};
const checked = (files: PluginFile[]) => { const result = checkPlugin(files); return { got: result.manifest ? `ok · ${result.skills.length} skill · ${result.servers.length} server` : levelOf(result.findings), detail: lines(result.findings) }; };
const good = packPlugin(plugin());
const install = (patch: Partial<InstallSettings>) => {
  const { environment, findings } = buildEnvironment({ ...defaultInstall, ...patch }, good.packed, good.check);
  const shape = !environment ? 'no environment' : environment.environment_template_id ? 'template' : environment.plugins ? `inline · ${environment.network?.access}` : `none · ${environment.network?.access}`;
  return { got: `${levelOf(findings)} · ${shape}`, detail: [JSON.stringify(environment, null, 2), lines(findings)].join('\n') };
};
const call = (patch: Partial<McpCall> = {}): McpCall => ({ id: 'exec_1', server: 'openai_docs', name: 'fetch_openai_doc', status: 'completed', turnId: 't', arguments: { url: 'https://developers.openai.com/api/docs/guides/agents-api/tools/vaults' }, output: 'Attach the vault with vault_ids.', isError: false, error: null, kind: 'tool', ...patch });
const link = 'See [Vaults](https://developers.openai.com/api/docs/guides/agents-api/tools/vaults).';
const signature = 'Answered with course-docs/cite-docs.';
const run = (patch: Partial<PluginRun>): PluginRun => ({ mode: 'inline', prompt: 'q', sessionId: 'sess_1', templateId: null, turnStatus: 'completed', installed: [{ name: 'course-docs', description: 'd' }], capabilityDirs: ['/workspace/.managed-agents/plugins/course-docs-49c8'], sent: 'ready', readyMs: 19_000, calls: [call()], commands: 0, answer: `${link}\n\n${signature}`, error: null, durationMs: 1, fingerprint: 'abcd1234', requestChars: 5000, completion: 'stream', ...patch });
const judged = (value: PluginRun) => { const verdict = judgePluginRun(value, { name: 'course-docs', signature, server: 'openai_docs' }); return { got: verdict.outcome, detail: `${verdict.title}: ${verdict.text}\n${verdict.checks.map((check) => `${check.level} · ${check.label}: ${check.detail}`).join('\n')}` }; };

export const pluginTests: PluginTest[] = [
  { id: 'manifest-ok', label: 'The course manifest', group: 'manifest', expect: 'ok', note: 'name, version, description, and two ./ paths.', run: () => { const out = parseManifest(manifest()); return { got: levelOf(out.findings), detail: JSON.stringify(out.manifest, null, 2) }; } },
  { id: 'manifest-json', label: 'A trailing comma', group: 'manifest', expect: 'error', note: 'plugin.json must be strict JSON.', run: () => { const out = parseManifest('{"name": "course-docs",}'); return { got: levelOf(out.findings), detail: lines(out.findings) }; } },
  { id: 'manifest-name', label: 'A name with spaces', group: 'manifest', expect: 'error', note: 'The name also names the ZIP’s top folder and the session’s plugin entry.', run: () => { const out = parseManifest(manifest({ name: 'Course Docs' })); return { got: levelOf(out.findings), detail: lines(out.findings) }; } },
  { id: 'manifest-version', label: 'version "1.0"', group: 'manifest', expect: 'error', note: 'Semantic versions have three parts.', run: () => { const out = parseManifest(manifest({ version: '1.0' })); return { got: levelOf(out.findings), detail: lines(out.findings) }; } },
  { id: 'path-dot', label: 'skills: "skills/" without ./', group: 'manifest', expect: 'error', note: 'OpenAI’s guide: manifest paths start with ./.', run: () => { const out = checkManifestPath('skills', 'skills/'); return { got: levelOf(out.findings), detail: lines(out.findings) }; } },
  { id: 'path-up', label: 'mcpServers: "./../shared/.mcp.json"', group: 'manifest', expect: 'error', note: 'A .. would leave the plugin.', run: () => { const out = checkManifestPath('mcpServers', './../shared/.mcp.json'); return { got: levelOf(out.findings), detail: lines(out.findings) }; } },
  { id: 'manifest-typo', label: 'mcp_servers instead of mcpServers', group: 'manifest', expect: 'warn', note: 'An unknown key is ignored, so the server would silently go missing.', run: () => { const out = parseManifest(JSON.stringify({ name: 'course-docs', version: '1.0.0', description: 'd', skills: './skills/', mcp_servers: './.mcp.json' })); return { got: levelOf(out.findings), detail: lines(out.findings) }; } },

  { id: 'frontmatter', label: 'Read SKILL.md frontmatter', group: 'skill', expect: 'cite-docs · Answer from the docs.', note: 'Only simple key: value lines are needed.', run: () => { const out = parseFrontmatter(skill()); return { got: `${out?.fields.name} · ${out?.fields.description}`, detail: JSON.stringify(out, null, 2) }; } },
  { id: 'no-frontmatter', label: 'A SKILL.md without frontmatter', group: 'skill', expect: 'error', note: 'The agent needs name and description to know when to use the skill.', run: () => { const out = parseSkill({ path: 'skills/cite-docs/SKILL.md', text: 'Just search the docs.' }, 'skills'); return { got: levelOf(out.findings), detail: lines(out.findings) }; } },
  { id: 'skill-folder', label: 'name differs from its folder', group: 'skill', expect: 'warn', note: 'Allowed here, but confusing.', run: () => { const out = parseSkill({ path: 'skills/cite-docs/SKILL.md', text: skill('docs-search') }, 'skills'); return { got: levelOf(out.findings), detail: lines(out.findings) }; } },
  { id: 'signature', label: 'Find the skill’s closing line', group: 'skill', expect: signature, note: 'The run judge looks for it in the answer.', run: () => { const out = parseSkill({ path: 'skills/cite-docs/SKILL.md', text: skill() }, 'skills'); return { got: out.skill?.signature ?? 'none', detail: out.skill?.body ?? '' }; } },
  { id: 'no-skill-file', label: 'skills points to an empty folder', group: 'skill', expect: 'error', note: 'A skills path with no <name>/SKILL.md installs nothing.', run: () => checked(plugin({ 'skills/cite-docs/SKILL.md': null, 'skills/notes.md': 'x' })) },

  { id: 'mcp-ok', label: 'The course .mcp.json', group: 'mcp', expect: 'ok', note: 'One public https server, no credentials.', run: () => { const out = parseMcpConfig(mcp()); return { got: levelOf(out.findings), detail: JSON.stringify(out.servers, null, 2) }; } },
  { id: 'mcp-header', label: 'A literal Authorization header', group: 'mcp', expect: 'error', note: 'It would travel inside the archive to every session and template.', run: () => { const out = parseMcpConfig(mcp({ records: { type: 'http', url: 'https://records.example.com/mcp', http_headers: { Authorization: 'Bearer abc123def456ghi789' } } })); return { got: levelOf(out.findings), detail: lines(out.findings) }; } },
  { id: 'mcp-env', label: 'bearer_token_env_var', group: 'mcp', expect: 'ok · RECORDS_TOKEN', note: 'The archive holds the variable’s name; the value lives in the environment.', run: () => { const out = parseMcpConfig(mcp({ records: { type: 'http', url: 'https://records.example.com/mcp', bearer_token_env_var: 'RECORDS_TOKEN' } })); return { got: `${levelOf(out.findings)} · ${out.servers[0]?.envVar}`, detail: lines(out.findings) }; } },
  { id: 'mcp-http', label: 'An http:// server URL', group: 'mcp', expect: 'error', note: 'Lab 22’s URL rules still apply.', run: () => { const out = parseMcpConfig(mcp({ docs: { type: 'http', url: 'http://developers.openai.com/mcp' } })); return { got: levelOf(out.findings), detail: lines(out.findings) }; } },
  { id: 'mcp-stdio', label: 'A stdio server', group: 'mcp', expect: 'warn', note: 'It runs inside the environment, which needs network enabled or omitted.', run: () => { const out = parseMcpConfig(mcp({ local: { type: 'stdio', command: 'node', args: ['server.js'] } })); return { got: levelOf(out.findings), detail: lines(out.findings) }; } },
  { id: 'env-file', label: 'A .env file in the folder', group: 'mcp', expect: 'error', note: 'Everything in the folder goes into the archive.', run: () => checked(plugin({ '.env': 'RECORDS_TOKEN=abc' })) },
  { id: 'unmentioned', label: 'A server no skill mentions', group: 'mcp', expect: 'ok · 1 skill · 1 server', note: 'It packs, with a warning: the agent may overlook the server.', run: () => checked(plugin({ 'skills/cite-docs/SKILL.md': skill('cite-docs', 'Answer from the documentation.') })) },

  { id: 'crc', label: 'CRC-32 of "123456789"', group: 'pack', expect: 'cbf43926', note: 'The standard check value. Every ZIP entry carries one.', run: () => ({ got: hex8(crc32(new TextEncoder().encode('123456789'))), detail: 'CRC-32/ISO-HDLC' }) },
  { id: 'roundtrip', label: 'Read back what was packed', group: 'pack', expect: 'a/ a/b.txt', note: 'readZip reads the central directory, as an unzipper does.', run: () => { const entries = readZip(buildZip([{ path: 'a/b.txt', data: new TextEncoder().encode('hi') }])); return { got: entries.map((entry) => entry.path).join(' '), detail: JSON.stringify(entries, null, 2) }; } },
  { id: 'top-folder', label: 'One top-level folder', group: 'pack', expect: 'course-docs', note: 'Live: an archive with files at the root got 400 “must contain one top-level directory”.', run: () => { const tops = [...new Set(good.packed?.entries.map((entry) => entry.path.split('/')[0]))]; return { got: tops.join(' '), detail: good.packed?.entries.map((entry) => `${entry.path} ${entry.size}`).join('\n') ?? '' }; } },
  { id: 'manifest-inside', label: 'The manifest is inside it', group: 'pack', expect: 'true', note: 'Live: without it, 400 “plugin archive must contain .codex-plugin/plugin.json”.', run: () => ({ got: String(Boolean(good.packed?.entries.some((entry) => entry.path === 'course-docs/.codex-plugin/plugin.json'))), detail: '' }) },
  { id: 'deterministic', label: 'Same files, same bytes', group: 'pack', expect: 'same', note: 'Sorted entries and a fixed timestamp: the fingerprint changes only when a file does.', run: () => { const a = packPlugin(plugin()).packed; const b = packPlugin([...plugin()].reverse()).packed; return { got: a?.fingerprint === b?.fingerprint && a?.base64 === b?.base64 ? 'same' : 'different', detail: `${a?.fingerprint} ${b?.fingerprint}` }; } },
  { id: 'changed', label: 'A changed file, a new fingerprint', group: 'pack', expect: 'different', note: 'Bump the version too, so a reader can tell the templates apart.', run: () => { const a = packPlugin(plugin()).packed; const b = packPlugin(plugin({ 'README.md': '# course-docs v1.0.1\n' })).packed; return { got: a?.fingerprint !== b?.fingerprint ? 'different' : 'same', detail: `${a?.fingerprint} → ${b?.fingerprint}` }; } },
  { id: 'base64', label: 'base64 of three bytes', group: 'pack', expect: 'AQID', note: 'source.data is standard base64.', run: () => ({ got: toBase64(new Uint8Array([1, 2, 3])), detail: '' }) },

  { id: 'inline', label: 'Inline, restricted network', group: 'install', expect: 'warn · inline · restricted', note: 'The warning: every new session carries the whole archive.', run: () => install({}) },
  { id: 'inline-disabled', label: 'Inline, network disabled', group: 'install', expect: 'warn · inline · disabled', note: 'The plugin’s MCP calls run inside the environment, so disabled probably cuts them off.', run: () => install({ network: 'disabled' }) },
  { id: 'template', label: 'From a template', group: 'install', expect: 'ok · template', note: 'No archive and no network in the session: both come from the template. Live: a session network that broadens the template’s → 400.', run: () => install({ mode: 'template', templateId: 'envtmpl_1' }) },
  { id: 'no-template', label: 'Template mode before the template exists', group: 'install', expect: 'error · no environment', note: 'Save the plugin in a template first.', run: () => install({ mode: 'template', templateId: null }) },
  { id: 'placeholder', label: 'The browser’s copy holds no archive', group: 'install', expect: 'placeholder', note: 'The server swaps in the bytes last, with withArchive.', run: () => { const shown = buildEnvironment(defaultInstall, good.packed, good.check).environment!; const data = shown.plugins?.[0].source.data ?? ''; const real = withArchive(shown, good.packed!.base64).plugins?.[0].source.data; return { got: data === archivePlaceholder(good.packed!.base64Chars) && real === good.packed!.base64 ? 'placeholder' : 'archive', detail: data }; } },

  { id: 'used', label: 'Installed, called, signed, grounded', group: 'judge', expect: 'used', note: 'The recorded inline run on 2026-09-28 looked like this.', run: () => judged(run({})) },
  { id: 'early', label: 'Asked before the environment was ready', group: 'judge', expect: 'early', note: 'Live: the turn answered “I don’t have a documentation tool available”.', run: () => judged(run({ sent: 'early', readyMs: null, calls: [], answer: 'I don’t have a documentation tool available.' })) },
  { id: 'missing', label: 'Session lists no plugin', group: 'judge', expect: 'missing', note: 'Trust environment.plugins, not the request.', run: () => judged(run({ installed: [] })) },
  { id: 'unsigned', label: 'Server called, no closing line', group: 'judge', expect: 'partial', note: 'The MCP server came with the plugin, but the skill’s steps were not visibly followed.', run: () => judged(run({ answer: link })) },
  { id: 'ungrounded', label: 'A link no tool returned', group: 'judge', expect: 'partial', note: 'Lab 22’s grounding rule, applied to the plugin’s server.', run: () => judged(run({ answer: `See [x](https://example.com/made-up).\n\n${signature}` })) },
  { id: 'refused', label: 'The API refused the archive', group: 'judge', expect: 'refused', note: 'Live: 400 “inline plugin name and description must match its archive manifest”.', run: () => judged(run({ sessionId: null, turnStatus: 'failed', installed: [], calls: [], answer: '', error: '400 inline plugin name and description must match its archive manifest' })) },
  { id: 'baseline', label: 'No plugin, as requested', group: 'judge', expect: 'baseline', note: 'The comparison run.', run: () => judged(run({ mode: 'none', installed: [], calls: [], answer: 'From training data…' })) },
];

export function runPluginTest(item: PluginTest): TestResult {
  try {
    const { got, detail } = item.run();
    return { id: item.id, got, detail, pass: got === item.expect };
  } catch (error) {
    return { id: item.id, got: 'crashed', detail: error instanceof Error ? error.message : String(error), pass: false };
  }
}

export const runPluginSuite = () => pluginTests.map(runPluginTest);
