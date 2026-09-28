import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';

const examples = [
  'Explain what an API is in simple terms.',
  'What is the difference between an agent and a chatbot?',
  'Give me a short JavaScript learning plan.',
];

const codeLessons = [
  {
    number: '01',
    title: 'Define the agent',
    file: 'server/index.ts',
    code: `const agent = {
  model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
  instructions:
    'You are a friendly programming tutor. Answer clearly and concisely. ' +
    'When useful, include one short example. If you are unsure, say so.',
};`,
    explanation: 'The model does the work. The instructions give it a role and describe how it should answer. Change the instructions to see how the same question gets a different response.',
  },
  {
    number: '02',
    title: 'Start a session',
    file: 'server/index.ts',
    code: `stream = await client.beta.agents.sessions.create({
  agent,
  environment: { type: 'none' },
  input: prompt,
  stream: true,
});`,
    explanation: 'The server sends your prompt as the first input. “none” means this question-answering tutor needs no file or command sandbox. Streaming lets the app show progress before the whole answer is finished.',
  },
  {
    number: '03',
    title: 'Forward the answer',
    file: 'server/index.ts',
    code: `if (event.type === 'agent.session.turn.output_text.delta') {
  const key = partKey(event);
  parts.set(key, (parts.get(key) || '') + event.delta);
  writeEvent(response, {
    type: 'text',
    text: [...parts.values()].join('\\n'),
  });
}`,
    explanation: 'A delta is one piece of the answer. The server adds it to the current text and forwards the updated answer to the browser. A completed-turn event tells the app when the run is done.',
  },
  {
    number: '04',
    title: 'Display it in React',
    file: 'src/Lab1.tsx',
    code: `await runAgent(nextPrompt, (item) => {
  if (item.type === 'text') {
    setAnswer(item.text);
    setMessage('Streaming response');
  }
});`,
    explanation: 'React updates the answer as text arrives. The response panel then renders that text as Markdown, so bold text, lists, and code are readable.',
  },
];

function renderCodeTokens(tokens, prefix = '') {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string'
      ? token.content
      : renderCodeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={`token ${token.type}`} key={key}>{content}</span>;
  });
}

async function runAgent(prompt, onEvent) {
  const response = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'complete') complete = true;
      onEvent(event);
    }
  }
  if (!complete) throw new Error('The stream ended before the agent completed its turn.');
}

