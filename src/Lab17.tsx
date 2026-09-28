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
import { classifyActionRun, courseCalendarTool, executeCall, maxRounds, mergeRuns, pairCalls, parseActionRun, toolResultEvent, type ActionRun, type Delivery, type Moment, type ResultMode, type ToolResult, type TraceItem } from './lab17Action.ts';
import { actionScenarios } from './lab17Scenarios.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Live = { events: string[]; calls: ToolCall[]; results: ToolResult[]; answer: string; timeline: Moment[] };

const lessons: Lesson[] = [
  { number: '01', title: 'Detect the pause', file: 'server/lab17.ts', code: "if (event.type === 'agent.session.requires_action') {\n  const waiting = event.session.required_actions\n    .filter((action) => action.type === 'function_call')\n    .filter((action) => !answered.has(action.call_id));\n  if (!waiting.length) continue;\n  await answer(waiting); // run, then send the results\n  continue;              // keep reading the same stream\n}", explanation: 'Requires action is the signal that the agent is waiting for you. The session carries the list of required actions. Keep only the function calls, because this list can also hold other kinds of action, and skip any call you have already answered. Then run the functions and send their results. Do not stop reading the stream: the same turn continues once the results arrive.' },
  { number: '02', title: 'Run the function on the server', file: 'src/lab17Action.ts', code: "export function executeCall(call, tool, mode) {\n  if (call.name !== tool.name)\n    return fail(`Unknown function \"${call.name}\".`);\n  const parsed = parseArguments(call.arguments);\n  if (!parsed.value) return fail(`Invalid arguments: ${parsed.error}`);\n  const problems = checkArguments(parsed.value, tool.parameters)\n    .filter((finding) => finding.level === 'error');\n  if (problems.length) return fail(`Invalid arguments: …`);\n  const output = lookupCourseCalendar(parsed.value);\n  return { success: true, output: JSON.stringify(output), error: null };\n}", explanation: 'The agent only names a function and proposes arguments. Your server decides what actually runs. This function refuses any name the server does not implement, parses the arguments, which are typed unknown, and checks them against the declared schema before calling the real lookup. The output goes back as a string, so it is serialised as JSON. Lab 18 builds on this check with timeouts and exceptions.' },
  { number: '03', title: 'Send the result with the same call_id', file: 'server/lab17.ts', code: "await client.beta.agents.sessions.events.create(sessionId, {\n  events: results.map((result) => ({\n    type: 'agent.session.input.tool_result',\n    call_id: result.callId,  // from the function_call\n    turn_id: result.turnId,  // the waiting turn\n    success: true,\n    output: result.output,   // a string, here JSON\n  })),\n});", explanation: 'A tool result is an input event, sent with the same events create method you used to cancel a turn in Lab 16. It must carry the call ID and the turn ID from the request, so the agent can match the answer to its question. When the agent asks for several calls at once, send every result. One request can carry them all. The API replies with 202, which means accepted; the effect appears in the stream.' },
  { number: '04', title: 'A failure is still a result', file: 'src/lab17Action.ts', code: "export function toolResultEvent(result) {\n  const base = {\n    type: 'agent.session.input.tool_result',\n    call_id: result.callId,\n    turn_id: result.turnId,\n    success: result.success,\n  };\n  return result.success\n    ? { ...base, output: result.output }\n    : { ...base, error: result.error };\n}", explanation: 'When the function cannot do its job, still answer the call. Set success to false and put a short, honest error message in the error field instead of an output. The agent reads it and can explain the problem, or try again with better arguments. Never leave a call unanswered and never fake an output, because the turn waits forever in the first case and the agent repeats your invention in the second.' },
  { number: '05', title: 'Follow the turn to its end', file: 'server/lab17.ts', code: "for await (const event of stream) {\n  // …requires_action handled above…\n  if (event.type === 'agent.session.turn.completed'\n      && event.turn.id === turnId) break;\n}\n\n// A turn can pause more than once:\nif (rounds >= maxRounds) {\n  await client.beta.agents.sessions.events.create(sessionId, {\n    events: [{ type: 'agent.session.input.cancel' }],\n  });\n}", explanation: 'After the results are sent, the same turn resumes on the same stream. The agent reads the outputs and either answers or asks for more calls, which pauses the turn again. So the loop simply keeps reading until the turn completes, fails, or is cancelled. A safety cap on the number of rounds stops a runaway loop: after four pauses, this server cancels the turn instead of answering again.' },
  { number: '06', title: 'Step through and read the trace', file: 'server/lab17.ts', code: "// Resume later, from the saved session, not from the browser:\nstream = await client.beta.agents.sessions.events.stream(sessionId);\nconst session = await client.beta.agents.sessions.retrieve(sessionId);\nconst waiting = session.required_actions\n  .filter((action) => action.type === 'function_call');\nawait answer(waiting);\n\n// The whole exchange is saved as items:\nclient.beta.agents.sessions.items.list(sessionId, { order: 'asc' });\n// message → function_call → function_call_output → message", explanation: 'In step-through mode the server stops at requires action and you press the button to continue. The resume request trusts only the saved session. It opens the stream first, then reads the waiting calls from required actions, so the browser can never inject a call or a result of its own. Afterwards, list the session items: the user message, the function call, the function call output, and the assistant message form the complete trace.' },
];

