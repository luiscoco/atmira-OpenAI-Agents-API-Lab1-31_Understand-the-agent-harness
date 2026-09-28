// Lab 26: the test page. Every case runs the real functions (sha256Hex, primeSum, makeSpec, checkSpec, recommend,
// buildEnvironment, checkEnvironment, parseComputeAnswer, unwrapCommand, judgeEnvRun) on fixed inputs: no network, no API key.
import {
  buildEnvironment, checkEnvironment, checkSpec, computePrompt, expectedFor, judgeEnvRun, makeSpec, parseComputeAnswer, parseEnvRun, primeSum, recommend, sha256Hex, unwrapCommand,
  type EnvRun, type Need,
} from './lab26Environment.ts';
import { samples } from './lab26Scenarios.ts';

export type TestGroup = 'compute' | 'choose' | 'request' | 'answer' | 'judge';
export type EnvTest = { id: string; label: string; group: TestGroup; expect: string; note: string; run: () => { got: string; detail: string } };
export type TestResult = { id: string; got: string; detail: string; pass: boolean };

const levelOf = (findings: Array<{ level: string }>) => (findings.some((item) => item.level === 'error') ? 'error' : findings.some((item) => item.level === 'warn') ? 'warn' : 'ok');
const lines = (findings: Array<{ level: string; text: string }>) => findings.map((item) => `${item.level}: ${item.text}`).join('\n') || 'no findings';
const checked = (environment: unknown) => { const out = checkEnvironment(environment); return { got: levelOf(out.findings), detail: `${lines(out.findings)}\n\nsent: ${JSON.stringify(out.environment)}` }; };
const chosen = (needs: Need[]) => { const out = recommend(needs); return { got: `${out.kind} · ${out.network}`, detail: out.reasons.join('\n') }; };
const sample = (id: string) => samples.find((item) => item.id === id)!.run;
const judged = (run: EnvRun) => { const verdict = judgeEnvRun(run); return { got: verdict.outcome, detail: `${verdict.title}: ${verdict.text}\n${verdict.checks.map((check) => `${check.level} · ${check.label}: ${check.detail}`).join('\n')}` }; };
const spec = { text: 'lab26-00c0ffee', limit: 10_000 };
const expected = expectedFor(spec);
const computeRun = (patch: Partial<EnvRun>): EnvRun => ({
  task: 'compute', kind: 'openai_hosted', prompt: computePrompt(spec), spec, expected, sessionId: 'sess_1', environmentId: 'ccarenv_1', reportedType: 'openai_hosted', network: { access: 'disabled', allowed_domains: [] },
  turnStatus: 'completed', readyMs: 20_000, durationMs: 30_000,
  commands: [{ id: 'exec_1', command: 'sha256sum', cwd: '/workspace', exitCode: 0, durationMs: 0, status: 'completed', output: `${expected.sha256}  -\n${expected.primeSum}\n` }],
  commentary: [], answer: `sha256: ${expected.sha256}\nprime_sum: ${expected.primeSum}`, error: null, usage: null, completion: 'stream', ...patch,
});

