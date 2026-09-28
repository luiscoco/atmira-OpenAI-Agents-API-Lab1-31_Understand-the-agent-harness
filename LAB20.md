# Lab 20 — Approve a write action

Lab 19's tool only read. In Lab 20 the agent can **change** something: the student's study planner. Reading still runs at once. Moving or cancelling an event **pauses the turn** until a person decides. The server:

- shows a preview it computed itself,
- binds the decision to those exact arguments,
- re-checks the change at the moment it acts (expiry and event version),
- records who decided what in an append-only audit log,
- and turns the decision into a tool result the agent can act on.

The same turn then resumes. An offline approval bench and a 16-scenario rules test page need no API key.

## Learning goals

1. Classify every tool as **read** or **write** in code. Reads run; writes wait, whatever the model says.
2. **Validate before asking.** An impossible or forbidden change goes back to the agent, and the person is never interrupted.
3. Show a **preview built by code** from the stored data (before → after, clashes), and label the agent's reason as its claim.
4. **Bind** the decision to the exact change: a SHA-256 digest of the stored arguments, one decision per approval, and the server runs its own stored arguments.
5. **Re-check at the moment of acting**: the approval window (expiry) and the event version (optimistic concurrency).
6. **Record** every step in an append-only audit log, and tell the agent exactly what happened: done, rejected (with the reason), expired, or changed underneath.
7. Keep the turn paused while the person decides, then resume it: hold ready results, open the stream, send every result in one `events.create`, and follow the turn to its answer.

## Run the lab

Run `npm ci`, put `OPENAI_API_KEY` in a private `.env` file, and start the app with `npm run dev`. Open **Approve a write action** in the sidebar (`#lab20`), under **Function tools & human control**.

**The rule.** The three tools with their policy, and a seven-step flow: Classify → Validate → Preview → Decide → Re-check → Apply → Record. Selecting a test, a bench proposal, or a live run shows where the call went.

**The study planner (on the server).** Five events relative to today: a Lab 19 review, a Lab 20 work session, a live Q&A (staff), a study group, and a project deadline (staff). Each row shows its version. **Reset planner and audit log** starts over. State lives in server memory.

**Approval bench (no API key).** Play the agent by choosing a call: read the planner, move the review, move it onto the study group (clash warning), cancel the study group (high risk), move the staff Q&A, or move to 30 February. Then play the student in the approval card, with **Approve this change**, **Reject** with a reason, or **Test the guards** (*Someone else edits this event*, *Send a tampered approval*). **Send the same approval again** shows the "decide once" rule. The bench uses the server's `propose`/`decide` functions on a separate planner in the browser.

**Rules test page (no API key).** 16 scenarios, each on a fresh engine, in the browser or on the server (`POST /api/lab20/test`):

| Group | Scenarios | Expected |
| --- | --- | --- |
| When the agent proposes | a read, a valid move, a clash, an impossible date, a staff event, outside study hours, auto policy | `ran`, `asked`, `asked` (with warning), `invalid` ×3, `auto` |
| When the student decides | approve, reject with a reason, approve a cancellation, two changes in one pause | `executed`, `rejected`, `executed`, `sent 2 together` |
| Guards at decision time | approve twice, approve too late, approve after someone else edits, approve a different change, approve from another session | `already_decided`, `expired`, `stale`, `tampered`, `unknown` |

**Live run.** Pick a request and choose:

| Option | Effect |
| --- | --- |
| **Ask me** (default) | Every change waits for your decision. |
| **Auto-approve (unsafe)** | For comparison: changes run by policy, with nobody asked. The verdict says *Changed without asking*. |
| **5 minutes / 20 seconds** | The approval window. With 20 seconds, wait for the countdown, then approve: the server refuses and tells the agent. |

When the agent proposes a change, the stream ends and a **Decision needed** card appears. It shows risk, the countdown, the before → after diff, clash warnings, the agent's reason (labelled as unverified), the event version, and the digest. A cancellation also needs a confirmation checkbox. Your decision starts a new request that resumes the same turn. The result shows each request as a segment (your question, then each decision) with its timeline and answer. **Replay the last approval** re-sends a decided approval and gets HTTP 409. **Read the saved items** shows the calls and their outputs. The **audit log** lists every proposal, decision, refusal, and outside edit.

Open **View code** for six snippets and explanations. **Viva voice · Read aloud** reads one explanation aloud, and **Viva voice · Read all six** reads them all in order. Both use browser speech synthesis and do not call an audio API.

## How it was built — step by step

### 1. Three tools and a policy in code

