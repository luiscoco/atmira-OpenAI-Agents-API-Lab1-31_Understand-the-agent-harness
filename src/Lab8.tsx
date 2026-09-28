import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { AnswerPre } from './Lab6.tsx';
import { parseRunEvent, type RunEvent } from './lab6Protocol.ts';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';

type Health = { configured: boolean; model: string } | null;
type SavedAgent = { id: string; name: string; model: string; instructions: string };
type Mode = 'baseline' | 'override';
type Result = { id: string; answer: string; status: string; error: string };
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
const storageKey = 'agents-api-lab7-agent-id';
const emptyResult = (): Result => ({ id: '', answer: '', status: 'Not started', error: '' });
const lessons: Lesson[] = [
  { number: '01', title: 'Load the saved agent', file: 'src/Lab8.tsx',
    code: "const savedId = localStorage.getItem(storageKey);\nconst { agent } = await getJson<{ agent: SavedAgent }>(\n  '/api/lab7/agent?agentId=' + encodeURIComponent(savedId)\n);",
    explanation: 'Lab 08 uses the agent saved in Lab 07. Retrieving it displays the preset name, model, and base instructions before the comparison begins.' },
  { number: '02', title: 'Create a baseline session', file: 'server/lab8.ts',
    code: "await client().beta.agents.sessions.create({\n  agent_id: agentId,\n  environment: { type: 'none' },\n  input: prompt,\n  stream: true,\n});",
    explanation: 'The baseline passes only the saved agent ID. The session inherits its model and instructions without a session-specific change.' },
  { number: '03', title: 'Add an override to one session', file: 'server/lab8.ts',
    code: "await client().beta.agents.sessions.create({\n  agent_id: agentId,\n  agent: { instructions },\n  environment: { type: 'none' },\n  input: prompt,\n  stream: true,\n});",
    explanation: 'The second session adds instructions alongside the same agent ID. These instructions are appended to the saved agent instructions for this session. The saved agent itself is not updated.' },
  { number: '04', title: 'Verify the saved preset', file: 'src/Lab8.tsx',
    code: "const { agent: after } = await getJson<{ agent: SavedAgent }>(\n  '/api/lab7/agent?agentId=' + encodeURIComponent(agent.id)\n);\nconst unchanged = after.instructions === agent.instructions;",
    explanation: 'Retrieve the saved agent again after both sessions. Compare its ID, model, name, and instructions with the snapshot from before the runs. The distinct session IDs show separate conversations.' },
];

function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : `Request failed (${response.status}).`);
  return body as T;
}

async function streamSession(agentId: string, prompt: string, mode: Mode, instructions: string, onEvent: (event: RunEvent) => void) {
  const response = await fetch('/api/lab8/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, prompt, mode, ...(mode === 'override' ? { instructions } : {}) }),
  });
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
        const event = parseRunEvent(raw);
        onEvent(event);
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'complete') completed = true;
      }
    }
  } finally { reader.releaseLock(); }
  if (!completed) throw new Error('The stream ended before the turn completed. Check saved state before retrying.');
}

