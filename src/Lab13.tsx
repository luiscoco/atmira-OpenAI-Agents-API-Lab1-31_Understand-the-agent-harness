import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { AnswerPre } from './Lab6.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { decideRecovery, loadStored, parseSnapshot, saveStored, shortId, type Action, type Decision, type PendingSend, type Snapshot, type Stored } from './lab13Recovery.ts';
import { recoveryScenarios } from './lab13Scenarios.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Phase = 'idle' | 'sending' | 'disconnected' | 'checking' | 'attached' | 'decided';
type LogKind = 'send' | 'net' | 'read' | 'decide' | 'attach' | 'done';
type LogEntry = { id: number; at: number; kind: LogKind; text: string };
type StreamLine =
  | { type: 'session'; sessionId: string }
  | { type: 'turn'; turnId: string }
  | { type: 'attached'; status: string }
  | { type: 'text'; text: string }
  | { type: 'outcome'; outcome: string; turnId: string | null; message: string | null }
  | { type: 'error'; message: string };

const lessons: Lesson[] = [
  { number: '01', title: 'Write the request down before sending it', file: 'src/Lab13.tsx', code: "const record: PendingSend = { requestId: crypto.randomUUID(),\n  sessionId, prompt, afterTurnId: lastRootTurnId(snapshot),\n  sentAt: Date.now(), partial: '' };\n// Save first: if the page dies during the fetch, the record survives.\npersist({ sessionId, pending: record });\nawait fetch('/api/lab13/send', { method: 'POST',\n  body: JSON.stringify({ prompt, sessionId, requestId: record.requestId }) });", explanation: 'Recovery starts before the request leaves the page. The browser creates a request ID, notes the last turn it already knows, and saves this pending record to local storage first. If the tab is closed, reloaded, or loses the network during the fetch, the record is still there. It stores pointers and the question, not the answer. The answer lives in the session.' },
  { number: '02', title: 'Tag the work with the request ID', file: 'server/lab13.ts', code: "// New session: save the request ID in the session's metadata.\nawait api.beta.agents.sessions.create({ agent, environment: { type: 'none' },\n  input: prompt, stream: true,\n  metadata: { lab13_request_id: requestId } });\n\n// Follow-up: the same request ID is the Idempotency-Key.\nawait api.beta.agents.sessions.events.create(sessionId, {\n  'Idempotency-Key': requestId,\n  events: [{ type: 'agent.session.input.message', input }],\n});", explanation: 'The server attaches the request ID to the work it starts. A new session stores it in metadata, so the session can be found even if its ID never reached the browser. A follow-up sends it as the Idempotency-Key header. If the same message is submitted twice with that key, the API treats the second submission as a retry of the first, not as a new message.' },
  { number: '03', title: 'Find the session and read saved state', file: 'server/lab13.ts', code: "if (sessionId) session = await api.beta.agents.sessions.retrieve(sessionId);\nelse {\n  // The ID never arrived: look for the request ID in recent sessions.\n  const page = await api.beta.agents.sessions.list({ limit: 20, order: 'desc' });\n  session = page.data.find((s) => s.metadata?.lab13_request_id === requestId);\n}\nconst turns = await collect(api.beta.agents.sessions.turns.list(session.id, { order: 'asc' }));\nconst items = await collect(api.beta.agents.sessions.items.list(session.id, { order: 'asc' }));", explanation: 'The recovery endpoint only reads, so calling it again is always safe. With a session ID, it retrieves the session. Without one, it searches the most recent sessions for the request ID in their metadata. Then it reads every turn and every saved item in order, and reports whether it reached the end of the list. A missing match on a partial read proves nothing.' },
  { number: '04', title: 'Match the question to a saved turn', file: 'src/lab13Recovery.ts', code: "function newRootTurns(pending: PendingSend, snapshot: Snapshot) {\n  const roots = snapshot.turns.filter((turn) => !turn.subagentId);\n  if (!pending.afterTurnId) return roots;\n  const index = roots.findIndex((turn) => turn.id === pending.afterTurnId);\n  return index === -1 ? null : roots.slice(index + 1);\n}\nconst matched = snapshot.messages.filter((m) => m.role === 'user'\n  && freshIds.has(m.turnId) && m.text.trim() === pending.prompt.trim());", explanation: 'Only root turns created after the last turn the browser knew can hold this request. Inside those turns, the decision looks for a saved user message with the same text as the pending question. No match means the input never arrived. One match names the turn to follow. Two matches mean an earlier blind retry already sent the question twice.' },
  { number: '05', title: 'Let the saved turn decide', file: 'src/lab13Recovery.ts', code: "if (matched.length > 1) return decide('review', …);   // a blind retry already ran\nif (matched.length === 0) return decide('resend', …); // input lost: same key\nif (activeStatuses.includes(turn.status))\n  return decide('reattach', …);                       // still answering\nif (turn.status === 'completed')\n  return decide('show_saved', …, savedAnswer(snapshot, turn.id));\nreturn decide('offer_retry', …);                     // failed or cancelled", explanation: 'The saved turn, not the broken stream, decides what happens next. A running turn is reattached and followed. A completed turn is shown from its saved assistant message. A failed or cancelled turn is explained, and a retry is a new request with a new ID, chosen by the user. Only input that never arrived is sent again, and it reuses the same request ID.' },
  { number: '06', title: 'Reattach without sending anything', file: 'server/lab13.ts', code: "// Open the stream first, then read the status: nothing falls in the gap.\nstream = await api.beta.agents.sessions.events.stream(sessionId);\nconst turn = await api.beta.agents.sessions.turns.retrieve(turnId, { session_id: sessionId });\nif (terminal.includes(turn.status)) return finish(turn.status);\nfor await (const event of stream) {\n  if (seen.has(event.event_id)) continue; // replayed after a reconnect\n  if (inTurn(event)) buffer.apply(event);\n  if (isOutcome(event) && event.turn.id === turnId) break;\n}", explanation: 'To reattach, the server opens the event stream before it checks the turn status. If the turn finished between those two calls, the outcome is already on the open stream. Events already handled are skipped by event ID. The text seen after reattaching is only a live tail, so when the turn ends the browser reads saved state again and replaces the partial text with the saved answer.' },
];

