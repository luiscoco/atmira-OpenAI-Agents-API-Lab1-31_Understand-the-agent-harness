import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import { AnswerPre } from './Lab6.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { shortId } from './lab13Recovery.ts';
import { checkArguments, classifyRun, lintTool, lookupCourseCalendar, parseArguments, parseToolRun, toolPresets, type Finding, type ToolCall, type ToolDraft, type ToolPreset, type ToolRun } from './lab16Tool.ts';
import { toolScenarios } from './lab16Scenarios.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type After = 'cancel' | 'leave';
type SavedSession = { status: string; requiredActions: ToolCall[]; tools: Array<{ name: string }> };

const lessons: Lesson[] = [
  { number: '01', title: 'Declare the tool', file: 'src/lab16Tool.ts', code: "export const courseCalendarTool = {\n  type: 'function',\n  name: 'lookup_course_calendar',\n  description: 'Look up dates in the course calendar… Use it whenever\\n    the user asks when something happens. Do not use it for\\n    general programming questions.',\n  parameters: {\n    type: 'object',\n    properties: {\n      topic: { type: 'string', description: 'A lab number or topic.' },\n      kind: { type: 'string', enum: ['lab', 'live_session', 'deadline', 'any'] },\n      from_date: { type: 'string', pattern: '^\\\\d{4}-\\\\d{2}-\\\\d{2}$' },\n    },\n    required: ['topic', 'kind'],\n    additionalProperties: false,\n  },\n};", explanation: 'A function tool is a declaration, not code. It has three parts the model can read. The name says what the function does. The description says when to use it, and when not to. The parameters are a JSON Schema object that lists each argument, its type, and which ones are required. The function itself stays on your server; the model only ever sees this description of it.' },
  { number: '02', title: 'Attach it to the agent', file: 'server/lab16.ts', code: "stream = await client.beta.agents.sessions.create({\n  agent: {\n    model,\n    instructions, // never names the tool\n    tools: [courseCalendarTool],\n  },\n  environment: { type: 'none' },\n  input: prompt,\n  stream: true,\n});", explanation: 'Tools belong to the agent configuration, next to the model and instructions. Here they are set when the session is created, so each run in this lab starts a new session with the declaration from the editor. The server lints the declaration again before sending it, because the browser is not trusted. The instructions deliberately never mention the tool by name, so the description has to do the work.' },
  { number: '03', title: 'The description decides when', file: 'src/lab16Tool.ts', code: "if (!description) error('The model reads it to decide when to call the tool.');\nelse if (description.length < 60) warn('Say what it returns, when to use it, and when not to.');\nelse if (!/\\bwhen\\b/i.test(description)) warn('Never says when to use the tool.');\nif (parameters.additionalProperties !== false)\n  warn('The model may invent extra arguments.');", explanation: 'The model chooses whether to call a tool from its name and description alone. A vague description such as looks things up gives it nothing to match against the question, so the call may never happen. The linter blocks real errors, like an invalid name or broken schema, but only warns about weak wording, so you can run a weak tool and watch the difference.' },
  { number: '04', title: 'Spot the request in the stream', file: 'server/lab16.ts', code: "if (event.type === 'agent.session.turn.item.done'\n    && event.item.type === 'function_call') {\n  const { name, call_id, arguments: args } = event.item;\n}\nif (event.type === 'agent.session.requires_action') {\n  // session.status === 'requires_action'\n  actions = event.session.required_actions\n    .filter((action) => action.type === 'function_call');\n}", explanation: 'The agent never runs your function. It asks for it in two ways. First, a function call item appears in the turn, with the function name, a call ID, and the arguments. Then the session emits requires action, and the session’s required actions list the same call. The turn’s status becomes waiting. Nothing more happens until your server answers, which is Lab 17.' },
  { number: '05', title: 'Arguments are unknown until parsed', file: 'src/lab16Tool.ts', code: "export function parseArguments(raw: unknown): ParsedArguments {\n  if (isObject(raw)) return { form: 'object', value: raw };\n  if (typeof raw === 'string') {\n    const parsed = JSON.parse(raw); // may throw\n    if (isObject(parsed)) return { form: 'json string', value: parsed };\n  }\n  return { form: 'invalid', value: null };\n}\ncheckArguments(parsed.value, tool.parameters);", explanation: 'The SDK types arguments as unknown, so the page parses them at the boundary. It accepts an object or a JSON string, and treats anything else as invalid. Then it compares the arguments with the declared schema: required fields, types, enums, patterns, and extra fields. In this lab that comparison is only a preview. Lab 18 turns it into validation that rejects a bad call.' },
  { number: '06', title: 'The request is saved on the session', file: 'server/lab16.ts', code: "const session = await client.beta.agents.sessions.retrieve(sessionId);\nsession.status;           // 'requires_action'\nsession.required_actions; // [{ type: 'function_call', call_id, name, arguments, turn_id }]\n\n// Lab 16 sends no result, so it cleans up:\nawait client.beta.agents.sessions.events.create(sessionId, {\n  events: [{ type: 'agent.session.input.cancel' }],\n});", explanation: 'A waiting request is not only a stream event. It is saved on the session, so a page that reloads can read it back. By default this lab cancels the waiting turn once it has captured the request, because it never sends a result. Choose leave it waiting to read the saved session yourself. In Lab 17 the server runs the function and answers with a tool result event that carries the same call ID.' },
];

