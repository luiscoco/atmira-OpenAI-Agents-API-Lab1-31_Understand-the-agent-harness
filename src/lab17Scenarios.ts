import type { ToolCall } from './lab16Tool.ts';
import { courseCalendarTool, executeCall, type ActionRun, type Moment, type ResultMode, type ToolResult } from './lab17Action.ts';

// Scripted runs in the same shape as the live summary. Event types, item fields, and the tool_result event come from
// the SDK's types (openai 7.23.0). The results are computed by the same executeCall the server uses. What the model
// chose to do and say in each case is illustrative: these are fixtures, not recordings.
export type ActionScenario = { id: string; title: string; summary: string; lesson: string; run: ActionRun };

const call = (n: number, args: unknown, name = courseCalendarTool.name): ToolCall => ({ callId: `call_demo_${n}`, name, turnId: 'turn_demo_1', itemId: `fc_demo_${n}`, status: 'completed', arguments: args });
const result = (item: ToolCall, round: number, mode: ResultMode = 'execute'): ToolResult => ({ callId: item.callId, turnId: item.turnId ?? 'turn_demo_1', name: item.name, ...executeCall(item, courseCalendarTool, mode), durationMs: 0.4, round });

const start = ['agent.session.created', 'agent.session.turn.created', 'agent.session.turn.in_progress'];
const asks = (n: number) => [...Array.from({ length: n }, () => ['agent.session.turn.item.added', 'agent.session.turn.item.done']).flat(), 'agent.session.requires_action'];
const answers = ['agent.session.turn.item.added', 'agent.session.turn.output_text.delta', 'agent.session.turn.output_text.done', 'agent.session.turn.item.done', 'agent.session.turn.completed', 'agent.session.idle'];

// Illustrative timings, in milliseconds from the prompt.
const t0 = Date.UTC(2026, 9, 12, 9, 0, 0);
const at = (ms: number, kind: Moment['kind'], label: string): Moment => ({ at: t0 + ms, kind, label });
const callMoment = (ms: number, item: ToolCall) => at(ms, 'call', `${item.name}(${JSON.stringify(item.arguments)})`);
const resultMoment = (ms: number, item: ToolResult) => at(ms, 'result', `${item.name} → ${item.success ? 'success' : 'error'} (${item.callId})`);

const run = (fields: Partial<ActionRun> & Pick<ActionRun, 'id' | 'prompt'>): ActionRun => ({
  mode: 'execute', delivery: 'auto', sessionId: 'sess_demo_action', turnId: 'turn_demo_1', turnStatus: 'completed', rounds: 1,
  calls: [], results: [], pending: [], answer: '', events: [], timeline: [], error: null, ...fields,
});

const lab17 = call(1, { topic: 'lab 17', kind: 'lab' });
const lab17Result = result(lab17, 1);
const qa = call(1, { topic: 'function tools', kind: 'live_session' });
const due = call(2, { topic: 'stage 4', kind: 'deadline' });
const outage = result(lab17, 1, 'fail');
const bad = call(1, { topic: 'lab 18', kind: 'workshop' });
const fixed = call(2, { topic: 'lab 18', kind: 'lab' });
const two = [call(1, { topic: 'lab 17', kind: 'lab' }), call(2, { topic: 'lab 18', kind: 'lab' })];

