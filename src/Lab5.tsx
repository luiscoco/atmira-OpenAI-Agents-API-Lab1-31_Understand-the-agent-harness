import { useEffect, useRef, useState } from 'react';
import Prism from 'prismjs';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';

const lessons = [
  { number: '01', title: 'List sessions', file: 'server/lab5.ts',
    code: "const page = await client().beta.agents.sessions.list({\n  limit: 20, order: 'desc', ...(after ? { after } : {})\n});\nconst nextCursor = page.has_more ? page.data.at(-1)?.id : null;",
    explanation: 'The server requests twenty sessions in newest-first order. When more exist, the last ID becomes the cursor for the next page. The API key stays on the server.' },
  { number: '02', title: 'Retrieve one session', file: 'server/lab5.ts',
    code: "const session = await client()\n  .beta.agents.sessions.retrieve(id);\nsendJson(response, 200, { session: {\n  ...summary(session),\n  instructions: session.agent?.instructions || null\n} });",
    explanation: 'The detail request reads the latest status and configuration for the selected session. This page does not load its saved conversation items.' },
  { number: '03', title: 'Delete after confirmation', file: 'server/lab5.ts',
    code: "const result = await client()\n  .beta.agents.sessions.delete(body.sessionId);\nif (!result.deleted) throw new Error('Deletion was not confirmed.');\nsendJson(response, 200, { id: body.sessionId, deleted: true });",
    explanation: 'After you confirm a specific ID, the server asks the API to delete that session. It reports success only when the API confirms removal. Physical cleanup may continue afterward.' },
  { number: '04', title: 'Refresh the history', file: 'src/Lab5.tsx',
    code: "await getJson('/api/lab5/session', {\n  method: 'DELETE',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ sessionId: deleteTarget })\n});\nsetSelected(null);\nawait loadSessions('', false);",
    explanation: 'React clears the selected details and reloads history after deletion. If deletion fails, it keeps the session visible and shows the error.' },
];

function codeTokens(tokens, prefix = '') {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}

async function getJson(url, options?: RequestInit) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

const formatDate = (seconds) => typeof seconds === 'number' ? new Date(seconds * 1000).toLocaleString() : 'Unknown';

