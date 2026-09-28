// Lab 16: declare a function tool and read the agent's request for it.
// Pure functions only, so the server, the live run, and the playground share them.

// The shape the Agents API accepts in agent.tools (AgentToolParam.AgentToolConfigParamFunction in openai 7.23.0).
export type FunctionToolDeclaration = { type: 'function'; name: string; description: string; parameters: Record<string, unknown> };
export type ToolDraft = { name: string; description: string; parametersText: string };
export type Finding = { level: 'error' | 'warn' | 'ok'; text: string };

export const courseCalendarTool: FunctionToolDeclaration = {
  type: 'function',
  name: 'lookup_course_calendar',
  description:
    'Look up dates in the course calendar for the "OpenAI Agents API with React" course: labs, live Q&A sessions, and deadlines. ' +
    'Use it whenever the user asks when something happens or what is scheduled. Do not use it for general programming questions.',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'What to look up: a lab number such as "lab 17", or a topic such as "function tools" or "streaming".' },
      kind: { type: 'string', enum: ['lab', 'live_session', 'deadline', 'any'], description: 'The kind of calendar entry. Use "any" when the user does not say.' },
      from_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Only return entries on or after this date, as YYYY-MM-DD. Omit to start from today.' },
    },
    required: ['topic', 'kind'],
    additionalProperties: false,
  },
};

const draftOf = (tool: FunctionToolDeclaration): ToolDraft => ({ name: tool.name, description: tool.description, parametersText: JSON.stringify(tool.parameters, null, 2) });

export type ToolPreset = { id: 'good' | 'vague' | 'loose' | 'none'; label: string; hint: string; draft: ToolDraft | null };
export const toolPresets: ToolPreset[] = [
  { id: 'good', label: 'Well described', hint: 'Says what it does, when to use it, and when not to. Strict schema.', draft: draftOf(courseCalendarTool) },
  { id: 'vague', label: 'Vague', hint: 'A generic name, a one-line description, one free-text field.', draft: draftOf({ type: 'function', name: 'lookup', description: 'Looks things up.', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }) },
  { id: 'loose', label: 'Loose schema', hint: 'A good description, but no enum, no required fields, and extra fields allowed.', draft: draftOf({ ...courseCalendarTool, parameters: { type: 'object', properties: { topic: { type: 'string' }, kind: { type: 'string' }, from_date: { type: 'string' } } } }) },
  { id: 'none', label: 'No tool', hint: 'The same agent with no tools. It can only answer from what it knows.', draft: null },
];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const namePattern = /^[a-zA-Z0-9_-]{1,64}$/;

// Check a declaration before it is sent. Errors block the run; warnings are allowed, so their effect can be seen live.
export function lintTool(draft: ToolDraft): { declaration: FunctionToolDeclaration | null; findings: Finding[] } {
  const findings: Finding[] = [];
  const name = draft.name.trim();
  const description = draft.description.trim();
  if (!namePattern.test(name)) findings.push({ level: 'error', text: 'name must be 1–64 characters: letters, digits, _ or -. No spaces.' });
  else if (name.length < 6 || !/[_-]/.test(name)) findings.push({ level: 'warn', text: `name "${name}" is generic. A verb and an object, such as lookup_course_calendar, tells the model what it does.` });
  else findings.push({ level: 'ok', text: `name "${name}" says what the function does.` });

  if (!description) findings.push({ level: 'error', text: 'description is empty. The model reads it to decide when to call the tool.' });
  else if (description.length < 60) findings.push({ level: 'warn', text: `description is ${description.length} characters. Say what the tool returns, when to use it, and when not to.` });
  else if (!/\bwhen\b/i.test(description)) findings.push({ level: 'warn', text: 'description never says when to use the tool.' });
  else findings.push({ level: 'ok', text: 'description says what the tool does and when to use it.' });
  if (description.length > 1024) findings.push({ level: 'warn', text: 'description is over 1,024 characters. Keep it short; long descriptions cost tokens on every turn.' });

  let parameters: unknown;
  try { parameters = JSON.parse(draft.parametersText); } catch (error) {
    findings.push({ level: 'error', text: `parameters is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}.` });
    return { declaration: null, findings };
  }
  if (!isObject(parameters) || parameters.type !== 'object') findings.push({ level: 'error', text: 'parameters must be a JSON Schema object with "type": "object".' });
  else {
    const properties = parameters.properties;
    if (!isObject(properties)) findings.push({ level: 'error', text: 'parameters.properties must be an object that lists each argument.' });
    else {
      const names = Object.keys(properties);
      if (!names.length) findings.push({ level: 'warn', text: 'The tool takes no arguments. That is allowed, but a lookup usually needs one.' });
      for (const key of names) {
        const property = properties[key];
        if (!isObject(property) || typeof property.type !== 'string') findings.push({ level: 'error', text: `Argument "${key}" needs a "type".` });
        else if (typeof property.description !== 'string' || !property.description.trim()) findings.push({ level: 'warn', text: `Argument "${key}" has no description. The model has to guess what to put in it.` });
        if (isObject(property) && 'enum' in property && (!Array.isArray(property.enum) || property.enum.length === 0)) findings.push({ level: 'error', text: `Argument "${key}" has an empty or invalid enum.` });
      }
      const required = parameters.required;
      if (required !== undefined && (!Array.isArray(required) || required.some((item) => typeof item !== 'string'))) findings.push({ level: 'error', text: 'parameters.required must be an array of argument names.' });
      else if (Array.isArray(required)) {
        const missing = required.filter((item) => !names.includes(item as string));
        if (missing.length) findings.push({ level: 'error', text: `required lists ${missing.map((item) => `"${String(item)}"`).join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not in properties.` });
        else if (required.length) findings.push({ level: 'ok', text: `required: ${required.join(', ')}.` });
      } else if (names.length) findings.push({ level: 'warn', text: 'No required arguments. The model may call the tool with an empty object.' });
      if (parameters.additionalProperties !== false) findings.push({ level: 'warn', text: 'additionalProperties is not false. The model may invent extra arguments.' });
      else findings.push({ level: 'ok', text: 'additionalProperties: false. Only declared arguments are allowed.' });
    }
  }
  if (findings.some((finding) => finding.level === 'error') || !isObject(parameters)) return { declaration: null, findings };
  return { declaration: { type: 'function', name, description, parameters }, findings };
}

