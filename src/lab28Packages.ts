// Lab 28: configure packages and network. Shared by the browser and the server: presets and a config builder, the
// request checker that repeats what the API refused live, the audit and install tasks, the evidence parser that reads
// command output per host, the judge, an environment fingerprint, and the network policy document. No network, no API key.
import type { Finding } from './lab21Search.ts';
import type { TurnStatus } from './lab16Tool.ts';
import { parseCommand, parseUsage, sha256Hex, unwrapCommand, type CommandRun, type NetworkAccess, type Usage } from './lab26Environment.ts';
import { parseFileRef, type FileRef } from './lab27Files.ts';

// ---- The configuration: what the student declares ----

export type Setup = 'lock' | 'none' | 'fail';
export type Config = { python: string[]; system: string[]; npm: string[]; access: NetworkAccess; domains: string[]; setup: Setup };
export type Preset = 'pinned' | 'unpinned' | 'restricted' | 'enabled' | 'bare' | 'typo' | 'broken';
export const lockDir = '/workspace/env';
export const lockPath = `${lockDir}/requirements.lock`;
export const setupCommands: Record<Setup, string | null> = {
  lock: `mkdir -p ${lockDir} && python3 -m pip freeze > ${lockPath}`,
  none: null,
  // A deliberately failing setup command, to see what the API reports when setup fails.
  fail: 'echo checking; exit 3',
};
const tools = { python: ['tabulate==0.9.0'], system: ['jq'], npm: [] as string[] };
export const presets: Record<Preset, { label: string; short: string; note: string; config: Config }> = {
  pinned: { label: 'Pinned, offline', short: 'packages · disabled', note: 'Exact versions, a lock file, and no network at all.', config: { ...tools, access: 'disabled', domains: [], setup: 'lock' } },
  unpinned: { label: 'Unpinned, offline', short: 'tabulate · disabled', note: 'The same, but tabulate without a version.', config: { ...tools, python: ['tabulate'], access: 'disabled', domains: [], setup: 'lock' } },
  restricted: { label: 'Pinned, PyPI allowlist', short: 'restricted', note: 'Only pypi.org and its download host are reachable.', config: { ...tools, access: 'restricted', domains: ['pypi.org', 'files.pythonhosted.org'], setup: 'lock' } },
  enabled: { label: 'Pinned, open network', short: 'enabled', note: 'The beta default: any host. Nothing here needs it.', config: { ...tools, access: 'enabled', domains: [], setup: 'lock' } },
  bare: { label: 'Control: nothing declared', short: 'no packages', note: 'No packages, no setup, network disabled.', config: { python: [], system: [], npm: [], access: 'disabled', domains: [], setup: 'none' } },
  typo: { label: 'A package that does not exist', short: 'provision fails', note: 'Installation fails before the sandbox is ready.', config: { python: ['lab28-no-such-package-xyz==9.9.9'], system: [], npm: [], access: 'disabled', domains: [], setup: 'none' } },
  broken: { label: 'A failing setup command', short: 'exit 3', note: 'A nonzero setup exit prevents the agent from starting.', config: { python: [], system: [], npm: [], access: 'disabled', domains: [], setup: 'fail' } },
};
export const comparison: Preset[] = ['pinned', 'unpinned', 'restricted', 'enabled', 'bare'];

// ---- The two tasks: the same prompt in every run, so the configuration is the only difference ----

export type Task = 'audit' | 'install';
export const auditInstructions = 'You are a careful environment auditor. Get every value by running a command in the sandbox. Never guess. Do not install anything.';
export const auditPrompt = [
  'Audit this sandbox. Reply with exactly these lines, then one sentence:',
  'python: <output of python3 --version>',
  'tabulate: <installed version of the Python package tabulate, or none>',
  'jq: <output of jq --version, or none>',
  `lock_file: <present or missing: ${lockPath}>`,
  'pypi: <reachable or blocked: curl -sS -m 8 -o /dev/null -w "%{http_code}" https://pypi.org/simple/tabulate/>',
  'example: <reachable or blocked: the same curl to https://example.com/>',
  'A site is reachable only if curl printed an HTTP status code.',
].join('\n');
export const installInstructions = 'You are a careful assistant. Run exactly the command asked and report its real output.';
export const installCommand = 'python3 -m pip install --no-cache-dir tabulate==0.9.0';
export const installPrompt = `Run this one command exactly as written: ${installCommand}\nThen report whether it succeeded, the last three lines of its output, and which host it could not reach, if any. Do not try other commands to work around a failure.`;
export const taskInfo: Record<Task, { label: string; note: string; instructions: string; prompt: string }> = {
  audit: { label: 'Audit the sandbox', note: 'Report versions, the lock file, and which hosts answer.', instructions: auditInstructions, prompt: auditPrompt },
  install: { label: 'Install at run time', note: 'pip install tabulate==0.9.0 while the turn runs. Packages and setup are left out, so pip really has to download.', instructions: installInstructions, prompt: installPrompt },
};

// ---- Building and checking ----

export type EnvironmentParam = {
  type: 'openai_hosted';
  network: { access: NetworkAccess; allowed_domains?: string[] };
  packages?: { python?: string[]; system?: string[]; npm?: string[] };
  setup_commands?: Array<{ command: string; cwd?: string }>;
};
export function buildEnvironment(config: Config, task: Task = 'audit'): EnvironmentParam {
  const environment: EnvironmentParam = { type: 'openai_hosted', network: config.access === 'restricted' ? { access: 'restricted', allowed_domains: config.domains } : { access: config.access } };
  if (task === 'install') return environment;
  const packages = Object.fromEntries((['python', 'system', 'npm'] as const).filter((key) => config[key].length).map((key) => [key, config[key]]));
  if (Object.keys(packages).length) environment.packages = packages;
  const command = setupCommands[config.setup];
  if (command) environment.setup_commands = [{ command }];
  return environment;
}
// A fingerprint of exactly what is sent: the same fingerprint must give the same sandbox. Keys in a fixed order.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const fingerprint = (environment: unknown) => sha256Hex(canonical(environment)).slice(0, 12);

