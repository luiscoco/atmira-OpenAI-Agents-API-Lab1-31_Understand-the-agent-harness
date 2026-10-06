import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// Isolated local HTTP proxy test. No public ports, API credentials or ACME requests.
const root = join(import.meta.dirname, '..'), directory = join(root, '.lab-data');
await mkdir(directory, { recursive: true });
try { await stat(join(directory, 'capstone-persistence-checkpoint.json')); throw new Error('An existing restart checkpoint needs verification before this test.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const socket = createServer(); await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = (socket.address() as any).port; await new Promise<void>(resolve => socket.close(() => resolve()));
const suffix = randomUUID().slice(0, 8), prefix = `agents-course-preflight-${suffix}`;
const network = `${prefix}-network`, volume = `${prefix}-data`, app = `${prefix}-workspace`, proxy = `${prefix}-proxy`;
const base = `http://localhost:${port}`, label = 'course.verification=production-preflight';
const report: any = { recordedAt: new Date().toISOString(), source: 'Actual local HTTP reverse proxy, read-only application and disposable persistent Docker volume', target: base, outcome: 'unknown', tls: 'External certificate issuance not tested', liveModel: 'Not run', cleanup: [] };
const created: { kind: 'container' | 'network' | 'volume'; name: string }[] = [];
function run(executable: string, args: string[]) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error(`${executable} ${args[0]} failed: ${(result.error?.message || result.stderr || result.stdout).slice(0, 1000)}`);
  return result.stdout.trim();
}
const docker = (...args: string[]) => run('docker', args);
async function healthy() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { const response = await fetch(`${base}/api/capstone/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok) return; report.readinessError = `Health HTTP ${response.status}`; } catch (error) { report.readinessError = `${error.message}: ${error.cause?.code || ''}`; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Proxy/application readiness was not observed.');
}
try {
  docker('network', 'create', '--label', label, network); created.push({ kind: 'network', name: network });
  docker('volume', 'create', '--label', label, volume); created.push({ kind: 'volume', name: volume });
  docker('run', '-d', '--name', app, '--label', label, '--network', network, '--network-alias', 'workspace', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--mount', `type=volume,source=${volume},target=/data`, '--env', `CAPSTONE_PUBLIC_ORIGIN=${base}`, '--env', 'CAPSTONE_ALLOW_REGISTRATION=true', 'agents-course-capstone:local');
  created.push({ kind: 'container', name: app });
  docker('run', '-d', '--name', proxy, '--label', label, '--network', network, '--read-only', '--tmpfs', '/tmp', '--tmpfs', '/data', '--tmpfs', '/config', '--cap-drop', 'ALL', '--cap-add', 'NET_BIND_SERVICE', '--security-opt', 'no-new-privileges', '--publish', `127.0.0.1:${port}:${port}`, '--env', `CAPSTONE_DOMAIN=${base}`, '--mount', `type=bind,source=${join(root, 'capstone/deploy/Caddyfile')},target=/etc/caddy/Caddyfile,readonly`, 'caddy:2-alpine');
  created.push({ kind: 'container', name: proxy });
  await healthy();
  report.smoke = JSON.parse(run(process.execPath, ['--import', 'tsx', 'scripts/smoke-capstone.ts', base, '--out', join(directory, `${prefix}-smoke.json`)]));
  run(process.execPath, ['--import', 'tsx', 'scripts/check-capstone-persistence.ts', 'record', base]);
  docker('restart', app); await healthy();
  report.persistence = JSON.parse(run(process.execPath, ['--import', 'tsx', 'scripts/check-capstone-persistence.ts', 'verify', base]));
  const inspect = JSON.parse(docker('inspect', app))[0];
  report.readOnlyFilesystem = inspect.HostConfig.ReadonlyRootfs === true;
  report.noPublishedAppPort = Object.values(inspect.NetworkSettings.Ports || {}).every(value => value === null);
  if (!report.readOnlyFilesystem || !report.noPublishedAppPort) throw new Error('Application isolation checks failed.');
  report.outcome = 'pass';
} catch (error) {
  report.error = String(error.message).slice(0, 1000); report.outcome = 'fail'; report.containerDiagnostics = [];
  for (const resource of created.filter(row => row.kind === 'container')) {
    try {
      const inspected = JSON.parse(docker('inspect', resource.name))[0];
      const logs = spawnSync('docker', ['logs', '--tail', '20', resource.name], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 });
      report.containerDiagnostics.push({ name: resource.name, status: inspected.State.Status, exitCode: inspected.State.ExitCode, logs: (logs.stdout + logs.stderr).slice(-4000) });
    } catch {}
  }
}
finally {
  const checkpoint = join(directory, 'capstone-persistence-checkpoint.json');
  try { const saved = JSON.parse(await readFile(checkpoint, 'utf8')); if (saved.target === base) await unlink(checkpoint); }
  catch (error) { if (error.code !== 'ENOENT') report.checkpointCleanupError = String(error.message).slice(0, 500); }
  // Names are unique to this run; only resources created successfully above are removed.
  for (const resource of [...created].reverse()) {
    try {
      const inspected = JSON.parse(docker(resource.kind, 'inspect', resource.name))[0];
      const labels = resource.kind === 'container' ? inspected.Config.Labels : inspected.Labels;
      if (labels?.['course.verification'] !== 'production-preflight') throw new Error('Resource label does not match this test.');
      if (resource.kind === 'container') docker('rm', '-f', resource.name); else docker(resource.kind, 'rm', resource.name);
      report.cleanup.push({ name: resource.name, outcome: 'removed' });
    } catch (error) { report.cleanup.push({ name: resource.name, outcome: 'failed', error: String(error.message).slice(0, 500) }); }
  }
  const output = join(directory, `${prefix}.json`);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outcome: report.outcome, error: report.error, readOnlyFilesystem: report.readOnlyFilesystem, noPublishedAppPort: report.noPublishedAppPort, persistence: report.persistence?.persistenceAcrossRestart, cleanup: report.cleanup, evidence: output, tls: report.tls }));
  if (report.outcome !== 'pass' || report.checkpointCleanupError || report.cleanup.some(row => row.outcome !== 'removed')) process.exitCode = 1;
}
