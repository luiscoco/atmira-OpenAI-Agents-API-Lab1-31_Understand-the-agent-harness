import { checkPlugin, type PluginFile, type PluginRun } from './lab25Plugin.ts';
export function pluginAvailability(files: PluginFile[], run: Pick<PluginRun, 'installed' | 'calls'>) {
  const check = checkPlugin(files); const installed = Boolean(check.manifest && run.installed.some(row => row.name === check.manifest!.name));
  const servers = check.servers.map(server => {
    const calls = run.calls.filter(call => call.server === server.label && call.kind === 'tool');
    return { label: server.label, status: calls.some(call => call.status === 'completed' && !call.isError && !call.error) ? 'observed-success' : calls.some(call => call.status === 'failed' || call.isError || call.error) ? 'observed-failure' : 'unknown', instruction: 'A configured server is not evidence of connectivity. Grounded claims need successful tool results.' };
  });
  return { installed, skills: check.skills.map(skill => ({ name: skill.name, available: installed, body: skill.body })), servers, source: 'Package inspection and supplied call evidence; no live probe' };
}
