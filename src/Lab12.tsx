import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { AnswerPre } from './Lab6.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { buildTimeline, collapseDeltas, parseTimelineEvent, shortId, shortType, type Category, type Row, type RowGroup, type Timeline, type TimelineEvent, type TurnGroup } from './lab12Timeline.ts';
import { scenarios } from './lab12Scenarios.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type RunEvent =
  | { type: 'status'; label: string }
  | { type: 'session'; sessionId: string }
  | { type: 'event'; event: TimelineEvent }
  | { type: 'answer'; turnId: string; text: string }
  | { type: 'done'; outcome: string; message: string | null; idleObserved: boolean }
  | { type: 'error'; message: string };

const lessons: Lesson[] = [
  { number: '01', title: 'Forward the same shape for every event', file: 'server/lab12.ts', code: "function normalize(event, at: number) {\n  const base = { eventId: event.event_id, type: event.type, at,\n    turnId: event.turn_id ?? null, itemId: null, itemType: null,\n    status: null, subagentId: null, detail: null };\n  if (event.turn) return { ...base, turnId: event.turn.id,\n    status: event.turn.status, subagentId: event.turn.subagent_id ?? null };\n  if (event.item) return { ...base, itemId: event.item.id, itemType: event.item.type };\n  if (event.session) return { ...base, status: event.session.status };\n  return base;\n}", explanation: 'Before an event leaves the server, it is reduced to one small shape: its event ID, its type, the time the server received it, and whichever turn, item, and status fields it carries. Turn events carry a turn object, item events carry an item, and session events carry the session status. Prompt and answer text are left out, so the timeline shows structure, not content. The API key never leaves the server.' },
  { number: '02', title: 'Place each event in its turn', file: 'src/lab12Timeline.ts', code: "// Text events may omit turn_id; fall back to the turn in which their item started.\nconst fromItem = event.itemId ? itemTurns.get(event.itemId) ?? null : null;\nconst turnId = event.turnId ?? fromItem;\nif (turnId && event.itemId && !itemTurns.has(event.itemId))\n  itemTurns.set(event.itemId, turnId);\nif (!turnId) { sessionRows.push(row); continue; }", explanation: 'Grouping starts with one question: which turn does this event belong to? Turn events and item events name their turn. A text delta can have a null turn ID, so the timeline remembers the turn in which each item started and uses it as a fallback. Session status, environment, and subagent lifecycle events have no turn, so they go to the session lane.' },
  { number: '03', title: 'Number the order and skip replays', file: 'src/lab12Timeline.ts', code: "for (const event of events) {\n  // A reconnect can deliver an event again. Its event ID has already been placed.\n  if (seen.has(event.eventId)) { duplicates += 1; continue; }\n  seen.add(event.eventId);\n  const row: Row = { seq: rows.length + 1,\n    offsetMs: Math.max(0, event.at - start), event, /* … */ };\n  rows.push(row);\n}", explanation: 'Stream events have no sequence number or timestamp, so the timeline numbers them in arrival order and uses the time the server received each one. A replayed event has the same event ID as one already placed, so it is counted and skipped. The timeline is rebuilt from the full event list on every render, so the same list always produces the same timeline.' },
  { number: '04', title: 'Flag events out of place', file: 'src/lab12Timeline.ts', code: "if (!turn) {\n  turn = newTurn(turnId, row);\n  if (event.type !== 'agent.session.turn.created')\n    warnings.push(`turn ${turnId} first appeared in ${event.type}`);\n}\nif (terminalStatuses.includes(turn.status) && row.category !== 'turn')\n  warnings.push(`${event.type} arrived after the turn was ${turn.status}`);", explanation: 'A timeline is also a check. A turn normally begins with a turn created event, so a turn that first appears in another event means the page connected late. An item or text event that arrives after its turn completed, failed, or was cancelled is flagged, because it must not change an answer that is already final.' },
  { number: '05', title: 'End on the root turn, then wait for idle', file: 'server/lab12.ts', code: "const rootTerminal = isTurnOutcome(event.type)\n  && event.turn.subagent_id == null && !earlierTurns.has(event.turn.id);\nif (rootTerminal && !outcome) {\n  outcome = event.turn.status;\n  graceTimer = setTimeout(() => stream?.controller.abort(), idleGraceMs);\n} else if (outcome && event.type === 'agent.session.idle') {\n  idleObserved = true;\n  break;\n}", explanation: 'The outcome of a run comes from the root turn: completed, failed, or cancelled. A subagent turn can complete first, and that must not end the run. After the root outcome, the server reads for up to three more seconds so the timeline can show the session becoming idle. Turns that already existed before a follow-up are ignored, so a replayed outcome cannot end the new turn early.' },
  { number: '06', title: 'Collapse deltas for display only', file: 'src/lab12Timeline.ts', code: "export function collapseDeltas(rows: Row[]): RowGroup[] {\n  const groups: RowGroup[] = [];\n  for (const row of rows) {\n    const last = groups.at(-1);\n    const isDelta = row.event.type.endsWith('.delta');\n    if (isDelta && last?.kind === 'deltas' && sameItem(last, row)) last.rows.push(row);\n    else groups.push(isDelta ? { kind: 'deltas', rows: [row] } : { kind: 'single', row });\n  }\n  return groups;\n}", explanation: 'One answer can produce hundreds of text deltas, which hides the lifecycle events that matter. For display, consecutive deltas for the same item are folded into one row with a count and the first and last sequence numbers. The timeline itself still holds every event, so turning the option off shows them all again.' },
];

