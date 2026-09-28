import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import { AnswerPre } from './Lab6.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { shortId } from './lab13Recovery.ts';
import type { ToolCall } from './lab16Tool.ts';
import { maxRounds, type TraceItem } from './lab17Action.ts';
import { classifyValidationRun, faults, liveTiming, parseValidationRun, stages, strictCalendarTool, testTiming, toolResultEvent, type CheckedResult, type Declaration, type Fault, type Moment, type Stage, type ToolOutcome, type ValidationRun } from './lab18Validate.ts';
import { runSuite, runTest, toolTests, type TestGroup, type TestResult } from './lab18Tests.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Live = { events: string[]; calls: ToolCall[]; results: CheckedResult[]; answer: string; timeline: Moment[] };
type Suite = { source: 'browser' | 'server'; runtime: string; durationMs: number; results: Record<string, TestResult> };

const lessons: Lesson[] = [
  { number: '01', title: 'Arguments are unknown until proven', file: 'src/lab18Validate.ts', code: "export function validateCalendarArgs(raw: unknown): Validation {\n  const parsed = parseArguments(raw);          // 1. a JSON object?\n  if (!parsed.value) return reject('parse', …);\n  const shape = checkSchema(parsed.value, schema); // 2. shape and types\n  if (shape.length) return { ok: false, issues: shape };\n  const args: CalendarArgs = { topic: …, kind: … }; // 3. now typed\n  const meaning = checkMeaning(args);          // 4. rules code knows\n  if (meaning.length) return { ok: false, issues: meaning };\n  return { ok: true, value: normalise(args) };\n}", explanation: 'The SDK types the arguments as unknown, and that is honest: they are text written by a model. Validation is the only door from unknown to a real TypeScript type. First parse, because the arguments can arrive as an object or as a JSON string. Then check the shape against the same schema you declared. Only after that do the casts become safe, and the function receives a typed CalendarArgs value. Finally, normalise it, for example by trimming extra spaces.' },
  { number: '02', title: 'Report every issue, with a path', file: 'src/lab18Validate.ts', code: "for (const key of required)\n  if (!(key in value)) issues.push({ path: `/${key}`, code: 'required', … });\nfor (const [key, item] of Object.entries(value)) {\n  if (properties[key]) issues.push(...checkSchema(item, properties[key], `/${key}`));\n  else if (additionalProperties === false)\n    issues.push({ path: `/${key}`, code: 'additional', message: 'is not a declared argument.' });\n}\n// → 'Invalid arguments for lookup_course_calendar:\\n- kind must be one of …\\nFix these and call the tool again.'", explanation: 'Do not stop at the first problem. Collect every issue, and give each one a path, such as topic or kind, and a short message that says what was expected and what arrived. The agent reads this error text, so write it for the agent: name the field, show the allowed values, and say what to do next. One clear message lets the model fix every mistake in a single retry, instead of one retry per mistake.' },
  { number: '03', title: 'Check what a schema cannot', file: 'src/lab18Validate.ts', code: "export function isRealDate(text: string) {\n  const [y, m, d] = text.split('-').map(Number);\n  const date = new Date(Date.UTC(y, m - 1, d));\n  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;\n}\n// '2026-02-30' matches ^\\d{4}-\\d{2}-\\d{2}$ … but is not a day.\nif (!isRealDate(args.from_date)) issue('/from_date', 'date', …);\nif (args.from_date > courseWindow.last) issue('/from_date', 'window', …);\nif (controlCharacters.test(args.topic)) issue('/topic', 'control', …);", explanation: 'A schema checks shape: this is a string of ten characters in the right pattern. It cannot know that the thirtieth of February does not exist, that a date is outside the course, or that a topic hides control characters. Those rules belong in your code, after the schema passes. Keep them in a separate layer, so the error message can say which kind of rule failed.' },
  { number: '04', title: 'Put a deadline on the call', file: 'src/lab18Validate.ts', code: "export async function withTimeout(work, ms) {\n  const controller = new AbortController();\n  let timer;\n  const deadline = new Promise((_, reject) => {\n    timer = setTimeout(() => {\n      const error = new ToolTimeoutError(ms);\n      controller.abort(error); // stop the work too\n      reject(error);\n    }, ms);\n  });\n  try { return await Promise.race([work(controller.signal), deadline]); }\n  finally { clearTimeout(timer); }\n}", explanation: 'While your function runs, the agent turn is paused and the user is waiting. So every call needs a deadline. Race the work against a timer. When the timer wins, reject with a timeout error, and also abort the work through its signal, otherwise it keeps running in the background and its late result is simply thrown away. Always clear the timer in finally, so a fast call does not leave a timer behind.' },
  { number: '05', title: 'Catch it, and keep internals on the server', file: 'src/lab18Validate.ts', code: "try {\n  const result = await withTimeout((signal) => calendarService(args, signal), 1500);\n  return ok(JSON.stringify(result));\n} catch (caught) {\n  if (caught instanceof ToolTimeoutError)\n    return fail('timeout', 'did not answer within 1500 ms. You may try once more…', true);\n  if (caught instanceof TransientError)\n    return fail('exception', 'hit a temporary error. Try the same call once more.', true);\n  const ref = errorRef();\n  console.warn(`[${ref}]`, caught.stack);   // server log only\n  return fail('exception', `internal error (ref ${ref}). Do not retry.`, false);\n}", explanation: 'Any function can throw. Catch everything, and still answer the call with success false, so the turn never hangs. Then decide what the agent should do. A timeout or a dropped connection is worth one more try, so say so. A real bug will fail again, so say do not retry. Never send the stack trace or the raw error to the model: it can leak file paths and secrets, and the model may repeat it to the user. Log it on the server with a reference, and send only the reference.' },
  { number: '06', title: 'Test the failing cases too', file: 'src/lab18Tests.ts', code: "export const toolTests: ToolTest[] = [\n  test('valid-lab', 'A lab by number', 'valid', { topic: 'lab 18', kind: 'lab' }, 'ok'),\n  test('enum', 'Wrong enum', 'invalid', { topic: 'lab 18', kind: 'workshop' }, 'schema'),\n  test('feb30', 'A date that does not exist', 'invalid', { …, from_date: '2026-02-30' }, 'meaning'),\n  test('slow', 'Service too slow', 'failure', …, 'timeout', { fault: 'slow' }),\n  // …21 cases\n];\nconst outcome = await runTool({ name, arguments: args }, { fault, attempt, timing });\nconst pass = outcome.stage === expected;", explanation: 'A tool is only as safe as the cases you tried. Write down valid inputs, invalid inputs for each rule, and failures of the service itself: slow, crashing, and flaky. For each case, state the stage where it must stop. The same runTool function runs in the browser, on the server, and in the live agent loop, so a passing suite is real evidence about the code the agent calls, with no API key needed.' },
];

