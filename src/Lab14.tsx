import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { AnswerPre } from './Lab6.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { activeStatuses, parseSnapshot, shortId, type Snapshot, type TurnStatus } from './lab13Recovery.ts';
import { classifyControl, runState, turnMessages, verdictLabels, verdictTone, type ControlKind, type ControlOutcome, type ControlRecord, type RunState } from './lab14Controls.ts';
import { controlScenarios, type TimelineEntry } from './lab14Scenarios.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Part = { itemId: string; turnId: string | null; text: string; done: boolean };
type Mark = { controlId: string; itemId: string | null; chars: number };
type LogKind = 'event' | 'control' | 'read' | 'net';
type LogEntry = { id: number; at: number; kind: LogKind; text: string };
type StreamLine =
  | { type: 'session'; sessionId: string }
  | { type: 'turn'; turnId: string; status: TurnStatus; error: string | null }
  | { type: 'parts'; parts: Part[] }
  | { type: 'event'; event: string; turnId: string | null; detail: string | null }
  | { type: 'end'; reason: string; message: string | null };

const lessons: Lesson[] = [
  { number: '01', title: 'Cancel is an input event', file: 'server/lab14.ts', code: "// Ask the API to stop the session's active turn.\nawait client.beta.agents.sessions.events.create(sessionId, {\n  events: [{ type: 'agent.session.input.cancel' }],\n});\n// Returns 202 Accepted: the request was received, nothing more.", explanation: 'Cancelling is not closing a connection. It is an input event sent to the session, just like a message. The API answers 202 Accepted, which only confirms receipt. The turn then ends as cancelled, the session stays usable, and earlier turns remain. Output that streamed but was never published is abandoned, so it will not appear in saved items.' },
  { number: '02', title: 'Steering is a message sent while work is active', file: 'server/lab14.ts', code: "// The same message event used for a follow-up.\nawait client.beta.agents.sessions.events.create(sessionId, {\n  'Idempotency-Key': controlId, // a retried click is not a second message\n  events: [{ type: 'agent.session.input.message',\n    input: [{ role: 'user', content: [{ type: 'input_text', text }] }] }],\n});", explanation: 'There is no special steer endpoint. A steer is an ordinary user message that arrives while a turn is still running. The API adds it to that turn instead of starting a new one. The control ID travels as the Idempotency-Key, so a double click or a network retry cannot send the same instruction twice.' },
  { number: '03', title: 'Keep following until the session is idle', file: 'server/lab14.ts', code: "for await (const event of stream) {\n  if (isRootTurnEvent(event)) turns.set(event.turn.id, event.turn.status);\n  // A steer can add output after an item is done, or start a new turn,\n  // so one completed item is not the end of the run.\n  if (event.type === 'agent.session.idle' && settled()) break;\n  if (settled()) armGraceTimer(); // idle may not come; do not wait for ever\n}", explanation: 'Earlier labs stopped reading at the first root turn outcome. With steering, that is too early. A steer is read at the next step boundary, so the answer can continue with a second message in the same turn, or a late steer can open a new turn. The server keeps reading until every new root turn has an outcome and the session reports idle.' },
  { number: '04', title: 'Accepted is not the same as cancelled', file: 'src/lab14Controls.ts', code: "if (!control.targetTurnId) return result('nothing_to_cancel', …);\nif (turn.status === 'cancelled') return result('cancelled', …);\nif (turn.status === 'completed' || turn.status === 'failed')\n  return result('too_late', …); // 202, but no effect\nreturn result('cancel_pending', …);", explanation: 'Only the turn status proves what a cancel did. While building this lab, a cancel sent after the turn had completed still returned 202 Accepted, emitted no event, and left the turn completed. So the page reads the saved turn and reports cancelled, too late, nothing to cancel, or still pending, instead of trusting the HTTP answer.' },
  { number: '05', title: 'Find where the steering message was saved', file: 'src/lab14Controls.ts', code: "const holders = savedUserMessages(text).map((m) => m.turnId);\nif (holders.includes(control.targetTurnId))\n  return result('steered', …);  // joined the running turn\nif (holders.length) return result('new_turn', …); // arrived too late\nif (turnIsActive) return result('steer_pending', …);\nreturn result('not_saved', …);", explanation: 'The saved items show whether a steer really steered. If the message is saved inside the turn that was running when it was sent, it steered that turn. If it is saved in a different, later turn, the original turn had already ended and the message became an ordinary follow-up. If it is nowhere, it was lost, and resending with the same Idempotency-Key is safe.' },
  { number: '06', title: 'Stop reading does not stop the agent', file: 'src/Lab14.tsx', code: "function stopReading() {\n  // Closes the browser's stream. No request reaches the API.\n  runAbort.current?.abort();\n  record({ kind: 'stop_reading', response: 'local' });\n}\n// Later: follow again without sending anything.\nfetch('/api/lab14/run', { body: JSON.stringify({ sessionId, follow: true }) });", explanation: 'Aborting the fetch only closes the page’s stream. The agent keeps working, keeps spending tokens, and saves its answer. That is why the page offers a separate Cancel button. To watch the turn again, follow mode opens the event stream first, then lists turns, and tracks any root turn that is still active. It sends nothing.' },
];