export const envTests: EnvTest[] = [
  { id: 'sha-abc', label: 'SHA-256 of "abc"', group: 'compute', expect: 'ba7816bf…f20015ad', note: 'The FIPS 180-4 test vector.', run: () => { const hex = sha256Hex('abc'); return { got: `${hex.slice(0, 8)}…${hex.slice(-8)}`, detail: hex }; } },
  { id: 'sha-empty', label: 'SHA-256 of ""', group: 'compute', expect: 'e3b0c442…7852b855', note: 'An empty input is one padding block.', run: () => { const hex = sha256Hex(''); return { got: `${hex.slice(0, 8)}…${hex.slice(-8)}`, detail: hex }; } },
  { id: 'sha-55-56', label: '55 and 56 bytes differ', group: 'compute', expect: 'two blocks at 56', note: 'At 56 bytes the length no longer fits in the first block.', run: () => ({ got: sha256Hex('x'.repeat(55)) !== sha256Hex('x'.repeat(56)) ? 'two blocks at 56' : 'same', detail: `${sha256Hex('x'.repeat(55))}\n${sha256Hex('x'.repeat(56))}` }) },
  { id: 'sha-live', label: 'SHA-256 of atmira-lab-26', group: 'compute', expect: 'e69a3de3…4833337c', note: 'Live: the hosted sandbox’s sha256sum printed the same digest.', run: () => { const hex = sha256Hex('atmira-lab-26'); return { got: `${hex.slice(0, 8)}…${hex.slice(-8)}`, detail: hex }; } },
  { id: 'primes-small', label: 'Primes below 10', group: 'compute', expect: '17', note: '2 + 3 + 5 + 7. The limit itself is excluded.', run: () => ({ got: String(primeSum(10)), detail: 'primeSum(10)' }) },
  { id: 'primes-live', label: 'Primes below 232,283', group: 'compute', expect: '2279203472', note: 'Live: the sandbox’s second command printed this value.', run: () => ({ got: String(primeSum(232_283)), detail: 'primeSum(232283)' }) },
  { id: 'spec-fresh', label: 'A fresh input per comparison', group: 'compute', expect: 'lab26-00000000 · 200000', note: 'random() is injected, so the test is repeatable.', run: () => { const out = makeSpec(() => 0); return { got: `${out.text} · ${out.limit}`, detail: JSON.stringify(out) }; } },
  { id: 'spec-reject', label: 'A spec with shell characters', group: 'compute', expect: 'rejected', note: 'The text goes into a prompt the agent may paste into a shell.', run: () => ({ got: checkSpec({ text: "lab26-'; rm -rf /", limit: 5_000 }) ? 'accepted' : 'rejected', detail: 'Only lab26- followed by eight hex digits is accepted.' }) },
  { id: 'spec-limit', label: 'A limit of 10 million', group: 'compute', expect: 'rejected', note: 'Keeps the check fast in the browser and the sandbox.', run: () => ({ got: checkSpec({ text: 'lab26-00c0ffee', limit: 10_000_000 }) ? 'accepted' : 'rejected', detail: 'limit must be an integer from 1,000 to 1,000,000.' }) },

  { id: 'choose-answer', label: 'Only “answer from knowledge”', group: 'choose', expect: 'none · disabled', note: 'Nothing to run: no sandbox to wait for.', run: () => chosen(['answer']) },
  { id: 'choose-exact', label: '“Exact, checkable results”', group: 'choose', expect: 'openai_hosted · disabled', note: 'A hash has to be computed, and computing needs no internet.', run: () => chosen(['answer', 'exact']) },
  { id: 'choose-internet', label: 'Commands + reach a site', group: 'choose', expect: 'openai_hosted · restricted', note: 'Network only to named domains.', run: () => chosen(['commands', 'internet']) },
  { id: 'build-none', label: 'Build none', group: 'choose', expect: '{"type":"none"}', note: 'The network setting is ignored: none has no sandbox.', run: () => { const out = buildEnvironment('none', 'enabled'); return { got: JSON.stringify(out), detail: JSON.stringify(out, null, 2) }; } },
  { id: 'build-hosted', label: 'Build openai_hosted', group: 'choose', expect: '{"type":"openai_hosted","network":{"access":"disabled"}}', note: 'The request both tasks use for the hosted runs.', run: () => { const out = buildEnvironment('openai_hosted', 'disabled'); return { got: JSON.stringify(out), detail: JSON.stringify(out, null, 2) }; } },

  { id: 'req-none', label: '{ type: "none" }', group: 'request', expect: 'ok', note: 'The whole none environment.', run: () => checked({ type: 'none' }) },
  { id: 'req-none-network', label: 'none + network', group: 'request', expect: 'error', note: 'Live: 400 Unknown parameter: \'environment.network\'.', run: () => checked({ type: 'none', network: { access: 'disabled' } }) },
  { id: 'req-none-files', label: 'none + files: []', group: 'request', expect: 'error', note: 'Live: 400 Unknown parameter: \'environment.files\'.', run: () => checked({ type: 'none', files: [] }) },
  { id: 'req-type', label: 'type: "sandbox"', group: 'request', expect: 'error', note: 'Live: 400 Invalid value: \'sandbox\'.', run: () => checked({ type: 'sandbox' }) },
  { id: 'req-self', label: 'type: "self_hosted"', group: 'request', expect: 'error', note: 'Real, but it needs your own executor: Lab 31.', run: () => checked({ type: 'self_hosted' }) },
  { id: 'req-default', label: 'openai_hosted, no network', group: 'request', expect: 'warn', note: 'Live: accepted, and the session reported access enabled.', run: () => checked({ type: 'openai_hosted' }) },
  { id: 'req-disabled', label: 'openai_hosted, network disabled', group: 'request', expect: 'ok', note: 'What this lab sends.', run: () => checked({ type: 'openai_hosted', network: { access: 'disabled' } }) },
  { id: 'req-restricted', label: 'restricted, no domains', group: 'request', expect: 'error', note: 'Live: 400 requires allowed_domains or blocked_domains.', run: () => checked({ type: 'openai_hosted', network: { access: 'restricted' } }) },
  { id: 'req-url', label: 'allowed_domains: ["https://pypi.org"]', group: 'request', expect: 'error', note: 'A domain, not a URL.', run: () => checked({ type: 'openai_hosted', network: { access: 'restricted', allowed_domains: ['https://pypi.org'] } }) },
  { id: 'req-typo', label: 'openai_hosted + netwrok', group: 'request', expect: 'error', note: 'An unknown key is a 400, not silently ignored.', run: () => checked({ type: 'openai_hosted', netwrok: { access: 'disabled' } }) },

  { id: 'answer-parse', label: 'Read the two values', group: 'answer', expect: 'e69a3de3 · 121013308', note: 'Upper case and thousands separators are accepted.', run: () => { const out = parseComputeAnswer('sha256: E69A3DE3EC829558AEBFB15524B5577E87CCFF94D0A7D5DCF178D2D04833337C\nprime_sum: 121,013,308'); return { got: `${out.sha256?.slice(0, 8)} · ${out.primeSum}`, detail: JSON.stringify(out, null, 2) }; } },
  { id: 'answer-missing', label: 'A refusal', group: 'answer', expect: 'null · null', note: 'No hex, no sum: nothing is reported.', run: () => { const out = parseComputeAnswer('I cannot run code here, so I will not guess a hash.'); return { got: `${out.sha256} · ${out.primeSum}`, detail: JSON.stringify(out) }; } },
  { id: 'unwrap', label: 'Unwrap /bin/bash -lc "…"', group: 'answer', expect: 'printf %s "$text" | sha256sum', note: 'The shell wrapper hides the command the agent wrote.', run: () => { const out = unwrapCommand('/bin/bash -lc "printf %s \\"$text\\" | sha256sum"'); return { got: out, detail: out }; } },
  { id: 'parse-run', label: 'A malformed summary', group: 'answer', expect: 'explain · none · unknown', note: 'The browser does not trust the server’s JSON blindly.', run: () => { const out = parseEnvRun({ task: 'hack', kind: 42, turnStatus: 'done', commands: 'x' }); return { got: `${out.task} · ${out.kind} · ${out.turnStatus}`, detail: JSON.stringify(out, null, 2) }; } },

  { id: 'judge-explain-none', label: 'Recorded: explain · none', group: 'judge', expect: 'fit', note: 'Live, 8.9 s.', run: () => judged(sample('explain-none')) },
  { id: 'judge-explain-hosted', label: 'Recorded: explain · openai_hosted', group: 'judge', expect: 'overkill', note: 'Live, 36 s: 26 s of it waiting for the sandbox.', run: () => judged(sample('explain-hosted')) },
  { id: 'judge-none-fresh', label: 'Recorded: compute · none, fresh input', group: 'judge', expect: 'invented', note: 'Live: a wrong SHA-256, after “I’ll compute both directly”.', run: () => judged(sample('compute-none-fresh')) },
  { id: 'judge-none-fixed', label: 'Recorded: compute · none, fixed text', group: 'judge', expect: 'unverified', note: 'Live: right values, and nothing in the session that shows how.', run: () => judged(sample('compute-none-fixed')) },
  { id: 'judge-hosted-fresh', label: 'Recorded: compute · openai_hosted', group: 'judge', expect: 'fit', note: 'Live: two commands, a syntax error, a rerun, both values grounded.', run: () => judged(sample('compute-hosted-fresh')) },
  { id: 'judge-declined', label: 'none declines to guess', group: 'judge', expect: 'declined', note: 'The honest behaviour in the wrong environment.', run: () => judged(computeRun({ kind: 'none', reportedType: 'none', environmentId: null, network: null, readyMs: null, commands: [], answer: 'I cannot execute code here, so I will not guess.' })) },
  { id: 'judge-copied', label: 'Hosted, but the value is not in any output', group: 'judge', expect: 'unverified', note: 'A command ran, but the answer’s hash did not come from it.', run: () => judged(computeRun({ commands: [{ id: 'exec_1', command: 'echo hi', cwd: '/workspace', exitCode: 0, durationMs: 0, status: 'completed', output: 'hi\n' }] })) },
  { id: 'judge-wrong', label: 'Hosted, wrong prime sum', group: 'judge', expect: 'wrong', note: 'The right environment does not make every answer right.', run: () => judged(computeRun({ answer: `sha256: ${expected.sha256}\nprime_sum: 12345` })) },
  { id: 'judge-failed', label: 'The turn failed', group: 'judge', expect: 'failed', note: 'Errors first: nothing else is judged.', run: () => judged(computeRun({ turnStatus: 'failed', error: 'The hosted environment failed.' })) },
  { id: 'judge-billing', label: 'Refused by a billing limit', group: 'judge', expect: 'Blocked: usage or billing limit · skip', note: 'Live: the sandbox was ready after 20.1 s, then the turn failed with no work done. Not the agent “choosing” no shell.', run: () => { const verdict = judgeEnvRun(computeRun({ task: 'explain', turnStatus: 'failed', readyMs: 20_100, commands: [], answer: '', error: 'Your organization has reached a usage or billing limit. Review your plan, usage limits, and billing settings at https://platform.openai.com/settings/organization/billing/ before retrying.' })); const commands = verdict.checks.find((check) => check.id === 'commands'); return { got: `${verdict.title} · ${commands?.level}`, detail: `${verdict.text}\n${verdict.checks.map((check) => `${check.level} · ${check.label}: ${check.detail}`).join('\n')}` }; } },
];

export function runEnvSuite(): TestResult[] {
  return envTests.map((test) => {
    try {
      const { got, detail } = test.run();
      return { id: test.id, got, detail, pass: got === test.expect };
    } catch (error) {
      return { id: test.id, got: 'threw', detail: error instanceof Error ? error.stack ?? error.message : String(error), pass: false };
    }
  });
}