```ts
// src/lab20Approval.ts
export const plannerTools = [listTool, rescheduleTool, cancelTool];
export const toolPolicy = {
  list_study_events:      { access: 'read',  risk: 'none',   label: 'Read the planner' },
  reschedule_study_event: { access: 'write', risk: 'medium', label: 'Move an event' },
  cancel_study_event:     { access: 'write', risk: 'high',   label: 'Cancel an event' },
};
```

**Why:** The write tools' descriptions tell the model that changes wait for approval, which helps it phrase things well. But the **policy** is code. The model cannot argue a write into a read. Each write requires a `reason` that the student sees. Staff events are `movable: false`.

### 2. Validate before anyone is asked

```ts
// src/lab20Approval.ts
export function checkCall(call, planner, today): Checked {
  const shape = checkSchema(parsed.value, tool.parameters);                  // Lab 18
  if (!event) meaning('/event_id', 'missing', `… Call ${listTool.name} for the IDs.`);
  else if (event.status === 'cancelled') meaning('/event_id', 'cancelled', …);
  else if (!event.movable) meaning('/event_id', 'locked', `"${event.title}" belongs to the course staff …`);
  if (!isRealDate(date)) meaning('/new_date', 'date', …);
  else if (date < today) meaning('/new_date', 'past', …);
  else if (date > addDays(today, horizonDays)) meaning('/new_date', 'horizon', …);
  else if (outsideStudyHours) meaning('/new_start', 'hours', …);
  else if (unchanged) meaning('/new_date', 'same', 'Nothing would change.');
}
```

**Why:** Approval is for **decisions**, not for catching bugs. An invalid change returns `success: false` with every reason. The audit records `invalid · not run, not asked`, and the student is never interrupted.

### 3. A preview computed by code

```ts
// src/lab20Approval.ts
export function buildPreview(checked, planner): Preview {
  const event = checked.event;                                          // the stored event, not the model's description
  const moved = { ...event, date: String(args.new_date), start: String(args.new_start) };
  const clashes = planner.events.filter((item) => item.id !== event.id && item.status === 'scheduled' && overlaps(moved, item));
  return {
    summary: `Move “${event.title}” from ${describeWhen(event)} to ${describeWhen(moved)}.`,
    changes: [{ field: 'date', before, after }, { field: 'start', before, after }],
    warnings: clashes.map((item) => `Overlaps “${item.title}” (${item.start}, ${item.durationMin} min) on ${item.date}.`),
    agentReason: String(args.reason),                                    // shown, labelled as unverified
    version: event.version,                                              // what the person is looking at
  };
}
```

**Why:** The person must see what will **really** happen. The model could describe a change wrongly, or persuasively. So the summary and the diff come from the stored event, and the agent's reason is shown separately as *its words, not verified*. A clash is a **warning**, not a refusal: it is the student's planner, so the student decides.

### 4. Propose: run reads, refuse invalid writes, hold valid ones

```ts
// src/lab20Approval.ts
export async function propose(engine, call, ctx): Promise<Proposal> {
  const checked = checkCall(call, engine.planner, ctx.today);
  if (!checked.ok) return { kind: 'invalid', result: no(call, …, describeIssues(call.name, checked.issues)), … };
  if (toolPolicy[call.name].access === 'read') return { kind: 'ran', result: ok(call, …, listEvents(…)), … };
  const preview = buildPreview(checked, engine.planner);
  const digest = await digestOf(call.name, call.callId, checked.args);
  if (ctx.mode === 'auto') { /* comparison only: execute now, audit 'auto-approved' by 'policy' */ }
  const approval = { callId, sessionId, turnId, name, args: checked.args, digest, preview, createdAt: ctx.now, expiresAt: ctx.now + ctx.expiryMs, status: 'pending', … };
  engine.approvals.set(call.callId, approval);
  record(engine, { decision: 'asked', actor: 'agent', outcome: `waiting for the student · risk ${preview.risk}`, … });
  return { kind: 'asked', approval, … };
}
```

**Why:** A single `Engine` holds the planner, the approvals, and the audit log. The server, the browser bench, and the test page all use it, so the rules are tested exactly as they run.

### 5. Bind the decision, and decide once

```ts
// src/lab20Approval.ts
export async function digestOf(name: string, callId: string, args: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ name, callId, args: canonical(args) }));   // sorted keys
  const hash = await crypto.subtle.digest('SHA-256', bytes);                                          // browser and Node
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function decide(engine, input, now): Promise<Decided> {
  const approval = engine.approvals.get(input.callId);
  if (!approval || approval.sessionId !== input.sessionId) return { kind: 'unknown', … };
  if (approval.status !== 'pending') return { kind: 'already_decided', … };     // double click, retry, replay
  if (input.digest !== approval.digest) return { kind: 'tampered', … };         // stays pending
  …
  const applied = execute(engine, approval);                                     // the stored arguments
}
```

