import { isValidElement, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { parseRunEvent, streamRun, type RunEvent, type RunRequest } from './lab6Protocol.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };

const lessons: Lesson[] = [
  { number: '01', title: 'Type the request and React state', file: 'src/Lab6.tsx',
    code: "type RunRequest = { prompt: string; instructions: string; sessionId?: string };\nconst [events, setEvents] = useState<RunEvent[]>([]);\nconst [sessionId, setSessionId] = useState<string | null>(null);",
    explanation: 'RunRequest describes what the browser sends. React state names the event list and nullable session ID explicitly, so the editor can catch invalid updates before the app runs.' },
  { number: '02', title: 'Check unknown data at the boundary', file: 'src/lab6Protocol.ts',
    code: "let raw: unknown = JSON.parse(line);\nconst event: RunEvent = parseRunEvent(raw);\nonEvent(event);",
    explanation: 'JSON and network responses can contain anything. Parse into unknown first, then validate the shape and required fields before treating a value as a typed event.' },
  { number: '03', title: 'Narrow the event union', file: 'src/Lab6.tsx',
    code: "if (event.type === 'session') setSessionId(event.sessionId);\nif (event.type === 'text') setAnswer(event.text);\nif (event.type === 'complete') setStatus('Completed');",
    explanation: 'The type field selects one event shape. Inside each branch, TypeScript knows exactly which property is available, so a text event cannot be mistaken for a session event.' },
  { number: '04', title: 'Typecheck before building', file: 'package.json',
    code: '"typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.lab6.json",\n"build": "npm run typecheck && vite build"',
    explanation: 'The typecheck script checks both the React pages and the Node server, then checks the teaching files again in strict mode. The build stops on a type error before Vite bundles the app. Runtime validation still protects data arriving from the network.' },
];

function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}

export function AnswerPre({ children }: React.ComponentProps<'pre'>) {
  if (!isValidElement<{ className?: string; children?: React.ReactNode }>(children)) {
    return <pre>{children}</pre>;
  }
  const source = String(children.props.children ?? '').replace(/\n$/, '');
  const declaredLanguage = /language-(typescript|ts|tsx|javascript|js|jsx)\b/i.exec(children.props.className || '')?.[1]?.toLowerCase();
  const looksLikeTypeScript = /:\s*(?:string|number|boolean|unknown|any)\b|\b(?:interface|enum|type)\s+[A-Za-z_$]/.test(source);
  const isTypeScript = declaredLanguage
    ? ['typescript', 'ts', 'tsx'].includes(declaredLanguage)
    : looksLikeTypeScript;
  const grammar = isTypeScript ? Prism.languages.typescript : Prism.languages.javascript;
  return <pre className="lab6-highlight"><code className={isTypeScript ? 'language-typescript' : 'language-javascript'}>{codeTokens(Prism.tokenize(source, grammar))}</code></pre>;
}

