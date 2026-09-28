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
type SessionResult = { id: string; answer: string; status: string; error: string };
type Slot = 'A' | 'B';
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };

const storageKey = 'agents-api-lab7-agent-id';
const emptySession = (): SessionResult => ({ id: '', answer: '', status: 'Not started', error: '' });
const lessons: Lesson[] = [
  { number: '01', title: 'Save a named tutor', file: 'server/lab7.ts',
    code: "const agent = await client().beta.agents.create({\n  name, model, instructions\n});\nsendJson(response, 201, { agent: summary(agent) });",
    explanation: 'The server creates one reusable agent configuration. The API returns an agent ID, which the app can use when it starts later sessions. The API key stays on the server.' },
  { number: '02', title: 'Retrieve the saved preset', file: 'server/lab7.ts',
    code: "const agent = await client().beta.agents.retrieve(agentId);\nsendJson(response, 200, { agent: summary(agent) });",
    explanation: 'The browser remembers only the agent ID. On reload, the server retrieves the current name, model, and instructions from the API, so the page can show the saved configuration again.' },
  { number: '03', title: 'Start each session with agent_id', file: 'server/lab7.ts',
    code: "stream = await client().beta.agents.sessions.create({\n  agent_id: body.agentId,\n  environment: { type: 'none' },\n  input: prompt,\n  stream: true,\n});",
    explanation: 'Both Run A and Run B create a new session with the same agent ID. They reuse the saved tutor settings but receive separate session IDs and separate conversation histories.' },
  { number: '04', title: 'Compare the evidence', file: 'src/Lab7.tsx',
    code: "const bothCompleted = sessions.A.status === 'Completed'\n  && sessions.B.status === 'Completed';\nconst separateSessions = Boolean(\n  sessions.A.id && sessions.B.id && sessions.A.id !== sessions.B.id\n);",
    explanation: 'The page displays the saved agent ID above both runs and the new session ID inside each result. Once both complete, two different session IDs prove that the preset was reused for independent conversations.' },
];

function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}

async function getJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

async function streamSavedAgent(agentId: string, prompt: string, onEvent: (event: RunEvent) => void) {
  const response = await fetch('/api/lab7/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId, prompt }),
  });
  if (!response.ok) {
    const body: unknown = await response.json();
    throw new Error(typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error : `Request failed (${response.status}).`);
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
  if (!completed) throw new Error('The stream ended before the turn completed. Check the saved session before retrying.');
}

