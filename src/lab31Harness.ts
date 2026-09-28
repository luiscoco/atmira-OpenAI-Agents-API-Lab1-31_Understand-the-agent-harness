export type EnvironmentKind = 'none' | 'openai_hosted' | 'self_hosted';
export type Owner = 'browser' | 'server' | 'harness' | 'model' | 'sandbox' | 'mcp' | 'unknown';
export type StepKind = 'input' | 'submit' | 'session' | 'environment' | 'turn' | 'text' | 'command' | 'function_call' | 'function_result' | 'mcp_call' | 'render' | 'disconnect' | 'unknown';
export type TraceStep = {
  id: string; kind: StepKind; label: string; detail: string;
  turnId: string | null; status: string | null; root: boolean; callId: string | null;
};
export type HarnessTrace = {
  version: 1; source: 'synthetic practice' | 'live saved state' | 'imported';
  title: string; sessionId: string | null; environment: EnvironmentKind;
  complete: boolean; warning: string | null; steps: TraceStep[];
};
export const owners: Record<Owner, { title: string; description: string }> = {
  browser: { title: 'React browser', description: 'Collects input, renders progress, and narrates explanations. It does not hold the OpenAI API key.' },
  server: { title: 'Application server', description: 'Keeps credentials, submits tasks, handles application function tools, enforces approvals, and connects the agent to the product.' },
  harness: { title: 'Managed harness', description: 'OpenAI runs the model/tool loop and maintains session progress, context, turns, and items. It can work without a sandbox.' },
  model: { title: 'Model', description: 'Generates text and proposes tool calls from context. A proposal is not execution or authorization.' },
  sandbox: { title: 'Execution environment', description: 'Runs commands and holds workspace files. Hosted compute is managed by OpenAI; self-hosted compute and its executor are managed by your infrastructure.' },
  mcp: { title: 'MCP service', description: 'Implements its exposed tools. The harness coordinates remote calls; connection origin determines the network path.' },
  unknown: { title: 'Unclassified', description: 'The available evidence does not establish an owner. Preserve unfamiliar items for review.' },
};
export const references = [
  { title: 'Architecture', url: 'https://developers.openai.com/api/docs/guides/agents-api/architecture' },
  { title: 'Compare agent runtimes', url: 'https://developers.openai.com/api/docs/guides/agents' },
  { title: 'Events and saved items', url: 'https://developers.openai.com/api/docs/guides/agents-api/sessions/events' },
];
export const runtimeComparison = [
  { name: 'Agents API', loop: 'OpenAI-managed Codex harness', state: 'Saved session configuration, turns, and items', tools: 'Hosted/service tools, your function handlers, optional sandbox', responsibility: 'Your app owns credentials, user access, business policy, and function implementations.' },
  { name: 'Agents SDK', loop: 'SDK runner inside your application', state: 'Your storage / SDK sessions or Responses conversation state', tools: 'Tools and integrations configured in your application', responsibility: 'You deploy the runner and choose its persistence, approvals, and runtime integrations.' },
  { name: 'Responses API', loop: 'Your integration, with optional hosted orchestration', state: 'Manual history, response chaining, or Conversations', tools: 'Hosted tools and functions your application executes', responsibility: 'You implement the surrounding workflow; hosted tools do not make every application tool managed.' },
];
export function architectureEdges(environment: EnvironmentKind): Array<{ from: Owner; to: Owner; label: string }> {
  const edges: Array<{ from: Owner; to: Owner; label: string }> = [
    { from: 'browser', to: 'server', label: 'Question / displayed result' },
    { from: 'server', to: 'harness', label: 'Session input / progress / function results' },
    { from: 'harness', to: 'model', label: 'Context / text and proposed actions' },
    { from: 'harness', to: 'mcp', label: 'Configured service-origin MCP calls / results' },
  ];
  if (environment !== 'none') edges.push({ from: 'harness', to: 'sandbox', label: 'Commands / output / workspace files' });
  if (environment === 'self_hosted') edges.push({ from: 'server', to: 'sandbox', label: 'Provision / connect executor / reconnect / shutdown' });
  return edges;
}
export function classifyStep(step: TraceStep): { owner: Owner; explanation: string } {
  switch (step.kind) {
    case 'input': case 'render': return { owner: 'browser', explanation: 'The product interface collects input or displays output.' };
    case 'submit': return { owner: 'server', explanation: 'Your application sends input; the managed harness performs the subsequent agent loop.' };
    case 'session': case 'turn': return { owner: 'harness', explanation: 'Session and turn lifecycle are maintained by the managed service. Idle is not a successful turn outcome.' };
    case 'environment': return { owner: 'sandbox', explanation: 'This describes compute lifecycle. The environment is separate from the harness that coordinates work.' };
    case 'command': return { owner: 'sandbox', explanation: 'Command execution happens in the environment. The harness coordinates it; the model proposes it.' };
    case 'function_call': return { owner: 'model', explanation: 'The saved call is a proposed application function. Model ownership is an architectural inference; the internal model invocation is not exposed here.' };
    case 'function_result': return { owner: 'server', explanation: 'Application function results are supplied by a handler. This item alone does not identify a particular process or prove a human approved it.' };
    case 'mcp_call': return { owner: 'mcp', explanation: 'An MCP service implements this tool; the harness handles the call. A failed call may have no service output at all.' };
    case 'text': return { owner: 'model', explanation: 'Assistant text is model output delivered by the harness. The words alone do not prove commands ran or tools succeeded.' };
    case 'disconnect': return { owner: 'browser', explanation: 'A disconnected reader cannot establish the remote turn outcome. Retrieve saved state before resending.' };
    default: return { owner: 'unknown', explanation: 'This item has no known ownership rule. Inspect it rather than guessing.' };
  }
}
export function traceOutcome(steps: TraceStep[]): string {
  const latest = [...steps].reverse().find(step => step.kind === 'turn' && step.root);
  return latest && ['completed', 'failed', 'cancelled', 'waiting', 'in_progress', 'queued'].includes(latest.status ?? '')
    ? latest.status! : 'unknown';
}
export function traceWarnings(trace: HarnessTrace): string[] {
  const warnings = trace.warning ? [trace.warning] : [];
  if (!trace.complete) warnings.push('Partial inventory: omitted items or turns may change your interpretation.');
  if (trace.environment === 'none' && trace.steps.some(step => step.kind === 'command')) warnings.push('A built-in sandbox command is inconsistent with environment none. Check the trace.');
  if (traceOutcome(trace.steps) === 'unknown') warnings.push('No root turn outcome is established by this trace.');
  if (trace.steps.some(step => step.kind === 'unknown')) warnings.push('Some items could not be classified.');
  return warnings;
}
const kinds: StepKind[] = ['input', 'submit', 'session', 'environment', 'turn', 'text', 'command', 'function_call', 'function_result', 'mcp_call', 'render', 'disconnect', 'unknown'];
export const validSessionId = (value: unknown): value is string => typeof value === 'string' && value.length <= 200 && /^sess_[A-Za-z0-9_-]+$/.test(value);
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Expected text up to ${max} characters.`);
  return value;
}
function optionalText(value: unknown, max = 200): string | null { return value === null ? null : boundedText(value, max); }
// Source is selected by the trusted caller. Imported JSON cannot claim to be a verified live read.
export function parseTrace(value: unknown, source: HarnessTrace['source'] = 'imported'): HarnessTrace {
  const raw = object(value);
  if (raw.version !== 1 || !['none', 'openai_hosted', 'self_hosted'].includes(String(raw.environment)) || typeof raw.complete !== 'boolean') throw new Error('Invalid trace version, environment, or inventory status.');
  if (raw.sessionId !== null && !validSessionId(raw.sessionId)) throw new Error('Invalid session ID.');
  if (!Array.isArray(raw.steps) || raw.steps.length > 1000) throw new Error('A trace supports at most 1,000 steps.');
  const ids = new Set<string>();
  const steps = raw.steps.map(value => {
    const row = object(value); const id = boundedText(row.id, 220);
    if (!id || ids.has(id) || !kinds.includes(row.kind as StepKind) || typeof row.root !== 'boolean') throw new Error('Invalid or duplicate step ID, kind, or root flag.');
    ids.add(id);
    return { id, kind: row.kind as StepKind, label: boundedText(row.label, 300), detail: boundedText(row.detail, 4000), turnId: optionalText(row.turnId), callId: optionalText(row.callId), status: optionalText(row.status, 100), root: row.root };
  });
  return { version: 1, source, title: boundedText(raw.title, 300), sessionId: raw.sessionId as string | null, environment: raw.environment as EnvironmentKind, complete: raw.complete, warning: optionalText(raw.warning, 1000), steps };
}
// Only selected public evidence is projected; raw agent settings and tool arguments never reach React.
export function projectItem(value: unknown): TraceStep {
  const item = object(value); const type = typeof item.type === 'string' ? item.type : 'unknown';
  let kind: StepKind = 'unknown'; let detail = `Saved item type: ${type}`;
  if (type === 'command_execution') { kind = 'command'; detail = `Command: ${typeof item.command === 'string' ? item.command.slice(0, 1200) : '(not reported)'}\nExit code: ${typeof item.exit_code === 'number' ? item.exit_code : 'unknown'}`; }
  if (type === 'function_call') { kind = 'function_call'; detail = `Proposed function: ${typeof item.name === 'string' ? item.name.slice(0, 200) : 'unknown'}. Arguments omitted from this ownership view.`; }
  if (type === 'function_call_output') { kind = 'function_result'; detail = 'Saved application function result. Content omitted; review the originating lab for validation and approvals.'; }
  if (type === 'mcp_call') { kind = 'mcp_call'; detail = `MCP tool: ${typeof item.name === 'string' ? item.name.slice(0, 200) : 'unknown'}; server: ${typeof item.server_label === 'string' ? item.server_label.slice(0, 200) : 'unknown'}. Result content omitted.`; }
  if (type === 'message') { kind = item.role === 'user' ? 'submit' : item.role === 'assistant' ? 'text' : 'unknown'; detail = `Saved ${String(item.role).slice(0, 50)} message; content omitted. A saved message does not expose the internal model call.`; }
  return { id: boundedText(item.id, 200), kind, label: type, detail, turnId: typeof item.turn_id === 'string' ? item.turn_id : null, callId: typeof item.call_id === 'string' ? item.call_id : null, status: typeof item.status === 'string' ? item.status : null, root: item.subagent_id == null };
}
export function evidenceDocument(trace: HarnessTrace, notes: string): string {
  const rows = trace.steps.map((step, index) => `${index + 1}. **${step.label}** — ${owners[classifyStep(step).owner].title}; status: ${step.status ?? 'not reported'}; turn: ${step.turnId ?? 'not reported'}.\n   ${classifyStep(step).explanation}`).join('\n');
  return `# Lab 31 — Agent harness evidence\n\nSource: ${trace.source}\nSession: ${trace.sessionId ?? 'synthetic / unavailable'}\nEnvironment: ${trace.environment}\nRoot outcome: ${trace.complete ? traceOutcome(trace.steps) : 'unknown (partial inventory)'}\nComplete inventory: ${trace.complete}\n\n## Annotated architecture\n\n${architectureEdges(trace.environment).map(edge => `- ${owners[edge.from].title} ↔ ${owners[edge.to].title}: ${edge.label}`).join('\n')}\n\n## Annotated session trace\n\n${rows}\n\n## Limitations\n\n${traceWarnings(trace).join('\n') || 'Saved-state and synthetic views do not expose internal model invocations or prove application authorization.'}\n\n## Student explanation\n\n${notes.slice(0, 5000)}\n\n## Sources\n\n${references.map(ref => `- [${ref.title}](${ref.url})`).join('\n')}\n`;
}