export default function Lab1({ active, health }) {
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [speakingLesson, setSpeakingLesson] = useState(null);
  const [voices, setVoices] = useState([]);
  const utteranceRef = useRef(null);
  const speechAvailable = typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && 'SpeechSynthesisUtterance' in window;

  useEffect(() => () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
  }, []);

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

  function toggleSpeech(lesson) {
    if (!speechAvailable) return;
    if (speakingLesson === lesson.number) {
      stopSpeech();
      return;
    }

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

  async function submit(event) {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || status === 'running') return;
    setQuestion(nextPrompt);
    setAnswer('');
    setMessage('');
    setStatus('running');
    try {
      await runAgent(nextPrompt, (item) => {
        if (item.type === 'status') setMessage(item.label);
        if (item.type === 'text') {
          setAnswer(item.text);
          setMessage('Streaming response');
        }
        if (item.type === 'complete') setMessage('Turn completed');
      });
      setStatus('complete');
    } catch (error) {
      setMessage(error.message);
      setStatus('error');
    }
  }

  return (
    <div className="lab1-page">
          <div className="hero">
            <div className="hero-badge">1/50</div>
            <div className="hero-copy">
              <div className="eyebrow">LAB 01 <span className="eyebrow-separator">/</span> BEGINNER</div>
              <h1>Meet your <em>first agent.</em></h1>
              <p className="intro">Ask a programming question and watch your first agent run. This hands-on lab introduces the core ideas behind the OpenAI Agents API.</p>
            </div>
            <div className="api-banner"><strong>Agents API</strong><span>Agent · Session · Run</span></div>
          </div>

          <div className="lesson-grid">
            <section className="workspace card">
              <div className="card-header"><div><span className="section-icon">1</span><span className="card-title">Ask your agent</span></div><span className="card-tag">LIVE DEMO</span></div>
              <div className="agent-identity"><div className="agent-avatar">✳</div><div><strong>Programming Tutor</strong><span>Answers questions with clear, short examples</span></div><span className="agent-ready">● READY</span></div>
              <form onSubmit={submit}>
                <label htmlFor="prompt">YOUR PROMPT</label>
                <textarea id="prompt" maxLength={2000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask your agent anything about programming..." />
                <div className="form-footer"><span>{prompt.length} / 2000 characters</span><button type="submit" disabled={!prompt.trim() || status === 'running'}>{status === 'running' ? 'Running…' : 'Run agent'} <span>→</span></button></div>
              </form>
              <div className="examples"><span>TRY AN EXAMPLE</span><div>{examples.map((example) => <button key={example} type="button" onClick={() => setPrompt(example)}>{example} <span>↗</span></button>)}</div></div>
            </section>

            <section className="response card" aria-live="polite">
              <div className="card-header"><div><span className="section-icon response-icon">2</span><span className="card-title">See the response</span></div><span className={`response-state ${status}`}>{status === 'running' ? '● RUNNING' : status === 'complete' ? '● COMPLETE' : status === 'error' ? '● ERROR' : 'AWAITING INPUT'}</span></div>
              {question ? <div className="asked"><span>YOU ASKED</span><p>{question}</p></div> : null}
              {answer ? <div className="answer"><span>AGENT SAYS</span><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{answer}</ReactMarkdown></div></div> : status === 'idle' ? <div className="empty-state"><div className="empty-graphic">✳<span className="orbit orbit-one" /><span className="orbit orbit-two" /></div><strong>Your answer starts here</strong><p>Enter a prompt and run the agent to see its response appear in real time.</p></div> : null}
              {message ? <div className={`run-message ${status}`}><span>{status === 'running' ? '◌' : status === 'error' ? '!' : '✓'}</span>{message}</div> : null}
            </section>
          </div>

          <section className="learn-card">
            <div className="learn-heading"><span>✦</span><div><strong>Your learning progression</strong><p>Six steps in this first agent run</p></div></div>
            <div className="concepts">
              <div><b>1</b><strong>Define</strong><p>Give your agent a model and instructions.</p></div>
              <div><b>2</b><strong>Ask</strong><p>Write a prompt for the programming tutor.</p></div>
              <div><b>3</b><strong>Start</strong><p>Create a session with your first input.</p></div>
              <div><b>4</b><strong>Stream</strong><p>Follow text events as the agent works.</p></div>
              <div><b>5</b><strong>Read</strong><p>Inspect the answer and turn status.</p></div>
              <div><b>6</b><strong>Explore</strong><p>Try a new prompt to compare results.</p></div>
            </div>
          </section>
          <section className="code-row">
            <div className="code-card"><span className="code-label">Code example</span><strong>Set the environment for a run</strong><code>environment: {'{'} type: 'none' {'}'}</code></div>
            <div className="note-card"><span>When to use “none”</span><p>This tutor answers questions without files or shell commands, so it does not need a sandbox.</p></div>
          </section>
          <details className="code-lessons" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}>
            <summary className="code-lessons-toggle">
              <span className="code-lessons-heading">
                <span className="code-lessons-kicker">UNDER THE HOOD · LAB 01</span>
                <span className="code-lessons-title" role="heading" aria-level={2}>The code behind your first agent</span>
                <span className="code-lessons-hint">Open this section to view four explained code snippets.</span>
              </span>
              <span className="code-lessons-toggle-action" aria-hidden="true">
                <span className="show-label">View code</span><span className="hide-label">Hide code</span>
                <span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
              </span>
            </summary>
            <div className="code-lessons-body">
              <p className="code-lessons-intro">Follow these excerpts in order. They connect the agent you just used to the server and React code that make it work. Your API key stays in the server&apos;s <code>.env</code> file.</p>
              <div className="code-lessons-grid">
                {codeLessons.map((lesson) => (
                  <article className="code-lesson" key={lesson.number}>
                    <div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div>
                    <pre><code>{renderCodeTokens(Prism.tokenize(lesson.code, Prism.languages.javascript))}</code></pre>
                    <p>{lesson.explanation}</p>
                    <button
                      type="button"
                      className={`viva-button${speakingLesson === lesson.number ? ' is-speaking' : ''}`}
                      onClick={() => toggleSpeech(lesson)}
                      disabled={!speechAvailable}
                      aria-pressed={speakingLesson === lesson.number}
                      aria-label={speakingLesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}
                      title={speechAvailable ? undefined : 'Read aloud is unavailable in this browser'}
                    >
                      {speakingLesson === lesson.number
                        ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
                        : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
                      <span>{speakingLesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span>
                    </button>
                  </article>
                ))}
              </div>
              <div className="student-challenge"><strong>Try it yourself</strong><p>Change the agent instructions in <code>server/index.ts</code>, restart the app, and ask the same question again. What changed in the answer?</p></div>
            </div>
          </details>
          <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/quickstart" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
    </div>
  );
}
