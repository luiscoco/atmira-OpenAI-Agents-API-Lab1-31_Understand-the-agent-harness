import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import { masculineVoiceName, selectNarratorVoice } from './speech.js';

const maxVisibleEvents = 120;
const lessons = [
  { number: '01', title: 'Capture each event', file: 'server/index.ts',
    code: ["for await (const event of stream) {", "  if (response.destroyed) break;", "  if (inspect) {", "    writeEvent(response, {", "      type: 'inspect',", "      event: { type: event.type, eventId: event.event_id || null }", "    });", "  }", "}"].join('\n'),
    explanation: 'The server reads the live stream in order. In Lab 03 it forwards an inspection record for each event, including its type and unique event ID. The full code also forwards session, turn, and item identifiers.' },
  { number: '02', title: 'Connect events to saved items', file: 'server/index.ts',
    code: ["const partKey = (event) =>", "  `${event.item_id}:${event.output_index}:${event.content_index}`;", "", "if (event.type === 'agent.session.turn.output_text.delta') {", "  const key = partKey(event);", "  parts.set(key, (parts.get(key) || '') + event.delta);", "}"].join('\n'),
    explanation: 'Several text updates can belong to the same saved item. The item ID connects those updates, while output and content indexes identify the exact text part being assembled.' },
  { number: '03', title: 'Read the root turn outcome', file: 'server/index.ts',
    code: ["if (event.type === 'agent.session.turn.completed'", "    && event.turn?.subagent_id == null) {", "  completed = true;", "  writeEvent(response, { type: 'complete' });", "  break;", "}"].join('\n'),
    explanation: 'A root turn completion event establishes success for that turn. Failed and cancelled turn events have different outcomes. A session idle event only says the session is waiting; it does not prove a turn succeeded.' },
  { number: '04', title: 'Show IDs in React', file: 'src/Lab3.tsx',
    code: ["if (item.type === 'inspect') {", "  const entry = item.event;", "  setEventCount((count) => count + 1);", "  setEvents((previous) =>", "    [...previous, entry].slice(-maxVisibleEvents));", "}"].join('\n'),
    explanation: 'React keeps the latest 120 events visible and counts every event received. It also retains unique root turn and saved item IDs for the whole local conversation.' },
];

function codeTokens(tokens, prefix = '') {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string'
      ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}

async function streamTurn(payload, onEvent) {
  const response = await fetch('/api/lab3/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  if (!response.body) throw new Error('The browser could not read the event stream.');
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
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const item = JSON.parse(line);
        onEvent(item);
        if (item.type === 'complete') completed = true;
        if (item.type === 'error') throw new Error(item.message);
      }
    }
    if (!completed) throw new Error('The stream ended before a turn outcome arrived.');
  } finally {
    reader.releaseLock();
  }
}

function IdField({ label, value }) {
  return <div className="lab3-id"><span>{label}</span><code title={value || undefined}>{value || 'Waiting for an event'}</code></div>;
}