const categories: Array<[Category, string]> = [['session', 'Session'], ['environment', 'Environment'], ['subagent', 'Subagent'], ['turn', 'Turn status'], ['item', 'Item'], ['text', 'Text'], ['reasoning', 'Reasoning'], ['error', 'Error']];

function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}
function parseRunEvent(value: unknown): RunEvent {
  if (!value || typeof value !== 'object' || !('type' in value)) throw new Error('Invalid stream event.');
  const event = value as Record<string, unknown>;
  if (event.type === 'status' && typeof event.label === 'string') return { type: 'status', label: event.label };
  if (event.type === 'session' && typeof event.sessionId === 'string') return { type: 'session', sessionId: event.sessionId };
  if (event.type === 'event') return { type: 'event', event: parseTimelineEvent(event.event) };
  if (event.type === 'answer' && typeof event.turnId === 'string' && typeof event.text === 'string') return { type: 'answer', turnId: event.turnId, text: event.text };
  if (event.type === 'done' && typeof event.outcome === 'string' && typeof event.idleObserved === 'boolean') return { type: 'done', outcome: event.outcome, message: typeof event.message === 'string' ? event.message : null, idleObserved: event.idleObserved };
  if (event.type === 'error' && typeof event.message === 'string') return { type: 'error', message: event.message };
  throw new Error('Invalid stream event.');
}
async function runStream(body: { prompt: string; sessionId: string }, onEvent: (event: RunEvent) => void) {
  const response = await fetch('/api/lab12/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) { const payload = await response.json(); throw new Error(payload.error || `Request failed (${response.status}).`); }
  if (!response.body) throw new Error('The browser could not read the response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = parseRunEvent(JSON.parse(line));
        onEvent(event);
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'done') finished = true;
      }
    }
  } finally { reader.releaseLock(); }
  if (!finished) throw new Error('The stream ended before the root turn reached an outcome. The timeline may be incomplete.');
}

const formatMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);
function rowMeta(row: Row): string {
  const { itemId, itemType, status, detail } = row.event;
  return [itemId ? `${shortId(itemId)}${itemType ? ` (${itemType})` : ''}` : null, status, detail, row.inferred ? 'turn from item' : null].filter(Boolean).join(' · ');
}

