import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';

const initialInstructions = 'You are a friendly programming tutor. Answer clearly and concisely. When useful, include one short example. If you are unsure, say so.';
const lessons = [
  { number: '01', title: 'Start the session', file: 'server/index.ts',
    code: ["stream = await client.beta.agents.sessions.create({", "  agent: { ...agent, instructions },", "  environment: { type: 'none' },", "  input: prompt,", "  stream: true,", "});"].join('\n'),
    explanation: 'The first question creates a session with your chosen instructions. The server sends its session ID to React.' },
  { number: '02', title: 'Send a follow-up', file: 'server/index.ts',
    code: ["stream = await client.beta.agents.sessions.events.stream(sessionId);", "await client.beta.agents.sessions.events.create(sessionId, {", "  events: [{ type: 'agent.session.input.message',", "    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }]", "  }]", "});"].join('\n'),
    explanation: 'The server opens the event stream before sending the next message. Reusing the same session ID preserves conversation context.' },
  { number: '03', title: 'Change the instructions', file: 'src/Lab2.tsx',
    code: ["setActiveInstructions(draftInstructions.trim());", "sessionRef.current = '';", "setSessionId('');", "setMessages([]);"].join('\n'),
    explanation: 'Instructions cannot be changed on an existing session. Applying edits clears the local conversation so the next question starts a new session.' },
];

function codeTokens(tokens, prefix = '') {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = prefix + '-' + index;
    const content = typeof token.content === 'string'
      ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}

async function runTurn(payload, onEvent) {
  const response = await fetch('/api/lab2/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Request failed (' + response.status + ').');
  }
  if (!response.body) throw new Error('The browser could not read the response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const item = JSON.parse(line);
        if (item.type === 'error') throw new Error(item.message);
        if (item.type === 'complete') complete = true;
        onEvent(item);
      }
    }
    if (!complete) throw new Error('The stream ended before the turn completed.');
  } finally {
    reader.releaseLock();
  }
}

