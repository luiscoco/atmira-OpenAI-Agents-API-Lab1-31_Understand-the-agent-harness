import type { SavedMessage, SavedTurn, Snapshot } from './lab13Recovery.ts';
import type { ControlRecord } from './lab14Controls.ts';

// Scripted teaching cases in the same shape as the live run. The event order follows runs
// observed while building this lab, but the IDs and text are fixtures, not recordings.
export type TimelineEntry =
  | { at: number; kind: 'event'; type: string; turnId: string | null; note: string }
  | { at: number; kind: 'control'; controlId: string; note: string }
  | { at: number; kind: 'text'; chars: number; note: string };

export type ControlScenario = { id: string; title: string; summary: string; timeline: TimelineEntry[]; controls: ControlRecord[]; snapshot: Snapshot; label?: string };

const question = 'Write a detailed 300-word explanation of JavaScript closures with two examples.';
const steerText = 'Change of plan: answer in one sentence instead.';
const essay = 'A closure is created when a function remembers the variables from the scope where it was defined, even after that outer function has returned. Example 1: a counter factory… Example 2: private state in a module…';
const oneLine = 'A closure is a function that keeps access to the variables of the scope it was created in.';
const T1 = 'turn_demo_first';
const T2 = 'turn_demo_second';

const turn = (id: string, status: SavedTurn['status']): SavedTurn => ({ id, status, subagentId: null, error: null });
const user = (id: string, turnId: string, text: string): SavedMessage => ({ id, turnId, role: 'user', phase: null, status: 'completed', text });
const assistant = (id: string, turnId: string, text: string): SavedMessage => ({ id, turnId, role: 'assistant', phase: 'final_answer', status: 'completed', text });
const snapshot = (turns: SavedTurn[], messages: SavedMessage[]): Snapshot => ({ sessionId: 'sess_demo_steer', foundBy: 'id', sessionStatus: 'idle', turns, messages, complete: true });
const control = (fields: Partial<ControlRecord> & Pick<ControlRecord, 'kind' | 'at'>): ControlRecord => ({ id: `ctl_${fields.kind}`, text: null, targetTurnId: T1, statusAtSend: 'in_progress', response: 'accepted', error: null, ...fields });

// The opening every live run shares: the turn is queued, the question is saved, the answer starts.
const opening: TimelineEntry[] = [
  { at: 0, kind: 'event', type: 'agent.session.created', turnId: null, note: 'The session exists; its ID reaches the page.' },
  { at: 4200, kind: 'event', type: 'agent.session.turn.created', turnId: T1, note: 'Root turn created as queued.' },
  { at: 4280, kind: 'event', type: 'agent.session.turn.item.added', turnId: T1, note: 'user message: the question is saved in this turn.' },
  { at: 4800, kind: 'event', type: 'agent.session.turn.in_progress', turnId: T1, note: 'The agent starts working.' },
  { at: 4850, kind: 'event', type: 'agent.session.turn.item.added', turnId: T1, note: 'assistant message: the answer begins.' },
  { at: 6400, kind: 'text', chars: 63, note: 'Text deltas stream in.' },
];

