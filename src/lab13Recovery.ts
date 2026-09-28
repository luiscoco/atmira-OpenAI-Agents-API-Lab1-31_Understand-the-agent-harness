// Lab 13: decide what to do after a disconnect by reading saved state, never by guessing.
// Pure functions only, so the live flow and the offline playground share them.

export type TurnStatus = 'queued' | 'in_progress' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type SessionStatus = 'idle' | 'in_progress' | 'requires_action' | 'failed';

// Written to browser storage before the request leaves, and cleared once its outcome is known.
export type PendingSend = {
  requestId: string; // browser-generated; also the Idempotency-Key and the session metadata tag
  sessionId: string | null; // null until the server reports the new session's ID
  prompt: string;
  afterTurnId: string | null; // the last root turn the browser knew before this send
  sentAt: number;
  partial: string; // text streamed before the disconnect; shown, never trusted as final
};

export type SavedTurn = { id: string; status: TurnStatus; subagentId: string | null; error: string | null };
export type SavedMessage = { id: string | null; turnId: string; role: 'user' | 'assistant'; phase: 'commentary' | 'final_answer' | null; status: string; text: string };

// What the server read back from the API. sessionStatus is null when no session was found.
export type Snapshot = {
  sessionId: string | null;
  foundBy: 'id' | 'metadata' | null;
  sessionStatus: SessionStatus | null;
  turns: SavedTurn[]; // oldest first
  messages: SavedMessage[]; // root agent messages, oldest first
  complete: boolean; // false when more turns or items existed than the server read
};

export type Action = 'resend' | 'reattach' | 'show_saved' | 'offer_retry' | 'wait' | 'review';

export type Decision = {
  action: Action;
  headline: string;
  reason: string;
  turnId: string | null;
  answer: string | null;
  evidence: string[]; // each check, in the order it was made
  naive: string; // what an automatic resend would have done instead
};

export const activeStatuses: TurnStatus[] = ['queued', 'in_progress', 'waiting'];
export const shortId = (id: string): string => (id.length > 16 ? `${id.slice(0, 7)}…${id.slice(-5)}` : id);

// Root turns created after the last turn the browser already knew about.
export function newRootTurns(pending: PendingSend, snapshot: Snapshot): SavedTurn[] | null {
  const roots = snapshot.turns.filter((turn) => !turn.subagentId);
  if (!pending.afterTurnId) return roots;
  const index = roots.findIndex((turn) => turn.id === pending.afterTurnId);
  return index === -1 ? null : roots.slice(index + 1);
}

// The final answer of one turn, read from saved items rather than from the stream.
export function savedAnswer(snapshot: Snapshot, turnId: string): string | null {
  const parts = snapshot.messages.filter((message) => message.turnId === turnId && message.role === 'assistant' && message.phase !== 'commentary').map((message) => message.text);
  return parts.length ? parts.join('\n\n') : null;
}

