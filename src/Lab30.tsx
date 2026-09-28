import { useEffect, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { codeTokens } from './Lab22.tsx';
import { selectNarratorVoice } from './speech.ts';
import { safeFilename } from './lab29Artifacts.ts';
import { cleanupBlockers, practiceReport, practiceSnapshot, verificationLabel, type CleanupSnapshot } from './lab30Cleanup.ts';
import { cleanupLessons } from './lab30Lessons.ts';
import { runCleanupSuite } from './lab30Tests.ts';

type Health = { configured: boolean; model: string } | null;
type Entry = { id: string; status: string; lastActiveAt: number; model: string };
const scenarios = ['Completed report', 'Active turn', 'Setup still running', 'Cancelled turn', 'Sandbox expired'] as const;
type Scenario = typeof scenarios[number];
function scenarioSnapshot(scenario: Scenario): CleanupSnapshot {
  if (scenario === 'Active turn') return { ...practiceSnapshot, status: 'in_progress', turn: { id: 'turn_active', status: 'in_progress' }, artifacts: [] };
  if (scenario === 'Setup still running') return { ...practiceSnapshot, turn: null, environmentStatus: 'provisioning', artifacts: [] };
  if (scenario === 'Cancelled turn') return { ...practiceSnapshot, turn: { id: 'turn_cancelled', status: 'cancelled' }, artifacts: [] };
  if (scenario === 'Sandbox expired') return { ...practiceSnapshot, environmentStatus: 'expired' };
  return structuredClone(practiceSnapshot);
}
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
async function call(path: string, fields?: object) {
  const response = await fetch(path, fields ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) } : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

export default function Lab30({ active, health }: { active: boolean; health: Health }) {
  const [mode, setMode] = useState<'practice' | 'live'>('practice');
  const [scenario, setScenario] = useState<Scenario>('Completed report');
  const [snapshot, setSnapshot] = useState<CleanupSnapshot>(structuredClone(practiceSnapshot));
  const [token, setToken] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [stoppedInput, setStoppedInput] = useState(false);
  const [retainedOutputs, setRetainedOutputs] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [conflict, setConflict] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [downloads, setDownloads] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [tests, setTests] = useState<ReturnType<typeof runCleanupSuite> | null>(null);
  const [testSource, setTestSource] = useState('');
  const [speaking, setSpeaking] = useState<{ number: string; all: boolean } | null>(null);
  const [speechError, setSpeechError] = useState('');
  const speechRun = useRef(0);
  const utterances = useRef<SpeechSynthesisUtterance[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  function stopSpeech() { speechRun.current++; if (speechAvailable) window.speechSynthesis.cancel(); utterances.current = []; setSpeaking(null); }
  useEffect(() => {
    if (!speechAvailable) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh(); window.speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => { window.speechSynthesis.removeEventListener('voiceschanged', refresh); speechRun.current++; window.speechSynthesis.cancel(); };
  }, [speechAvailable]);
  useEffect(() => { if (!active) stopSpeech(); }, [active]);
  function speak(queue: typeof cleanupLessons, all: boolean) {
    if (!speechAvailable) return;
    if (speaking && (all ? speaking.all : speaking.number === queue[0].number)) { stopSpeech(); return; }
    stopSpeech(); setSpeechError('');
    const run = speechRun.current;
    const voice = selectNarratorVoice(voices.length ? voices : window.speechSynthesis.getVoices());
    utterances.current = queue.map((lesson, index) => {
      const utterance = new SpeechSynthesisUtterance(`${lesson.title}. ${lesson.explanation}`);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'en-US'; utterance.rate = 0.95;
      utterance.onstart = () => { if (run === speechRun.current) setSpeaking({ number: lesson.number, all }); };
      utterance.onerror = () => { if (run === speechRun.current) { stopSpeech(); setSpeechError('Narration could not play. Try again or choose an installed English voice in your browser.'); } };
      utterance.onend = () => { if (run === speechRun.current && index === queue.length - 1) { setSpeaking(null); utterances.current = []; } };
      return utterance;
    });
    setSpeaking({ number: queue[0].number, all });
    utterances.current.forEach(utterance => window.speechSynthesis.speak(utterance));
  }
  function reset(next: CleanupSnapshot | null) {
    setSnapshot(next); setToken(''); setConfirmation(''); setStoppedInput(false); setRetainedOutputs(false); setResult(null); setDownloads({}); setMessage('');
  }
  async function work(label: string, fn: () => Promise<void>) {
    setBusy(label); setMessage('');
    try { await fn(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed.'); }
    finally { setBusy(''); }
  }
  async function list(after?: string) {
    await work('Listing', async () => {
      const data = await call(`/api/lab30/list${after ? `?after=${encodeURIComponent(after)}` : ''}`);
      setEntries(previous => after ? [...previous, ...data.sessions.filter((item: Entry) => !previous.some(existing => existing.id === item.id))] : data.sessions);
      setCursor(data.nextCursor || null);
      if (!data.sessions.length) setMessage(data.nextCursor ? 'No hosted sessions on this page. Load the next page.' : 'No hosted sessions found on this page.');
    });
  }
  async function inspect(id: string) {
    await work('Inspecting', async () => {
      const data = await call(`/api/lab30/inspect?sessionId=${encodeURIComponent(id)}`);
      reset(data.snapshot); setToken(data.token); setSessionId(id);
    });
  }
  const decision = { stoppedInput, retainedOutputs, confirmation };
  const blockers = snapshot ? cleanupBlockers(snapshot, decision) : ['Inspect a session first.'];
  async function download(artifactId: string, path: string) {
    await work('Downloading', async () => {
      let blob: Blob; let expected: string | null = null;
      if (mode === 'practice') blob = new Blob([practiceReport], { type: 'text/markdown' });
      else {
        const response = await fetch(`/api/lab30/download?token=${encodeURIComponent(token)}&artifactId=${encodeURIComponent(artifactId)}`);
        if (!response.ok) { const error = await response.json(); throw new Error(error.error); }
        expected = response.headers.get('X-Artifact-Sha256'); blob = await response.blob();
      }
      if (!window.crypto?.subtle) throw new Error('Hash verification needs HTTPS or localhost.');
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
      if (mode === 'live' && (!expected || hash !== expected)) throw new Error('Download hash did not match. File was not offered to save.');
      saveBlob(blob, safeFilename(path));
      setDownloads(previous => ({ ...previous, [artifactId]: `${blob.size} bytes · SHA-256 ${hash} · ${mode === 'live' ? 'matches server' : 'practice file'}` }));
    });
  }
  async function remove() {
    await work('Deleting', async () => {
      if (mode === 'live') setResult(await call('/api/lab30/delete', { token, ...decision }));
      else setResult({ id: snapshot.id, deleted: true, attempts: conflict ? 2 : 1, trace: conflict ? ['Attempt 1: simulated 409 conflict.', 'Attempt 2: simulated deletion confirmed.'] : ['Attempt 1: simulated deletion confirmed.'], verification: { status: 404, verified: true, message: verificationLabel(404) }, at: new Date().toISOString(), source: 'synthetic practice' });
    });
  }
  function exportAudit() {
    saveBlob(new Blob([JSON.stringify({ lab: 30, source: mode === 'practice' ? 'synthetic practice' : 'live API', inspection: snapshot, decision, downloads, result, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }), 'lab30-cleanup-audit.json');
  }
  return <div className="lab16-page lab26-page lab30-page">
    <div className="lab2-hero"><span className="lab2-badge lab30-badge">30/56</span><div><div className="eyebrow">LAB 30 / CLEAN UP SANDBOX RESOURCES</div><h1>Keep the report. <em>Clean up the session.</em></h1><p>Inspect the session and sandbox, save needed artifacts, stop incoming work, then delete and verify API absence. Closing a stream does not cancel execution. Physical cleanup may continue after deletion is confirmed.</p></div></div>
    <section className="lab3-guide lab25-flow" aria-label="Cleanup sequence"><h2>A cleanup checklist you can verify</h2><div>{['Inspect session + turn', 'Retain needed outputs', 'Stop input / settle work', 'Delete + verify 404'].map((title, index) => <article key={title}><span>0{index + 1}</span><strong>{title}</strong></article>)}</div></section>
    <section className="lab7-card"><span className="eyebrow">LIFETIME / WHAT SURVIVES?</span><h2>Workspace, published copy, and saved session</h2><div className="lab9-table-wrap"><table><thead><tr><th>Action</th><th>Workspace files</th><th>Published artifacts</th><th>Session</th></tr></thead><tbody><tr><th>Close the event stream</th><td>Execution may continue</td><td>Unchanged</td><td>Retained</td></tr><tr><th>Sandbox expires</th><td>May be lost</td><td>Remain downloadable</td><td>Retained</td></tr><tr><th>Delete an artifact</th><td>Live file stays</td><td>Selected copy removed</td><td>Retained</td></tr><tr><th>Delete hosted session</th><td>Cleanup requested</td><td>Save needed copies first</td><td>Removed from API</td></tr></tbody></table></div><p className="lab8-note">Hosted sandboxes can expire after one hour without activity and keep-alives. The timeout is not configurable. Session idle time is not an expiry timer. Self-hosted compute requires separate provider shutdown.</p></section>
    <section className="lab7-card"><span className="eyebrow">CLEANUP WORKBENCH</span><h2>Review one session before deleting</h2>
      <div className="lab30-toolbar"><button type="button" className={mode === 'practice' ? 'lab8-run' : 'lab8-secondary'} disabled={!!busy} onClick={() => { setMode('practice'); reset(scenarioSnapshot(scenario)); }}>Practice · no API key</button><button type="button" className={mode === 'live' ? 'lab8-run' : 'lab8-secondary'} disabled={!!busy} onClick={() => { setMode('live'); reset(null); }}>Live · project sessions</button></div>
      {mode === 'practice' ? <><p className="lab8-note">Synthetic scenarios: no real sessions are created, cancelled, or deleted. The report download works locally.</p><label htmlFor="lab30-scenario">Scenario</label><select id="lab30-scenario" disabled={!!busy} value={scenario} onChange={event => { const value = event.target.value as Scenario; setScenario(value); reset(scenarioSnapshot(value)); }}>{scenarios.map(value => <option key={value}>{value}</option>)}</select><label className="lab30-check"><input type="checkbox" checked={conflict} onChange={event => setConflict(event.target.checked)} /> Simulate one 409 conflict before successful deletion</label></> : <>
        <p>These are OpenAI-hosted sessions in the API key’s project, including prior labs. Select only the session whose work you have finished.</p>
        <div className="lab30-toolbar"><button type="button" className="lab8-secondary" disabled={!!busy || !health?.configured} onClick={() => list()}>Refresh hosted sessions</button>{cursor ? <button type="button" className="lab8-secondary" disabled={!!busy} onClick={() => list(cursor)}>Load next page</button> : null}</div>
        <div className="lab30-session-list">{entries.map(entry => <button type="button" key={entry.id} disabled={!!busy} onClick={() => inspect(entry.id)}><code>{entry.id}</code><span>{entry.status} · {entry.model} · last active {new Date(entry.lastActiveAt * 1000).toLocaleString()}</span></button>)}</div>
        <label htmlFor="lab30-session">Session ID from a completed lab</label><div className="lab30-toolbar"><input id="lab30-session" value={sessionId} onChange={event => setSessionId(event.target.value)} placeholder="sess_…" disabled={!!busy} /><button type="button" className="lab8-secondary" disabled={!!busy || !sessionId || !health?.configured} onClick={() => inspect(sessionId)}>Inspect session</button></div>
        {!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env for live operations. Practice, teaching, narration, and tests work without a key.</p> : null}
      </>}
      {snapshot ? <><div className="lab30-facts"><p><strong>Session</strong><code>{snapshot.id}</code><span>{snapshot.status} · {snapshot.requiredActions} required actions</span></p><p><strong>Latest turn</strong><code>{snapshot.turn?.id || 'No turn'}</code><span>{snapshot.turn?.status || 'none'}</span></p><p><strong>Sandbox</strong><code>{snapshot.environmentId}</code><span>{snapshot.environmentType} · {snapshot.environmentStatus}</span></p></div>
        <h3>Retain outputs before deletion</h3><div className="lab9-table-wrap"><table><thead><tr><th>Path / artifact</th><th>Turn</th><th>Bytes</th><th>Download</th></tr></thead><tbody>{snapshot.artifacts.map(artifact => <tr key={artifact.id}><td><code>{artifact.path}</code><small className="lab29-type">{artifact.id}</small></td><td><code>{artifact.turnId}</code></td><td>{artifact.size}</td><td><button type="button" className="lab8-secondary" disabled={!!busy || !!result?.deleted} onClick={() => download(artifact.id, artifact.path)}>⤓ Save file</button>{downloads[artifact.id] ? <small className="lab30-hash">{downloads[artifact.id]}</small> : null}</td></tr>)}</tbody></table></div>{!snapshot.artifacts.length ? <p>No published artifacts. A cancelled turn can leave an unpublished draft in the sandbox.</p> : null}
        <fieldset className="lab30-checklist" disabled={!!busy || !!result?.deleted}><legend>Before deleting this session</legend><label><input type="checkbox" checked={stoppedInput} onChange={event => setStoppedInput(event.target.checked)} /> I stopped sending input to this session.</label><label><input type="checkbox" checked={retainedOutputs} onChange={event => setRetainedOutputs(event.target.checked)} /> I saved needed outputs outside this session, or decided that none are needed.</label><label htmlFor="lab30-confirm">Type <code>{snapshot.id}</code> to confirm this session’s deletion or cancellation</label><input id="lab30-confirm" autoComplete="off" spellCheck={false} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></fieldset>
        {!result?.deleted ? <><ul className="lab30-blockers">{blockers.map(reason => <li key={reason}>{reason}</li>)}</ul><div className="lab30-toolbar"><button type="button" className="lab8-secondary lab24-danger" disabled={!!busy || blockers.length > 0} onClick={remove}>{mode === 'practice' ? 'Simulate deletion' : 'Delete selected hosted session'}</button>{snapshot.turn && !['completed', 'cancelled', 'failed'].includes(snapshot.turn.status) ? <button type="button" className="lab8-secondary" disabled={!!busy || confirmation !== snapshot.id || !stoppedInput} onClick={() => work('Cancelling', async () => { if (mode === 'practice') { reset({ ...snapshot, status: 'idle', turn: { ...snapshot.turn, status: 'cancelled' } }); setMessage('Simulated cancellation settled. Review the checklist again.'); } else { const data = await call('/api/lab30/cancel', { token, confirmation }); setMessage(data.message); setToken(''); } })}>Request cancellation · abandon unpublished work</button> : null}{mode === 'live' ? <button type="button" className="lab8-secondary" disabled={!!busy} onClick={() => inspect(snapshot.id)}>Inspect again</button> : null}</div></> : null}
      </> : null}
      <div role="status" aria-live="polite">{busy ? `${busy}…` : message}</div>
      {result ? <div className="lab30-result"><h3>{mode === 'practice' ? 'Practice result' : 'Deletion result'}</h3><p>{result.verification.message}</p><ol>{result.trace.map((line: string, index: number) => <li key={index}>{line}</li>)}</ol>{mode === 'live' ? <button type="button" className="lab8-secondary" disabled={!!busy} onClick={() => work('Verifying', async () => { const verification = await call('/api/lab30/verify', { token }); setResult(previous => ({ ...previous, verification })); })}>Verify again</button> : null}</div> : null}
      <button type="button" className="lab8-secondary" disabled={!snapshot || !!busy} onClick={exportAudit}>Export cleanup audit · JSON</button>
    </section>
    <section className="lab7-card"><span className="eyebrow">TEST PAGE · NO API KEY NEEDED</span><h2>Check the lifecycle policy</h2><p>Exercise active and waiting turns, provisioning, retention, changed snapshots, bounded conflicts, and honest verification outcomes.</p><div className="lab30-toolbar"><button type="button" className="lab8-secondary" disabled={!!busy} onClick={() => { setTests(runCleanupSuite()); setTestSource('browser'); }}>Run browser tests</button><button type="button" className="lab8-secondary" disabled={!!busy} onClick={() => work('Testing', async () => { const data = await call('/api/lab30/test', {}); setTests(data.results); setTestSource('server'); })}>Run server tests</button></div>{tests ? <><p role="status">{tests.filter(test => test.passed).length}/{tests.length} passed · {testSource}</p><ul className="lab30-test-list">{tests.map(test => <li key={test.name} className={test.passed ? 'lab29-ok' : 'lab27-no'}>{test.passed ? '✓' : '✗'} {test.name}</li>)}</ul></> : null}</section>
    <details className="code-lessons lab5-code" onToggle={event => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 30</span><span className="code-lessons-title" role="heading" aria-level={2}>The code that retains, checks, deletes, and verifies</span><span className="code-lessons-hint">Six explained snippets with Viva voice audio narration.</span></span><span className="code-lessons-toggle-action">View / hide code</span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Follow each lifecycle step in TypeScript. Viva voice reads the explanations using your browser’s speech synthesis.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.all ? ' is-speaking' : '')} disabled={!speechAvailable} aria-pressed={!!speaking?.all} onClick={() => speak(cleanupLessons, true)}>{speaking?.all ? '■ Stop reading all' : '▶ Viva voice · Read all six'}</button>{!speechAvailable ? <p>This browser does not support speech synthesis.</p> : null}{speechError ? <p role="status">{speechError}</p> : null}<div className="code-lessons-grid">{cleanupLessons.map(lesson => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.number === lesson.number ? ' is-speaking' : '')} disabled={!speechAvailable} aria-pressed={speaking?.number === lesson.number} onClick={() => speak([lesson], false)}>{speaking?.number === lesson.number ? '■ Stop reading' : '▶ Viva voice · Read aloud'}</button></article>)}</div></div></details>
    <section className="student-challenge"><strong>Try it yourself</strong><p>In practice, show why an active turn and an idle session with provisioning are blocked. Download the report, complete the checklist, simulate a 409, and export the audit. Then inspect a completed Lab 29 session live, save its needed artifacts, delete it, and show retrieval returning 404. Explain why that result does not prove physical cleanup finished. Run both test suites and read one snippet aloud.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ PRACTICE AVAILABLE WITHOUT A KEY'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
