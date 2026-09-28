import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import { AnswerPre } from './Lab6.tsx';
import { Findings, codeTokens, readLines } from './Lab22.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { shortId } from './lab13Recovery.ts';
import { checkUrl } from './lab21Search.ts';
import {
  buildEnvironment, checkEnvironment, expectedFor, isAccountLimit, judgeEnvRun, makeSpec, needInfo, outcomeTone, parseCommand, parseEnvRun, promptFor, recommend, unwrapCommand,
  type CommandRun, type ComputeSpec, type EnvKind, type EnvRun, type Need, type NetworkAccess, type TaskKind,
} from './lab26Environment.ts';
import { requestSamples, samples } from './lab26Scenarios.ts';
import { envTests, runEnvSuite, type TestGroup, type TestResult } from './lab26Tests.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Suite = { source: 'browser' | 'server'; runtime: string; durationMs: number; results: Record<string, TestResult> };
type RunRecord = { id: string; run: EnvRun; environment: unknown };
type LiveRun = { status: string; events: Array<{ name: string; ms: number }>; sessionId: string | null; commands: CommandRun[]; commentary: string[]; answer: string };

const lessons: Lesson[] = [
  { number: '01', title: 'Two environments, one field', file: 'server/lab26.ts', code: "// Question answering: no sandbox at all\nenvironment: { type: 'none' }\n\n// File and command work: a sandbox with a shell\nenvironment: { type: 'openai_hosted', network: { access: 'disabled' } }\n\n// Everything else in the request stays the same:\nagent: { model, instructions }   // identical in every run", explanation: 'The environment is one field in sessions create, and it decides what the agent can do. None means the model answers directly: there is no sandbox, no shell, and no files. Open A I hosted gives the agent a sandbox with a shell in slash workspace. In this lab the model and the instructions are identical in every run, so the environment is the only thing that changes. The hosted request also says network disabled, because computing a hash needs no internet, and the beta default is enabled.' },
  { number: '02', title: 'Choose from what the task needs', file: 'src/lab26Environment.ts', code: "export function recommend(needs: Need[]): Recommendation {\n  const hostedNeeds = needs.filter((need) => needInfo[need].hosted);\n  if (!hostedNeeds.length) return { kind: 'none', network: 'disabled', reasons };\n  // commands, files, packages, skills or plugins, exact results\n  const network = needs.includes('internet') ? 'restricted' : 'disabled';\n  return { kind: 'openai_hosted', network, reasons };\n}", explanation: 'Start from the task, not from the most powerful option. If the task only needs the model’s knowledge, like explaining when a tuple beats a list, choose none: there is nothing to provision and nothing to wait for. If it needs to run a command, read or write a file, install a package, use a skill or plugin, or produce an exact result someone will check, choose Open A I hosted. Then choose the smallest network policy that works: disabled, or restricted to named domains.' },
  { number: '03', title: 'none: ask in sessions.create and stream', file: 'server/lab26.ts', code: "const stream = await client.beta.agents.sessions.create({\n  agent: { model, instructions },\n  environment: { type: 'none' },\n  input: prompt,\n  stream: true,\n});\nfor await (const event of stream) {\n  // session.created → turn.created → output_text → turn.completed\n}", explanation: 'With none there is nothing to get ready, so the question goes straight into sessions create, and the answer streams back at once. Live, the explain task took about nine seconds from request to completed turn. The request checker also repeats what the A P I refused: a none environment takes only its type. Adding network, or even an empty files list, returned a four hundred, unknown parameter.' },
  { number: '04', title: 'openai_hosted: create, wait for ready, then ask', file: 'server/lab26.ts', code: "const session = await sessions.create({ agent, environment });  // no input yet\nconst stream = await sessions.events.stream(session.id);\nfor await (const event of stream) {\n  if (event.type === 'agent.session.environment.ready') await send(prompt);  // once\n  if (event.type === 'agent.session.turn.item.done'\n      && event.item.type === 'command_execution') commands.push(event.item);\n}", explanation: 'A hosted sandbox has to be provisioned. Live, environment ready arrived between twenty and twenty six seconds after the session was created, and one session sent it twice, so the app sends the question on the first one only. As in Lab 25, the session is created without input, the event stream is opened, and the task goes in when the sandbox is ready. After that, each command the agent runs arrives as a command execution item.' },
  { number: '05', title: 'Evidence: command_execution items', file: 'src/lab26Environment.ts', code: "{\n  \"type\": \"command_execution\",\n  \"command\": \"/bin/bash -lc \\\"printf %s \\\\\\\"$text\\\\\\\" | sha256sum\\\"\",\n  \"cwd\": \"/workspace\",\n  \"exit_code\": 0,\n  \"output\": \"d40df0ae…04dc8f  -\\n\"\n}\n// commentary: \"I’ll compute both directly…\"  ← a claim, not evidence", explanation: 'A command execution item is the proof that work happened: the command, the working directory, the exit code, and the output. The agent’s commentary is only a claim. Live, a none session said it would compute both values directly, but it had no shell, and the session held nothing but reasoning and messages. Read the output too, not just the exit code: one live command printed a Python syntax error and still exited with zero. The agent noticed and ran it again.' },
  { number: '06', title: 'Check the answer yourself', file: 'src/lab26Environment.ts', code: "const spec = makeSpec();               // lab26-<8 hex>, a fresh limit\nconst expected = expectedFor(spec);    // sha256Hex + primeSum, in the app\nconst reported = parseComputeAnswer(run.answer);\nconst ok = reported.sha256 === expected.sha256\n  && grounded(reported.sha256, run.commands);  // it came out of a command\n// none → invented · hosted → right fit", explanation: 'Each comparison uses a fresh input, so no answer can be remembered, and the app computes the expected values itself, with its own SHA two fifty six. Live, a none session returned a SHA two fifty six that looked perfect and was wrong, twice. The hosted session got both values right, and both appear in a command’s output. The lesson is not that none is bad: it was the right fit, and four times faster, for the explain task. Choose the environment the task needs, then check the evidence.' },
];

