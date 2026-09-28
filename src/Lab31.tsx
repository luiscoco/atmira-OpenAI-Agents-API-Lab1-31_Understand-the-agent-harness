import { useEffect, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { codeTokens } from './Lab22.tsx';
import { selectNarratorVoice } from './speech.ts';
import { architectureEdges, classifyStep, evidenceDocument, owners, parseTrace, references, runtimeComparison, traceOutcome, traceWarnings, validSessionId, type EnvironmentKind, type HarnessTrace, type Owner } from './lab31Harness.ts';
import { harnessScenarios, ownershipQuestions } from './lab31Scenarios.ts';
import { harnessLessons } from './lab31Lessons.ts';
import { runHarnessSuite } from './lab31Tests.ts';

type Health = { configured: boolean; model: string } | null;
function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })); const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export default function Lab31({ active, health }: { active: boolean; health: Health }) {
  const [trace, setTrace] = useState<HarnessTrace>(harnessScenarios[0].trace);
  const [scenario, setScenario] = useState('hosted');
  const [position, setPosition] = useState(0);
  const [environment, setEnvironment] = useState<EnvironmentKind>('openai_hosted');
  const [selectedOwner, setSelectedOwner] = useState<Owner>('browser');
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [importText, setImportText] = useState('');
  const [notes, setNotes] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [tests, setTests] = useState<ReturnType<typeof runHarnessSuite> | null>(null);
  const [testSource, setTestSource] = useState('');
  const [speaking, setSpeaking] = useState<{ number: string; all: boolean } | null>(null);
  const [speechError, setSpeechError] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const speechRun = useRef(0); const utterances = useRef<SpeechSynthesisUtterance[]>([]);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  const request = useRef<AbortController | null>(null);
  function stopSpeech() { speechRun.current++; if (speechAvailable) window.speechSynthesis.cancel(); utterances.current = []; setSpeaking(null); }
  useEffect(() => {
    if (!speechAvailable) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh(); window.speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => { window.speechSynthesis.removeEventListener('voiceschanged', refresh); speechRun.current++; window.speechSynthesis.cancel(); };
  }, [speechAvailable]);
  useEffect(() => { if (!active) { stopSpeech(); request.current?.abort(); } }, [active]);
  useEffect(() => () => request.current?.abort(), []);
  function speak(queue: typeof harnessLessons, all: boolean) {
    if (!speechAvailable || !queue.length) return;
    if (speaking && (all ? speaking.all : speaking.number === queue[0].number)) { stopSpeech(); return; }
    stopSpeech(); setSpeechError(''); const run = speechRun.current;
    const voice = selectNarratorVoice(voices.length ? voices : window.speechSynthesis.getVoices());
    utterances.current = queue.map((lesson, index) => {
      const utterance = new SpeechSynthesisUtterance(`${lesson.title}. ${lesson.explanation}`);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'en-US'; utterance.rate = 0.95;
      utterance.onstart = () => { if (run === speechRun.current) setSpeaking({ number: lesson.number, all }); };
      utterance.onerror = () => { if (run === speechRun.current) { stopSpeech(); setSpeechError('Narration could not play. Try an installed English voice in your browser.'); } };
      utterance.onend = () => { if (run === speechRun.current && index === queue.length - 1) { setSpeaking(null); utterances.current = []; } };
      return utterance;
    });
    setSpeaking({ number: queue[0].number, all }); utterances.current.forEach(utterance => window.speechSynthesis.speak(utterance));
  }
  function loadTrace(next: HarnessTrace) {
    setTrace(next); setEnvironment(next.environment); setPosition(0); setSelectedOwner(next.steps.length ? classifyStep(next.steps[0]).owner : 'harness'); setNotes(''); setError('');
  }
  function selectStep(index: number) { setPosition(index); const step = trace.steps[index]; if (step) setSelectedOwner(classifyStep(step).owner); }
  async function inspect() {
    if (!validSessionId(sessionId.trim())) { setError('Enter a valid sess_ session ID.'); return; }
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/lab31/inspect?sessionId=${encodeURIComponent(sessionId.trim())}`, { signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Inspection failed.');
      if (!controller.signal.aborted) { loadTrace(parseTrace(data.trace, 'live saved state')); setScenario(''); }
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Inspection failed.'); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  async function serverTests() {
    setError('');
    try {
      const response = await fetch('/api/lab31/test', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.results) || !data.results.every((row: unknown) => typeof row === 'object' && row !== null && typeof (row as { name?: unknown }).name === 'string' && typeof (row as { passed?: unknown }).passed === 'boolean')) throw new Error('Invalid server test response.');
      setTests(data.results); setTestSource('server');
    } catch (error) { setError(error instanceof Error ? error.message : 'Tests failed.'); }
  }
  const current = trace.steps[position]; const annotation = current ? classifyStep(current) : null;
  const visible = trace.steps.slice(0, position + 1);
  const warnings = traceWarnings(trace);
  const score = ownershipQuestions.filter(question => answers[question.id] === question.owner).length;
  return <div className="lab16-page lab31-page">
    <div className="lab2-hero"><span className="lab2-badge lab31-badge">31/56</span><div><div className="eyebrow">LAB 31 / UNDERSTAND THE AGENT HARNESS</div><h1>Who does <em>the work?</em></h1><p>The model proposes. The managed harness coordinates. Your application enforces product rules. The sandbox executes. Connect the architecture to the evidence from a session.</p></div></div>
    <section className="lab7-card"><span className="eyebrow">ARCHITECTURE / CLICK A COMPONENT</span><h2>One agent, distinct responsibilities</h2>
      <label htmlFor="lab31-environment">Explore an environment</label><select id="lab31-environment" value={environment} onChange={event => setEnvironment(event.target.value as EnvironmentKind)}><option value="none">none · no built-in sandbox</option><option value="openai_hosted">openai_hosted · managed compute</option><option value="self_hosted">self_hosted · your compute + executor</option></select>
      <div className="lab31-diagram" aria-label={`Agents API architecture with ${environment}`}>
        {(['browser', 'server', 'harness', 'model', 'sandbox', 'mcp'] as Owner[]).map(owner => <button type="button" key={owner} className={'lab31-node' + (selectedOwner === owner ? ' selected' : '') + (owner === 'sandbox' && environment === 'none' ? ' absent' : '')} aria-pressed={selectedOwner === owner} onClick={() => setSelectedOwner(owner)}><span>{owner === 'sandbox' && environment === 'none' ? 'NOT ATTACHED' : owner === 'harness' || owner === 'model' ? 'OPENAI' : owner === 'server' || owner === 'browser' ? 'YOUR PRODUCT' : 'TOOL EXECUTION'}</span><strong>{owners[owner].title}</strong><small>{owner === 'sandbox' ? environment : owner === 'harness' ? 'Loop + saved progress' : owner === 'model' ? 'Text + proposed actions' : owner === 'server' ? 'Credentials + policy + handlers' : owner === 'browser' ? 'Input + rendering + narration' : 'Remote tool implementation'}</small></button>)}
      </div>
      <ol className="lab31-edges">{architectureEdges(environment).map(edge => <li key={`${edge.from}-${edge.to}`} className={selectedOwner === edge.from || selectedOwner === edge.to ? 'selected' : ''}><strong>{owners[edge.from].title} ↔ {owners[edge.to].title}</strong><span>{edge.label}</span></li>)}</ol>
      <aside className="lab31-explanation" aria-live="polite"><strong>{owners[selectedOwner].title}</strong><p>{owners[selectedOwner].description}</p></aside>
      <p className="lab8-note">This diagram shows service-origin MCP; environment-origin connections use the executor network. Self-hosted is an ownership preview here; Lab 32 implements that executor. Changing the diagram does not change the inspected session.</p>
    </section>
    <section className="lab7-card"><span className="eyebrow">RUNTIME COMPARISON</span><h2>Choose where orchestration runs</h2><div className="lab9-table-wrap"><table><thead><tr><th>Runtime</th><th>Agent loop</th><th>State between tasks</th><th>Tools and application responsibility</th></tr></thead><tbody>{runtimeComparison.map(runtime => <tr key={runtime.name}><th>{runtime.name}</th><td>{runtime.loop}</td><td>{runtime.state}</td><td>{runtime.tools}<p>{runtime.responsibility}</p></td></tr>)}</tbody></table></div><p className="lab8-note">An evaluation runner measures behavior and generates a regression report. It is separate from the execution harness. Agents API sessions, SDK sessions, Responses conversations, and sandboxes are different resources.</p></section>
    <section className="lab7-card"><span className="eyebrow">OWNERSHIP TRACE / INSPECT THE EVIDENCE</span><h2>Follow a task across the boundaries</h2>
      <label htmlFor="lab31-scenario">Synthetic practice trace</label><select id="lab31-scenario" value={scenario} disabled={busy} onChange={event => { const selected = harnessScenarios.find(item => item.id === event.target.value); if (selected) { setScenario(selected.id); loadTrace(selected.trace); } }}>{!scenario ? <option value="">Current inspected or imported trace</option> : null}{harnessScenarios.map(item => <option key={item.id} value={item.id}>{item.trace.title}</option>)}</select>
      <div className="lab31-inspect"><label htmlFor="lab31-session">Or inspect a session ID from an earlier lab</label><div className="lab30-toolbar"><input id="lab31-session" value={sessionId} onChange={event => setSessionId(event.target.value)} placeholder="sess_…" disabled={busy} /><button type="button" className="lab8-run" onClick={inspect} disabled={busy || !health?.configured || !sessionId.trim()}>{busy ? 'Reading saved state…' : 'Inspect saved session'}</button></div><p className="lab8-note">Read-only project session lookup. No new input, inference, cancellation, or deletion. {!health?.configured ? 'Configure OPENAI_API_KEY on the server for this optional lookup.' : 'Saved items establish recorded work; internal model invocations and exact stream timing remain unseen.'}</p></div>
      {error ? <p role="alert" className="lab31-error">{error}</p> : null}
      <div className="lab31-facts"><span><strong>Source</strong>{trace.source}</span><span><strong>Session environment</strong>{trace.environment}</span><span><strong>Latest observed root</strong>{trace.complete ? traceOutcome(trace.steps) : 'unknown · partial inventory'}</span><span><strong>Through selected step</strong>{traceOutcome(visible)}</span></div>
      <div className="lab30-toolbar"><button type="button" className="lab8-secondary" disabled={!position} onClick={() => selectStep(position - 1)}>← Previous step</button><span>{trace.steps.length ? position + 1 : 0} / {trace.steps.length}</span><button type="button" className="lab8-secondary" disabled={position >= trace.steps.length - 1} onClick={() => selectStep(position + 1)}>Next step →</button></div>
      <div className="lab31-trace"><ol aria-label="Session trace steps">{trace.steps.map((step, index) => <li key={step.id}><button type="button" className={position === index ? 'selected' : ''} aria-current={position === index ? 'step' : undefined} onClick={() => selectStep(index)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step.label}</strong><small>{owners[classifyStep(step).owner].title}{step.status ? ` · ${step.status}` : ''}</small></button></li>)}</ol><aside className="lab31-explanation" aria-live="polite">{current && annotation ? <><span className="eyebrow">{owners[annotation.owner].title}</span><h3>{current.label}</h3><p>{current.detail}</p><p>{annotation.explanation}</p><dl><dt>Turn ID</dt><dd><code>{current.turnId ?? 'not reported'}</code></dd><dt>Call ID</dt><dd><code>{current.callId ?? 'not reported'}</code></dd><dt>Root ownership</dt><dd>{current.root ? 'Root / session step' : 'Child or root not established'}</dd></dl></> : <p>No trace steps were supplied.</p>}</aside></div>
      {warnings.length ? <ul className="lab30-blockers">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
      <details className="lab31-import"><summary>Import an exported trace JSON</summary><label htmlFor="lab31-import">Trace JSON · up to 1 MiB and 1,000 steps</label><textarea id="lab31-import" value={importText} onChange={event => setImportText(event.target.value)} maxLength={1_048_576} rows={6} /><button type="button" className="lab8-secondary" disabled={busy || !importText.trim()} onClick={() => { try { const imported = parseTrace(JSON.parse(importText)); loadTrace(imported); setScenario(''); } catch (error) { setError(error instanceof Error ? error.message : 'Invalid JSON.'); } }}>Validate and load locally</button><p>Imports are labelled imported. Owners are recomputed, and nothing is sent to OpenAI.</p></details>
    </section>
    <section className="lab7-card"><span className="eyebrow">CHECK YOUR UNDERSTANDING</span><h2>Assign the responsibility</h2><div className="lab31-quiz">{ownershipQuestions.map(question => <div key={question.id}><label htmlFor={`lab31-question-${question.id}`}>{question.question}</label><select id={`lab31-question-${question.id}`} value={answers[question.id] ?? ''} onChange={event => { setAnswers(previous => ({ ...previous, [question.id]: event.target.value })); setChecked(false); }}><option value="">Choose an owner</option>{Object.entries(owners).filter(([id]) => id !== 'unknown').map(([id, owner]) => <option key={id} value={id}>{owner.title}</option>)}</select>{checked ? <p className={answers[question.id] === question.owner ? 'lab29-ok' : 'lab31-error'}>{answers[question.id] === question.owner ? 'Correct. ' : `Review: ${owners[question.owner].title}. `}{question.why}</p> : null}</div>)}</div><button type="button" className="lab8-run" onClick={() => setChecked(true)}>Check ownership</button>{checked ? <p role="status">{score} / {ownershipQuestions.length} correct</p> : null}</section>
    <section className="lab7-card"><span className="eyebrow">STUDENT EVIDENCE</span><h2>Explain the boundary in your own words</h2><label htmlFor="lab31-notes">Explain the model, harness, tool implementation, compute, and what the trace cannot prove.</label><textarea id="lab31-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={5000} rows={5} /><div className="lab30-toolbar"><button type="button" className="lab8-run" onClick={() => download(evidenceDocument(trace, notes), 'lab31-harness-evidence.md', 'text/markdown')}>Download annotated evidence</button><button type="button" className="lab8-secondary" onClick={() => download(JSON.stringify(trace, null, 2), 'lab31-trace.json', 'application/json')}>Export trace JSON</button></div><p className="lab8-note">The evidence uses the trace’s actual environment ({trace.environment}), independent of the exploratory diagram selector. Provenance and limitations are included.</p></section>
    <section className="lab7-card"><span className="eyebrow">TEST PAGE / NO API KEY</span><h2>Shared ownership and evidence checks</h2><div className="lab30-toolbar"><button type="button" className="lab8-secondary" onClick={() => { setTests(runHarnessSuite()); setTestSource('browser'); }}>Run browser tests</button><button type="button" className="lab8-secondary" onClick={serverTests}>Run server tests</button></div>{tests ? <><p role="status">{tests.filter(test => test.passed).length} / {tests.length} passed · {testSource}</p><ul className="lab30-test-list">{tests.map(test => <li key={test.name}>{test.passed ? '✓' : '✗'} {test.name}</li>)}</ul></> : null}</section>
    <details className="code-lessons lab5-code" onToggle={event => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 31</span><span className="code-lessons-title" role="heading" aria-level={2}>How the harness lab was built</span><span className="code-lessons-hint">Six explained TypeScript snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action">View code</span></summary><div className="code-lessons-body"><p>Read each excerpt, trace its source file, then play its explanation. Viva voice uses browser speech synthesis; it does not call an audio API.</p><div className="lab30-toolbar"><button type="button" className="viva-button" disabled={!speechAvailable} aria-pressed={speaking?.all ?? false} onClick={() => speak(harnessLessons, true)}>{speaking?.all ? 'Stop reading all' : 'Viva voice · Read all six'}</button><button type="button" className="lab8-secondary" disabled={!speaking} onClick={stopSpeech}>Stop narration</button></div>{!speechAvailable ? <p>This browser does not support speech synthesis. Read the explanations below.</p> : null}{speechError ? <p role="alert">{speechError}</p> : null}<div className="code-lessons-grid">{harnessLessons.map(lesson => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.number === lesson.number ? ' is-speaking' : '')} disabled={!speechAvailable} aria-pressed={speaking?.number === lesson.number} onClick={() => speak([lesson], false)} aria-label={speaking?.number === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.number === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</button></article>)}</div></div></details>
    <section className="lab7-card"><span className="eyebrow">OFFICIAL REFERENCES / CHECKED 2026-09-28</span><h2>Architecture and state boundaries</h2><ul>{references.map(reference => <li key={reference.url}><a href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title}</a></li>)}</ul></section>
  </div>;
}
