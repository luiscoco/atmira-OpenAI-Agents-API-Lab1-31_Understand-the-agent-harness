import { courseCalendarTool, toolPresets, type FunctionToolDeclaration, type ToolCall, type ToolRun } from './lab16Tool.ts';

// Scripted runs in the same shape as the live summary. Event types, item fields, and statuses come from the SDK's
// types (openai 7.23.0). What the model chose to do in each case is illustrative: these are fixtures, not recordings.
export type ToolScenario = { id: string; title: string; summary: string; lesson: string; run: ToolRun };

const declared = (id: 'good' | 'vague' | 'loose'): FunctionToolDeclaration => {
  const draft = toolPresets.find((preset) => preset.id === id)?.draft;
  return draft ? { type: 'function', name: draft.name, description: draft.description, parameters: JSON.parse(draft.parametersText) as Record<string, unknown> } : courseCalendarTool;
};
const call = (n: number, name: string, args: unknown): ToolCall => ({ callId: `call_demo_${n}`, name, turnId: 'turn_demo_1', itemId: `fc_demo_${n}`, status: 'completed', arguments: args });
const requested = ['agent.session.created', 'agent.session.turn.created', 'agent.session.turn.in_progress', 'agent.session.turn.item.added', 'agent.session.turn.item.done', 'agent.session.requires_action'];
const answered = ['agent.session.created', 'agent.session.turn.created', 'agent.session.turn.in_progress', 'agent.session.turn.item.added', 'agent.session.turn.output_text.delta', 'agent.session.turn.output_text.done', 'agent.session.turn.item.done', 'agent.session.turn.completed', 'agent.session.idle'];
const run = (fields: Partial<ToolRun> & Pick<ToolRun, 'id' | 'prompt'>): ToolRun => ({
  tool: courseCalendarTool, sessionId: 'sess_demo_tools', turnId: 'turn_demo_1', turnStatus: 'waiting', sessionStatus: 'requires_action',
  calls: [], requiredActions: [], answer: '', events: requested, cancelSent: false, error: null, ...fields,
});

const lab17 = call(1, 'lookup_course_calendar', { topic: 'lab 17', kind: 'lab' });
const both = [call(1, 'lookup_course_calendar', { topic: 'function tools', kind: 'live_session' }), call(2, 'lookup_course_calendar', { topic: 'stage 4', kind: 'deadline' })];
const loose = call(1, 'lookup_course_calendar', { topic: 'Lab 17', date: 'next week' });
const asString = call(1, 'lookup_course_calendar', '{"topic":"streaming","kind":"live_session","from_date":"2026-10-01"}');

export const toolScenarios: ToolScenario[] = [
  {
    id: 'schedule', title: 'Schedule question, well-described tool',
    summary: 'The user asks when Lab 17 happens. The agent emits one function_call item, and the session moves to requires_action.',
    lesson: 'The agent does not run your function. It asks for it: a name, a call_id, and arguments that match the schema.',
    run: run({ id: 'schedule', prompt: 'When is the Lab 17 session?', calls: [lab17], requiredActions: [lab17] }),
  },
  {
    id: 'general', title: 'General question, same tool',
    summary: 'The user asks what a closure is. The tool is available, but the agent answers directly.',
    lesson: 'Declaring a tool makes it available, not mandatory. The description’s “do not use it for…” sentence helps the agent skip it.',
    run: run({ id: 'general', prompt: 'What is a JavaScript closure?', turnStatus: 'completed', sessionStatus: 'idle', events: answered, answer: 'A closure is a function that keeps access to variables from the scope where it was created, even after that scope has returned…' }),
  },
  {
    id: 'vague', title: 'Vague description',
    summary: 'The same schedule question, with a tool named “lookup” described as “Looks things up.” In this fixture the agent does not connect it to course dates.',
    lesson: 'The model decides from the name and description alone. If they do not say what the tool is for, the call may never happen.',
    run: run({ id: 'vague', prompt: 'When is the Lab 17 session?', tool: declared('vague'), turnStatus: 'completed', sessionStatus: 'idle', events: answered, answer: 'I don’t have access to the course calendar, so I can’t tell you the exact date of the Lab 17 session. Please check the course page.' }),
  },
  {
    id: 'loose', title: 'Loose schema',
    summary: 'The tool is described well, but its schema has no enum, no required fields, and allows extra fields. The call leaves out kind and invents date.',
    lesson: 'The schema shapes the arguments. Without required fields and additionalProperties: false, nothing stops a call your function cannot use.',
    run: run({ id: 'loose', prompt: 'Is Lab 17 next week?', tool: declared('loose'), calls: [loose], requiredActions: [loose] }),
  },
  {
    id: 'string', title: 'Arguments as a JSON string',
    summary: 'The arguments arrive as a JSON string instead of an object. The SDK types arguments as unknown, so both are possible.',
    lesson: 'Parse arguments at the boundary: accept an object or a JSON string, and treat anything else as invalid.',
    run: run({ id: 'string', prompt: 'Any live Q&A about streaming this month?', calls: [asString], requiredActions: [asString] }),
  },
  {
    id: 'two', title: 'Two calls in one turn',
    summary: 'One question needs two lookups. The turn holds two function_call items, and required_actions lists both.',
    lesson: 'Every call has its own call_id. Lab 17 must answer each one, or the turn keeps waiting.',
    run: run({ id: 'two', prompt: 'When is the function tools Q&A, and when is the Stage 4 project due?', calls: both, requiredActions: both, events: [...requested.slice(0, 5), 'agent.session.turn.item.added', 'agent.session.turn.item.done', 'agent.session.requires_action'] }),
  },
];