const prompts = [
  { label: 'Needs the calendar', text: 'When is the Lab 17 session?' },
  { label: 'Needs two lookups', text: 'When is the live Q&A about function tools, and when is the Stage 4 project due?' },
  { label: 'General question', text: 'What is a JavaScript closure? Answer in two sentences.' },
  { label: 'Mixed', text: 'Is there a streaming Q&A this month, and what should I review before it?' },
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

function Findings({ findings }: { findings: Finding[] }) {
  return <ul className="lab15-checks lab16-findings">{findings.map((finding, index) => <li key={index} className={finding.level === 'ok' ? 'ok' : finding.level === 'error' ? 'bad' : 'warn'}>{finding.text}</li>)}</ul>;
}

// One requested call: raw arguments as received, parsed, checked against the declaration, and what Lab 17 would return.
function CallCard({ call, run, index }: { call: ToolCall; run: ToolRun; index: number }) {
  const parsed = parseArguments(call.arguments);
  const declared = run.tool && run.tool.name === call.name ? run.tool : null;
  return <article className="lab16-call">
    <div className="lab16-call-head"><span className="lab16-call-n">{index + 1}</span><code className="lab16-fn">{call.name}(…)</code><span className="lab15-ids">call_id <code>{call.callId}</code>{call.turnId ? <> · turn <code>{shortId(call.turnId)}</code></> : null}</span></div>
    {!declared ? <p className="lab16-warn-line">The agent asked for a function this session did not declare.</p> : null}
    <div className="lab16-args">
      <div><h4>arguments, as received <small>{parsed.form === 'json string' ? 'a JSON string' : parsed.form === 'object' ? 'an object' : 'invalid'}</small></h4><pre><code>{json(call.arguments)}</code></pre></div>
      <div><h4>Compared with the schema <small>preview · Lab 18 validates</small></h4>{parsed.value ? <Findings findings={checkArguments(parsed.value, declared?.parameters ?? null)} /> : <Findings findings={[{ level: 'error', text: parsed.error ?? 'Could not parse the arguments.' }]} />}</div>
    </div>
    {parsed.value ? <details className="lab16-preview"><summary>What the function would return <small>computed in the browser · not sent in Lab 16</small></summary><pre><code>{json(lookupCourseCalendar(parsed.value))}</code></pre></details> : null}
  </article>;
}

function RunView({ run }: { run: ToolRun }) {
  const verdict = classifyRun(run);
  const calls = run.requiredActions.length ? run.requiredActions : run.calls;
  return <div className="lab16-run">
    <div className={'lab16-verdict ' + verdict.tone}><strong>{verdict.title}</strong><p>{verdict.text}</p></div>
    <div className="lab15-summary-head"><span className="lab15-ids">tool <code>{run.tool?.name ?? 'none'}</code> · turn <span className={'lab14-status ' + run.turnStatus}>{run.turnStatus}</span>{run.sessionStatus ? <> · session <code>{run.sessionStatus}</code></> : null}{run.cancelSent ? <> · <code>agent.session.input.cancel</code> sent</> : null}</span></div>
    <h3 className="lab13-subhead">Events <code>in arrival order</code></h3>
    <ol className="lab16-events">{run.events.map((name, index) => <li key={index} className={name.includes('requires_action') ? 'action' : name.includes('item.') ? 'item' : name.includes('output_text') ? 'text' : ''}><code>{name.replace('agent.session.', '')}</code></li>)}</ol>
    {calls.length ? <><h3 className="lab13-subhead">The agent’s request <code>{run.requiredActions.length ? 'session.required_actions' : 'function_call items'}</code></h3><div className="lab16-calls">{calls.map((call, index) => <CallCard key={call.callId} call={call} run={run} index={index} />)}</div></> : null}
    {run.answer ? <><h3 className="lab13-subhead">Answer <code>{calls.length ? 'text before the request' : 'no tool call'}</code></h3><div className="lab7-answer lab16-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{run.answer}</ReactMarkdown></div></> : null}
    {run.error ? <p className="lab2-error" role="alert">{run.error}</p> : null}
  </div>;
}

export default function Lab16({ active, health }: { active: boolean; health: Health }) {
  const [presetId, setPresetId] = useState<ToolPreset['id']>('good');
  const [draft, setDraft] = useState<ToolDraft>(toolPresets[0].draft as ToolDraft);
  const [prompt, setPrompt] = useState(prompts[0].text);
  const [after, setAfter] = useState<After>('cancel');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [live, setLive] = useState<{ events: string[]; calls: ToolCall[]; answer: string } | null>(null);
  const [runs, setRuns] = useState<ToolRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scenarioId, setScenarioId] = useState(toolScenarios[0].id);
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const abort = useRef<AbortController | null>(null);
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const noTool = presetId === 'none';
  const lint = useMemo(() => (noTool ? null : lintTool(draft)), [draft, noTool]);
  const blocked = !noTool && !lint?.declaration;
  const toolsParam = noTool ? null : lint?.declaration ?? null;
  const selected = runs.find((run) => run.id === selectedId) ?? runs.at(-1) ?? null;
  const scenario = toolScenarios.find((item) => item.id === scenarioId) ?? toolScenarios[0];

  function choosePreset(preset: ToolPreset) { setPresetId(preset.id); if (preset.draft) setDraft(preset.draft); }
  function edit(field: keyof ToolDraft, value: string) { setDraft((previous) => ({ ...previous, [field]: value })); if (presetId === 'none') setPresetId('good'); }

  async function runOnce() {
    const question = prompt.trim();
    if (!question || running || blocked) return;
    const controller = new AbortController();
    abort.current = controller;
    const id = newId();
    setRunning(true); setError(''); setSaved(null); setStatus(''); setLive({ events: [], calls: [], answer: '' });
    try {
      const response = await fetch('/api/lab16/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ prompt: question, after, tool: toolsParam ? { name: toolsParam.name, description: toolsParam.description, parameters: toolsParam.parameters } : null }) });
      if (!response.ok) throw new Error((await response.json()).error || `Request failed (${response.status}).`);
      if (!response.body) throw new Error('The browser could not read the response stream.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let record: ToolRun | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const raw of lines) {
          if (!raw.trim()) continue;
          const line = JSON.parse(raw);
          if (line.type === 'status' && typeof line.label === 'string') setStatus(line.label);
          if (line.type === 'event' && typeof line.name === 'string') setLive((previous) => previous && { ...previous, events: [...previous.events, line.name] });
          if (line.type === 'text' && typeof line.text === 'string') setLive((previous) => previous && { ...previous, answer: line.text });
          if (line.type === 'call' && line.call && typeof line.call.callId === 'string') setLive((previous) => previous && { ...previous, calls: [...previous.calls.filter((item) => item.callId !== line.call.callId), line.call as ToolCall] });
          if (line.type === 'requires_action') setStatus(`Session is ${String(line.sessionStatus)}: the agent is waiting for a tool result`);
          if (line.type === 'summary') record = parseToolRun(line.summary, id, question);
        }
      }
      if (!record) throw new Error('The stream ended without a run summary.');
      const finished: ToolRun = record;
      setRuns((previous) => [...previous, finished]);
      setSelectedId(id);
      setLive(null);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The run failed.');
    } finally {
      if (abort.current === controller) abort.current = null;
      setRunning(false);
    }
  }

  async function readSession(run: ToolRun) {
    if (!run.sessionId) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/lab16/session?${new URLSearchParams({ sessionId: run.sessionId })}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      setSaved({ status: String(body.status), requiredActions: Array.isArray(body.requiredActions) ? body.requiredActions : [], tools: Array.isArray(body.tools) ? body.tools : [] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not read the session.'); }
    finally { setBusy(false); }
  }
  async function cancelWaiting(run: ToolRun) {
    if (!run.sessionId) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/lab16/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: run.sessionId }) });
      if (!response.ok) throw new Error((await response.json()).error || `Request failed (${response.status}).`);
      setRuns((previous) => previous.map((item) => item.id === run.id ? { ...item, cancelSent: true } : item));
      // 202 means received. Read the session again to see the effect.
      setTimeout(() => void readSession(run), 1200);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not cancel the turn.'); setBusy(false); }
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

  return <div className="lab16-page">
    <div className="lab2-hero"><span className="lab2-badge lab16-badge">16/50</span><div><div className="eyebrow">LAB 16 / DECLARE A FUNCTION TOOL</div><h1>Declare a <em>function tool</em>.</h1><p>Give the agent a course-calendar lookup it can ask for. A tool is a declaration: a name, a description, and a JSON Schema for its arguments. The agent never runs your function. It asks for it, and the session waits.</p></div></div>

    <section className="lab7-card"><span className="eyebrow">TOOL DECLARATION</span><h2>Describe the function the agent may call</h2><p>Start from a preset, then edit any field. The linter blocks errors and warns about weak wording, so you can run a weak tool and compare.</p>
      <div className="lab16-presets" role="radiogroup" aria-label="Tool presets">{toolPresets.map((preset) => <button type="button" key={preset.id} role="radio" aria-checked={presetId === preset.id} className={presetId === preset.id ? 'selected' : ''} onClick={() => choosePreset(preset)} disabled={running}><strong>{preset.label}</strong><small>{preset.hint}</small></button>)}</div>
      {noTool ? <p className="lab8-note">No tool: the session is created without <code>agent.tools</code>. Ask a schedule question and see what the agent says.</p> : <div className="lab16-editor">
        <div>
          <label htmlFor="lab16-name">name</label>
          <input id="lab16-name" value={draft.name} maxLength={80} onChange={(event) => edit('name', event.target.value)} disabled={running} spellCheck={false} />
          <label htmlFor="lab16-description">description</label>
          <textarea id="lab16-description" value={draft.description} maxLength={1500} onChange={(event) => edit('description', event.target.value)} disabled={running} />
          <label htmlFor="lab16-parameters">parameters <small>JSON Schema</small></label>
          <textarea id="lab16-parameters" className="lab16-code-input" value={draft.parametersText} maxLength={6000} onChange={(event) => edit('parametersText', event.target.value)} disabled={running} spellCheck={false} />
        </div>
        <div>
          <h3 className="lab13-subhead">Linter <code>{lint?.declaration ? 'ready to send' : 'blocked'}</code></h3>
          {lint ? <Findings findings={lint.findings} /> : null}
          <h3 className="lab13-subhead">What the server sends <code>agent.tools</code></h3>
          <pre className="lab16-json"><code>{lint?.declaration ? json([lint.declaration]) : '// fix the errors first'}</code></pre>
        </div>
      </div>}
    </section>

    <section className="lab7-card"><span className="eyebrow">LIVE RUN</span><h2>Ask, and watch for the request</h2><p>Each run creates a new session whose agent has the declaration above. The instructions never name the tool, so the description decides whether it is used.</p>
      <div className="lab16-prompts">{prompts.map((item) => <button type="button" key={item.label} className={prompt === item.text ? 'selected' : ''} onClick={() => setPrompt(item.text)} disabled={running}>{item.label}</button>)}</div>
      <label htmlFor="lab16-prompt">Your question</label>
      <textarea id="lab16-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} disabled={running} />
      <fieldset className="lab15-modes lab16-after"><legend>When the agent asks for the tool</legend>
        <label className={after === 'cancel' ? 'selected' : ''}><input type="radio" name="lab16-after" checked={after === 'cancel'} onChange={() => setAfter('cancel')} disabled={running} /><span><strong>Capture it, then cancel</strong><small>No result is sent in Lab 16, so the server cancels the waiting turn.</small></span></label>
        <label className={after === 'leave' ? 'selected' : ''}><input type="radio" name="lab16-after" checked={after === 'leave'} onChange={() => setAfter('leave')} disabled={running} /><span><strong>Leave it waiting</strong><small>Stop reading and inspect the saved session. Cancel it yourself afterwards.</small></span></label>
      </fieldset>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void runOnce()} disabled={running || blocked || !health?.configured || !prompt.trim()}>{running ? 'Running…' : noTool ? 'Run without a tool' : `Run with ${lint?.declaration?.name ?? 'the tool'}`}</button>{running ? <button type="button" className="lab8-secondary" onClick={() => abort.current?.abort()}>Stop reading</button> : null}</div>
      {!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env and restart the server for a live run. The playground below works without a key.</p> : null}
      {blocked ? <p className="lab8-note">The declaration has errors. Fix them to run.</p> : null}
      {status ? <p className="lab7-session-id">{status}</p> : null}
      {live ? <div className="lab16-live"><ol className="lab16-events">{live.events.map((name, index) => <li key={index} className={name.includes('requires_action') ? 'action' : name.includes('item.') ? 'item' : name.includes('output_text') ? 'text' : ''}><code>{name.replace('agent.session.', '')}</code></li>)}</ol>{live.calls.map((call) => <p key={call.callId} className="lab16-live-call"><code>{call.name}</code> requested · <code>{call.callId}</code></p>)}{live.answer ? <div className="lab7-answer lab16-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{live.answer}</ReactMarkdown></div> : null}</div> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    <div className="lab16-grid">
      <section className="lab7-card"><span className="eyebrow">RESULT</span><h2>{selected ? `Run #${runs.indexOf(selected) + 1}` : 'No run yet'}</h2>
        {selected ? <>
          <p className="lab16-prompt-line">“{selected.prompt}”</p>
          <RunView run={selected} />
          {selected.sessionId ? <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => void readSession(selected)} disabled={busy}>{busy ? 'Reading…' : 'Read the saved session'}</button>{selected.turnStatus === 'waiting' && !selected.cancelSent ? <button type="button" className="lab8-secondary" onClick={() => void cancelWaiting(selected)} disabled={busy}>Cancel the waiting turn</button> : null}</div> : null}
          {saved ? <div className="lab16-saved"><h3 className="lab13-subhead">Saved session <code>sessions.retrieve</code></h3><p>status <span className={'lab14-status ' + (saved.status === 'requires_action' ? 'waiting' : saved.status)}>{saved.status}</span> · tools <code>{saved.tools.map((tool) => tool.name).join(', ') || 'none'}</code> · required_actions <b>{saved.requiredActions.length}</b></p>{saved.requiredActions.length ? <pre className="lab16-json"><code>{json(saved.requiredActions.map((action) => ({ type: 'function_call', call_id: action.callId, name: action.name, turn_id: action.turnId, arguments: action.arguments })))}</code></pre> : <p className="lab8-note">Nothing is waiting. {saved.status === 'idle' ? 'The session is ready for new input.' : ''}</p>}</div> : null}
        </> : <p className="lab8-note">Run a question to see whether the agent asks for the tool, and with which arguments.</p>}
      </section>
      <section className="lab7-card"><span className="eyebrow">RUN HISTORY</span><h2>Same question, different declarations</h2>
        {runs.length ? <div className="lab9-table-wrap lab15-history lab16-history"><table>
          <thead><tr><th>Run</th><th>Tool</th><th>Question</th><th>Outcome</th><th>Arguments</th></tr></thead>
          <tbody>{runs.map((run, index) => { const verdict = classifyRun(run); const first = run.requiredActions[0] ?? run.calls[0]; return <tr key={run.id} className={run.id === selected?.id ? 'selected' : ''} onClick={() => { setSelectedId(run.id); setSaved(null); }}>
            <th><button type="button" className="lab15-link" onClick={() => { setSelectedId(run.id); setSaved(null); }} aria-pressed={run.id === selected?.id}>#{index + 1}</button></th>
            <td><code>{run.tool?.name ?? 'none'}</code></td><td className="lab16-q">{run.prompt}</td><td><span className={'lab16-tone ' + verdict.tone}>{verdict.title}</span></td>
            <td className="lab16-q"><code>{first ? JSON.stringify(first.arguments) : '—'}</code></td></tr>; })}</tbody>
        </table></div> : <p className="lab8-note">No runs yet. Try the same schedule question with Well described, Vague, and No tool.</p>}
      </section>
    </div>

    <section className="lab7-card" id="lab16-playground"><span className="eyebrow">TOOL PLAYGROUND · NO API KEY NEEDED</span><h2>Six requests, read the same way</h2><p>Each case is a scripted run in the same shape as the live result, read by the same functions.</p>
      <p className="lab15-label">Event types, item fields, and statuses come from the SDK’s types. What the model chose to do in each case is illustrative: these are fixtures, not recordings.</p>
      <div className="lab16-scenarios" role="tablist" aria-label="Playground cases">{toolScenarios.map((item, index) => <button type="button" role="tab" key={item.id} aria-selected={item.id === scenario.id} className={item.id === scenario.id ? 'selected' : ''} onClick={() => setScenarioId(item.id)}><span>{index + 1}</span>{item.title}</button>)}</div>
      <p className="lab16-prompt-line">“{scenario.run.prompt}” · tool <code>{scenario.run.tool?.name ?? 'none'}</code></p>
      <p className="lab8-note">{scenario.summary}</p>
      <p className="lab15-lesson"><strong>Lesson:</strong> {scenario.lesson}</p>
      <RunView run={scenario.run} />
    </section>

    <section className="lab3-guide lab16-guide"><h2>Read the evidence</h2><div><article><strong>Declaration</strong><p>name, description, parameters. The model sees these, never your code.</p></article><article><strong>Request</strong><p>A <code>function_call</code> item with a <code>call_id</code>, then <code>requires_action</code>.</p></article><article><strong>Arguments</strong><p>Typed <code>unknown</code>. Parse them, then compare with the schema.</p></article><article><strong>Waiting</strong><p>The turn is <code>waiting</code> until a result arrives. That is Lab 17.</p></article></div><p className="lab3-guide-note">A tool the agent can call is part of your API surface. Keep it narrow: one job, few arguments, and a description that says when not to use it.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 16</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind the tool request</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Declare the tool, attach it to the agent, write a description that decides when, spot the request in the stream, parse its arguments, and read it back from the saved session. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Ask <em>When is the Lab 17 session?</em> three times: with <em>Well described</em>, with <em>Vague</em>, and with <em>No tool</em>. Then ask <em>What is a JavaScript closure?</em> with the well-described tool. Show the run history and explain which runs requested the tool and why, what the arguments were, and why the general question did not need it. Finally, run once with <em>Leave it waiting</em> and show the saved session’s <code>required_actions</code>.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/tools/functions" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