const stateSteps: { state: RunState; label: string }[] = [
  { state: 'idle', label: 'Idle' }, { state: 'running', label: 'Running' }, { state: 'steering', label: 'Steer sent' }, { state: 'cancelling', label: 'Cancel sent' },
  { state: 'detached', label: 'Not watching' }, { state: 'completed', label: 'Completed' }, { state: 'cancelled', label: 'Cancelled' }, { state: 'failed', label: 'Failed' },
];
const controlNames: Record<ControlKind, string> = { cancel: 'Cancel', steer: 'Steer', stop_reading: 'Stop reading' };

function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}

const turnStatuses: TurnStatus[] = ['queued', 'in_progress', 'waiting', 'completed', 'failed', 'cancelled'];
function parseLine(value: unknown): StreamLine {
  if (!value || typeof value !== 'object' || !('type' in value)) throw new Error('Invalid stream event.');
  const line = value as Record<string, unknown>;
  const optional = (field: unknown) => (typeof field === 'string' ? field : null);
  if (line.type === 'session' && typeof line.sessionId === 'string') return { type: 'session', sessionId: line.sessionId };
  if (line.type === 'turn' && typeof line.turnId === 'string' && turnStatuses.includes(line.status as TurnStatus)) return { type: 'turn', turnId: line.turnId, status: line.status as TurnStatus, error: optional(line.error) };
  if (line.type === 'parts' && Array.isArray(line.parts)) {
    return { type: 'parts', parts: line.parts.map((raw) => {
      const part = raw as Record<string, unknown>;
      if (typeof part.itemId !== 'string' || typeof part.text !== 'string' || typeof part.done !== 'boolean') throw new Error('Invalid text part.');
      return { itemId: part.itemId, turnId: optional(part.turnId), text: part.text, done: part.done };
    }) };
  }
  if (line.type === 'event' && typeof line.event === 'string') return { type: 'event', event: line.event, turnId: optional(line.turnId), detail: optional(line.detail) };
  if (line.type === 'end' && typeof line.reason === 'string') return { type: 'end', reason: line.reason, message: optional(line.message) };
  throw new Error('Invalid stream event.');
}

async function readStream(response: Response, onLine: (line: StreamLine) => void): Promise<void> {
  if (!response.body) throw new Error('The browser could not read the response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const raw of lines) if (raw.trim()) onLine(parseLine(JSON.parse(raw)));
    }
  } finally { reader.releaseLock(); }
}

async function fetchSnapshot(sessionId: string): Promise<Snapshot> {
  const response = await fetch(`/api/lab14/snapshot?${new URLSearchParams({ sessionId })}`);
  const body: unknown = await response.json();
  if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
  return parseSnapshot(body);
}

