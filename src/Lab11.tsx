import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import { AnswerPre } from './Lab6.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { applyTextEvent, emptyBuffer, orderedParts, parseTextEvent, renderText, type TextBuffer, type TextEvent } from './lab11TextBuffer.ts';
import { scenarios } from './lab11Scenarios.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type RunEvent =
  | { type: 'status'; label: string }
  | { type: 'session'; sessionId: string }
  | { type: 'text-event'; event: TextEvent }
  | { type: 'complete'; turnId: string }
  | { type: 'error'; message: string };

const lessons: Lesson[] = [
  { number: '01', title: 'Give every part its own buffer', file: 'src/lab11TextBuffer.ts', code: "export const partKey = (itemId: string, contentIndex: number): string =>\n  `${itemId}:${contentIndex}`;\n\n// msg_answer:0 and msg_answer:1 are two parts of one message.\nconst key = partKey(event.itemId, event.contentIndex);", explanation: 'A turn can produce several message items, and one message can hold several content parts. The item ID names the message and the content index names the part inside it. Keying the buffer by both keeps interleaved deltas from different parts apart.' },
  { number: '02', title: 'Append deltas, skip replays', file: 'src/lab11TextBuffer.ts', code: "if (buffer.seenEventIds.includes(event.eventId)) {\n  return { ...buffer, duplicates: buffer.duplicates + 1 };\n}\nif (event.type === 'text.delta') {\n  if (part.status === 'done') return { ...next, lateDeltas: next.lateDeltas + 1 };\n  return { ...next, parts: { ...next.parts,\n    [part.key]: { ...part, text: part.text + event.delta, deltas: part.deltas + 1 } } };\n}", explanation: 'Each output text delta adds a small piece of text to one part. Every event has a unique event ID, so an event seen twice, for example after a reconnect, is counted and skipped instead of appended again. A delta that arrives after its part is complete is ignored.' },
  { number: '03', title: 'Replace with the completed part', file: 'src/lab11TextBuffer.ts', code: "function finalizePart(part: PartState, text: string): PartState {\n  return { ...part, text, status: 'done',\n    replaced: part.replaced || part.text !== text };\n}\n// output_text.done, content_part.done and item.done all call finalizePart.", explanation: 'The deltas are a preview. The done events carry the complete text of the part, so the reducer replaces the streamed buffer instead of appending to it. Appending both is the classic duplicated-text bug shown in the naive panel. If a delta was lost, the completed text repairs the answer.' },
  { number: '04', title: 'Order parts and separate phases', file: 'src/lab11TextBuffer.ts', code: "export function renderText(buffer: TextBuffer, show: 'answer' | 'commentary'): string {\n  const messages = new Map<string, string>();\n  for (const part of orderedParts(buffer)) {\n    const isCommentary = buffer.phases[part.itemId] === 'commentary';\n    if (isCommentary !== (show === 'commentary')) continue;\n    messages.set(part.itemId, (messages.get(part.itemId) ?? '') + part.text);\n  }\n  return [...messages.values()].filter(Boolean).join('\\n\\n');\n}", explanation: 'Rendering sorts parts by output index and content index, not by arrival time. Parts of one message join directly, and separate messages become paragraphs. A message whose phase is commentary is shown as working notes, apart from the final answer.' },
  { number: '05', title: 'Forward only root text events', file: 'server/lab11.ts', code: "} else if (event.type === 'agent.session.turn.output_text.delta' && isRoot(event.turn_id)) {\n  writeEvent(response, { type: 'text-event', event: {\n    type: 'text.delta', eventId: event.event_id, itemId: event.item_id,\n    outputIndex: event.output_index, contentIndex: event.content_index,\n    delta: event.delta } });\n}", explanation: 'The server keeps the API key and sends the browser only the fields the reducer needs: the event ID, item ID, output index, content index, and text. Subagent turns are excluded so their text never mixes into the root answer. The browser validates each event before reducing it.' },
];

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
  if (event.type === 'text-event') return { type: 'text-event', event: parseTextEvent(event.event) };
  if (event.type === 'complete' && typeof event.turnId === 'string') return { type: 'complete', turnId: event.turnId };
  if (event.type === 'error' && typeof event.message === 'string') return { type: 'error', message: event.message };
  throw new Error('Invalid stream event.');
}
async function runStream(prompt: string, onEvent: (event: RunEvent) => void) {
  const response = await fetch('/api/lab11/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
  if (!response.ok) { const body = await response.json(); throw new Error(body.error || `Request failed (${response.status}).`); }
  if (!response.body) throw new Error('The browser could not read the response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
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
        if (event.type === 'complete') completed = true;
      }
    }
  } finally { reader.releaseLock(); }
  if (!completed) throw new Error('The stream ended before the turn completed. The rendered text may be partial.');
}

