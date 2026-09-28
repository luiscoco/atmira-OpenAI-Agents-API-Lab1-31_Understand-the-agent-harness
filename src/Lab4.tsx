import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';

type RunError = Error & { kind?: string; noTurnStarted?: boolean };

const lessons = [
  { number: '01', title: 'Recognize the outcome', file: 'server/lab4.ts',
    code: ["if (event.type === 'agent.session.turn.completed'", "    && event.turn?.subagent_id == null) {", "  writeEvent(response, { type: 'outcome', outcome: 'completed' });", "} else if (event.type === 'agent.session.turn.failed'", "    && event.turn?.subagent_id == null) {", "  writeEvent(response, { type: 'outcome', outcome: 'failed' });", "}"],
    explanation: 'The server follows the turn outcome event. Completion, failure, and cancellation are distinct. A closed stream by itself cannot establish that the turn succeeded.' },
  { number: '02', title: 'Detect a broken stream', file: 'src/Lab4.tsx',
    code: ["if (!outcome) {", "  const error = new Error('The stream ended before a turn outcome arrived.');", "  error.kind = 'disconnect';", "  throw error;", "}"],
    explanation: 'The browser treats a stream that ends before an outcome as uncertain. In the simulated disconnect exercise, the agent may still be working after the browser stops receiving events.' },
  { number: '03', title: 'Retrieve saved state', file: 'server/lab4.ts',
    code: ["const [session, turnPage, itemPage] = await Promise.all([", "  api.beta.agents.sessions.retrieve(sessionId),", "  api.beta.agents.sessions.turns.list(sessionId, { order: 'desc', limit: 20 }),", "  api.beta.agents.sessions.items.list(sessionId, { order: 'asc', limit: 100 }),", "]);"],
    explanation: 'Before retrying, the server retrieves the session status, recent turn outcomes, and saved messages. This check can reveal a completed answer even when its final stream event was missed.' },
  { number: '04', title: 'Request cancellation', file: 'server/lab4.ts',
    code: ["await client().beta.agents.sessions.events.create(sessionId, {", "  events: [{ type: 'agent.session.input.cancel' }],", "});"],
    explanation: 'The Cancel button sends a cancellation input to the active session. The request itself is not the final outcome; the app still waits for the turn cancelled event or retrieves saved state.' },
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

async function streamTurn(payload, onEvent) {
  const response = await fetch('/api/lab4/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json();
    const error: RunError = new Error(body.error || 'Request failed (' + response.status + ').');
    error.kind = 'api';
    error.noTurnStarted = Boolean(body.simulated);
    throw error;
  }
  if (!response.body) {
    const error: RunError = new Error('The browser could not read the response stream.');
    error.kind = 'disconnect';
    throw error;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outcome = null;
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
        if (item.type === 'outcome') outcome = item;
        if (item.type === 'error') {
          const error: RunError = new Error(item.message);
          error.kind = item.kind || 'api';
          throw error;
        }
      }
    }
    if (!outcome) {
      const error: RunError = new Error('The stream ended before a turn outcome arrived.');
      error.kind = 'disconnect';
      throw error;
    }
    return outcome;
  } finally {
    reader.releaseLock();
  }
}

async function getJson(url, options?: RequestInit) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed (' + response.status + ').');
  return body;
}