export const controlScenarios: ControlScenario[] = [
  {
    id: 'cancel-mid',
    title: 'Cancel while the answer streams',
    summary: 'The user presses Cancel after the first sentence. The API accepts it and the turn ends as cancelled within milliseconds.',
    timeline: [
      ...opening,
      { at: 6420, kind: 'control', controlId: 'ctl_cancel', note: 'Cancel sent: agent.session.input.cancel → 202 Accepted.' },
      { at: 6440, kind: 'event', type: 'agent.session.turn.output_text.done', turnId: T1, note: 'The part closes with what was generated so far.' },
      { at: 6470, kind: 'event', type: 'agent.session.turn.cancelled', turnId: T1, note: 'Outcome: cancelled.' },
      { at: 6590, kind: 'event', type: 'agent.session.idle', turnId: null, note: 'The session is idle and accepts a new message.' },
    ],
    controls: [control({ kind: 'cancel', at: 6420 })],
    snapshot: snapshot([turn(T1, 'cancelled')], [user('msg_q', T1, question)]),
  },
  {
    id: 'steer-mid',
    title: 'Steer while the answer streams',
    summary: 'The user sends a new instruction while the essay is being written. No new turn is created: the message joins the running turn.',
    timeline: [
      ...opening,
      { at: 6500, kind: 'control', controlId: 'ctl_steer', note: `Steer sent: agent.session.input.message "${steerText}" → 202 Accepted.` },
      { at: 8050, kind: 'text', chars: 1480, note: 'The essay keeps streaming: a steer is not an interrupt.' },
      { at: 8060, kind: 'event', type: 'agent.session.turn.item.done', turnId: T1, note: 'assistant message 1 is finished and published.' },
      { at: 8060, kind: 'event', type: 'agent.session.turn.item.added', turnId: T1, note: 'user message: the steer, saved in the SAME turn.' },
      { at: 9400, kind: 'event', type: 'agent.session.turn.item.added', turnId: T1, note: 'assistant message 2 begins, following the new instruction.' },
      { at: 9520, kind: 'event', type: 'agent.session.turn.item.done', turnId: T1, note: 'assistant message 2 is finished.' },
      { at: 12600, kind: 'event', type: 'agent.session.turn.completed', turnId: T1, note: 'One turn, two answers.' },
    ],
    controls: [control({ kind: 'steer', at: 6500, text: steerText })],
    snapshot: snapshot([turn(T1, 'completed')], [user('msg_q', T1, question), assistant('msg_a1', T1, essay), user('msg_s', T1, steerText), assistant('msg_a2', T1, oneLine)]),
  },
  {
    id: 'cancel-late',
    title: 'Cancel after the turn finished',
    summary: 'A short answer completes before the click reaches the API. The cancel is still accepted, but it changes nothing.',
    timeline: [
      ...opening.slice(0, 5),
      { at: 4900, kind: 'event', type: 'agent.session.turn.item.done', turnId: T1, note: 'The short answer is finished and published.' },
      { at: 6300, kind: 'event', type: 'agent.session.turn.completed', turnId: T1, note: 'Outcome: completed.' },
      { at: 6680, kind: 'control', controlId: 'ctl_cancel', note: 'Cancel sent (the click was already in flight) → 202 Accepted.' },
      { at: 6690, kind: 'event', type: 'agent.session.idle', turnId: null, note: 'No cancelled event follows.' },
    ],
    controls: [control({ kind: 'cancel', at: 6680, statusAtSend: 'in_progress' })],
    snapshot: snapshot([turn(T1, 'completed')], [user('msg_q', T1, 'Say hi in three words.'), assistant('msg_a', T1, 'Hi there, friend.')]),
  },
  {
    id: 'steer-late',
    title: 'Steer after the turn finished',
    summary: 'The steer leaves the page just as the turn completes. With no active turn to join, the message starts a turn of its own.',
    timeline: [
      ...opening,
      { at: 9200, kind: 'event', type: 'agent.session.turn.completed', turnId: T1, note: 'The essay is complete.' },
      { at: 9230, kind: 'control', controlId: 'ctl_steer', note: 'Steer sent → 202 Accepted.' },
      { at: 9600, kind: 'event', type: 'agent.session.turn.created', turnId: T2, note: 'A NEW root turn is created for the message.' },
      { at: 9650, kind: 'event', type: 'agent.session.turn.item.added', turnId: T2, note: 'user message: saved in the new turn.' },
      { at: 11800, kind: 'event', type: 'agent.session.turn.completed', turnId: T2, note: 'The follow-up is answered separately.' },
    ],
    controls: [control({ kind: 'steer', at: 9230, text: steerText })],
    snapshot: snapshot([turn(T1, 'completed'), turn(T2, 'completed')], [user('msg_q', T1, question), assistant('msg_a1', T1, essay), user('msg_s', T2, steerText), assistant('msg_a2', T2, oneLine)]),
  },
  {
    id: 'not-steerable',
    title: 'The turn cannot be steered',
    summary: 'Some running work cannot take extra input. The API documents the error code active_turn_not_steerable for this case.',
    label: 'Scripted from the documented error code. This lab did not trigger it with environment type none.',
    timeline: [
      ...opening,
      { at: 6500, kind: 'control', controlId: 'ctl_steer', note: 'Steer sent → rejected: active_turn_not_steerable.' },
      { at: 9300, kind: 'event', type: 'agent.session.turn.completed', turnId: T1, note: 'The turn finishes its original task.' },
    ],
    controls: [control({ kind: 'steer', at: 6500, text: steerText, response: 'rejected', error: { status: null, code: 'active_turn_not_steerable', message: 'The session cannot accept additional input while a request is running.' } })],
    snapshot: snapshot([turn(T1, 'completed')], [user('msg_q', T1, question), assistant('msg_a1', T1, essay)]),
  },
  {
    id: 'stop-reading',
    title: 'Stop reading is not a cancel',
    summary: 'The user closes the stream to "stop" the answer. The browser goes quiet, but nothing was sent to the API.',
    timeline: [
      ...opening,
      { at: 6500, kind: 'control', controlId: 'ctl_stop_reading', note: 'The browser aborts its fetch. No request reaches the API.' },
      { at: 9200, kind: 'event', type: 'agent.session.turn.completed', turnId: T1, note: 'Seen only when the session is read later: the turn completed.' },
    ],
    controls: [control({ kind: 'stop_reading', at: 6500, response: 'local' })],
    snapshot: snapshot([turn(T1, 'completed')], [user('msg_q', T1, question), assistant('msg_a1', T1, essay)]),
  },
];
