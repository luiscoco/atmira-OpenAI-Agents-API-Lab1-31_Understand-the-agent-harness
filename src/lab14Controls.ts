// Lab 14: tell a cancel from a steer by reading the saved turn, never by trusting "202 Accepted".
// Pure functions only, so the live run and the offline playground share them.
import { activeStatuses, shortId, type SavedMessage, type Snapshot, type TurnStatus } from './lab13Recovery.ts';

export type ControlKind = 'cancel' | 'steer' | 'stop_reading';

// One control the user pressed while a turn was (or seemed to be) running.
export type ControlRecord = {
  id: string; // browser-generated; a steer also sends it as the Idempotency-Key
  kind: ControlKind;
  at: number; // milliseconds since the run started
  text: string | null; // the steering message, if any
  targetTurnId: string | null; // the root turn the page believed was active when the control was sent
  statusAtSend: TurnStatus | null; // that turn's status as last seen on the stream
  response: 'accepted' | 'rejected' | 'local'; // local: stop_reading never reaches the API
  error: { status: number | null; code: string | null; message: string } | null;
};

export type Verdict =
  | 'cancelled' // the turn stopped; unpublished output was abandoned
  | 'too_late' // the turn had already finished; the cancel changed nothing
  | 'nothing_to_cancel' // no active turn was known when the cancel was sent
  | 'cancel_pending' // accepted, but the turn has not reached an outcome yet
  | 'steered' // the message joined the active turn; no new turn
  | 'new_turn' // the message started its own turn: a follow-up, not a steer
  | 'steer_pending' // accepted, not yet visible in saved items
  | 'not_saved' // the turn ended and the message is nowhere in the session
  | 'rejected' // the API refused the control
  | 'still_running' // stop reading: the turn kept going without a watcher
  | 'kept_running'; // stop reading: the turn finished on its own

export type ControlOutcome = { verdict: Verdict; headline: string; explanation: string; evidence: string[] };

export const verdictLabels: Record<Verdict, string> = {
  cancelled: 'Cancelled', too_late: 'Too late', nothing_to_cancel: 'Nothing to cancel', cancel_pending: 'Cancel pending',
  steered: 'Steered', new_turn: 'New turn', steer_pending: 'Steer pending', not_saved: 'Not saved', rejected: 'Rejected',
  still_running: 'Still running', kept_running: 'Kept running',
};
// Used for colour: did the control do what the user wanted, is it unknown, or did it miss?
export const verdictTone: Record<Verdict, 'done' | 'pending' | 'missed'> = {
  cancelled: 'done', steered: 'done', too_late: 'missed', nothing_to_cancel: 'missed', new_turn: 'missed', not_saved: 'missed', rejected: 'missed',
  cancel_pending: 'pending', steer_pending: 'pending', still_running: 'pending', kept_running: 'missed',
};

const rootTurns = (snapshot: Snapshot) => snapshot.turns.filter((turn) => !turn.subagentId);
const quote = (text: string) => `"${text.length > 60 ? `${text.slice(0, 60)}…` : text}"`;

// Saved root-agent messages of one turn, in order. Commentary is left out.
export function turnMessages(snapshot: Snapshot, turnId: string): SavedMessage[] {
  return snapshot.messages.filter((message) => message.turnId === turnId && message.phase !== 'commentary');
}