export default function Lab8({ active, health, onOpenLab7 }: { active: boolean; health: Health; onOpenLab7: () => void }) {
  const [agent, setAgent] = useState<SavedAgent | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [prompt, setPrompt] = useState('Explain what a TypeScript interface is.');
  const [instructions, setInstructions] = useState('Answer in Spanish. Include one short TypeScript example.');
  const [results, setResults] = useState<Record<Mode, Result>>({ baseline: emptyResult(), override: emptyResult() });
  const [running, setRunning] = useState<Mode | null>(null);
  const [verification, setVerification] = useState<'idle' | 'checking' | 'unchanged' | 'changed'>('idle');
  const [verifyError, setVerifyError] = useState('');
  const [speakingLesson, setSpeakingLesson] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  async function loadAgent() {
    const savedId = localStorage.getItem(storageKey);
    if (!savedId) { setAgent(null); setLoadError('Create and save a tutor preset in Lab 07 first.'); return; }
    setLoading(true); setLoadError('');
    try {
      const { agent: loaded } = await getJson<{ agent: SavedAgent }>('/api/lab7/agent?agentId=' + encodeURIComponent(savedId));
      setAgent(loaded);
      setResults({ baseline: emptyResult(), override: emptyResult() });
      setVerification('idle');
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
    const question = prompt.trim();
    const override = instructions.trim();
    if (!question || question.length > 2000 || (mode === 'override' && (!override || override.length > 4000))) {
      setResults((previous) => ({ ...previous, [mode]: { ...emptyResult(), status: 'Invalid input', error: 'Enter a question (1–2,000 characters) and override instructions (1–4,000 characters).' } }));
      return;
    }
    setRunning(mode); setVerification('idle'); setVerifyError('');
    setResults((previous) => ({ ...previous, [mode]: { ...emptyResult(), status: 'Starting session' } }));
    try {
      await streamSession(agent.id, question, mode, override, (event) => {
        setResults((previous) => {
          const current = previous[mode];
          if (event.type === 'status') return { ...previous, [mode]: { ...current, status: event.label } };
          if (event.type === 'session') return { ...previous, [mode]: { ...current, id: event.sessionId } };
          if (event.type === 'text') return { ...previous, [mode]: { ...current, answer: event.text, status: 'Streaming answer' } };
          if (event.type === 'complete') return { ...previous, [mode]: { ...current, status: 'Completed' } };
          return previous;
        });
      });
    } catch (caught) {
      setResults((previous) => ({ ...previous, [mode]: { ...previous[mode], status: 'Failed or interrupted', error: caught instanceof Error ? caught.message : 'Unknown error.' } }));
    } finally { setRunning(null); }
  }

  async function verify() {
    if (!agent) return;
    setVerification('checking'); setVerifyError('');
    try {
      const { agent: after } = await getJson<{ agent: SavedAgent }>('/api/lab7/agent?agentId=' + encodeURIComponent(agent.id));
      setVerification(after.id === agent.id && after.name === agent.name && after.model === agent.model && after.instructions === agent.instructions ? 'unchanged' : 'changed');
    } catch (caught) { setVerification('idle'); setVerifyError(caught instanceof Error ? caught.message : 'Could not retrieve the agent.'); }
  }

  const bothCompleted = results.baseline.status === 'Completed' && results.override.status === 'Completed';
  const separateSessions = Boolean(results.baseline.id && results.override.id && results.baseline.id !== results.override.id);
  return <div className="lab8-page">
    <div className="lab2-hero"><span className="lab2-badge lab8-badge">8/50</span><div><div className="eyebrow">LAB 08 / SESSION OVERRIDES</div><h1>Override <em>one session.</em></h1><p>Compare a saved tutor preset with a new session that adds one instruction.</p></div></div>
    <div className="lab8-setup lab7-card"><span className="eyebrow">SAVED PRESET FROM LAB 07</span><h2>Start from the same agent</h2>{agent ? <><p><strong>{agent.name}</strong> · Model: {agent.model}</p><p className="lab8-id">Agent ID <code>{agent.id}</code></p><details><summary>Saved base instructions</summary><p className="lab8-saved-instructions">{agent.instructions || '(none)'}</p></details></> : <p>{loading ? 'Loading your saved agent…' : loadError || 'Waiting for your saved agent.'}</p>}{!health?.configured ? <p>Add OPENAI_API_KEY to .env and restart the server to use the live API.</p> : null}<div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void loadAgent()} disabled={loading || Boolean(running) || !health?.configured}>{loading ? 'Loading…' : 'Reload saved agent'}</button><button type="button" className="lab8-secondary" onClick={onOpenLab7}>Open Lab 07 to save a preset</button></div></div>
    <div className="lab8-controls lab7-card"><span className="eyebrow">ONE QUESTION, TWO CONFIGURATIONS</span><label htmlFor="lab8-prompt">Question for both sessions</label><textarea id="lab8-prompt" maxLength={2000} value={prompt} onChange={(event) => { setPrompt(event.target.value); setResults({ baseline: emptyResult(), override: emptyResult() }); setVerification('idle'); }} disabled={Boolean(running)} /><label htmlFor="lab8-instructions">Instruction added only to the override session</label><textarea id="lab8-instructions" maxLength={4000} value={instructions} onChange={(event) => { setInstructions(event.target.value); setResults({ baseline: emptyResult(), override: emptyResult() }); setVerification('idle'); }} disabled={Boolean(running)} /><p className="lab8-note">The Agents API appends these instructions to the saved agent's base instructions for the second session.</p></div>
    <div className="lab8-results">{(['baseline', 'override'] as const).map((mode) => <section className="lab7-card" key={mode}><span className="eyebrow">{mode === 'baseline' ? 'SESSION A · SAVED SETTINGS' : 'SESSION B · SESSION OVERRIDE'}</span><h2>{mode === 'baseline' ? 'Baseline' : 'With extra instructions'}</h2><p className="lab8-request">{mode === 'baseline' ? 'agent_id only' : 'agent_id + agent.instructions'}</p><button type="button" className="lab7-primary" onClick={() => void run(mode)} disabled={!agent || !health?.configured || Boolean(running)}>{running === mode ? 'Running…' : mode === 'baseline' ? 'Run baseline' : 'Run override'}</button><p className="lab7-session-status" role="status">{results[mode].status}</p>{results[mode].id ? <p className="lab7-session-id">Session ID <code>{results[mode].id}</code></p> : null}{results[mode].error ? <p className="lab2-error" role="alert">{results[mode].error}</p> : null}<div className="lab7-answer">{results[mode].answer ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{results[mode].answer}</ReactMarkdown> : <p className="lab7-empty">The streamed answer appears here.</p>}</div></section>)}</div>
    <section className="lab8-verify lab7-card"><span className="eyebrow">VERIFY THE RESULT</span><h2>Did the saved agent change?</h2><p>After both runs, retrieve the agent again and compare its saved fields with the snapshot above.</p><button type="button" className="lab7-primary" onClick={() => void verify()} disabled={!agent || !bothCompleted || !separateSessions || verification === 'checking' || Boolean(running)}>{verification === 'checking' ? 'Checking…' : 'Verify saved preset'}</button>{bothCompleted ? <p className={separateSessions ? 'lab7-proof' : 'lab2-error'} role="status">{separateSessions ? 'Both runs completed with different session IDs and the same agent ID.' : 'Session IDs matched. Run fresh sessions to compare.'}</p> : null}{verification === 'unchanged' ? <p className="lab7-proof" role="status">Verified: the saved name, model, and instructions are unchanged. The override applied only to Session B.</p> : null}{verification === 'changed' ? <p className="lab2-error" role="alert">The saved agent changed since it was loaded. Reload it and repeat the comparison.</p> : null}{verifyError ? <p className="lab2-error" role="alert">{verifyError}</p> : null}<p className="lab8-note">Answer wording can vary between runs. The API requests and retrieved preset provide the configuration evidence.</p></section>
    <section className="lab3-guide lab8-guide"><h2>What changed?</h2><div><article><strong>Saved agent</strong><p>One agent ID still points to the same name, model, and base instructions.</p></article><article><strong>Session A</strong><p>Uses the saved configuration without an override.</p></article><article><strong>Session B</strong><p>Appends your extra instruction to the base instructions.</p></article><article><strong>Conversation state</strong><p>Each new session has a distinct ID and history.</p></article></div></section>
    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 08</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind session overrides</span><span className="code-lessons-hint">Four explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">See how the same saved agent produces a baseline session and a session with appended instructions. Viva voice reads each explanation with browser speech synthesis.</p><div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speakingLesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speakingLesson === lesson.number} aria-label={speakingLesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speakingLesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</button></article>)}</div></div></details>
    <section className="student-challenge"><strong>Try it yourself</strong><p>Run both sessions with the same question. Record the agent ID, two session IDs, and the verification result. Change the extra instruction to request a numbered list, then run a new override session. Explain which configuration remains saved.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/configuration" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