const newId = (prefix: string): string => `${prefix}_${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 20) : Date.now().toString(36) + Math.random().toString(36).slice(2, 10)}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function StateStrip({ state }: { state: RunState }) {
  return <ol className="lab14-states" aria-label="Run state">{stateSteps.map((step) => <li key={step.state} className={'lab14-state ' + step.state + (step.state === state ? ' current' : '')} aria-current={step.state === state ? 'step' : undefined}>{step.label}</li>)}</ol>;
}

function OutcomeCard({ control, outcome }: { control: ControlRecord; outcome: ControlOutcome | null }) {
  const tone = outcome ? verdictTone[outcome.verdict] : 'pending';
  return <article className={'lab14-outcome ' + tone}>
    <div className="lab14-outcome-head"><span className={'lab14-kind ' + control.kind}>{controlNames[control.kind]}</span><span className={'lab14-verdict ' + tone}>{outcome ? verdictLabels[outcome.verdict] : 'Not read yet'}</span><span className="lab14-at">{seconds(control.at)}</span></div>
    {control.text ? <p className="lab14-steer-text">“{control.text}”</p> : null}
    {outcome ? <><h3>{outcome.headline}</h3><p>{outcome.explanation}</p><ol className="lab13-evidence">{outcome.evidence.map((line, index) => <li key={index}>{line}</li>)}</ol></> : <p className="lab8-note">The API response is {control.response === 'accepted' ? '202 Accepted' : control.response}. Read saved state to learn what it did.</p>}
  </article>;
}

function SavedTurns({ snapshot, steerTexts }: { snapshot: Snapshot | null; steerTexts: string[] }) {
  if (!snapshot?.sessionStatus) return <p className="lab8-note">No saved state read yet.</p>;
  const roots = snapshot.turns.filter((turn) => !turn.subagentId);
  if (!roots.length) return <p className="lab8-note">The session has no turns yet.</p>;
  return <ol className="lab14-turns">{roots.map((turn, index) => {
    const messages = turnMessages(snapshot, turn.id);
    const answers = messages.filter((message) => message.role === 'assistant').length;
    return <li key={turn.id} className={turn.status}>
      <div className="lab13-turn-head"><span>Turn {index + 1} <code>{shortId(turn.id)}</code></span><span className={'lab14-status ' + turn.status}>{turn.status}</span><span className="lab14-count">{messages.length} saved message{messages.length === 1 ? '' : 's'}</span></div>
      {messages.map((message, position) => {
        const steer = message.role === 'user' && position > 0 && steerTexts.includes(message.text.trim());
        return <div key={message.id ?? `${turn.id}-${position}`} className={'lab14-msg ' + message.role + (steer ? ' steer' : '')}><strong>{message.role === 'user' ? (steer ? 'You · steer, same turn' : 'You') : 'Tutor'}</strong>{message.role === 'user' ? <p>{message.text}</p> : <div className="lab7-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{message.text}</ReactMarkdown></div>}</div>;
      })}
      {turn.status === 'cancelled' && !answers ? <p className="lab14-abandoned">No assistant message was saved. The text that streamed before the cancel was never published.</p> : null}
      {turn.error ? <p className="lab2-error">{turn.error}</p> : null}
    </li>;
  })}</ol>;
}

function TimelineRow({ entry, current }: { entry: TimelineEntry; current: boolean }) {
  const label = entry.kind === 'event' ? entry.type : entry.kind === 'control' ? 'control' : `text · ${entry.chars} chars`;
  return <li className={'lab14-tl ' + entry.kind + (current ? ' current' : '')} aria-current={current ? 'step' : undefined}><span className="lab14-at">{seconds(entry.at)}</span><code>{label}</code><span>{entry.note}</span></li>;
}

export default function Lab14({ active, health }: { active: boolean; health: Health }) {
  const [prompt, setPrompt] = useState('Write a detailed 300-word explanation of JavaScript closures with two examples.');
  const [steerText, setSteerText] = useState('Change of plan: answer in one sentence instead.');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [turnStatus, setTurnStatus] = useState<Record<string, TurnStatus>>({});
  const [parts, setParts] = useState<Part[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [controls, setControls] = useState<ControlRecord[]>([]);
  const [sending, setSending] = useState<ControlKind | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [error, setError] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [scenarioId, setScenarioId] = useState(controlScenarios[0].id);
  const [step, setStep] = useState(0);
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const runAbort = useRef<AbortController | null>(null);
  const runStart = useRef(0);
  const statusRef = useRef<Record<string, TurnStatus>>({});
  const partsRef = useRef<Part[]>([]);
  const logId = useRef(0);
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const turnIds = Object.keys(turnStatus);
  const activeTurnId = turnIds.filter((id) => activeStatuses.includes(turnStatus[id])).at(-1) ?? null;
  const latestTurnId = turnIds.at(-1) ?? null;
  const state = runState(latestTurnId ? turnStatus[activeTurnId ?? latestTurnId] : null, controls, reading);
  const steerTexts = controls.filter((control) => control.kind === 'steer' && control.text).map((control) => (control.text ?? '').trim());
  const outcomes = controls.map((control) => ({ control, outcome: snapshot ? classifyControl(control, snapshot) : null }));
  const unwatched = snapshot?.turns.some((turn) => !turn.subagentId && activeStatuses.includes(turn.status)) && !reading;

  const scenario = controlScenarios.find((item) => item.id === scenarioId) ?? controlScenarios[0];
  const totalSteps = scenario.timeline.length + 1;

  const elapsed = () => Math.round(performance.now() - runStart.current);
  function addLog(kind: LogKind, text: string) { setLog((previous) => [...previous, { id: ++logId.current, at: elapsed(), kind, text }].slice(-60)); }

  async function readSaved(id = sessionId) {
    if (!id) return;
    setSnapshotBusy(true);
    try {
      const next = await fetchSnapshot(id);
      setSnapshot(next);
      const roots = next.turns.filter((turn) => !turn.subagentId);
      addLog('read', `Read saved state: ${roots.length} root turn${roots.length === 1 ? '' : 's'} (${roots.map((turn) => turn.status).join(', ') || 'none'}), ${next.messages.length} saved messages. This sends nothing.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not read saved state.'); }
    finally { setSnapshotBusy(false); }
  }

  // One run stream: a new question, or (follow) reattaching to the session without sending anything.
  async function run(body: { prompt?: string; sessionId: string | null; follow?: boolean }) {
    const controller = new AbortController();
    runAbort.current = controller;
    setReading(true); setError('');
    let id = body.sessionId;
    try {
      const response = await fetch('/api/lab14/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ prompt: body.prompt ?? '', sessionId: body.sessionId ?? '', follow: body.follow === true }) });
      if (!response.ok) throw new Error((await response.json()).error || `Request failed (${response.status}).`);
      await readStream(response, (line) => {
        if (line.type === 'session') { id = line.sessionId; setSessionId(line.sessionId); }
        if (line.type === 'turn') {
          const known = statusRef.current[line.turnId];
          statusRef.current = { ...statusRef.current, [line.turnId]: line.status };
          setTurnStatus(statusRef.current);
          if (known !== line.status) addLog('event', `Root turn ${shortId(line.turnId)} is ${line.status}.${line.error ? ` ${line.error}` : ''}`);
        }
        if (line.type === 'parts') { partsRef.current = line.parts; setParts(line.parts); }
        if (line.type === 'event' && !line.event.includes('turn.') ) addLog('event', `${line.event}${line.detail ? ` · ${line.detail}` : ''}`);
        if (line.type === 'event' && line.event.includes('turn.item')) addLog('event', `${line.event.replace('agent.session.turn.', '')} · ${line.detail ?? 'item'}${line.turnId ? ` in ${shortId(line.turnId)}` : ''}`);
        if (line.type === 'end') { addLog('event', `Server closed the stream: ${line.reason}.`); if (line.message) setError(line.message); }
      });
    } catch (caught) {
      if (controller.signal.aborted) addLog('net', 'The page stopped reading. No cancel was sent; the agent keeps working.');
      else setError(caught instanceof Error ? caught.message : 'The run failed.');
    } finally {
      if (runAbort.current === controller) runAbort.current = null;
      setReading(false);
    }
    if (id) await readSaved(id);
  }

  function ask() {
    const question = prompt.trim();
    if (!question || reading) return;
    runStart.current = performance.now();
    setParts([]); partsRef.current = []; setMarks([]); setControls([]); setSnapshot(null); setLog([]);
    addLog('control', `${sessionId ? 'Follow-up' : 'Question'} sent${sessionId ? ` to session ${shortId(sessionId)}` : ' as a new session'}.`);
    void run({ prompt: question, sessionId });
  }

  function follow() {
    if (!sessionId || reading) return;
    addLog('control', 'Following the session again. Nothing is sent.');
    void run({ sessionId, follow: true });
  }

  // Record where the stream was when a control left the page, so the answer can show it.
  function record(kind: ControlKind, fields: Partial<ControlRecord>): ControlRecord {
    const target = activeTurnId ?? latestTurnId;
    const streaming = partsRef.current.at(-1) ?? null;
    const control: ControlRecord = { id: newId(kind === 'steer' ? 'steer' : 'ctl'), kind, at: elapsed(), text: null, targetTurnId: target, statusAtSend: target ? statusRef.current[target] : null, response: 'local', error: null, ...fields };
    setMarks((previous) => [...previous, { controlId: control.id, itemId: streaming?.itemId ?? null, chars: streaming?.text.length ?? 0 }]);
    return control;
  }

  async function sendControl(kind: 'cancel' | 'steer') {
    if (!sessionId || sending) return;
    const text = kind === 'steer' ? steerText.trim() : null;
    if (kind === 'steer' && !text) return;
    const control = record(kind, { text });
    setSending(kind);
    addLog('control', `${controlNames[kind]} sent while turn ${control.targetTurnId ? shortId(control.targetTurnId) : '(none)'} was ${control.statusAtSend ?? 'unknown'}.`);
    try {
      const response = await fetch('/api/lab14/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, kind, text: text ?? '', controlId: control.id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      const done: ControlRecord = body.accepted ? { ...control, response: 'accepted' } : { ...control, response: 'rejected', error: body.error };
      setControls((previous) => [...previous, done]);
      addLog('control', body.accepted ? `${controlNames[kind]} → 202 Accepted. That is receipt, not effect.` : `${controlNames[kind]} rejected: ${body.error?.code ?? body.error?.message ?? 'unknown error'}.`);
      // A steer sent while nothing is being watched may start a new turn; follow it.
      if (body.accepted && kind === 'steer' && !runAbort.current) void run({ sessionId, follow: true });
      else if (!runAbort.current) await readSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The control request failed.');
    } finally { setSending(null); }
  }

  function stopReading() {
    if (!runAbort.current) return;
    setControls((previous) => [...previous, record('stop_reading', { response: 'local' })]);
    runAbort.current.abort();
  }

  function newSession() {
    runAbort.current?.abort();
    setSessionId(null); setTurnStatus({}); statusRef.current = {}; setParts([]); partsRef.current = []; setMarks([]); setControls([]); setSnapshot(null); setLog([]); setError('');
  }

  useEffect(() => {
    if (!speechAvailable) return;
    const synthesis = window.speechSynthesis;
    const refresh = () => setVoices(synthesis.getVoices());
    refresh(); synthesis.addEventListener('voiceschanged', refresh);
    return () => synthesis.removeEventListener('voiceschanged', refresh);
  }, [speechAvailable]);
  useEffect(() => () => { runAbort.current?.abort(); if (speechAvailable) window.speechSynthesis.cancel(); }, [speechAvailable]);
  useEffect(() => { if (!active) stopSpeech(); }, [active]);

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

  const canControl = Boolean(sessionId) && Boolean(health?.configured) && !sending;
  const markFor = (itemId: string) => marks.filter((mark) => mark.itemId === itemId);
  const controlById = (id: string) => controls.find((control) => control.id === id);

  return <div className="lab14-page">
    <div className="lab2-hero"><span className="lab2-badge lab14-badge">14/50</span><div><div className="eyebrow">LAB 14 / CANCEL AND STEER</div><h1>Cancel and <em>steer</em> a turn.</h1><p>While the agent is working, you can stop it or redirect it. Cancel is an input event that ends the turn. Steering is an ordinary message that joins the running turn. Neither is proved by the HTTP answer: read the saved turn to see what really happened.</p></div></div>

    <section className="lab7-card"><span className="eyebrow">LIVE RUN</span><h2>Start a long answer, then act on it</h2><p>Ask for something long so there is time to act. While it streams, press <strong>Cancel turn</strong>, <strong>Steer</strong>, or <strong>Stop reading</strong>. Try each one late, after the turn finished, too.</p>
      <label htmlFor="lab14-prompt">{sessionId ? 'Your follow-up (same session)' : 'Your question'}</label>
      <textarea id="lab14-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} disabled={reading} />
      <div className="lab8-actions">
        <button type="button" className="lab7-primary" onClick={ask} disabled={reading || !health?.configured || !prompt.trim()}>{reading ? 'Streaming…' : sessionId ? 'Send follow-up' : 'Ask and stream'}</button>
        {sessionId && !reading ? <button type="button" className="lab8-secondary" onClick={newSession}>New session</button> : null}
      </div>
      <div className="lab14-controls" role="group" aria-label="Turn controls">
        <div className="lab14-control cancel"><strong>Cancel</strong><p>Sends <code>agent.session.input.cancel</code>. Stops the turn.</p><button type="button" className="lab14-button cancel" onClick={() => void sendControl('cancel')} disabled={!canControl}>{sending === 'cancel' ? 'Sending…' : 'Cancel turn'}</button></div>
        <div className="lab14-control steer"><label htmlFor="lab14-steer">Steer</label><p>Sends a message into the running turn.</p><input id="lab14-steer" value={steerText} maxLength={2000} onChange={(event) => setSteerText(event.target.value)} /><button type="button" className="lab14-button steer" onClick={() => void sendControl('steer')} disabled={!canControl || !steerText.trim()}>{sending === 'steer' ? 'Sending…' : 'Steer with this message'}</button></div>
        <div className="lab14-control stop"><strong>Stop reading</strong><p>Closes the page’s stream. Sends <em>nothing</em> to the API.</p><button type="button" className="lab14-button stop" onClick={stopReading} disabled={!reading}>Stop reading</button>{unwatched ? <button type="button" className="lab8-secondary" onClick={follow}>Follow the turn again</button> : null}</div>
      </div>
      {!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env and restart the server for a live run. The playground below works without a key.</p> : null}
      <StateStrip state={state} />
      {sessionId ? <p className="lab7-session-id">Session <code>{sessionId}</code>{activeTurnId ? <> · active turn <code>{shortId(activeTurnId)}</code></> : null}</p> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    <div className="lab14-grid">
      <section className="lab7-card">
        <span className="eyebrow">WHAT STREAMED</span><h2>Answer, with where each control landed</h2>
        {parts.length ? <ol className="lab14-parts">{parts.map((part, index) => <li key={part.itemId}>
          <div className="lab13-live-head"><strong>Assistant message {index + 1}{part.turnId ? <> · turn <code>{shortId(part.turnId)}</code></> : null}</strong><span>{part.done ? 'done' : reading ? 'streaming' : 'stopped · not final'}</span></div>
          <div className="lab7-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{part.text}</ReactMarkdown></div>
          {markFor(part.itemId).map((mark) => { const control = controlById(mark.controlId); return control ? <p key={mark.controlId} className={'lab14-mark ' + control.kind}><b>{controlNames[control.kind]}</b> left the page after {mark.chars} characters of this message{part.text.length > mark.chars + 40 ? ` — ${part.text.length - mark.chars} more characters streamed after it` : ''}.</p> : null; })}
        </li>)}</ol> : <p className="lab8-note">Nothing streamed yet.</p>}
        <h3 className="lab13-subhead">Saved turns <code>read after the stream ends</code></h3>
        <SavedTurns snapshot={snapshot} steerTexts={steerTexts} />
        <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => void readSaved()} disabled={!sessionId || snapshotBusy}>{snapshotBusy ? 'Reading…' : 'Read saved state'}</button></div>
      </section>
      <section className="lab7-card">
        <span className="eyebrow">OUTCOMES</span><h2>What each control really did</h2>
        {outcomes.length ? <div className="lab14-outcomes">{outcomes.map(({ control, outcome }) => <OutcomeCard key={control.id} control={control} outcome={outcome} />)}</div> : <p className="lab8-note">No controls sent yet. Each one gets a verdict from the saved turn, not from the HTTP answer.</p>}
        <h3 className="lab13-subhead">Event log <code>time since the question</code></h3>
        {log.length ? <ol className="lab13-log lab14-log">{log.map((entry) => <li key={entry.id}><span className="lab13-log-time">{seconds(entry.at)}</span><span className={'lab13-log-kind ' + entry.kind}>{entry.kind}</span><span>{entry.text}</span></li>)}</ol> : <p className="lab8-note">Nothing yet.</p>}
      </section>
    </div>

    <section className="lab7-card" id="lab14-playground"><span className="eyebrow">CONTROL PLAYGROUND · NO API KEY NEEDED</span><h2>Step through six controls</h2><p>Each case is a scripted timeline in the same shape as the live run, ending with the saved turns. The same <code>classifyControl</code> function gives the verdict.</p>
      <label htmlFor="lab14-scenario">Case</label>
      <select id="lab14-scenario" className="lab12-select" value={scenarioId} onChange={(event) => { setScenarioId(event.target.value); setStep(0); }}>{controlScenarios.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
      <p className="lab8-note">{scenario.summary}</p>
      {scenario.label ? <p className="lab14-label">{scenario.label}</p> : null}
      <div className="lab8-actions">
        <button type="button" className="lab8-secondary" onClick={() => setStep(0)} disabled={step === 0}>Reset</button>
        <button type="button" className="lab7-primary" onClick={() => setStep((value) => Math.min(totalSteps, value + 1))} disabled={step >= totalSteps}>{step >= totalSteps - 1 ? 'Read saved state' : 'Next event'}</button>
        <button type="button" className="lab8-secondary" onClick={() => setStep(totalSteps)} disabled={step >= totalSteps}>Show all</button>
      </div>
      <p className="lab7-session-status" role="status">Event {Math.min(step, totalSteps - 1)} of {totalSteps - 1}{step >= totalSteps ? ' · saved state read' : ''}</p>
      {step > 0 ? <ol className="lab14-timeline">{scenario.timeline.slice(0, Math.min(step, totalSteps - 1)).map((entry, index) => <TimelineRow key={index} entry={entry} current={index === step - 1 && step < totalSteps} />)}</ol> : null}
      {step >= totalSteps ? <div className="lab14-case">
        <div><h3 className="lab13-subhead">Saved turns</h3><SavedTurns snapshot={scenario.snapshot} steerTexts={scenario.controls.map((control) => (control.text ?? '').trim()).filter(Boolean)} /></div>
        <div><h3 className="lab13-subhead">Verdict</h3><div className="lab14-outcomes">{scenario.controls.map((control) => <OutcomeCard key={control.id} control={control} outcome={classifyControl(control, scenario.snapshot)} />)}</div></div>
      </div> : null}
    </section>

    <section className="lab3-guide lab14-guide"><h2>Tell them apart</h2><div><article><strong>Cancel</strong><p>An input event. The turn ends as cancelled; unpublished text is abandoned.</p></article><article><strong>Steer</strong><p>A message sent while a turn runs. It joins that turn; no new turn starts.</p></article><article><strong>Stop reading</strong><p>A browser action. The agent keeps working and the turn is still billed.</p></article><article><strong>Prove it</strong><p>202 means received. The saved turn status and items show the effect.</p></article></div><p className="lab3-guide-note">Observed while building this lab: a steer did not interrupt the message being written. The agent finished it, then answered the steer in the same turn. A cancel sent after completion returned 202 and changed nothing.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 14</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind cancel and steer</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Send a cancel, send a steer, keep reading, then prove what each one did from saved state. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Run the same long question three times. Once, press <em>Cancel turn</em> after the first sentence. Once, press <em>Steer with this message</em>. Once, press <em>Stop reading</em>. For each run, show the verdict card and the saved turns. Explain why the cancelled turn has no saved answer, why the steered run still has one turn, and why the unwatched turn still produced a full answer. Then press <em>Cancel turn</em> after a turn has completed and explain the <em>Too late</em> verdict.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/sessions" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
