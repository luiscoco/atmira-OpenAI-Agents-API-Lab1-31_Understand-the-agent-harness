import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import { AnswerPre } from './Lab6.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { shortId } from './lab13Recovery.ts';
import type { ToolCall } from './lab16Tool.ts';
import { maxRounds, type TraceItem } from './lab17Action.ts';
import {
  addDays, cancelTool, classifyApprovalRun, createEngine, decide, expiryChoices, listTool, parseAudit, parsePlanner, parseSegment, plannerTools, propose, rescheduleTool, simulateEdit, todayIso, toolPolicy, toolResultEvent,
  type Approval, type ApprovalMode, type ApprovalRun, type AuditEntry, type Engine, type Moment, type Planner, type Segment, type ToolResult,
} from './lab20Approval.ts';
import { ruleTests, runRuleSuite, type RuleResult, type TestGroup } from './lab20Tests.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Live = { events: string[]; answer: string; timeline: Moment[] };
type Suite = { source: 'browser' | 'server'; runtime: string; durationMs: number; results: Record<string, RuleResult> };
type Outcome = 'ran' | 'invalid' | 'asked' | 'auto' | 'executed' | 'rejected' | 'expired' | 'stale' | 'tampered' | 'already_decided' | 'unknown';
type BenchState = { outcome: Outcome; approval: Approval | null; result: ToolResult | null; message: string | null };

const lessons: Lesson[] = [
  { number: '01', title: 'Classify every tool: reads run, writes wait', file: 'src/lab20Approval.ts · server/lab20.ts', code: "export const toolPolicy = {\n  list_study_events:      { access: 'read',  risk: 'none' },\n  reschedule_study_event: { access: 'write', risk: 'medium' },\n  cancel_study_event:     { access: 'write', risk: 'high' },\n};\n\n// server/lab20.ts — the pause\nfor (const call of waiting) {\n  const proposal = await propose(engine, call, ctx);\n  if (proposal.kind === 'asked') batch.waitingFor.add(call.callId);\n  else batch.results.push(proposal.result);  // reads, refusals\n}\nif (batch.waitingFor.size) return true;       // end the stream; the turn waits", explanation: 'The policy lives in code, right next to the tools, so the model cannot talk its way around it. Reading the planner is harmless, so it runs at once. Moving or cancelling an event changes something the student owns, so it waits. When a pause contains a write, the server answers what it can, keeps those results, and stops the stream. The Agents API keeps the turn paused on requires action until every call has a result, however long the person takes.' },
  { number: '02', title: 'Validate before you ask', file: 'src/lab20Approval.ts', code: "export function checkCall(call, planner, today): Checked {\n  const shape = checkSchema(parsed.value, tool.parameters);   // Lab 18\n  if (!event) meaning('/event_id', 'missing', '… Call list_study_events for the IDs.');\n  else if (!event.movable) meaning('/event_id', 'locked', '… belongs to the course staff');\n  if (!isRealDate(date)) meaning('/new_date', 'date', '… is not a real calendar date.');\n  else if (date < today) meaning('/new_date', 'past', …);\n  else if (outsideStudyHours) meaning('/new_start', 'hours', …);\n}\n// invalid → the student is never asked; the agent gets the reasons", explanation: 'Never ask a person to approve something that cannot work. Check the arguments first, exactly as in Lab 18, and then the rules only your planner knows: the event exists, it is not a staff event, the date is real and not in the past, and the time fits study hours. An invalid change goes straight back to the agent with the reasons, and the student is not interrupted. Approval is for decisions, not for catching bugs.' },
  { number: '03', title: 'Show a preview computed by code', file: 'src/lab20Approval.ts', code: "export function buildPreview(checked, planner): Preview {\n  const event = checked.event;                     // the stored event\n  const moved = { ...event, date: args.new_date, start: args.new_start };\n  const clashes = planner.events.filter((item) => overlaps(moved, item));\n  return {\n    summary: `Move “${event.title}” from ${describeWhen(event)} to ${describeWhen(moved)}.`,\n    changes: [{ field: 'date', before, after }, { field: 'start', before, after }],\n    warnings: clashes.map((item) => `Overlaps “${item.title}” …`),\n    agentReason: args.reason,                       // labelled as the agent's words\n    version: event.version,\n  };\n}", explanation: 'The person must see what will really happen, not what the model says will happen. The preview is built by code from the stored event: the title, the exact before and after, and any clash with another event. The agent’s own reason is still shown, but it is labelled as the agent’s words, because a model can describe a change wrongly or persuasively. The preview also records the event version the person is looking at.' },
  { number: '04', title: 'Bind the decision to the exact change', file: 'src/lab20Approval.ts', code: "export async function digestOf(name, callId, args) {\n  const bytes = new TextEncoder().encode(JSON.stringify({ name, callId, args: canonical(args) }));\n  return hex(await crypto.subtle.digest('SHA-256', bytes));\n}\n\nexport async function decide(engine, input, now) {\n  const approval = engine.approvals.get(input.callId);\n  if (approval.status !== 'pending') return refuse('already_decided');\n  if (input.digest !== approval.digest) return refuse('tampered');\n  …\n  execute(engine, approval);   // the server's stored arguments, never the browser's\n}", explanation: 'An approval means yes to this change, and nothing else. The server stores the arguments it showed and a SHA-256 digest of them. The browser sends the digest back with the decision. If it does not match, nothing runs and the approval stays pending. When it does match, the server runs its own stored arguments, never arguments from the request. Each approval is decided once, so a double click or a replayed request cannot run the change twice.' },
  { number: '05', title: 'Re-check at the moment you act', file: 'src/lab20Approval.ts', code: "if (now > approval.expiresAt) {\n  approval.status = 'expired';\n  return result('… the approval expired and nothing was changed. Do not retry on your own …');\n}\n\nexport function applyChange(planner, name, args, expectedVersion): Applied {\n  const before = planner.events.find((item) => item.id === args.event_id);\n  if (before.version !== expectedVersion) return { kind: 'stale', current: before };\n  const after = { ...before, date: args.new_date, start: args.new_start, version: before.version + 1 };\n  return { kind: 'applied', planner: …, before, after };\n}", explanation: 'Time passes between the preview and the click. An approval is valid for a limited window, five minutes here or twenty seconds in the demo, and a late decision does not count. The world can also change in between: someone may move the same event in another app. So the change runs only if the event still has the version the person approved. This is optimistic concurrency. A stale approval changes nothing, and the agent is told to propose again with the current details.' },
  { number: '06', title: 'Record the decision, then resume the turn', file: 'server/lab20.ts', code: "const decided = await decide(engine, { sessionId, callId, digest, decision, reason }, Date.now());\nrecord(engine, { decision: 'approved', actor: 'student', outcome: 'executed · v1 → v2', reason, digest });\n\nbatch.results.push(decided.result);\nbatch.waitingFor.delete(callId);\nif (batch.waitingFor.size) return;                 // more decisions in this pause\n// Open the stream first, then send, so nothing is missed.\nconst stream = await api.beta.agents.sessions.events.stream(sessionId);\nawait api.beta.agents.sessions.events.create(sessionId, { events: batch.results.map(toolResultEvent) });\nawait follow(api, response, trace, stream);", explanation: 'Every step goes into an append-only audit log: what the agent proposed, what the student saw, who decided, the reason, and what actually happened. Then the decision becomes a tool result the agent can act on. Done, with the new time. Rejected, with the student’s reason. Expired, or changed underneath. When every call in the pause has a result, the server opens the event stream first, sends the results, and follows the same turn to its answer.' },
];