function Swimlanes({ timeline, currentSeq }: { timeline: Timeline; currentSeq: number | null }) {
  const total = timeline.rows.length;
  if (!total) return <p className="lab8-note">No events yet.</p>;
  const x = (seq: number) => `${((seq - 0.5) / total) * 100}%`;
  const lanes = [
    { key: 'session', label: 'Session', sub: 'no turn ID', rows: timeline.sessionRows, turn: null as TurnGroup | null },
    ...timeline.turns.map((turn) => ({ key: turn.turnId, label: turn.label, sub: shortId(turn.turnId), rows: turn.rows, turn })),
  ];
  return <div className="lab12-lanes">
    <div className="lab12-lanes-inner" role="img" aria-label={`${total} events in arrival order across ${lanes.length} lanes. The turn cards below list every event.`}>
      {lanes.map((lane) => <div className={'lab12-lane' + (lane.turn?.subagentId ? ' subagent' : '')} key={lane.key}>
        <div className="lab12-lane-label"><strong>{lane.label}</strong><small>{lane.sub}</small></div>
        <div className="lab12-track">
          {lane.turn ? <span className={'lab12-span ' + lane.turn.status} style={{ left: x(lane.turn.firstSeq), width: `${((lane.turn.lastSeq - lane.turn.firstSeq) / total) * 100}%` }} /> : null}
          {lane.rows.map((row) => <span key={row.seq} className={`lab12-dot ${row.category}${row.seq === currentSeq ? ' current' : ''}`} style={{ left: x(row.seq) }} title={`#${row.seq} ${shortType(row.event.type)}`} />)}
        </div>
      </div>)}
      <div className="lab12-axis"><span>#1</span><span>arrival order →</span><span>#{total}</span></div>
    </div>
    <ul className="lab12-legend" aria-label="Event categories">{categories.map(([category, label]) => <li key={category}><span className={'lab12-dot static ' + category} />{label}</li>)}</ul>
  </div>;
}

function RowLine({ row, current }: { row: Row; current: boolean }) {
  return <li className={current ? 'current' : undefined} aria-current={current ? 'step' : undefined}><span className="lab12-seq">#{row.seq}</span><span className="lab12-time">+{formatMs(row.offsetMs)}</span><span className={'lab12-chip ' + row.category}>{shortType(row.event.type)}</span><span className="lab12-meta">{rowMeta(row)}</span></li>;
}

function EventList({ rows, collapse, currentSeq }: { rows: Row[]; collapse: boolean; currentSeq: number | null }) {
  if (!rows.length) return <p className="lab8-note">No events in this lane yet.</p>;
  const groups: RowGroup[] = collapse ? collapseDeltas(rows) : rows.map((row) => ({ kind: 'single', row }));
  return <ol className="lab12-list">{groups.map((group) => {
    if (group.kind === 'single' || group.rows.length === 1) { const row = group.kind === 'single' ? group.row : group.rows[0]; return <RowLine key={row.seq} row={row} current={row.seq === currentSeq} />; }
    const first = group.rows[0];
    const last = group.rows[group.rows.length - 1];
    const current = currentSeq !== null && group.rows.some((row) => row.seq === currentSeq);
    return <li key={first.seq} className={'collapsed' + (current ? ' current' : '')} aria-current={current ? 'step' : undefined}><span className="lab12-seq">#{first.seq}–{last.seq}</span><span className="lab12-time">+{formatMs(first.offsetMs)}</span><span className={'lab12-chip ' + first.category}>{shortType(first.event.type)} × {group.rows.length}</span><span className="lab12-meta">{first.event.itemId ? shortId(first.event.itemId) : ''}{first.inferred ? ' · turn from item' : ''} · {formatMs(last.offsetMs - first.offsetMs)} of deltas</span></li>;
  })}</ol>;
}