function describeEvent(event: TextEvent): string {
  const target = 'contentIndex' in event ? `${event.itemId}:${event.contentIndex}` : event.itemId;
  const text = event.type === 'text.delta' ? event.delta : event.type === 'item.done' ? event.parts.join(' | ') : 'text' in event ? event.text : event.phase ?? 'no phase';
  const shown = text.length > 60 ? text.slice(0, 57) + '…' : text;
  return `${event.type} · ${target}${shown ? ` · "${shown}"` : ''}`;
}

function TextComparison({ buffer, emptyLabel }: { buffer: TextBuffer; emptyLabel: string }) {
  const answer = renderText(buffer, 'answer');
  const commentary = renderText(buffer, 'commentary');
  return <div className="lab11-compare">
    <section className="lab11-panel lab11-naive"><span className="eyebrow">A · NAIVE APPEND</span><h3>Every delta and done text, in arrival order</h3><pre className="lab11-raw">{buffer.naive || emptyLabel}</pre><p className="lab8-note">{buffer.naive.length} characters · no keys, no replacement, no replay check.</p></section>
    <section className="lab11-panel lab11-keyed"><span className="eyebrow">B · KEYED BUFFER</span><h3>Parts keyed, ordered, and replaced when complete</h3>{commentary ? <div className="lab11-commentary"><strong>Working notes (commentary)</strong><p>{commentary}</p></div> : null}<div className="lab7-answer">{answer ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{answer}</ReactMarkdown> : <p className="lab7-empty">{emptyLabel}</p>}</div><p className="lab8-note">{answer.length + commentary.length} characters · {buffer.duplicates} replayed event{buffer.duplicates === 1 ? '' : 's'} skipped · {buffer.lateDeltas} late delta{buffer.lateDeltas === 1 ? '' : 's'} ignored.</p></section>
  </div>;
}

function PartsTable({ buffer }: { buffer: TextBuffer }) {
  const parts = orderedParts(buffer);
  if (!parts.length) return <p className="lab8-note">No content parts yet.</p>;
  return <div className="lab9-table-wrap lab11-table"><table><thead><tr><th scope="col">Part key</th><th scope="col">Output</th><th scope="col">Phase</th><th scope="col">Status</th><th scope="col">Deltas</th><th scope="col">Characters</th><th scope="col">Completed text</th></tr></thead><tbody>{parts.map((part) => <tr key={part.key}><td><code>{part.key}</code></td><td>{part.outputIndex}</td><td>{buffer.phases[part.itemId] ?? 'none'}</td><td>{part.status === 'done' ? 'Done' : 'Streaming'}</td><td>{part.deltas}</td><td>{part.text.length}</td><td>{part.status !== 'done' ? 'Waiting for a done event' : part.replaced ? <strong>Replaced the streamed buffer</strong> : 'Matched the deltas'}</td></tr>)}</tbody></table></div>;
}