const prompts = [
  { label: 'One lookup', text: 'When is the Lab 17 session?' },
  { label: 'Two lookups', text: 'When is the live Q&A about function tools, and when is the Stage 4 project due?' },
  { label: 'Likely retry', text: 'When is the Lab 18 workshop?' },
  { label: 'No tool needed', text: 'What is a JavaScript closure? Answer in two sentences.' },
];

const benchPresets: Array<{ id: string; label: string; name: string; args: string }> = [
  { id: 'valid', label: 'Valid', name: courseCalendarTool.name, args: '{ "topic": "lab 17", "kind": "lab" }' },
  { id: 'enum', label: 'Wrong enum', name: courseCalendarTool.name, args: '{ "topic": "lab 18", "kind": "workshop" }' },
  { id: 'missing', label: 'Missing topic', name: courseCalendarTool.name, args: '{ "kind": "deadline" }' },
  { id: 'extra', label: 'Extra field', name: courseCalendarTool.name, args: '{ "topic": "streaming", "kind": "any", "limit": 3 }' },
  { id: 'string', label: 'JSON string', name: courseCalendarTool.name, args: '"{\\"topic\\":\\"stage 4\\",\\"kind\\":\\"deadline\\"}"' },
  { id: 'unknown', label: 'Unknown function', name: 'delete_calendar_entry', args: '{ "topic": "lab 17" }' },
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
const eventClass = (name: string) => (name.includes('requires_action') ? 'action' : name.includes('item.') ? 'item' : name.includes('output_text') ? 'text' : '');

// Read an NDJSON response line by line.
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

// The loop as five stages. Each lights up once the run reaches it.
function Flow({ run }: { run: Pick<ActionRun, 'calls' | 'results' | 'events' | 'turnStatus' | 'answer'> | null }) {
  const stages = [
    { label: 'Prompt', detail: 'input', reached: Boolean(run) },
    { label: 'function_call', detail: 'the request', reached: Boolean(run?.calls.length) },
    { label: 'requires_action', detail: 'the pause', reached: Boolean(run?.events.includes('agent.session.requires_action')) },
    { label: 'tool_result', detail: 'your answer', reached: Boolean(run?.results.length) },
    { label: 'Answer', detail: 'turn completed', reached: run?.turnStatus === 'completed' && Boolean(run.answer) },
  ];
  return <ol className="lab17-flow" aria-label="The required-action loop">{stages.map((stage, index) => <li key={stage.label} className={stage.reached ? 'reached' : ''}><span>{index + 1}</span><strong>{stage.label}</strong><small>{stage.detail}</small></li>)}</ol>;
}

function Timeline({ moments }: { moments: Moment[] }) {
  if (!moments.length) return null;
  const first = moments[0].at;
  return <ol className="lab17-timeline">{moments.map((moment, index) => <li key={index} className={moment.kind}><span className="lab17-at">+{((moment.at - first) / 1000).toFixed(2)}s</span><span className="lab17-kind">{moment.kind}</span><span className="lab17-label">{moment.label}</span></li>)}</ol>;
}

function Pairs({ run }: { run: ActionRun }) {
  return <div className="lab17-pairs">{pairCalls(run).map(({ call, result, finding }, index) => <article key={call.callId} className="lab17-pair">
    <div className="lab16-call-head"><span className="lab16-call-n">{index + 1}</span><code className="lab16-fn">{call.name}(…)</code><span className="lab15-ids">call_id <code>{call.callId}</code>{call.turnId ? <> · turn <code>{shortId(call.turnId)}</code></> : null}{result ? <> · round <b>{result.round}</b></> : null}</span></div>
    <div className="lab16-args">
      <div><h4>function_call <small>arguments from the agent</small></h4><pre><code>{json(call.arguments)}</code></pre></div>
      <div><h4>tool_result <small>{result ? `sent · ran in ${result.durationMs} ms` : 'not sent'}</small></h4>{result ? <pre><code>{json(toolResultEvent(result))}</code></pre> : <p className="lab16-warn-line">Nothing was sent for this call.</p>}</div>
    </div>
    <p className={'lab17-finding ' + finding.level}>{finding.text}</p>
    {result?.success ? <details className="lab16-preview"><summary>The output, parsed <small>the agent receives it as a string</small></summary><pre><code>{json(parseOutput(result.output))}</code></pre></details> : null}
  </article>)}</div>;
}

function RunView({ run }: { run: ActionRun }) {
  const verdict = classifyActionRun(run);
  return <div className="lab16-run">
    <div className={'lab16-verdict lab17-verdict ' + verdict.tone}><strong>{verdict.title}</strong><p>{verdict.text}</p></div>
    <div className="lab15-summary-head"><span className="lab15-ids">mode <code>{run.mode === 'fail' ? 'report a failure' : 'run the function'}</code> · delivery <code>{run.delivery === 'step' ? 'step through' : 'automatic'}</code> · turn <span className={'lab14-status ' + run.turnStatus}>{run.turnStatus}</span> · rounds <b>{run.rounds}</b>{run.sessionId ? <> · session <code>{shortId(run.sessionId)}</code></> : null}</span></div>
    <Flow run={run} />
    <h3 className="lab13-subhead">Trace <code>request → call → result → answer</code></h3>
    <Timeline moments={run.timeline} />
    {run.calls.length ? <><h3 className="lab13-subhead">Calls and results <code>matched by call_id</code></h3><Pairs run={run} /></> : null}
    {run.answer ? <><h3 className="lab13-subhead">Answer <code>{run.results.length ? 'after the tool results' : 'no tool call'}</code></h3><div className="lab7-answer lab16-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{run.answer}</ReactMarkdown></div></> : null}
    <details className="lab16-preview"><summary>All events <small>{run.events.length} in arrival order</small></summary><ol className="lab16-events lab17-events">{run.events.map((name, index) => <li key={index} className={eventClass(name)}><code>{name.replace('agent.session.', '')}</code></li>)}</ol></details>
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

export default function Lab17({ active, health }: { active: boolean; health: Health }) {
  const [prompt, setPrompt] = useState(prompts[0].text);
  const [mode, setMode] = useState<ResultMode>('execute');
  const [delivery, setDelivery] = useState<Delivery>('auto');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [live, setLive] = useState<Live | null>(null);
  const [runs, setRuns] = useState<ActionRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<{ runId: string; list: TraceItem[]; hasMore: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [benchName, setBenchName] = useState(benchPresets[0].name);
  const [benchArgs, setBenchArgs] = useState(benchPresets[0].args);
  const [benchMode, setBenchMode] = useState<ResultMode>('execute');
  const [scenarioId, setScenarioId] = useState(actionScenarios[0].id);
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const abort = useRef<AbortController | null>(null);
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const selected = runs.find((run) => run.id === selectedId) ?? runs.at(-1) ?? null;
  const scenario = actionScenarios.find((item) => item.id === scenarioId) ?? actionScenarios[0];

  // The function bench runs the same executeCall the server uses. Text that is not JSON is passed on as a raw string.
  const benchValue: unknown = (() => { try { return JSON.parse(benchArgs); } catch { return benchArgs; } })();
  const benchCall: ToolCall = { callId: 'call_bench_1', name: benchName.trim(), turnId: 'turn_bench_1', itemId: null, status: 'completed', arguments: benchValue };
  const benchOutcome = executeCall(benchCall, courseCalendarTool, benchMode);
  const benchEvent = toolResultEvent({ callId: benchCall.callId, turnId: 'turn_bench_1', ...benchOutcome });

  // Stream lines shared by /run and /resolve.
  function onLine(line: Record<string, unknown>, capture: (summary: unknown) => void) {
    if (line.type === 'status' && typeof line.label === 'string') setStatus(line.label);
    if (line.type === 'event' && typeof line.name === 'string') { const name = line.name; setLive((previous) => previous && { ...previous, events: [...previous.events, name] }); }
    if (line.type === 'text' && typeof line.text === 'string') { const answer = line.text; setLive((previous) => previous && { ...previous, answer }); }
    if (line.type === 'call' && typeof line.call === 'object' && line.call) { const call = line.call as ToolCall; setLive((previous) => previous && { ...previous, calls: [...previous.calls.filter((item) => item.callId !== call.callId), call] }); }
    if (line.type === 'result' && typeof line.result === 'object' && line.result) { const result = line.result as ToolResult; setLive((previous) => previous && { ...previous, results: [...previous.results, result] }); }
    if (line.type === 'moment' && typeof line.moment === 'object' && line.moment) { const moment = line.moment as Moment; setLive((previous) => previous && { ...previous, timeline: [...previous.timeline, moment] }); }
    if (line.type === 'pending') setStatus('The turn is waiting. Nothing is sent until you press the button.');
    if (line.type === 'summary') capture(line.summary);
  }

  async function stream(url: string, body: unknown, id: string, question: string, seed: Live): Promise<ActionRun | null> {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true); setError(''); setItems(null); setStatus(''); setLive(seed);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify(body) });
      if (!response.ok) throw new Error((await response.json()).error || `Request failed (${response.status}).`);
      let record: ActionRun | null = null;
      await readLines(response, (line) => onLine(line, (summary) => { record = parseActionRun(summary, id, question); }));
      if (!record) throw new Error('The stream ended without a run summary.');
      return record;
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The run failed.');
      return null;
    } finally {
      if (abort.current === controller) abort.current = null;
      setRunning(false); setLive(null);
    }
  }

  async function runOnce() {
    const question = prompt.trim();
    if (!question || running) return;
    const id = newId();
    const record = await stream('/api/lab17/run', { prompt: question, mode, delivery }, id, question, { events: [], calls: [], results: [], answer: '', timeline: [] });
    if (!record) return;
    const finished: ActionRun = record;
    setRuns((previous) => [...previous, finished]);
    setSelectedId(id);
  }

  // Step-through: ask the server to run the waiting calls. It reads them from the saved session, not from this page.
  async function resolve(run: ActionRun) {
    if (!run.sessionId || running) return;
    const next = await stream('/api/lab17/resolve', { sessionId: run.sessionId, mode }, run.id, run.prompt, { events: [...run.events], calls: [...run.calls], results: [...run.results], answer: run.answer, timeline: [...run.timeline] });
    if (!next) return;
    const continuation: ActionRun = next;
    setRuns((previous) => previous.map((item) => (item.id === run.id ? mergeRuns(item, continuation) : item)));
  }

  async function cancelWaiting(run: ActionRun) {
    if (!run.sessionId) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/lab17/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: run.sessionId }) });
      if (!response.ok) throw new Error((await response.json()).error || `Request failed (${response.status}).`);
      setRuns((previous) => previous.map((item) => (item.id === run.id ? { ...item, pending: [], turnStatus: 'cancelled', error: 'You cancelled the waiting turn. No result was sent.' } : item)));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not cancel the turn.'); }
    finally { setBusy(false); }
  }

  async function readItems(run: ActionRun) {
    if (!run.sessionId) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/lab17/items?${new URLSearchParams({ sessionId: run.sessionId })}`);
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

  const liveRun = live ? { ...live, turnStatus: 'unknown' as const } : null;

  return <div className="lab16-page lab17-page">
    <div className="lab2-hero"><span className="lab2-badge lab17-badge">17/50</span><div><div className="eyebrow">LAB 17 / COMPLETE A REQUIRED ACTION</div><h1>Complete a <em>required action</em>.</h1><p>In Lab 16 the agent asked for the course calendar and the turn waited. Now the server answers: it detects <code>requires_action</code>, runs the function, sends a <code>tool_result</code> with the same <code>call_id</code>, and follows the turn to the agent’s final answer.</p></div></div>

    <section className="lab7-card"><span className="eyebrow">THE LOOP</span><h2>Five stages in one turn</h2><p>The agent never runs your code. It asks, the session pauses, your server runs the function and answers, and the same turn continues. The stages light up as a run reaches them.</p>
      <Flow run={liveRun ?? selected} />
      <p className="lab8-note">The tool is <code>{courseCalendarTool.name}</code> from Lab 16, declared by the server. The server runs only the functions it implements, and only with arguments that match the schema.</p>
    </section>

    <section className="lab7-card"><span className="eyebrow">LIVE RUN</span><h2>Ask, answer the call, get the answer</h2>
      <div className="lab16-prompts">{prompts.map((item) => <button type="button" key={item.label} className={prompt === item.text ? 'selected' : ''} onClick={() => setPrompt(item.text)} disabled={running}>{item.label}</button>)}</div>
      <label htmlFor="lab17-prompt">Your question</label>
      <textarea id="lab17-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} disabled={running} />
      <fieldset className="lab15-modes lab16-after"><legend>What the function returns</legend>
        <label className={mode === 'execute' ? 'selected' : ''}><input type="radio" name="lab17-mode" checked={mode === 'execute'} onChange={() => setMode('execute')} disabled={running} /><span><strong>Run the function</strong><small>Look up the calendar and send <code>success: true</code> with the output.</small></span></label>
        <label className={mode === 'fail' ? 'selected' : ''}><input type="radio" name="lab17-mode" checked={mode === 'fail'} onChange={() => setMode('fail')} disabled={running} /><span><strong>Report a failure</strong><small>Simulate an outage and send <code>success: false</code> with an error.</small></span></label>
      </fieldset>
      <fieldset className="lab15-modes lab16-after"><legend>When the turn pauses</legend>
        <label className={delivery === 'auto' ? 'selected' : ''}><input type="radio" name="lab17-delivery" checked={delivery === 'auto'} onChange={() => setDelivery('auto')} disabled={running} /><span><strong>Answer automatically</strong><small>The server answers on the same stream and reads on to the end. Up to {maxRounds} rounds.</small></span></label>
        <label className={delivery === 'step' ? 'selected' : ''}><input type="radio" name="lab17-delivery" checked={delivery === 'step'} onChange={() => setDelivery('step')} disabled={running} /><span><strong>Step through</strong><small>Stop at <code>requires_action</code>. You press the button to send each round of results.</small></span></label>
      </fieldset>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void runOnce()} disabled={running || !health?.configured || !prompt.trim()}>{running ? 'Running…' : 'Ask the agent'}</button>{running ? <button type="button" className="lab8-secondary" onClick={() => abort.current?.abort()}>Stop reading</button> : null}</div>
      {!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env and restart the server for a live run. The function bench and the playground below work without a key.</p> : null}
      {status ? <p className="lab7-session-id">{status}</p> : null}
      {live ? <div className="lab16-live"><Timeline moments={live.timeline} />{live.answer ? <div className="lab7-answer lab16-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{live.answer}</ReactMarkdown></div> : null}</div> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    {selected && selected.pending.length && selected.turnStatus === 'waiting' ? <section className="lab7-card lab17-pending"><span className="eyebrow">WAITING FOR YOUR SERVER</span><h2>{selected.pending.length === 1 ? 'One call is waiting' : `${selected.pending.length} calls are waiting`}</h2><p>The session is in <code>requires_action</code>. Below is what the server would send with the current mode. When you press the button, it reads the calls again from the saved session and runs them itself.</p>
      <div className="lab17-pairs">{selected.pending.map((call, index) => { const outcome = executeCall(call, courseCalendarTool, mode); return <article key={call.callId} className="lab17-pair">
        <div className="lab16-call-head"><span className="lab16-call-n">{index + 1}</span><code className="lab16-fn">{call.name}(…)</code><span className="lab15-ids">call_id <code>{call.callId}</code></span></div>
        <div className="lab16-args"><div><h4>arguments</h4><pre><code>{json(call.arguments)}</code></pre></div><div><h4>tool_result <small>preview</small></h4><pre><code>{json(toolResultEvent({ callId: call.callId, turnId: call.turnId ?? '', ...outcome }))}</code></pre></div></div>
      </article>; })}</div>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void resolve(selected)} disabled={running || busy}>{running ? 'Sending…' : `Run the function and send ${selected.pending.length === 1 ? 'the result' : `${selected.pending.length} results`}`}</button><button type="button" className="lab8-secondary" onClick={() => void cancelWaiting(selected)} disabled={running || busy}>Cancel the turn instead</button></div>
    </section> : null}

    <div className="lab16-grid">
      <section className="lab7-card"><span className="eyebrow">RESULT</span><h2>{selected ? `Run #${runs.indexOf(selected) + 1}` : 'No run yet'}</h2>
        {selected ? <>
          <p className="lab16-prompt-line">“{selected.prompt}”</p>
          <RunView run={selected} />
          {selected.sessionId ? <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => void readItems(selected)} disabled={busy || running}>{busy ? 'Reading…' : 'Read the saved items'}</button></div> : null}
          {items && items.runId === selected.id ? <div className="lab16-saved"><h3 className="lab13-subhead">Saved items <code>sessions.items.list</code></h3>{items.list.length ? <SavedItems items={items.list} /> : <p className="lab8-note">No items yet.</p>}{items.hasMore ? <p className="lab8-note">Showing the first 100 items.</p> : null}</div> : null}
        </> : <p className="lab8-note">Ask a question to see the full trace: the call, the result your server sent, and the answer.</p>}
      </section>
      <section className="lab7-card"><span className="eyebrow">RUN HISTORY</span><h2>Compare runs</h2>
        {runs.length ? <div className="lab9-table-wrap lab15-history lab16-history"><table>
          <thead><tr><th>Run</th><th>Question</th><th>Mode</th><th>Calls</th><th>Outcome</th></tr></thead>
          <tbody>{runs.map((run, index) => { const verdict = classifyActionRun(run); return <tr key={run.id} className={run.id === selected?.id ? 'selected' : ''} onClick={() => { setSelectedId(run.id); setItems(null); }}>
            <th><button type="button" className="lab15-link" onClick={() => { setSelectedId(run.id); setItems(null); }} aria-pressed={run.id === selected?.id}>#{index + 1}</button></th>
            <td className="lab16-q">{run.prompt}</td><td><code>{run.mode === 'fail' ? 'failure' : 'run'}{run.delivery === 'step' ? ' · step' : ''}</code></td>
            <td>{run.results.length}/{run.calls.length}</td><td><span className={'lab16-tone lab17-tone ' + verdict.tone}>{verdict.title}</span></td></tr>; })}</tbody>
        </table></div> : <p className="lab8-note">No runs yet. Ask the same question with Run the function and with Report a failure, and compare the answers.</p>}
      </section>
    </div>

    <section className="lab7-card"><span className="eyebrow">FUNCTION BENCH · NO API KEY NEEDED</span><h2>What would the server send back?</h2><p>Edit a call the way the agent might send it. The bench runs the same <code>executeCall</code> and <code>toolResultEvent</code> the server uses, and shows the exact input event.</p>
      <div className="lab16-prompts">{benchPresets.map((preset) => <button type="button" key={preset.id} className={benchName === preset.name && benchArgs === preset.args ? 'selected' : ''} onClick={() => { setBenchName(preset.name); setBenchArgs(preset.args); }}>{preset.label}</button>)}</div>
      <div className="lab16-editor">
        <div>
          <label htmlFor="lab17-bench-name">name <small>from the function_call</small></label>
          <input id="lab17-bench-name" value={benchName} maxLength={80} onChange={(event) => setBenchName(event.target.value)} spellCheck={false} />
          <label htmlFor="lab17-bench-args">arguments <small>JSON · any other text is sent as a raw string</small></label>
          <textarea id="lab17-bench-args" className="lab16-code-input lab17-bench-input" value={benchArgs} maxLength={2000} onChange={(event) => setBenchArgs(event.target.value)} spellCheck={false} />
          <fieldset className="lab15-modes lab16-after"><legend>Mode</legend>
            <label className={benchMode === 'execute' ? 'selected' : ''}><input type="radio" name="lab17-bench-mode" checked={benchMode === 'execute'} onChange={() => setBenchMode('execute')} /><span><strong>Run the function</strong></span></label>
            <label className={benchMode === 'fail' ? 'selected' : ''}><input type="radio" name="lab17-bench-mode" checked={benchMode === 'fail'} onChange={() => setBenchMode('fail')} /><span><strong>Report a failure</strong></span></label>
          </fieldset>
        </div>
        <div>
          <h3 className="lab13-subhead">The input event <code>{benchOutcome.success ? 'success: true' : 'success: false'}</code></h3>
          <pre className="lab16-json"><code>{json(benchEvent)}</code></pre>
          {benchOutcome.success ? <><h3 className="lab13-subhead">output, parsed <code>sent as a string</code></h3><pre className="lab16-json"><code>{json(parseOutput(benchOutcome.output))}</code></pre></> : <p className="lab17-finding warn">The server refuses to run this call. It still answers it, so the turn does not wait forever.</p>}
        </div>
      </div>
    </section>

    <section className="lab7-card" id="lab17-playground"><span className="eyebrow">LOOP PLAYGROUND · NO API KEY NEEDED</span><h2>Six turns, read the same way</h2><p>Each case is a scripted run in the same shape as the live result, read by the same functions. The results are computed by the server’s <code>executeCall</code>.</p>
      <p className="lab15-label">Event types, item fields, and the tool_result event come from the SDK’s types. What the model chose to do and say in each case is illustrative: these are fixtures, not recordings.</p>
      <div className="lab16-scenarios" role="tablist" aria-label="Playground cases">{actionScenarios.map((item, index) => <button type="button" role="tab" key={item.id} aria-selected={item.id === scenario.id} className={item.id === scenario.id ? 'selected' : ''} onClick={() => setScenarioId(item.id)}><span>{index + 1}</span>{item.title}</button>)}</div>
      <p className="lab16-prompt-line">“{scenario.run.prompt}”</p>
      <p className="lab8-note">{scenario.summary}</p>
      <p className="lab15-lesson"><strong>Lesson:</strong> {scenario.lesson}</p>
      <RunView run={scenario.run} />
    </section>

    <section className="lab3-guide lab16-guide"><h2>Read the evidence</h2><div><article><strong>Pause</strong><p><code>requires_action</code> lists the calls in <code>required_actions</code>.</p></article><article><strong>Run</strong><p>The server checks the name and arguments, then runs its own function.</p></article><article><strong>Answer</strong><p>A <code>tool_result</code> per <code>call_id</code>, with <code>success</code> and an output or an error.</p></article><article><strong>Continue</strong><p>The same turn resumes. Read on until it completes, and cap the rounds.</p></article></div><p className="lab3-guide-note">Every call the agent makes must get exactly one result. A missing result leaves the turn waiting; a faked result becomes the agent’s answer.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 17</span><span className="code-lessons-title" role="heading" aria-level={2}>The code that completes a required action</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Detect the pause, run the function on the server, send the result with the same call ID, report failures honestly, follow the turn to its end, and read the saved trace. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Ask <em>When is the Lab 17 session?</em> with <em>Run the function</em> and show the full trace: prompt, <code>function_call</code>, <code>tool_result</code>, and answer, with the same <code>call_id</code> on both sides. Ask it again with <em>Report a failure</em> and compare the answers. Then run <em>Two lookups</em> in <em>Step through</em> mode, show the waiting calls, send the results, and open <em>Read the saved items</em> to show the <code>function_call_output</code> items the session kept.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/tools/functions" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