export default function Lab3({ active, health }) {
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventCount, setEventCount] = useState(0);
  const [rootTurnIds, setRootTurnIds] = useState([]);
  const [savedItemIds, setSavedItemIds] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState('idle');
  const [sessionState, setSessionState] = useState('not observed');
  const [error, setError] = useState('');
  const [speakingLesson, setSpeakingLesson] = useState(null);
  const [voices, setVoices] = useState([]);
  const sessionRef = useRef('');
  const utteranceRef = useRef(null);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  useEffect(() => {
    if (!speechAvailable) return undefined;
    const synthesis = window.speechSynthesis;
    const refreshVoices = () => setVoices(synthesis.getVoices());
    refreshVoices();
    synthesis.addEventListener('voiceschanged', refreshVoices);
    return () => synthesis.removeEventListener('voiceschanged', refreshVoices);
  }, [speechAvailable]);

  useEffect(() => () => {
    if (speechAvailable) window.speechSynthesis.cancel();
    utteranceRef.current = null;
  }, [speechAvailable]);

  function stopSpeech() {
    utteranceRef.current = null;
    if (speechAvailable) window.speechSynthesis.cancel();
    setSpeakingLesson(null);
  }

  useEffect(() => {
    if (!active && utteranceRef.current) stopSpeech();
  }, [active]);

  function readLesson(lesson) {
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
      if (utteranceRef.current === utterance) {
        utteranceRef.current = null;
        setSpeakingLesson(null);
      }
    };
    utteranceRef.current = utterance;
    setSpeakingLesson(lesson.number);
    window.speechSynthesis.speak(utterance);
  }

  function newConversation() {
    sessionRef.current = '';
    setSessionId('');
    setMessages([]);
    setEvents([]);
    setEventCount(0);
    setRootTurnIds([]);
    setSavedItemIds([]);
    setPrompt('');
    setStatus('idle');
    setSessionState('not observed');
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || status === 'running') return;
    const replyId = crypto.randomUUID();
    setMessages((previous) => [
      ...previous,
      { id: crypto.randomUUID(), role: 'user', text: question },
      { id: replyId, role: 'assistant', text: '', pending: true },
    ]);
    setPrompt('');
    setStatus('running');
    setError('');
    try {
      await streamTurn({ prompt: question, sessionId: sessionRef.current,
        instructions: 'You are a friendly programming tutor. Answer clearly and concisely. When useful, include one short example. If you are unsure, say so.' }, (item) => {
        if (item.type === 'session') {
          sessionRef.current = item.sessionId;
          setSessionId(item.sessionId);
        }
        if (item.type === 'text') setMessages((previous) => previous.map((message) =>
          message.id === replyId ? { ...message, text: item.text } : message));
        if (item.type === 'inspect') {
          const entry = item.event;
          setEventCount((count) => count + 1);
          setEvents((previous) => [...previous, entry].slice(-maxVisibleEvents));
          if (entry.rootTurn && entry.turnId) setRootTurnIds((previous) => previous.includes(entry.turnId) ? previous : [...previous, entry.turnId]);
          if (entry.itemId) setSavedItemIds((previous) => previous.includes(entry.itemId) ? previous : [...previous, entry.itemId]);
          if (entry.sessionId && !sessionRef.current) {
            sessionRef.current = entry.sessionId;
            setSessionId(entry.sessionId);
          }
          if (entry.type === 'agent.session.idle') setSessionState('idle');
          else if (entry.type === 'agent.session.failed' || entry.type === 'agent.session.environment.failed') setSessionState('failed');
          else if (entry.type === 'agent.session.in_progress') setSessionState('in progress');
          if (entry.rootTurn && entry.type === 'agent.session.turn.failed') setStatus('failed');
          if (entry.rootTurn && entry.type === 'agent.session.turn.cancelled') setStatus('cancelled');
          if (entry.rootTurn && entry.type === 'agent.session.turn.completed') setStatus('completed');
        }
      });
      setMessages((previous) => previous.map((message) => message.id === replyId ? { ...message, pending: false } : message));
      setStatus('completed');
    } catch (caught) {
      setMessages((previous) => previous.map((message) => message.id === replyId ? { ...message, pending: false } : message));
      setError(caught.message);
      setStatus((previous) => previous === 'cancelled' || previous === 'failed' ? previous : 'failed');
    }
  }

  const latest = events.at(-1);
  const shownEvents = [...events].reverse();

  return <div className="lab3-page">
    <div className="lab2-hero"><span className="lab2-badge lab3-badge">3/50</span><div><div className="eyebrow">LAB 03 / BEGINNER</div><h1>Inspect the <em>lifecycle.</em></h1><p>Ask a question and watch the session, turn, events, and saved item IDs appear beside the conversation.</p></div></div>
    <div className="lab3-layout">
      <section className="lab2-chat lab3-chat">
        <div className="lab2-chat-header"><div><h2>Conversation</h2><p>Send a follow-up to see a second turn in the same session.</p></div><button type="button" className="lab2-new" onClick={newConversation} disabled={status === 'running' || !sessionId}>New conversation</button></div>
        <div className="lab2-messages" aria-live="polite">
          {messages.length === 0 ? <div className="lab2-empty"><strong>Start with a question</strong><p>The inspector will show live event IDs and the resulting turn outcome.</p></div> : messages.map((message) => <article key={message.id} className={'lab2-message ' + message.role}>
            <span>{message.role === 'user' ? 'YOU ASKED' : 'AGENT SAYS'}</span>
            {message.text ? <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{message.text}</ReactMarkdown></div> : null}
            {message.pending && !message.text ? <p>Thinking…</p> : null}
          </article>)}
        </div>
        <form onSubmit={submit} className="lab2-form"><label htmlFor="lab3-prompt">{sessionId ? 'YOUR FOLLOW-UP' : 'YOUR FIRST QUESTION'}</label><textarea id="lab3-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask your programming tutor…" /><div className="lab2-form-footer"><span>{prompt.length} / 2000 characters</span><button type="submit" disabled={!prompt.trim() || status === 'running'}>{status === 'running' ? 'Running…' : 'Send question →'}</button></div></form>
        {error ? <div className="lab2-status error" role="alert">{error}</div> : null}
      </section>
      <section className="lab3-inspector" aria-label="Event inspector">
        <div className="lab3-inspector-header"><div><span className="eyebrow">LIVE INSPECTOR</span><h2>What happened?</h2></div><span className={'lab3-state ' + status}>{status}</span></div>
        <div className="lab3-ids"><IdField label="SESSION ID" value={sessionId} /><IdField label="LATEST ROOT TURN ID" value={rootTurnIds.at(-1)} /><IdField label="LATEST EVENT ID" value={latest?.eventId} /><IdField label="LATEST SAVED ITEM ID" value={savedItemIds.at(-1)} /></div>
        <div className="lab3-state-line"><span>Observed session state: <strong>{sessionState}</strong></span><span>{rootTurnIds.length} turn ID{rootTurnIds.length === 1 ? '' : 's'} · {savedItemIds.length} item ID{savedItemIds.length === 1 ? '' : 's'}</span></div>
        <div className="lab3-event-heading"><h3>Event stream</h3><span>{eventCount} received{eventCount > shownEvents.length ? ` · latest ${shownEvents.length} shown` : ''}</span></div>
        <ol className="lab3-events">{shownEvents.length ? shownEvents.map((entry, index) => <li key={`${eventCount - index}-${entry.eventId || entry.type}`}><strong>{entry.type}</strong><dl><div><dt>event</dt><dd>{entry.eventId || '—'}</dd></div>{entry.turnId ? <div><dt>turn</dt><dd>{entry.turnId}</dd></div> : null}{entry.itemId ? <div><dt>item</dt><dd>{entry.itemId}</dd></div> : null}</dl></li>) : <li className="lab3-events-empty">Events appear here as the agent runs.</li>}</ol>
      </section>
    </div>
    <section className="lab3-guide"><h2>Read the evidence</h2><div><article><strong>Session</strong><p>The conversation container. A follow-up keeps its session ID.</p></article><article><strong>Turn</strong><p>One unit of agent work. A root turn’s completed, failed, or cancelled event determines its outcome.</p></article><article><strong>Event</strong><p>A live update with a unique event ID. Several events may refer to one item.</p></article><article><strong>Saved item</strong><p>An output or message identified by item ID. Text delta and done events can share it.</p></article></div><p className="lab3-guide-note">An idle session means it is waiting for input; it does not prove the previous turn succeeded. The observed state only reports events received while this page was connected.</p></section>
    <details className="code-lessons lab3-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}>
      <summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 03</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind the lifecycle inspector</span><span className="code-lessons-hint">Open four explained code snippets. Play each explanation with Viva voice.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary>
      <div className="code-lessons-body"><p className="code-lessons-intro">Follow the event from the server stream to the React inspector. Each excerpt points to the file you can edit.</p><div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}>
        <div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div>
        <pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.javascript))}</code></pre>
        <p>{lesson.explanation}</p>
        <button type="button" className={'viva-button' + (speakingLesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speakingLesson === lesson.number} aria-label={speakingLesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`} title={speechAvailable ? undefined : 'Read aloud is unavailable in this browser'}>
          {speakingLesson === lesson.number
            ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
            : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
          <span>{speakingLesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span>
        </button>
      </article>)}</div></div>
    </details>
    <section className="student-challenge"><strong>Try it yourself</strong><p>Ask “What is a JavaScript function?” and then “Show me an example.” Confirm that the session ID stays the same, the root turn ID changes, and each event has its own event ID.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/sessions/events" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