export default function Lab5({ active, health }) {
  const [sessions, setSessions] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleteTarget, setDeleteTarget] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [speakingLesson, setSpeakingLesson] = useState(null);
  const [voices, setVoices] = useState([]);
  const utteranceRef = useRef(null);
  const loadedRef = useRef(false);
  const requestRef = useRef(0);
  const detailRef = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  useEffect(() => {
    if (active && !loadedRef.current) {
      loadedRef.current = true;
      loadSessions('', false);
    }
  }, [active]);
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
  useEffect(() => {
    if (!active && utteranceRef.current) stopSpeech();
  }, [active]);

  function stopSpeech() {
    utteranceRef.current = null;
    if (speechAvailable) window.speechSynthesis.cancel();
    setSpeakingLesson(null);
  }
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
      if (utteranceRef.current === utterance) { utteranceRef.current = null; setSpeakingLesson(null); }
    };
    utteranceRef.current = utterance;
    setSpeakingLesson(lesson.number);
    window.speechSynthesis.speak(utterance);
  }

  async function loadSessions(after = '', append = false) {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const result = await getJson('/api/lab5/sessions' + (after ? '?after=' + encodeURIComponent(after) : ''));
      if (requestId !== requestRef.current) return;
      setSessions((previous) => append ? [...previous, ...result.sessions.filter((item) => !previous.some((old) => old.id === item.id))] : result.sessions);
      setNextCursor(result.nextCursor);
    } catch (caught) {
      if (requestId === requestRef.current) setError(caught.message);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }
  async function selectSession(id) {
    const requestId = ++detailRef.current;
    setSelected(null);
    setDetailError('');
    setDeleteTarget('');
    setLoadingDetail(true);
    try {
      const result = await getJson('/api/lab5/session?sessionId=' + encodeURIComponent(id));
      if (requestId === detailRef.current) setSelected(result.session);
    } catch (caught) {
      if (requestId === detailRef.current) setDetailError(caught.message);
    } finally {
      if (requestId === detailRef.current) setLoadingDetail(false);
    }
  }
  async function deleteSession() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDetailError('');
    try {
      await getJson('/api/lab5/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: deleteTarget }),
      });
      setNotice(`Deleted ${deleteTarget} from the Agents API.`);
      setSelected(null);
      setDeleteTarget('');
      await loadSessions('', false);
    } catch (caught) {
      setDetailError(caught.message);
    } finally {
      setDeleting(false);
    }
  }

  return <div className="lab5-page">
    <div className="lab2-hero"><span className="lab2-badge lab5-badge">5/50</span><div><div className="eyebrow">LAB 05 / BEGINNER</div><h1>Manage <em>sessions.</em></h1><p>Browse your project’s session history, inspect one session, and delete a session you no longer need.</p></div></div>
    <div className="lab5-layout">
      <section className="lab5-history" aria-label="Session history">
        <div className="lab5-panel-heading"><div><span className="eyebrow">SESSION HISTORY</span><h2>Recent sessions</h2></div><button type="button" onClick={() => loadSessions('', false)} disabled={loading || deleting}>{loading ? 'Loading…' : 'Refresh'}</button></div>
        <p className="lab5-panel-note">Sessions from the configured OpenAI project. New conversations from Labs 01–04 appear here after you refresh.</p>
        {error ? <p className="lab2-error" role="alert">{error}</p> : null}
        {notice ? <p className="lab5-notice" role="status">{notice}</p> : null}
        <ul className="lab5-list">{sessions.map((session) => <li key={session.id}><button type="button" className={selected?.id === session.id ? 'selected' : ''} onClick={() => selectSession(session.id)} disabled={deleting}><span><strong>{session.agentName}</strong><span className="lab5-status">{session.status.replace('_', ' ')}</span></span><code>{session.id}</code><small>Last active {formatDate(session.lastActiveAt)} · {session.model}</small></button></li>)}</ul>
        {!loading && !error && sessions.length === 0 ? <p className="lab5-empty">No sessions found. Run a question in an earlier lab, then refresh this page.</p> : null}
        {nextCursor ? <button type="button" className="lab5-more" onClick={() => loadSessions(nextCursor, true)} disabled={loading || deleting}>{loading ? 'Loading…' : 'Load more sessions'}</button> : null}
      </section>
      <aside className="lab5-detail" aria-label="Selected session details">
        <span className="eyebrow">SESSION DETAILS</span><h2>Inspect and decide</h2>
        {loadingDetail ? <p>Retrieving session…</p> : null}
        {detailError ? <p className="lab2-error" role="alert">{detailError}</p> : null}
        {!selected && !loadingDetail ? <p>Select a session to retrieve its current status and configuration.</p> : null}
        {selected ? <><dl className="lab5-fields"><div><dt>ID</dt><dd><code>{selected.id}</code></dd></div><div><dt>Status</dt><dd>{selected.status.replace('_', ' ')}</dd></div><div><dt>Created</dt><dd>{formatDate(selected.createdAt)}</dd></div><div><dt>Last active</dt><dd>{formatDate(selected.lastActiveAt)}</dd></div><div><dt>Agent</dt><dd>{selected.agentName}</dd></div><div><dt>Model</dt><dd>{selected.model}</dd></div><div><dt>Environment</dt><dd>{selected.environment}</dd></div><div><dt>Required actions</dt><dd>{selected.requiredActions}</dd></div></dl>{selected.error ? <p className="lab2-error">{selected.error}</p> : null}{selected.instructions ? <details className="lab5-instructions"><summary>Agent instructions</summary><p>{selected.instructions}</p></details> : null}<div className="lab5-delete"><strong>Delete this session</strong><p>Delete removes this session from the API. You cannot continue it or retrieve it afterward. Physical cleanup may finish later.</p>{deleteTarget === selected.id ? <div className="lab5-confirm"><p>Delete <code>{selected.id}</code>?</p><button type="button" className="danger" onClick={deleteSession} disabled={deleting}>{deleting ? 'Deleting…' : 'Yes, delete session'}</button><button type="button" onClick={() => setDeleteTarget('')} disabled={deleting}>Keep session</button></div> : <button type="button" className="danger" onClick={() => setDeleteTarget(selected.id)}>Delete session…</button>}</div></> : null}
      </aside>
    </div>
    <section className="lab3-guide lab5-guide"><h2>What should you retain?</h2><div><article><strong>Keep for follow-ups</strong><p>Retain a session ID while the user may continue that conversation.</p></article><article><strong>Review before deletion</strong><p>Check whether an active or action-required session still has work to finish.</p></article><article><strong>Delete when finished</strong><p>Remove sessions your application no longer needs, following your own retention policy.</p></article><article><strong>Production access</strong><p>A real multi-user app must authenticate users and check session ownership on the server.</p></article></div><p className="lab3-guide-note">This local course app has no user accounts. Its history covers the API project configured by your server key.</p></section>
    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 05</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind session management</span><span className="code-lessons-hint">Open four explained snippets. Play each explanation with Viva voice.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Read how a server-only API client powers the history and details panels. Each snippet points to the file you can edit.</p><div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speakingLesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speakingLesson === lesson.number} aria-label={speakingLesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`} title={speechAvailable ? undefined : 'Read aloud is unavailable in this browser'}>{speakingLesson === lesson.number ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg> : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speakingLesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>
    <section className="student-challenge"><strong>Try it yourself</strong><p>Create two conversations in an earlier lab. Refresh history and inspect both IDs. Delete one session, then refresh again and confirm that the other remains. Explain which session you would retain for a follow-up.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/sessions/manage" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