export default function Lab2({ active, feature, onFeatureChange, health }) {
  const [draftInstructions, setDraftInstructions] = useState(initialInstructions);
  const [activeInstructions, setActiveInstructions] = useState(initialInstructions);
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState('idle');
  const [statusText, setStatusText] = useState('');
  const [speakingLesson, setSpeakingLesson] = useState(null);
  const [voices, setVoices] = useState([]);
  const sessionRef = useRef('');
  const utteranceRef = useRef(null);
  const changedInstructions = draftInstructions.trim() !== activeInstructions;
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  useEffect(() => () => {
    if (speechAvailable) window.speechSynthesis.cancel();
    utteranceRef.current = null;
  }, [speechAvailable]);

  useEffect(() => {
    if (!speechAvailable) return undefined;
    const synthesis = window.speechSynthesis;
    const refreshVoices = () => setVoices(synthesis.getVoices());
    refreshVoices();
    synthesis.addEventListener('voiceschanged', refreshVoices);
    return () => synthesis.removeEventListener('voiceschanged', refreshVoices);
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
    const utterance = new SpeechSynthesisUtterance(lesson.title + '. ' + lesson.explanation);
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
    setPrompt('');
    setStatus('idle');
    setStatusText('');
  }

  function applyInstructions() {
    const next = draftInstructions.trim();
    if (!next || next.length > 4000 || status === 'running') return;
    setActiveInstructions(next);
    newConversation();
    setStatusText('Instructions applied. Your next question starts a new session.');
    onFeatureChange('conversation');
  }

  async function submit(event) {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || status === 'running' || changedInstructions) return;
    const replyId = crypto.randomUUID();
    const currentSessionId = sessionRef.current;
    setMessages((previous) => [
      ...previous,
      { id: crypto.randomUUID(), role: 'user', text: nextPrompt },
      { id: replyId, role: 'assistant', text: '', pending: true },
    ]);
    setPrompt('');
    setStatus('running');
    setStatusText(currentSessionId ? 'Sending a follow-up in the same session' : 'Creating your conversation');
    try {
      await runTurn({ prompt: nextPrompt, sessionId: currentSessionId, instructions: activeInstructions }, (item) => {
        if (item.type === 'session') {
          sessionRef.current = item.sessionId;
          setSessionId(item.sessionId);
        }
        if (item.type === 'status') setStatusText(item.label);
        if (item.type === 'text') setMessages((previous) => previous.map((message) =>
          message.id === replyId ? { ...message, text: item.text } : message));
        if (item.type === 'complete') setStatusText('Turn completed');
      });
      setMessages((previous) => previous.map((message) =>
        message.id === replyId ? { ...message, pending: false } : message));
      setStatus('complete');
    } catch (error) {
      setMessages((previous) => previous.map((message) =>
        message.id === replyId ? { ...message, pending: false, error: error.message } : message));
      setStatusText(error.message);
      setStatus('error');
    }
  }

  const turns = messages.filter((message) => message.role === 'user').length;
  const examples = sessionId
    ? ['Can you show a JavaScript example?', 'Explain that in simpler words.']
    : ['Explain what an API is in simple terms.', 'What is a JavaScript function?'];

  return (
    <div className="lab2-page">
      <div className="lab2-hero"><span className="lab2-badge">2/50</span><div><div className="eyebrow">LAB 02 / BEGINNER</div><h1>Keep the <em>conversation going.</em></h1><p>Ask a follow-up in the same session. Then change the tutor instructions and start a new conversation to compare its behavior.</p></div></div>
      <div className="lab2-tabs" aria-label="Lab 02 lessons">
        <button type="button" aria-pressed={feature === 'conversation'} className={feature === 'conversation' ? 'active' : ''} onClick={() => onFeatureChange('conversation')}>1 <span>Continue a conversation</span></button>
        <button type="button" aria-pressed={feature === 'instructions'} className={feature === 'instructions' ? 'active' : ''} onClick={() => onFeatureChange('instructions')}>2 <span>Customize instructions</span></button>
      </div>
      {feature === 'conversation' ? (
        <section className="lab2-lesson-note"><strong>Same session, more context</strong><p>Ask an opening question, then ask a follow-up such as “Can you show an example?” The second turn uses the same session ID and can refer to the first answer.</p><button type="button" onClick={() => onFeatureChange('instructions')}>Explore instructions →</button></section>
      ) : (
        <section className="lab2-instructions">
          <div className="lab2-panel-heading"><span className="lab2-step">02</span><div><h2>Customize the tutor</h2><p>Edit its role or response style, then apply the change to a new session.</p></div></div>
          <label htmlFor="lab2-instructions">AGENT INSTRUCTIONS</label>
          <textarea id="lab2-instructions" value={draftInstructions} maxLength={4000} onChange={(event) => setDraftInstructions(event.target.value)} />
          <div className="lab2-editor-footer"><span>{draftInstructions.length} / 4000 characters</span><div className="lab2-editor-actions"><button type="button" className="discard" onClick={() => setDraftInstructions(activeInstructions)} disabled={!changedInstructions || status === 'running'}>Discard edits</button><button type="button" onClick={applyInstructions} disabled={!changedInstructions || !draftInstructions.trim() || status === 'running'}>Apply & start new session →</button></div></div>
          <p className="lab2-editor-note">The current session keeps its original instructions. Applying changes clears the conversation below and creates a new session when you next ask a question.</p>
        </section>
      )}
      <section className="lab2-chat">
        <div className="lab2-chat-header"><div className="lab2-panel-heading"><span className="lab2-step blue">01</span><div><h2>Conversation workspace</h2><p>{sessionId ? 'Follow-ups reuse this session' : 'Your first question will create a session'}</p></div></div><button type="button" className="lab2-new" onClick={newConversation} disabled={status === 'running' || (!sessionId && messages.length === 0)}>New conversation</button></div>
        <div className="lab2-session-strip"><span className="status-dot" /> SESSION ID <code>{sessionId || 'Not started'}</code><span className="lab2-turn-count">{turns} turn{turns === 1 ? '' : 's'}</span></div>
        <div className="lab2-messages" aria-live="polite">
          {messages.length === 0 ? <div className="lab2-empty"><strong>Your conversation starts here</strong><p>Ask a question, wait for the answer, then ask a follow-up that refers to it.</p></div> : messages.map((message) => (
            <article key={message.id} className={'lab2-message ' + message.role}>
              <span>{message.role === 'user' ? 'YOU ASKED' : 'AGENT SAYS'}</span>
              {message.text ? <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{message.text}</ReactMarkdown></div> : null}
              {message.pending && !message.text ? <p>Thinking…</p> : null}
              {message.error ? <p className="lab2-error">{message.error}</p> : null}
            </article>
          ))}
        </div>
        <form onSubmit={submit} className="lab2-form">
          <label htmlFor="lab2-prompt">{sessionId ? 'YOUR FOLLOW-UP' : 'YOUR FIRST QUESTION'}</label>
          <textarea id="lab2-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} placeholder={sessionId ? 'Ask about the previous answer…' : 'Ask your programming tutor…'} />
          <div className="lab2-form-footer"><span>{prompt.length} / 2000 characters</span><button type="submit" disabled={!prompt.trim() || status === 'running' || changedInstructions}>{status === 'running' ? 'Running…' : sessionId ? 'Send follow-up →' : 'Start conversation →'}</button></div>
          {changedInstructions ? <p className="lab2-change-hint">Apply your instruction edits before sending a message.</p> : null}
          <div className="lab2-examples"><span>TRY A PROMPT</span>{examples.map((example) => <button type="button" key={example} onClick={() => setPrompt(example)}>{example}</button>)}</div>
        </form>
        {statusText ? <div className={'lab2-status ' + status}>{statusText}</div> : null}
      </section>
      <div className="lab2-compare"><article><span>CONTINUE</span><h3>Same session</h3><p>A follow-up uses the existing session ID. The tutor can use the conversation already saved in that session.</p><code>events.create(sessionId, …)</code></article><article><span>CUSTOMIZE</span><h3>New session</h3><p>Apply different instructions, clear the local conversation, and create a new session on the next question.</p><code>sessions.create with a new agent configuration</code></article></div>
      <details className="code-lessons lab2-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}>
        <summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 02</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind the conversation</span><span className="code-lessons-hint">Open three explained code snippets.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary>
        <div className="code-lessons-body"><div className="code-lessons-grid">{lessons.map((lesson) => (
          <article className="code-lesson" key={lesson.number}>
            <div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div>
            <pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.javascript))}</code></pre>
            <p>{lesson.explanation}</p>
            <button type="button" className={'viva-button' + (speakingLesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speakingLesson === lesson.number} aria-label={speakingLesson === lesson.number ? 'Stop reading ' + lesson.title : 'Read ' + lesson.title + ' explanation aloud'}>
              {speakingLesson === lesson.number
                ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
                : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
              <span>{speakingLesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span>
            </button>
          </article>
        ))}</div></div>
      </details>
      <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/sessions" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
    </div>
  );
}