const groups: Array<{ id: TestGroup; label: string }> = [
  { id: 'compute', label: 'Compute the expected values' },
  { id: 'choose', label: 'Choose and build the environment' },
  { id: 'request', label: 'Check a request like the API' },
  { id: 'answer', label: 'Read an answer and a command' },
  { id: 'judge', label: 'Judge a run from its evidence' },
];
const taskInfo: Record<TaskKind, { label: string; note: string; needs: Need[] }> = {
  explain: { label: 'Explain: tuple or list?', note: 'Question answering from the model’s knowledge.', needs: ['answer'] },
  compute: { label: 'Compute: SHA-256 and a prime sum', note: 'Exact values, only checkable if really computed.', needs: ['answer', 'exact', 'commands'] },
};
const kindLabel: Record<EnvKind, string> = { none: 'none', openai_hosted: 'openai_hosted' };
const networkInfo: Record<NetworkAccess, string> = { disabled: 'No network: enough to compute', enabled: 'Any domain (the beta default)', restricted: 'Only named domains' };
const allNeeds = Object.keys(needInfo) as Need[];

const json = (value: unknown) => codeTokens(Prism.tokenize(JSON.stringify(value, null, 2) ?? 'undefined', Prism.languages.json || Prism.languages.javascript));
const bash = (text: string) => codeTokens(Prism.tokenize(text, Prism.languages.bash || Prism.languages.javascript));
const newId = (): string => `env_${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)}`;
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const tokens = (value: number | null | undefined) => (value === null || value === undefined ? 'unknown' : value.toLocaleString('en'));
const short = (hex: string) => `${hex.slice(0, 12)}…${hex.slice(-6)}`;

function SafeAnswer({ answer }: { answer: string }) {
  return <div className="lab7-answer lab16-answer lab21-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    pre: AnswerPre,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const check = checkUrl(href ?? '');
      return check.href ? <a href={check.href} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span className="lab21-dead">{children}</span>;
    },
  }}>{answer}</ReactMarkdown></div>;
}

export function CommandLog({ commands, kind, stopped = false }: { commands: CommandRun[]; kind: EnvKind; stopped?: boolean }) {
  if (!commands.length) return <p className="lab8-note">{stopped ? 'No command_execution items: the turn stopped before the agent did any work.' : kind === 'none' ?'No command_execution items: a none environment has no shell.' : 'No command_execution items: the agent did not use the shell.'}</p>;
  return <ol className="lab26-commands">{commands.map((command) => {
    const printedError = /Traceback|SyntaxError|command not found/.test(command.output ?? '');
    return <li key={command.id} className={command.exitCode !== 0 || printedError ? 'warn' : ''}>
      <div className="lab26-command-head"><code>command_execution</code><span>cwd <code>{command.cwd ?? '—'}</code></span><span className={'lab21-status' + (command.exitCode === 0 ? '' : ' bad')}>exit {command.exitCode ?? '—'}</span>{printedError ? <span className="lab21-badge bad">error in output</span> : null}<code className="lab22-id">{shortId(command.id)}</code></div>
      <pre className="lab19-decl lab26-cmd"><code>{bash(unwrapCommand(command.command))}</code></pre>
      <pre className="lab22-output">{command.output ?? '(no output)'}</pre>
    </li>;
  })}</ol>;
}

function Checks({ run }: { run: EnvRun }) {
  const verdict = judgeEnvRun(run);
  return <>
    <div className={'lab23-judgement ' + outcomeTone[verdict.outcome]}><strong>{verdict.title}</strong><span>{verdict.text}</span></div>
    <ul className="lab21-findings lab25-checks">{verdict.checks.map((check) => <li key={check.id} className={check.level === 'fail' ? 'error' : check.level}><b>{check.level === 'ok' ? '✓' : check.level === 'skip' ? '–' : check.level === 'warn' ? '!' : '✕'}</b><span><strong>{check.label}.</strong> {check.detail}</span></li>)}</ul>
  </>;
}

