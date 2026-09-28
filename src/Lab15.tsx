import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { AnswerPre } from './Lab6.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { shortId } from './lab13Recovery.ts';
import { bestUsage, durations, explainError, ms, parseServerSummary, parseUsage, retryLabels, sumUsage, summaryLine, tokens, totalLabel, usageChecks, type RunRecord, type Usage } from './lab15Usage.ts';
import { beforeReread, usageScenarios } from './lab15Scenarios.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Mode = 'normal' | 'cancel' | 'bad_model' | 'stop_early';
type Mark = { label: string; ms: number };

const lessons: Lesson[] = [
  { number: '01', title: 'Read usage from the turn outcome', file: 'server/lab15.ts', code: "if (terminal && rootTurn?.id === turnId) {\n  outcome = rootTurn.status; // completed, failed, or cancelled\n  // Best effort: the event's usage, else the turn's own.\n  usage = event.usage ?? rootTurn.usage ?? null;\n  apiTimes.startedAt = rootTurn.started_at ?? null;\n  apiTimes.completedAt = rootTurn.completed_at ?? null;\n}", explanation: 'Usage arrives with the root turn’s outcome. The completed, failed, and cancelled events each carry a usage field, and the turn object inside them has its own. Both are typed as token usage or null. The server keeps whichever is present and forwards it unchanged, so the browser decides what it means. It never writes zero in place of a missing value.' },
  { number: '02', title: 'Null is unknown, never zero', file: 'src/lab15Usage.ts', code: "export function parseUsage(raw: unknown): Usage | null {\n  if (typeof raw !== 'object' || raw === null) return null;\n  const input = count(raw.input_tokens);\n  const output = count(raw.output_tokens);\n  if (input === null || output === null) return null;\n  return { input, output, total: count(raw.total_tokens) ?? input + output,\n    cached: count(raw.input_tokens_details?.cached_tokens),\n    reasoning: count(raw.output_tokens_details?.reasoning_tokens) };\n}", explanation: 'The browser checks usage at its runtime boundary. Anything missing or malformed becomes null, and the page prints the word unknown. Cached tokens are a part of input and reasoning tokens are a part of output, so the summary shows them as breakdowns, never as extra lines to add. A total of zero would be a claim; unknown is the honest answer.' },
  { number: '03', title: 'Three clocks, three meanings', file: 'src/lab15Usage.ts', code: "// Our server, in milliseconds from sending the request:\nmark('firstTextMs', 'first text'); // what the user felt\nmark('endMs', 'turn.completed');   // what the user waited\n// The API, in whole Unix seconds:\nconst queued  = turn.started_at   - turn.created_at;\nconst working = turn.completed_at - turn.started_at;", explanation: 'Wall time and time to first text are measured by our server, from the moment it sends the request. They include network and session start-up, which is what the user experiences. The turn’s own timestamps come from the API in whole seconds. They show queueing and working time, but a one second turn may read as zero or one. Each duration is shown only when both of its ends are known.' },
  { number: '04', title: 'Re-read the saved turn', file: 'server/lab15.ts', code: "const [session, turn] = await Promise.all([\n  client.beta.agents.sessions.retrieve(sessionId),\n  client.beta.agents.sessions.turns.retrieve(turnId,\n    { session_id: sessionId }),\n]);\n// turn.usage and session.usage: best effort, may change.", explanation: 'Recorded usage may change after the stream ends. So the page reads the saved turn and the session again, which sends nothing and costs no tokens. The saved turn’s value replaces the event’s, and the summary says which source it trusts and when it was read. If the stream ended early, the re-read also shows the turn’s real outcome.' },
  { number: '05', title: 'Sum without pretending', file: 'src/lab15Usage.ts', code: "const sum = sumUsage(runs.map((run) => bestUsage(run).usage));\n// { total: 3_082, known: 3, unknown: 2 }\ntotalLabel(sum.total, sum); // '≥ 3,082'\n// The naive total adds null as 0 and prints '3,082'.", explanation: 'A dashboard total that adds unknown runs as zero looks precise and is wrong. The honest sum counts how many runs are unknown, adds only the known ones, and labels the result as at least that number. The history table shows both totals side by side, so the difference is visible. A rejected request is different again: no turn ran, so there is no usage at all.' },
  { number: '06', title: 'Explain the error, not just the message', file: 'src/lab15Usage.ts', code: "explainError({ source: 'turn', code: 'rate_limit_exceeded', … });\n// → { title: 'Rate limited', retry: 'later',\n//     advice: 'Wait and retry with backoff.' }\nexplainError({ source: 'stream', … });\n// → 'Read the saved turn before retrying, or you may pay twice.'", explanation: 'An error summary names where the failure happened, its HTTP status or its stable error code, and the message. The source matters: an HTTP rejection means nothing ran, a failed turn may still have used tokens, and a stream that ended without an outcome may still be running. The code decides the retry advice: retry later, change the request first, or do not retry.' },
];