**Why:** An approval means yes to **this** change and nothing else. The browser sends back the digest of what it displayed. If the digest doesn't match, nothing runs, the refusal is audited, and the approval stays pending for the real decision. The server never takes arguments from the decision request. Each approval is decided once, so a double click or a replay cannot run the change twice. The server answers with HTTP 409 in both cases.

### 6. Re-check at the moment of acting

```ts
// src/lab20Approval.ts, decide()
if (now > approval.expiresAt) { approval.status = 'expired'; /* audit, tell the agent: not changed, do not retry on your own */ }

export function applyChange(planner, name, args, expectedVersion): Applied {
  const before = planner.events.find((item) => item.id === args.event_id) ?? null;
  if (!before) return { kind: 'missing', current: null };
  if (before.version !== expectedVersion || before.status !== 'scheduled') return { kind: 'stale', current: before };
  const after = name === cancelTool.name ? { ...before, status: 'cancelled', version: before.version + 1 }
                                         : { ...before, date: String(args.new_date), start: String(args.new_start), version: before.version + 1 };
  return { kind: 'applied', planner: …, before, after };
}
```

**Why:** Time passes between the preview and the click. Approvals are valid for 5 minutes (20 seconds in the demo). Something may also change in between: **Someone else edits this event** moves it 30 minutes and bumps its version. The change runs only if the event still has the version the student approved. This is **optimistic concurrency**, so a stale approval changes nothing. The agent is told the event's current time and asked to offer to propose again. A cancellation marks the event `cancelled` rather than deleting it.

### 7. Record everything, append-only

```ts
// src/lab20Approval.ts
export type AuditEntry = { id; at; sessionId; callId; tool; eventId; summary; decision; actor; outcome; reason; digest };
// decision: ran | invalid | asked | approved | rejected | expired | auto-approved | refused | edited
// actor:    agent | student | policy | server | someone else
export function record(engine, entry) { const saved = { ...entry, id: engine.nextAudit++ }; engine.audit.push(saved); return saved; }
```

**Why:** Every step is recorded: proposals, decisions with the student's reason, refusals (digest mismatch, already decided), outside edits, and what actually happened (`executed · v1 → v2`, `not run · stale (v1 → v2)`). Entries are only ever added. In production this belongs in a database with the user's identity, and the log should be kept for a set time.

### 8. Pause the turn, then resume it

```ts
// server/lab20.ts, handlePause() — inside follow(), on agent.session.requires_action
for (const call of waiting) {
  const proposal = await propose(engine, call, { sessionId, turnId, mode: config.mode, now: Date.now(), expiryMs: config.expiryMs, today: todayIso() });
  if (proposal.kind === 'asked') { batch.waitingFor.add(call.callId); writeEvent(response, { type: 'approval', approval: proposal.approval }); }
  else batch.results.push(proposal.result);
}
if (batch.waitingFor.size) { batches.set(sessionId, batch); return true; }   // end the stream; the turn stays in requires_action
```

```ts
// server/lab20.ts, decideLab20() — POST /api/lab20/decide
const decided = await decide(engine, { sessionId, callId, digest, decision, reason }, Date.now());
if (decided.kind === 'unknown' || decided.kind === 'already_decided' || decided.kind === 'tampered') return sendJson(response, …, { error: decided.message, kind: decided.kind });
const ready = settle(batch, done.result);                                   // null while other calls in the pause still wait
if (!ready) return;
const stream = await api.beta.agents.sessions.events.stream(sessionId);     // open first…
await api.beta.agents.sessions.events.create(sessionId, { events: ready.map(toolResultEvent) });   // …then send
await follow(api, response, trace, stream);
```

**Why:** The Agents API keeps the turn in `requires_action` until **every** call in the pause has a result. So the server holds the ready results (reads, refusals, earlier decisions) in a batch, and `settle()` releases them only when the last decision arrives. They are sent together, with the stream already open, exactly as in Lab 17's step-through. Each session remembers the call IDs it has already answered, because a resumed stream replays the turn's earlier events. The `sessions` map also stores the policy and the approval window chosen at the start, and Lab 17's four-pause cap. An unknown session fails safe to *ask*.

### 9. Tool results written for the agent

| Outcome | `success` | What the agent is told |
| --- | --- | --- |
| executed | `true` | `{"status":"done","approved_by":"student","audit_id":…,"event":{…},"previous":{…}}` |
| rejected | `false` | The student rejected it *(and said "…")*. Nothing changed. Do not propose it again; ask what they prefer. |
| expired | `false` | No decision within the window, so it expired. Do not retry on your own; they can ask again. |
| stale | `false` | Approved, but the event changed (it is now …), so nothing changed. Offer to propose again. |
| invalid | `false` | Not proposed to the student, because of these reasons… |