export default function Lab4({ active, health }) {
  const [sessionId, setSessionId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [scenario, setScenario] = useState('normal');
  const [lastPrompt, setLastPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [runState, setRunState] = useState('idle');
  const [message, setMessage] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [recoveryError, setRecoveryError] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [noTurnStarted, setNoTurnStarted] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [speakingLesson, setSpeakingLesson] = useState(null);
  const [voices, setVoices] = useState([]);
  const sessionRef = useRef('');
  const utteranceRef = useRef(null);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const latestTurn = recovery?.turns?.[0];
  const turnActive = latestTurn && ['queued', 'in_progress', 'waiting'].includes(latestTurn.status);
  const canRetry = Boolean(lastPrompt && runState !== 'running' && (
    !sessionId ? ['api_error', 'failed'].includes(runState) :
      recovery && !reviewRequired && !turnActive && recovery.session.status === 'idle'
      && (noTurnStarted || ['failed', 'cancelled'].includes(latestTurn?.status))
  ));
  const canAsk = runState !== 'running' && !reviewRequired && !turnActive
    && (!recovery || recovery.session.status === 'idle')
    && !['failed', 'cancelled', 'disconnected'].includes(runState);

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
    if (runState === 'running') return;
    sessionRef.current = '';
    setSessionId('');
    setPrompt('');
    setLastPrompt('');
    setAnswer('');
    setRunState('idle');
    setMessage('');
    setRecovery(null);
    setRecoveryError('');
    setReviewRequired(false);
    setNoTurnStarted(false);
    setScenario('normal');
  }

  async function run(question, selectedScenario = 'normal') {
    setLastPrompt(question);
    setAnswer('');
    setMessage('Waiting for the turn outcome…');
    setRunState('running');
    setRecovery(null);
    setRecoveryError('');
    setReviewRequired(false);
    setNoTurnStarted(false);
    setCancelPending(false);
    try {
      const outcome = await streamTurn({ prompt: question, sessionId: sessionRef.current, scenario: selectedScenario }, (item) => {
        if (item.type === 'session') {
          sessionRef.current = item.sessionId;
          setSessionId(item.sessionId);
        }
        if (item.type === 'text') setAnswer(item.text);
      });
      setRunState(outcome.outcome);
      setNoTurnStarted(Boolean(outcome.simulated));
      setMessage(outcome.message || 'The root turn ' + outcome.outcome + '.');
      if (outcome.outcome !== 'completed' && sessionRef.current) setReviewRequired(true);
    } catch (error) {
      setRunState(error.kind === 'disconnect' ? 'disconnected' : 'api_error');
      setNoTurnStarted(Boolean(error.noTurnStarted));
      setMessage(error.message);
      if (sessionRef.current) setReviewRequired(true);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || !canAsk) return;
    setPrompt('');
    await run(question, scenario);
  }

  async function cancelTurn() {
    if (!sessionRef.current || runState !== 'running' || cancelPending) return;
    setCancelPending(true);
    try {
      await getJson('/api/lab4/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionRef.current }),
      });
      setMessage('Cancellation requested. Waiting for the turn outcome…');
    } catch (error) {
      setMessage('Cancellation request failed: ' + error.message);
      setCancelPending(false);
    }
  }

  async function recover() {
    if (!sessionRef.current || recovering) return;
    setRecovering(true);
    setRecoveryError('');
    try {
      const saved = await getJson('/api/lab4/recover?sessionId=' + encodeURIComponent(sessionRef.current));
      setRecovery(saved);
      setReviewRequired(false);
      const latest = saved.turns[0];
      if (noTurnStarted) {
        setMessage('The simulated API error started no new turn. The saved state above belongs to earlier work.');
      } else if (latest?.status === 'completed') {
        const savedAnswer = [...saved.items].reverse().find((item) => item.role === 'assistant' && item.turnId === latest.id && item.text);
        if (savedAnswer) setAnswer(savedAnswer.text);
        setRunState('completed');
        setMessage('Saved state shows that the turn completed. The answer was recovered from saved items.');
      } else if (latest?.status === 'cancelled' || latest?.status === 'failed') {
        setRunState(latest.status);
        setMessage(latest.error || 'Saved state shows that the turn ' + latest.status + '.');
      } else {
        setMessage('Saved state retrieved. The latest turn is still ' + (latest?.status || 'unknown') + '; refresh before retrying.');
      }
    } catch (error) {
      setRecoveryError(error.message);
    } finally {
      setRecovering(false);
    }
  }

  return <div className="lab4-page">
    <div className="lab2-hero"><span className="lab2-badge lab4-badge">4/50</span><div><div className="eyebrow">LAB 04 / BEGINNER</div><h1>Handle <em>interrupted work.</em></h1><p>See API errors, failed or cancelled turns, and a dropped stream. Retrieve saved state before deciding whether to retry.</p></div></div>
    <div className="lab4-layout">
      <section className="lab2-chat lab4-workspace">
        <div className="lab2-chat-header"><div><h2>Run a tutor turn</h2><p>{sessionId ? 'Session ' + sessionId : 'A new session starts with your first question.'}</p></div><button type="button" className="lab2-new" onClick={newConversation} disabled={runState === 'running'}>New conversation</button></div>
        <div className="lab4-scenarios"><label htmlFor="lab4-scenario">TRY A CASE</label><select id="lab4-scenario" value={scenario} onChange={(event) => setScenario(event.target.value)} disabled={runState === 'running'}><option value="normal">Normal run</option><option value="api_error">Simulated API error</option><option value="turn_failure">Simulated turn failure</option><option value="disconnect">Simulated stream disconnect</option></select><p>The API error, turn failure, and disconnect options are teaching simulations. Cancel sends a real cancellation request during a live turn.</p></div>
        <form onSubmit={submit} className="lab2-form"><label htmlFor="lab4-prompt">YOUR QUESTION</label><textarea id="lab4-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} placeholder="Explain what a JavaScript promise is…" /><div className="lab2-form-footer"><span>{prompt.length} / 2000 characters</span><div className="lab4-actions"><button type="submit" disabled={!prompt.trim() || !canAsk}>{runState === 'running' ? 'Running…' : 'Run turn →'}</button><button type="button" className="lab4-cancel" onClick={cancelTurn} disabled={runState !== 'running' || !sessionId || cancelPending}>{cancelPending ? 'Cancel requested' : 'Cancel turn'}</button></div></div></form>
        {answer ? <div className="lab4-answer"><strong>AGENT ANSWER</strong><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{answer}</ReactMarkdown></div></div> : null}
      </section>
      <aside className="lab4-recovery" aria-label="Error and recovery panel">
        <div className="lab4-recovery-header"><span className="eyebrow">RECOVERY PANEL</span><h2>Check what was saved</h2><span className={'lab3-state ' + (runState === 'api_error' || runState === 'disconnected' ? 'failed' : runState)}>{runState.replace('_', ' ')}</span></div>
        <p className="lab4-message" role="status">{message || 'Run a turn to see its outcome here.'}</p>
        {sessionId ? <p className="lab4-session">SESSION ID <code>{sessionId}</code></p> : null}
        {reviewRequired ? <div className="lab4-review-note"><strong>Outcome needs verification</strong><p>Retrieve the session, recent turns, and saved messages before another turn. A dropped stream may hide a completed answer.</p></div> : null}
        {!sessionId && ['api_error', 'failed'].includes(runState) ? <div className="lab4-review-note"><strong>No session was created</strong><p>This simulation did not start a remote turn. You can retry the prompt as a new request.</p></div> : null}
        {sessionId && runState !== 'running' ? <button type="button" className="lab4-recover-button" onClick={recover} disabled={recovering}>{recovering ? 'Retrieving…' : recovery ? 'Refresh saved state' : 'Retrieve saved state'}</button> : null}
        {recoveryError ? <p className="lab2-error" role="alert">{recoveryError}</p> : null}
        {recovery ? <div className="lab4-saved"><div><span>SESSION STATUS</span><strong>{recovery.session.status}</strong></div><div><span>LATEST TURN</span><strong>{latestTurn ? latestTurn.status : 'None found'}</strong></div><div><span>SAVED MESSAGES</span><strong>{recovery.items.length}{recovery.itemsHasMore ? '+' : ''}</strong></div>{latestTurn?.error ? <p className="lab2-error">{latestTurn.error}</p> : null}{recovery.session.requiredActions ? <p>This session requires an action before it can continue.</p> : null}<h3>Saved items</h3><ul>{recovery.items.length ? recovery.items.slice(-10).map((item) => <li key={item.id}><strong>{item.role || 'item'} · {item.status || 'unknown'}</strong><code>{item.id}</code>{item.text ? <p>{item.text.slice(0, 400)}{item.text.length > 400 ? '…' : ''}</p> : null}</li>) : <li>No saved message items yet.</li>}</ul>{recovery.itemsHasMore ? <p>Showing the first page of saved items. More items exist.</p> : null}</div> : null}
        {canRetry ? <button type="button" className="lab4-retry-button" onClick={() => run(lastPrompt)}>Retry previous prompt →</button> : null}
        {turnActive ? <p className="lab4-wait-note">The latest turn is still active. Refresh saved state before sending another message.</p> : null}
      </aside>
    </div>
    <section className="lab3-guide lab4-guide"><h2>What each case teaches</h2><div><article><strong>API error</strong><p>The request may fail before a session exists. The simulation makes this case repeatable.</p></article><article><strong>Turn failure</strong><p>The simulated case shows a failed outcome locally. A real failed turn may include an error in saved turn state.</p></article><article><strong>Cancellation</strong><p>Request cancellation during a live turn, then wait for or retrieve its outcome.</p></article><article><strong>Disconnect</strong><p>The local stream stops early. Retrieve saved state because the agent may keep working.</p></article></div></section>
    <details className="code-lessons lab4-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 04</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind recovery</span><span className="code-lessons-hint">Open four explained snippets. Play each explanation with Viva voice.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code.join('\n'), Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speakingLesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speakingLesson === lesson.number} aria-label={speakingLesson === lesson.number ? 'Stop reading ' + lesson.title : 'Read ' + lesson.title + ' explanation aloud'} title={speechAvailable ? undefined : 'Read aloud is unavailable in this browser'}>{speakingLesson === lesson.number ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg> : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speakingLesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>
    <section className="student-challenge"><strong>Try it yourself</strong><p>Choose Simulated stream disconnect and ask a short question. Retrieve saved state. If the turn is still active, refresh. Explain why a retry is hidden when the saved turn completed.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/sessions/events" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}