const modes: { mode: Mode; label: string; hint: string }[] = [
  { mode: 'normal', label: 'Normal run', hint: 'Complete one turn and read its usage.' },
  { mode: 'cancel', label: 'Cancel after 160 characters', hint: 'The server sends agent.session.input.cancel mid-answer.' },
  { mode: 'bad_model', label: 'Unknown model', hint: 'A new session with a model no project has. Fails before or during the turn.' },
  { mode: 'stop_early', label: 'Stop reading early', hint: 'The server stops reading after 160 characters and sends nothing.' },
];

function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}

const newId = (): string => `run_${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)}`;

// Where the time went, from our server's clock. Unknown segments are left out, not drawn as zero.
function TimeBar({ run }: { run: RunRecord }) {
  const { clock } = run;
  const end = clock.endMs ?? Math.max(clock.firstTextMs ?? 0, clock.inProgressMs ?? 0, clock.turnCreatedMs ?? 0);
  if (!end) return <p className="lab8-note">No timing was measured: the request never produced an event.</p>;
  const points: Array<[string, string, number | null]> = [['setup', 'Session and turn start-up', clock.inProgressMs], ['think', 'Working before the first text', clock.firstTextMs], ['write', clock.endMs === null ? 'Writing (until the page stopped reading)' : 'Writing until the outcome', clock.endMs ?? end]];
  let from = 0;
  const segments = points.flatMap(([kind, label, to]) => {
    if (to === null || to < from) return [];
    const segment = { kind, label, from, to };
    from = to;
    return [segment];
  });
  return <div className="lab15-timebar">
    <div className="lab15-track" role="img" aria-label={segments.map((segment) => `${segment.label}: ${ms(segment.to - segment.from)}`).join('; ')}>{segments.map((segment) => <span key={segment.kind} className={'lab15-seg ' + segment.kind} style={{ width: `${Math.max(1.5, ((segment.to - segment.from) / end) * 100)}%` }} />)}{clock.endMs === null ? <span className="lab15-seg open" style={{ width: '8%' }} /> : null}</div>
    <ul className="lab15-legend">{segments.map((segment) => <li key={segment.kind}><i className={'lab15-seg ' + segment.kind} />{segment.label} <b>{ms(segment.to - segment.from)}</b></li>)}{clock.endMs === null ? <li><i className="lab15-seg open" />No outcome seen <b>unknown</b></li> : null}</ul>
  </div>;
}

function TokenGrid({ usage }: { usage: Usage | null }) {
  const cells: Array<[string, number | null | undefined, string]> = [['Input', usage?.input, ''], ['of which cached', usage?.cached, 'part of input'], ['Output', usage?.output, ''], ['of which reasoning', usage?.reasoning, 'part of output'], ['Total', usage?.total, 'input + output']];
  return <dl className="lab15-tokens">{cells.map(([label, value, note]) => <div key={label} className={(value === null || value === undefined ? 'unknown ' : '') + (note.startsWith('part') ? 'detail' : '')}><dt>{label}</dt><dd>{tokens(value)}</dd>{note ? <small>{note}</small> : null}</div>)}</dl>;
}