function RunDetail({ record }: { record: RunRecord }) {
  const { run } = record;
  return <div className="lab25-run">
    <p className="lab16-prompt-line">“{run.prompt}”</p>
    <p className="lab15-ids"><b>{taskInfo[run.task].label}</b> · <b>{kindLabel[run.kind]}</b>{run.sessionId ? <> · session <code>{shortId(run.sessionId)}</code></> : null} · turn <code>{run.turnStatus}</code>{run.completion === 'polled' ? <> · outcome <b>read from the API</b></> : null}</p>
    <Checks run={run} />
    <div className="lab25-facts">
      <span><small>Environment</small><b>{run.reportedType ?? kindLabel[run.kind]}</b>{run.network ? <small>network {run.network.access}</small> : null}</span>
      <span><small>Sandbox ready</small><b>{run.kind === 'none' ? 'nothing to wait for' : seconds(run.readyMs)}</b></span>
      <span><small>Total time</small><b>{seconds(run.durationMs)}</b></span>
      <span><small>Tokens</small><b>{tokens(run.usage?.total)}</b>{run.usage ? <small>{tokens(run.usage.input)} in · {tokens(run.usage.output)} out</small> : <small>not reported (best-effort)</small>}</span>
    </div>
    {run.spec && run.expected ? <p className="lab8-note">Input <code>{run.spec.text}</code>, primes below <b>{run.spec.limit.toLocaleString('en')}</b>. This app expects <code>{short(run.expected.sha256)}</code> and <b>{run.expected.primeSum.toLocaleString('en')}</b>.</p> : null}
    <div className="lab21-report-grid">
      <div><h3 className="lab13-subhead">Answer</h3>{run.answer ? <SafeAnswer answer={run.answer} /> : <p className="lab8-note">No answer text.</p>}
        {run.commentary.length ? <><h3 className="lab13-subhead">Commentary <small>(a claim, not evidence)</small></h3><ul className="lab26-commentary">{run.commentary.map((line, index) => <li key={index}>{line}</li>)}</ul></> : null}
        {run.error ? <p className="lab2-error" role="alert">{run.error}</p> : null}</div>
      <div><h3 className="lab13-subhead">Evidence <code>command_execution</code></h3><CommandLog commands={run.commands} kind={run.kind} stopped={Boolean(run.error) || run.turnStatus === 'failed' || run.turnStatus === 'cancelled'} /></div>
    </div>
    <details className="lab16-preview"><summary>The environment the server sent</summary><pre className="lab19-decl"><code>{json(record.environment)}</code></pre></details>
  </div>;
}

function Matrix({ records, onSelect }: { records: RunRecord[]; onSelect: (id: string) => void }) {
  const latest = (task: TaskKind, kind: EnvKind) => [...records].reverse().find((item) => item.run.task === task && item.run.kind === kind) ?? null;
  return <div className="lab26-matrix" role="table" aria-label="Latest run for each task and environment">
    <div role="row" className="lab26-matrix-row head"><span role="columnheader" /><span role="columnheader"><code>none</code></span><span role="columnheader"><code>openai_hosted</code></span></div>
    {(Object.keys(taskInfo) as TaskKind[]).map((task) => <div role="row" key={task} className="lab26-matrix-row">
      <span role="rowheader"><strong>{taskInfo[task].label}</strong><small>{taskInfo[task].note}</small></span>
      {(['none', 'openai_hosted'] as EnvKind[]).map((kind) => {
        const record = latest(task, kind);
        if (!record) return <span role="cell" key={kind} className="lab26-cell empty">not run yet</span>;
        const verdict = judgeEnvRun(record.run);
        return <button type="button" role="cell" key={kind} className={'lab26-cell ' + outcomeTone[verdict.outcome]} onClick={() => onSelect(record.id)}>
          <strong>{verdict.title}</strong><small>{seconds(record.run.durationMs)} · {record.run.commands.length} command{record.run.commands.length === 1 ? '' : 's'} · {tokens(record.run.usage?.total)} tokens</small>
        </button>;
      })}
    </div>)}
  </div>;
}

function parseSuite(body: unknown): Suite {
  const value = body as { results?: unknown; runtime?: unknown; durationMs?: unknown };
  if (!Array.isArray(value.results)) throw new Error('Invalid test results.');
  const results: Record<string, TestResult> = {};
  for (const raw of value.results as TestResult[]) {
    if (typeof raw?.id !== 'string' || typeof raw.pass !== 'boolean' || typeof raw.got !== 'string') throw new Error('Invalid test result.');
    results[raw.id] = { id: raw.id, pass: raw.pass, got: raw.got, detail: typeof raw.detail === 'string' ? raw.detail : '' };
  }
  return { source: 'server', runtime: typeof value.runtime === 'string' ? value.runtime : 'Node', durationMs: typeof value.durationMs === 'number' ? value.durationMs : 0, results };
}

