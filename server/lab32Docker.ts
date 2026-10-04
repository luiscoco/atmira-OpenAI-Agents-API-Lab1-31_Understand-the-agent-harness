import { spawn } from 'node:child_process';
import { executorImage } from '../src/lab32Environment.ts';

export type ExecutorSpec = { name: string; environmentId: string; remoteUrl: string; nonce: string };
export type ExecutorProvider = {
  preflight(): Promise<void>;
  start(spec: ExecutorSpec): Promise<void>;
  remove(name: string): Promise<void>;
};
export function validContainerName(name: string) { return /^agents-lab32-[a-f0-9]{32}$/.test(name); }
export function executorArgs(spec: ExecutorSpec) {
  if (!validContainerName(spec.name) || !/^[a-f0-9]{16}$/.test(spec.nonce) || !/^[a-zA-Z0-9_-]{1,200}$/.test(spec.environmentId)) throw new Error('Invalid executor spec.');
  const url = new URL(spec.remoteUrl);
  if (url.protocol !== 'wss:' || url.hostname !== 'codex-cloud-environments.chatgpt.com' || url.username || url.password || url.port) throw new Error('Unexpected executor connection host.');
  // Pass the API-returned URL unchanged, as an argv value, never as shell source.
  return ['run', '-d', '--name', spec.name, '--label', 'agents.course.lab=32',
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '128', '--memory', '512m', '--cpus', '1',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m,uid=1000,gid=1000',
    '--tmpfs', '/workspace:rw,nosuid,nodev,size=16m,uid=1000,gid=1000',
    '-e', 'CODEX_API_KEY', '-e', 'LAB32_NONCE', '-e', 'HOME=/tmp/codex-home',
    executorImage, '--remote', spec.remoteUrl, '--environment-id', spec.environmentId];
}
function docker(args: string[], extra: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    // Docker receives only its usual environment and the restricted executor key.
    const env: Record<string, string> = {};
    for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'USERPROFILE', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'TEMP', 'TMP']) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
    Object.assign(env, extra);
    const child = spawn('docker', args, { shell: false, windowsHide: true, env });
    let output = ''; let errors = ''; let oversized = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Docker operation timed out.')); }, 20_000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 32_000) { oversized = true; child.kill(); } });
    child.stderr.on('data', chunk => { errors += chunk; if (errors.length > 32_000) { oversized = true; child.kill(); } });
    child.once('error', () => { clearTimeout(timer); reject(new Error('Docker is unavailable.')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (!oversized && code === 0) resolve(output.trim());
      // Exact target absence is an idempotent cleanup result, not a daemon failure.
      else if (args[0] === 'rm' && errors.includes(`No such container: ${args.at(-1)}`)) resolve('already absent');
      else reject(new Error('Docker operation failed. Check Docker Desktop and the Lab 32 image.'));
    });
  });
}
export function dockerExecutor(executorKey: string): ExecutorProvider {
  return {
    preflight: async () => { await docker(['image', 'inspect', executorImage, '--format', '{{.Id}}']); },
    start: async spec => { await docker(executorArgs(spec), { CODEX_API_KEY: executorKey, LAB32_NONCE: spec.nonce }); },
    remove: async name => {
      if (!validContainerName(name)) throw new Error('Invalid cleanup target.');
      await docker(['rm', '-f', name]);
      const names = await docker(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']);
      if (names.split('\n').includes(name)) throw new Error('Container removal was not confirmed.');
    },
  };
}