function RunSummary({ run, onReread, rereading }: { run: RunRecord; onReread?: () => void; rereading?: boolean }) {
  const { usage, source } = bestUsage(run);
  const help = run.error ? explainError(run.error) : null;
  return <div className="lab15-summary">
    <div className="lab15-summary-head"><span className={'lab15-outcome ' + run.outcome}>{run.outcome}</span>{run.savedStatus && run.savedStatus !== run.outcome ? <span className="lab15-saved">saved turn: {run.savedStatus}</span> : null}<span className="lab15-ids">{run.model ? <>model <code>{run.model}</code></> : null}{run.turnId ? <> · turn <code>{shortId(run.turnId)}</code></> : null}</span></div>
    <h3 className="lab13-subhead">Tokens <code>{source ? `from the ${source}${source === 'saved turn' && run.usage.rereadAt !== null ? `, read ${ms(run.usage.rereadAt)} after the run` : ''}` : run.outcome === 'rejected' ? 'none: no turn ran' : 'unknown'}</code></h3>
    <TokenGrid usage={usage} />
    <h3 className="lab13-subhead">Duration</h3>
    <TimeBar run={run} />
    <dl className="lab15-durations">{durations(run).map((item) => <div key={item.label} className={item.known ? '' : 'unknown'}><dt>{item.label}</dt><dd>{item.value}</dd><small>{item.note}</small></div>)}</dl>
    <h3 className="lab13-subhead">Checks</h3>
    <ul className="lab15-checks">{usageChecks(run).map((check, index) => <li key={index} className={check.ok === true ? 'ok' : check.ok === false ? 'bad' : 'note'}>{check.text}</li>)}</ul>
    {run.error && help ? <div className="lab15-error"><div className="lab15-error-head"><strong>{help.title}</strong><span className={'lab15-retry ' + help.retry}>{retryLabels[help.retry]}</span></div><dl><div><dt>Where</dt><dd>{run.error.source === 'http' ? 'HTTP request (before a turn existed)' : run.error.source === 'turn' ? 'Inside the turn' : 'The stream'}</dd></div><div><dt>Status</dt><dd>{run.error.status ?? '—'}</dd></div><div><dt>Code</dt><dd><code>{run.error.code ?? 'none'}</code></dd></div><div><dt>Message</dt><dd>{run.error.message}</dd></div></dl><p>{help.advice}</p></div> : null}
    <h3 className="lab13-subhead">Log line <code>never says 0 for unknown</code></h3>
    <pre className="lab15-line">{summaryLine(run)}</pre>
    {onReread ? <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={onReread} disabled={!run.sessionId || rereading}>{rereading ? 'Reading…' : 'Re-read saved usage'}</button></div> : null}
  </div>;
}