export const actionScenarios: ActionScenario[] = [
  {
    id: 'one', title: 'One call, one result',
    summary: 'The agent asks for lookup_course_calendar. The server runs it, sends one tool_result with the same call_id, and the agent answers with the date.',
    lesson: 'The full loop is request → function_call → requires_action → tool_result → answer, all in the same turn.',
    run: run({ id: 'one', prompt: 'When is the Lab 17 session?', calls: [lab17], results: [lab17Result],
      events: [...start, ...asks(1), ...answers],
      timeline: [at(0, 'prompt', 'When is the Lab 17 session?'), callMoment(1400, lab17), at(1420, 'waiting', 'Session requires_action: 1 call waiting'), resultMoment(1440, lab17Result), at(2600, 'answer', 'The agent starts its answer'), at(3300, 'outcome', 'Turn completed')],
      answer: 'The **Lab 17 — Complete a required action** session is on **Monday, 12 October 2026**.' }),
  },
  {
    id: 'two', title: 'Two calls, one batch',
    summary: 'One question needs two lookups. required_actions lists both, and the server answers both in a single events.create request.',
    lesson: 'Send a result for every call_id. One request can carry several tool_result events.',
    run: run({ id: 'two', prompt: 'When is the live Q&A about function tools, and when is the Stage 4 project due?', calls: [qa, due], results: [result(qa, 1), result(due, 1)],
      events: [...start, ...asks(2), ...answers],
      timeline: [at(0, 'prompt', 'When is the live Q&A about function tools, and when is the Stage 4 project due?'), callMoment(1500, qa), callMoment(1700, due), at(1720, 'waiting', 'Session requires_action: 2 calls waiting'), resultMoment(1740, result(qa, 1)), resultMoment(1741, result(due, 1)), at(3000, 'answer', 'The agent starts its answer'), at(3900, 'outcome', 'Turn completed')],
      answer: 'The **live Q&A on function tools** is on **14 October 2026**, and the **Stage 4 project** is due on **23 October 2026**.' }),
  },
  {
    id: 'outage', title: 'The function fails',
    summary: 'The calendar service is down. The server sends success: false with an error message instead of an output.',
    lesson: 'A failure is still a result. Report it with success: false, and the agent can explain the problem instead of inventing a date.',
    run: run({ id: 'outage', prompt: 'When is the Lab 17 session?', mode: 'fail', calls: [lab17], results: [outage],
      events: [...start, ...asks(1), ...answers],
      timeline: [at(0, 'prompt', 'When is the Lab 17 session?'), callMoment(1400, lab17), at(1420, 'waiting', 'Session requires_action: 1 call waiting'), resultMoment(1430, outage), at(2500, 'answer', 'The agent starts its answer'), at(3000, 'outcome', 'Turn completed')],
      answer: 'I couldn’t reach the course calendar just now, so I can’t confirm the Lab 17 date. Please try again in a moment or check the course page.' }),
  },
  {
    id: 'retry', title: 'Rejected arguments, then a retry',
    summary: 'The first call uses kind "workshop", which is not in the enum. The server rejects it with success: false. The agent calls again with kind "lab", and the turn pauses a second time.',
    lesson: 'One turn can pause more than once. Keep reading the same stream, answer each new round, and cap the rounds so a loop cannot run forever.',
    run: run({ id: 'retry', prompt: 'When is the Lab 18 workshop?', rounds: 2, calls: [bad, fixed], results: [result(bad, 1), result(fixed, 2)],
      events: [...start, ...asks(1), ...asks(1), ...answers],
      timeline: [at(0, 'prompt', 'When is the Lab 18 workshop?'), callMoment(1300, bad), at(1320, 'waiting', 'Session requires_action: 1 call waiting'), resultMoment(1330, result(bad, 1)), callMoment(2600, fixed), at(2620, 'waiting', 'Session requires_action: 1 call waiting'), resultMoment(2630, result(fixed, 2)), at(3700, 'answer', 'The agent starts its answer'), at(4300, 'outcome', 'Turn completed')],
      answer: '**Lab 18 — Validate tool inputs** is on **19 October 2026**. It is a lab rather than a workshop.' }),
  },
  {
    id: 'step', title: 'Step through: waiting for you',
    summary: 'In step-through mode the server stops reading at requires_action. Nothing is sent, so the session stays in requires_action and the turn waits.',
    lesson: 'The turn does not time out on its own. It waits until your server sends a result or cancels the turn.',
    run: run({ id: 'step', prompt: 'When is the Lab 17 session?', delivery: 'step', turnStatus: 'waiting', rounds: 0, calls: [lab17], pending: [lab17],
      events: [...start, ...asks(1)],
      timeline: [at(0, 'prompt', 'When is the Lab 17 session?'), callMoment(1400, lab17), at(1420, 'waiting', 'Session requires_action: 1 call waiting')] }),
  },
  {
    id: 'missing', title: 'One result missing',
    summary: 'Two calls were requested, but only one result was sent. The pairing check flags the call_id with no result, and the session is still in requires_action.',
    lesson: 'The turn resumes only when every call has a result. Match results to calls by call_id, never by order.',
    run: run({ id: 'missing', prompt: 'When are Labs 17 and 18?', turnStatus: 'waiting', calls: two, results: [result(two[0], 1)],
      events: [...start, ...asks(2)],
      timeline: [at(0, 'prompt', 'When are Labs 17 and 18?'), callMoment(1300, two[0]), callMoment(1500, two[1]), at(1520, 'waiting', 'Session requires_action: 2 calls waiting'), resultMoment(1530, result(two[0], 1))],
      error: 'call_demo_2 has no result. The turn is still waiting.' }),
  },
];