const actionLabels: Record<Action, string> = { resend: 'Send again · same ID', reattach: 'Reattach', show_saved: 'Show saved answer', offer_retry: 'Offer a retry', wait: 'Check again soon', review: 'Review first' };
const maxAutoAttach = 3;

function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}

function parseLine(value: unknown): StreamLine {
  if (!value || typeof value !== 'object' || !('type' in value)) throw new Error('Invalid stream event.');
  const line = value as Record<string, unknown>;
  const optional = (field: unknown) => (typeof field === 'string' ? field : null);
  if (line.type === 'session' && typeof line.sessionId === 'string') return { type: 'session', sessionId: line.sessionId };
  if (line.type === 'turn' && typeof line.turnId === 'string') return { type: 'turn', turnId: line.turnId };
  if (line.type === 'attached' && typeof line.status === 'string') return { type: 'attached', status: line.status };
  if (line.type === 'text' && typeof line.text === 'string') return { type: 'text', text: line.text };
  if (line.type === 'outcome' && typeof line.outcome === 'string') return { type: 'outcome', outcome: line.outcome, turnId: optional(line.turnId), message: optional(line.message) };
  if (line.type === 'error' && typeof line.message === 'string') return { type: 'error', message: line.message };
  throw new Error('Invalid stream event.');
}

// Reads NDJSON until the server closes the stream. Returns the outcome line, or null if none arrived.
async function readStream(response: Response, onLine: (line: StreamLine) => void): Promise<Extract<StreamLine, { type: 'outcome' }> | null> {
  if (!response.body) throw new Error('The browser could not read the response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outcome: Extract<StreamLine, { type: 'outcome' }> | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const raw of lines) {
        if (!raw.trim()) continue;
        const line = parseLine(JSON.parse(raw));
        onLine(line);
        if (line.type === 'outcome') outcome = line;
      }
    }
  } finally { reader.releaseLock(); }
  return outcome;
}

async function fetchSnapshot(sessionId: string | null, requestId: string | null): Promise<Snapshot> {
  const query = new URLSearchParams();
  if (sessionId) query.set('sessionId', sessionId);
  if (requestId) query.set('requestId', requestId);
  const response = await fetch(`/api/lab13/snapshot?${query}`);
  const body: unknown = await response.json();
  if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
  return parseSnapshot(body);
}