const today = todayIso();
const prompts = [
  { label: 'Move one event', text: 'Move my Lab 19 review to Friday at 17:00.' },
  { label: 'Cancel (high risk)', text: 'Cancel the study group, I feel ill.' },
  { label: 'Clash', text: 'Move my Lab 19 review so it starts 30 minutes after the study group starts, same day.' },
  { label: 'Staff event', text: 'Move the live Q&A to tomorrow at 10:00.' },
  { label: 'Two changes', text: 'Push the Lab 20 session and the study group back by one day each, same times.' },
];

const benchPresets: Array<{ label: string; name: string; args: Record<string, unknown> }> = [
  { label: 'Read the planner', name: listTool.name, args: {} },
  { label: 'Move the review', name: rescheduleTool.name, args: { event_id: 'evt_review_19', new_date: addDays(today, 3), new_start: '17:00', reason: 'The user asked to move it later in the week.' } },
  { label: 'Move onto the study group', name: rescheduleTool.name, args: { event_id: 'evt_review_19', new_date: addDays(today, 4), new_start: '19:30', reason: 'The user wants to review right after the group starts.' } },
  { label: 'Cancel the study group', name: cancelTool.name, args: { event_id: 'evt_study_group', reason: 'The user said they feel ill.' } },
  { label: 'Move the staff Q&A', name: rescheduleTool.name, args: { event_id: 'evt_live_qna', new_date: addDays(today, 1), new_start: '10:00', reason: 'The user asked.' } },
  { label: 'Move to 30 February', name: rescheduleTool.name, args: { event_id: 'evt_lab_20', new_date: '2026-02-30', new_start: '10:00', reason: 'The user asked.' } },
];

const groups: Array<{ id: TestGroup; label: string }> = [
  { id: 'ask', label: 'When the agent proposes' },
  { id: 'decide', label: 'When the student decides' },
  { id: 'guard', label: 'Guards at decision time' },
];

const steps = [
  { id: 'classify', label: 'Classify', detail: 'read or write' },
  { id: 'validate', label: 'Validate', detail: 'before asking' },
  { id: 'preview', label: 'Preview', detail: 'built by code' },
  { id: 'decide', label: 'Decide', detail: 'a person, once' },
  { id: 'recheck', label: 'Re-check', detail: 'digest · time · version' },
  { id: 'apply', label: 'Apply', detail: 'stored arguments' },
  { id: 'record', label: 'Record', detail: 'audit + tool_result' },
];
type StepState = '' | 'pass' | 'fail' | 'skip' | 'wait' | 'warn';
const flows: Record<Outcome, StepState[]> = {
  ran: ['pass', 'pass', 'skip', 'skip', 'skip', 'pass', 'pass'],
  invalid: ['pass', 'fail', 'skip', 'skip', 'skip', 'skip', 'pass'],
  asked: ['pass', 'pass', 'pass', 'wait', '', '', ''],
  auto: ['pass', 'pass', 'pass', 'warn', 'pass', 'pass', 'pass'],
  executed: ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass'],
  rejected: ['pass', 'pass', 'pass', 'fail', 'skip', 'skip', 'pass'],
  expired: ['pass', 'pass', 'pass', 'pass', 'fail', 'skip', 'pass'],
  stale: ['pass', 'pass', 'pass', 'pass', 'fail', 'skip', 'pass'],
  tampered: ['pass', 'pass', 'pass', 'wait', 'fail', 'skip', 'pass'],
  already_decided: ['pass', 'pass', 'pass', 'pass', 'fail', 'skip', 'pass'],
  unknown: ['', '', '', 'fail', 'skip', 'skip', ''],
};
const outcomeText: Record<Outcome, string> = {
  ran: 'Read ran at once. No approval needed.',
  invalid: 'Refused before asking. The agent gets the reasons; the student is not interrupted.',
  asked: 'Waiting for a person. Nothing has changed yet.',
  auto: 'Applied by policy with nobody asked. This is the unsafe comparison.',
  executed: 'Approved, re-checked, applied, and recorded.',
  rejected: 'Rejected. Nothing ran; the reason goes to the agent.',
  expired: 'The decision arrived after the approval expired. Nothing ran.',
  stale: 'Approved, but the event had changed since the preview. Nothing ran.',
  tampered: 'The decision did not match the change shown. Nothing ran; still pending.',
  already_decided: 'Already decided. Nothing ran twice.',
  unknown: 'No approval is waiting for that call.',
};