const prompts = [
  { label: 'Valid lookup', text: 'When is the Lab 18 session?' },
  { label: 'Impossible date', text: 'Check the course calendar for anything on or after 2026-02-30.' },
  { label: 'Outside the course', text: 'List all course deadlines from 1 January 2031.' },
  { label: 'Likely wrong kind', text: 'When is the Lab 18 workshop?' },
];

const groups: Array<{ id: TestGroup; label: string }> = [
  { id: 'valid', label: 'Valid inputs' },
  { id: 'invalid', label: 'Invalid inputs' },
  { id: 'failure', label: 'Service failures' },
];

function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}
const json = (value: unknown) => codeTokens(Prism.tokenize(JSON.stringify(value, null, 2) ?? 'undefined', Prism.languages.json || Prism.languages.javascript));
const newId = (): string => `run_${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)}`;
const parseOutput = (output: string | null): unknown => { if (output === null) return null; try { return JSON.parse(output); } catch { return output; } };
const stageLabel = (stage: Stage) => stages.find((item) => item.id === stage)?.label ?? stage;
const argsText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

async function readLines(response: Response, onLine: (line: Record<string, unknown>) => void) {
  if (!response.body) throw new Error('The browser could not read the response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop() || '';
    for (const raw of lines) if (raw.trim()) onLine(JSON.parse(raw) as Record<string, unknown>);
  }
}

// The checks a call passes through. A call stops at its first failing stage; later stages never run.
function Pipeline({ outcome }: { outcome: Pick<ToolOutcome, 'stage' | 'success'> | null }) {
  const stop = outcome ? stages.findIndex((item) => item.id === outcome.stage) : -1;
  return <ol className="lab18-pipeline" aria-label="Validation pipeline">{stages.map((item, index) => {
    const state = !outcome ? '' : index < stop ? 'pass' : index === stop ? (outcome.success ? 'pass' : 'fail') : 'skip';
    return <li key={item.id} className={state}><span>{state === 'pass' ? '✓' : state === 'fail' ? '✕' : index + 1}</span><strong>{item.label}</strong><small>{state === 'skip' ? 'not reached' : item.detail}</small></li>;
  })}</ol>;
}

