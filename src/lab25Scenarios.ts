// Lab 25: recorded runs for the plugin inspector. They need no API key. All come from live runs on 2026-09-28 with the
// course-docs plugin in plugins/course-docs (archive fingerprint 4d4be436). The session IDs, environment reports, errors,
// and answers are real; tool outputs are short stand-ins, and the answers' commentary lines are left out.
import type { McpCall } from './lab22Mcp.ts';
import { archivePlaceholder, type HostedEnvironment, type PluginRun } from './lab25Plugin.ts';

export type Sample = {
  id: string;
  label: string;
  group: 'install' | 'refused';
  environment: HostedEnvironment | null;
  run: PluginRun;
  lesson: string;
};

const plugin = { name: 'course-docs', description: 'Answer OpenAI Agents API questions from the official docs, with checked source links.' };
const dir = '/workspace/.managed-agents/plugins/course-docs-49c8e741442cb900';
const templateId = 'envtmpl_ebf1c24a34f94a9cae0cd4b1aaba05a008d911823d524ce8ab';
const restricted = { access: 'restricted' as const, allowed_domains: ['developers.openai.com'] };
const inline: HostedEnvironment = { type: 'openai_hosted', network: restricted, plugins: [{ type: 'inline', ...plugin, source: { type: 'base64', media_type: 'application/zip', data: archivePlaceholder(5_000) } }] };
const fromTemplate: HostedEnvironment = { type: 'openai_hosted', environment_template_id: templateId };

const call = (id: string, name: string, args: unknown, output: string): McpCall => ({ id, server: 'openai_docs', name, status: 'completed', turnId: 'turn_sample', arguments: args, output, isError: false, error: null, kind: 'tool' });
const run = (patch: Partial<PluginRun> & Pick<PluginRun, 'mode' | 'prompt'>): PluginRun => ({
  sessionId: null, templateId: null, turnStatus: 'completed', installed: [plugin], capabilityDirs: [dir], sent: 'ready', readyMs: null,
  calls: [], commands: 0, answer: '', error: null, durationMs: null, fingerprint: '4d4be436', requestChars: 5_323, completion: 'stream', ...patch,
});
const refused = (error: string, durationMs: number, mode: PluginRun['mode'] = 'inline'): PluginRun => run({ mode, prompt: '(sessions.create)', turnStatus: 'failed', installed: [], capabilityDirs: [], error, durationMs, fingerprint: null });
const signature = '\n\nAnswered with course-docs/cite-docs.';
const vaultsPage = 'https://developers.openai.com/api/docs/guides/agents-api/tools/vaults';
const hostedPage = 'https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted';