export function decideRecovery(pending: PendingSend, snapshot: Snapshot): Decision {
  const evidence: string[] = [`Pending request ${shortId(pending.requestId)} was written before sending: "${pending.prompt.slice(0, 60)}${pending.prompt.length > 60 ? '…' : ''}"`];
  const decide = (action: Action, headline: string, reason: string, naive: string, turnId: string | null = null, answer: string | null = null): Decision => ({ action, headline, reason, turnId, answer, evidence, naive });

  // 1. Find the session.
  if (snapshot.sessionStatus === null) {
    if (pending.sessionId) {
      evidence.push(`Session ${shortId(pending.sessionId)} was not found. It was deleted or belongs to another project.`);
      return decide('review', 'The session is gone', 'The request was sent to a session that no longer exists, so its outcome cannot be read. Start a new session if you still want an answer.', 'A blind resend fails against the missing session, or silently starts a new one without the earlier context.');
    }
    evidence.push(`No recent session carries request ID ${shortId(pending.requestId)} in its metadata.`);
    return decide('resend', 'Nothing ran. Sending again is safe', 'The session was never created, so no turn ran and nothing was billed. Send the same question again with the same request ID.', 'A resend is also correct here. This is the only case where resending without checking gives the right result.');
  }
  evidence.push(`Session ${shortId(snapshot.sessionId ?? '')} found by ${snapshot.foundBy === 'metadata' ? 'its request ID metadata (the browser never received its ID)' : 'its ID'}; status ${snapshot.sessionStatus}.`);

  // 2. Keep only root turns created after the last turn the browser knew.
  const fresh = newRootTurns(pending, snapshot);
  if (fresh === null) {
    evidence.push(`The last known turn ${shortId(pending.afterTurnId ?? '')} is not in the turns that were read.`);
    return decide('review', 'Cannot place the request', 'The turn list does not include the turn this request followed, so new turns cannot be separated from old ones. Review the session before sending anything.', 'A blind resend may duplicate a question that already has an answer.');
  }
  evidence.push(`${fresh.length} root turn${fresh.length === 1 ? '' : 's'} created after ${pending.afterTurnId ? `turn ${shortId(pending.afterTurnId)}` : 'the session started'}.`);

  // 3. Find the saved user message that carries this question.
  const prompt = pending.prompt.trim();
  const freshIds = new Set(fresh.map((turn) => turn.id));
  const matched = [...new Set(snapshot.messages.filter((message) => message.role === 'user' && freshIds.has(message.turnId) && message.text.trim() === prompt).map((message) => message.turnId))];

  if (matched.length > 1) {
    evidence.push(`The question is saved in ${matched.length} turns: ${matched.map(shortId).join(', ')}.`);
    return decide('review', 'The question already ran more than once', 'An earlier retry sent the same question again, so the session holds duplicate turns and duplicate charges. Show the first answer and do not send again.', 'A blind resend adds one more duplicate turn.', matched[0], savedAnswer(snapshot, matched[0]));
  }
  if (matched.length === 0) {
    if (fresh.length) {
      evidence.push(`New turn ${shortId(fresh[0].id)} does not contain this question. Another tab or client may be using the session.`);
      return decide('review', 'Another request is using the session', 'A new turn exists but it is not this question. Wait for it to finish and review the session before sending.', 'A blind resend queues this question behind, or alongside, another client’s work.');
    }
    if (!snapshot.complete) {
      evidence.push('More turns or items exist than the server read, so a missing match is not proof.');
      return decide('review', 'Not enough saved state was read', 'The saved history is longer than one read. Page through all turns and items before deciding.', 'A blind resend may duplicate a question that is saved on a later page.');
    }
    if (snapshot.sessionStatus === 'in_progress') {
      evidence.push('No turn holds the question yet, but the session is in progress. The input may still be queued.');
      return decide('wait', 'The input may still be queued', 'Accepted input can appear as a turn a moment later. Check again in a few seconds before sending.', 'A blind resend can queue the same question twice.');
    }
    evidence.push('No saved user message matches the question, and the session is not working on anything.');
    return decide('resend', 'The input never arrived. Send it again', 'Send the question again with the same request ID as its Idempotency-Key. If the first send did arrive, the API treats the second as the same message.', 'A resend with a new key would also work here, but only because the first one was lost. The same key keeps it safe if that is wrong.');
  }

  // 4. The question is saved in exactly one turn. Its status decides.
  const turn = fresh.find((candidate) => candidate.id === matched[0]) as SavedTurn;
  evidence.push(`The question is saved in turn ${shortId(turn.id)}, which is ${turn.status}.`);
  if (activeStatuses.includes(turn.status)) {
    return decide('reattach', 'The agent is still answering. Reattach', 'The turn is still running. Open the event stream again and follow this turn to its outcome. Nothing is sent.', 'A blind resend starts a second turn with the same question while the first is still answering: two answers, billed twice.', turn.id);
  }
  if (turn.status === 'completed') {
    const answer = savedAnswer(snapshot, turn.id);
    evidence.push(answer ? `A saved assistant message holds the answer (${answer.length} characters; ${pending.partial.length} had streamed before the disconnect).` : 'The turn completed but no saved assistant message was read.');
    return decide('show_saved', 'The answer is saved. Show it', 'The turn completed while the page was disconnected. Show the saved answer and replace any partial text. Do not send again.', 'A blind resend asks the same question twice. You pay for a second answer, which may differ from the one the user partly saw.', turn.id, answer);
  }
  evidence.push(turn.error ? `Error recorded: ${turn.error}` : `The turn ended as ${turn.status}, with no error message.`);
  return decide('offer_retry', `The turn ${turn.status}. Let the user decide`, `The request arrived and ended as ${turn.status}. Retrying is a new request, so it gets a new request ID. Show what happened and let the user decide.`, 'A blind resend repeats the question without showing why it failed, and may fail the same way.', turn.id);
}