export default function Lab11({ active, health }: { active: boolean; health: Health }) {
  const [prompt, setPrompt] = useState('Explain JavaScript closures in two short paragraphs, then give one small code example.');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Not started');
  const [error, setError] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [turnId, setTurnId] = useState('');
  const [liveBuffer, setLiveBuffer] = useState<TextBuffer>(emptyBuffer);
  const [liveEvents, setLiveEvents] = useState<TextEvent[]>([]);
  const [replayId, setReplayId] = useState(scenarios[0].id);
  const [recorded, setRecorded] = useState<TextEvent[]>([]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const scenario = replayId === 'live' ? { id: 'live', title: 'Your last live run', summary: 'The exact text events your live run forwarded, replayed through the same reducer.', events: recorded } : scenarios.find((item) => item.id === replayId) ?? scenarios[0];
  const replayBuffer = useMemo(() => scenario.events.slice(0, step).reduce(applyTextEvent, emptyBuffer()), [scenario.events, step]);
  const currentEvent = step > 0 ? scenario.events[step - 1] : null;
  const atEnd = step >= scenario.events.length;
  const currentReplayed = currentEvent !== null && scenario.events.slice(0, step - 1).some((event) => event.eventId === currentEvent.eventId);

  useEffect(() => {
    if (!playing) return;
    if (atEnd) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setStep((value) => value + 1), 650);
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
  async function run() {
    if (running || !prompt.trim()) return;
    setRunning(true); setStatus('Starting'); setError(''); setSessionId(''); setTurnId(''); setLiveBuffer(emptyBuffer()); setLiveEvents([]);
    try {
      await runStream(prompt.trim(), (event) => {
        if (event.type === 'status') setStatus(event.label);
        if (event.type === 'session') { setSessionId(event.sessionId); setStatus('Streaming text events'); }
        if (event.type === 'text-event') { setLiveBuffer((previous) => applyTextEvent(previous, event.event)); setLiveEvents((previous) => [...previous, event.event]); }
        if (event.type === 'complete') { setTurnId(event.turnId); setStatus('Completed'); }
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unknown error.'); setStatus('Failed or interrupted'); }
    finally { setRunning(false); }
  }
  function replayLive() { setRecorded(liveEvents); chooseReplay('live'); document.getElementById('lab11-replay')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  const liveParts = orderedParts(liveBuffer);
  return <div className="lab11-page">
    <div className="lab2-hero"><span className="lab2-badge lab11-badge">11/50</span><div><div className="eyebrow">LAB 11 / TEXT EVENTS</div><h1>Render text events <em>correctly.</em></h1><p>Combine output text deltas per content part, replace each buffer with its completed text, and show an answer with no duplicated words.</p></div></div>

    <section className="lab7-card"><span className="eyebrow">LIVE RUN</span><h2>Stream one answer through both strategies</h2><p>The server forwards only the root turn's message and text events. Panel A appends everything it receives. Panel B uses the keyed reducer from <code>src/lab11TextBuffer.ts</code>.</p><label htmlFor="lab11-prompt">Your question</label><textarea id="lab11-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} disabled={running} /><div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void run()} disabled={running || !health?.configured || !prompt.trim()}>{running ? 'Streaming…' : 'Run and compare'}</button>{liveEvents.length && !running ? <button type="button" className="lab8-secondary" onClick={replayLive}>Replay this run step by step</button> : null}</div>{!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env and restart the server for a live run. The replay below works without a key.</p> : null}<p className="lab7-session-status" role="status">{status}</p>{sessionId ? <p className="lab7-session-id">Session <code>{sessionId}</code></p> : null}{turnId ? <p className="lab7-session-id">Root turn <code>{turnId}</code></p> : null}{error ? <p className="lab2-error" role="alert">{error}</p> : null}</section>

    {liveEvents.length || running ? <section className="lab7-card"><span className="eyebrow">LIVE EVIDENCE · {liveEvents.length} TEXT EVENTS · {liveParts.length} PART{liveParts.length === 1 ? '' : 'S'}</span><h2>Compare the two renderings</h2><TextComparison buffer={liveBuffer} emptyLabel="Waiting for text events…" /><h3 className="lab11-subhead">Content parts</h3><PartsTable buffer={liveBuffer} />{!running && liveParts.length === 1 ? <p className="lab8-note">A live answer often has only one part. Use the scripted replays below to see several parts, commentary, and a replayed event.</p> : null}</section> : null}

    <section className="lab7-card" id="lab11-replay"><span className="eyebrow">STEP-THROUGH REPLAY · NO API KEY NEEDED</span><h2>Apply one event at a time</h2><p>These scripted sequences use the same event shape the server forwards. Step through them and watch where the two strategies diverge.</p><label htmlFor="lab11-scenario">Event sequence</label><select id="lab11-scenario" className="lab11-select" value={replayId} onChange={(event) => chooseReplay(event.target.value)}>{scenarios.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}{recorded.length ? <option value="live">Your last live run ({recorded.length} events)</option> : null}</select><p className="lab8-note">{scenario.summary}</p>
      <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => { setPlaying(false); setStep(0); }} disabled={step === 0}>Reset</button><button type="button" className="lab8-secondary" onClick={() => { setPlaying(false); setStep((value) => Math.max(0, value - 1)); }} disabled={step === 0}>Back</button><button type="button" className="lab7-primary" onClick={() => { setPlaying(false); setStep((value) => Math.min(scenario.events.length, value + 1)); }} disabled={atEnd}>Apply next event</button><button type="button" className="lab8-secondary" onClick={() => { if (atEnd) setStep(0); setPlaying((value) => !value); }} aria-pressed={playing}>{playing ? 'Pause' : atEnd ? 'Replay from start' : 'Play'}</button><button type="button" className="lab8-secondary" onClick={() => { setPlaying(false); setStep(scenario.events.length); }} disabled={atEnd}>Jump to end</button></div>
      <p className="lab7-session-status" role="status">Step {step} of {scenario.events.length}</p>
      <div className="lab11-current"><strong>Last applied event</strong>{currentEvent ? <code>{describeEvent(currentEvent)}</code> : <span>None yet. Apply the first event.</span>}{currentReplayed && currentEvent ? <em>Replayed event ID {currentEvent.eventId}: the keyed buffer skipped it, the naive panel appended it.</em> : null}</div>
      <details className="lab11-events"><summary>Event sequence ({scenario.events.length})</summary><ol>{scenario.events.map((event, index) => <li key={index} className={index < step ? 'applied' : undefined} aria-current={index === step - 1 ? 'step' : undefined}><code>{event.eventId}</code> {describeEvent(event)}</li>)}</ol></details>
      <TextComparison buffer={replayBuffer} emptyLabel="Nothing rendered yet." /><h3 className="lab11-subhead">Content parts</h3><PartsTable buffer={replayBuffer} />
    </section>

    <section className="lab3-guide lab11-guide"><h2>Read the evidence</h2><div><article><strong>Key</strong><p>Item ID plus content index names exactly one part.</p></article><article><strong>Append</strong><p>A delta extends its own part, once per event ID.</p></article><article><strong>Replace</strong><p>A done event's text replaces the part's streamed buffer.</p></article><article><strong>Order</strong><p>Output and content indexes decide the order, not arrival time.</p></article></div></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 11</span><span className="code-lessons-title" role="heading" aria-level={2}>The code behind the text buffer</span><span className="code-lessons-hint">Five explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Follow one text event from the server to the rendered answer: key, append, replace, order, and forward. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all five'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Step through <em>Replayed delta, missing delta</em> and explain, event by event, why panel A and panel B differ. Then change <code>finalizePart</code> in <code>src/lab11TextBuffer.ts</code> to append instead of replace, and confirm the keyed panel now duplicates text too. Revert it, run a live answer, and show that the keyed panel matches the completed parts in the table.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/sessions/events" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
