import { spawn } from 'node:child_process';
import { openSync, closeSync, writeSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HookNotificationCapture } from '../src/nativeHookCapture.ts';

// A stdio transport wrapper for a separately controlled Codex client. No thread,
// turn, model request or hook-trust change is initiated by this wrapper.
const root = resolve(import.meta.dirname, '..'), project = join(root, '.lab-data/lab45-native-project');
const config = join(project, '.codex/hooks.json'), report = join(project, 'report.md');
const output = join(project, 'runtime-notifications.jsonl');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--codex')) throw new Error('Usage: capture-native-hooks.ts [--codex <executable-path>]');
if (!existsSync(config) || !existsSync(report)) throw new Error('Run prepare:hooks before starting the capture transport.');
const descriptor = openSync(output, 'wx', 0o600); // Never overwrite an existing trace.
let failed = false;
const capture = new HookNotificationCapture(config, report, line => writeSync(descriptor, line), () => {
  failed = true; process.stderr.write('Hook capture limit reached; evidence is incomplete. Transport remains available.\n');
});
const child = spawn(args[1] || 'codex', ['app-server', '--listen', 'stdio://'], { cwd: project, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stdout.on('data', chunk => { try { capture.push(chunk); } catch { failed = true; process.stderr.write('Hook evidence write failed; inspect the trace before verification.\n'); } });
child.stdin.on('error', () => { process.stdin.unpipe(child.stdin); });
process.stdout.on('error', () => child.kill());
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('error', () => { failed = true; process.stderr.write('Unable to start Codex app-server; check the executable path.\n'); });
child.on('close', code => {
  try { capture.finish(); } catch { failed = true; }
  closeSync(descriptor); process.stdin.unpipe(child.stdin); process.stdin.pause();
  process.exitCode = failed ? 1 : code ?? 1;
});