function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}
const json = (value: unknown) => codeTokens(Prism.tokenize(JSON.stringify(value, null, 2) ?? 'undefined', Prism.languages.json || Prism.languages.javascript));
const newId = (): string => `run_${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)}`;
const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour12: false });
const secondsLeft = (approval: Approval, now: number) => Math.max(0, Math.ceil((approval.expiresAt - now) / 1000));
const parseOutput = (output: string | null): unknown => { if (output === null) return null; try { return JSON.parse(output); } catch { return output; } };

async function readLines(response: Response, onLine: (line: Record<string, unknown>) => void) {
  if (!response.body) throw new Error('The browser could not read the response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop() || '';
    for (const raw of lines) if (raw.trim()) onLine(JSON.parse(raw) as Record<string, unknown>);
  }
}

function Flow({ outcome }: { outcome: Outcome | null }) {
  const states = outcome ? flows[outcome] : steps.map((): StepState => '');
  return <ol className="lab18-pipeline lab20-flow" aria-label="Approval flow">{steps.map((step, index) => {
    const state = states[index];
    return <li key={step.id} className={state}><span>{state === 'pass' ? '✓' : state === 'fail' ? '✕' : state === 'wait' ? '…' : state === 'warn' ? '!' : index + 1}</span><strong>{step.label}</strong><small>{state === 'skip' ? 'not needed' : state === 'warn' ? 'skipped by policy' : state === 'wait' ? 'waiting' : step.detail}</small></li>;
  })}</ol>;
}

function ApprovalCard({ approval, now, busy, onDecide, onEdit, onTamper }: { approval: Approval; now: number; busy: boolean; onDecide: (decision: 'approve' | 'reject', reason: string) => void; onEdit?: () => void; onTamper?: () => void }) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const left = secondsLeft(approval, now);
  const high = approval.preview.risk === 'high';
  const pending = approval.status === 'pending';
  return <article className={'lab20-approval risk-' + approval.preview.risk + (pending ? '' : ' decided')}>
    <div className="lab20-approval-head"><span className={'lab20-risk ' + approval.preview.risk}>{approval.preview.risk} risk</span><strong>{toolPolicy[approval.name]?.label ?? approval.name}</strong><code>{approval.name}</code>{pending ? <span className={'lab20-timer' + (left <= 10 ? ' low' : '')}>{left > 0 ? `expires in ${left >= 60 ? `${Math.floor(left / 60)}m ${left % 60}s` : `${left}s`}` : 'expired: a decision now will be refused'}</span> : <span className={'lab20-status ' + approval.status}>{approval.status}</span>}</div>
    <p className="lab20-summary">{approval.preview.summary}</p>
    <div className="lab9-table-wrap"><table className="lab20-diff"><thead><tr><th>Field</th><th>Before</th><th /><th>After</th></tr></thead><tbody>{approval.preview.changes.map((change) => <tr key={change.field}><th>{change.field}</th><td className="before">{change.before}</td><td aria-hidden="true">→</td><td className="after">{change.after}</td></tr>)}</tbody></table></div>
    {approval.preview.warnings.map((warning) => <p key={warning} className="lab20-warning">⚠ {warning}</p>)}
    <p className="lab20-claim"><span>The agent’s reason · its words, not verified</span>“{approval.preview.agentReason}”</p>
    <p className="lab15-ids">event <code>{approval.preview.eventId}</code> · version <b>v{approval.preview.version}</b> · digest <code title={approval.digest}>{approval.digest.slice(0, 16)}…</code> · call <code>{shortId(approval.callId)}</code></p>
    {pending ? <>
      <label htmlFor={`reason-${approval.callId}`}>Your reason <small>optional · sent to the agent</small></label>
      <input id={`reason-${approval.callId}`} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="e.g. I have football on Friday" disabled={busy} />
      {high ? <label className="lab20-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} /> I understand this cancels “{approval.preview.title}”.</label> : null}
      <div className="lab8-actions"><button type="button" className="lab7-primary lab20-approve" onClick={() => onDecide('approve', reason)} disabled={busy || (high && !confirmed)}>{busy ? 'Sending…' : 'Approve this change'}</button><button type="button" className="lab8-secondary lab20-reject" onClick={() => onDecide('reject', reason)} disabled={busy}>Reject</button></div>
      {onEdit || onTamper ? <details className="lab20-guards"><summary>Test the guards</summary><div className="lab8-actions">{onEdit ? <button type="button" className="lab8-secondary" onClick={onEdit} disabled={busy}>Someone else edits this event</button> : null}{onTamper ? <button type="button" className="lab8-secondary" onClick={onTamper} disabled={busy}>Send a tampered approval</button> : null}</div><p className="lab8-note">An edit bumps the event’s version, so approving afterwards is refused as stale. A tampered approval sends a different digest, and the server refuses it and keeps the approval pending.</p></details> : null}
    </> : approval.reason ? <p className="lab8-note">Your reason: “{approval.reason}”</p> : null}
  </article>;
}

function PlannerTable({ planner, highlight }: { planner: Planner; highlight?: string | null }) {
  return <div className="lab9-table-wrap lab20-planner"><table><thead><tr><th>Event</th><th>When</th><th>Length</th><th>Status</th><th>Version</th></tr></thead>
    <tbody>{planner.events.map((event) => <tr key={event.id} className={(event.status === 'cancelled' ? 'cancelled ' : '') + (event.version > 1 ? 'changed ' : '') + (highlight === event.id ? 'selected' : '')}>
      <th>{event.title}<small>{event.id}{event.movable ? '' : ' · staff event'}</small></th><td>{event.date} {event.start}</td><td>{event.durationMin ? `${event.durationMin} min` : 'deadline'}</td><td><span className={'lab20-status ' + event.status}>{event.status}</span></td><td>v{event.version}</td></tr>)}</tbody></table></div>;
}