function OutcomeView({ outcome, callId, turnId }: { outcome: ToolOutcome; callId: string; turnId: string }) {
  return <div className="lab18-outcome">
    <Pipeline outcome={outcome} />
    <div className="lab18-badges"><span className={'lab18-stage ' + (outcome.success ? 'ok' : 'fail')}>{outcome.success ? 'ran · success: true' : `stopped at ${stageLabel(outcome.stage)}`}</span>{!outcome.success ? <span className={'lab18-retry ' + (outcome.retryable ? 'yes' : 'no')}>{outcome.retryable ? 'retry allowed' : 'do not retry'}</span> : null}<span className="lab15-ids">{outcome.durationMs} ms</span></div>
    {outcome.issues.length ? <ul className="lab18-issues">{outcome.issues.map((item, index) => <li key={index}><span className={'lab18-layer ' + item.layer}>{item.layer}</span><code>{item.path}</code><span>{item.message}</span></li>)}</ul> : null}
    <div className="lab16-args">
      <div><h4>tool_result <small>what the agent receives</small></h4><pre><code>{json(toolResultEvent({ callId, turnId, success: outcome.success, output: outcome.output, error: outcome.error }))}</code></pre></div>
      <div>{outcome.args ? <><h4>validated arguments <small>typed CalendarArgs</small></h4><pre><code>{json(outcome.args)}</code></pre></> : <><h4>validated arguments</h4><p className="lab16-warn-line">None. The function was never called.</p></>}</div>
    </div>
    {outcome.internal ? <div className="lab18-internal"><h4>Server log <small>never sent to the agent</small></h4><pre>{outcome.internal}</pre></div> : null}
    {outcome.success ? <details className="lab16-preview"><summary>The output, parsed <small>sent as a string</small></summary><pre><code>{json(parseOutput(outcome.output))}</code></pre></details> : null}
  </div>;
}

function Timeline({ moments }: { moments: Moment[] }) {
  if (!moments.length) return null;
  const first = moments[0].at;
  return <ol className="lab17-timeline lab18-timeline">{moments.map((moment, index) => <li key={index} className={moment.kind}><span className="lab17-at">+{((moment.at - first) / 1000).toFixed(2)}s</span><span className="lab17-kind">{moment.kind}</span><span className="lab17-label">{moment.label}</span></li>)}</ol>;
}

