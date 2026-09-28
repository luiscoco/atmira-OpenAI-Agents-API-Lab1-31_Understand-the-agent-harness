import { useEffect, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';

type Health = { configured: boolean; model: string } | null;
type SavedAgent = { id: string; name: string; model: string };
type StudyDay = { day: number; focus: string; activity: string; minutes: number };
type StudyPlan = { title: string; goal: string; days: StudyDay[] };
type Check = { valid: boolean; plan: StudyPlan | null; errors: string[] };
type Attempt = Check & { attempt: number; turnId: string; raw: string };
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type RunEvent =
  | { type: 'status'; label: string }
  | { type: 'session'; sessionId: string }
  | { type: 'text'; attempt: number; text: string }
  | { type: 'validation'; attempt: number; turnId: string; raw: string; valid: boolean; plan: StudyPlan | null; errors: string[] }
  | { type: 'complete'; accepted: boolean }
  | { type: 'error'; message: string };

const storageKey = 'agents-api-lab7-agent-id';
const malformedSample = '{"title":"TypeScript foundations","goal":"Build a typed app","days":[{"day":1,"focus":"Types","activity":"Write a typed function","minutes":90}]}';
const validSample = '{"title":"TypeScript foundations","goal":"Build a typed app","days":[{"day":1,"focus":"Types","activity":"Write three typed functions","minutes":30},{"day":2,"focus":"Interfaces","activity":"Model a user object and test it","minutes":30},{"day":3,"focus":"Components","activity":"Type the props of a small React component","minutes":30}]}';
const lessons: Lesson[] = [
  { number: '01', title: 'Write a precise contract', file: 'server/lab10Contract.ts', code: "export function studyPlanInstructions(days: number, minutesPerDay: number): string {\n  return `Create a practical study plan. Output ONLY one JSON object, with no Markdown fences or prose. Exact shape: {\"title\":\"string\",\"goal\":\"string\",\"days\":[{\"day\":1,\"focus\":\"string\",\"activity\":\"string\",\"minutes\":number}]}. Include exactly ${days} days, numbered 1 through ${days} in order. Each activity must be concrete and achievable. Each minutes value must be an integer from 1 to ${minutesPerDay}. Keep title at most 100 characters, goal at most 240, focus at most 100, and activity at most 300. Do not add fields.`;\n}", explanation: 'The session instructions state the required fields and day count. They guide the model, but they are still a request. Application code must verify the actual answer.' },
  { number: '02', title: 'Override this session', file: 'server/lab10.ts', code: "const stream = await api.beta.agents.sessions.create({\n  agent_id: agentId,\n  agent: { instructions: studyPlanInstructions(days, minutesPerDay) },\n  environment: { type: 'none' },\n  input, stream: true,\n});", explanation: 'Lab 10 starts from the saved Lab 07 agent. Its output instructions apply to this new session, leaving the saved preset untouched.' },
  { number: '03', title: 'Validate the completed answer', file: 'server/lab10Contract.ts', code: "const parsed: unknown = JSON.parse(raw);\nif (!Array.isArray(parsed.days) || parsed.days.length !== requestedDays) {\n  errors.push(`days must contain exactly ${requestedDays} entries.`);\n}\n// Check every day, field type, day number, and time budget.", explanation: 'Parsing alone only proves that the text is JSON. The validator also checks its shape, field types, day order, and daily time budget before the app accepts a plan.' },
  { number: '04', title: 'Repair once, then stop', file: 'server/lab10.ts', code: "if (check.valid || attempt === 2) { writeEvent(response, { type: 'complete', accepted: check.valid }); break; }\nstream = await api.beta.agents.sessions.events.stream(sessionId);\nawait api.beta.agents.sessions.events.create(sessionId, {\n  events: [{ type: 'agent.session.input.message', input: [{ role: 'user',\n    content: [{ type: 'input_text', text: `Your previous plan failed validation:\\n${check.errors.join('\\n')}\\nReturn a corrected complete JSON object only. Keep the original topic and goal. Do not add Markdown or commentary.` }] }] }],\n});", explanation: 'An invalid first result remains visible with its errors. The server asks the same session for one corrected complete object, validates again, and stops after two attempts. A rejected plan never appears as accepted.' },
];

function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}
function parseEvent(value: unknown): RunEvent {
  if (!value || typeof value !== 'object' || !('type' in value)) throw new Error('Invalid stream event.');
  const event = value as Record<string, unknown>;
  if (event.type === 'status' && typeof event.label === 'string') return event as RunEvent;
  if (event.type === 'session' && typeof event.sessionId === 'string') return event as RunEvent;
  if (event.type === 'text' && typeof event.attempt === 'number' && typeof event.text === 'string') return event as RunEvent;
  if (event.type === 'validation' && typeof event.attempt === 'number' && typeof event.turnId === 'string' && typeof event.raw === 'string' && typeof event.valid === 'boolean' && Array.isArray(event.errors)) return event as RunEvent;
  if (event.type === 'complete' && typeof event.accepted === 'boolean') return event as RunEvent;
  if (event.type === 'error' && typeof event.message === 'string') return event as RunEvent;
  throw new Error('Invalid stream event.');
}
async function runStream(payload: object, onEvent: (event: RunEvent) => void) {
  const response = await fetch('/api/lab10/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) { const body = await response.json(); throw new Error(body.error || `Request failed (${response.status}).`); }
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
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = parseEvent(JSON.parse(line));
        onEvent(event);
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'complete') completed = true;
      }
    }
  } finally { reader.releaseLock(); }
  if (!completed) throw new Error('The stream ended early. Inspect the session before starting another run.');
}