function TimelineView({ timeline, collapse, currentSeq, answers }: { timeline: Timeline; collapse: boolean; currentSeq: number | null; answers: Record<string, string> }) {
  const roots = timeline.turns.filter((turn) => !turn.subagentId).length;
  return <>
    <div className="lab12-stats">
      <div><span>Events placed</span><strong>{timeline.rows.length}</strong></div>
      <div><span>Turns</span><strong>{roots} root{timeline.turns.length > roots ? ` · ${timeline.turns.length - roots} subagent` : ''}</strong></div>
      <div><span>Replays skipped</span><strong>{timeline.duplicates}</strong></div>
      <div><span>Latest root outcome</span><strong className={'lab12-status ' + timeline.rootOutcome}>{timeline.rootOutcome}</strong></div>
    </div>
    <Swimlanes timeline={timeline} currentSeq={currentSeq} />
    {timeline.warnings.length ? <div className="lab12-warnings" role="note"><strong>Order checks</strong><ul>{timeline.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
    <div className="lab12-turns">
      <article className="lab12-turn session"><header><div><span className="eyebrow">SESSION LANE</span><h3>Events without a turn</h3></div><span className="lab12-count">{timeline.sessionRows.length}</span></header><p className="lab8-note">Session status, environment, and subagent lifecycle events. They sit between turns in arrival order.</p><EventList rows={timeline.sessionRows} collapse={collapse} currentSeq={currentSeq} /></article>
      {timeline.turns.map((turn) => <article className={'lab12-turn' + (turn.subagentId ? ' subagent' : '')} key={turn.turnId}>
        <header><div><span className="eyebrow">{turn.subagentId ? `SUBAGENT · ${turn.subagentId}` : 'ROOT TURN'}</span><h3>{turn.label} <code>{turn.turnId}</code></h3></div><span className={'lab12-status ' + turn.status}>{turn.status}</span></header>
        <p className="lab8-note">Events #{turn.firstSeq}–#{turn.lastSeq} · {turn.rows.length} event{turn.rows.length === 1 ? '' : 's'} · {turn.itemIds.length} item{turn.itemIds.length === 1 ? '' : 's'} · {formatMs(turn.durationMs)} from first to last event{turn.sawCreated ? '' : ' · created event not observed'}</p>
        <EventList rows={turn.rows} collapse={collapse} currentSeq={currentSeq} />
        {answers[turn.turnId] ? <details className="lab12-answer"><summary>Answer text for this turn</summary><div className="lab7-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{answers[turn.turnId]}</ReactMarkdown></div></details> : null}
      </article>)}
    </div>
  </>;
}

export default function Lab12({ active, health }: { active: boolean; health: Health }) {
  const [prompt, setPrompt] = useState('Explain what a JavaScript Promise is in three sentences.');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Not started');
  const [error, setError] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [liveEvents, setLiveEvents] = useState<TimelineEvent[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [collapse, setCollapse] = useState(true);
  const [replayId, setReplayId] = useState(scenarios[0].id);
  const [recorded, setRecorded] = useState<TimelineEvent[]>([]);
  const [recordedAnswers, setRecordedAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const liveTimeline = useMemo(() => buildTimeline(liveEvents), [liveEvents]);
  const scenario = replayId === 'live' ? { id: 'live', title: 'Your live session', summary: 'The exact events your live session forwarded, placed by the same timeline builder.', events: recorded, answers: recordedAnswers } : scenarios.find((item) => item.id === replayId) ?? scenarios[0];
  const replayTimeline = useMemo(() => buildTimeline(scenario.events.slice(0, step)), [scenario.events, step]);
  const currentEvent = step > 0 ? scenario.events[step - 1] : null;
  const currentReplayed = currentEvent !== null && scenario.events.slice(0, step - 1).some((event) => event.eventId === currentEvent.eventId);
  const currentSeq = currentEvent && !currentReplayed ? replayTimeline.rows.length : null;
  const atEnd = step >= scenario.events.length;
  // Like the server, reveal a turn's answer only after its message item is done.
  const replayAnswers = Object.fromEntries(Object.entries(scenario.answers).filter(([turnId]) => replayTimeline.rows.some((row) => row.turnId === turnId && row.event.type === 'agent.session.turn.item.done' && row.event.itemType === 'message')));

  useEffect(() => {
    if (!playing) return;
    if (atEnd) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setStep((value) => value + 1), 450);
    return () => window.clearTimeout(timer);
  }, [playing, step, atEnd]);
  useEffect(() => {
    if (!speechAvailable) return;
    const synthesis = window.speechSynthesis;
    const refresh = () => setVoices(synthesis.getVoices());
    refresh(); synthesis.addEventListener('voiceschanged', refresh);
    return () => synthesis.removeEventListener('voiceschanged', refresh);
  }, [speechAvailable]);
  useEffect(() => () => { if (speechAvailable) window.speechSynthesis.cancel(); }, [speechAvailable]);
  useEffect(() => { if (!active) { stopSpeech(); setPlaying(false); } }, [active]);

  function stopSpeech() { speechRun.current += 1; if (speechAvailable) window.speechSynthesis.cancel(); setSpeaking(null); }
  // Queue one or more explanations; the run counter ignores callbacks from cancelled narrations.
  function speak(queue: Lesson[], mode: 'one' | 'all') {
    if (!speechAvailable) return;
    stopSpeech();
    const run = speechRun.current;
    const narrator = selectNarratorVoice(voices.length ? voices : window.speechSynthesis.getVoices());
    queue.forEach((lesson, index) => {
      const utterance = new SpeechSynthesisUtterance(`${mode === 'all' ? `Snippet ${Number(lesson.number)}. ` : ''}${lesson.title}. ${lesson.explanation}`);
      if (narrator) utterance.voice = narrator;
      utterance.lang = narrator?.lang || 'en-US';
      utterance.pitch = narrator && masculineVoiceName.test(narrator.name) ? 1 : 0.78;
      utterance.rate = 0.95;
      utterance.onstart = () => { if (speechRun.current === run) setSpeaking({ mode, lesson: lesson.number }); };
      utterance.onerror = () => { if (speechRun.current === run) setSpeaking(null); };
      if (index === queue.length - 1) utterance.onend = () => { if (speechRun.current === run) setSpeaking(null); };
      window.speechSynthesis.speak(utterance);
    });
    setSpeaking({ mode, lesson: queue[0].number });
  }
  function readLesson(lesson: Lesson) { if (speaking?.lesson === lesson.number) stopSpeech(); else speak([lesson], 'one'); }
  function readAll() { if (speaking?.mode === 'all') stopSpeech(); else speak(lessons, 'all'); }

  function chooseReplay(id: string) { setPlaying(false); setReplayId(id); setStep(0); }
  function newSession() { setSessionId(''); setLiveEvents([]); setAnswers({}); setStatus('Not started'); setError(''); }
  async function run() {
    if (running || !prompt.trim()) return;
    const continuing = Boolean(sessionId);
    setRunning(true); setError(''); setStatus(continuing ? 'Sending a follow-up to the same session' : 'Starting');
    try {
      await runStream({ prompt: prompt.trim(), sessionId }, (event) => {
        if (event.type === 'status') setStatus(event.label);
        if (event.type === 'session') { setSessionId(event.sessionId); setStatus('Receiving events'); }
        if (event.type === 'event') setLiveEvents((previous) => [...previous, event.event]);
        if (event.type === 'answer') setAnswers((previous) => ({ ...previous, [event.turnId]: event.text }));
        if (event.type === 'done') {
          setStatus(`Root turn ${event.outcome}${event.idleObserved ? ', then the session became idle' : '. Session idle was not observed within 3 seconds'}.`);
          if (event.message) setError(event.message);
        }
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unknown error.'); setStatus('Failed or interrupted'); }
    finally { setRunning(false); }
  }
  function replayLive() { setRecorded(liveEvents); setRecordedAnswers(answers); chooseReplay('live'); document.getElementById('lab12-replay')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  const collapseToggle = <label className="lab12-toggle"><input type="checkbox" checked={collapse} onChange={(event) => setCollapse(event.target.checked)} /> Collapse consecutive deltas</label>;

  return <div className="lab12-page">
    <div className="lab2-hero"><span className="lab2-badge lab12-badge">12/50</span><div><div className="eyebrow">LAB 12 / TURN TIMELINE</div><h1>Build a turn <em>timeline.</em></h1><p>Group every session, turn, item, and text event by the turn it belongs to, number it in arrival order, and see one agent run from start to finish.</p></div></div>

    <section className="lab7-card"><span className="eyebrow">LIVE RUN</span><h2>Record the events of a real session</h2><p>The server forwards every event as metadata: type, event ID, turn, item, and status, without prompt or answer text. Send a follow-up to add a second turn to the same session.</p><label htmlFor="lab12-prompt">{sessionId ? 'Your follow-up' : 'Your question'}</label><textarea id="lab12-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} disabled={running} /><div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void run()} disabled={running || !health?.configured || !prompt.trim()}>{running ? 'Recording…' : sessionId ? 'Send follow-up (same session)' : 'Run and record'}</button>{sessionId && !running ? <button type="button" className="lab8-secondary" onClick={newSession}>New session</button> : null}{liveEvents.length && !running ? <button type="button" className="lab8-secondary" onClick={replayLive}>Replay these events step by step</button> : null}</div>{!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env and restart the server for a live run. The replay below works without a key.</p> : null}<p className="lab7-session-status" role="status">{status}</p>{sessionId ? <p className="lab7-session-id">Session <code>{sessionId}</code></p> : null}{error ? <p className="lab2-error" role="alert">{error}</p> : null}</section>

    {liveEvents.length || running ? <section className="lab7-card"><div className="lab12-card-head"><div><span className="eyebrow">LIVE TIMELINE · {liveTimeline.rows.length} EVENTS</span><h2>What happened, turn by turn</h2></div>{collapseToggle}</div><TimelineView timeline={liveTimeline} collapse={collapse} currentSeq={null} answers={answers} /></section> : null}

    <section className="lab7-card" id="lab12-replay"><span className="eyebrow">STEP-THROUGH REPLAY · NO API KEY NEEDED</span><h2>Place one event at a time</h2><p>These scripted sequences use the same event shape the server forwards. Step through them and watch each event land in its lane.</p><label htmlFor="lab12-scenario">Event sequence</label><select id="lab12-scenario" className="lab12-select" value={replayId} onChange={(event) => chooseReplay(event.target.value)}>{scenarios.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}{recorded.length ? <option value="live">Your live session ({recorded.length} events)</option> : null}</select><p className="lab8-note">{scenario.summary}</p>
      <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => { setPlaying(false); setStep(0); }} disabled={step === 0}>Reset</button><button type="button" className="lab8-secondary" onClick={() => { setPlaying(false); setStep((value) => Math.max(0, value - 1)); }} disabled={step === 0}>Back</button><button type="button" className="lab7-primary" onClick={() => { setPlaying(false); setStep((value) => Math.min(scenario.events.length, value + 1)); }} disabled={atEnd}>Place next event</button><button type="button" className="lab8-secondary" onClick={() => { if (atEnd) setStep(0); setPlaying((value) => !value); }} aria-pressed={playing}>{playing ? 'Pause' : atEnd ? 'Replay from start' : 'Play'}</button><button type="button" className="lab8-secondary" onClick={() => { setPlaying(false); setStep(scenario.events.length); }} disabled={atEnd}>Jump to end</button>{collapseToggle}</div>
      <p className="lab7-session-status" role="status">Step {step} of {scenario.events.length}</p>
      <div className="lab12-current"><strong>Last event received</strong>{currentEvent ? <code>{currentEvent.eventId} · {shortType(currentEvent.type)}{currentEvent.turnId ? ` · turn ${currentEvent.turnId}` : ' · no turn ID'}</code> : <span>None yet. Place the first event.</span>}{currentReplayed && currentEvent ? <em>Replayed event ID {currentEvent.eventId}: already placed, so the timeline skipped it.</em> : null}</div>
      <TimelineView timeline={replayTimeline} collapse={collapse} currentSeq={currentSeq} answers={replayAnswers} />
    </section>

    <section className="lab3-guide lab12-guide"><h2>Read the evidence</h2><div><article><strong>Session lane</strong><p>Session status, environment, and subagent events have no turn ID.</p></article><article><strong>Turn lane</strong><p>Turn, item, and text events belong to one turn. A delta without a turn ID uses its item's turn.</p></article><article><strong>Order</strong><p>Sequence numbers follow arrival. Replayed event IDs are skipped.</p></article><article><strong>Outcome</strong><p>The root turn's completed, failed, or cancelled event decides the run. Idle comes after it.</p></article></div><p className="lab3-guide-note">Times are when the server received each event, not when the model produced it. Use them to compare phases of one run, not as exact model latency.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 12</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind the turn timeline</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Follow one event from the server stream to its place on the timeline: normalize, assign a turn, number, check, end, and display. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Step through <em>A subagent inside the root turn</em> and explain why the run is not finished when the subagent turn completes. Then run a live question and a follow-up in the same session. Show that the timeline has one session lane and two root turns, record both turn IDs, and name the event that ended each turn.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/sessions/events" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