// Live 400 message for every package spec the API refused: URLs, credentials, newlines, "--option" prefixes, "; rm -rf /".
export const packageMessage = 'environment packages must be registry package names or version specifications without URLs, credentials, newlines, or leading option prefixes';
const pythonSpec = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?:\[[A-Za-z0-9._,-]+\])?(?:\s*(?:===|==|!=|~=|>=|<=|<|>)\s*[A-Za-z0-9.*+!_-]+(?:\s*,\s*(?:===|==|!=|~=|>=|<=|<|>)\s*[A-Za-z0-9.*+!_-]+)*)?$/;
const npmSpec = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:@[A-Za-z0-9.^~<>=*|+ -]+)?$/;
const systemSpec = /^[a-z0-9][a-z0-9+.-]*(?:=[A-Za-z0-9.+:~-]+)?$/;
const specPattern = { python: pythonSpec, npm: npmSpec, system: systemSpec };
export type Ecosystem = keyof typeof specPattern;
export function checkPackage(ecosystem: Ecosystem, spec: unknown): { level: 'error' | 'warn' | 'ok'; text: string } {
  if (typeof spec !== 'string') return { level: 'error', text: `Invalid type: expected a string, got ${spec === null ? 'null' : typeof spec}.` };
  if (!spec || /[\n\r]|:\/\/|@.*:|^-|[;&|`$]/.test(spec) || !specPattern[ecosystem].test(spec)) return { level: 'error', text: packageMessage };
  return isPinned(ecosystem, spec)
    ? { level: 'ok', text: `${spec}: exact version.` }
    : { level: 'warn', text: ecosystem === 'system' ? `${spec}: system packages come from the image’s package index; record the version the sandbox reports.` : `${spec}: not pinned. The version is whatever the index serves today (live: tabulate resolved to 0.10.0, not 0.9.0).` };
}
export function isPinned(ecosystem: Ecosystem, spec: string): boolean {
  if (ecosystem === 'python') return /^[^=<>!~]+={2,3}\s*[0-9][A-Za-z0-9.+!_-]*$/.test(spec) && !spec.includes('*');
  if (ecosystem === 'npm') return /@\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(spec.replace(/^@[^/]+\//, ''));
  return /=/.test(spec);
}
export const packageName = (spec: string) => spec.replace(/^(@[^/]+\/[^@]+|[^@=<>!~\s[;]+).*$/, '$1').toLowerCase();

// Live, 2026-09-28: wildcards → "wildcard environment allowed_domains are not supported"; scheme, path, or port → "contains
// an invalid host"; 101 → "supports at most 100 domains". An IP literal, upper case, a trailing dot, and localhost were accepted.
const hostPattern = /^(?=.{1,253}\.?$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.?$/;
export const domainLimit = 100;
export function checkDomain(domain: unknown): { level: 'error' | 'warn' | 'ok'; text: string } {
  if (typeof domain !== 'string' || !domain) return { level: 'error', text: 'environment.network.allowed_domains contains an invalid host' };
  if (domain.includes('*')) return { level: 'error', text: 'wildcard environment allowed_domains are not supported' };
  if (!hostPattern.test(domain)) return { level: 'error', text: `environment.network.allowed_domains contains an invalid host (“${domain}”: no scheme, path, or port)` };
  if (/^\d+(?:\.\d+){3}$/.test(domain)) return { level: 'warn', text: `${domain}: an IP literal was accepted, but a CDN changes addresses. Name the host.` };
  if (domain === 'localhost') return { level: 'warn', text: 'localhost was accepted, but it is the sandbox itself: it needs no entry.' };
  if (domain.endsWith('.') || /[A-Z]/.test(domain)) return { level: 'warn', text: `${domain} was accepted and echoed exactly as written. Write host names in lower case, without a trailing dot.` };
  return { level: 'ok', text: `${domain}${hostReasons[domain] ? `: ${hostReasons[domain]}` : ''}` };
}
// Why a host is on the list, for the policy document. Unknown hosts get a reason to fill in.
export const hostReasons: Record<string, string> = {
  'pypi.org': 'the Python package index (the simple API pip queries)',
  'files.pythonhosted.org': 'where pip downloads the files pypi.org points to',
  'registry.npmjs.org': 'the npm registry',
  'github.com': 'source hosting',
  'example.com': 'a test host with no role in the task',
};

const hostedKeys = ['type', 'capability_directories', 'env', 'environment_template_id', 'files', 'network', 'packages', 'plugins', 'setup_commands', 'skills'];
export const setupLimit = 16;
// Checks an edited environment the way the API answered on 2026-09-28.
export function checkRequest(raw: unknown): { environment: unknown; findings: Finding[] } {
  const findings: Finding[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { environment: null, findings: [{ level: 'error', text: 'environment must be a JSON object.' }] };
  const value = raw as Record<string, unknown>;
  // Live: 400 Unknown parameter: 'environment.packages'.
  if (value.type === 'none') {
    const extra = Object.keys(value).filter((key) => key !== 'type');
    return extra.length
      ? { environment: null, findings: extra.map((key) => ({ level: 'error' as const, text: `Unknown parameter: 'environment.${key}'. A none environment has no sandbox to install into.` })) }
      : { environment: value, findings: [{ level: 'ok', text: 'none: no sandbox, so no packages and no network policy.' }] };
  }
  if (value.type !== 'openai_hosted') return { environment: null, findings: [{ level: 'error', text: `Invalid value: '${String(value.type ?? '')}'. Supported values are: 'none', 'openai_hosted', and 'self_hosted'.` }] };
  for (const key of Object.keys(value).filter((item) => !hostedKeys.includes(item))) findings.push({ level: 'error', text: `Unknown parameter: 'environment.${key}'.` });

  const network = value.network as Record<string, unknown> | undefined | null;
  if (network === undefined || network === null) {
    findings.push({ level: 'warn', text: 'No network policy: beta requests default to enabled, so the sandbox can reach any host. Say what the task needs.' });
  } else if (typeof network !== 'object' || Array.isArray(network)) {
    findings.push({ level: 'error', text: 'environment.network must be an object.' });
  } else {
    const access = network.access;
    const domains = network.allowed_domains;
    for (const key of Object.keys(network).filter((item) => !['access', 'allowed_domains', 'blocked_domains'].includes(item))) findings.push({ level: 'error', text: `Unknown parameter: 'environment.network.${key}'.` });
    // Live: 400 network.blocked_domains is not enabled for this organization.
    if ('blocked_domains' in network) findings.push({ level: 'error', text: 'network.blocked_domains is not enabled for this organization (live 400). Allow what the task needs instead of blocking what it does not.' });
    if (!['disabled', 'enabled', 'restricted'].includes(String(access))) findings.push({ level: 'error', text: `Invalid value: '${String(access ?? '')}'. Supported values are: 'enabled', 'disabled', and 'restricted'.` });
    else if (access === 'restricted' && (!Array.isArray(domains) || !domains.length) && !('blocked_domains' in network)) findings.push({ level: 'error', text: 'environment.network.access=restricted requires allowed_domains or blocked_domains' });
    else if (access === 'disabled' && Array.isArray(domains) && domains.length) findings.push({ level: 'error', text: 'environment.network.allowed_domains cannot be set when access is disabled' });
    else if (access === 'enabled' && Array.isArray(domains) && domains.length) findings.push({ level: 'warn', text: 'allowed_domains only applies when access is restricted; with enabled every host is reachable.' });
    if (domains !== undefined && domains !== null && !Array.isArray(domains)) findings.push({ level: 'error', text: 'environment.network.allowed_domains must be an array of host names.' });
    if (Array.isArray(domains)) {
      if (domains.length > domainLimit) findings.push({ level: 'error', text: `environment.network.allowed_domains supports at most ${domainLimit} domains` });
      const wildcard = domains.find((domain) => typeof domain === 'string' && domain.includes('*'));
      if (wildcard) findings.push({ level: 'error', text: 'wildcard environment allowed_domains are not supported' });
      for (const domain of domains.slice(0, domainLimit)) {
        if (typeof domain === 'string' && domain.includes('*')) continue;
        const issue = checkDomain(domain);
        if (issue.level !== 'ok') findings.push({ level: issue.level, text: issue.text });
      }
      if (access === 'restricted' && domains.includes('pypi.org') && !domains.includes('files.pythonhosted.org')) findings.push({ level: 'warn', text: 'pypi.org without files.pythonhosted.org: pip can read the index but not download a file (live: ProxyError, Tunnel connection failed: 403). Redirect targets need their own entries.' });
    }
    if (access === 'disabled') findings.push({ level: 'ok', text: 'network disabled: no outbound connections. Declared packages are still installed while the sandbox is prepared.' });
    if (access === 'enabled') findings.push({ level: 'warn', text: 'network enabled: every host is reachable from the sandbox. Choose disabled or restricted unless the task needs the open internet.' });
    if (access === 'restricted' && Array.isArray(domains) && domains.length) findings.push({ level: 'ok', text: `network restricted to ${domains.length} host${domains.length === 1 ? '' : 's'}; every other host is refused by the proxy (live: CONNECT tunnel failed, response 403).` });
  }

  const packages = value.packages as Record<string, unknown> | undefined | null;
  if (packages !== undefined && packages !== null) {
    if (typeof packages !== 'object' || Array.isArray(packages)) findings.push({ level: 'error', text: 'environment.packages must be an object with python, system, and npm lists.' });
    else {
      for (const key of Object.keys(packages).filter((item) => !['python', 'system', 'npm'].includes(item))) findings.push({ level: 'error', text: `Unknown parameter: 'environment.packages.${key}'.${key === 'pip' ? ' Python packages go in python.' : key === 'apt' ? ' System packages go in system.' : ''}` });
      for (const ecosystem of ['python', 'system', 'npm'] as const) {
        const list = packages[ecosystem];
        if (list === undefined || list === null) continue;
        if (!Array.isArray(list)) { findings.push({ level: 'error', text: `Invalid type for 'environment.packages.${ecosystem}': expected an array of strings, but got ${typeof list === 'string' ? 'a string' : typeof list} instead.` }); continue; }
        for (const spec of list) {
          const issue = checkPackage(ecosystem, spec);
          findings.push({ level: issue.level, text: `packages.${ecosystem}: ${issue.text}` });
        }
        if (list.length > 20) findings.push({ level: 'warn', text: `${list.length} ${ecosystem} packages: accepted live (101 were), but every package adds to the time before environment.ready.` });
      }
    }
  }

  const setup = value.setup_commands;
  if (setup !== undefined && setup !== null) {
    if (!Array.isArray(setup)) findings.push({ level: 'error', text: 'environment.setup_commands must be an array of { command, cwd? } objects.' });
    else {
      if (setup.length > setupLimit) findings.push({ level: 'error', text: `Invalid 'environment.setup_commands': array too long. Expected an array with maximum length ${setupLimit}, but got an array with length ${setup.length} instead.` });
      setup.slice(0, setupLimit).forEach((entry, index) => {
        const where = `environment.setup_commands[${index}]`;
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) { findings.push({ level: 'error', text: `Invalid type for '${where}': expected an object, but got ${typeof entry === 'string' ? 'a string' : typeof entry} instead.` }); return; }
        const item = entry as Record<string, unknown>;
        if (typeof item.command !== 'string' || !item.command) findings.push({ level: 'error', text: `Missing required parameter: '${where}.command'.` });
        if (item.cwd !== undefined && item.cwd !== null && (typeof item.cwd !== 'string' || !item.cwd.startsWith('/'))) findings.push({ level: 'error', text: `setup_commands[${index}].cwd must be an absolute path without NUL bytes` });
        if (typeof item.command === 'string' && /\b(?:pip|npm|apt(?:-get)?)\s+install\b/.test(item.command)) findings.push({ level: 'warn', text: `${where} installs software: declare it in packages instead, where the version is echoed back and checked.` });
      });
      if (setup.length) findings.push({ level: 'ok', text: `${setup.length} setup command${setup.length === 1 ? '' : 's'}, run in order after packages and files. Their bodies are confidential: the session does not echo them, and a nonzero exit stops the agent from starting.` });
    }
  }
  if (findings.some((item) => item.level === 'error')) return { environment: null, findings };
  findings.unshift({ level: 'ok', text: 'openai_hosted: the API checks every package spec, host, and setup command before it creates the session.' });
  return { environment: value, findings };
}

// The server builds the environment from a checked config, never from a raw request.
export const listLimit = 12;
export function checkConfig(raw: unknown): { config: Config | null; findings: Finding[] } {
  const value = (raw ?? {}) as Record<string, unknown>;
  const strings = (list: unknown) => (Array.isArray(list) && list.length <= listLimit && list.every((item) => typeof item === 'string') ? (list as string[]).map((item) => item.trim()).filter(Boolean) : null);
  const python = strings(value.python ?? []); const system = strings(value.system ?? []); const npm = strings(value.npm ?? []); const domains = strings(value.domains ?? []);
  if (!python || !system || !npm || !domains) return { config: null, findings: [{ level: 'error', text: `Each list must be an array of at most ${listLimit} strings.` }] };
  const access = ['disabled', 'enabled', 'restricted'].includes(String(value.access)) ? value.access as NetworkAccess : null;
  if (!access) return { config: null, findings: [{ level: 'error', text: 'access must be disabled, enabled, or restricted.' }] };
  const setup: Setup = value.setup === 'lock' || value.setup === 'fail' ? value.setup : 'none';
  const config: Config = { python, system, npm, access, domains: access === 'restricted' ? domains : [], setup };
  const checked = checkRequest(buildEnvironment(config));
  return { config: checked.environment ? config : null, findings: checked.findings };
}

// ---- A run and its evidence ----

export type Echo = { packages: { python: string[]; system: string[]; npm: string[] }; network: { access: string; allowed_domains: string[] } };
export type ErrorKind = 'provision' | 'environment' | 'account' | 'other';
export type ConfigRun = {
  task: Task; preset: Preset | null; config: Config; prompt: string; model: string; fingerprint: string;
  sessionId: string | null; environmentId: string | null; echo: Echo | null; listed: FileRef[] | null;
  turnStatus: TurnStatus; readyMs: number | null; durationMs: number | null;
  commands: CommandRun[]; commentary: string[]; answer: string; error: string | null; errorKind: ErrorKind | null; usage: Usage | null; completion: 'stream' | 'polled';
};

const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const stringOrNull = (value: unknown) => (typeof value === 'string' ? value : null);
const stringList = (list: unknown) => (Array.isArray(list) ? list.map(String) : []);
export function parseEcho(raw: unknown): Echo | null {
  const value = raw as { packages?: Record<string, unknown>; network?: Record<string, unknown> } | null;
  if (!value || typeof value !== 'object' || !value.network) return null;
  return {
    packages: { python: stringList(value.packages?.python), system: stringList(value.packages?.system), npm: stringList(value.packages?.npm) },
    network: { access: String(value.network.access ?? ''), allowed_domains: stringList(value.network.allowed_domains) },
  };
}
const turnStatuses: TurnStatus[] = ['completed', 'failed', 'cancelled', 'waiting', 'unknown'];
const presetIds = Object.keys(presets) as Preset[];
const errorKinds: ErrorKind[] = ['provision', 'environment', 'account', 'other'];
// The browser checks the server's summary before trusting it.
export function parseConfigRun(raw: unknown): ConfigRun {
  const value = (raw ?? {}) as Record<string, unknown>;
  const checked = checkConfig(value.config);
  const config = checked.config ?? presets.bare.config;
  const task: Task = value.task === 'install' ? 'install' : 'audit';
  return {
    task, preset: presetIds.includes(value.preset as Preset) ? value.preset as Preset : null, config, prompt: String(value.prompt ?? ''), model: String(value.model ?? ''),
    fingerprint: fingerprint(buildEnvironment(config, task)),
    sessionId: stringOrNull(value.sessionId), environmentId: stringOrNull(value.environmentId), echo: parseEcho(value.echo),
    listed: Array.isArray(value.listed) ? value.listed.map(parseFileRef) : null,
    turnStatus: turnStatuses.includes(value.turnStatus as TurnStatus) ? value.turnStatus as TurnStatus : 'unknown',
    readyMs: numberOrNull(value.readyMs), durationMs: numberOrNull(value.durationMs),
    commands: Array.isArray(value.commands) ? value.commands.map(parseCommand) : [],
    commentary: stringList(value.commentary), answer: String(value.answer ?? ''), error: stringOrNull(value.error),
    errorKind: errorKinds.includes(value.errorKind as ErrorKind) ? value.errorKind as ErrorKind : null,
    usage: parseUsage(value.usage), completion: value.completion === 'polled' ? 'polled' : 'stream',
  };
}
// Live: an unknown package once ended the event stream with "Failed to provision environment: script "Python package
// installation" failed with exit code 1: …", and once gave only environment.failed "The environment failed to connect.",
// as a failing setup command did.
export function classifyError(message: string): ErrorKind {
  if (/usage or billing limit|insufficient_quota|exceeded your current quota|billing/i.test(message)) return 'account';
  if (/Failed to provision environment|package installation/i.test(message)) return 'provision';
  if (/environment failed|environment_connection_failed/i.test(message)) return 'environment';
  return 'other';
}
// The line that says why pip gave up: "No matching distribution found for …".
export const provisionReason = (message: string) => /ERROR: (No matching distribution[^\n]*)/.exec(message)?.[1] ?? /ERROR: ([^\n]+)/.exec(message)?.[1] ?? null;

// ---- Reading the audit ----

export type HostId = 'pypi' | 'example';
export const hosts: Record<HostId, { host: string; url: string }> = {
  pypi: { host: 'pypi.org', url: 'https://pypi.org/simple/tabulate/' },
  example: { host: 'example.com', url: 'https://example.com/' },
};
export type Reach = 'reachable' | 'blocked';
export type Audit = { python: string | null; tabulate: string | null; jq: string | null; lockFile: 'present' | 'missing' | null; pypi: Reach | null; example: Reach | null };
const field = (answer: string, name: string) => new RegExp(`^[ \\t>*_\`-]*${name}[*_\`]*[ \\t]*[:=][ \\t*_\`]*([^\\n\`*]+)`, 'im').exec(answer)?.[1]?.trim() ?? null;
const reach = (text: string | null): Reach | null => (text === null ? null : /^blocked/i.test(text) ? 'blocked' : /^reachable/i.test(text) ? 'reachable' : null);
export function parseAudit(answer: string): Audit {
  const python = field(answer, 'python');
  const tabulate = field(answer, 'tabulate');
  const jq = field(answer, 'jq');
  const lock = field(answer, 'lock_file');
  return {
    python: python ? (/(\d+\.\d+\.\d+)/.exec(python)?.[1] ?? python) : null,
    tabulate: tabulate ? (/^(?:none|not installed)/i.test(tabulate) ? 'none' : /(\d+(?:\.\d+)+)/.exec(tabulate)?.[1] ?? tabulate) : null,
    jq: jq ? (/^(?:none|not installed)/i.test(jq) ? 'none' : /(\d+(?:\.\d+)+)/.exec(jq)?.[1] ?? jq) : null,
    lockFile: lock ? (/^present/i.test(lock) ? 'present' : /^missing/i.test(lock) ? 'missing' : null) : null,
    pypi: reach(field(answer, 'pypi')), example: reach(field(answer, 'example')),
  };
}

// curl's own error lines ("curl: (56) CONNECT tunnel failed, response 403") hold a 403 from the proxy, not the site.
const withoutCurlErrors = (output: string) => output.replace(/curl: \(\d+\)[^\n]*/g, '\n');
const statusCodes = (text: string) => [...text.matchAll(/(?<![\d.])(\d{3})(?![\d.])/g)].map((match) => match[1]);
export type HostEvidence = { code: string | null; reach: Reach | null; commandId: string | null; mislabeled: boolean };
// What the sandbox printed for one host. Labels in the output ("pypi: …", "--PYPI--") split a combined command; without
// labels, the status codes are taken in the order the hosts appear in the command.
export function hostEvidence(commands: CommandRun[], id: HostId): HostEvidence {
  const target = hosts[id].host;
  const others = (Object.keys(hosts) as HostId[]).filter((item) => item !== id);
  for (const command of commands) {
    const text = unwrapCommand(command.command);
    if (!text.includes(target) || !/\bcurl\b/.test(text)) continue;
    const output = command.output ?? '';
    const clean = withoutCurlErrors(output);
    const mentioned = (Object.keys(hosts) as HostId[]).filter((item) => text.includes(hosts[item].host)).sort((a, b) => text.indexOf(hosts[a].host) - text.indexOf(hosts[b].host));
    let segment = clean;
    let codes: string[];
    const label = new RegExp(id, 'i');
    if (mentioned.length > 1 && label.test(clean)) {
      const start = clean.search(label);
      const rest = clean.slice(start + id.length);
      const ends = others.map((other) => rest.search(new RegExp(other, 'i'))).filter((index) => index >= 0);
      segment = rest.slice(0, ends.length ? Math.min(...ends) : undefined);
      codes = statusCodes(segment);
    } else {
      const all = statusCodes(clean);
      codes = mentioned.length > 1 ? (all[mentioned.indexOf(id)] ? [all[mentioned.indexOf(id)]] : []) : all;
    }
    const code = codes[0] ?? null;
    const blockedText = /CONNECT tunnel failed|Could not resolve host|Tunnel connection failed|timed out/i.test(output);
    const result: Reach | null = code === null ? (blockedText && mentioned.length === 1 ? 'blocked' : null) : code === '000' ? 'blocked' : Number(code) >= 100 && Number(code) < 600 ? 'reachable' : null;
    if (result) return { code, reach: result, commandId: command.id, mislabeled: result === 'blocked' && /reachable/i.test(segment) };
  }
  return { code: null, reach: null, commandId: null, mislabeled: false };
}
// A value is grounded when it appears, as a whole token, in the output of a command the session ran.
export const grounded = (value: string, commands: CommandRun[]) => commands.some((command) => new RegExp(`(^|[^0-9A-Za-z.])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^0-9A-Za-z])`, 'm').test(command.output ?? ''));

// What the audit must say under a configuration.
export type Expected = { tabulate: string | 'none' | 'any'; jq: 'present' | 'none'; lockFile: 'present' | 'missing'; pypi: Reach; example: Reach };
export function allows(config: Config, host: string): boolean {
  return config.access === 'enabled' || (config.access === 'restricted' && config.domains.map((domain) => domain.toLowerCase().replace(/\.$/, '')).includes(host));
}
export function expectedAudit(config: Config): Expected {
  const spec = config.python.find((item) => packageName(item) === 'tabulate') ?? null;
  const pin = spec && isPinned('python', spec) ? spec.split(/={2,3}/)[1].trim() : null;
  return {
    tabulate: spec === null ? 'none' : pin ?? 'any',
    jq: config.system.some((item) => packageName(item) === 'jq') ? 'present' : 'none',
    lockFile: config.setup === 'lock' ? 'present' : 'missing',
    pypi: allows(config, 'pypi.org') ? 'reachable' : 'blocked',
    example: allows(config, 'example.com') ? 'reachable' : 'blocked',
  };
}
export const unpinned = (config: Config) => [...config.python.filter((spec) => !isPinned('python', spec)), ...config.npm.filter((spec) => !isPinned('npm', spec))];

export type Outcome = 'reproducible' | 'baseline' | 'drift' | 'open' | 'ungrounded' | 'misreported' | 'breach' | 'installed' | 'blocked' | 'incomplete' | 'failed';
export type CheckLevel = 'ok' | 'warn' | 'fail' | 'skip';
export type Check = { id: string; label: string; level: CheckLevel; detail: string };
export type Verdict = { outcome: Outcome; title: string; text: string; checks: Check[] };
export const outcomeTone: Record<Outcome, string> = { reproducible: 'can', baseline: 'can', installed: 'can', drift: 'gap', open: 'gap', ungrounded: 'gap', blocked: 'gap', incomplete: 'gap', misreported: 'breach', breach: 'breach', failed: 'failed' };
const seconds = (ms: number | null) => (ms === null ? 'an unknown time' : `${(ms / 1000).toFixed(1)} s`);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

// 1. Did the API take the configuration as sent? The echo is the first evidence; setup bodies are never in it.
function echoCheck(run: ConfigRun): Check {
  const sent = buildEnvironment(run.config, run.task);
  if (!run.echo) return { id: 'echo', label: 'Declared and echoed', level: 'skip', detail: run.sessionId ? 'The session did not report its environment.' : 'No session was created.' };
  const packagesOk = (['python', 'system', 'npm'] as const).every((key) => same(run.echo!.packages[key], sent.packages?.[key] ?? []));
  const networkOk = run.echo.network.access === sent.network.access && same(run.echo.network.allowed_domains, sent.network.allowed_domains ?? []);
  const listed = [...run.echo.packages.python, ...run.echo.packages.system, ...run.echo.packages.npm];
  return { id: 'echo', label: 'Declared and echoed', level: packagesOk && networkOk ? 'ok' : 'fail',
    detail: packagesOk && networkOk ? `session.environment echoes packages ${listed.length ? listed.join(', ') : '(none)'}; network ${run.echo.network.access}${run.echo.network.allowed_domains.length ? ` (${run.echo.network.allowed_domains.join(', ')})` : ''}.${sent.setup_commands ? ' The setup command is not in the echo: bodies are confidential.' : ''}` : `The echo differs from the request: ${packagesOk ? '' : 'packages '}${networkOk ? '' : 'network'}.` };
}

export function judgeConfigRun(run: ConfigRun): Verdict {
  const checks: Check[] = [echoCheck(run)];
  const provisioned = run.readyMs !== null;
  checks.push({ id: 'ready', label: 'Sandbox prepared', level: provisioned ? 'ok' : run.errorKind === 'provision' || run.errorKind === 'environment' ? 'fail' : 'skip',
    detail: provisioned ? `environment.ready after ${seconds(run.readyMs)}${buildEnvironment(run.config, run.task).packages ? ' (packages are installed before ready, even with network disabled)' : ''}.` : run.errorKind === 'provision' ? 'Package installation failed: the sandbox never became ready.' : run.errorKind === 'environment' ? 'environment.failed: the sandbox never became ready.' : 'No environment.ready event.' });

  if (run.error) {
    if (run.errorKind === 'account') return { outcome: 'failed', title: 'Blocked: usage or billing limit', text: 'The API refused the turn. This is an account limit, not a configuration problem.', checks };
    if (run.errorKind === 'provision') {
      const reason = provisionReason(run.error);
      return { outcome: 'failed', title: 'Package installation failed', text: `The session was created (the spec was valid), but installing it failed: ${reason ?? run.error}. The agent never started. Check the name and version against the index.`, checks };
    }
    if (run.errorKind === 'environment') {
      // Live: a failing setup command and (in one of two runs) an unknown package both gave only "The environment failed to connect."
      const sent = buildEnvironment(run.config, run.task);
      const said = `environment.failed: “${run.error.replace(/^.*?: /, '').replace(/\.$/, '')}”.`;
      if (sent.setup_commands && sent.packages) return { outcome: 'failed', title: 'Setup or package installation failed', text: `${said} The API does not say which. Remove the setup command, run again, and the answer tells you.`, checks };
      if (sent.setup_commands) return { outcome: 'failed', title: 'Setup command failed', text: `${said} The API does not return the setup command or its output, because setup is confidential. A nonzero setup exit stops the agent from starting: run the command in a bare sandbox first.`, checks };
      if (sent.packages) return { outcome: 'failed', title: 'Package installation failed', text: `${said} Packages were the only thing to prepare, so one of them is the cause: check each name and version against its index. Another live run of the same request named the reason: “No matching distribution found”.`, checks };
      return { outcome: 'failed', title: 'Environment failed', text: run.error, checks };
    }
  }
  if (run.error || run.turnStatus === 'failed' || run.turnStatus === 'cancelled') return { outcome: 'failed', title: 'Failed', text: run.error ?? `The turn ${run.turnStatus}.`, checks };
  return run.task === 'install' ? judgeInstall(run, checks) : judgeAudit(run, checks);
}

function judgeAudit(run: ConfigRun, checks: Check[]): Verdict {
  const { config } = run;
  const expected = expectedAudit(config);
  const audit = parseAudit(run.answer);
  // 2. The lock file: the setup command's only visible trace, confirmed by the API's own file listing.
  const lockListed = run.listed?.find((file) => file.path === lockPath) ?? null;
  if (config.setup === 'lock') checks.push({ id: 'setup', label: 'Setup command ran', level: lockListed ? 'ok' : run.listed ? 'fail' : 'warn', detail: lockListed ? `environments.files.list shows ${lockPath} (${lockListed.sizeBytes ?? '?'} bytes): the setup command ran before the agent started.` : run.listed ? `environments.files.list does not show ${lockPath}.` : 'The environment was not listed.' });
  else checks.push({ id: 'setup', label: 'Setup command ran', level: 'skip', detail: 'No setup command declared.' });

  // 3. Versions: what the reply says, what a command printed, and what the configuration pinned.
  const mismatches: string[] = [];
  const ungrounded: string[] = [];
  const version = (name: 'tabulate' | 'jq', reported: string | null, want: string) => {
    if (reported === null) { mismatches.push(`${name} not reported`); return; }
    if (reported !== 'none' && !grounded(reported, run.commands)) ungrounded.push(name);
    if (want === 'none' && reported !== 'none') mismatches.push(`${name} ${reported}, but nothing was declared`);
    if (want === 'present' && reported === 'none') mismatches.push(`${name} missing, but it was declared`);
    if (want !== 'none' && want !== 'present' && want !== 'any' && reported !== want) mismatches.push(`${name} ${reported}, pinned ${want}`);
    if (want === 'any' && reported === 'none') mismatches.push(`${name} missing, but it was declared`);
  };
  version('tabulate', audit.tabulate, expected.tabulate);
  version('jq', audit.jq, expected.jq);
  const drift = unpinned(config);
  checks.push({ id: 'packages', label: 'Installed versions', level: mismatches.length ? 'fail' : drift.length ? 'warn' : 'ok',
    detail: mismatches.length ? `${mismatches.join('; ')}.` : `tabulate ${audit.tabulate}, jq ${audit.jq}${audit.python ? `, Python ${audit.python}` : ''}${drift.length ? `. Unpinned: ${drift.join(', ')}. Another day may install another version.` : expected.tabulate === 'none' ? ': nothing declared, nothing installed.' : ': as pinned.'}` });
  if (audit.lockFile && audit.lockFile !== expected.lockFile) mismatches.push(`lock_file ${audit.lockFile}, expected ${expected.lockFile}`);

  // 4. The network: the policy predicts each host; a command's output shows it; the reply reports it.
  const misreports: string[] = [];
  const breaches: string[] = [];
  const mislabeled: string[] = [];
  let traced = 0;
  for (const id of Object.keys(hosts) as HostId[]) {
    const evidence = hostEvidence(run.commands, id);
    const said = audit[id];
    const want = expected[id];
    if (evidence.reach) traced += 1;
    if (evidence.mislabeled) mislabeled.push(hosts[id].host);
    if (said && evidence.reach && said !== evidence.reach) misreports.push(`${hosts[id].host}: the reply says ${said}, the command printed ${evidence.code}`);
    const observed = evidence.reach ?? said;
    if (observed && observed !== want) breaches.push(`${hosts[id].host} ${observed}, but the policy ${want === 'blocked' ? 'blocks' : 'allows'} it`);
  }
  const hostLine = (id: HostId) => { const evidence = hostEvidence(run.commands, id); return `${hosts[id].host} ${evidence.code ?? '—'} → ${evidence.reach ?? 'not traced'} (policy: ${expected[id]})`; };
  checks.push({ id: 'network', label: `Network ${config.access}`, level: breaches.length ? 'fail' : traced < 2 || mislabeled.length || config.access === 'enabled' ? 'warn' : 'ok',
    detail: `${hostLine('pypi')}; ${hostLine('example')}.${mislabeled.length ? ` A command labelled ${mislabeled.join(' and ')} “reachable” next to 000: read the code, not the label.` : ''}${config.access === 'enabled' ? ' Open to every host, and this task needs none.' : ''}` });
  checks.push({ id: 'claims', label: 'Reply matches the evidence', level: misreports.length ? 'fail' : ungrounded.length ? 'warn' : 'ok',
    detail: misreports.length ? `${misreports.join('; ')}.` : ungrounded.length ? `${ungrounded.join(' and ')} do${ungrounded.length === 1 ? 'es' : ''} not appear in any command output.` : 'Every reported version and host result appears in a command’s output.' });

  const lines = [audit.python, audit.tabulate, audit.jq, audit.lockFile, audit.pypi, audit.example].filter((item) => item !== null).length;
  if (lines < 4) return { outcome: 'incomplete', title: 'Audit incomplete', text: `The reply has ${lines} of the 6 audit lines.`, checks };
  if (misreports.length) return { outcome: 'misreported', title: 'The reply contradicts the sandbox', text: `${misreports[0]}. Trust the command output.`, checks };
  if (breaches.length || mismatches.length) return { outcome: 'breach', title: breaches.length ? 'The network did not follow the policy' : 'Not what was declared', text: `${[...breaches, ...mismatches].join('; ')}.`, checks };
  if (ungrounded.length || traced < 2) return { outcome: 'ungrounded', title: 'Right answers, thin evidence', text: 'The reply matches the configuration, but not every value can be traced to a command’s output.', checks };
  if (config.access === 'enabled') return { outcome: 'open', title: 'Works, but the network is open', text: 'Everything matches, and every host answered. This audit needs no network: disabled (or an allowlist) makes the same run safer.', checks };
  if (drift.length) return { outcome: 'drift', title: 'Works today, not reproducible', text: `${drift.join(', ')} resolved to whatever the index served (tabulate ${audit.tabulate}). Pin the version you tested: tabulate==${audit.tabulate}.`, checks };
  if (expected.tabulate === 'none' && expected.jq === 'none') return { outcome: 'baseline', title: 'Control: nothing declared, nothing there', text: 'No tabulate, no jq, no lock file, and no host answered. Every difference in the other runs comes from the configuration.', checks };
  return { outcome: 'reproducible', title: 'Reproducible, with a documented policy', text: `Every package is pinned and installed as declared, the lock file exists, and each host behaved as the ${config.access} policy says.${run.readyMs !== null ? ` Ready after ${seconds(run.readyMs)}.` : ''}`, checks };
}

// ---- Installing at run time ----

export type InstallEvidence = { command: CommandRun | null; succeeded: boolean | null; blockedHost: string | null };
export function installEvidence(commands: CommandRun[]): InstallEvidence {
  const command = [...commands].reverse().find((item) => /pip3?\b[^\n]*\binstall\b/.test(unwrapCommand(item.command))) ?? null;
  if (!command) return { command: null, succeeded: null, blockedHost: null };
  const output = command.output ?? '';
  const blockedHost = /host='([^']+)'/.exec(output)?.[1] ?? /Could not resolve host:? '?([A-Za-z0-9.-]+)/.exec(output)?.[1] ?? null;
  return { command, succeeded: command.exitCode === 0 && /Successfully installed|Requirement already satisfied/.test(output), blockedHost };
}
function judgeInstall(run: ConfigRun, checks: Check[]): Verdict {
  const { config } = run;
  const evidence = installEvidence(run.commands);
  const shouldWork = allows(config, 'pypi.org') && allows(config, 'files.pythonhosted.org');
  checks.push({ id: 'install', label: 'pip install', level: evidence.command === null ? 'fail' : evidence.succeeded ? 'ok' : 'warn',
    detail: evidence.command === null ? 'No pip install command ran.' : evidence.succeeded ? `exit 0 in ${seconds(evidence.command.durationMs)}: “Successfully installed tabulate-0.9.0”.` : `exit ${evidence.command.exitCode}${evidence.blockedHost ? `: could not reach ${evidence.blockedHost}` : ''}.` });
  checks.push({ id: 'policy', label: 'Policy predicted it', level: evidence.succeeded === null ? 'skip' : evidence.succeeded === shouldWork ? 'ok' : 'fail',
    detail: shouldWork ? 'The policy allows pypi.org and files.pythonhosted.org, so pip can both query and download.' : config.access === 'disabled' ? 'Network disabled: pip cannot reach any index.' : `Allowed: ${config.domains.join(', ') || 'nothing'}. pip needs pypi.org and files.pythonhosted.org.` });
  checks.push({ id: 'repro', label: 'Reproducible', level: 'warn', detail: 'An install during the turn is not in the session’s echo, runs after the agent starts, and needs the network open. Declared packages avoid all three.' });
  if (!evidence.command) return { outcome: 'incomplete', title: 'Nothing installed', text: 'The agent did not run pip.', checks };
  if (evidence.succeeded && !shouldWork) return { outcome: 'breach', title: 'Installed although the policy blocks it', text: 'pip reached the index with a policy that should refuse it.', checks };
  if (!evidence.succeeded && shouldWork) return { outcome: 'failed', title: 'Allowed, but pip failed', text: 'The policy allows the hosts; read the pip output for the reason.', checks };
  if (evidence.succeeded) return { outcome: 'installed', title: 'Installed at run time, through the allowlist', text: `The allowlist let pip query pypi.org and download from files.pythonhosted.org. It works, but declaring tabulate==0.9.0 in packages needs no network at all.`, checks };
  const missing = evidence.blockedHost && !allows(config, evidence.blockedHost) ? evidence.blockedHost : null;
  return { outcome: 'blocked', title: missing && config.access === 'restricted' ? `Blocked at ${missing}: the allowlist needs it` : 'Blocked, as the policy says', text: missing && config.access === 'restricted' ? `pip read the index on ${config.domains.join(', ')}, then was sent to ${missing} for the file, and the proxy refused it (403). Redirect and download hosts need their own entries.` : 'With the network disabled, pip cannot reach an index. Declare the package in environment.packages instead: it is installed before the sandbox is ready.', checks };
}

// ---- The documented network policy ----

export function policyDocument(run: { config: Config; task: Task; fingerprint?: string; sessionId?: string | null; readyMs?: number | null; commands?: CommandRun[]; answer?: string; echo?: Echo | null; model?: string }, date: string): string {
  const { config } = run;
  const environment = buildEnvironment(config, run.task);
  const print = run.fingerprint ?? fingerprint(environment);
  const audit = run.answer ? parseAudit(run.answer) : null;
  const expected = expectedAudit(config);
  const lines = [`# Sandbox policy · environment ${print}`, '', `Recorded ${date}${run.sessionId ? ` from session \`${run.sessionId}\`` : ' (not yet run)'}${run.model ? `, model \`${run.model}\`` : ''}.`, '', '## Network', '', `Access: **${config.access}**.`, ''];
  if (config.access === 'restricted') {
    lines.push('| Allowed host | Why |', '| --- | --- |', ...config.domains.map((domain) => `| \`${domain}\` | ${hostReasons[domain.toLowerCase()] ?? '_state why the task needs this host_'} |`), '', 'Every other host is refused by the sandbox proxy (`CONNECT tunnel failed, response 403`).');
  } else if (config.access === 'disabled') lines.push('No outbound connections. Declared packages are installed while the sandbox is prepared, before this policy applies to the agent.');
  else lines.push('Every host is reachable. **Justify this:** the audit and the report tasks in this course need no network.');
  lines.push('', '## Packages', '', '| Ecosystem | Declared | Pinned | Observed |', '| --- | --- | --- | --- |');
  const observed = (spec: string) => (!audit ? '—' : packageName(spec) === 'tabulate' ? audit.tabulate ?? '—' : packageName(spec) === 'jq' ? audit.jq ?? '—' : '—');
  for (const ecosystem of ['python', 'system', 'npm'] as const) for (const spec of config[ecosystem]) lines.push(`| ${ecosystem} | \`${spec}\` | ${isPinned(ecosystem, spec) ? 'yes' : ecosystem === 'system' ? 'no (image index)' : '**no**'} | ${observed(spec)} |`);
  if (!config.python.length && !config.system.length && !config.npm.length) lines.push('| — | nothing declared | — | — |');
  lines.push('', '## Setup commands', '', config.setup === 'none' || run.task === 'install' ? 'None.' : `1 command, run after packages and before the agent starts. The API never echoes setup bodies; this document records it: \`${setupCommands[config.setup]}\`.`);
  lines.push('', '## Verified', '');
  if (!run.commands?.length) lines.push('Not verified yet: run the audit and attach the session.');
  else {
    lines.push('| Check | Policy says | Sandbox showed |', '| --- | --- | --- |');
    for (const id of Object.keys(hosts) as HostId[]) { const evidence = hostEvidence(run.commands, id); lines.push(`| \`${hosts[id].host}\` | ${expected[id]} | ${evidence.code ? `${evidence.code} → ${evidence.reach}` : 'not traced'} |`); }
    if (audit) lines.push(`| tabulate | ${expected.tabulate} | ${audit.tabulate ?? '—'} |`, `| jq | ${expected.jq} | ${audit.jq ?? '—'} |`, `| ${lockPath} | ${expected.lockFile} | ${audit.lockFile ?? '—'} |`);
    if (run.readyMs) lines.push('', `Sandbox ready after ${seconds(run.readyMs)}.`);
  }
  lines.push('', '## Reproduce', '', 'Send this `environment` in `sessions.create`. The same fingerprint must give the same versions and the same network behaviour.', '', '```json', JSON.stringify(environment, null, 2), '```', '');
  return lines.join('\n');
}