export default function Lab6({ active, health }: { active: boolean; health: Health }) {
  const [prompt, setPrompt] = useState('Explain TypeScript type narrowing with a short example.');
  const [answer, setAnswer] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [sample, setSample] = useState<'valid' | 'invalid'>('valid');
  const [speakingLesson, setSpeakingLesson] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const sampleJson = sample === 'valid' ? '{"type":"text","text":"Hello from a typed event"}' : '{"type":"text","message":"Missing text"}';
  let sampleResult: string;
  try { sampleResult = `Accepted: ${parseRunEvent(JSON.parse(sampleJson)).type} event`; }
  catch (caught) { sampleResult = caught instanceof Error ? caught.message : 'Invalid event'; }

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

  async function run() {
    if (running) return;
    const request: RunRequest = { prompt: prompt.trim(), instructions: 'You are a concise TypeScript tutor.' };
    if (!request.prompt || request.prompt.length > 2000) { setError('Prompt must be between 1 and 2,000 characters.'); return; }
    setRunning(true); setError(''); setAnswer(''); setEvents([]); setStatus('Starting session'); setSessionId(null);
    try {
      await streamRun(request, (event) => {
        setEvents((previous) => [...previous, event]);
        if (event.type === 'status') setStatus(event.label);
        if (event.type === 'session') setSessionId(event.sessionId);
        if (event.type === 'text') { setAnswer(event.text); setStatus('Streaming answer'); }
        if (event.type === 'complete') setStatus('Completed');
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unknown error.');
      setStatus('Failed or interrupted');
    } finally { setRunning(false); }
  }

  return <div className="lab6-page">
    <div className="lab2-hero"><span className="lab2-badge lab6-badge">6/50</span><div><div className="eyebrow">LAB 06 / TYPESCRIPT</div><h1>Make the app <em>typed.</em></h1><p>Trace a typed tutor request from React to the server and validate streamed events before displaying them.</p></div></div>
    <div className="lab6-layout">
      <section className="lab6-panel"><span className="eyebrow">LIVE TYPED RUN</span><h2>Ask the tutor</h2><label htmlFor="lab6-prompt">Your question</label><textarea id="lab6-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} disabled={running} /><button type="button" className="lab6-run" onClick={run} disabled={running || !health?.configured}>{running ? 'Running…' : 'Run typed request'}</button>{!health?.configured ? <p className="lab5-panel-note">Add OPENAI_API_KEY to .env and restart the server to run a live request.</p> : null}<p role="status">Status: {status}</p>{sessionId ? <p className="lab6-session">Session <code>{sessionId}</code></p> : null}{error ? <p className="lab2-error" role="alert">{error}</p> : null}<div className="lab6-answer"><strong>Answer</strong>{answer ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{answer}</ReactMarkdown> : <p>The streamed answer appears here.</p>}</div><details><summary>Validated event types ({events.length})</summary><ol>{events.map((event, index) => <li key={index}><code>{event.type}</code></li>)}</ol></details></section>
      <aside className="lab6-panel"><span className="eyebrow">RUNTIME BOUNDARY</span><h2>Try a malformed event</h2><p>TypeScript checks code at build time. This validator checks JSON received at runtime.</p><div className="lab6-samples"><button type="button" aria-pressed={sample === 'valid'} onClick={() => setSample('valid')}>Valid event</button><button type="button" aria-pressed={sample === 'invalid'} onClick={() => setSample('invalid')}>Missing text</button></div><pre><code>{sampleJson}</code></pre><p className={sample === 'invalid' ? 'lab2-error' : 'lab5-notice'} role="status">{sampleResult}</p><div className="lab6-type-map"><div><code>RunRequest</code><span>Browser → server</span></div><div><code>unknown</code><span>Raw JSON boundary</span></div><div><code>RunEvent</code><span>Validated UI event</span></div></div></aside>
    </div>
    <section className="lab3-guide"><h2>What TypeScript protects</h2><div><article><strong>React state</strong><p>State types make invalid UI updates visible while editing.</p></article><article><strong>Requests</strong><p>A request type keeps the prompt and instructions together.</p></article><article><strong>Stream events</strong><p>A discriminated union connects each event type to its own fields.</p></article><article><strong>Runtime inputs</strong><p>Validation checks actual JSON and rejects malformed events.</p></article></div></section>
    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 06</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind the TypeScript migration</span><span className="code-lessons-hint">Open four explained snippets. Play each explanation with Viva voice.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Read how types and runtime checks work together. Each snippet names the file students can edit.</p><div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speakingLesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speakingLesson === lesson.number} aria-label={speakingLesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speakingLesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</button></article>)}</div></div></details>
    <section className="student-challenge"><strong>Try it yourself</strong><p>Run <code>npm run typecheck</code>. Change a <code>text</code> event to use <code>message</code> in <code>src/lab6Protocol.ts</code>, observe the type error, and undo the change. Then select “Missing text” above and explain why runtime validation is still needed.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/sessions/events" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
