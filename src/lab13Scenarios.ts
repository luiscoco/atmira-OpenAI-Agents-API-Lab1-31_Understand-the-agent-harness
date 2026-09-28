import type { PendingSend, SavedMessage, SavedTurn, Snapshot } from './lab13Recovery.ts';

// Scripted teaching cases in the same shape as the live flow: a pending record from
// browser storage and a snapshot read from the API. They are not recordings of real runs.
export type RecoveryScenario = { id: string; title: string; summary: string; pending: PendingSend; snapshot: Snapshot };

const question = 'Explain what a JavaScript Promise is in three sentences.';
const followUp = 'Now show one short example with async and await.';
const answer = 'A Promise represents a value that will be available later. It starts pending, then settles as fulfilled with a value or rejected with an error. You react to it with then and catch, or with await inside an async function.';
const firstAnswer = 'A Promise is an object for a result that is not ready yet. It is pending until it is fulfilled or rejected. Use then, catch, or await to handle the outcome.';

const pending = (fields: Partial<PendingSend> = {}): PendingSend => ({ requestId: 'req_7f3c2a91d4', sessionId: 'sess_demo_recover', prompt: question, afterTurnId: null, sentAt: Date.UTC(2026, 0, 1), partial: '', ...fields });
const turn = (id: string, status: SavedTurn['status'], error: string | null = null): SavedTurn => ({ id, status, subagentId: null, error });
const user = (id: string, turnId: string, text: string): SavedMessage => ({ id, turnId, role: 'user', phase: null, status: 'completed', text });
const assistant = (id: string, turnId: string, text: string, status = 'completed'): SavedMessage => ({ id, turnId, role: 'assistant', phase: 'final_answer', status, text });
const snapshot = (fields: Partial<Snapshot>): Snapshot => ({ sessionId: 'sess_demo_recover', foundBy: 'id', sessionStatus: 'idle', turns: [], messages: [], complete: true, ...fields });

export const recoveryScenarios: RecoveryScenario[] = [
  {
    id: 'before-session',
    title: 'Disconnected before the session existed',
    summary: 'The network dropped while the create request was in flight. The browser never received a session ID, and no session carries the request ID.',
    pending: pending({ sessionId: null }),
    snapshot: snapshot({ sessionId: null, foundBy: null, sessionStatus: null }),
  },
  {
    id: 'mid-answer',
    title: 'Stream dropped mid-answer, turn still running',
    summary: 'The answer had started to stream when the connection closed. The agent kept working on the server.',
    pending: pending({ partial: 'A Promise represents a value that will be avail' }),
    snapshot: snapshot({ sessionStatus: 'in_progress', turns: [turn('turn_one', 'in_progress')], messages: [user('msg_q1', 'turn_one', question)] }),
  },
  {
    id: 'refresh-complete',
    title: 'Page refreshed, the turn completed meanwhile',
    summary: 'The page was reloaded mid-answer. The session ID was not in the browser yet, so the server finds the session by the request ID in its metadata.',
    pending: pending({ sessionId: null, partial: 'A Promise represents a value that will be available later. It starts pend' }),
    snapshot: snapshot({ foundBy: 'metadata', turns: [turn('turn_one', 'completed')], messages: [user('msg_q1', 'turn_one', question), assistant('msg_a1', 'turn_one', answer)] }),
  },
  {
    id: 'input-lost',
    title: 'Follow-up input never arrived',
    summary: 'The follow-up was sent to an existing session, but the request failed before the API accepted it. The session is idle with only the first turn.',
    pending: pending({ prompt: followUp, afterTurnId: 'turn_one' }),
    snapshot: snapshot({ turns: [turn('turn_one', 'completed')], messages: [user('msg_q1', 'turn_one', question), assistant('msg_a1', 'turn_one', firstAnswer)] }),
  },
  {
    id: 'failed',
    title: 'The turn failed after the disconnect',
    summary: 'The request arrived and the turn ran, but it failed while the page was disconnected.',
    pending: pending({ prompt: followUp, afterTurnId: 'turn_one', partial: 'Here is a short' }),
    snapshot: snapshot({ turns: [turn('turn_one', 'completed'), turn('turn_two', 'failed', 'The model request timed out.')], messages: [user('msg_q1', 'turn_one', question), assistant('msg_a1', 'turn_one', firstAnswer), user('msg_q2', 'turn_two', followUp)] }),
  },
  {
    id: 'duplicated',
    title: 'A blind retry already ran',
    summary: 'An earlier version of the app resent the question automatically after a disconnect. The session now holds the same question in two turns.',
    pending: pending(),
    snapshot: snapshot({ turns: [turn('turn_one', 'completed'), turn('turn_retry', 'completed')], messages: [user('msg_q1', 'turn_one', question), assistant('msg_a1', 'turn_one', answer), user('msg_q1b', 'turn_retry', question), assistant('msg_a1b', 'turn_retry', firstAnswer)] }),
  },
];
