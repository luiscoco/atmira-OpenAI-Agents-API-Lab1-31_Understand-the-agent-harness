import { useEffect, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { codeTokens } from './Lab22.tsx';
import { selectNarratorVoice } from './speech.ts';
import { environmentRequest, executorEvidence, executorImage, verifyListing } from './lab32Environment.ts';
import { executorScenarios } from './lab32Scenarios.ts';
import { runExecutorSuite } from './lab32Tests.ts';
import { executorLessons } from './lab32Lessons.ts';
import type { ExecutorJob } from '../server/lab32Service.ts';

const storageKey = 'lab32-job'; const retryKey = 'lab32-request';
function saved(key: string) { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } }
function save(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Polling still works in this view. */ } }
function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })); const link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function json(url: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(url, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Request failed.'); return value;
}
export default function Lab32({ active }: { active: boolean }) {
  const [selected, setSelected] = useState('success'); const [position, setPosition] = useState(0);
  const [job, setJob] = useState<ExecutorJob | null>(null); const [jobId, setJobId] = useState(() => saved(storageKey));
  const [config, setConfig] = useState<{ enabled: boolean; applicationKey: boolean; executorKey: boolean; model: string } | null>(null);
  const [setupCheck, setSetupCheck] = useState(0);
  const [checkingSetup, setCheckingSetup] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notes, setNotes] = useState('');
  const [tests, setTests] = useState<ReturnType<typeof runExecutorSuite> | null>(null); const [testSource, setTestSource] = useState('');
  const [speaking, setSpeaking] = useState<string | null>(null); const [speechError, setSpeechError] = useState('');
  const speechRun = useRef(0); const utterances = useRef<SpeechSynthesisUtterance[]>([]);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  function stopSpeech() { speechRun.current++; if (speechAvailable) window.speechSynthesis.cancel(); utterances.current = []; setSpeaking(null); }
  useEffect(() => { if (!active) stopSpeech(); }, [active]);
  useEffect(() => () => { speechRun.current++; if (speechAvailable) window.speechSynthesis.cancel(); }, []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setCheckingSetup(true);
    void json('/api/lab32/status', undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setConfig(value); setError(''); } })
      .catch(failure => { if (!controller.signal.aborted) { setConfig(null); setError(failure.message); } })
      .finally(() => { if (!controller.signal.aborted) setCheckingSetup(false); });
    return () => controller.abort();
  }, [active, setupCheck]);
  useEffect(() => {
    if (!active || !jobId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await json(`/api/lab32/job?id=${encodeURIComponent(jobId)}`, undefined, controller.signal);
        if (controller.signal.aborted) return;
        setJob(data.job);
        if (data.job.status === 'running') timer = setTimeout(poll, 1000);
      } catch (failure) { if (!controller.signal.aborted) { setError(`${failure.message} Browser closure does not stop compute. Check Docker if the server restarted.`); timer = setTimeout(poll, 5000); } }
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [active, jobId]);
  function speak(lessons: typeof executorLessons, all: boolean) {
    const marker = all ? 'all' : lessons[0].number;
    if (speaking === marker) { stopSpeech(); return; }
    stopSpeech(); setSpeechError(''); if (!speechAvailable) return;
    const run = speechRun.current; const voice = selectNarratorVoice(window.speechSynthesis.getVoices());
    utterances.current = lessons.map((lesson, index) => {
      const utterance = new SpeechSynthesisUtterance(`${lesson.title}. ${lesson.explanation}`);
      if (voice) utterance.voice = voice; utterance.lang = voice?.lang || 'en-US'; utterance.rate = .95;
      utterance.onerror = () => { if (run === speechRun.current) { stopSpeech(); setSpeechError('Narration could not play. Try an installed English voice.'); } };
      utterance.onend = () => { if (run === speechRun.current && index === lessons.length - 1) { setSpeaking(null); utterances.current = []; } };
      return utterance;
    });
    setSpeaking(marker); utterances.current.forEach(utterance => window.speechSynthesis.speak(utterance));
  }
  async function start() {
    setBusy(true); setError('');
    const requestId = saved(retryKey) || crypto.randomUUID(); save(retryKey, requestId);
    try {
      const data = await json('/api/lab32/run', { requestId });
      setJob(data.job); setJobId(data.job.id); save(storageKey, data.job.id); save(retryKey, ''); setSelected('live');
    } catch (failure) { setError(`${failure.message} Retry uses the same request ID; it does not intentionally start duplicate compute.`); }
    finally { setBusy(false); }
  }
  async function control(action: 'stop' | 'cleanup') {
    if (!job) return; setBusy(true); setError('');
    try { const data = await json(`/api/lab32/${action}`, { id: job.id }); setJob(data.job); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function serverTests() {
    try { const data = await json('/api/lab32/test', {}); setTests(data.results); setTestSource('server'); }
    catch (failure) { setError(failure.message); }
  }
  const scenario = executorScenarios.find(row => row.id === selected) ?? executorScenarios[0];
  const live = selected === 'live' && Boolean(job); const trace = live ? job!.trace : scenario.trace;
  const checks = verifyListing(trace); const running = job?.status === 'running';
  const canRun = config?.enabled && config.applicationKey && config.executorKey && !running && job?.trace.cleanup !== 'failed' && job?.sessionCleanup !== 'failed';
  const runBlockers = [
    ...(!config ? [checkingSetup ? 'Checking server setup.' : 'Server setup could not be read. Recheck setup using a localhost connection.'] : [
      ...(!config.enabled ? ['Set LAB32_ENABLE_LOCAL_EXECUTOR=true in .env.'] : []),
      ...(!config.applicationKey ? ['Configure OPENAI_API_KEY in .env.'] : []),
      ...(!config.executorKey ? ['Configure a separate restricted OPENAI_EXECUTOR_API_KEY in .env; it must differ from the application key.'] : []),
    ]),
    ...(running ? ['Wait for the current run, or use Stop run and clean up.'] : []),
    ...(job?.trace.cleanup === 'failed' || job?.sessionCleanup === 'failed' ? ['Use Retry cleanup before starting another run.'] : []),
  ];
  return <div className="lab16-page lab31-page lab32-page">
    <div className="lab2-hero"><span className="lab2-badge lab31-badge">32/56</span><div><div className="eyebrow">LAB 32 / CONNECT A SELF-HOSTED ENVIRONMENT</div><h1>Your files. <em>Your executor.</em></h1><p>Connect a disposable local Docker workspace to the managed Agents API harness. Observe the connection, list its files, verify the nonce, and remove compute and session separately.</p></div></div>
    <section className="lab7-card"><span className="eyebrow">CONNECTION CONTRACT</span><h2>OpenAI runs the harness; your application supplies compute</h2><ol className="lab32-flow"><li>Create a session without input</li><li>Open events and launch the executor</li><li>Wait for environment.connected</li><li>Send the file-listing task once</li><li>Verify output and clean up both resources</li></ol><pre className="lab32-code">{JSON.stringify(environmentRequest, null, 2)}</pre><p>The executor connects outbound to api.openai.com and codex-cloud-environments.chatgpt.com. No inbound sandbox port is published. Each session needs its own executor.</p></section>
    <section className="lab7-card"><span className="eyebrow">LOCAL EXECUTOR / OPTIONAL LIVE RUN</span><h2>Run the task in a fresh workspace</h2><p>This button creates a new API session and disposable Docker container. The server supplies a fixed task and four fixture files; no host project directory is mounted. The executor can read its restricted environment key. Outbound networking remains available.</p><details open={Boolean(config && (!config.enabled || !config.applicationKey || !config.executorKey))}><summary>Setup before the first live run</summary><ol><li>Start Docker Desktop in Linux container mode.</li><li>Build the executor image from the project folder:<pre className="lab32-code">docker build -t {executorImage} sandbox/lab32</pre></li><li>Configure OPENAI_API_KEY, a separate OPENAI_EXECUTOR_API_KEY, and LAB32_ENABLE_LOCAL_EXECUTOR=true in .env, then restart the course server.</li><li>The environment key must share the session owner/project and have only environment connection permissions. For repeatable recordings, build with --build-arg CODEX_VERSION=&lt;verified exact version&gt;.</li></ol><p>This local teaching runner accepts localhost requests only. It is not a multi-user deployment. Abrupt process termination may leave a container: inspect <code>docker ps -a --filter label=agents.course.lab=32</code>, then remove only its exact name.</p></details><div className="lab31-facts"><span><strong>Local executor enabled</strong>{config?.enabled ? 'Yes' : 'No'}</span><span><strong>Application key</strong>{config?.applicationKey ? 'Configured on server' : 'Not configured'}</span><span><strong>Restricted executor key</strong>{config?.executorKey ? 'Configured on server' : 'Not configured'}</span><span><strong>Model</strong>{config?.model ?? 'Checking server…'}</span></div><div id="lab32-run-requirements" aria-live="polite">{runBlockers.length ? <><strong>Before you can connect:</strong><ul>{runBlockers.map(reason => <li key={reason}>{reason}</li>)}</ul>{config && (!config.enabled || !config.applicationKey || !config.executorKey) ? <p>After changing .env, restart the Node server, then recheck setup. Docker Desktop must be running and the executor image built.</p> : null}</> : null}</div><div className="lab30-toolbar"><button type="button" className="lab8-secondary" disabled={checkingSetup} onClick={() => setSetupCheck(value => value + 1)}>{checkingSetup ? 'Checking setup…' : 'Recheck setup'}</button><button type="button" className="lab8-run" onClick={start} disabled={!canRun || busy || checkingSetup} aria-describedby="lab32-run-requirements" title={runBlockers.join(' ')}>{running ? 'Run in progress…' : 'Connect and list files'}</button><button type="button" className="lab8-secondary" onClick={() => control('stop')} disabled={!running || busy}>Stop run and clean up</button><button type="button" className="lab8-secondary" onClick={() => control('cleanup')} disabled={busy || !job || running || (job.trace.cleanup !== 'failed' && job.sessionCleanup !== 'failed')}>Retry cleanup</button>{job ? <button type="button" className="lab8-secondary" onClick={() => setSelected('live')}>Show live run</button> : null}</div><p className="lab8-note">A run has a five-minute deadline and a two-minute connection wait. Switching labs or closing the browser leaves the server job running; it cleans up when the run settles. Run ID: {job?.id ?? 'none'}.</p>{job ? <p>Container: <code>{job.containerName}</code> · Job: {job.status} · Docker: {job.trace.cleanup} · API session deletion: {job.sessionCleanup}</p> : null}{error ? <p role="alert" className="lab31-error">{error}</p> : null}</section>
    <section className="lab7-card"><span className="eyebrow">PRACTICE AND RUN EVIDENCE</span><h2>Connection state is not a task outcome</h2><label htmlFor="lab32-scenario">Choose an evidence case</label><select id="lab32-scenario" value={selected} onChange={event => { setSelected(event.target.value); setPosition(0); }}>{executorScenarios.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}{job ? <option value="live">Current live run</option> : null}</select><p>{live ? 'Actual server run, including failure and cleanup evidence. No successful live result is implied by session creation.' : `${scenario.explanation} This trace is synthetic practice, not a recorded API run.`}</p><div className="lab31-facts"><span><strong>Source</strong>{trace.source}</span><span><strong>Connection</strong>{trace.connection}</span><span><strong>Observed root outcome</strong>{trace.outcome}</span><span><strong>Input accepted</strong>{trace.inputSent ? 'Yes' : 'No'}</span></div><p>Session: <code>{trace.sessionId ?? 'practice'}</code> · Environment: <code>{trace.environmentId ?? 'practice'}</code></p>{trace.error ? <p role="status" className="lab31-error">{trace.error}</p> : null}{!live ? <div className="lab30-toolbar"><button type="button" className="lab8-secondary" disabled={!position} onClick={() => setPosition(position - 1)}>Previous event</button><span>{Math.min(position + 1, trace.events.length)} / {trace.events.length}</span><button type="button" className="lab8-secondary" disabled={position >= trace.events.length - 1} onClick={() => setPosition(position + 1)}>Next event</button></div> : null}<ol className="lab32-events">{trace.events.slice(0, live ? undefined : position + 1).map((event, index) => <li key={index}><code>{event.name}</code><span>{event.ms} ms</span></li>)}</ol><h3>Completed command evidence</h3>{trace.commands.length ? trace.commands.map((command, index) => <div key={`${command.id}:${index}`}><p>Exit: {command.exitCode ?? 'unknown'} · Working directory: {command.cwd ?? 'not reported'}</p><pre className="lab32-code">{command.command}{'\n\n'}{command.output ?? 'No captured output'}</pre></div>) : <p>No completed command was observed.</p>}<h3>Final answer</h3><pre className="lab32-code">{trace.answer || 'No final answer observed.'}</pre><ul className="lab32-checks">{checks.map(check => <li key={check.name} className={check.passed ? 'lab29-ok' : 'lab31-error'}>{check.passed ? 'PASS' : 'NOT VERIFIED'} · {check.name}</li>)}</ul><p className="lab8-note">Checks apply to the complete case, including practice events not yet revealed. A correct report without command evidence does not prove filesystem access. A connection failure can happen before any root turn exists.</p></section>
    <section className="lab7-card"><span className="eyebrow">STUDENT EVIDENCE</span><h2>Explain the lifecycle</h2><label htmlFor="lab32-notes">Who runs the harness, who controls compute, why are the keys separate, and what does the evidence prove?</label><textarea id="lab32-notes" rows={5} maxLength={5000} value={notes} onChange={event => setNotes(event.target.value)} /><div className="lab30-toolbar"><button type="button" className="lab8-run" onClick={() => download(executorEvidence(trace, notes) + (live ? `\nAPI session cleanup: ${job!.sessionCleanup}\nContainer: ${job!.containerName}\n` : ''), 'lab32-executor-evidence.md', 'text/markdown')}>Download evidence</button><button type="button" className="lab8-secondary" onClick={() => download(JSON.stringify(live ? job : { trace }, null, 2), 'lab32-trace.json', 'application/json')}>Export trace JSON</button></div><p>Challenge: show pending → connected → command → completed, verify the hidden file and nonce, and show confirmed container removal. Compare the guessed-answer and cleanup-failure cases.</p></section>
    <section className="lab7-card"><span className="eyebrow">TEST PAGE / NO KEY OR DOCKER REQUIRED</span><h2>Shared evidence rules</h2><div className="lab30-toolbar"><button type="button" className="lab8-secondary" onClick={() => { setTests(runExecutorSuite()); setTestSource('browser'); }}>Run browser tests</button><button type="button" className="lab8-secondary" onClick={serverTests}>Run server tests</button></div>{tests ? <><p role="status">{tests.filter(row => row.passed).length} / {tests.length} passed · {testSource}</p><ul className="lab30-test-list">{tests.map(row => <li key={row.name}>{row.passed ? 'PASS' : 'FAIL'} · {row.name}</li>)}</ul></> : null}</section>
    <details className="code-lessons lab5-code" onToggle={event => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 32</span><span className="code-lessons-title" role="heading" aria-level={2}>How the executor lab was built</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action">View code</span></summary><div className="code-lessons-body"><div className="lab30-toolbar"><button type="button" className="viva-button" disabled={!speechAvailable} aria-pressed={speaking === 'all'} onClick={() => speak(executorLessons, true)}>Viva voice · Read all six</button><button type="button" className="lab8-secondary" disabled={!speaking} onClick={stopSpeech}>Stop narration</button></div>{!speechAvailable ? <p>This browser does not support speech synthesis. Read the explanations below.</p> : null}{speechError ? <p role="alert">{speechError}</p> : null}<div className="code-lessons-grid">{executorLessons.map(lesson => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className="viva-button" disabled={!speechAvailable} aria-pressed={speaking === lesson.number} onClick={() => speak([lesson], false)}>{speaking === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</button></article>)}</div></div></details>
    <section className="lab7-card"><span className="eyebrow">OFFICIAL REFERENCES / CHECKED 2026-10-04</span><h2>Executor connection and lifecycle</h2><ul>{['self-hosted', 'lifecycle', 'security'].map(page => <li key={page}><a href={`https://developers.openai.com/api/docs/guides/agents-api/environments/${page}`} target="_blank" rel="noopener noreferrer">{page === 'self-hosted' ? 'Self-hosted sandboxes' : page === 'lifecycle' ? 'Sandbox lifecycle' : 'Sandbox security'}</a></li>)}</ul></section>
  </div>;
}
