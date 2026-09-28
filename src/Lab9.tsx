import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { AnswerPre } from './Lab6.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';

type Health = { configured: boolean; model: string } | null;
type SavedAgent = { id: string; name: string; model: string; instructions: string };
type Mode = 'baseline' | 'updated';
type Result = { sessionId: string; turnId: string; model: string; effort: string | null; answer: string; durationMs: number | null; inputTokens: number | null; outputTokens: number | null; status: string; error: string; score: string; notes: string };
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Event =
  | { type: 'status'; label: string }
  | { type: 'session'; sessionId: string }
  | { type: 'configuration'; model: string; effort: string | null }
  | { type: 'text'; text: string }
  | { type: 'complete'; durationMs: number; turnId: string; inputTokens: number | null; outputTokens: number | null }
  | { type: 'error'; message: string };
const storageKey = 'agents-api-lab7-agent-id';
const emptyResult = (): Result => ({ sessionId: '', turnId: '', model: '', effort: null, answer: '', durationMs: null, inputTokens: null, outputTokens: null, status: 'Not started', error: '', score: '', notes: '' });
const lessons: Lesson[] = [
  { number: '01', title: 'Start with the saved agent', file: 'server/lab9.ts', code: "const first = await api.beta.agents.sessions.create({\n  agent_id: agentId,\n  environment: { type: 'none' },\n  input: setupPrompt,\n  stream: true,\n});", explanation: 'Each run starts a separate session from the Lab 07 saved agent and completes the same setup turn. This gives both follow-up turns the same starting prompt and preset.' },
  { number: '02', title: 'Update only the next turn', file: 'server/lab9.ts', code: "const updated = await api.beta.agents.sessions.update(sessionId, {\n  agent: {\n    model,\n    reasoning: { effort: effort === 'default' ? null : effort },\n  },\n});", explanation: 'After the setup turn finishes, the updated run changes its session model and reasoning effort. A null effort asks the selected model to use its default. The saved agent stays unchanged.' },
  { number: '03', title: 'Send the same follow-up', file: 'server/lab9.ts', code: "const stream = await api.beta.agents.sessions.events.stream(sessionId);\nconst started = performance.now();\nawait api.beta.agents.sessions.events.create(sessionId, {\n  events: [{\n    type: 'agent.session.input.message',\n    input: [{ role: 'user', content: [{ type: 'input_text', text: question }] }],\n  }],\n});", explanation: 'The server subscribes before it sends the follow-up, then starts a timer. Both sessions receive the same question. The measured interval covers the follow-up request through turn completion.' },
  { number: '04', title: 'Fill the comparison worksheet', file: 'src/Lab9.tsx', code: "if (event.type === 'complete') return {\n  ...previous,\n  [mode]: { ...current, turnId: event.turnId,\n    durationMs: event.durationMs,\n    inputTokens: event.inputTokens,\n    outputTokens: event.outputTokens, status: 'Completed' },\n};", explanation: 'The app records the measured turn ID, time, and best-effort tokens with the answer and effective configuration. You score quality yourself using the same rubric for both answers; missing usage is shown as unknown.' },
];

function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}

function parseEvent(value: unknown): Event {
  if (!value || typeof value !== 'object' || !('type' in value)) throw new Error('Invalid stream event.');
  const event = value as Record<string, unknown>;
  if (event.type === 'status' && typeof event.label === 'string') return { type: 'status', label: event.label };
  if (event.type === 'session' && typeof event.sessionId === 'string') return { type: 'session', sessionId: event.sessionId };
  if (event.type === 'configuration' && typeof event.model === 'string' && (typeof event.effort === 'string' || event.effort === null)) return { type: 'configuration', model: event.model, effort: event.effort as string | null };
  if (event.type === 'text' && typeof event.text === 'string') return { type: 'text', text: event.text };
  if (event.type === 'complete' && typeof event.durationMs === 'number' && typeof event.turnId === 'string' && (typeof event.inputTokens === 'number' || event.inputTokens === null) && (typeof event.outputTokens === 'number' || event.outputTokens === null)) return event as Event;
  if (event.type === 'error' && typeof event.message === 'string') return { type: 'error', message: event.message };
  throw new Error(`Invalid stream event: ${String(event.type)}.`);
}

