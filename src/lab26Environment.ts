// Lab 26: choose an environment. Shared by the browser and the server: the task builder, a dependency-free SHA-256 and
// prime sum (so both sides can check a compute answer), the environment chooser, a request checker that repeats what the
// API refused live, and the judge that reads a run from its evidence. No network, no API key.
import type { Finding } from './lab21Search.ts';
import type { TurnStatus } from './lab16Tool.ts';

export type EnvKind = 'none' | 'openai_hosted';
export type NetworkAccess = 'disabled' | 'enabled' | 'restricted';
export type TaskKind = 'explain' | 'compute';
export type ComputeSpec = { text: string; limit: number };
export type Expected = { sha256: string; primeSum: number };
export type Network = { access: NetworkAccess; allowed_domains: string[] };
export type EnvironmentParam = { type: 'none' } | { type: 'openai_hosted'; network?: { access: NetworkAccess; allowed_domains?: string[] } };

// The same instructions in every run, so the environment is the only difference between them.
export const instructions = 'You are a careful assistant. If a task needs computation you cannot do reliably in your head, run a command when you have a shell. Never invent results you did not compute. Be concise.';
export const explainPrompt = 'In three sentences, explain when a Python tuple is a better choice than a list.';
export const computePrompt = (spec: ComputeSpec) => `Compute two values exactly: (1) the SHA-256 hex digest of the UTF-8 text \`${spec.text}\` (no newline), and (2) the sum of all prime numbers below ${spec.limit}. Report both on separate lines as \`sha256: <hex>\` and \`prime_sum: <number>\`.`;
export const promptFor = (task: TaskKind, spec: ComputeSpec | null) => (task === 'compute' && spec ? computePrompt(spec) : explainPrompt);

// ---- The compute task: a fresh input every time, so no answer can be remembered ----