function RunView({ run }: { run: ValidationRun }) {
  const verdict = classifyValidationRun(run);
  return <div className="lab16-run">
    <div className={'lab16-verdict lab18-verdict ' + verdict.tone}><strong>{verdict.title}</strong><p>{verdict.text}</p></div>
    <div className="lab15-summary-head"><span className="lab15-ids">fault <code>{faults.find((item) => item.id === run.fault)?.label}</code> · declaration <code>{run.declaration}</code> · turn <span className={'lab14-status ' + run.turnStatus}>{run.turnStatus}</span> · rounds <b>{run.rounds}</b>{run.sessionId ? <> · session <code>{shortId(run.sessionId)}</code></> : null}</span></div>
    <h3 className="lab13-subhead">Trace <code>call → check → result</code></h3>
    <Timeline moments={run.timeline} />
    {run.calls.length ? <><h3 className="lab13-subhead">Every call, checked <code>matched by call_id</code></h3><div className="lab17-pairs">{run.calls.map((call, index) => { const result = run.results.find((item) => item.callId === call.callId); return <article key={call.callId} className="lab17-pair">
      <div className="lab16-call-head"><span className="lab16-call-n">{index + 1}</span><code className="lab16-fn">{call.name}(…)</code><span className="lab15-ids">call_id <code>{call.callId}</code>{result ? <> · round <b>{result.round}</b></> : null}</span></div>
      <h4 className="lab18-h4">function_call arguments <small>from the agent</small></h4><pre className="lab18-raw"><code>{json(call.arguments)}</code></pre>
      {result ? <OutcomeView outcome={result} callId={result.callId} turnId={result.turnId} /> : <p className="lab17-finding error">No result was sent for this call.</p>}
    </article>; })}</div></> : null}
    {run.answer ? <><h3 className="lab13-subhead">Answer <code>{run.results.some((item) => !item.success) ? 'after a failed call' : 'after the tool results'}</code></h3><div className="lab7-answer lab16-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{run.answer}</ReactMarkdown></div></> : null}
    <details className="lab16-preview"><summary>All events <small>{run.events.length} in arrival order</small></summary><ol className="lab16-events lab17-events">{run.events.map((name, index) => <li key={index}><code>{name.replace('agent.session.', '')}</code></li>)}</ol></details>
    {run.error ? <p className="lab2-error" role="alert">{run.error}</p> : null}
  </div>;
}

function SavedItems({ items }: { items: TraceItem[] }) {
  return <ol className="lab17-items">{items.map((item, index) => <li key={item.id ?? index} className={item.type}>
    <div><code className="lab17-item-type">{item.type}</code>{item.role ? <span className="lab17-role">{item.role}</span> : null}{item.name ? <code>{item.name}</code> : null}{item.callId ? <span className="lab15-ids">call_id <code>{item.callId}</code></span> : null}{item.status ? <span className="lab15-ids">{item.status}</span> : null}</div>
    {item.text ? <p>{item.text.length > 280 ? `${item.text.slice(0, 280)}…` : item.text}</p> : null}
    {item.type === 'function_call' ? <pre><code>{json(item.arguments)}</code></pre> : null}
    {item.type === 'function_call_output' ? <pre><code>{json(item.error ? { error: item.error } : { output: typeof item.output === 'string' ? parseOutput(item.output) : item.output })}</code></pre> : null}
  </li>)}</ol>;
}

// Runtime boundary for the server's suite results.
function parseSuite(body: unknown): Suite {
  const value = body as { results?: unknown; runtime?: unknown; durationMs?: unknown };
  if (!Array.isArray(value.results)) throw new Error('Invalid test results.');
  const results: Record<string, TestResult> = {};
  for (const raw of value.results as Array<Record<string, unknown>>) {
    const outcome = raw?.outcome as ToolOutcome | undefined;
    if (typeof raw?.id !== 'string' || typeof raw.pass !== 'boolean' || !outcome || !stages.some((item) => item.id === outcome.stage)) throw new Error('Invalid test result.');
    results[raw.id] = { id: raw.id, pass: raw.pass, outcome: { ...outcome, issues: Array.isArray(outcome.issues) ? outcome.issues : [] } };
  }
  return { source: 'server', runtime: typeof value.runtime === 'string' ? value.runtime : 'Node', durationMs: typeof value.durationMs === 'number' ? value.durationMs : 0, results };
}

export default function Lab18({ active, health }: { active: boolean; health: Health }) {
  const [suite, setSuite] = useState<Suite | null>(null);
  const [suiteBusy, setSuiteBusy] = useState<'browser' | 'server' | null>(null);
  const [testId, setTestId] = useState(toolTests[7].id);
  const [customName, setCustomName] = useState(strictCalendarTool.name);
  const [customArgs, setCustomArgs] = useState('{ "topic": "lab 18", "kind": "workshop", "from_date": "2026-13-01" }');
  const [customFault, setCustomFault] = useState<Fault>('none');
  const [custom, setCustom] = useState<ToolOutcome | null>(null);
  const [customBusy, setCustomBusy] = useState(false);
  const [prompt, setPrompt] = useState(prompts[1].text);
  const [fault, setFault] = useState<Fault>('none');
  const [declaration, setDeclaration] = useState<Declaration>('strict');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [live, setLive] = useState<Live | null>(null);
  const [runs, setRuns] = useState<ValidationRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<{ runId: string; list: TraceItem[]; hasMore: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const abort = useRef<AbortController | null>(null);
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const selected = runs.find((run) => run.id === selectedId) ?? runs.at(-1) ?? null;
  const test = toolTests.find((item) => item.id === testId) ?? toolTests[0];
  const testResult = suite?.results[test.id] ?? null;
  const passed = suite ? Object.values(suite.results).filter((item) => item.pass).length : 0;

  async function runInBrowser() {
    setSuiteBusy('browser'); setError('');
    const started = performance.now();
    try {
      const results = await runSuite();
      setSuite({ source: 'browser', runtime: 'this browser', durationMs: Math.round(performance.now() - started), results: Object.fromEntries(results.map((item) => [item.id, item])) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The suite crashed.'); }
    finally { setSuiteBusy(null); }
  }
  async function runOnServer() {
    setSuiteBusy('server'); setError('');
    try {
      const response = await fetch('/api/lab18/test', { method: 'POST' });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
      setSuite(parseSuite(body));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not run the suite on the server.'); }
    finally { setSuiteBusy(null); }
  }
  // A custom case: text that is not JSON is passed on as a raw string, as the API might.
  async function runCustom() {
    setCustomBusy(true);
    const args: unknown = (() => { try { return JSON.parse(customArgs); } catch { return customArgs; } })();
    try { setCustom((await runTest({ id: 'custom', name: customName.trim(), args, fault: customFault, attempt: 1, expect: 'ok' })).outcome); }
    finally { setCustomBusy(false); }
  }

  function onLine(line: Record<string, unknown>, capture: (summary: unknown) => void) {
    if (line.type === 'status' && typeof line.label === 'string') setStatus(line.label);
    if (line.type === 'event' && typeof line.name === 'string') { const name = line.name; setLive((previous) => previous && { ...previous, events: [...previous.events, name] }); }
    if (line.type === 'text' && typeof line.text === 'string') { const answer = line.text; setLive((previous) => previous && { ...previous, answer }); }
    if (line.type === 'call' && typeof line.call === 'object' && line.call) { const call = line.call as ToolCall; setLive((previous) => previous && { ...previous, calls: [...previous.calls.filter((item) => item.callId !== call.callId), call] }); }
    if (line.type === 'result' && typeof line.result === 'object' && line.result) { const result = line.result as CheckedResult; setLive((previous) => previous && { ...previous, results: [...previous.results, result] }); }
    if (line.type === 'moment' && typeof line.moment === 'object' && line.moment) { const moment = line.moment as Moment; setLive((previous) => previous && { ...previous, timeline: [...previous.timeline, moment] }); }
    if (line.type === 'summary') capture(line.summary);
  }

  async function runOnce() {
    const question = prompt.trim();
    if (!question || running) return;
    const id = newId();
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true); setError(''); setItems(null); setStatus(''); setLive({ events: [], calls: [], results: [], answer: '', timeline: [] });
    try {
      const response = await fetch('/api/lab18/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ prompt: question, fault, declaration }) });
      if (!response.ok) throw new Error((await response.json()).error || `Request failed (${response.status}).`);
      let record: ValidationRun | null = null;
      await readLines(response, (line) => onLine(line, (summary) => { record = parseValidationRun(summary, id, question); }));
      if (!record) throw new Error('The stream ended without a run summary.');
      const finished: ValidationRun = record;
      setRuns((previous) => [...previous, finished]);
      setSelectedId(id);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The run failed.');
    } finally {
      if (abort.current === controller) abort.current = null;
      setRunning(false); setLive(null);
    }
  }

  async function readItems(run: ValidationRun) {
    if (!run.sessionId) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/lab18/items?${new URLSearchParams({ sessionId: run.sessionId })}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      setItems({ runId: run.id, list: Array.isArray(body.items) ? body.items as TraceItem[] : [], hasMore: body.hasMore === true });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not read the saved items.'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!speechAvailable) return;
    const synthesis = window.speechSynthesis;
    const refresh = () => setVoices(synthesis.getVoices());
    refresh(); synthesis.addEventListener('voiceschanged', refresh);
    return () => synthesis.removeEventListener('voiceschanged', refresh);
  }, [speechAvailable]);
  useEffect(() => () => { abort.current?.abort(); if (speechAvailable) window.speechSynthesis.cancel(); }, [speechAvailable]);
  useEffect(() => { if (!active) stopSpeech(); }, [active]);

  function stopSpeech() { speechRun.current += 1; if (speechAvailable) window.speechSynthesis.cancel(); setSpeaking(null); }
  // Queue one or more explanations; the run counter ignores callbacks from cancelled narrations.
  function speak(queue: Lesson[], speechMode: 'one' | 'all') {
    if (!speechAvailable) return;
    stopSpeech();
    const run = speechRun.current;
    const narrator = selectNarratorVoice(voices.length ? voices : window.speechSynthesis.getVoices());
    queue.forEach((lesson, index) => {
      const utterance = new SpeechSynthesisUtterance(`${speechMode === 'all' ? `Snippet ${Number(lesson.number)}. ` : ''}${lesson.title}. ${lesson.explanation}`);
      if (narrator) utterance.voice = narrator;
      utterance.lang = narrator?.lang || 'en-US';
      utterance.pitch = narrator && masculineVoiceName.test(narrator.name) ? 1 : 0.78;
      utterance.rate = 0.95;
      utterance.onstart = () => { if (speechRun.current === run) setSpeaking({ mode: speechMode, lesson: lesson.number }); };
      utterance.onerror = () => { if (speechRun.current === run) setSpeaking(null); };
      if (index === queue.length - 1) utterance.onend = () => { if (speechRun.current === run) setSpeaking(null); };
      window.speechSynthesis.speak(utterance);
    });
    setSpeaking({ mode: speechMode, lesson: queue[0].number });
  }
  function readLesson(lesson: Lesson) { if (speaking?.lesson === lesson.number) stopSpeech(); else speak([lesson], 'one'); }
  function readAll() { if (speaking?.mode === 'all') stopSpeech(); else speak(lessons, 'all'); }

  return <div className="lab16-page lab17-page lab18-page">
    <div className="lab2-hero"><span className="lab2-badge lab18-badge">18/50</span><div><div className="eyebrow">LAB 18 / VALIDATE TOOL INPUTS</div><h1>Validate <em>tool inputs</em>.</h1><p>In Lab 17 the server answered every call. Now it defends the function: arguments are <code>unknown</code> until they pass parse, schema, and meaning checks; the service gets a deadline; and every exception is caught and turned into an honest <code>success: false</code> the agent can act on, without leaking internals.</p></div></div>

    <section className="lab7-card"><span className="eyebrow">THE PIPELINE</span><h2>Seven gates between the model and your function</h2><p>A call stops at the first gate it fails, and the gates after it never run. Whatever happens, the call still gets exactly one <code>tool_result</code>. Select a test below or a live call to see where it stopped.</p>
      <Pipeline outcome={testResult?.outcome ?? null} />
      <p className="lab8-note">Live timings: deadline <b>{liveTiming.timeoutMs} ms</b>, a normal lookup takes about {liveTiming.latencyMs} ms, and a slow one would take {liveTiming.slowMs / 1000} s. The test page uses a {testTiming.timeoutMs} ms deadline so the suite finishes quickly.</p>
    </section>

    <section className="lab7-card" id="lab18-tests"><span className="eyebrow">TOOL TEST PAGE · NO API KEY NEEDED</span><h2>{toolTests.length} cases: valid, invalid, and failing</h2><p>Every case runs through the same <code>runTool</code> the live agent loop uses, with real timers. Run the suite in this browser or on the Node server. Nothing is sent to OpenAI.</p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void runInBrowser()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'browser' ? 'Running…' : 'Run all in the browser'}</button><button type="button" className="lab8-secondary" onClick={() => void runOnServer()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'server' ? 'Running…' : 'Run all on the server'}</button></div>
      {suite ? <p className={'lab18-score ' + (passed === toolTests.length ? 'ok' : 'fail')}><b>{passed}/{toolTests.length} passed</b> · ran in {suite.runtime} · {suite.durationMs} ms (the timeout case sets the pace)</p> : <p className="lab8-note">Not run yet. Each row states the stage where the call must stop.</p>}
      <div className="lab18-tests">
        <div className="lab9-table-wrap lab18-table"><table>
          <thead><tr><th>Case</th><th>Arguments</th><th>Expect</th><th>Got</th><th /></tr></thead>
          {groups.map((group) => <tbody key={group.id}><tr className="lab18-group"><th colSpan={5}>{group.label}</th></tr>{toolTests.filter((item) => item.group === group.id).map((item) => { const result = suite?.results[item.id]; return <tr key={item.id} className={item.id === test.id ? 'selected' : ''} onClick={() => setTestId(item.id)}>
            <th><button type="button" className="lab15-link" onClick={() => setTestId(item.id)} aria-pressed={item.id === test.id}>{item.label}</button>{item.fault !== 'none' ? <small className="lab18-fault">{item.fault}{item.fault === 'flaky' ? ` · attempt ${item.attempt}` : ''}</small> : null}{item.name !== strictCalendarTool.name ? <small className="lab18-fault">{item.name}</small> : null}</th>
            <td><code className="lab18-args">{argsText(item.args)}</code></td>
            <td><span className="lab18-expect">{stageLabel(item.expect)}</span></td>
            <td>{result ? <span className="lab18-expect">{stageLabel(result.outcome.stage)}</span> : '—'}</td>
            <td>{result ? <span className={'lab18-pass ' + (result.pass ? 'ok' : 'fail')}>{result.pass ? 'PASS' : 'FAIL'}</span> : null}</td>
          </tr>; })}</tbody>)}
        </table></div>
        <div className="lab18-detail">
          <h3 className="lab13-subhead">{test.label} <code>expect {stageLabel(test.expect)}</code></h3>
          <p className="lab8-note">{test.note}</p>
          <h4 className="lab18-h4">arguments <small>{typeof test.args === 'string' ? 'a raw string' : 'as the agent sent them'}</small></h4>
          <pre className="lab18-raw"><code>{json(test.args)}</code></pre>
          {testResult ? <OutcomeView outcome={testResult.outcome} callId={`call_test_${test.id}`} turnId="turn_test_1" /> : <p className="lab8-note">Run the suite to see this case's outcome and the exact event the server would send.</p>}
        </div>
      </div>
      <details className="lab18-custom" open><summary>Write your own case</summary>
        <div className="lab16-editor">
          <div>
            <label htmlFor="lab18-name">name</label>
            <input id="lab18-name" value={customName} maxLength={80} onChange={(event) => setCustomName(event.target.value)} spellCheck={false} />
            <label htmlFor="lab18-args">arguments <small>JSON · any other text is sent as a raw string</small></label>
            <textarea id="lab18-args" className="lab16-code-input lab17-bench-input" value={customArgs} maxLength={2000} onChange={(event) => setCustomArgs(event.target.value)} spellCheck={false} />
            <fieldset className="lab15-modes lab16-after lab18-faults"><legend>The service</legend>{faults.map((item) => <label key={item.id} className={customFault === item.id ? 'selected' : ''}><input type="radio" name="lab18-custom-fault" checked={customFault === item.id} onChange={() => setCustomFault(item.id)} /><span><strong>{item.label}</strong></span></label>)}</fieldset>
            <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void runCustom()} disabled={customBusy}>{customBusy ? 'Running…' : 'Run this case'}</button></div>
          </div>
          <div>{custom ? <OutcomeView outcome={custom} callId="call_custom_1" turnId="turn_custom_1" /> : <p className="lab8-note">The starting example has two problems in different layers. The schema layer stops first, so the date is not checked yet. Fix the kind and run it again to reach the next gate.</p>}</div>
        </div>
      </details>
    </section>

    <section className="lab7-card"><span className="eyebrow">LIVE RUN</span><h2>Let the agent meet the validator</h2>
      <div className="lab16-prompts">{prompts.map((item) => <button type="button" key={item.label} className={prompt === item.text ? 'selected' : ''} onClick={() => setPrompt(item.text)} disabled={running}>{item.label}</button>)}</div>
      <label htmlFor="lab18-prompt">Your question</label>
      <textarea id="lab18-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} disabled={running} />
      <fieldset className="lab15-modes lab16-after lab18-faults"><legend>The calendar service</legend>{faults.map((item) => <label key={item.id} className={fault === item.id ? 'selected' : ''}><input type="radio" name="lab18-fault" checked={fault === item.id} onChange={() => setFault(item.id)} disabled={running} /><span><strong>{item.label}</strong><small>{item.hint}</small></span></label>)}</fieldset>
      <fieldset className="lab15-modes lab16-after"><legend>What the server declares to the model</legend>
        <label className={declaration === 'strict' ? 'selected' : ''}><input type="radio" name="lab18-declaration" checked={declaration === 'strict'} onChange={() => setDeclaration('strict')} disabled={running} /><span><strong>Strict schema</strong><small>Enum, length limits, pattern, no extra fields.</small></span></label>
        <label className={declaration === 'loose' ? 'selected' : ''}><input type="radio" name="lab18-declaration" checked={declaration === 'loose'} onChange={() => setDeclaration('loose')} disabled={running} /><span><strong>Loose schema</strong><small>No enum or limits. The server still validates strictly.</small></span></label>
      </fieldset>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void runOnce()} disabled={running || !health?.configured || !prompt.trim()}>{running ? 'Running…' : 'Ask the agent'}</button>{running ? <button type="button" className="lab8-secondary" onClick={() => abort.current?.abort()}>Stop reading</button> : null}</div>
      {!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env and restart the server for a live run. The tool test page above works without a key.</p> : null}
      <p className="lab8-note">The server answers every pause automatically, up to {maxRounds} rounds, then cancels the turn. Identical arguments that were already rejected get a sharper error.</p>
      {status ? <p className="lab7-session-id">{status}</p> : null}
      {live ? <div className="lab16-live"><Timeline moments={live.timeline} />{live.answer ? <div className="lab7-answer lab16-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{live.answer}</ReactMarkdown></div> : null}</div> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    <div className="lab16-grid">
      <section className="lab7-card"><span className="eyebrow">RESULT</span><h2>{selected ? `Run #${runs.indexOf(selected) + 1}` : 'No run yet'}</h2>
        {selected ? <>
          <p className="lab16-prompt-line">“{selected.prompt}”</p>
          <RunView run={selected} />
          {selected.sessionId ? <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => void readItems(selected)} disabled={busy || running}>{busy ? 'Reading…' : 'Read the saved items'}</button></div> : null}
          {items && items.runId === selected.id ? <div className="lab16-saved"><h3 className="lab13-subhead">Saved items <code>sessions.items.list</code></h3>{items.list.length ? <SavedItems items={items.list} /> : <p className="lab8-note">No items yet.</p>}{items.hasMore ? <p className="lab8-note">Showing the first 100 items.</p> : null}</div> : null}
        </> : <p className="lab8-note">Ask the <em>Impossible date</em> question. The call usually stops at the Meaning gate, sometimes after a Schema rejection first. Then see what the agent does with the error.</p>}
      </section>
      <section className="lab7-card"><span className="eyebrow">RUN HISTORY</span><h2>Compare runs</h2>
        {runs.length ? <div className="lab9-table-wrap lab15-history lab16-history"><table>
          <thead><tr><th>Run</th><th>Question</th><th>Service</th><th>Calls ok</th><th>Outcome</th></tr></thead>
          <tbody>{runs.map((run, index) => { const verdict = classifyValidationRun(run); return <tr key={run.id} className={run.id === selected?.id ? 'selected' : ''} onClick={() => { setSelectedId(run.id); setItems(null); }}>
            <th><button type="button" className="lab15-link" onClick={() => { setSelectedId(run.id); setItems(null); }} aria-pressed={run.id === selected?.id}>#{index + 1}</button></th>
            <td className="lab16-q">{run.prompt}</td><td><code>{run.fault}{run.declaration === 'loose' ? ' · loose' : ''}</code></td>
            <td>{run.results.filter((item) => item.success).length}/{run.results.length}</td><td><span className={'lab16-tone lab18-tone ' + verdict.tone}>{verdict.title}</span></td></tr>; })}</tbody>
        </table></div> : <p className="lab8-note">No runs yet. Ask the same question with <em>Works normally</em>, <em>Too slow</em>, and <em>Fails once</em>, and compare the answers.</p>}
      </section>
    </div>

    <section className="lab3-guide lab16-guide"><h2>Read the evidence</h2><div><article><strong>Parse &amp; schema</strong><p>Arguments are <code>unknown</code>. Check them against the schema you declared and report every issue with a path.</p></article><article><strong>Meaning</strong><p>Real dates, allowed ranges, clean text: rules only your code knows.</p></article><article><strong>Deadline</strong><p>Race the work against a timer, and abort the work when the timer wins.</p></article><article><strong>Exceptions</strong><p>Catch everything. Tell the agent whether to retry. Keep stack traces in the server log.</p></article></div><p className="lab3-guide-note">The declaration guides the model; validation protects the function. Every call still gets exactly one result, even when the answer is “no”.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 18</span><span className="code-lessons-title" role="heading" aria-level={2}>The code that validates tool inputs</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Turn unknown arguments into a typed value, report every issue for the agent, check what a schema cannot, put a deadline on the call, catch exceptions without leaking internals, and test the failing cases. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Run the whole suite on the server and show <em>{toolTests.length}/{toolTests.length} passed</em>. Add a case of your own that stops at the <em>Meaning</em> gate. Then ask the <em>Impossible date</em> question live and show the rejected call, its <code>tool_result</code> with <code>success: false</code>, and what the agent did next. Finally, ask <em>When is the Lab 18 session?</em> with <em>Too slow</em> and with <em>Throws a bug</em>, and explain why one error says “try once more”, the other says “do not retry”, and neither contains a stack trace.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/tools/functions" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