// Browser storage is optional: a private window or blocked storage must not break the page.
const storageKey = 'lab13.recovery.v1';
export type Stored = { sessionId: string | null; pending: PendingSend | null };

const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

function parsePending(value: unknown): PendingSend | null {
  if (typeof value !== 'object' || value === null) return null;
  const pending = value as Record<string, unknown>;
  if (typeof pending.requestId !== 'string' || !nullableString(pending.sessionId) || typeof pending.prompt !== 'string' || !nullableString(pending.afterTurnId) || typeof pending.sentAt !== 'number' || typeof pending.partial !== 'string') return null;
  return { requestId: pending.requestId, sessionId: pending.sessionId, prompt: pending.prompt, afterTurnId: pending.afterTurnId, sentAt: pending.sentAt, partial: pending.partial };
}

export function loadStored(): Stored {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (typeof value !== 'object' || value === null) return { sessionId: null, pending: null };
    const stored = value as Record<string, unknown>;
    return { sessionId: typeof stored.sessionId === 'string' ? stored.sessionId : null, pending: parsePending(stored.pending) };
  } catch {
    return { sessionId: null, pending: null };
  }
}

export function saveStored(stored: Stored): boolean {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

const turnStatuses: TurnStatus[] = ['queued', 'in_progress', 'waiting', 'completed', 'failed', 'cancelled'];
const sessionStatuses: SessionStatus[] = ['idle', 'in_progress', 'requires_action', 'failed'];

// Runtime boundary: the browser checks the server's snapshot before deciding anything from it.
export function parseSnapshot(value: unknown): Snapshot {
  const fail = (): never => { throw new Error('Invalid recovery snapshot.'); };
  if (typeof value !== 'object' || value === null) return fail();
  const body = value as Record<string, unknown>;
  if (!nullableString(body.sessionId) || !(body.foundBy === null || body.foundBy === 'id' || body.foundBy === 'metadata') || typeof body.complete !== 'boolean') return fail();
  if (!(body.sessionStatus === null || sessionStatuses.includes(body.sessionStatus as SessionStatus))) return fail();
  if (!Array.isArray(body.turns) || !Array.isArray(body.messages)) return fail();
  const turns = body.turns.map((raw): SavedTurn => {
    const turn = raw as Record<string, unknown>;
    if (typeof turn.id !== 'string' || !turnStatuses.includes(turn.status as TurnStatus) || !nullableString(turn.subagentId) || !nullableString(turn.error)) return fail();
    return { id: turn.id, status: turn.status as TurnStatus, subagentId: turn.subagentId, error: turn.error };
  });
  const messages = body.messages.map((raw): SavedMessage => {
    const message = raw as Record<string, unknown>;
    if (!nullableString(message.id) || typeof message.turnId !== 'string' || (message.role !== 'user' && message.role !== 'assistant') || !(message.phase === null || message.phase === 'commentary' || message.phase === 'final_answer') || typeof message.status !== 'string' || typeof message.text !== 'string') return fail();
    return { id: message.id, turnId: message.turnId, role: message.role, phase: message.phase as SavedMessage['phase'], status: message.status, text: message.text };
  });
  return { sessionId: body.sessionId, foundBy: body.foundBy as Snapshot['foundBy'], sessionStatus: body.sessionStatus as SessionStatus | null, turns, messages, complete: body.complete };
}