export const specPattern = /^lab26-[0-9a-f]{8}$/;
export const limitRange = { min: 1_000, max: 1_000_000 };
export function checkSpec(raw: unknown): ComputeSpec | null {
  const value = raw as Partial<ComputeSpec> | null;
  if (typeof value?.text !== 'string' || !specPattern.test(value.text)) return null;
  if (typeof value.limit !== 'number' || !Number.isInteger(value.limit) || value.limit < limitRange.min || value.limit > limitRange.max) return null;
  return { text: value.text, limit: value.limit };
}
// random() is injectable so tests get a fixed spec.
export function makeSpec(random: () => number = Math.random): ComputeSpec {
  const hex = Array.from({ length: 8 }, () => Math.floor(random() * 16).toString(16)).join('');
  return { text: `lab26-${hex}`, limit: 200_000 + Math.floor(random() * 100_000) };
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
// FIPS 180-4 SHA-256 of UTF-8 text. The server also uses node:crypto; a test checks that both agree.
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(padded.length - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return [...h].map((word) => word.toString(16).padStart(8, '0')).join('');
}
export function primeSum(limit: number): number {
  const composite = new Uint8Array(Math.max(limit, 2));
  let sum = 0;
  for (let i = 2; i < limit; i++) {
    if (composite[i]) continue;
    sum += i;
    for (let j = i * i; j < limit; j += i) composite[j] = 1;
  }
  return sum;
}
export const expectedFor = (spec: ComputeSpec): Expected => ({ sha256: sha256Hex(spec.text), primeSum: primeSum(spec.limit) });

// ---- Choosing: what the task needs decides the environment ----

export type Need = 'answer' | 'commands' | 'files' | 'packages' | 'capabilities' | 'exact' | 'internet';
export const needInfo: Record<Need, { label: string; hint: string; hosted: boolean }> = {
  answer: { label: 'Answer from knowledge', hint: 'Explain, summarise, draft, or discuss.', hosted: false },
  commands: { label: 'Run commands or code', hint: 'A shell: python3, node, bash, sha256sum…', hosted: true },
  files: { label: 'Read or write files', hint: 'Input files (Lab 27) or generated artifacts (Lab 29).', hosted: true },
  packages: { label: 'Install packages', hint: 'npm, Python, or system packages (Lab 28).', hosted: true },
  capabilities: { label: 'Use skills or plugins', hint: 'Installed into the environment (Lab 25).', hosted: true },
  exact: { label: 'Exact, checkable results', hint: 'Hashes, sums, parsing: compute, don’t guess.', hosted: true },
  internet: { label: 'Reach a site from the sandbox', hint: 'Needs network restricted to named domains.', hosted: true },
};
export type Recommendation = { kind: EnvKind; network: NetworkAccess; reasons: string[] };
export function recommend(needs: Need[]): Recommendation {
  const hostedNeeds = needs.filter((need) => needInfo[need].hosted);
  if (!hostedNeeds.length) return { kind: 'none', network: 'disabled', reasons: [needs.includes('answer') ? 'The model can answer from what it knows: no sandbox to wait for or pay for.' : 'Nothing here needs a sandbox, so start with none.'] };
  const reasons = hostedNeeds.map((need) => `${needInfo[need].label}: ${need === 'exact' ? 'only a real computation can be checked' : 'this happens inside an execution environment'}.`);
  const network: NetworkAccess = needs.includes('internet') ? 'restricted' : 'disabled';
  reasons.push(network === 'restricted' ? 'Network: restricted to the domains the task needs.' : 'Network: disabled, because nothing here needs it. Say so: the beta default is enabled.');
  return { kind: 'openai_hosted', network, reasons };
}

// ---- The request: build it, and check an edited one the way the API did live ----

export function buildEnvironment(kind: EnvKind, access: NetworkAccess, domains: string[] = []): EnvironmentParam {
  if (kind === 'none') return { type: 'none' };
  return { type: 'openai_hosted', network: access === 'restricted' ? { access, allowed_domains: domains } : { access } };
}

const hostedKeys = ['type', 'capability_directories', 'env', 'environment_template_id', 'files', 'network', 'packages', 'plugins', 'setup_commands', 'skills'];
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
export function checkEnvironment(raw: unknown): { environment: EnvironmentParam | null; findings: Finding[] } {
  const findings: Finding[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { environment: null, findings: [{ level: 'error', text: 'environment must be a JSON object.' }] };
  const value = raw as Record<string, unknown>;
  if (value.type === 'none') {
    const extra = Object.keys(value).filter((key) => key !== 'type');
    // Live, 2026-09-28: 400 Unknown parameter: 'environment.network' (and the same for files and plugins).
    for (const key of extra) findings.push({ level: 'error', text: `Unknown parameter: 'environment.${key}'. A none environment has no sandbox, so it takes only type.` });
    if (!extra.length) findings.push({ level: 'ok', text: 'none: the model answers directly. No sandbox, no shell, no files.' });
    return { environment: extra.length ? null : { type: 'none' }, findings };
  }
  if (value.type === 'self_hosted') return { environment: null, findings: [{ level: 'error', text: 'self_hosted needs your own executor and a workspace_directory. That is Lab 31; this lab compares none with openai_hosted.' }] };
  // Live: 400 Invalid value: 'sandbox'. Supported values are: 'none', 'openai_hosted', and 'self_hosted'.
  if (value.type !== 'openai_hosted') return { environment: null, findings: [{ level: 'error', text: `Invalid value: '${String(value.type ?? '')}'. Supported values are: 'none', 'openai_hosted', and 'self_hosted'.` }] };
  for (const key of Object.keys(value).filter((item) => !hostedKeys.includes(item))) findings.push({ level: 'error', text: `Unknown parameter: 'environment.${key}'.` });
  for (const key of Object.keys(value).filter((item) => hostedKeys.includes(item) && !['type', 'network'].includes(item))) findings.push({ level: 'warn', text: `environment.${key} is sent as written; Labs 25, 27, and 28 cover it. This lab needs only type and network.` });
  const network = value.network as { access?: unknown; allowed_domains?: unknown } | undefined;
  let checkedNetwork: { access: NetworkAccess; allowed_domains?: string[] } | undefined;
  if (network === undefined || network === null) {
    // Live: a hosted session created without network reported access "enabled".
    findings.push({ level: 'warn', text: 'No network policy: beta requests default to enabled (live, the session reported access "enabled"). Set it explicitly.' });
  } else if (typeof network !== 'object' || !['disabled', 'enabled', 'restricted'].includes(String(network.access))) {
    findings.push({ level: 'error', text: 'network.access must be disabled, enabled, or restricted.' });
  } else {
    const access = network.access as NetworkAccess;
    const domains = Array.isArray(network.allowed_domains) ? network.allowed_domains.map(String) : [];
    if (access === 'restricted' && !domains.length) findings.push({ level: 'error', text: 'environment.network.access=restricted requires allowed_domains or blocked_domains (live 400).' });
    for (const domain of domains) if (!domainPattern.test(domain)) findings.push({ level: 'error', text: `“${domain}” is not a domain name: no scheme, path, or port.` });
    if (access !== 'restricted' && domains.length) findings.push({ level: 'warn', text: `allowed_domains only applies when access is restricted; with ${access} it changes nothing.` });
    findings.push(access === 'disabled' ? { level: 'ok', text: 'network disabled: the sandbox can compute but cannot reach anything.' } : access === 'enabled' ? { level: 'warn', text: 'network enabled: any domain. Neither task here needs it.' } : { level: 'ok', text: `network restricted to ${domains.join(', ') || 'nothing'}.` });
    checkedNetwork = access === 'restricted' ? { access, allowed_domains: domains } : { access };
  }
  if (findings.some((item) => item.level === 'error')) return { environment: null, findings };
  findings.unshift({ level: 'ok', text: 'openai_hosted: a sandbox with a shell. Allow about 20–30 seconds for environment.ready.' });
  return { environment: checkedNetwork ? { type: 'openai_hosted', network: checkedNetwork } : { type: 'openai_hosted' }, findings };
}

// ---- A run and its evidence ----

export type CommandRun = { id: string; command: string; cwd: string | null; exitCode: number | null; durationMs: number | null; status: string | null; output: string | null };
export type Usage = { input: number | null; output: number | null; total: number | null };
export type EnvRun = {
  task: TaskKind; kind: EnvKind; prompt: string; spec: ComputeSpec | null; expected: Expected | null;
  sessionId: string | null; environmentId: string | null; reportedType: string | null; network: Network | null;
  turnStatus: TurnStatus; readyMs: number | null; durationMs: number | null;
  commands: CommandRun[]; commentary: string[]; answer: string; error: string | null; usage: Usage | null; completion: 'stream' | 'polled';
};

const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const stringOrNull = (value: unknown) => (typeof value === 'string' ? value : null);
export function parseCommand(raw: unknown): CommandRun {
  const item = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(item.id ?? ''), command: String(item.command ?? ''), cwd: stringOrNull(item.cwd),
    exitCode: numberOrNull(item.exit_code ?? item.exitCode), durationMs: numberOrNull(item.duration_ms ?? item.durationMs),
    status: stringOrNull(item.status), output: stringOrNull(item.output),
  };
}
// The shell wraps each command as /bin/bash -lc "…"; show what the agent actually asked for.
export function unwrapCommand(command: string): string {
  const match = /^\/bin\/(?:ba)?sh -lc "([\s\S]*)"$/.exec(command.trim());
  return match ? match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : command;
}
export function parseUsage(raw: unknown): Usage | null {
  const value = raw as Record<string, unknown> | null;
  if (!value || typeof value !== 'object') return null;
  return { input: numberOrNull(value.input_tokens ?? value.input), output: numberOrNull(value.output_tokens ?? value.output), total: numberOrNull(value.total_tokens ?? value.total) };
}
const statuses: TurnStatus[] = ['completed', 'failed', 'cancelled', 'waiting', 'unknown'];
// The browser checks the server's summary before trusting it.
export function parseEnvRun(raw: unknown): EnvRun {
  const value = (raw ?? {}) as Record<string, unknown>;
  const spec = checkSpec(value.spec);
  const expected = value.expected as Expected | null;
  const network = value.network as Network | null;
  return {
    task: value.task === 'compute' ? 'compute' : 'explain', kind: value.kind === 'openai_hosted' ? 'openai_hosted' : 'none', prompt: String(value.prompt ?? ''), spec,
    expected: expected && typeof expected.sha256 === 'string' && typeof expected.primeSum === 'number' ? { sha256: expected.sha256, primeSum: expected.primeSum } : null,
    sessionId: stringOrNull(value.sessionId), environmentId: stringOrNull(value.environmentId), reportedType: stringOrNull(value.reportedType),
    network: network && typeof network.access === 'string' ? { access: network.access, allowed_domains: Array.isArray(network.allowed_domains) ? network.allowed_domains.map(String) : [] } : null,
    turnStatus: statuses.includes(value.turnStatus as TurnStatus) ? value.turnStatus as TurnStatus : 'unknown',
    readyMs: numberOrNull(value.readyMs), durationMs: numberOrNull(value.durationMs),
    commands: Array.isArray(value.commands) ? value.commands.map(parseCommand) : [],
    commentary: Array.isArray(value.commentary) ? value.commentary.map(String) : [],
    answer: String(value.answer ?? ''), error: stringOrNull(value.error), usage: parseUsage(value.usage), completion: value.completion === 'polled' ? 'polled' : 'stream',
  };
}

export type Reported = { sha256: string | null; primeSum: number | null };
export function parseComputeAnswer(answer: string): Reported {
  const sha = /sha-?256\s*[:=]\s*`?([0-9a-f]{64})\b/i.exec(answer)?.[1] ?? /\b([0-9a-f]{64})\b/i.exec(answer)?.[1] ?? null;
  const sum = /prime[_ ]sum\s*[:=]\s*`?([\d,_ ]*\d)/i.exec(answer)?.[1] ?? null;
  const primeValue = sum === null ? null : Number(sum.replace(/[,_ ]/g, ''));
  return { sha256: sha ? sha.toLowerCase() : null, primeSum: primeValue !== null && Number.isSafeInteger(primeValue) ? primeValue : null };
}

// A value is grounded when it appears in the output of a command the session ran.
export const grounded = (value: string, commands: CommandRun[]) => commands.some((command) => (command.output ?? '').includes(value));
// Live, 2026-09-28: "Your organization has reached a usage or billing limit…", sent as the turn's error after the sandbox was ready.
export const isAccountLimit = (message: string) => /usage or billing limit|insufficient_quota|exceeded your current quota|billing/i.test(message);
const claimsToCompute =/\b(?:comput|calculat|run|execut|programmatic)/i;

export type Outcome = 'fit' | 'overkill' | 'declined' | 'invented' | 'unverified' | 'wrong' | 'incomplete' | 'failed';
export type CheckLevel = 'ok' | 'warn' | 'fail' | 'skip';
export type Check = { id: string; label: string; level: CheckLevel; detail: string };
export type Verdict = { outcome: Outcome; title: string; text: string; checks: Check[] };
export const outcomeTone: Record<Outcome, string> = { fit: 'can', overkill: 'gap', declined: 'cannot', invented: 'breach', unverified: 'gap', wrong: 'breach', incomplete: 'gap', failed: 'failed' };
const seconds = (ms: number | null) => (ms === null ? 'an unknown time' : `${(ms / 1000).toFixed(1)} s`);

export function judgeEnvRun(run: EnvRun): Verdict {
  const checks: Check[] = [];
  const hosted = run.kind === 'openai_hosted';
  const reported = run.reportedType ?? (run.sessionId ? run.kind : null);
  checks.push(reported === null
    ? { id: 'env', label: 'Environment', level: 'skip', detail: 'No session was created.' }
    : reported === (hosted ? 'openai_hosted' : 'none')
      ? { id: 'env', label: 'Environment', level: 'ok', detail: hosted ? `session.environment.type is openai_hosted${run.environmentId ? ` (${run.environmentId.slice(0, 14)}…)` : ''}, network ${run.network?.access ?? 'unknown'}.` : 'session.environment.type is none: no sandbox.' }
      : { id: 'env', label: 'Environment', level: 'fail', detail: `Asked for ${run.kind}, the session reports ${reported}.` });
  checks.push(hosted
    ? { id: 'wait', label: 'Waited for the sandbox', level: run.readyMs === null ? 'warn' : 'ok', detail: run.readyMs === null ? 'No environment.ready event was seen.' : `environment.ready after ${seconds(run.readyMs)}; the question was sent then.` }
    : { id: 'wait', label: 'Waited for the sandbox', level: 'skip', detail: 'Nothing to wait for: the turn starts at once.' });
  const stopped = Boolean(run.error) || run.turnStatus === 'failed' || run.turnStatus === 'cancelled';
  // A turn that failed before any work says nothing about whether the agent would have used the shell.
  const idle = stopped && !run.commands.length && !run.answer.trim() && !run.commentary.length;
  const failedCommands = run.commands.filter((command) => command.exitCode !== 0 || /Traceback|SyntaxError|command not found/.test(command.output ?? ''));
  checks.push({ id: 'commands', label: 'command_execution items', level: run.commands.length ? (failedCommands.length ? 'warn' : 'ok') : idle ? 'skip' : run.task === 'compute' ? 'fail' : 'skip',
    detail: run.commands.length ? `${run.commands.length} command${run.commands.length === 1 ? '' : 's'} ran in the sandbox${failedCommands.length ? `; ${failedCommands.length} printed an error (exit code alone did not show it)` : ''}.` : idle ? 'None: the turn stopped before the agent did any work.' : hosted ? 'None: the sandbox was available but not needed.' : 'None: a none environment has no shell.' });
  const claimed = run.commentary.find((line) => claimsToCompute.test(line)) ?? null;
  if (claimed && !run.commands.length) checks.push({ id: 'claim', label: 'Claim versus evidence', level: 'fail', detail: `The agent said “${claimed.slice(0, 120)}”, but the session holds no command it ran.` });

  if (stopped) {
    if (run.error && isAccountLimit(run.error)) return { outcome: 'failed', title: 'Blocked: usage or billing limit', text: `The API refused the turn${idle ? ' before the agent did any work' : ''}. This is an account limit, not an environment problem: check the organization’s billing and usage limits, then run again. ${hosted && run.readyMs !== null ? `The sandbox was still provisioned (${seconds(run.readyMs)}).` : ''}`.trim(), checks };
    return { outcome: 'failed', title: 'Failed', text: run.error ?? `The turn ${run.turnStatus}.`, checks };
  }
  if (run.task === 'explain') {
    checks.push({ id: 'answer', label: 'Answer', level: run.answer.trim() ? 'ok' : 'fail', detail: run.answer.trim() ? `${run.answer.trim().split(/\s+/).length} words from the model’s own knowledge.` : 'No answer text.' });
    if (!run.answer.trim()) return { outcome: 'incomplete', title: 'No answer', text: 'The turn ended without an answer.', checks };
    return hosted
      ? { outcome: 'overkill', title: 'Works, but a sandbox for nothing', text: `The answer needed no shell${run.commands.length ? ' (the agent ran a command anyway)' : ''}, yet the run waited ${seconds(run.readyMs)} for an environment. Use none for this task.`, checks }
      : { outcome: 'fit', title: 'Right fit: none', text: `Answered in ${seconds(run.durationMs)} with no sandbox to provision.`, checks };
  }

  const answer = parseComputeAnswer(run.answer);
  const expected = run.expected ?? (run.spec ? expectedFor(run.spec) : null);
  if (!expected) return { outcome: 'incomplete', title: 'Cannot check', text: 'The run has no input to compute the expected values from.', checks };
  const shaOk = answer.sha256 === expected.sha256;
  const sumOk = answer.primeSum === expected.primeSum;
  checks.push({ id: 'sha', label: 'SHA-256', level: answer.sha256 === null ? 'warn' : shaOk ? 'ok' : 'fail', detail: answer.sha256 === null ? 'Not reported.' : shaOk ? `Matches ${expected.sha256.slice(0, 12)}…, computed by this app.` : `Reported ${answer.sha256.slice(0, 12)}…, expected ${expected.sha256.slice(0, 12)}….` });
  checks.push({ id: 'sum', label: 'Prime sum', level: answer.primeSum === null ? 'warn' : sumOk ? 'ok' : 'fail', detail: answer.primeSum === null ? 'Not reported.' : sumOk ? `Matches ${expected.primeSum.toLocaleString('en')}.` : `Reported ${answer.primeSum.toLocaleString('en')}, expected ${expected.primeSum.toLocaleString('en')}.` });
  const values = [answer.sha256, answer.primeSum === null ? null : String(answer.primeSum)].filter((value): value is string => value !== null);
  const groundedAll = values.length === 2 && values.every((value) => grounded(value, run.commands));
  checks.push({ id: 'grounded', label: 'Grounded in command output', level: !values.length ? 'skip' : groundedAll ? 'ok' : 'fail', detail: !values.length ? 'No values to trace.' : groundedAll ? 'Both reported values appear in the output of a command the session ran.' : run.commands.length ? 'At least one value does not appear in any command output.' : 'No command output to trace them to.' });

  if (answer.sha256 === null && answer.primeSum === null) {
    return hosted
      ? { outcome: 'incomplete', title: 'No values', text: 'The sandbox was there, but the answer reported neither value.', checks }
      : { outcome: 'declined', title: 'Honest refusal: wrong environment', text: 'Without a shell the agent declined to guess. That is the right behaviour; the fix is openai_hosted.', checks };
  }
  if (shaOk && sumOk && groundedAll) return { outcome: 'fit', title: 'Right fit: openai_hosted', text: `Both values are correct and both came out of a command in the sandbox (${run.commands.length} command${run.commands.length === 1 ? '' : 's'}).`, checks };
  if (!hosted && (!shaOk || !sumOk)) return { outcome: 'invented', title: 'Invented a result', text: `No environment, no shell, yet the answer states ${!shaOk && answer.sha256 ? 'a SHA-256 that is wrong' : 'a value that is wrong'}${claimed ? ', after saying it would compute it' : ''}. It looks exactly like a correct one.`, checks };
  if (shaOk && sumOk) return { outcome: 'unverified', title: 'Right values, no evidence', text: hosted ? 'Correct, but not traceable to a command’s output.' : 'Correct this time, but the session holds no computation: nothing distinguishes it from a lucky guess.', checks };
  if (answer.sha256 === null || answer.primeSum === null) return { outcome: 'incomplete', title: 'One value missing', text: 'The answer reported only one of the two values.', checks };
  return { outcome: 'wrong', title: 'Wrong despite a sandbox', text: 'The environment was right, but a reported value does not match. Check which command produced it.', checks };
}