const lastRootTurnId = (snapshot: Snapshot | null): string | null => snapshot?.turns.filter((turn) => !turn.subagentId).at(-1)?.id ?? null;
const newRequestId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function Conversation({ snapshot, highlight }: { snapshot: Snapshot | null; highlight: string | null }) {
  if (!snapshot?.sessionStatus) return <p className="lab8-note">No saved messages yet. Once a turn finishes, the conversation below is rebuilt from the session's saved items, not from the stream.</p>;
  const roots = snapshot.turns.filter((turn) => !turn.subagentId);
  if (!roots.length) return <p className="lab8-note">The session has no turns yet.</p>;
  return <ol className="lab13-conversation">{roots.map((turn, index) => {
    const messages = snapshot.messages.filter((message) => message.turnId === turn.id && message.phase !== 'commentary');
    return <li key={turn.id} className={turn.id === highlight ? 'recovered' : undefined}>
      <div className="lab13-turn-head"><span>Turn {index + 1} <code>{shortId(turn.id)}</code></span><span className={'lab12-status ' + turn.status}>{turn.status}</span>{turn.id === highlight ? <span className="lab13-tag">recovered, not resent</span> : null}</div>
      {messages.map((message, position) => <div key={message.id ?? `${turn.id}-${position}`} className={'lab13-msg ' + message.role}><strong>{message.role === 'user' ? 'You' : 'Tutor'}</strong>{message.role === 'user' ? <p>{message.text}</p> : <div className="lab7-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{message.text}</ReactMarkdown></div>}</div>)}
      {turn.error ? <p className="lab2-error">{turn.error}</p> : null}
    </li>;
  })}</ol>;
}

function DecisionCard({ decision, children }: { decision: Decision; children?: React.ReactNode }) {
  return <div className={'lab13-decision ' + decision.action}>
    <div className="lab13-decision-head"><span className={'lab13-action ' + decision.action}>{actionLabels[decision.action]}</span><h3>{decision.headline}</h3></div>
    <p>{decision.reason}</p>
    <ol className="lab13-evidence">{decision.evidence.map((line, index) => <li key={index}>{line}</li>)}</ol>
    <div className="lab13-naive"><strong>What a blind resend would do</strong><p>{decision.naive}</p></div>
    {children}
  </div>;
}

function SnapshotTable({ snapshot }: { snapshot: Snapshot }) {
  if (!snapshot.sessionStatus) return <p className="lab8-note">No session found.</p>;
  return <div className="lab13-table-wrap"><table className="lab13-table"><thead><tr><th>Turn</th><th>Status</th><th>Saved messages</th></tr></thead><tbody>{snapshot.turns.map((turn) => <tr key={turn.id}><td><code>{turn.id}</code></td><td><span className={'lab12-status ' + turn.status}>{turn.status}</span></td><td>{snapshot.messages.filter((message) => message.turnId === turn.id).map((message, index) => <div key={index} className="lab13-cell-msg"><b>{message.role}</b> {message.text.length > 70 ? `${message.text.slice(0, 70)}…` : message.text}</div>)}{turn.error ? <div className="lab2-error">{turn.error}</div> : null}</td></tr>)}</tbody></table></div>;
}

export default function Lab13({ active, health }: { active: boolean; health: Health }) {
  const [stored, setStored] = useState<Stored>(() => (typeof window === 'undefined' ? { sessionId: null, pending: null } : loadStored()));
  const [storageOk, setStorageOk] = useState(true);
  const [prompt, setPrompt] = useState('Explain what a JavaScript Promise is in three sentences.');
  const [dropEarly, setDropEarly] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [liveText, setLiveText] = useState('');
  const [liveSource, setLiveSource] = useState<'send' | 'attach'>('send');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [recoveredTurn, setRecoveredTurn] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [scenarioId, setScenarioId] = useState(recoveryScenarios[0].id);
  const [step, setStep] = useState(0);
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const storedRef = useRef(stored);
  const abortRef = useRef<AbortController | null>(null);
  const attachCount = useRef(0);
  const logId = useRef(0);
  const booted = useRef(false);
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const busy = phase === 'sending' || phase === 'checking' || phase === 'attached';
  const pending = stored.pending;

  const scenario = recoveryScenarios.find((item) => item.id === scenarioId) ?? recoveryScenarios[0];
  const scenarioDecision = decideRecovery(scenario.pending, scenario.snapshot);
  const totalSteps = scenarioDecision.evidence.length + 1;

  function persist(next: Stored) {
    storedRef.current = next;
    setStored(next);
    setStorageOk(saveStored(next));
  }
  function updatePending(fields: Partial<PendingSend>) {
    const current = storedRef.current;
    if (current.pending) persist({ sessionId: fields.sessionId ?? current.sessionId, pending: { ...current.pending, ...fields } });
  }
  function addLog(kind: LogKind, text: string) { setLog((previous) => [...previous, { id: ++logId.current, at: Date.now(), kind, text }].slice(-40)); }

  async function loadConversation(sessionId: string) {
    try {
      const next = await fetchSnapshot(sessionId, null);
      setSnapshot(next);
      if (!next.sessionStatus) { addLog('read', `Session ${shortId(sessionId)} no longer exists. Starting fresh.`); persist({ sessionId: null, pending: null }); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not read saved state.'); }
  }

  // Once the outcome is known, the pending record is removed and saved items become the display.
  async function settle(sessionId: string | null, turnId: string | null, note: string) {
    persist({ sessionId: sessionId ?? storedRef.current.sessionId, pending: null });
    setRecoveredTurn(turnId);
    addLog('done', note);
    if (sessionId) await loadConversation(sessionId);
    setLiveText('');
  }

  async function send(record: PendingSend) {
    persist({ sessionId: record.sessionId ?? storedRef.current.sessionId, pending: record });
    setPhase('sending'); setError(''); setDecision(null); setRecoveredTurn(null); setLiveText(''); setLiveSource('send');
    attachCount.current = 0;
    addLog('send', `Saved pending request ${shortId(record.requestId)} to browser storage, then sent it${record.sessionId ? ` to session ${shortId(record.sessionId)}` : ' as a new session'}.`);
    const controller = new AbortController();
    abortRef.current = controller;
    let sessionId = record.sessionId;
    try {
      const response = await fetch('/api/lab13/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ prompt: record.prompt, sessionId: record.sessionId ?? '', requestId: record.requestId, dropAfterChars: dropEarly ? 80 : 0 }) });
      if (!response.ok) {
        // Rejected by this server before any API call: nothing ran, so the record can go.
        const body = await response.json();
        persist({ sessionId: storedRef.current.sessionId, pending: null });
        throw Object.assign(new Error(body.error || `Request failed (${response.status}).`), { rejected: true });
      }
      const outcome = await readStream(response, (line) => {
        if (line.type === 'session' && line.sessionId !== sessionId) { sessionId = line.sessionId; updatePending({ sessionId }); addLog('send', `Server reported session ${shortId(sessionId)}. Saved it with the pending request.`); }
        if (line.type === 'turn') addLog('send', `Root turn ${shortId(line.turnId)} created.`);
        if (line.type === 'text') { setLiveText(line.text); updatePending({ partial: line.text }); }
        if (line.type === 'error') throw new Error(line.message);
      });
      if (outcome) {
        await settle(sessionId, null, `Root turn ${outcome.outcome} while connected. Pending request cleared.`);
        if (outcome.message) setError(outcome.message);
        setPhase('idle');
        return;
      }
      addLog('net', 'The stream closed before a turn outcome arrived. The pending request stays in browser storage.');
    } catch (caught) {
      if ((caught as { rejected?: boolean }).rejected) { setError((caught as Error).message); setPhase('idle'); return; }
      addLog('net', controller.signal.aborted ? 'Disconnected by you. The agent turn keeps running on the API.' : `The request broke: ${caught instanceof Error ? caught.message : 'unknown error'}.`);
    } finally { abortRef.current = null; }
    setPhase('disconnected');
    await check();
  }

  // Read saved state, decide, and act. Reading and reattaching are automatic; sending is not.
  async function check() {
    const record = storedRef.current.pending;
    if (!record) return;
    setPhase('checking'); setError('');
    addLog('read', 'Reading saved state: session, turns, and items. This sends nothing.');
    let next: Snapshot;
    try { next = await fetchSnapshot(record.sessionId, record.requestId); } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read saved state.');
      addLog('read', 'Could not read saved state. Try again when the connection is back.');
      setPhase('disconnected');
      return;
    }
    setSnapshot(next);
    if (next.sessionId && next.sessionStatus && !record.sessionId) { updatePending({ sessionId: next.sessionId }); addLog('read', `Found session ${shortId(next.sessionId)} by its request ID metadata.`); }
    const result = decideRecovery(storedRef.current.pending ?? record, next);
    setDecision(result);
    addLog('decide', `${actionLabels[result.action]}: ${result.headline}.`);
    if (result.action === 'reattach' && next.sessionId && result.turnId && attachCount.current < maxAutoAttach) { await attach(next.sessionId, result.turnId); return; }
    if (result.action === 'show_saved') { await settle(next.sessionId, result.turnId, 'Showed the saved answer. Nothing was sent again.'); setPhase('decided'); return; }
    setPhase('decided');
  }

  async function attach(sessionId: string, turnId: string) {
    attachCount.current += 1;
    setPhase('attached'); setLiveText(''); setLiveSource('attach');
    addLog('attach', `Reattached to turn ${shortId(turnId)}. Following it to its outcome; nothing was sent.`);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch('/api/lab13/attach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ sessionId, turnId }) });
      if (!response.ok) throw new Error((await response.json()).error || `Request failed (${response.status}).`);
      const outcome = await readStream(response, (line) => {
        if (line.type === 'attached') addLog('attach', `Turn status when reattached: ${line.status}.`);
        if (line.type === 'text') setLiveText(line.text);
        if (line.type === 'error') addLog('attach', line.message);
      });
      if (outcome) addLog('attach', `Turn ${outcome.outcome}. Reading saved state for the final answer.`);
    } catch (caught) {
      addLog('net', controller.signal.aborted ? 'Disconnected by you while reattached.' : `Reattach failed: ${caught instanceof Error ? caught.message : 'unknown error'}.`);
      abortRef.current = null;
      setPhase('disconnected');
      return;
    }
    abortRef.current = null;
    await check();
  }

  function ask() {
    const question = prompt.trim();
    if (!question || busy || pending) return;
    void send({ requestId: newRequestId(), sessionId: stored.sessionId, prompt: question, afterTurnId: lastRootTurnId(snapshot), sentAt: Date.now(), partial: '' });
  }
  function resendSame() { if (pending) void send({ ...pending, partial: '' }); }
  function retryAsNew() { if (pending) void send({ ...pending, requestId: newRequestId(), sessionId: snapshot?.sessionId ?? pending.sessionId, afterTurnId: lastRootTurnId(snapshot), sentAt: Date.now(), partial: '' }); }
  function discard() { persist({ sessionId: snapshot?.sessionStatus ? snapshot.sessionId : storedRef.current.sessionId, pending: null }); setDecision(null); setPhase('idle'); addLog('done', 'Discarded the pending request without sending it.'); }
  function newSession() { persist({ sessionId: null, pending: null }); setSnapshot(null); setDecision(null); setRecoveredTurn(null); setLiveText(''); setError(''); setPhase('idle'); addLog('done', 'Started a new conversation. The next question creates a new session.'); }
  function disconnect() { abortRef.current?.abort(); }

  // After a reload: a pending record means an unknown outcome, so read saved state first.
  useEffect(() => {
    if (!active || !health?.configured || booted.current) return;
    booted.current = true;
    const current = storedRef.current;
    if (current.pending) {
      addLog('read', `Found pending request ${shortId(current.pending.requestId)} in browser storage from ${clock(current.pending.sentAt)}. Its outcome is unknown.`);
      setPhase('disconnected');
      void check();
    } else if (current.sessionId) {
      addLog('read', `Found session ${shortId(current.sessionId)} in browser storage. Rebuilding the conversation from saved items.`);
      void loadConversation(current.sessionId);
    }
  }, [active, health?.configured]);

  useEffect(() => {
    if (!speechAvailable) return;
    const synthesis = window.speechSynthesis;
    const refresh = () => setVoices(synthesis.getVoices());
    refresh(); synthesis.addEventListener('voiceschanged', refresh);
    return () => synthesis.removeEventListener('voiceschanged', refresh);
  }, [speechAvailable]);
  useEffect(() => () => { if (speechAvailable) window.speechSynthesis.cancel(); }, [speechAvailable]);
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

  const phaseLabel: Record<Phase, string> = { idle: pending ? 'A pending request is waiting for a decision' : 'Ready', sending: 'Streaming the answer', disconnected: 'Disconnected: outcome unknown', checking: 'Reading saved state', attached: 'Reattached: following the running turn', decided: decision ? `Decision: ${actionLabels[decision.action]}` : 'Decided' };

  return <div className="lab13-page">
    <div className="lab2-hero"><span className="lab2-badge lab13-badge">13/50</span><div><div className="eyebrow">LAB 13 / DISCONNECT RECOVERY</div><h1>Recover after a <em>disconnect.</em></h1><p>When the stream breaks, the agent keeps working. Read the saved session to learn what happened, then reattach, show the saved answer, or send again with the same request ID. Never repeat input blindly.</p></div></div>

    <section className="lab7-card"><span className="eyebrow">LIVE RUN</span><h2>Break the connection, then recover</h2><p>Ask a question, then break the stream: let the server drop it after 80 characters, choose <strong>Disconnect now</strong>, or <strong>reload the page</strong>. The pending request in browser storage tells the page what to check. Saved state tells it what to do.</p>
      <label htmlFor="lab13-prompt">{stored.sessionId ? 'Your follow-up (same session)' : 'Your question'}</label>
      <textarea id="lab13-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} disabled={busy} />
      <label className="lab12-toggle lab13-toggle"><input type="checkbox" checked={dropEarly} onChange={(event) => setDropEarly(event.target.checked)} disabled={busy} /> Server drops the stream after the first 80 characters (simulated disconnect)</label>
      <div className="lab8-actions">
        <button type="button" className="lab7-primary" onClick={ask} disabled={busy || Boolean(pending) || !health?.configured || !prompt.trim()}>{phase === 'sending' ? 'Streaming…' : stored.sessionId ? 'Send follow-up' : 'Ask and stream'}</button>
        {phase === 'sending' || phase === 'attached' ? <button type="button" className="lab8-secondary" onClick={disconnect}>Disconnect now</button> : null}
        {pending || phase === 'sending' ? <button type="button" className="lab8-secondary" onClick={() => window.location.reload()}>Reload the page</button> : null}
        {pending && !busy ? <button type="button" className="lab8-secondary" onClick={() => { attachCount.current = 0; void check(); }}>Check saved state again</button> : null}
        {stored.sessionId && !busy && !pending ? <button type="button" className="lab8-secondary" onClick={newSession}>New session</button> : null}
      </div>
      {!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env and restart the server for a live run. The recovery playground below works without a key.</p> : null}
      <p className="lab7-session-status" role="status">{phaseLabel[phase]}</p>
      {stored.sessionId ? <p className="lab7-session-id">Session <code>{stored.sessionId}</code></p> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
      {!storageOk ? <p className="lab8-note">Browser storage is blocked in this window, so the pending request will not survive a reload. Disconnect recovery still works.</p> : null}
    </section>

    <div className="lab13-grid">
      <section className="lab7-card">
        <span className="eyebrow">WHAT THE PAGE SHOWS</span><h2>Conversation from saved items</h2>
        {liveText ? <div className={'lab13-live' + (phase === 'sending' || phase === 'attached' ? '' : ' stale')}><div className="lab13-live-head"><strong>{liveSource === 'attach' ? 'Live tail since reattaching' : 'Streamed text'}</strong><span>{phase === 'sending' || phase === 'attached' ? 'streaming · not final' : 'partial · will be replaced by the saved answer'}</span></div><div className="lab7-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{liveText}</ReactMarkdown></div></div> : null}
        {pending && !liveText && pending.partial ? <div className="lab13-live stale"><div className="lab13-live-head"><strong>Streamed before the disconnect</strong><span>partial · from browser storage · not final</span></div><p>{pending.partial}</p></div> : null}
        <Conversation snapshot={snapshot} highlight={recoveredTurn} />
      </section>
      <section className="lab7-card">
        <span className="eyebrow">RECOVERY</span><h2>Decision and evidence</h2>
        {decision ? <DecisionCard decision={decision}>
          {pending && !busy ? <div className="lab8-actions">
            {decision.action === 'resend' ? <button type="button" className="lab7-primary" onClick={resendSame}>Send again with the same request ID</button> : null}
            {decision.action === 'offer_retry' ? <button type="button" className="lab7-primary" onClick={retryAsNew}>Retry as a new request</button> : null}
            {decision.action === 'wait' || decision.action === 'reattach' ? <button type="button" className="lab7-primary" onClick={() => { attachCount.current = 0; void check(); }}>Check again</button> : null}
            <button type="button" className="lab8-secondary" onClick={discard}>Discard the pending request</button>
          </div> : null}
        </DecisionCard> : <p className="lab8-note">No recovery needed yet. Break a stream to see the decision, or step through the playground below.</p>}
        <h3 className="lab13-subhead">Browser storage <code>lab13.recovery.v1</code></h3>
        <pre className="lab13-json">{JSON.stringify(stored, null, 2)}</pre>
        <h3 className="lab13-subhead">Recovery log</h3>
        {log.length ? <ol className="lab13-log">{log.map((entry) => <li key={entry.id} className={entry.kind}><span className="lab13-log-time">{clock(entry.at)}</span><span className={'lab13-log-kind ' + entry.kind}>{entry.kind}</span><span>{entry.text}</span></li>)}</ol> : <p className="lab8-note">Nothing yet.</p>}
      </section>
    </div>

    <section className="lab7-card" id="lab13-playground"><span className="eyebrow">RECOVERY PLAYGROUND · NO API KEY NEEDED</span><h2>Make the decision one check at a time</h2><p>Each case pairs a pending record from browser storage with the saved state the server would read. The same <code>decideRecovery</code> function decides for the live run.</p>
      <label htmlFor="lab13-scenario">Case</label>
      <select id="lab13-scenario" className="lab12-select" value={scenarioId} onChange={(event) => { setScenarioId(event.target.value); setStep(0); }}>{recoveryScenarios.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
      <p className="lab8-note">{scenario.summary}</p>
      <div className="lab13-case">
        <div><h3 className="lab13-subhead">Pending record (browser storage)</h3><pre className="lab13-json">{JSON.stringify(scenario.pending, null, 2)}</pre></div>
        <div><h3 className="lab13-subhead">Saved state (read from the API)</h3><p className="lab8-note">Session {scenario.snapshot.sessionStatus ? <><code>{scenario.snapshot.sessionId}</code> · {scenario.snapshot.sessionStatus} · found by {scenario.snapshot.foundBy}</> : 'not found'}</p><SnapshotTable snapshot={scenario.snapshot} /></div>
      </div>
      <div className="lab8-actions">
        <button type="button" className="lab8-secondary" onClick={() => setStep(0)} disabled={step === 0}>Reset</button>
        <button type="button" className="lab7-primary" onClick={() => setStep((value) => Math.min(totalSteps, value + 1))} disabled={step >= totalSteps}>{step >= totalSteps - 1 ? 'Show the decision' : 'Next check'}</button>
        <button type="button" className="lab8-secondary" onClick={() => setStep(totalSteps)} disabled={step >= totalSteps}>Show all</button>
      </div>
      <p className="lab7-session-status" role="status">Check {Math.min(step, totalSteps - 1)} of {totalSteps - 1}{step >= totalSteps ? ' · decided' : ''}</p>
      {step > 0 && step < totalSteps ? <ol className="lab13-evidence lab13-steps">{scenarioDecision.evidence.slice(0, step).map((line, index) => <li key={index} aria-current={index === step - 1 ? 'step' : undefined}>{line}</li>)}</ol> : null}
      {step >= totalSteps ? <DecisionCard decision={scenarioDecision}>{scenarioDecision.answer ? <details className="lab12-answer" open><summary>Saved answer shown to the user</summary><div className="lab7-answer"><p>{scenarioDecision.answer}</p></div>{scenario.pending.partial ? <p className="lab8-note">It replaces the {scenario.pending.partial.length} characters that streamed before the disconnect: <em>“{scenario.pending.partial}”</em></p> : null}</details> : null}</DecisionCard> : null}
    </section>

    <section className="lab3-guide lab13-guide"><h2>Read the evidence</h2><div><article><strong>Write it down</strong><p>Save a pending record with a request ID before sending. A reload leaves a trace.</p></article><article><strong>Find it</strong><p>Use the session ID, or the request ID in session metadata. Reading sends nothing.</p></article><article><strong>Match it</strong><p>Look for your question in root turns created after the last turn you knew.</p></article><article><strong>Decide</strong><p>Running: reattach. Completed: show saved. Lost: resend, same ID. Failed: ask.</p></article></div><p className="lab3-guide-note">A closed stream says nothing about the turn. The saved turn and its items are the record. Streamed text is replaced by the saved answer once the turn completes.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 13</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind disconnect recovery</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Follow one question through a disconnect: write it down, tag it, find it, match it, decide, and reattach. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Ask a question with the simulated disconnect on, and record which decision the page makes and why. Then turn the simulation off, ask a follow-up, and choose <em>Reload the page</em> while the answer streams. Show that the session holds exactly one turn for each question and that the recovered turn is labelled <em>recovered, not resent</em>. Finally, step through <em>A blind retry already ran</em> and explain what the duplicate turn cost.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/sessions/events" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