// ---- The agent's request ----

// One function call as the API reports it. `arguments` is typed `unknown` in the SDK: parse it, never trust it.
export type ToolCall = { callId: string; name: string; turnId: string | null; itemId: string | null; status: string | null; arguments: unknown };
export type TurnStatus = 'completed' | 'failed' | 'cancelled' | 'waiting' | 'unknown';

export type ToolRun = {
  id: string;
  prompt: string;
  tool: FunctionToolDeclaration | null;
  sessionId: string | null;
  turnId: string | null;
  turnStatus: TurnStatus;
  sessionStatus: string | null;
  calls: ToolCall[]; // function_call items seen in the stream
  requiredActions: ToolCall[]; // session.required_actions from agent.session.requires_action
  answer: string;
  events: string[]; // event types in arrival order
  cancelSent: boolean;
  error: string | null;
};

export type ParsedArguments = { form: 'object' | 'json string' | 'invalid'; value: Record<string, unknown> | null; error: string | null };
export function parseArguments(raw: unknown): ParsedArguments {
  if (isObject(raw)) return { form: 'object', value: raw, error: null };
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isObject(parsed) ? { form: 'json string', value: parsed, error: null } : { form: 'invalid', value: null, error: 'The JSON is not an object.' };
    } catch { return { form: 'invalid', value: null, error: 'The string is not valid JSON.' }; }
  }
  return { form: 'invalid', value: null, error: `Expected an object or a JSON string, got ${raw === null ? 'null' : typeof raw}.` };
}

// A preview of how the arguments compare with the declaration. It covers the schema keywords this lab uses.
// Lab 18 turns this into real validation that rejects a call.
export function checkArguments(args: Record<string, unknown>, schema: Record<string, unknown> | null): Finding[] {
  if (!schema) return [{ level: 'warn', text: 'No declaration to compare with.' }];
  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];
  const findings: Finding[] = [];
  for (const key of required) if (!(key in args)) findings.push({ level: 'error', text: `Missing required argument "${key}".` });
  for (const [key, value] of Object.entries(args)) {
    const property = properties[key];
    if (!isObject(property)) {
      findings.push({ level: schema.additionalProperties === false ? 'error' : 'warn', text: `"${key}" is not a declared argument${schema.additionalProperties === false ? '' : ' (allowed, because additionalProperties is not false)'}.` });
      continue;
    }
    const type = property.type;
    const typeOk = type === 'string' ? typeof value === 'string' : type === 'integer' ? Number.isInteger(value) : type === 'number' ? typeof value === 'number' : type === 'boolean' ? typeof value === 'boolean' : true;
    if (!typeOk) { findings.push({ level: 'error', text: `"${key}" should be ${String(type)}, got ${JSON.stringify(value)}.` }); continue; }
    if (Array.isArray(property.enum) && !property.enum.includes(value)) { findings.push({ level: 'error', text: `"${key}" is ${JSON.stringify(value)}, not one of ${property.enum.map((item) => JSON.stringify(item)).join(', ')}.` }); continue; }
    if (typeof property.pattern === 'string' && typeof value === 'string' && !new RegExp(property.pattern).test(value)) { findings.push({ level: 'error', text: `"${key}" is ${JSON.stringify(value)}, which does not match ${property.pattern}.` }); continue; }
    findings.push({ level: 'ok', text: `"${key}" = ${JSON.stringify(value)} matches the declaration.` });
  }
  if (!Object.keys(args).length && !required.length) findings.push({ level: 'warn', text: 'The call has no arguments.' });
  return findings;
}