function AuditTable({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return <p className="lab8-note">No entries yet.</p>;
  return <div className="lab9-table-wrap lab20-audit"><table><thead><tr><th>#</th><th>Time</th><th>Decision</th><th>Actor</th><th>What</th><th>Outcome</th><th>Reason</th></tr></thead>
    <tbody>{entries.map((entry) => <tr key={entry.id}><td>{entry.id}</td><td>{clock(entry.at)}</td><td><span className={'lab20-decision ' + entry.decision}>{entry.decision}</span></td><td>{entry.actor}</td><td className="lab20-what">{entry.summary}<small>{entry.tool}{entry.digest ? ` · ${entry.digest}` : ''}</small></td><td>{entry.outcome}</td><td>{entry.reason ?? '—'}</td></tr>)}</tbody></table></div>;
}

function ResultBlock({ result }: { result: ToolResult }) {
  return <div className="lab16-args"><div><h4>tool_result <small>what the agent receives</small></h4><pre className="lab19-scroll"><code>{json(toolResultEvent(result))}</code></pre></div><div>{result.success ? <><h4>output, parsed</h4><pre className="lab19-scroll"><code>{json(parseOutput(result.output))}</code></pre></> : <><h4>error <small>written for the agent</small></h4><p className="lab20-error-text">{result.error}</p></>}</div></div>;
}

function Timeline({ moments }: { moments: Moment[] }) {
  if (!moments.length) return null;
  const first = moments[0].at;
  return <ol className="lab17-timeline lab20-timeline">{moments.map((moment, index) => <li key={index} className={moment.kind}><span className="lab17-at">+{((moment.at - first) / 1000).toFixed(1)}s</span><span className="lab17-kind">{moment.kind}</span><span className="lab17-label">{moment.label}</span></li>)}</ol>;
}

function RunView({ run }: { run: ApprovalRun }) {
  const verdict = classifyApprovalRun(run);
  const first = run.segments[0];
  return <div className="lab16-run">
    <div className={'lab16-verdict lab20-verdict ' + verdict.tone}><strong>{verdict.title}</strong><p>{verdict.text}</p></div>
    <div className="lab15-summary-head"><span className="lab15-ids">policy <code>{run.mode === 'ask' ? 'ask me' : 'auto-approve'}</code> · requests <b>{run.segments.length}</b>{first?.sessionId ? <> · session <code>{shortId(first.sessionId)}</code></> : null}</span></div>
    {run.segments.map((segment, index) => <section key={index} className="lab20-segment">
      <h3 className="lab13-subhead">{index === 0 ? 'Request 1 · your question' : `Request ${index + 1} · your decision`} <code>{segment.turnStatus}</code></h3>
      <Timeline moments={segment.timeline} />
      {segment.answer ? <div className="lab7-answer lab16-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{segment.answer}</ReactMarkdown></div> : null}
      {segment.results.filter((result) => result.name !== listTool.name).map((result) => <details key={result.callId} className="lab16-preview"><summary>{result.name} → {result.success ? 'success' : 'error'} <small>{shortId(result.callId)}</small></summary><ResultBlock result={result} /></details>)}
      {segment.error ? <p className="lab2-error" role="alert">{segment.error}</p> : null}
    </section>)}
  </div>;
}

function SavedItems({ items }: { items: TraceItem[] }) {
  return <ol className="lab17-items">{items.map((item, index) => <li key={item.id ?? index} className={item.type}>
    <div><code className="lab17-item-type">{item.type}</code>{item.role ? <span className="lab17-role">{item.role}</span> : null}{item.name ? <code>{item.name}</code> : null}{item.callId ? <span className="lab15-ids">call_id <code>{shortId(item.callId)}</code></span> : null}</div>
    {item.text ? <p>{item.text.length > 280 ? `${item.text.slice(0, 280)}…` : item.text}</p> : null}
    {item.type === 'function_call' ? <pre><code>{json(item.arguments)}</code></pre> : null}
    {item.type === 'function_call_output' ? <pre className="lab19-scroll"><code>{json(item.error ? { error: item.error } : { output: typeof item.output === 'string' ? parseOutput(item.output) : item.output })}</code></pre> : null}
  </li>)}</ol>;
}

function parseSuite(body: unknown): Suite {
  const value = body as { results?: unknown; runtime?: unknown; durationMs?: unknown };
  if (!Array.isArray(value.results)) throw new Error('Invalid test results.');
  const results: Record<string, RuleResult> = {};
  for (const raw of value.results as RuleResult[]) {
    if (typeof raw?.id !== 'string' || typeof raw.pass !== 'boolean' || typeof raw.got !== 'string') throw new Error('Invalid test result.');
    results[raw.id] = { ...raw, audit: parseAudit(raw.audit) };
  }
  return { source: 'server', runtime: typeof value.runtime === 'string' ? value.runtime : 'Node', durationMs: typeof value.durationMs === 'number' ? value.durationMs : 0, results };
}

// The outcome of the latest approval in a run, for the flow diagram.
const latestOutcome = (run: ApprovalRun | null): Outcome | null => {
  if (!run) return null;
  const approvals = run.segments.flatMap((segment) => segment.approvals);
  const last = approvals.at(-1);
  if (!last) { const results = run.segments.flatMap((segment) => segment.results); const write = results.find((item) => toolPolicy[item.name]?.access === 'write'); return write ? (write.success ? (run.mode === 'auto' ? 'auto' : 'executed') : 'invalid') : results.length ? 'ran' : null; }
  if (last.status === 'pending') return 'asked';
  if (last.status === 'rejected') return 'rejected';
  if (last.status === 'expired') return 'expired';
  const result = run.segments.flatMap((segment) => segment.results).find((item) => item.callId === last.callId);
  return result?.success ? 'executed' : 'stale';
};

export default function Lab20({ active, health }: { active: boolean; health: Health }) {
  const bench = useRef<Engine>(createEngine(today));
  const [benchTick, setBenchTick] = useState(0);
  const [benchState, setBenchState] = useState<BenchState | null>(null);
  const [benchExpiry, setBenchExpiry] = useState<'normal' | 'short'>('normal');
  const [suite, setSuite] = useState<Suite | null>(null);
  const [suiteBusy, setSuiteBusy] = useState<'browser' | 'server' | null>(null);
  const [testId, setTestId] = useState(ruleTests[0].id);
  const [planner, setPlanner] = useState<Planner | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [prompt, setPrompt] = useState(prompts[0].text);
  const [mode, setMode] = useState<ApprovalMode>('ask');
  const [expiry, setExpiry] = useState<'normal' | 'short'>('normal');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [live, setLive] = useState<Live | null>(null);
  const [runs, setRuns] = useState<ApprovalRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<{ runId: string; list: TraceItem[] } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const abort = useRef<AbortController | null>(null);
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const selected = runs.find((run) => run.id === selectedId) ?? runs.at(-1) ?? null;
  const test = ruleTests.find((item) => item.id === testId) ?? ruleTests[0];
  const testResult = suite?.results[test.id] ?? null;
  const passed = suite ? Object.values(suite.results).filter((item) => item.pass).length : 0;
  // The approvals still waiting in the selected run: the latest copy of each, while the last request left the turn waiting.
  const pendingApprovals = (() => {
    if (!selected || selected.segments.at(-1)?.turnStatus !== 'waiting') return [];
    const latest = new Map<string, Approval>();
    for (const segment of selected.segments) for (const approval of segment.approvals) latest.set(approval.callId, approval);
    return [...latest.values()].filter((item) => item.status === 'pending');
  })();

  async function refreshState() {
    try {
      const response = await fetch('/api/lab20/state');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      setPlanner(parsePlanner(body.planner)); setAudit(parseAudit(body.audit));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not read the planner.'); }
  }
  async function resetState() {
    await fetch('/api/lab20/reset', { method: 'POST' });
    setNotice('The planner and the audit log were reset. Approvals still on screen are forgotten by the server.');
    await refreshState();
  }

  // ---- The offline bench: the same engine, in this browser ----
  const benchPlanner = bench.current.planner;
  async function benchPropose(preset: (typeof benchPresets)[number]) {
    const call: ToolCall = { callId: `call_bench_${Date.now().toString(36)}`, name: preset.name, turnId: 'turn_bench', itemId: null, status: null, arguments: preset.args };
    const proposal = await propose(bench.current, call, { sessionId: 'sess_bench', turnId: 'turn_bench', mode: 'ask', now: Date.now(), expiryMs: expiryChoices[benchExpiry], today });
    setBenchState({ outcome: proposal.kind, approval: proposal.approval, result: proposal.result, message: null }); setBenchTick((tick) => tick + 1);
  }
  async function benchDecide(decision: 'approve' | 'reject', reason: string, digest?: string) {
    const approval = benchState?.approval;
    if (!approval) return;
    const decided = await decide(bench.current, { callId: approval.callId, sessionId: 'sess_bench', decision, reason, digest: digest ?? approval.digest }, Date.now());
    setBenchState({ outcome: decided.kind, approval: 'approval' in decided ? { ...decided.approval } : { ...approval }, result: 'result' in decided ? decided.result : benchState?.result ?? null, message: 'message' in decided ? decided.message : null });
    setBenchTick((tick) => tick + 1);
  }
  function benchEdit() {
    if (!benchState?.approval) return;
    simulateEdit(bench.current, benchState.approval.preview.eventId, 'sess_bench', Date.now());
    setBenchTick((tick) => tick + 1);
  }
  function benchReset() { bench.current = createEngine(today); setBenchState(null); setBenchTick((tick) => tick + 1); }

  async function runInBrowser() {
    setSuiteBusy('browser'); setError('');
    const started = performance.now();
    try {
      const results = await runRuleSuite();
      setSuite({ source: 'browser', runtime: 'this browser', durationMs: Math.round(performance.now() - started), results: Object.fromEntries(results.map((item) => [item.id, item])) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The suite crashed.'); }
    finally { setSuiteBusy(null); }
  }
  async function runOnServer() {
    setSuiteBusy('server'); setError('');
    try {
      const response = await fetch('/api/lab20/test', { method: 'POST' });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
      setSuite(parseSuite(body));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not run the suite on the server.'); }
    finally { setSuiteBusy(null); }
  }

  // ---- The live run: one request per step, joined into one run ----
  function onLine(line: Record<string, unknown>, capture: (summary: unknown) => void) {
    if (line.type === 'status' && typeof line.label === 'string') setStatus(line.label);
    if (line.type === 'event' && typeof line.name === 'string') { const name = line.name; setLive((previous) => previous && { ...previous, events: [...previous.events, name] }); }
    if (line.type === 'text' && typeof line.text === 'string') { const answer = line.text; setLive((previous) => previous && { ...previous, answer }); }
    if (line.type === 'moment' && typeof line.moment === 'object' && line.moment) { const moment = line.moment as Moment; setLive((previous) => previous && { ...previous, timeline: [...previous.timeline, moment] }); }
    if (line.type === 'summary') capture(line.summary);
  }
  async function stream(url: string, body: unknown): Promise<Segment | { refused: string }> {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true); setError(''); setNotice(''); setStatus(''); setItems(null); setLive({ events: [], answer: '', timeline: [] });
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify(body) });
      if (!response.ok) {
        const failure = await response.json() as { error?: string; kind?: string };
        if (failure.kind) return { refused: failure.error ?? 'Refused.' };
        throw new Error(failure.error || `Request failed (${response.status}).`);
      }
      let segment: Segment | null = null;
      await readLines(response, (line) => onLine(line, (summary) => { segment = parseSegment(summary); }));
      if (!segment) throw new Error('The stream ended without a summary.');
      return segment;
    } finally {
      if (abort.current === controller) abort.current = null;
      setRunning(false); setLive(null);
      void refreshState();
    }
  }
  async function runOnce() {
    const question = prompt.trim();
    if (!question || running) return;
    const id = newId();
    try {
      const segment = await stream('/api/lab20/run', { prompt: question, mode, expiry });
      if ('refused' in segment) throw new Error(segment.refused);
      setRuns((previous) => [...previous, { id, prompt: question, mode, segments: [segment] }]);
      setSelectedId(id);
    } catch (caught) { if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error ? caught.message : 'The run failed.'); }
  }
  async function decideLive(approval: Approval, decision: 'approve' | 'reject', reason: string, digest = approval.digest) {
    if (!selected || running) return;
    const runId = selected.id;
    try {
      const segment = await stream('/api/lab20/decide', { sessionId: approval.sessionId, callId: approval.callId, decision, reason, digest });
      if ('refused' in segment) { setNotice(`Refused by the server: ${segment.refused}`); return; }
      setRuns((previous) => previous.map((run) => (run.id === runId ? { ...run, segments: [...run.segments, segment] } : run)));
    } catch (caught) { if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error ? caught.message : 'The decision failed.'); }
  }
  async function editLive(approval: Approval) {
    const response = await fetch('/api/lab20/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: approval.preview.eventId }) });
    const body = await response.json();
    setNotice(response.ok ? `Someone else moved “${approval.preview.title}” to ${body.event.date} ${body.event.start} (now v${body.event.version}). Approve now to see the stale check.` : body.error);
    void refreshState();
  }
  async function replayLast() {
    const approval = selected?.segments.flatMap((segment) => segment.approvals).filter((item) => item.status !== 'pending').at(-1);
    if (!approval) return;
    const response = await fetch('/api/lab20/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: approval.sessionId, callId: approval.callId, decision: 'approve', digest: approval.digest }) });
    const body = await response.json();
    setNotice(`Replayed the approval: HTTP ${response.status} · ${body.error ?? 'accepted'}`);
    void refreshState();
  }
  async function readItems(run: ApprovalRun) {
    const sessionId = run.segments[0]?.sessionId;
    if (!sessionId) return;
    try {
      const response = await fetch(`/api/lab20/items?${new URLSearchParams({ sessionId })}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      setItems({ runId: run.id, list: Array.isArray(body.items) ? body.items as TraceItem[] : [] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not read the saved items.'); }
  }

  useEffect(() => { if (active && !planner) void refreshState(); }, [active]);
  // Tick once a second while anything waits, so the expiry countdowns move.
  useEffect(() => {
    if (!pendingApprovals.length && benchState?.outcome !== 'asked') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pendingApprovals.length, benchState?.outcome]);
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

  return <div className="lab16-page lab17-page lab18-page lab20-page" data-tick={benchTick}>
    <div className="lab2-hero"><span className="lab2-badge lab20-badge">20/50</span><div><div className="eyebrow">LAB 20 / APPROVE A WRITE ACTION</div><h1>Approve a <em>write action</em>.</h1><p>Lab 19 only read. Now the agent can change something: the student’s study planner. Reading still runs at once, but moving or cancelling an event <b>pauses the turn</b> until a person decides. The server shows a preview it computed itself, binds the decision to those exact arguments, re-checks everything at the moment it acts, records who decided what, and tells the agent the outcome.</p></div></div>

    <section className="lab7-card"><span className="eyebrow">THE RULE</span><h2>Reads run. Writes wait for a person.</h2>
      <div className="lab20-policy">{plannerTools.map((tool) => { const policy = toolPolicy[tool.name]; return <div key={tool.name} className={policy.access}><code>{tool.name}</code><span className={'lab20-risk ' + policy.risk}>{policy.access === 'read' ? 'read · runs at once' : `write · ${policy.risk} risk · needs approval`}</span><small>{policy.label}</small></div>; })}</div>
      <p>Every call passes these steps. Select a test, a bench proposal, or a live run to see where it went.</p>
      <Flow outcome={benchState?.outcome ?? latestOutcome(selected) ?? (testResult ? testResult.got as Outcome : null)} />
      <p className="lab8-note">While the student decides, the turn stays paused on the Agents API (<code>requires_action</code>). The server holds the ready results and sends them, together with the decision, in one <code>events.create</code> call. Approvals expire after {expiryChoices.normal / 60_000} minutes ({expiryChoices.short / 1000} seconds in the demo setting).</p>
    </section>

    <section className="lab7-card"><span className="eyebrow">THE STUDY PLANNER · ON THE SERVER</span><h2>What the agent can change</h2>
      {planner ? <PlannerTable planner={planner} highlight={pendingApprovals[0]?.preview.eventId} /> : <p className="lab8-note">Loading…</p>}
      <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => void refreshState()}>Refresh</button><button type="button" className="lab8-secondary" onClick={() => void resetState()} disabled={running}>Reset planner and audit log</button></div>
      <p className="lab8-note">Dates are relative to today ({today}). Staff events (the live Q&amp;A and the project deadline) cannot be moved or cancelled. State lives in server memory; a restart resets it.</p>
    </section>

    <section className="lab7-card" id="lab20-bench"><span className="eyebrow">APPROVAL BENCH · NO API KEY NEEDED</span><h2>Play the agent, then play the student</h2><p>Pick a call an agent might make. It runs through the same <code>propose</code> and <code>decide</code> functions as the server, on a separate planner in this browser.</p>
      <div className="lab16-prompts">{benchPresets.map((preset) => <button type="button" key={preset.label} onClick={() => void benchPropose(preset)} disabled={benchState?.outcome === 'asked' && benchState.approval?.status === 'pending'}>{preset.label}</button>)}</div>
      <fieldset className="lab15-modes lab16-after"><legend>Approval window</legend>
        <label className={benchExpiry === 'normal' ? 'selected' : ''}><input type="radio" name="lab20-bench-expiry" checked={benchExpiry === 'normal'} onChange={() => setBenchExpiry('normal')} /><span><strong>5 minutes</strong><small>A normal window.</small></span></label>
        <label className={benchExpiry === 'short' ? 'selected' : ''}><input type="radio" name="lab20-bench-expiry" checked={benchExpiry === 'short'} onChange={() => setBenchExpiry('short')} /><span><strong>20 seconds</strong><small>Wait it out, then approve.</small></span></label>
      </fieldset>
      <div className="lab20-bench">
        <div>
          {benchState ? <>
            <p className={'lab20-outcome ' + benchState.outcome}><b>{benchState.outcome}</b> · {outcomeText[benchState.outcome]}</p>
            {benchState.message ? <p className="lab8-note">{benchState.message}</p> : null}
            {benchState.approval ? <ApprovalCard key={benchState.approval.callId + benchState.approval.status} approval={benchState.approval} now={now} busy={false} onDecide={(decision, reason) => void benchDecide(decision, reason)} onEdit={benchEdit} onTamper={() => void benchDecide('approve', '', '0'.repeat(64))} /> : null}
            {benchState.approval && benchState.approval.status !== 'pending' ? <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => void benchDecide('approve', '')}>Send the same approval again</button></div> : null}
            {benchState.result ? <ResultBlock result={benchState.result} /> : null}
          </> : <p className="lab8-note">Start with <em>Move the review</em>, approve it, and watch the planner’s version go up. Then try <em>Move the staff Q&amp;A</em>: nobody is asked.</p>}
          <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={benchReset}>Reset the bench</button></div>
        </div>
        <div>
          <h3 className="lab13-subhead">Bench planner <code>this browser</code></h3>
          <PlannerTable planner={benchPlanner} highlight={benchState?.approval?.preview.eventId} />
          <h3 className="lab13-subhead">Bench audit log <code>append-only</code></h3>
          <AuditTable entries={[...bench.current.audit].reverse()} />
        </div>
      </div>
    </section>

    <section className="lab7-card" id="lab20-tests"><span className="eyebrow">RULES TEST PAGE · NO API KEY NEEDED</span><h2>{ruleTests.length} scenarios, each on a fresh engine</h2><p>Every scenario proposes and decides with the server’s own engine. Run it in this browser or on the server.</p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void runInBrowser()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'browser' ? 'Running…' : 'Run all in the browser'}</button><button type="button" className="lab8-secondary" onClick={() => void runOnServer()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'server' ? 'Running…' : 'Run all on the server'}</button></div>
      {suite ? <p className={'lab18-score ' + (passed === ruleTests.length ? 'ok' : 'fail')}><b>{passed}/{ruleTests.length} passed</b> · ran in {suite.runtime} · {suite.durationMs} ms</p> : <p className="lab8-note">Not run yet. Each row states the outcome it must reach.</p>}
      <div className="lab18-tests">
        <div className="lab9-table-wrap lab18-table lab20-table"><table>
          <thead><tr><th>Scenario</th><th>Expect</th><th>Got</th><th /></tr></thead>
          {groups.map((group) => <tbody key={group.id}><tr className="lab18-group"><th colSpan={4}>{group.label}</th></tr>{ruleTests.filter((item) => item.group === group.id).map((item) => { const result = suite?.results[item.id]; return <tr key={item.id} className={item.id === test.id ? 'selected' : ''} onClick={() => setTestId(item.id)}>
            <th><button type="button" className="lab15-link" onClick={() => setTestId(item.id)} aria-pressed={item.id === test.id}>{item.label}</button></th>
            <td><span className="lab18-expect">{item.expect}</span></td><td>{result ? <span className="lab18-expect">{result.got}</span> : '—'}</td>
            <td>{result ? <span className={'lab18-pass ' + (result.pass ? 'ok' : 'fail')}>{result.pass ? 'PASS' : 'FAIL'}</span> : null}</td></tr>; })}</tbody>)}
        </table></div>
        <div className="lab18-detail lab20-detail">
          <h3 className="lab13-subhead">{test.label} <code>expect {test.expect}</code></h3>
          <p className="lab8-note">{test.note}</p>
          {testResult ? <><Flow outcome={testResult.got as Outcome} /><p className="lab20-detail-line">{testResult.detail}</p>{testResult.result ? <ResultBlock result={{ callId: 'call_1', turnId: 'turn_test', name: '', ...testResult.result }} /> : null}<h4 className="lab18-h4">Audit log <small>this scenario</small></h4><AuditTable entries={[...testResult.audit].reverse()} /></> : <p className="lab8-note">Run the suite to see this scenario’s outcome, the tool result, and its audit log.</p>}
        </div>
      </div>
    </section>

    <section className="lab7-card"><span className="eyebrow">LIVE RUN</span><h2>Let the agent ask you first</h2>
      <div className="lab16-prompts">{prompts.map((item) => <button type="button" key={item.label} className={prompt === item.text ? 'selected' : ''} onClick={() => setPrompt(item.text)} disabled={running}>{item.label}</button>)}</div>
      <label htmlFor="lab20-prompt">Your request</label>
      <textarea id="lab20-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} disabled={running} />
      <div className="lab19-choices lab20-choices">
        <fieldset className="lab15-modes lab16-after"><legend>Approval policy</legend>
          <label className={mode === 'ask' ? 'selected' : ''}><input type="radio" name="lab20-mode" checked={mode === 'ask'} onChange={() => setMode('ask')} disabled={running} /><span><strong>Ask me</strong><small>Every change waits for your decision.</small></span></label>
          <label className={mode === 'auto' ? 'selected lab20-unsafe' : 'lab20-unsafe'}><input type="radio" name="lab20-mode" checked={mode === 'auto'} onChange={() => setMode('auto')} disabled={running} /><span><strong>Auto-approve (unsafe)</strong><small>For comparison: changes run with nobody asked.</small></span></label>
        </fieldset>
        <fieldset className="lab15-modes lab16-after"><legend>Approval window</legend>
          <label className={expiry === 'normal' ? 'selected' : ''}><input type="radio" name="lab20-expiry" checked={expiry === 'normal'} onChange={() => setExpiry('normal')} disabled={running} /><span><strong>5 minutes</strong><small>A normal window.</small></span></label>
          <label className={expiry === 'short' ? 'selected' : ''}><input type="radio" name="lab20-expiry" checked={expiry === 'short'} onChange={() => setExpiry('short')} disabled={running} /><span><strong>20 seconds</strong><small>Let it expire, then decide.</small></span></label>
        </fieldset>
      </div>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void runOnce()} disabled={running || !health?.configured || !prompt.trim() || pendingApprovals.length > 0}>{running ? 'Running…' : 'Ask the agent'}</button>{running ? <button type="button" className="lab8-secondary" onClick={() => abort.current?.abort()}>Stop reading</button> : null}</div>
      {!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env and restart the server for a live run. The bench and the test page above work without a key.</p> : null}
      {pendingApprovals.length ? <p className="lab8-note">Decide the waiting change{pendingApprovals.length === 1 ? '' : 's'} below before asking something new.</p> : <p className="lab8-note">The server answers reads automatically and caps each session at {maxRounds} pauses.</p>}
      {status ? <p className="lab7-session-id">{status}</p> : null}
      {live ? <div className="lab16-live"><Timeline moments={live.timeline} />{live.answer ? <div className="lab7-answer lab16-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{live.answer}</ReactMarkdown></div> : null}</div> : null}
      {notice ? <p className="lab20-notice" role="status">{notice}</p> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    {pendingApprovals.length ? <section className="lab7-card lab20-decision-card" aria-live="polite"><span className="eyebrow">DECISION NEEDED · THE TURN IS PAUSED</span><h2>{pendingApprovals.length === 1 ? 'Approve this change?' : `Approve these ${pendingApprovals.length} changes?`}</h2>
      {pendingApprovals.map((approval) => <ApprovalCard key={approval.callId} approval={approval} now={now} busy={running} onDecide={(decision, reason) => void decideLive(approval, decision, reason)} onEdit={() => void editLive(approval)} onTamper={() => void decideLive(approval, 'approve', '', 'f'.repeat(64))} />)}
    </section> : null}

    <div className="lab16-grid">
      <section className="lab7-card"><span className="eyebrow">RESULT</span><h2>{selected ? `Run #${runs.indexOf(selected) + 1}` : 'No run yet'}</h2>
        {selected ? <>
          <p className="lab16-prompt-line">“{selected.prompt}”</p>
          <RunView run={selected} />
          <div className="lab8-actions">{selected.segments[0]?.sessionId ? <button type="button" className="lab8-secondary" onClick={() => void readItems(selected)} disabled={running}>Read the saved items</button> : null}{selected.segments.some((segment) => segment.approvals.some((item) => item.status !== 'pending')) ? <button type="button" className="lab8-secondary" onClick={() => void replayLast()} disabled={running}>Replay the last approval</button> : null}</div>
          {items && items.runId === selected.id ? <div className="lab16-saved"><h3 className="lab13-subhead">Saved items <code>sessions.items.list</code></h3>{items.list.length ? <SavedItems items={items.list} /> : <p className="lab8-note">No items yet.</p>}</div> : null}
        </> : <p className="lab8-note">Ask <em>Move my Lab 19 review to Friday at 17:00.</em> The agent reads the planner, proposes the move, and the turn pauses. Approve it, and the same turn continues to its answer.</p>}
      </section>
      <section className="lab7-card"><span className="eyebrow">RUN HISTORY</span><h2>Compare runs</h2>
        {runs.length ? <div className="lab9-table-wrap lab15-history lab16-history"><table>
          <thead><tr><th>Run</th><th>Request</th><th>Policy</th><th>Steps</th><th>Outcome</th></tr></thead>
          <tbody>{runs.map((run, index) => { const verdict = classifyApprovalRun(run); return <tr key={run.id} className={run.id === selected?.id ? 'selected' : ''} onClick={() => { setSelectedId(run.id); setItems(null); }}>
            <th><button type="button" className="lab15-link" onClick={() => { setSelectedId(run.id); setItems(null); }} aria-pressed={run.id === selected?.id}>#{index + 1}</button></th>
            <td className="lab16-q">{run.prompt}</td><td><code>{run.mode}</code></td><td>{run.segments.length}</td><td><span className={'lab16-tone lab20-tone ' + verdict.tone}>{verdict.title}</span></td></tr>; })}</tbody>
        </table></div> : <p className="lab8-note">No runs yet. Approve one change, reject another with a reason, and run the same request with <em>Auto-approve</em>.</p>}
      </section>
    </div>

    <section className="lab7-card" id="lab20-audit"><span className="eyebrow">AUDIT LOG · ON THE SERVER · NEWEST FIRST</span><h2>Who decided what</h2><p>Append-only: entries are added, never edited. Every proposal, decision, refusal, and outside edit is here, with the actor, the outcome, and a short digest of the arguments.</p>
      <AuditTable entries={audit} />
      <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => void refreshState()}>Refresh</button></div>
    </section>

    <section className="lab3-guide lab16-guide"><h2>Read the evidence</h2><div><article><strong>Classify</strong><p>The policy is code. Reads run; writes wait, whatever the model says.</p></article><article><strong>Preview</strong><p>The diff comes from the stored event. The agent’s reason is labelled as its claim.</p></article><article><strong>Bind &amp; re-check</strong><p>A digest ties the decision to the exact arguments. Expiry and the event version are checked when it runs.</p></article><article><strong>Record</strong><p>An append-only log, and a tool result that tells the agent exactly what happened.</p></article></div><p className="lab3-guide-note">A person’s approval is only as good as what they were shown, and it only counts for that change, at that moment.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 20</span><span className="code-lessons-title" role="heading" aria-level={2}>The code that approves a write action</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Classify each tool, validate before asking, build the preview in code, bind the decision to the exact arguments, re-check at the moment of acting, and record the decision before resuming the turn. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Run the rules suite on the server and show <em>{ruleTests.length}/{ruleTests.length} passed</em>. Live, ask <em>Move my Lab 19 review to Friday at 17:00</em>, approve it, and show the planner at v2 and the audit entry. Ask <em>Cancel the study group</em> and reject it with a reason; show the agent repeating your reason. Then propose a move, press <em>Someone else edits this event</em>, approve, and explain why nothing changed. Finally, press <em>Replay the last approval</em> and explain the 409.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://developers.openai.com/api/docs/guides/agents-api/tools/functions" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