The instructions add: "Never say a change was made unless its tool result says `"status": "done"`."

## What a live run showed

These runs used `gpt-5.6-terra` on 28 September 2026 while the lab was being built. Run them again before recording, because model behaviour can change.

- **"Move my Lab 19 review to Friday at 17:00."** The agent read the planner, then proposed `reschedule_study_event(evt_review_19, 2026-10-02, 17:00)`, and the turn paused. The preview showed *Tuesday 2026-09-29 18:00 → Friday 2026-10-02 17:00*. A tampered digest got HTTP 409 and the approval stayed pending. After approval, the event went to v2 and the same turn answered "Moved 'Review Lab 19 notes' to Friday, 2026-10-02 at 17:00." Replaying the approval got HTTP 409 *already approved*.
- **"Cancel the study group, I feel ill."** A high-risk card appeared. Rejected with "Actually I feel better, keep it.", the agent answered "The study group was not cancelled—you chose to keep it. What would you prefer instead?"
- **Stale:** the agent proposed moving the Lab 20 session to 15:00, and *Someone else edits this event* moved it to 10:30 (v2). The approval was refused as stale, and the agent said "…it's now scheduled for Sep 30 at 10:30. Would you like me to propose moving it to 15:00 again?"
- **"Move the live Q&A to tomorrow at 10:00."** Refused before asking (a staff event). The agent explained it can't be moved.
- **"Push the Lab 20 session and the study group back by one day each."** The model proposed the two changes in **two consecutive pauses**, following "one change per call". Both were approved and applied. Several approvals in one pause is covered by the *Two changes in one pause* test.
- One run failed with the API's *An internal error occurred.* The page showed it as *Failed*, and the same request worked on retry.

## Rules the page follows

```text
read tool                                   → runs at once, audited as ran
write, invalid (schema, meaning, staff)     → not asked; success: false with reasons; audited as invalid
write, valid, policy "ask"                  → preview + digest + expiry; turn waits; audited as asked
write, valid, policy "auto" (comparison)    → runs now; audited as auto-approved by policy
decision for another session / unknown call → 404, nothing runs
decision already made                       → 409, nothing runs twice, audited as refused
digest does not match                       → 409, nothing runs, still pending, audited as refused
decision after expiresAt                    → expired, nothing runs, agent told
approve, event version changed              → stale, nothing runs, agent told the current state
approve, version matches                    → stored arguments applied, version + 1, agent told "done"
reject                                      → nothing runs; the student's reason reaches the agent
every call in a pause                       → one tool_result each, sent together once all are decided
more than 4 pauses in one session           → cancel the turn
```

## Code map

| File | Role |
| --- | --- |
| `src/lab20Approval.ts` | The planner (`seedPlanner`), the three tools and `toolPolicy`, `checkCall`, `buildPreview`, `digestOf`, `applyChange`, `editElsewhere`, the `Engine` with `propose`, `decide`, `record`, `settle`, and `simulateEdit`, plus `classifyApprovalRun` and the runtime boundaries. |
| `src/lab20Tests.ts` | The 16 scenarios, `runRuleTest`, and `runRuleSuite`. |
| `server/lab20.ts` | Server state (engine, per-session policy and answered calls, batches), `runLab20` (pause on writes), `decideLab20` (check, record, settle, resume), `stateLab20`, `editLab20`, `resetLab20`, and `testLab20`. |
| `server/index.ts` | Routes `POST /api/lab20/run`, `POST /api/lab20/decide`, `GET /api/lab20/state`, `POST /api/lab20/edit`, `POST /api/lab20/reset`, `POST /api/lab20/test`, and `GET /api/lab20/items` (Lab 17's item reader). |
| `src/Lab20.tsx` | The rule and flow, planner, approval bench, test page, live run, decision card, result, run history, audit log, code snippets, and Viva voice. |
| `src/App.tsx`, `src/styles.css`, `tsconfig.lab6.json` | The sidebar entry, Lab 20 styles, and strict type checking for the new modules. |

## Student challenge

1. Run the rules suite on the server and show **16/16 passed**.
2. Live, ask *Move my Lab 19 review to Friday at 17:00*, approve it, and show the planner row at **v2** and its audit entries (*asked*, then *approved · executed*).
3. Ask *Cancel the study group, I feel ill.* and reject it with a reason. Show the agent repeating your reason, and the planner unchanged.
4. Propose a move, press **Someone else edits this event**, approve, and explain why nothing changed.
5. Press **Replay the last approval** and explain the 409. Then run the first request with **Auto-approve** and explain what the student lost.

See [OpenAI Docs: Function tools](https://developers.openai.com/api/docs/guides/agents-api/tools/functions).
