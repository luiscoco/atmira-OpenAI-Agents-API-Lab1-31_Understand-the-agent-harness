import { useEffect, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { codeTokens } from './Lab22.tsx';
import { selectNarratorVoice } from './speech.ts';
import { buildRuleRequest, conventions, defaultOptions, practiceAnswer, resolveRules, ruleFiles, verifyReport, workspaceScript, type RuleOptions } from './lab33Rules.ts';
import { rulesLessons } from './lab33Lessons.ts';
import { runRulesSuite } from './lab33Tests.ts';
import type { RulesResult } from '../server/lab33Service.ts';

function download(text: string, filename: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type })); const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function json(url: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(url, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Request failed.'); return value;
}
type Comparison = { options: RuleOptions; results: Array<Omit<RulesResult, 'source'> & { source: string }> };
export default function Lab33({ active }: { active: boolean }) {
  const [options, setOptions] = useState<RuleOptions>({ ...defaultOptions });
  const [selectedFile, setSelectedFile] = useState('AGENTS.md');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [status, setStatus] = useState<{ configured: boolean; model: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [tests, setTests] = useState<ReturnType<typeof runRulesSuite> | null>(null); const [testSource, setTestSource] = useState('');
  const [notes, setNotes] = useState(''); const [speaking, setSpeaking] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null); const speechRun = useRef(0); const utterances = useRef<SpeechSynthesisUtterance[]>([]);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  function stopSpeech() { speechRun.current++; if (speechAvailable) window.speechSynthesis.cancel(); utterances.current = []; setSpeaking(null); }
  useEffect(() => {
    if (!active) { request.current?.abort(); stopSpeech(); return; }
    const controller = new AbortController();
    void json('/api/lab33/status', undefined, controller.signal).then(setStatus).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [active]);
  useEffect(() => () => { request.current?.abort(); speechRun.current++; if (speechAvailable) window.speechSynthesis.cancel(); }, []);
  function speak(queue: typeof rulesLessons, all = false) {
    const marker = all ? 'all' : queue[0].number;
    if (speaking === marker) { stopSpeech(); return; }
    stopSpeech(); if (!speechAvailable) return;
    const run = speechRun.current; const voice = selectNarratorVoice(window.speechSynthesis.getVoices());
    utterances.current = queue.map((lesson, index) => {
      const utterance = new SpeechSynthesisUtterance(`${lesson.title}. ${lesson.explanation}`);
      if (voice) utterance.voice = voice; utterance.lang = voice?.lang || 'en-US'; utterance.rate = .95;
      utterance.onend = () => { if (run === speechRun.current && index === queue.length - 1) setSpeaking(null); };
      utterance.onerror = () => { if (run === speechRun.current) { stopSpeech(); setError('Narration could not play. Try an installed English voice.'); } };
      return utterance;
    });
    setSpeaking(marker); utterances.current.forEach(utterance => window.speechSynthesis.speak(utterance));
  }
  const sources = resolveRules(options); const files = ruleFiles(options); const expected = conventions(sources);
  function practice() {
    const results = [false, true].map(guided => {
      const request = buildRuleRequest(options, guided);
      const answer = guided ? practiceAnswer(options) : JSON.stringify({ path: 'report.md', title: 'Revenue', markdown: '# Revenue\n\nGrand total: 52 EUR. Source: data/sales.csv.' }, null, 2);
      return { mode: guided ? 'guided' as const : 'unguided' as const, source: 'synthetic practice', sources: request.sources, instructions: request.instructions, sessionId: null, outcome: 'completed', answer, cleanup: 'not created', error: null, checks: verifyReport(answer, sources) };
    });
    setComparison({ options: { ...options }, results }); setError('');
  }
  async function compare() {
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try { const data = await json('/api/lab33/compare', options, controller.signal); if (!controller.signal.aborted) setComparison(data); }
    catch (failure) { setError(controller.signal.aborted ? 'Comparison stopped. The server attempts cancellation and session cleanup.' : failure.message); }
    finally { if (request.current === controller) request.current = null; setBusy(false); }
  }
  async function serverTests() {
    try { setTests((await json('/api/lab33/test', {})).results); setTestSource('server'); } catch (failure) { setError(failure.message); }
  }
  return <div className="lab16-page lab31-page lab32-page lab33-page">
    <section className="lab-hero"><span className="eyebrow">LAB 33 / PROJECT INSTRUCTIONS</span><h1>Apply project rules with AGENTS.md</h1><p>Find the active instruction sources, compare scoped conventions, and verify what the chosen runtime actually loads.</p><div className="lab26-hero-badges"><span>Directory scope</span><span>Overrides</span><span>Observed evidence</span></div></section>
    <section className="lab7-card"><span className="eyebrow">DISCOVERY EXPLORER / NO KEY REQUIRED</span><h2>Follow the repository instruction chain</h2><p>This fixture explorer models Codex project discovery from repository root to starting directory. Codex also loads global guidance from its home directory and applies a configurable instruction size limit (32 KiB by default). Start a new Codex run after changing instructions.</p>
      <label htmlFor="lab33-cwd">Starting directory</label><select id="lab33-cwd" value={options.cwd} disabled={busy} onChange={event => setOptions({ ...options, cwd: event.target.value })}><option value="">Repository root</option><option value="reports">reports</option><option value="reports/private">reports/private</option><option value="data">data</option></select>
      <div className="lab33-toggles"><label><input type="checkbox" checked={options.override} disabled={busy} onChange={event => setOptions({ ...options, override: event.target.checked })} /> Include reports/AGENTS.override.md</label><label><input type="checkbox" checked={options.fallback} disabled={busy} onChange={event => setOptions({ ...options, fallback: event.target.checked })} /> Configure TEAM_GUIDE.md as a fallback</label></div>
      <label htmlFor="lab33-root">Write repository guidance (AGENTS.md)</label><textarea id="lab33-root" rows={7} maxLength={4000} disabled={busy} value={options.root} onChange={event => setOptions({ ...options, root: event.target.value })} /><p className="lab8-note">The Title, Output, and Sections bullets are fixture conventions used by the checker. AGENTS.md itself is ordinary Markdown. Empty guidance is ignored; live comparison requires nonempty repository guidance.</p>
      <div className="lab33-grid"><div><h3>Fixture files</h3><label htmlFor="lab33-file">Inspect a file</label><select id="lab33-file" value={files.some(file => file.path === selectedFile) ? selectedFile : 'AGENTS.md'} onChange={event => setSelectedFile(event.target.value)}>{files.map(file => <option key={file.path}>{file.path}</option>)}</select><pre className="lab32-code">{(files.find(file => file.path === selectedFile) ?? files[0]).content || '(empty file — skipped)'}</pre></div><div><h3>Selected sources, in order</h3>{sources.length ? <ol>{sources.map(file => <li key={file.path}><code>{file.path}</code></li>)}</ol> : <p>No nonempty guidance discovered.</p>}<pre className="lab32-code">{sources.map(file => `# Source: ${file.path}\n${file.content}`).join('\n')}</pre></div></div>
      <div className="lab31-facts"><span><strong>Report title</strong>{expected.title || 'Not specified'}</span><span><strong>Output filename</strong>{expected.path || 'Not specified'}</span><span><strong>Sections</strong>{expected.sections.join(', ') || 'Not specified'}</span></div><p>An override replaces the ordinary instruction file in its directory. Ancestor guidance remains. Descendant and sibling directories are outside the starting-directory discovery chain.</p>
      <button type="button" className="lab8-secondary" disabled={busy} onClick={() => setOptions({ ...defaultOptions })}>Reset fixture</button>
    </section>
    <section className="lab7-card"><span className="eyebrow">COMPARE GUIDED AND UNGUIDED WORK</span><h2>Inspect the loading path and the proposed report</h2><p>The API variant sends selected fixture guidance explicitly as <code>agent.instructions</code>. It supplies the CSV as prompt text and uses <code>environment: {'{ type: "none" }'}</code>. The result is proposed file content; no filesystem read or write is claimed. Both fresh sessions receive the same model and task.</p><p>Application key: {status?.configured ? 'Configured on server' : 'Not configured or checking'} · Model: {status?.model ?? 'Checking…'}</p><div className="lab30-toolbar"><button type="button" className="lab8-secondary" disabled={busy || !options.root.trim()} onClick={practice}>Show synthetic comparison</button><button type="button" className="lab8-run" disabled={busy || !status?.configured || !options.root.trim()} onClick={compare}>{busy ? 'Comparing…' : 'Run live API comparison'}</button><button type="button" className="lab8-secondary" disabled={!busy} onClick={() => request.current?.abort()}>Stop comparison</button></div><p className="lab8-note">Live comparison makes two API runs and has a two-minute deadline. The server attempts cancellation for unfinished work and deletes created sessions. Synthetic output is illustrative; an unguided model may still satisfy conventions by chance.</p>{error ? <p role="alert" className="lab31-error">{error}</p> : null}
      {comparison ? <><p>Captured directory: <code>/{comparison.options.cwd}</code>. Results retain the guidance used at run time; editing the explorer does not change this evidence.</p><div className="lab33-grid">{comparison.results.map(result => <article key={result.mode} className="lab33-result"><h3>{result.mode === 'guided' ? 'With project guidance' : 'Without project guidance'}</h3><p><strong>{result.source}</strong> · Root outcome: {result.outcome}</p><p>Session: <code>{result.sessionId ?? 'none'}</code> · Cleanup: {result.cleanup}</p><p>Loaded sources: {result.sources.map(file => file.path).join(' → ') || 'none'}</p><details><summary>Exact instructions submitted</summary><pre className="lab32-code">{result.instructions}</pre></details>{result.error ? <p role="status" className="lab31-error">{result.error}</p> : null}<pre className="lab32-code">{result.answer || 'No answer observed.'}</pre><ul className="lab32-checks">{result.checks.map(check => <li key={check.name} className={check.passed ? 'lab29-ok' : 'lab31-error'}>{check.passed ? 'PASS' : 'NOT VERIFIED'} · {check.name}</li>)}</ul></article>)}</div></> : null}
    </section>
    <section className="lab7-card"><span className="eyebrow">CODEX BASELINE / REAL FILE TASK</span><h2>Verify native discovery in a fresh workspace</h2><p>Download the Node scaffold, run it from an empty exercise folder, then open the generated Git workspace in Codex. It creates only the displayed fixture files. It refuses to overwrite an existing <code>lab33-workspace</code> directory.</p><button type="button" className="lab8-secondary" onClick={() => download(workspaceScript(options), 'lab33-workspace.mjs')}>Download Codex workspace scaffold</button><pre className="lab32-code">{`node ./lab33-workspace.mjs\ncd lab33-workspace\ncodex --sandbox workspace-write "List your loaded instruction sources. Read data/sales.csv and create the Markdown sales report required by project guidance."\n\n# Start a fresh run in the scoped directory:\ncodex --cd reports --sandbox workspace-write "List your loaded instruction sources. Read ../data/sales.csv and create the Markdown sales report required by project guidance."`}</pre><p>For <code>TEAM_GUIDE.md</code>, configure <code>project_doc_fallback_filenames = ["TEAM_GUIDE.md"]</code> in the selected Codex profile. Compare a root run, a reports run, and a reports/private run. Rename the override and restart Codex to compare ordinary report guidance. Record Codex version, starting directory, global sources, selected profile, actual report diff, and runtime instruction evidence. See LAB33.md for the complete walkthrough.</p><p className="lab8-note">AGENTS.md guides behavior. Filesystem permissions, sandbox policy, and tool configuration enforce access. A rule saying “do not change the CSV” does not itself block writes.</p>
    </section>
    <section className="lab7-card"><span className="eyebrow">STUDENT EVIDENCE</span><h2>Explain scope and enforcement</h2><label htmlFor="lab33-notes">Which source won each convention, how was it loaded, and what does the evidence establish?</label><textarea id="lab33-notes" rows={5} value={notes} maxLength={5000} onChange={event => setNotes(event.target.value)} /><div className="lab30-toolbar"><button type="button" className="lab8-secondary" disabled={!comparison} onClick={() => download(JSON.stringify({ comparison, notes }, null, 2), 'lab33-evidence.json', 'application/json')}>Export comparison evidence</button><button type="button" className="lab8-secondary" onClick={() => download(`# Lab 33 — Project rules\n\n${notes}\n\nCurrent fixture sources:\n${sources.map(file => `- ${file.path}`).join('\n')}\n\nAPI comparison creates proposed content, not filesystem evidence. Attach your actual Codex instruction log and report diff separately.\n`, 'lab33-notes.md', 'text/markdown')}>Download student notes</button></div><p>Challenge: demonstrate a scoped override, restore ordinary guidance, disable fallback discovery, and capture both a convention match and a meaningful failure. Explain why a matching report alone cannot establish filesystem access or permission enforcement.</p></section>
    <section className="lab7-card"><span className="eyebrow">SHARED TEST PAGE / NO KEY REQUIRED</span><h2>Check discovery and report rules</h2><div className="lab30-toolbar"><button type="button" className="lab8-secondary" onClick={() => { setTests(runRulesSuite()); setTestSource('browser'); }}>Run browser tests</button><button type="button" className="lab8-secondary" onClick={serverTests}>Run server tests</button></div>{tests ? <><p role="status">{tests.filter(row => row.passed).length} / {tests.length} passed · {testSource}</p><ul className="lab30-test-list">{tests.map(row => <li key={row.name}>{row.passed ? 'PASS' : 'FAIL'} · {row.name}</li>)}</ul></> : null}</section>
    <details className="code-lessons lab5-code" onToggle={event => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 33</span><span className="code-lessons-title" role="heading" aria-level={2}>How the project rules lab was built</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action">View code</span></summary><div className="code-lessons-body"><div className="lab30-toolbar"><button type="button" className="viva-button" disabled={!speechAvailable} aria-pressed={speaking === 'all'} onClick={() => speak(rulesLessons, true)}>Viva voice · Read all six</button><button type="button" className="lab8-secondary" disabled={!speaking} onClick={stopSpeech}>Stop narration</button></div>{!speechAvailable ? <p>Speech synthesis is unavailable. Read the explanations below.</p> : null}<div className="code-lessons-grid">{rulesLessons.map(lesson => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className="viva-button" disabled={!speechAvailable} aria-pressed={speaking === lesson.number} onClick={() => speak([lesson])}>Viva voice · Read aloud</button></article>)}</div></div></details>
    <section className="lab7-card"><span className="eyebrow">OFFICIAL REFERENCES / CHECKED 2026-10-04</span><h2>Project instructions and runtime boundaries</h2><ul><li><a href="https://learn.chatgpt.com/docs/agent-configuration/agents-md" target="_blank" rel="noopener noreferrer">Codex project instructions and discovery</a></li><li><a href="https://developers.openai.com/api/docs/guides/agents-api/configuration" target="_blank" rel="noopener noreferrer">Agents API configuration</a></li><li><a href="https://developers.openai.com/api/docs/guides/agents-api/environments/security" target="_blank" rel="noopener noreferrer">Sandbox security</a></li></ul></section>
  </div>;
}