export const samples: Sample[] = [
  {
    id: 'early', label: 'Asked right away', group: 'install', environment: inline,
    run: run({ mode: 'inline', prompt: 'How do I attach a vault to an Agents API session? Give one link.', sent: 'early', durationMs: 11_913, answer: 'I don’t have a documentation tool available, so this is from training data: attach the vault when creating the session by passing its ID in the session’s `vaults` (or equivalent resources) configuration; subsequent runs on that session inherit it.\n\nhttps://platform.openai.com/docs/guides/tools-file-search' }),
    lesson: 'The input was sent with sessions.create. The session listed course-docs and its capability directory, yet the turn finished in under 12 seconds with no mcp_call and no skill: the hosted environment was not ready yet. The answer is wrong (the field is vault_ids) and so is its link. A second try with network enabled did the same; that environment reported ready 32 s in, 20 s after the answer. The session ID was not recorded for this probe.',
  },
  {
    id: 'inline', label: 'Inline, after ready', group: 'install', environment: inline,
    run: run({
      mode: 'inline', prompt: 'How do I attach a vault to an Agents API session? Give one link.', sessionId: 'sess_04e111f610285c6f006aba2187afb88193ad5a3f33f61d77f0', sent: 'timeout', readyMs: 19_400, durationMs: 136_900,
      calls: [
        call('exec_8ee6bf464493c413fe5d1e0998525941c95dbf71cd21aaf366', 'search_openai_docs', { limit: 5, query: 'Agents API attach vault session' }, `{"hits":[{"url":"${vaultsPage}#attach-the-vault-to-a-hosted-session"}, …]}`),
        call('exec_cd71c172bc1248986fa565000a8b10039422baef10ce505190', 'fetch_openai_doc', { anchor: 'attach-the-vault-to-a-hosted-session', url: vaultsPage }, '### Attach the vault to a hosted session\n\nInclude the following fields alongside `agent` …'),
      ],
      answer: `When creating the hosted session, pass the vault ID in \`vault_ids\` alongside the agent configuration:\n\n\`\`\`json\n{ "vault_ids": ["vault_123"] }\n\`\`\`\n\nIf network access is restricted, also include each credential host in \`environment.network.allowed_domains\`. See [Vaults: Attach the vault to a hosted session](${vaultsPage}#attach-the-vault-to-a-hosted-session).${signature}`,
    }),
    lesson: 'The same question in a new session, created without input. environment.ready arrived 19.4 s later. (This probe waited for environment.connected, which only arrives once a turn starts, so it sent at a 120 s timeout; the app sends at ready.) Now the agent said it was using the course documentation skill, called the plugin’s openai_docs server twice, got vault_ids right, linked the page it fetched, and ended with the skill’s closing line. Network restricted to developers.openai.com was enough.',
  },
  {
    id: 'template', label: 'New session from the template', group: 'install', environment: fromTemplate,
    run: run({
      mode: 'template', prompt: 'What does environment_template_id do in an Agents API session? One link.', sessionId: 'sess_0174fc5ea81ed837006aba224bb2e88193ba53570edeba4230', templateId, sent: 'timeout', readyMs: 19_400, durationMs: 139_500, requestChars: 111,
      calls: [
        call('exec_1eca9bc7349c2867f30cc1f127ae3943c2dacaa0cd0a6fbc3c', 'search_openai_docs', { limit: 5, query: 'environment_template_id Agents API session' }, `{"hits":[{"url":"${hostedPage}#configure-the-sandbox"}, …]}`),
        call('exec_f8739a495de280e5cc55c218733500e86f1d77a07bc0ead8aa', 'fetch_openai_doc', { anchor: 'configure-the-sandbox', url: hostedPage }, '## Configure the sandbox\n\nSet `environment.type` to `openai_hosted` and add only the settings …'),
      ],
      answer: `\`environment_template_id\` lets an OpenAI-hosted session reuse a saved sandbox configuration. Any environment settings you omit inherit from that template, and you cannot use session-level network settings to broaden the template’s network policy. It saves configuration—not a running workspace or its files. [OpenAI-hosted sandboxes](${hostedPage}#configure-the-sandbox)${signature}`,
    }),
    lesson: 'The plugin was stored once with templates.create; the session named only the template ID, a 111-character environment instead of about 5,300. The new session listed course-docs with the same capability directory hash (49c8e741442cb900) as the inline session: the same archive, reused. The template’s response and later retrieve listed the plugin’s name and description, never the archive.',
  },
  {
    id: 'name', label: 'Name differs from plugin.json', group: 'refused', environment: { ...inline, plugins: [{ ...inline.plugins![0], name: 'docs-helper' }] },
    run: refused('400 inline plugin name and description must match its archive manifest', 265),
    lesson: 'The request said docs-helper; the archive’s manifest says course-docs. The API checks both name and description against .codex-plugin/plugin.json. This app always copies them from the manifest it packed.',
  },
  {
    id: 'flat', label: 'Files at the archive root', group: 'refused', environment: inline,
    run: refused('400 capability archives must contain one top-level directory', 172),
    lesson: 'The same files, zipped without the course-docs/ folder around them. The archive must hold the plugin folder itself, as zipping the folder does.',
  },
  {
    id: 'no-manifest', label: 'No manifest in the archive', group: 'refused', environment: inline,
    run: refused('400 plugin archive must contain .codex-plugin/plugin.json', 389),
    lesson: 'A course-docs/ folder with the skill and .mcp.json, but no .codex-plugin/plugin.json. Without the manifest nothing says what the folder is.',
  },
  {
    id: 'not-zip', label: 'Not a ZIP', group: 'refused', environment: inline,
    run: refused('400 capability archive is not a valid ZIP', 193),
    lesson: 'source.data was base64 of the text “hello”. The API reads the archive before it creates the session, so nothing is half-installed.',
  },
  {
    id: 'env-none', label: 'Plugins with environment: none', group: 'refused', environment: null,
    run: refused("400 Unknown parameter: 'environment.plugins'.", 173),
    lesson: 'Plugins install into an execution environment. environment.type none has no plugins field at all: use openai_hosted (or self_hosted with capability_directories).',
  },
  {
    id: 'broaden', label: 'Session broadens the template’s network', group: 'refused', environment: { type: 'openai_hosted', environment_template_id: 'envtmpl_f4e148c891a643e6a3af1d9567d92775aa2dfa51f853463d8b', network: { access: 'enabled' } },
    run: refused('400 session environment.network cannot broaden the environment template network policy', 475, 'template'),
    lesson: 'The template restricts the network to developers.openai.com. A session may narrow that, never widen it. The template is the policy for every session that uses it.',
  },
];