export function classifyControl(control: ControlRecord, snapshot: Snapshot): ControlOutcome {
  const evidence: string[] = [];
  const result = (verdict: Verdict, headline: string, explanation: string): ControlOutcome => ({ verdict, headline, explanation, evidence });
  const sent = control.kind === 'stop_reading' ? 'Stopped reading' : `Sent ${control.kind}`;
  evidence.push(`${sent} at ${(control.at / 1000).toFixed(1)} s, while turn ${control.targetTurnId ? shortId(control.targetTurnId) : '(none)'} was ${control.statusAtSend ?? 'not known'}.`);

  // 1. The HTTP answer only says whether the API took the request.
  if (control.response === 'rejected') {
    const error = control.error;
    evidence.push(`The API rejected it${error?.status ? ` with HTTP ${error.status}` : ''}${error?.code ? ` (${error.code})` : ''}: ${(error?.message ?? 'no message').replace(/\.$/, '')}.`);
    if (error?.code === 'active_turn_not_steerable') {
      return result('rejected', 'This turn cannot be steered', 'The session refused extra input while this request runs. Nothing was saved. Wait for the turn to finish and send a follow-up, or cancel it first.');
    }
    return result('rejected', `The ${control.kind} was refused`, 'Nothing reached the session, so nothing changed. Read the error before trying again.');
  }
  if (control.response === 'accepted') evidence.push('The API answered 202 Accepted. That confirms receipt, not the effect.');

  const turn = control.targetTurnId ? rootTurns(snapshot).find((candidate) => candidate.id === control.targetTurnId) : undefined;
  if (control.targetTurnId && !turn) evidence.push(`Turn ${shortId(control.targetTurnId)} was not in the saved turns that were read.`);
  if (turn) evidence.push(`The saved turn is now ${turn.status}.`);

  // 2. Stop reading is a browser action. The API never hears about it.
  if (control.kind === 'stop_reading') {
    evidence.push('Nothing was sent to the API: the browser only closed its own stream.');
    if (turn && activeStatuses.includes(turn.status)) return result('still_running', 'The agent is still working', 'Closing the stream stopped the page, not the agent. The turn keeps running and will be billed. Reattach to watch it, or cancel it if you want it to stop.');
    const answer = turn ? turnMessages(snapshot, turn.id).filter((message) => message.role === 'assistant') : [];
    if (turn?.status === 'completed') evidence.push(`${answer.length} assistant message${answer.length === 1 ? '' : 's'} saved without anyone watching.`);
    return result('kept_running', `The turn ${turn?.status ?? 'ended'} without you`, 'The agent finished its work after the page stopped reading. Stopping the stream is not a cancel: the full answer was produced and saved.');
  }

  // 3. Cancel: the turn status is the only proof.
  if (control.kind === 'cancel') {
    if (!control.targetTurnId) return result('nothing_to_cancel', 'There was nothing to cancel', 'No turn was active when the cancel was sent. The API still answers 202, but a cancel only affects an active turn.');
    if (!turn) return result('cancel_pending', 'The outcome is not known yet', 'Read the session again: the turn list did not include the target turn.');
    if (turn.status === 'cancelled') {
      const saved = turnMessages(snapshot, turn.id).filter((message) => message.role === 'assistant').length;
      evidence.push(saved ? `${saved} assistant message${saved === 1 ? ' was' : 's were'} published before the cancel and kept.` : 'No assistant message was saved: the text that streamed was never published, so it was abandoned.');
      return result('cancelled', 'The cancel stopped the turn', 'The turn ended as cancelled. The session is still usable: earlier turns and published output remain, and the next message starts a new turn.');
    }
    if (turn.status === 'completed' || turn.status === 'failed') {
      return result('too_late', `The turn had already ${turn.status}`, `The cancel arrived after the turn ${turn.status}, so it had no effect. An accepted cancel is not a cancelled turn; the turn status says what happened.`);
    }
    return result('cancel_pending', 'Cancel accepted, turn still active', 'The turn has not reached an outcome yet. Keep following the stream or read the session again.');
  }

  // 4. Steer: find where the message was saved.
  const text = (control.text ?? '').trim();
  const holders = [...new Set(snapshot.messages.filter((message) => message.role === 'user' && message.text.trim() === text).map((message) => message.turnId))];
  if (control.targetTurnId && holders.includes(control.targetTurnId)) {
    const messages = turnMessages(snapshot, control.targetTurnId);
    const position = messages.findIndex((message) => message.role === 'user' && message.text.trim() === text);
    const after = messages.slice(position + 1).filter((message) => message.role === 'assistant').length;
    evidence.push(`The message ${quote(text)} is saved inside turn ${shortId(control.targetTurnId)}, as message ${position + 1} of ${messages.length}.`);
    evidence.push(after ? `${after} assistant message${after === 1 ? '' : 's'} came after it in the same turn.` : 'No assistant message follows it yet.');
    if (holders.length > 1) evidence.push(`It is also saved in ${holders.length - 1} other turn${holders.length > 2 ? 's' : ''}: it was sent more than once.`);
    return result('steered', 'The message steered the running turn', 'It joined the active turn instead of starting a new one. The agent finished the output it was writing, then read the message and continued in the same turn.');
  }
  if (holders.length) {
    evidence.push(`The message is saved in turn ${shortId(holders[0])}, not in the target turn.`);
    return result('new_turn', 'It became a new turn', 'The target turn had already ended, so the message arrived as an ordinary follow-up. The earlier answer was not redirected; the agent answered the message on its own.');
  }
  if (turn && activeStatuses.includes(turn.status)) {
    evidence.push('No saved user message matches yet.');
    return result('steer_pending', 'Accepted, not visible yet', 'Steering input is read at the next step boundary, so it can appear a moment later. Read the session again.');
  }
  evidence.push('No saved user message in any turn matches this text.');
  return result('not_saved', 'The message is not in the session', 'The turn ended and the message was never saved. Send it again with the same ID as its Idempotency-Key, so a late duplicate is ignored.');
}

// The visible state of the run, derived from the root turn status and the controls sent.
export type RunState = 'idle' | 'running' | 'cancelling' | 'steering' | 'completed' | 'cancelled' | 'failed' | 'detached';
export function runState(status: TurnStatus | null, controls: ControlRecord[], reading: boolean): RunState {
  if (status === 'completed' || status === 'cancelled' || status === 'failed') return status;
  if (!status) return 'idle';
  const last = controls.filter((control) => control.response !== 'rejected').at(-1);
  if (!reading) return 'detached';
  if (last?.kind === 'cancel') return 'cancelling';
  if (last?.kind === 'steer') return 'steering';
  return 'running';
}