export default function Lab26({ active, health }: { active: boolean; health: Health }) {
  const [needs, setNeeds] = useState<Need[]>(taskInfo.compute.needs);
  const [editor, setEditor] = useState(JSON.stringify(buildEnvironment('openai_hosted', 'disabled'), null, 2));
  const [requestId, setRequestId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskKind>('compute');
  const [spec, setSpec] = useState<ComputeSpec>(() => makeSpec());
  const [network, setNetwork] = useState<NetworkAccess>('disabled');
  const [live, setLive] = useState<Record<EnvKind, LiveRun | null>>({ none: null, openai_hosted: null });
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState(samples[0].id);
  const [suite, setSuite] = useState<Suite | null>(null);
  const [suiteBusy, setSuiteBusy] = useState<'browser' | 'server' | null>(null);
  const [testId, setTestId] = useState(envTests[0].id);
  const [error, setError] = useState('');
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const aborts = useRef<Set<AbortController>>(new Set());
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const recommendation = useMemo(() => recommend(needs), [needs]);
  const recommended = buildEnvironment(recommendation.kind, recommendation.network, recommendation.network === 'restricted' ? ['pypi.org'] : []);
  const parsedEditor = useMemo(() => { try { return { value: JSON.parse(editor) as unknown, error: null }; } catch (caught) { return { value: null, error: caught instanceof Error ? caught.message : 'Invalid JSON.' }; } }, [editor]);
  const editorCheck = useMemo(() => (parsedEditor.error ? { environment: null, findings: [{ level: 'error' as const, text: `Not JSON: ${parsedEditor.error}` }] } : checkEnvironment(parsedEditor.value)), [parsedEditor]);
  const requestSample = requestSamples.find((item) => item.id === requestId) ?? null;
  const expected = useMemo(() => expectedFor(spec), [spec]);
  const running = live.none !== null || live.openai_hosted !== null;
  const chosen = records.find((item) => item.id === selectedId) ?? records.at(-1) ?? null;
  const sample = samples.find((item) => item.id === sampleId) ?? samples[0];
  const test = envTests.find((item) => item.id === testId) ?? envTests[0];
  const testResult = suite?.results[test.id] ?? null;
  const passed = suite ? Object.values(suite.results).filter((item) => item.pass).length : 0;
  const noKey = !health?.configured;
  const lastError = records.at(-1)?.run.error ?? null;
  const accountLimited = lastError && isAccountLimit(lastError) ? lastError.split('. ')[0] : null;
  const hostedEnvironment = buildEnvironment('openai_hosted', network);

  function toggleNeed(need: Need) { setNeeds((previous) => (previous.includes(need) ? previous.filter((item) => item !== need) : [...previous, need])); }
  function loadRequest(id: string) { const item = requestSamples.find((entry) => entry.id === id); if (!item) return; setRequestId(id); setEditor(JSON.stringify(item.environment, null, 2)); }

  // One task in one new session. Both environments may run at once; each has its own live pane.
  async function runOne(kind: EnvKind, environment: unknown, force = false, runTask: TaskKind = task) {
    const controller = new AbortController();
    aborts.current.add(controller);
    setLive((previous) => ({ ...previous, [kind]: { status: 'Starting…', events: [], sessionId: null, commands: [], commentary: [], answer: '' } }));
    const update = (patch: Partial<LiveRun> | ((current: LiveRun) => Partial<LiveRun>)) => setLive((previous) => {
      const current = previous[kind];
      return current ? { ...previous, [kind]: { ...current, ...(typeof patch === 'function' ? patch(current) : patch) } } : previous;
    });
    try {
      const response = await fetch('/api/lab26/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: runTask, spec: runTask === 'compute' ? spec : undefined, environment, force }), signal: controller.signal });
      if (!response.ok) {
        const failure = await response.json() as { error?: string; findings?: Array<{ level: string; text: string }> };
        throw new Error([failure.error || `Request failed (${response.status}).`, ...(failure.findings ?? []).filter((item) => item.level === 'error').map((item) => item.text)].join(' '));
      }
      let summary: unknown = null;
      await readLines(response, (line) => {
        if (line.type === 'status' && typeof line.label === 'string') update({ status: line.label });
        if (line.type === 'event' && typeof line.name === 'string') { const entry = { name: line.name, ms: Number(line.ms ?? 0) }; update((current) => ({ events: [...current.events, entry].slice(-60) })); }
        if (line.type === 'session' && typeof line.sessionId === 'string') update({ sessionId: line.sessionId });
        if (line.type === 'command') { const next = parseCommand(line.command); update((current) => ({ commands: [...current.commands.filter((item) => item.id !== next.id), next] })); }
        if (line.type === 'text' && typeof line.text === 'string') update({ answer: line.text, commentary: Array.isArray(line.commentary) ? line.commentary.map(String) : [] });
        if (line.type === 'summary') summary = line.run;
      });
      if (!summary) throw new Error('The stream ended without a summary.');
      const run = parseEnvRun(summary);
      // The browser recomputes the expected values with its own SHA-256 rather than trusting the server's.
      if (run.spec) run.expected = expectedFor(run.spec);
      const record: RunRecord = { id: newId(), run, environment };
      setRecords((previous) => [...previous, record]);
      setSelectedId(record.id);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error ? caught.message : 'The run failed.');
    } finally {
      aborts.current.delete(controller);
      setLive((previous) => ({ ...previous, [kind]: null }));
    }
  }
  async function runBoth() {
    setError('');
    await Promise.all([runOne('none', buildEnvironment('none', 'disabled')), runOne('openai_hosted', hostedEnvironment)]);
  }
  function runEditor(force: boolean) {
    setError('');
    const value = parsedEditor.value as { type?: unknown } | null;
    void runOne(value?.type === 'openai_hosted' ? 'openai_hosted' : 'none', parsedEditor.value, force, 'explain');
  }
  function stopAll() { aborts.current.forEach((controller) => controller.abort()); }

  function runInBrowser() {
    setSuiteBusy('browser'); setError('');
    const started = performance.now();
    try {
      const results = runEnvSuite();
      setSuite({ source: 'browser', runtime: 'this browser', durationMs: Math.round(performance.now() - started), results: Object.fromEntries(results.map((item) => [item.id, item])) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The suite crashed.'); }
    finally { setSuiteBusy(null); }
  }
  async function runOnServer() {
    setSuiteBusy('server'); setError('');
    try {
      const response = await fetch('/api/lab26/test', { method: 'POST' });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
      setSuite(parseSuite(body));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not run the suite on the server.'); }
    finally { setSuiteBusy(null); }
  }

  useEffect(() => {
    if (!speechAvailable) return;
    const synthesis = window.speechSynthesis;
    const update = () => setVoices(synthesis.getVoices());
    update(); synthesis.addEventListener('voiceschanged', update);
    return () => synthesis.removeEventListener('voiceschanged', update);
  }, [speechAvailable]);
  useEffect(() => () => { aborts.current.forEach((controller) => controller.abort()); if (speechAvailable) window.speechSynthesis.cancel(); }, [speechAvailable]);
  useEffect(() => { if (!active) stopSpeech(); }, [active]);

  function stopSpeech() { speechRun.current += 1; if (speechAvailable) window.speechSynthesis.cancel(); setSpeaking(null); }
  // Queue one or more explanations; the run counter ignores callbacks from cancelled narrations.
  function speak(queue: Lesson[], speechMode: 'one' | 'all') {
    if (!speechAvailable) return;
    stopSpeech();
    const current = speechRun.current;
    const narrator = selectNarratorVoice(voices.length ? voices : window.speechSynthesis.getVoices());
    queue.forEach((lesson, index) => {
      const spokenTitle = lesson.title.replace('openai_hosted', 'Open A I hosted').replace('sessions.create', 'sessions create').replace('command_execution', 'command execution');
      const utterance = new SpeechSynthesisUtterance(`${speechMode === 'all' ? `Snippet ${Number(lesson.number)}. ` : ''}${spokenTitle}. ${lesson.explanation}`);
      if (narrator) utterance.voice = narrator;
      utterance.lang = narrator?.lang || 'en-US';
      utterance.pitch = narrator && masculineVoiceName.test(narrator.name) ? 1 : 0.78;
      utterance.rate = 0.95;
      utterance.onstart = () => { if (speechRun.current === current) setSpeaking({ mode: speechMode, lesson: lesson.number }); };
      utterance.onerror = () => { if (speechRun.current === current) setSpeaking(null); };
      if (index === queue.length - 1) utterance.onend = () => { if (speechRun.current === current) setSpeaking(null); };
      window.speechSynthesis.speak(utterance);
    });
    setSpeaking({ mode: speechMode, lesson: queue[0].number });
  }
  function readLesson(lesson: Lesson) { if (speaking?.lesson === lesson.number) stopSpeech(); else speak([lesson], 'one'); }
  function readAll() { if (speaking?.mode === 'all') stopSpeech(); else speak(lessons, 'all'); }

  return <div className="lab16-page lab21-page lab22-page lab23-page lab25-page lab26-page">
    <div className="lab2-hero"><span className="lab2-badge lab26-badge">26/50</span><div><div className="eyebrow">LAB 26 / CHOOSE AN ENVIRONMENT</div><h1>Answer with <code>none</code>, <em>work in <code>openai_hosted</code></em>.</h1><p>The <b>environment</b> decides what an agent can do. With <code>none</code> the model answers directly: fast, and no sandbox. With <code>openai_hosted</code> it gets a <b>sandbox with a shell</b>, which takes about 20 seconds to get ready. Run two tasks in both environments, with the same model and instructions, and judge each run from the evidence in the session.</p></div></div>

    <section className="lab3-guide lab25-flow lab26-flow" aria-label="From task to evidence"><h2>From task to evidence</h2><div>
      <article><strong>Task</strong><p>What must the answer contain? Knowledge, or a result someone can check?</p></article>
      <article><strong>Needs</strong><p>Commands, files, packages, skills, exact values, or none of these.</p></article>
      <article><strong>Environment</strong><p><code>none</code>, or <code>openai_hosted</code> with the smallest network policy.</p></article>
      <article><strong>Run</strong><p>none: ask at once. Hosted: create, wait for <code>environment.ready</code>, ask.</p></article>
      <article className="proof"><strong>Evidence</strong><p><code>command_execution</code> items, and values that match your own computation.</p></article>
    </div><p className="lab3-guide-note">The instructions tell the agent to run a command when it has a shell, and never to invent results. Live, the agent in the <code>none</code> session broke the second rule. Only the environment can make the first rule possible.</p></section>

    <section className="lab7-card"><span className="eyebrow">CHOOSE · NO API KEY NEEDED</span><h2>What does the task need?</h2>
      <div className="lab8-actions">{(Object.keys(taskInfo) as TaskKind[]).map((item) => <button type="button" key={item} className="lab8-secondary" onClick={() => setNeeds(taskInfo[item].needs)}>Preset: {taskInfo[item].label}</button>)}</div>
      <div className="lab21-config">
        <fieldset className="lab26-needs"><legend>Needs</legend>
          {allNeeds.map((need) => <label key={need} className={needs.includes(need) ? 'selected' : ''}><input type="checkbox" checked={needs.includes(need)} onChange={() => toggleNeed(need)} /><span><strong>{needInfo[need].label}</strong><small>{needInfo[need].hint}</small></span></label>)}
        </fieldset>
        <div><h3 className="lab13-subhead">Recommendation</h3>
          <div className={'lab23-judgement ' + (recommendation.kind === 'none' ? 'can' : 'cannot')}><strong><code>{recommendation.kind}</code>{recommendation.kind === 'openai_hosted' ? <> · network <code>{recommendation.network}</code></> : null}</strong><span>{recommendation.kind === 'none' ? 'Answer directly: nothing to provision or wait for.' : 'A sandbox with a shell. Allow about 20–30 seconds for it to get ready.'}</span></div>
          <ul className="lab21-findings">{recommendation.reasons.map((reason) => <li key={reason} className="ok"><b>✓</b>{reason}</li>)}</ul>
          <pre className="lab19-decl"><code>{json({ environment: recommended })}</code></pre>
          <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => { setEditor(JSON.stringify(recommended, null, 2)); setRequestId(null); }}>Open in the request checker</button></div>
        </div>
      </div>
    </section>

    <section className="lab7-card"><span className="eyebrow">REQUEST CHECKER · NO API KEY NEEDED</span><h2>Will the API accept this environment?</h2>
      <p>Edit <code>environment</code> and the checker reacts. The five recorded requests below were sent live on 2026-09-28; compare what the checker predicts with what the API answered.</p>
      <div className="lab16-prompts">{requestSamples.map((item) => <button type="button" key={item.id} className={item.id === requestId ? 'selected' : ''} onClick={() => loadRequest(item.id)}>{item.label}</button>)}</div>
      <div className="lab21-config">
        <div><label htmlFor="lab26-editor" className="lab24-label"><code>environment</code></label>
          <textarea id="lab26-editor" className="lab25-textarea lab26-editor" value={editor} onChange={(event) => { setEditor(event.target.value); setRequestId(null); }} spellCheck={false} disabled={running} />
          <div className="lab8-actions">
            <button type="button" className="lab8-secondary" onClick={() => runEditor(false)} disabled={running || noKey || !editorCheck.environment}>Run the explain task with it</button>
            <button type="button" className="lab8-secondary lab24-danger" onClick={() => runEditor(true)} disabled={running || noKey || Boolean(parsedEditor.error) || Boolean(editorCheck.environment)}>Send it anyway, to see the API’s answer</button>
          </div>
        </div>
        <div><h3 className="lab13-subhead">Checker</h3><Findings findings={editorCheck.findings} />
          {requestSample ? <><h3 className="lab13-subhead">Live answer <code>{requestSample.status}</code></h3><pre className={'lab19-decl lab25-raw' + (requestSample.status >= 400 ? ' lab26-refused' : '')}><code>{requestSample.status >= 400 ? requestSample.response : json(JSON.parse(requestSample.response))}</code></pre><p className="lab8-note">{requestSample.lesson}</p></> : null}
        </div>
      </div>
    </section>

    <section className="lab7-card"><span className="eyebrow">LIVE · TWO TASKS, TWO ENVIRONMENTS</span><h2>Run each task where it belongs, and where it does not</h2>
      <fieldset className="lab15-modes lab21-modes lab22-modes" disabled={running}><legend>Task</legend>
        {(Object.keys(taskInfo) as TaskKind[]).map((item) => <label key={item} className={task === item ? 'selected' : ''}><input type="radio" name="lab26-task" checked={task === item} onChange={() => setTask(item)} /><span><strong>{taskInfo[item].label}</strong><small>{taskInfo[item].note}</small></span></label>)}
      </fieldset>
      {task === 'compute' ? <div className="lab26-spec">
        <p className="lab15-ids">Fresh input <code>{spec.text}</code> · primes below <b>{spec.limit.toLocaleString('en')}</b> · expected <code>{short(expected.sha256)}</code> and <b>{expected.primeSum.toLocaleString('en')}</b> (computed in this browser)</p>
        <button type="button" className="lab8-secondary" onClick={() => setSpec(makeSpec())} disabled={running}>New input</button>
      </div> : null}
      <p className="lab16-prompt-line">“{promptFor(task, spec)}”</p>
      <fieldset className="lab15-modes lab21-modes lab22-modes lab25-network" disabled={running}><legend>openai_hosted network</legend>
        {(['disabled', 'enabled'] as NetworkAccess[]).map((item) => <label key={item} className={network === item ? 'selected' : ''}><input type="radio" name="lab26-network" checked={network === item} onChange={() => setNetwork(item)} /><span><strong>{item}</strong><small>{networkInfo[item]}</small></span></label>)}
      </fieldset>
      <div className="lab8-actions">
        <button type="button" className="lab7-primary" onClick={() => void runBoth()} disabled={running || noKey}>{running ? 'Running…' : 'Run in both environments'}</button>
        <button type="button" className="lab8-secondary" onClick={() => { setError(''); void runOne('none', buildEnvironment('none', 'disabled')); }} disabled={running || noKey}>Only none</button>
        <button type="button" className="lab8-secondary" onClick={() => { setError(''); void runOne('openai_hosted', hostedEnvironment); }} disabled={running || noKey}>Only openai_hosted</button>
        {running ? <button type="button" className="lab8-secondary" onClick={stopAll}>Stop</button> : null}
      </div>
      {noKey ? <p className="lab8-note">Add OPENAI_API_KEY to .env to run sessions. The chooser, the request checker, the inspector, and the test page work without a key.</p> : <p className="lab8-note">Both runs start together, each in a new session. none finishes in about 10–25 seconds; openai_hosted waits about 20 seconds for its sandbox first. Hosted sessions stay in your project until they are deleted; Lab 30 covers cleanup.</p>}
      {accountLimited ? <p className="lab20-notice" role="status">The last run was refused with <em>“{accountLimited}”</em>. That is an account limit, not a Lab 26 problem: every new session, in either environment, will fail the same way until the organization’s billing or usage limit is raised. The recorded runs in the inspector below show what these runs produce.</p> : null}
      {running ? <div className="lab26-live">{(['none', 'openai_hosted'] as EnvKind[]).map((kind) => { const pane = live[kind]; return pane ? <div key={kind} className="lab24-live"><p className="lab7-session-id"><b>{kind}</b> · {pane.sessionId ? `session ${shortId(pane.sessionId)} · ` : ''}{pane.status}</p>
        {pane.events.length ? <ol className="lab25-events">{pane.events.filter((event) => !/content_part|output_text|item\.added/.test(event.name)).map((event, index) => <li key={index} className={/environment/.test(event.name) ? 'env' : ''}><code>{event.name.replace('agent.session.', '')}</code><small>{seconds(event.ms)}</small></li>)}</ol> : null}
        {pane.commands.length ? <CommandLog commands={pane.commands} kind={kind} /> : null}
        {pane.answer ? <SafeAnswer answer={pane.answer} /> : null}</div> : null; })}</div> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    <section className="lab7-card"><span className="eyebrow">RESULT · THE TWO-TASK DEMONSTRATION</span><h2>Which environment fits which task?</h2>
      <Matrix records={records} onSelect={setSelectedId} />
      {chosen ? <><h3 className="lab13-subhead">Run #{records.indexOf(chosen) + 1}</h3><RunDetail record={chosen} /></> : <p className="lab8-note">Run both tasks in both environments to fill the grid. The goal: a green cell on the diagonal for each task, and an explanation for the other two.</p>}
      {records.length ? <div className="lab9-table-wrap lab15-history lab16-history"><table>
        <thead><tr><th>Run</th><th>Task</th><th>Environment</th><th>Session</th><th>Ready</th><th>Total</th><th>Commands</th><th>Tokens</th><th>Verdict</th></tr></thead>
        <tbody>{records.map((item, index) => { const verdict = judgeEnvRun(item.run); return <tr key={item.id} className={item.id === chosen?.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}>
          <th><button type="button" className="lab15-link" onClick={() => setSelectedId(item.id)} aria-pressed={item.id === chosen?.id}>#{index + 1}</button></th>
          <td>{item.run.task}</td><td><code>{item.run.kind}</code>{item.run.network ? <small> · {item.run.network.access}</small> : null}</td><td>{item.run.sessionId ? <code>{shortId(item.run.sessionId)}</code> : '—'}</td>
          <td>{item.run.kind === 'none' ? '—' : seconds(item.run.readyMs)}</td><td>{seconds(item.run.durationMs)}</td><td>{item.run.commands.length}</td><td>{tokens(item.run.usage?.total)}</td>
          <td><span className={'lab23-outcome ' + outcomeTone[verdict.outcome]}>{verdict.title}</span></td></tr>; })}</tbody>
      </table></div> : null}
    </section>

    <section className="lab7-card" id="lab26-inspector"><span className="eyebrow">ENVIRONMENT INSPECTOR · NO API KEY NEEDED</span><h2>Recorded runs, judged from the session</h2>
      <p>{samples.length} runs from live probes on 2026-09-28, with the same model and instructions in every session. Session IDs, environment reports, commands, outputs, answers, timings, and token counts are real.</p>
      <div className="lab16-prompts">{samples.map((item) => <button type="button" key={item.id} className={item.id === sample.id ? 'selected' : ''} onClick={() => setSampleId(item.id)}>{item.label}</button>)}</div>
      <p className="lab8-note">{sample.lesson}</p>
      <RunDetail record={{ id: sample.id, run: sample.run, environment: sample.environment }} />
    </section>

    <section className="lab7-card" id="lab26-tests"><span className="eyebrow">TEST PAGE · NO API KEY NEEDED</span><h2>{envTests.length} cases, one function each</h2><p>Every case runs the real <code>sha256Hex</code>, <code>primeSum</code>, <code>makeSpec</code>, <code>checkSpec</code>, <code>recommend</code>, <code>buildEnvironment</code>, <code>checkEnvironment</code>, <code>parseComputeAnswer</code>, <code>unwrapCommand</code>, or <code>judgeEnvRun</code>, in this browser or on the server. Notes marked <em>Live</em> repeat what the API did on 2026-09-28.</p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={runInBrowser} disabled={Boolean(suiteBusy)}>{suiteBusy === 'browser' ? 'Running…' : 'Run all in the browser'}</button><button type="button" className="lab8-secondary" onClick={() => void runOnServer()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'server' ? 'Running…' : 'Run all on the server'}</button></div>
      {suite ? <p className={'lab18-score ' + (passed === envTests.length ? 'ok' : 'fail')}><b>{passed}/{envTests.length} passed</b> · ran in {suite.runtime} · {suite.durationMs} ms</p> : <p className="lab8-note">Not run yet. Each row states the result it must produce.</p>}
      <div className="lab18-tests">
        <div className="lab9-table-wrap lab18-table lab21-table"><table>
          <thead><tr><th>Case</th><th>Expect</th><th>Got</th><th /></tr></thead>
          {groups.map((group) => <tbody key={group.id}><tr className="lab18-group"><th colSpan={4}>{group.label}</th></tr>{envTests.filter((item) => item.group === group.id).map((item) => { const result = suite?.results[item.id]; return <tr key={item.id} className={item.id === test.id ? 'selected' : ''} onClick={() => setTestId(item.id)}>
            <th><button type="button" className="lab15-link" onClick={() => setTestId(item.id)} aria-pressed={item.id === test.id}>{item.label}</button></th>
            <td><span className="lab18-expect">{item.expect}</span></td><td>{result ? <span className="lab18-expect">{result.got}</span> : '—'}</td>
            <td>{result ? <span className={'lab18-pass ' + (result.pass ? 'ok' : 'fail')}>{result.pass ? 'PASS' : 'FAIL'}</span> : null}</td></tr>; })}</tbody>)}
        </table></div>
        <div className="lab18-detail lab21-detail">
          <h3 className="lab13-subhead">{test.label} <code>expect {test.expect}</code></h3>
          <p className="lab8-note">{test.note}</p>
          {testResult ? <pre className="lab19-scroll lab21-detail-pre"><code>{testResult.detail}</code></pre> : <p className="lab8-note">Run the suite to see what this case produced.</p>}
        </div>
      </div>
    </section>

    <section className="lab3-guide lab16-guide"><h2>Read the evidence</h2><div><article><strong>Reported type</strong><p><code>session.environment.type</code> and, for hosted, its <code>network.access</code>. Not what you meant to send.</p></article><article><strong>Waiting</strong><p><code>environment.ready</code> time: the price of a sandbox, paid even when nothing runs in it.</p></article><article><strong>Commands</strong><p><code>command_execution</code> items with output. Commentary like “I’ll compute it” is a claim.</p></article><article><strong>Values</strong><p>Compare with your own computation, on a fresh input. A wrong hash looks exactly like a right one.</p></article></div><p className="lab3-guide-note">none is not the weak option: it was the right fit for the explain task, and four times faster. The mistake is using either one for the other task.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 26</span><span className="code-lessons-title" role="heading" aria-level={2}>The code that chooses an environment and proves the choice</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Set the environment field, choose it from the task’s needs, stream a none session, wait for a hosted sandbox, read the command evidence, and check the answer yourself. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Run the test page on the server and show <em>{envTests.length}/{envTests.length} passed</em>. In the request checker, predict and then load <em>none + network</em> and <em>restricted, no domains</em>; send one of them anyway and compare the API’s 400 with the checker. Then, live: run both tasks in both environments and fill the grid. For each cell, name the evidence behind its verdict (reported type, ready time, <code>command_execution</code> items, values). Finally, click <em>New input</em>, run the compute task in <code>none</code> twice, and explain why a correct answer there would still be “no evidence”.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