async function runStream(payload: object, onEvent: (event: Event) => void) {
  const response = await fetch('/api/lab9/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) {
    const body: unknown = await response.json();
    throw new Error(typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : `Request failed (${response.status}).`);
  }
  if (!response.body) throw new Error('The browser could not read the response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let raw: unknown;
        try { raw = JSON.parse(line); } catch { throw new Error('The server sent invalid JSON.'); }
        const event = parseEvent(raw);
        onEvent(event);
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'complete') completed = true;
      }
    }
  } finally { reader.releaseLock(); }
  if (!completed) throw new Error('The stream ended before the follow-up turn completed. Inspect the session before retrying.');
}

function csvCell(value: string | number | null) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

export default function Lab9({ active, health, onOpenLab7 }: { active: boolean; health: Health; onOpenLab7: () => void }) {
  const [agent, setAgent] = useState<SavedAgent | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [setupPrompt, setSetupPrompt] = useState('I am learning TypeScript. In one sentence, describe how you will help me learn.');
  const [question, setQuestion] = useState('Explain the difference between a TypeScript interface and a type alias. Give one short example and a rule of thumb.');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('low');
  const [results, setResults] = useState<Record<Mode, Result>>({ baseline: emptyResult(), updated: emptyResult() });
  const [running, setRunning] = useState<Mode | null>(null);
  const [speakingLesson, setSpeakingLesson] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  async function loadAgent() {
    const id = localStorage.getItem(storageKey);
    if (!id) { setAgent(null); setLoadError('Create and save a tutor preset in Lab 07 first.'); return; }
    setLoading(true); setLoadError('');
    try {
      const response = await fetch('/api/lab7/agent?agentId=' + encodeURIComponent(id));
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      const loaded = body.agent as SavedAgent;
      setAgent(loaded); setModel(loaded.model); resetResults();
    } catch (caught) { setAgent(null); setLoadError(caught instanceof Error ? caught.message : 'Could not load the saved agent.'); }
    finally { setLoading(false); }
  }
  function resetResults() { setResults({ baseline: emptyResult(), updated: emptyResult() }); }
  useEffect(() => { if (active && health?.configured) void loadAgent(); }, [active, health?.configured]);
  useEffect(() => {
    if (!speechAvailable) return;
    const synthesis = window.speechSynthesis;
    const refresh = () => setVoices(synthesis.getVoices());
    refresh(); synthesis.addEventListener('voiceschanged', refresh);
    return () => synthesis.removeEventListener('voiceschanged', refresh);
  }, [speechAvailable]);
  useEffect(() => () => { if (speechAvailable) window.speechSynthesis.cancel(); }, [speechAvailable]);
  useEffect(() => { if (!active) stopSpeech(); }, [active]);

  function stopSpeech() {
    utteranceRef.current = null;
    if (speechAvailable) window.speechSynthesis.cancel();
    setSpeakingLesson(null);
  }
  function readLesson(lesson: Lesson) {
    if (!speechAvailable) return;
    if (speakingLesson === lesson.number) { stopSpeech(); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${lesson.title}. ${lesson.explanation}`);
    const narrator = selectNarratorVoice(voices.length ? voices : window.speechSynthesis.getVoices());
    if (narrator) utterance.voice = narrator;
    utterance.lang = narrator?.lang || 'en-US';
    utterance.pitch = narrator && masculineVoiceName.test(narrator.name) ? 1 : 0.78;
    utterance.rate = 0.95;
    utterance.onend = utterance.onerror = () => { if (utteranceRef.current === utterance) { utteranceRef.current = null; setSpeakingLesson(null); } };
    utteranceRef.current = utterance; setSpeakingLesson(lesson.number); window.speechSynthesis.speak(utterance);
  }

  async function run(mode: Mode) {
    if (!agent || running) return;
    if (!setupPrompt.trim() || !question.trim() || (mode === 'updated' && !model.trim())) {
      setResults((previous) => ({ ...previous, [mode]: { ...emptyResult(), status: 'Invalid input', error: 'Enter both prompts and a model for the updated run.' } }));
      return;
    }
    setRunning(mode);
    setResults((previous) => ({ ...previous, [mode]: { ...emptyResult(), status: 'Starting' } }));
    try {
      await runStream({ agentId: agent.id, setupPrompt: setupPrompt.trim(), question: question.trim(), mode, ...(mode === 'updated' ? { model: model.trim(), effort } : {}) }, (event) => {
        setResults((previous) => {
          const current = previous[mode];
          if (event.type === 'status') return { ...previous, [mode]: { ...current, status: event.label } };
          if (event.type === 'session') return { ...previous, [mode]: { ...current, sessionId: event.sessionId } };
          if (event.type === 'configuration') return { ...previous, [mode]: { ...current, model: event.model, effort: event.effort } };
          if (event.type === 'text') return { ...previous, [mode]: { ...current, answer: event.text, status: 'Streaming follow-up answer' } };
          if (event.type === 'complete') return { ...previous, [mode]: { ...current, turnId: event.turnId, durationMs: event.durationMs, inputTokens: event.inputTokens, outputTokens: event.outputTokens, status: 'Completed' } };
          return previous;
        });
      });
    } catch (caught) {
      setResults((previous) => ({ ...previous, [mode]: { ...previous[mode], status: 'Failed or interrupted', error: caught instanceof Error ? caught.message : 'Unknown error.' } }));
    } finally { setRunning(null); }
  }

  function exportWorksheet() {
    const rows = [
      ['run', 'agent_id', 'session_id', 'turn_id', 'model', 'reasoning_effort', 'follow_up_ms', 'input_tokens', 'output_tokens', 'quality_1_to_5', 'notes', 'answer'],
      ...(['baseline', 'updated'] as const).map((mode) => { const result = results[mode]; return [mode, agent?.id || '', result.sessionId, result.turnId, result.model, result.effort ?? 'model default', result.durationMs, result.inputTokens, result.outputTokens, result.score, result.notes, result.answer]; }),
    ];
    const csv = rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'lab09-comparison.csv'; link.click(); URL.revokeObjectURL(url);
  }

  const bothCompleted = results.baseline.status === 'Completed' && results.updated.status === 'Completed';
  return <div className="lab9-page">
    <div className="lab2-hero"><span className="lab2-badge lab9-badge">9/50</span><div><div className="eyebrow">LAB 09 / MODEL &amp; REASONING SETTINGS</div><h1>Compare <em>the next turn.</em></h1><p>Run the same follow-up question in two sessions, then fill a quality and latency worksheet.</p></div></div>
    <section className="lab7-card lab9-setup"><span className="eyebrow">SAVED PRESET FROM LAB 07</span><h2>Start from one tutor</h2>{agent ? <p><strong>{agent.name}</strong> · {agent.model} · <code>{agent.id}</code></p> : <p>{loading ? 'Loading your saved agent…' : loadError || 'Waiting for your saved agent.'}</p>}{!health?.configured ? <p>Add OPENAI_API_KEY to .env and restart the server to use the live API.</p> : null}<div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void loadAgent()} disabled={loading || Boolean(running) || !health?.configured}>Reload saved agent</button><button type="button" className="lab8-secondary" onClick={onOpenLab7}>Open Lab 07</button></div></section>
    <section className="lab7-card lab9-controls"><span className="eyebrow">SHARED INPUTS</span><h2>Keep both prompts identical</h2><label htmlFor="lab9-setup">Setup turn in each new session</label><textarea id="lab9-setup" maxLength={2000} value={setupPrompt} onChange={(event) => { setSetupPrompt(event.target.value); resetResults(); }} disabled={Boolean(running)} /><label htmlFor="lab9-question">Measured follow-up question</label><textarea id="lab9-question" maxLength={2000} value={question} onChange={(event) => { setQuestion(event.target.value); resetResults(); }} disabled={Boolean(running)} /><div className="lab9-settings"><div><label htmlFor="lab9-model">Updated run model</label><input id="lab9-model" maxLength={100} value={model} onChange={(event) => { setModel(event.target.value); resetResults(); }} disabled={Boolean(running)} /><small>Enter a model supported by your project. The API validates access.</small></div><div><label htmlFor="lab9-effort">Updated run reasoning effort</label><select id="lab9-effort" value={effort} onChange={(event) => { setEffort(event.target.value); resetResults(); }} disabled={Boolean(running)}><option value="default">Model default</option><option value="none">None</option><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option><option value="max">Max</option></select><small>Supported values vary by model. An incompatible setting returns an error.</small></div></div></section>
    <div className="lab8-results">{(['baseline', 'updated'] as const).map((mode) => { const result = results[mode]; return <section className="lab7-card" key={mode}><span className="eyebrow">{mode === 'baseline' ? 'A · SAVED CONFIGURATION' : 'B · UPDATED SESSION'}</span><h2>{mode === 'baseline' ? 'Baseline' : 'New model or effort'}</h2><p className="lab8-note">{mode === 'baseline' ? 'The saved configuration continues into the follow-up.' : 'The server updates this session after its setup turn.'}</p><button type="button" className="lab7-primary" onClick={() => void run(mode)} disabled={!agent || !health?.configured || Boolean(running)}>{running === mode ? 'Running…' : `Run ${mode}`}</button><p className="lab7-session-status" role="status">{result.status}</p>{result.sessionId ? <p className="lab7-session-id">Session <code>{result.sessionId}</code></p> : null}{result.turnId ? <p className="lab7-session-id">Measured turn <code>{result.turnId}</code></p> : null}{result.model ? <p><strong>Effective settings:</strong> {result.model} · effort {result.effort ?? 'model default'}</p> : null}{result.durationMs !== null ? <p><strong>Follow-up time:</strong> {(result.durationMs / 1000).toFixed(2)} s · <strong>Tokens:</strong> {result.inputTokens ?? 'unknown'} in / {result.outputTokens ?? 'unknown'} out</p> : null}{result.error ? <p className="lab2-error" role="alert">{result.error}</p> : null}<div className="lab7-answer lab9-answer">{result.answer ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{result.answer}</ReactMarkdown> : <p className="lab7-empty">The follow-up answer appears here.</p>}</div>{result.status === 'Completed' ? <><label htmlFor={`lab9-score-${mode}`}>Quality score (same rubric for both)</label><select id={`lab9-score-${mode}`} value={result.score} onChange={(event) => setResults((previous) => ({ ...previous, [mode]: { ...previous[mode], score: event.target.value } }))}><option value="">Choose 1–5</option>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}</select><label htmlFor={`lab9-notes-${mode}`}>Evidence or quality notes</label><textarea id={`lab9-notes-${mode}`} value={result.notes} maxLength={1000} onChange={(event) => setResults((previous) => ({ ...previous, [mode]: { ...previous[mode], notes: event.target.value } }))} placeholder="Accuracy, clarity, examples, omissions…" /></> : null}</section>; })}</div>
    <section className="lab7-card lab9-worksheet"><span className="eyebrow">COMPARISON WORKSHEET</span><h2>What did the changed setting achieve?</h2><p>Score accuracy, clarity, and usefulness from 1 to 5 using the same rubric. A single run is an observation; repeat before drawing a strong conclusion.</p><div className="lab9-table-wrap"><table><thead><tr><th>Run</th><th>Model</th><th>Effort</th><th>Time</th><th>Input / output tokens</th><th>Quality</th></tr></thead><tbody>{(['baseline', 'updated'] as const).map((mode) => { const result = results[mode]; return <tr key={mode}><th>{mode === 'baseline' ? 'A · baseline' : 'B · updated'}</th><td>{result.model || '—'}</td><td>{result.model ? result.effort ?? 'default' : '—'}</td><td>{result.durationMs === null ? '—' : `${(result.durationMs / 1000).toFixed(2)} s`}</td><td>{result.status === 'Completed' ? `${result.inputTokens ?? 'unknown'} / ${result.outputTokens ?? 'unknown'}` : '—'}</td><td>{result.score || '—'}</td></tr>; })}</tbody></table></div><button type="button" className="lab7-primary" onClick={exportWorksheet} disabled={!bothCompleted}>Download CSV worksheet</button><p className="lab8-note">Time is measured on the server from follow-up submission to completion. It excludes setup and configuration updates. Token usage is best effort and may be unknown.</p></section>
    <section className="lab3-guide lab9-guide"><h2>Read the evidence</h2><div><article><strong>Model choice</strong><p>The saved preset supplies the baseline model. Updating Session B changes only its later turns.</p></article><article><strong>Reasoning effort</strong><p>The selected effort is a request. Supported values depend on the model; model default resets the effort.</p></article><article><strong>Quality</strong><p>Compare factual accuracy, clarity, and usefulness against the same question and rubric.</p></article><article><strong>Latency and usage</strong><p>Use actual completion time and available turn tokens. Unknown usage is not zero.</p></article></div></section>
    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 09</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind the comparison</span><span className="code-lessons-hint">Four explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Follow the create, update, measure, and evaluate steps. Viva voice reads each explanation through browser speech synthesis.</p><div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speakingLesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speakingLesson === lesson.number} aria-label={speakingLesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speakingLesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</button></article>)}</div></div></details>
    <section className="student-challenge"><strong>Try it yourself</strong><p>Run both configurations with the same prompts. Score each answer and export the worksheet. Then change only one setting, run a new pair, and explain whether the quality change was worth the measured time.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>PRESET MODEL: {agent?.model || health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/configuration" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