export default function Lab10({ active, health, onOpenLab7 }: { active: boolean; health: Health; onOpenLab7: () => void }) {
  const [agent, setAgent] = useState<SavedAgent | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [topic, setTopic] = useState('TypeScript for React');
  const [goal, setGoal] = useState('Build a small typed React component with confidence');
  const [days, setDays] = useState(3);
  const [minutesPerDay, setMinutesPerDay] = useState(30);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Not started');
  const [error, setError] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [streamText, setStreamText] = useState('');
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [sample, setSample] = useState(malformedSample);
  const [sampleCheck, setSampleCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
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
      setAgent(body.agent);
    } catch (caught) { setAgent(null); setLoadError(caught instanceof Error ? caught.message : 'Could not load the saved agent.'); }
    finally { setLoading(false); }
  }
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
  function stopSpeech() { utteranceRef.current = null; if (speechAvailable) window.speechSynthesis.cancel(); setSpeakingLesson(null); }
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
  function resetRun() { setStatus('Not started'); setError(''); setSessionId(''); setStreamText(''); setAttempts([]); setAccepted(false); setSampleCheck(null); }
  async function run() {
    if (!agent || running) return;
    if (!topic.trim() || !goal.trim()) { setError('Enter a topic and learning goal.'); return; }
    resetRun(); setRunning(true); setStatus('Starting');
    try {
      await runStream({ agentId: agent.id, topic: topic.trim(), goal: goal.trim(), days, minutesPerDay }, (event) => {
        if (event.type === 'status') setStatus(event.label);
        if (event.type === 'session') setSessionId(event.sessionId);
        if (event.type === 'text') setStreamText(event.text);
        if (event.type === 'validation') { setAttempts((previous) => [...previous, event]); setStreamText(''); }
        if (event.type === 'complete') { setAccepted(event.accepted); setStatus(event.accepted ? 'Accepted: contract satisfied' : 'Rejected after one repair attempt'); }
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unknown error.'); setStatus('Failed or interrupted'); }
    finally { setRunning(false); }
  }
  async function validateSample() {
    setChecking(true); setSampleCheck(null);
    try {
      const response = await fetch('/api/lab10/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: sample, days, minutesPerDay }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      setSampleCheck(body);
    } catch (caught) { setSampleCheck({ valid: false, plan: null, errors: [caught instanceof Error ? caught.message : 'Validation failed.'] }); }
    finally { setChecking(false); }
  }

  const finalPlan = accepted ? attempts.find((attempt) => attempt.valid)?.plan : null;
  return <div className="lab10-page">
    <div className="lab2-hero"><span className="lab2-badge lab10-badge">10/50</span><div><div className="eyebrow">LAB 10 / OUTPUT CONTRACT</div><h1>Design an <em>output contract.</em></h1><p>Generate a study plan, check every field, and inspect one bounded repair when the answer misses the contract.</p></div></div>
    <section className="lab7-card"><span className="eyebrow">SAVED PRESET FROM LAB 07</span><h2>Use your tutor preset</h2><p>{agent ? <><strong>{agent.name}</strong> · {agent.model} · <code>{agent.id}</code></> : loading ? 'Loading saved agent…' : loadError || 'Waiting for a saved agent.'}</p>{!health?.configured ? <p>Add OPENAI_API_KEY to .env and restart the server for a live run. The validation playground below works without a key.</p> : null}<div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void loadAgent()} disabled={loading || running || !health?.configured}>Reload saved agent</button><button type="button" className="lab8-secondary" onClick={onOpenLab7}>Open Lab 07</button></div></section>
    <section className="lab7-card"><span className="eyebrow">STUDY PLAN FORM</span><h2>Set the request and its limits</h2><div className="lab10-form"><div><label htmlFor="lab10-topic">Topic</label><input id="lab10-topic" maxLength={120} value={topic} onChange={(event) => { setTopic(event.target.value); resetRun(); }} disabled={running} /></div><div><label htmlFor="lab10-goal">Learning goal</label><input id="lab10-goal" maxLength={300} value={goal} onChange={(event) => { setGoal(event.target.value); resetRun(); }} disabled={running} /></div><div><label htmlFor="lab10-days">Days</label><select id="lab10-days" value={days} onChange={(event) => { setDays(Number(event.target.value)); resetRun(); }} disabled={running}>{[3, 4, 5, 6, 7].map((value) => <option key={value} value={value}>{value}</option>)}</select></div><div><label htmlFor="lab10-minutes">Minutes per day</label><input id="lab10-minutes" type="number" min={15} max={120} value={minutesPerDay} onChange={(event) => { setMinutesPerDay(Number(event.target.value)); resetRun(); }} disabled={running} /></div></div><p className="lab8-note">Contract: title and goal; exactly {days} numbered days; each day has focus, activity, and 1–{minutesPerDay} minutes. Extra fields are rejected.</p><button type="button" className="lab7-primary" onClick={() => void run()} disabled={!agent || !health?.configured || running}>{running ? 'Generating and checking…' : 'Generate and validate plan'}</button><p className="lab7-session-status" role="status">{status}</p>{sessionId ? <p className="lab7-session-id">Session <code>{sessionId}</code></p> : null}{error ? <p className="lab2-error" role="alert">{error}</p> : null}</section>
    {streamText ? <section className="lab7-card"><h2>Current draft</h2><pre className="lab10-raw">{streamText}</pre></section> : null}
    {attempts.length > 0 ? <section className="lab7-card"><span className="eyebrow">VALIDATION EVIDENCE</span><h2>Inspect each attempt</h2><div className="lab10-attempts">{attempts.map((attempt) => <article key={attempt.attempt} className={attempt.valid ? 'lab10-valid' : 'lab10-invalid'}><h3>Attempt {attempt.attempt} · {attempt.valid ? 'Accepted' : 'Rejected'}</h3><p className="lab7-session-id">Turn <code>{attempt.turnId}</code></p>{attempt.errors.length ? <ul>{attempt.errors.map((message) => <li key={message}>{message}</li>)}</ul> : <p>All contract checks passed.</p>}<details><summary>Inspect raw answer</summary><pre className="lab10-raw">{attempt.raw || '(empty output)'}</pre></details></article>)}</div>{attempts.length === 1 && !attempts[0].valid && running ? <p role="status">The server is requesting one corrected answer in this session.</p> : null}{!running && !accepted ? <p role="alert">No plan was accepted. Review the errors and revise the request before another run.</p> : null}</section> : null}
    {finalPlan ? <section className="lab7-card lab10-plan"><span className="eyebrow">VALIDATED PLAN</span><h2>{finalPlan.title}</h2><p>{finalPlan.goal}</p><ol>{finalPlan.days.map((day) => <li key={day.day}><strong>Day {day.day}: {day.focus}</strong><p>{day.activity} · {day.minutes} minutes</p></li>)}</ol></section> : null}
    <section className="lab7-card"><span className="eyebrow">VALIDATION PLAYGROUND · NO API KEY NEEDED</span><h2>Make the contract fail, then fix it</h2><p>Load a sample or edit the JSON. The same server validator used for live output checks this text against the form limits above.</p><div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => { setSample(malformedSample); setSampleCheck(null); }}>Load malformed sample</button><button type="button" className="lab8-secondary" onClick={() => { setSample(validSample); setSampleCheck(null); }}>Load valid 3-day sample</button></div><label htmlFor="lab10-sample">Candidate JSON</label><textarea id="lab10-sample" className="lab10-sample" value={sample} onChange={(event) => { setSample(event.target.value); setSampleCheck(null); }} /><button type="button" className="lab7-primary" onClick={() => void validateSample()} disabled={checking}>{checking ? 'Checking…' : 'Validate candidate'}</button>{sampleCheck ? <div className={sampleCheck.valid ? 'lab10-check lab10-valid' : 'lab10-check lab10-invalid'} role="status"><strong>{sampleCheck.valid ? 'Accepted' : 'Rejected'}</strong>{sampleCheck.errors.length ? <ul>{sampleCheck.errors.map((message) => <li key={message}>{message}</li>)}</ul> : <p>All contract checks passed.</p>}</div> : null}</section>
    <section className="lab3-guide lab10-guide"><h2>Read the evidence</h2><div><article><strong>Instructions</strong><p>Specify the output shape and limits before the turn starts.</p></article><article><strong>Validation</strong><p>Check the completed text as untrusted data, including field types and day count.</p></article><article><strong>Repair</strong><p>Give precise errors to the same session once, then validate the replacement.</p></article><article><strong>Acceptance</strong><p>Only a passing object becomes the displayed study plan.</p></article></div></section>
    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 10</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind the contract</span><span className="code-lessons-hint">Four explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Follow the instructions, session override, validation, and repair steps. Viva voice reads each explanation through browser speech synthesis.</p><div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speakingLesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speakingLesson === lesson.number} aria-label={speakingLesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speakingLesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</button></article>)}</div></div></details>
    <section className="student-challenge"><strong>Try it yourself</strong><p>Validate the malformed sample and explain each error. Fix it, then generate a live plan. Change the day count and time budget; verify that the plan is accepted only when every entry meets the new contract.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>PRESET MODEL: {agent?.model || health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/configuration" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