function History({ runs, selected, onSelect, sessionUsage }: { runs: RunRecord[]; selected?: string; onSelect?: (id: string) => void; sessionUsage?: Usage | null }) {
  const sum = sumUsage(runs.filter((run) => run.outcome !== 'rejected').map((run) => bestUsage(run).usage));
  const naive = runs.reduce((total, run) => total + (bestUsage(run).usage?.total ?? 0), 0);
  const wall = runs.filter((run) => run.clock.endMs !== null);
  return <div className="lab9-table-wrap lab15-history"><table>
    <thead><tr><th>Run</th><th>Outcome</th><th>Wall</th><th>First text</th><th>Input</th><th>Output</th><th>Total</th><th>Error</th></tr></thead>
    <tbody>{runs.map((run, index) => { const usage = bestUsage(run).usage; return <tr key={run.id} className={run.id === selected ? 'selected' : ''} onClick={onSelect ? () => onSelect(run.id) : undefined}>
      <th>{onSelect ? <button type="button" className="lab15-link" onClick={() => onSelect(run.id)} aria-pressed={run.id === selected}>#{index + 1}</button> : `#${index + 1}`}</th>
      <td><span className={'lab15-outcome ' + run.outcome}>{run.outcome}</span></td><td>{ms(run.clock.endMs)}</td><td>{ms(run.clock.firstTextMs)}</td>
      <td className={usage ? '' : 'unknown'}>{run.outcome === 'rejected' ? '—' : tokens(usage?.input)}</td><td className={usage ? '' : 'unknown'}>{run.outcome === 'rejected' ? '—' : tokens(usage?.output)}</td><td className={usage ? '' : 'unknown'}>{run.outcome === 'rejected' ? '—' : tokens(usage?.total)}</td>
      <td>{run.error ? <code>{run.error.code ?? run.error.status ?? run.error.source}</code> : '—'}</td></tr>; })}</tbody>
    <tfoot>
      <tr className="honest"><th colSpan={2}>Honest total</th><td>{wall.length ? ms(wall.reduce((total, run) => total + (run.clock.endMs ?? 0), 0)) : 'unknown'}{wall.length < runs.length ? ` (${wall.length} of ${runs.length})` : ''}</td><td /><td>{totalLabel(sum.input, sum)}</td><td>{totalLabel(sum.output, sum)}</td><td><b>{totalLabel(sum.total, sum)}</b></td><td>{sum.unknown ? `${sum.unknown} run${sum.unknown === 1 ? '' : 's'} unknown` : 'all known'}</td></tr>
      <tr className="naive"><th colSpan={2}>Naive total (null as 0)</th><td colSpan={4} /><td><s>{naive.toLocaleString('en-US')}</s></td><td>{sum.unknown ? 'looks exact, is too low' : 'same, this time'}</td></tr>
      {sessionUsage !== undefined ? <tr className="session"><th colSpan={2}>Session usage (API)</th><td colSpan={4} /><td>{tokens(sessionUsage?.total)}</td><td>session.usage, best effort</td></tr> : null}
    </tfoot>
  </table></div>;
}

export default function Lab15({ active, health }: { active: boolean; health: Health }) {
  const [prompt, setPrompt] = useState('Explain JavaScript closures in about 120 words with one short example.');
  const [mode, setMode] = useState<Mode>('normal');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState('');
  const [marks, setMarks] = useState<Mark[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rereading, setRereading] = useState(false);
  const [error, setError] = useState('');
  const [scenarioId, setScenarioId] = useState(usageScenarios[0].id);
  const [reread, setReread] = useState(true);
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const abort = useRef<AbortController | null>(null);
  const finishedAt = useRef(new Map<string, number>());
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const selected = runs.find((run) => run.id === selectedId) ?? runs.at(-1) ?? null;
  const sessionRuns = sessionId ? runs.filter((run) => run.sessionId === sessionId) : [];
  const lastSessionRead = [...sessionRuns].reverse().find((run) => run.usage.rereadAt !== null);
  const scenario = usageScenarios.find((item) => item.id === scenarioId) ?? usageScenarios[0];
  const scenarioRun = reread ? scenario.run : beforeReread(scenario.run);
  const playgroundRuns = usageScenarios.map((item) => (reread ? item.run : beforeReread(item.run)));

  async function rereadRun(target: RunRecord) {
    if (!target.sessionId) return;
    setRereading(true);
    try {
      const response = await fetch(`/api/lab15/usage?${new URLSearchParams({ sessionId: target.sessionId, turnId: target.turnId ?? '' })}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      const turn = body.turn as Record<string, unknown> | null;
      const num = (value: unknown) => (typeof value === 'number' ? value : null);
      setRuns((previous) => previous.map((run) => run.id !== target.id ? run : {
        ...run,
        savedStatus: typeof turn?.status === 'string' ? turn.status : run.savedStatus,
        api: turn ? { createdAt: num(turn.createdAt) ?? run.api.createdAt, startedAt: num(turn.startedAt) ?? run.api.startedAt, completedAt: num(turn.completedAt) ?? run.api.completedAt } : run.api,
        usage: { ...run.usage, turn: turn ? parseUsage(turn.usage) : run.usage.turn, session: parseUsage(body.session?.usage), rereadAt: Math.round(performance.now() - (finishedAt.current.get(run.id) ?? performance.now())) },
      }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not read saved usage.'); }
    finally { setRereading(false); }
  }

  async function runOnce() {
    const question = prompt.trim();
    if (!question || running) return;
    const controller = new AbortController();
    abort.current = controller;
    const id = newId();
    setRunning(true); setError(''); setAnswer(''); setMarks([]);
    let record: RunRecord | null = null;
    try {
      const response = await fetch('/api/lab15/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ prompt: question, sessionId: sessionId ?? '', mode }) });
      if (!response.ok) throw new Error((await response.json()).error || `Request failed (${response.status}).`);
      if (!response.body) throw new Error('The browser could not read the response stream.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const raw of lines) {
          if (!raw.trim()) continue;
          const line = JSON.parse(raw);
          if (line.type === 'session' && typeof line.sessionId === 'string') setSessionId(line.sessionId);
          if (line.type === 'text' && typeof line.text === 'string') setAnswer(line.text);
          if (line.type === 'mark' && typeof line.label === 'string' && typeof line.ms === 'number') setMarks((previous) => [...previous, { label: line.label, ms: line.ms }]);
          if (line.type === 'summary') {
            const summary = parseServerSummary(line.summary);
            record = { ...summary, id, prompt: question, usage: { event: summary.usage, turn: null, session: null, rereadAt: null }, savedStatus: null };
          }
        }
      }
      if (!record) throw new Error('The stream ended without a run summary.');
      const finished: RunRecord = record;
      finishedAt.current.set(id, performance.now());
      setRuns((previous) => [...previous, finished]);
      setSelectedId(id);
      // Usage may be recorded a moment after the outcome; read the saved turn once, shortly after.
      if (finished.sessionId && finished.turnId) setTimeout(() => void rereadRun(finished), 1500);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The run failed.');
    } finally {
      if (abort.current === controller) abort.current = null;
      setRunning(false);
    }
  }

  function newSession() { abort.current?.abort(); setSessionId(null); setAnswer(''); setMarks([]); setError(''); }
  function exportRuns() {
    const blob = new Blob([JSON.stringify(runs, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'lab15-run-summaries.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  useEffect(() => {
    if (!speechAvailable) return;
    const synthesis = window.speechSynthesis;
    const refresh = () => setVoices(synthesis.getVoices());
    refresh(); synthesis.addEventListener('voiceschanged', refresh);
    return () => synthesis.removeEventListener('voiceschanged', refresh);
  }, [speechAvailable]);
  useEffect(() => () => { abort.current?.abort(); if (speechAvailable) window.speechSynthesis.cancel(); }, [speechAvailable]);
  useEffect(() => { if (!active) stopSpeech(); }, [active]);

  function stopSpeech() { speechRun.current += 1; if (speechAvailable) window.speechSynthesis.cancel(); setSpeaking(null); }
  // Queue one or more explanations; the run counter ignores callbacks from cancelled narrations.
  function speak(queue: Lesson[], speechMode: 'one' | 'all') {
    if (!speechAvailable) return;
    stopSpeech();
    const run = speechRun.current;
    const narrator = selectNarratorVoice(voices.length ? voices : window.speechSynthesis.getVoices());
    queue.forEach((lesson, index) => {
      const utterance = new SpeechSynthesisUtterance(`${speechMode === 'all' ? `Snippet ${Number(lesson.number)}. ` : ''}${lesson.title}. ${lesson.explanation}`);
      if (narrator) utterance.voice = narrator;
      utterance.lang = narrator?.lang || 'en-US';
      utterance.pitch = narrator && masculineVoiceName.test(narrator.name) ? 1 : 0.78;
      utterance.rate = 0.95;
      utterance.onstart = () => { if (speechRun.current === run) setSpeaking({ mode: speechMode, lesson: lesson.number }); };
      utterance.onerror = () => { if (speechRun.current === run) setSpeaking(null); };
      if (index === queue.length - 1) utterance.onend = () => { if (speechRun.current === run) setSpeaking(null); };
      window.speechSynthesis.speak(utterance);
    });
    setSpeaking({ mode: speechMode, lesson: queue[0].number });
  }
  function readLesson(lesson: Lesson) { if (speaking?.lesson === lesson.number) stopSpeech(); else speak([lesson], 'one'); }
  function readAll() { if (speaking?.mode === 'all') stopSpeech(); else speak(lessons, 'all'); }

  return <div className="lab15-page">
    <div className="lab2-hero"><span className="lab2-badge lab15-badge">15/50</span><div><div className="eyebrow">LAB 15 / USAGE AND DURATION</div><h1>Show <em>usage</em> and duration.</h1><p>Every run should end with a summary a person can trust: how many tokens it used, how long it took, and what went wrong. Usage is best effort. When it is missing, the honest value is <em>unknown</em>, not zero.</p></div></div>

    <section className="lab7-card"><span className="eyebrow">LIVE RUN</span><h2>Run one turn and measure it</h2><p>Pick how the run should end, then run it. Each run adds a row to the history. Send several in the same session and compare the totals.</p>
      <label htmlFor="lab15-prompt">{sessionId ? 'Your follow-up (same session)' : 'Your question'}</label>
      <textarea id="lab15-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} disabled={running} />
      <fieldset className="lab15-modes"><legend>How should this run end?</legend>{modes.map((item) => <label key={item.mode} className={mode === item.mode ? 'selected' : ''}><input type="radio" name="lab15-mode" value={item.mode} checked={mode === item.mode} onChange={() => setMode(item.mode)} disabled={running} /><span><strong>{item.label}</strong><small>{item.hint}</small></span></label>)}</fieldset>
      <div className="lab8-actions">
        <button type="button" className="lab7-primary" onClick={() => void runOnce()} disabled={running || !health?.configured || !prompt.trim()}>{running ? 'Running…' : 'Run and measure'}</button>
        {sessionId && !running ? <button type="button" className="lab8-secondary" onClick={newSession}>New session</button> : null}
      </div>
      {!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env and restart the server for a live run. The playground below works without a key.</p> : null}
      {sessionId ? <p className="lab7-session-id">Session <code>{sessionId}</code>{mode === 'bad_model' ? ' · the unknown model always starts a new session' : ''}</p> : null}
      {marks.length ? <ol className="lab15-marks" aria-label="Timing marks">{marks.map((mark, index) => <li key={index}><code>{mark.label}</code><span>{ms(mark.ms)}</span></li>)}</ol> : null}
      {answer ? <div className="lab7-answer lab15-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{answer}</ReactMarkdown></div> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    <div className="lab15-grid">
      <section className="lab7-card"><span className="eyebrow">RUN SUMMARY</span><h2>{selected ? `Run #${runs.indexOf(selected) + 1}` : 'No run yet'}</h2>
        {selected ? <RunSummary run={selected} onReread={() => void rereadRun(selected)} rereading={rereading} /> : <p className="lab8-note">Run a turn to see its tokens, timing, checks, and any error. The page re-reads the saved turn 1.5 s after each run.</p>}
      </section>
      <section className="lab7-card"><span className="eyebrow">RUN HISTORY</span><h2>Totals that admit what they do not know</h2>
        {runs.length ? <><History runs={runs} selected={selected?.id} onSelect={setSelectedId} sessionUsage={lastSessionRead ? lastSessionRead.usage.session : undefined} /><div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={exportRuns}>Download JSON</button></div><p className="lab8-note">Select a row to see its summary. Session usage comes from the latest re-read in the current session and covers every turn in it, including ones this page did not run.</p></> : <p className="lab8-note">No runs yet.</p>}
      </section>
    </div>

    <section className="lab7-card" id="lab15-playground"><span className="eyebrow">USAGE PLAYGROUND · NO API KEY NEEDED</span><h2>Seven runs, seven summaries</h2><p>Each case is a scripted run in the same shape as the live summary, and the same functions read it. Turn off the re-read to see only what the stream reported.</p>
      <p className="lab15-label">Field names and error codes come from the SDK’s types. The numbers, IDs, and timings are fixtures, not recordings.</p>
      <div className="lab15-playground-controls">
        <div><label htmlFor="lab15-scenario">Case</label><select id="lab15-scenario" className="lab12-select" value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>{usageScenarios.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
        <label className="lab15-toggle"><input type="checkbox" checked={reread} onChange={(event) => setReread(event.target.checked)} /> Re-read the saved turn</label>
      </div>
      <p className="lab8-note">{scenario.summary}</p>
      <p className="lab15-lesson"><strong>Lesson:</strong> {scenario.lesson}</p>
      <RunSummary run={scenarioRun} />
      <h3 className="lab13-subhead">All seven as one history <code>honest vs naive</code></h3>
      <History runs={playgroundRuns} selected={scenarioRun.id} onSelect={(runId) => setScenarioId(usageScenarios.find((item) => item.run.id === runId)?.id ?? scenarioId)} />
    </section>

    <section className="lab3-guide lab15-guide"><h2>Read the evidence</h2><div><article><strong>Unknown</strong><p>null usage is unknown. Show the word, and keep it out of sums.</p></article><article><strong>None</strong><p>A rejected request never ran. No turn, no usage.</p></article><article><strong>Clocks</strong><p>Our server measures what the user waited. The API’s turn timestamps are whole seconds.</p></article><article><strong>Latest read</strong><p>Recorded usage may change. Re-read the saved turn before storing it.</p></article></div><p className="lab3-guide-note">Usage is not a bill. It is a best-effort record of tokens; pricing, credits, and limits are applied elsewhere.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 15</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind the run summary</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Capture usage at the outcome, parse it honestly, measure three clocks, re-read the saved turn, sum without pretending, and explain the error. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>In one session, make four runs: a <em>Normal run</em>, a <em>Cancel after 160 characters</em>, a <em>Stop reading early</em>, and an <em>Unknown model</em>. Show the history table and explain four results: why the cancelled run still used tokens, why the stopped run was unknown until you re-read it, why the unknown-model run has no usage at all, and why the naive total can be lower than the honest one.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/observability" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
