import type { TimelineEvent } from './lab12Timeline.ts';

// Scripted teaching sequences in the same shape the Lab 12 server forwards.
// They are not recordings of a real run; each isolates one timeline rule.
// answers holds the completed answer text per root turn, shown once its message item is done.
export type Scenario = { id: string; title: string; summary: string; events: TimelineEvent[]; answers: Record<string, string> };
type Fields = Partial<Omit<TimelineEvent, 'eventId' | 'type' | 'at'>>;

function script(prefix: string) {
  let count = 0;
  let at = Date.UTC(2026, 0, 1);
  return (type: string, fields: Fields = {}, gapMs = 40): TimelineEvent => {
    at += gapMs;
    return { eventId: `${prefix}_${String(++count).padStart(2, '0')}`, type, at, turnId: null, itemId: null, itemType: null, status: null, subagentId: null, detail: null, ...fields };
  };
}

// One turn from creation to completion. The text deltas omit turn_id on purpose.
function singleTurn(): TimelineEvent[] {
  const e = script('evt_one');
  const turn = { turnId: 'turn_first' };
  return [
    e('agent.session.created', { status: 'in_progress' }),
    e('agent.session.in_progress', { status: 'in_progress' }),
    e('agent.session.turn.created', { ...turn, status: 'queued' }),
    e('agent.session.turn.in_progress', { ...turn, status: 'in_progress' }, 120),
    e('agent.session.turn.item.added', { ...turn, itemId: 'msg_user', itemType: 'message', detail: 'user' }),
    e('agent.session.turn.item.added', { ...turn, itemId: 'rs_think', itemType: 'reasoning', status: 'in_progress' }, 300),
    e('agent.session.turn.item.done', { ...turn, itemId: 'rs_think', itemType: 'reasoning', status: 'completed' }, 900),
    e('agent.session.turn.item.added', { ...turn, itemId: 'msg_answer', itemType: 'message', status: 'in_progress', detail: 'assistant · final_answer' }),
    e('agent.session.turn.content_part.added', { ...turn, itemId: 'msg_answer', detail: 'part 0' }),
    ...Array.from({ length: 6 }, () => e('agent.session.turn.output_text.delta', { itemId: 'msg_answer', detail: '+18 chars' }, 60)),
    e('agent.session.turn.output_text.done', { ...turn, itemId: 'msg_answer', detail: '108 chars' }),
    e('agent.session.turn.content_part.done', { ...turn, itemId: 'msg_answer', detail: 'part 0' }),
    e('agent.session.turn.item.done', { ...turn, itemId: 'msg_answer', itemType: 'message', status: 'completed', detail: 'assistant · final_answer' }),
    e('agent.session.turn.completed', { ...turn, status: 'completed' }),
    e('agent.session.idle', { status: 'idle' }, 80),
  ];
}

// A follow-up in the same session: one session lane, two root turns.
function followUp(): TimelineEvent[] {
  const e = script('evt_two');
  const turn = (turnId: string, answer: string, gapMs: number) => [
    e('agent.session.in_progress', { status: 'in_progress' }, gapMs),
    e('agent.session.turn.created', { turnId, status: 'queued' }),
    e('agent.session.turn.in_progress', { turnId, status: 'in_progress' }, 150),
    e('agent.session.turn.item.added', { turnId, itemId: answer, itemType: 'message', status: 'in_progress', detail: 'assistant · final_answer' }, 700),
    ...Array.from({ length: 4 }, () => e('agent.session.turn.output_text.delta', { turnId, itemId: answer, detail: '+22 chars' }, 70)),
    e('agent.session.turn.output_text.done', { turnId, itemId: answer, detail: '88 chars' }),
    e('agent.session.turn.item.done', { turnId, itemId: answer, itemType: 'message', status: 'completed', detail: 'assistant · final_answer' }),
    e('agent.session.turn.completed', { turnId, status: 'completed' }),
    e('agent.session.idle', { status: 'idle' }, 80),
  ];
  return [e('agent.session.created', { status: 'in_progress' }), ...turn('turn_question', 'msg_first', 40), ...turn('turn_followup', 'msg_second', 4000)];
}