export default function Lab7({ active, health }: { active: boolean; health: Health }) {
  const [name, setName] = useState('Programming Tutor Preset');
  const [instructions, setInstructions] = useState('You are a friendly programming tutor. Answer clearly and concisely. Include one short example when useful.');
  const [prompt, setPrompt] = useState('Explain what a TypeScript interface is in two sentences.');
  const [agent, setAgent] = useState<SavedAgent | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingAgent, setLoadingAgent] = useState(false);
  const [agentError, setAgentError] = useState('');
  const [sessions, setSessions] = useState<Record<Slot, SessionResult>>({ A: emptySession(), B: emptySession() });
  const [runningSlot, setRunningSlot] = useState<Slot | null>(null);
  const [speakingLesson, setSpeakingLesson] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const loadedRef = useRef(false);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  useEffect(() => {
    if (!active || loadedRef.current) return;
    loadedRef.current = true;
    const savedId = localStorage.getItem(storageKey);
    if (!savedId) return;
    setLoadingAgent(true);
    getJson<{ agent: SavedAgent }>('/api/lab7/agent?agentId=' + encodeURIComponent(savedId))
      .then((result) => { setAgent(result.agent); setName(result.agent.name); setInstructions(result.agent.instructions); })
      .catch((caught: unknown) => { setAgentError(caught instanceof Error ? caught.message : 'Could not load the saved agent.'); })
      .finally(() => setLoadingAgent(false));
  }, [active]);
  useEffect(() => {
    if (!speechAvailable) return;
    const synthesis = window.speechSynthesis;
    const refresh = () => setVoices(synthesis.getVoices());
    refresh();
    synthesis.addEventListener('voiceschanged', refresh);
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
    utterance.onend = utterance.onerror = () => {
      if (utteranceRef.current === utterance) { utteranceRef.current = null; setSpeakingLesson(null); }
    };
    utteranceRef.current = utterance;
    setSpeakingLesson(lesson.number);
    window.speechSynthesis.speak(utterance);
  }

  async function saveAgent() {
    if (saving || runningSlot) return;
    const nextName = name.trim();
    const nextInstructions = instructions.trim();
    if (!nextName || nextName.length > 80 || !nextInstructions || nextInstructions.length > 4000) {
      setAgentError('Enter a name (1–80 characters) and instructions (1–4,000 characters).');
      return;
    }
    setSaving(true); setAgentError('');
    try {
      const result = await getJson<{ agent: SavedAgent }>('/api/lab7/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName, instructions: nextInstructions }),
      });
      setAgent(result.agent);
      setSessions({ A: emptySession(), B: emptySession() });
      localStorage.setItem(storageKey, result.agent.id);
    } catch (caught) {
      setAgentError(caught instanceof Error ? caught.message : 'Could not save the agent.');
    } finally { setSaving(false); }
  }

  async function runSession(slot: Slot) {
    if (!agent || runningSlot) return;
    const nextPrompt = prompt.trim();
    if (!nextPrompt || nextPrompt.length > 2000) {
      setAgentError('Prompt must be between 1 and 2,000 characters.');
      return;
    }
    setAgentError(''); setRunningSlot(slot);
    setSessions((previous) => ({ ...previous, [slot]: { ...emptySession(), status: 'Starting session' } }));
    try {
      await streamSavedAgent(agent.id, nextPrompt, (event) => {
        setSessions((previous) => {
          const current = previous[slot];
          if (event.type === 'status') return { ...previous, [slot]: { ...current, status: event.label } };
          if (event.type === 'session') return { ...previous, [slot]: { ...current, id: event.sessionId } };
          if (event.type === 'text') return { ...previous, [slot]: { ...current, answer: event.text, status: 'Streaming answer' } };
          if (event.type === 'complete') return { ...previous, [slot]: { ...current, status: 'Completed' } };
          return previous;
        });
      });
    } catch (caught) {
      setSessions((previous) => ({ ...previous, [slot]: { ...previous[slot], status: 'Failed or interrupted', error: caught instanceof Error ? caught.message : 'Unknown error.' } }));
    } finally { setRunningSlot(null); }
  }

  const bothCompleted = sessions.A.status === 'Completed' && sessions.B.status === 'Completed';
  const separateSessions = Boolean(sessions.A.id && sessions.B.id && sessions.A.id !== sessions.B.id);

  return <div className="lab7-page">
    <div className="lab2-hero"><span className="lab2-badge lab7-badge">7/50</span><div><div className="eyebrow">LAB 07 / REUSABLE AGENTS</div><h1>Save and <em>reuse an agent.</em></h1><p>Create one named tutor preset, then use its agent ID to start two separate sessions.</p></div></div>
    <div className="lab7-layout">
      <section className="lab7-card"><span className="eyebrow">SAVED CONFIGURATION</span><h2>Your tutor preset</h2><p>Name and instructions are saved through the Agents API. Saving again creates a new preset with a new ID.</p><label htmlFor="lab7-name">Agent name</label><input id="lab7-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} disabled={saving || Boolean(runningSlot)} /><label htmlFor="lab7-instructions">Instructions</label><textarea id="lab7-instructions" value={instructions} maxLength={4000} onChange={(event) => setInstructions(event.target.value)} disabled={saving || Boolean(runningSlot)} /><button type="button" className="lab7-primary" onClick={saveAgent} disabled={saving || Boolean(runningSlot) || !health?.configured}>{saving ? 'Saving…' : agent ? 'Save as a new preset' : 'Save tutor preset'}</button>{!health?.configured ? <p className="lab5-panel-note">Add OPENAI_API_KEY to .env and restart the server to use the live API.</p> : null}{loadingAgent ? <p role="status">Retrieving saved agent…</p> : null}{agentError ? <p className="lab2-error" role="alert">{agentError}</p> : null}{agent ? <div className="lab7-saved" role="status"><strong>Saved agent</strong><dl><div><dt>ID</dt><dd><code>{agent.id}</code></dd></div><div><dt>Name</dt><dd>{agent.name}</dd></div><div><dt>Model</dt><dd>{agent.model}</dd></div></dl><p>This ID is remembered in this browser and retrieved from the API when you return.</p></div> : null}</section>
      <section className="lab7-card"><span className="eyebrow">TWO NEW SESSIONS</span><h2>Reuse the same agent</h2><label htmlFor="lab7-prompt">Question for both sessions</label><textarea id="lab7-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} disabled={Boolean(runningSlot)} /><p className="lab7-note">Each Run button starts a fresh session with <code>agent_id: {agent?.id || 'save a preset first'}</code>.</p><div className="lab7-runs">{(['A', 'B'] as const).map((slot) => <article className="lab7-session" key={slot}><div className="lab7-session-header"><h3>Session {slot}</h3><button type="button" onClick={() => runSession(slot)} disabled={!agent || !health?.configured || Boolean(runningSlot)}>{runningSlot === slot ? 'Running…' : `Run ${slot}`}</button></div><p className="lab7-session-status" role="status">{sessions[slot].status}</p>{sessions[slot].id ? <p className="lab7-session-id">Session ID <code>{sessions[slot].id}</code></p> : null}{sessions[slot].error ? <p className="lab2-error" role="alert">{sessions[slot].error}</p> : null}{sessions[slot].answer ? <div className="lab7-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{sessions[slot].answer}</ReactMarkdown></div> : <p className="lab7-empty">The streamed answer appears here.</p>}</article>)}</div>{bothCompleted ? <p className={separateSessions ? 'lab7-proof' : 'lab2-error'} role="status">{separateSessions ? 'Verified: two different session IDs use the saved agent above.' : 'The session IDs matched. Run a fresh session to verify reuse.'}</p> : null}</section>
    </div>
    <section className="lab3-guide lab7-guide"><h2>What is reused?</h2><div><article><strong>One saved agent</strong><p>Its name, model, and instructions live behind one agent ID.</p></article><article><strong>Fresh conversations</strong><p>Each new session copies the saved configuration and gets its own ID.</p></article><article><strong>Same question</strong><p>Ask both sessions the same prompt to inspect what the preset contributes.</p></article><article><strong>Saved identity</strong><p>The browser stores the ID and retrieves the preset after a reload.</p></article></div></section>
    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 07</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind reusable agents</span><span className="code-lessons-hint">Four explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Follow the saved agent from creation to two independent sessions. The browser never receives the API key.</p><div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speakingLesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speakingLesson === lesson.number} aria-label={speakingLesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speakingLesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</button></article>)}</div></div></details>
    <section className="student-challenge"><strong>Try it yourself</strong><p>Save a tutor preset, run A and B with the same question, and record the agent ID plus both session IDs. Reload the page and confirm the saved agent is retrieved. Explain why the two sessions do not share conversation history.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/configuration" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