export type Verdict = { tone: 'requested' | 'direct' | 'failed' | 'unknown'; title: string; text: string };
export function classifyRun(run: ToolRun): Verdict {
  const calls = run.requiredActions.length || run.calls.length;
  if (calls && run.turnStatus === 'waiting') return { tone: 'requested', title: 'Tool requested · turn waiting', text: `The agent asked for ${calls} call${calls === 1 ? '' : 's'} and the turn is paused until a result arrives. Lab 17 sends that result.` };
  if (calls && run.turnStatus === 'cancelled') return { tone: 'requested', title: 'Tool requested · then cancelled', text: `The agent asked for ${calls} call${calls === 1 ? '' : 's'}. No result was sent, so the server cancelled the waiting turn to leave the session clean.` };
  if (calls) return { tone: 'requested', title: 'Tool requested', text: `The agent asked for ${calls} call${calls === 1 ? '' : 's'}. The turn is ${run.turnStatus}.` };
  if (run.turnStatus === 'completed') return { tone: 'direct', title: 'Answered directly', text: run.tool ? 'The tool was available, but the agent decided it did not need it.' : 'No tool was declared, so the agent could only answer from what it knows.' };
  if (run.turnStatus === 'failed' || run.error) return { tone: 'failed', title: 'Failed', text: run.error ?? 'The turn failed.' };
  return { tone: 'unknown', title: 'No outcome', text: 'The stream ended before the turn had an outcome.' };
}

// Runtime boundary: the browser checks the server's summary before using it.
export function parseToolRun(value: unknown, id: string, prompt: string): ToolRun {
  const fail = (): never => { throw new Error('Invalid run summary.'); };
  if (!isObject(value)) return fail();
  const str = (field: unknown): string | null => (typeof field === 'string' ? field : field === null || field === undefined ? null : fail());
  const call = (raw: unknown): ToolCall => {
    if (!isObject(raw) || typeof raw.callId !== 'string' || typeof raw.name !== 'string') return fail();
    return { callId: raw.callId, name: raw.name, turnId: str(raw.turnId), itemId: str(raw.itemId), status: str(raw.status), arguments: raw.arguments };
  };
  const statuses: TurnStatus[] = ['completed', 'failed', 'cancelled', 'waiting', 'unknown'];
  if (!statuses.includes(value.turnStatus as TurnStatus) || !Array.isArray(value.calls) || !Array.isArray(value.requiredActions) || !Array.isArray(value.events)) return fail();
  const tool = value.tool === null ? null : isObject(value.tool) && typeof value.tool.name === 'string' && typeof value.tool.description === 'string' && isObject(value.tool.parameters)
    ? { type: 'function' as const, name: value.tool.name, description: value.tool.description, parameters: value.tool.parameters } : fail();
  return {
    id, prompt, tool,
    sessionId: str(value.sessionId), turnId: str(value.turnId), turnStatus: value.turnStatus as TurnStatus, sessionStatus: str(value.sessionStatus),
    calls: value.calls.map(call), requiredActions: value.requiredActions.map(call),
    answer: typeof value.answer === 'string' ? value.answer : '', events: value.events.filter((item): item is string => typeof item === 'string'),
    cancelSent: value.cancelSent === true, error: str(value.error),
  };
}

// ---- The function behind the tool (Lab 17 runs it; Lab 16 only previews it) ----

export type CalendarEntry = { date: string; kind: 'lab' | 'live_session' | 'deadline'; title: string; topics: string[] };
export const courseCalendar: CalendarEntry[] = [
  { date: '2026-10-05', kind: 'lab', title: 'Lab 16 — Declare a function tool', topics: ['lab 16', 'function tools', 'tools'] },
  { date: '2026-10-07', kind: 'live_session', title: 'Live Q&A — streaming and React', topics: ['streaming', 'react', 'events'] },
  { date: '2026-10-12', kind: 'lab', title: 'Lab 17 — Complete a required action', topics: ['lab 17', 'required action', 'function tools', 'tools'] },
  { date: '2026-10-14', kind: 'live_session', title: 'Live Q&A — function tools', topics: ['function tools', 'tools', 'lab 16', 'lab 17'] },
  { date: '2026-10-19', kind: 'lab', title: 'Lab 18 — Validate tool inputs', topics: ['lab 18', 'validation', 'function tools'] },
  { date: '2026-10-23', kind: 'deadline', title: 'Stage 4 project submission', topics: ['stage 4', 'project', 'function tools'] },
  { date: '2026-11-27', kind: 'deadline', title: 'Final project submission', topics: ['final project', 'project'] },
];

export function lookupCourseCalendar(args: Record<string, unknown>): { entries: CalendarEntry[]; note: string } {
  const topic = typeof args.topic === 'string' ? args.topic.toLowerCase().trim() : typeof args.q === 'string' ? args.q.toLowerCase().trim() : '';
  const kind = typeof args.kind === 'string' ? args.kind : 'any';
  const from = typeof args.from_date === 'string' ? args.from_date : '';
  const entries = courseCalendar.filter((entry) =>
    (!topic || entry.topics.some((item) => topic.includes(item) || item.includes(topic)) || entry.title.toLowerCase().includes(topic))
    && (kind === 'any' || entry.kind === kind)
    && (!from || entry.date >= from));
  return { entries, note: entries.length ? `${entries.length} matching entr${entries.length === 1 ? 'y' : 'ies'}.` : 'No matching entries.' };
}