// A subagent turn runs inside the root turn and completes first.
function subagent(): TimelineEvent[] {
  const e = script('evt_sub');
  const root = { turnId: 'turn_root' };
  const child = { turnId: 'turn_child' };
  return [
    e('agent.session.created', { status: 'in_progress' }),
    e('agent.session.turn.created', { ...root, status: 'queued' }),
    e('agent.session.turn.in_progress', { ...root, status: 'in_progress' }, 120),
    e('agent.session.turn.item.added', { ...root, itemId: 'call_spawn', itemType: 'create_subagent_call', status: 'in_progress' }, 500),
    e('agent.session.subagent.created', { subagentId: 'sub_research', detail: 'researcher' }),
    e('agent.session.turn.item.done', { ...root, itemId: 'call_spawn', itemType: 'create_subagent_call', status: 'completed' }),
    e('agent.session.turn.created', { ...child, subagentId: 'sub_research', status: 'queued' }),
    e('agent.session.turn.in_progress', { ...child, subagentId: 'sub_research', status: 'in_progress' }),
    e('agent.session.turn.item.added', { ...root, itemId: 'call_wait', itemType: 'wait_for_subagents_call', status: 'in_progress' }),
    e('agent.session.turn.item.added', { ...child, itemId: 'msg_child', itemType: 'message', status: 'in_progress', detail: 'assistant' }, 600),
    ...Array.from({ length: 3 }, () => e('agent.session.turn.output_text.delta', { ...child, itemId: 'msg_child', detail: '+30 chars' }, 60)),
    e('agent.session.turn.item.done', { ...child, itemId: 'msg_child', itemType: 'message', status: 'completed', detail: 'assistant' }),
    e('agent.session.turn.completed', { ...child, subagentId: 'sub_research', status: 'completed' }),
    e('agent.session.turn.item.done', { ...root, itemId: 'call_wait', itemType: 'wait_for_subagents_call', status: 'completed' }),
    e('agent.session.turn.item.added', { ...root, itemId: 'msg_root', itemType: 'message', status: 'in_progress', detail: 'assistant · final_answer' }, 300),
    ...Array.from({ length: 4 }, () => e('agent.session.turn.output_text.delta', { ...root, itemId: 'msg_root', detail: '+25 chars' }, 60)),
    e('agent.session.turn.item.done', { ...root, itemId: 'msg_root', itemType: 'message', status: 'completed', detail: 'assistant · final_answer' }),
    e('agent.session.turn.completed', { ...root, status: 'completed' }),
    e('agent.session.idle', { status: 'idle' }, 80),
  ];
}

// A turn fails mid-answer, one event is delivered twice, and a late delta arrives.
function failure(): TimelineEvent[] {
  const e = script('evt_fail');
  const turn = { turnId: 'turn_broken' };
  const events = [
    e('agent.session.created', { status: 'in_progress' }),
    e('agent.session.turn.created', { ...turn, status: 'queued' }),
    e('agent.session.turn.in_progress', { ...turn, status: 'in_progress' }, 120),
    e('agent.session.turn.item.added', { ...turn, itemId: 'msg_partial', itemType: 'message', status: 'in_progress', detail: 'assistant · final_answer' }, 600),
    e('agent.session.turn.output_text.delta', { ...turn, itemId: 'msg_partial', detail: '+20 chars' }),
    e('agent.session.turn.output_text.delta', { ...turn, itemId: 'msg_partial', detail: '+17 chars' }),
  ];
  // The same event arrives twice, as it can after a reconnect replays recent events.
  events.push({ ...events[events.length - 1] });
  events.push(
    e('agent.session.turn.failed', { ...turn, status: 'failed', detail: 'The model request timed out.' }, 2000),
    e('agent.session.turn.output_text.delta', { ...turn, itemId: 'msg_partial', detail: '+9 chars' }, 20),
    e('agent.session.idle', { status: 'idle' }, 80),
  );
  return events;
}

export const scenarios: Scenario[] = [
  { id: 'single', title: 'One turn, start to finish', summary: 'Session events frame one root turn. The text deltas have no turn_id, so the timeline places them by their item.', events: singleTurn(), answers: { turn_first: 'A **Promise** is an object that stands for a value you will get later, for example the result of a network request.' } },
  { id: 'followup', title: 'Two turns in one session', summary: 'A follow-up adds a second root turn to the same session. Session events stay in their own lane between the turns.', events: followUp(), answers: { turn_question: 'A **closure** is a function that keeps access to the variables of the scope where it was created.', turn_followup: 'For example:\n\n```js\nconst makeCounter = () => { let n = 0; return () => ++n; };\n```' } },
  { id: 'subagent', title: 'A subagent inside the root turn', summary: 'A subagent turn starts and completes while the root turn is still running. The run is finished only when the root turn completes.', events: subagent(), answers: { turn_root: 'The researcher subagent found that `fetch` rejects only on network errors, so check `response.ok` for HTTP errors.' } },
  { id: 'failure', title: 'Failed turn, replayed and late events', summary: 'The root turn fails. One event arrives twice and a delta arrives after the failure. The timeline skips the replay and flags the late event.', events: failure(), answers: {} },
];
