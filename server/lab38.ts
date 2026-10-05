import type { IncomingMessage, ServerResponse } from 'node:http';
import OpenAI from 'openai';
import { localExecutorRequest } from './lab32.ts';
import { configured, model, body, send, redact, requestId, boundedNext } from './courseLabHttp.ts';
import { guardedPrompt, guardedReport, guardedTools } from '../src/lab38Guard.ts';
import { runAdvancedSuite } from '../src/advancedLabTests.ts';
import { newDelegationTrace, applyDelegationEvent } from '../src/lab39Delegation.ts';
import { createGuardWorkspace, executeGuardTool, guardResources, guardView, reviewGuardProposal, disposeGuard, type GuardWorkspace } from './lab38Service.ts';
const workspaces = new Map<string, GuardWorkspace>(); const requests = new Map<string, string>();
const runs = new Map<string, { controller: AbortController; done: Promise<void> }>();
async function liveProposal(workspace: GuardWorkspace, controller: AbortController) {
  workspace.busy = true; workspace.source = 'live Agents API + application file broker'; const trace = workspace.trace = newDelegationTrace('live Agents API');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 0 }); const timer = setTimeout(() => controller.abort(), 120000); let stream: any; const answered = new Set<string>();
  try {
    const resources = await guardResources(); const rules = await executeGuardTool(workspace, 'read_workspace', { path: 'AGENTS.md' });
    stream = await client.beta.agents.sessions.create({ agent: { model: model(), instructions: `You are a guarded file assistant. These sources are explicitly loaded by the application, not discovered by the API: ${JSON.stringify({ rules: rules.result, skillResources: resources })}. The standalone helper is wrapped by calculate_revenue; use that function instead of its shell command. Its JSON informs the Markdown report. Only propose; only the human UI can apply changes.`, tools: guardedTools }, environment: { type: 'none' }, input: guardedPrompt, stream: true }, { signal: controller.signal, timeout: 125000 });
    const iterator = stream[Symbol.asyncIterator]();
    while (true) {
      const next = await boundedNext<IteratorResult<any>>(iterator.next(), controller.signal); if (next.done) break; const event: any = next.value; applyDelegationEvent(trace, event, Date.now());
      if (event.type === 'agent.session.requires_action' && trace.sessionId) {
        for (const action of event.session?.required_actions ?? []) {
          if (action.type !== 'function_call' || answered.has(action.call_id)) continue;
          if (answered.size >= 20) throw new Error('Tool-call budget reached'); answered.add(action.call_id);
          const outcome = await executeGuardTool(workspace, action.name, action.arguments);
          await client.beta.agents.sessions.events.create(trace.sessionId, { events: [{ type: 'agent.session.input.tool_result', call_id: action.call_id, turn_id: action.turn_id, success: outcome.success, ...(outcome.success ? { output: JSON.stringify(outcome.result) } : { error: JSON.stringify(outcome.result) }) }] }, { signal: controller.signal });
        }
      }
      if (['completed', 'failed', 'cancelled'].includes(trace.root)) break;
      if (['error', 'agent.session.failed'].includes(event.type)) throw new Error('Session failed');
    }
    if (trace.root === 'unknown') trace.error = 'Stream ended before root outcome';
  } catch { trace.error = controller.signal.aborted ? 'Stopped or deadline exceeded' : 'API proposal failed; inspect the tool audit and any pending proposal'; }
  finally {
    clearTimeout(timer); stream?.controller?.abort();
    if (trace.sessionId) {
      if (trace.root === 'unknown') { try { await client.beta.agents.sessions.events.create(trace.sessionId, { events: [{ type: 'agent.session.input.cancel' }] }); } catch { /* Remains unknown */ } }
      try { await client.beta.agents.sessions.delete(trace.sessionId); trace.cleanup = 'deleted'; } catch { trace.cleanup = 'failed'; }
    }
    workspace.busy = false;
  }
}
export async function handleLab38(request: IncomingMessage, response: ServerResponse, path: string) {
  if (!localExecutorRequest(request)) return send(response, 403, { error: 'Use same-origin localhost.' });
  if (path === '/api/lab38/status' && request.method === 'GET') return send(response, 200, { applicationKey: configured(), model: model() });
  if (path === '/api/lab38/resources' && request.method === 'GET') return send(response, 200, { files: await guardResources() });
  if (path === '/api/lab38/test' && request.method === 'POST') return send(response, 200, { results: runAdvancedSuite(38) });
  if (path === '/api/lab38/workspace' && request.method === 'GET') { const id = new URL(request.url!, 'http://localhost').searchParams.get('id'); const workspace = workspaces.get(id!); return send(response, workspace ? 200 : 404, workspace ? { workspace: redact(await guardView(workspace)), busy: workspace.busy } : { error: 'Workspace not found in this server process.' }); }
  if (request.method !== 'POST' || !['/api/lab38/create', '/api/lab38/propose', '/api/lab38/review', '/api/lab38/stop', '/api/lab38/cleanup', '/api/lab38/dispose'].includes(path)) return send(response, 404, { error: 'Route not found' });
  let value: any; try { value = await body(request, ['id', 'requestId', 'mode', 'decision', 'proposalId']); } catch { return send(response, 400, { error: 'Only fixed workspace actions are accepted.' }); }
  if (path.endsWith('/create')) {
    if (!requestId(value.requestId) || Object.keys(value).length !== 1) return send(response, 400, { error: 'Supply requestId only.' });
    const old = requests.get(value.requestId); if (old && workspaces.has(old)) return send(response, 200, { workspace: await guardView(workspaces.get(old)!) });
    if (workspaces.size >= 20 || requests.size >= 100) return send(response, 429, { error: 'Workspace retention limit reached; dispose old workspaces.' });
    // Reserve before awaiting creation so duplicate clicks cannot create orphan workspaces.
    if (old === 'creating') return send(response, 409, { error: 'Creation is already in progress; retry with the same ID.' });
    requests.set(value.requestId, 'creating');
    try { const workspace = await createGuardWorkspace(); workspaces.set(workspace.id, workspace); requests.set(value.requestId, workspace.id); return send(response, 201, { workspace: await guardView(workspace) }); } catch { requests.delete(value.requestId); return send(response, 502, { error: 'Workspace creation failed.' }); }
  }
  const workspace = workspaces.get(value.id); if (!workspace) return send(response, 404, { error: 'Workspace not found' });
  if (path.endsWith('/stop')) { runs.get(workspace.id)?.controller.abort(); return send(response, 202, { stopped: true }); }
  if (workspace.busy) return send(response, 409, { error: 'Wait for the current operation.' });
  try {
    if (path.endsWith('/review')) { if (!['approve', 'reject'].includes(value.decision) || typeof value.proposalId !== 'string') throw new Error('Supply proposalId and approve/reject'); await reviewGuardProposal(workspace, value.proposalId, value.decision); }
    else if (path.endsWith('/propose')) {
      if (workspace.proposal?.status === 'pending') throw new Error('Review the pending proposal first');
      if (workspace.trace?.cleanup === 'failed') throw new Error('Retry session cleanup first');
      if (value.mode === 'live') {
        if (!configured()) return send(response, 503, { error: 'Configure OPENAI_API_KEY and restart. The local broker exercise needs no key.' });
        const entry = { controller: new AbortController(), done: Promise.resolve() }; runs.set(workspace.id, entry); entry.done = liveProposal(workspace, entry.controller); return send(response, 202, { workspace: await guardView(workspace), busy: true });
      }
      if (!['practice', 'denied'].includes(value.mode)) throw new Error('Choose practice, denied or live');
      workspace.busy = true;
      try { workspace.source = 'local broker exercise (no model)'; await executeGuardTool(workspace, 'read_workspace', { path: 'AGENTS.md' }); await executeGuardTool(workspace, 'read_workspace', { path: '../protected.txt' }); if (value.mode === 'practice') { await executeGuardTool(workspace, 'calculate_revenue', {}); await executeGuardTool(workspace, 'propose_report', { content: guardedReport }); } } finally { workspace.busy = false; }
    } else if (path.endsWith('/cleanup')) {
      if (workspace.trace?.cleanup === 'failed' && workspace.trace.sessionId) { try { await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 0 }).beta.agents.sessions.delete(workspace.trace.sessionId); } catch (error) { if ((error as any).status !== 404) throw error; } workspace.trace.cleanup = 'deleted'; }
    } else if (path.endsWith('/dispose')) { if (workspace.trace?.cleanup === 'failed') throw new Error('Retry session cleanup first'); await disposeGuard(workspace); workspaces.delete(workspace.id); return send(response, 200, { disposed: true }); }
    return send(response, 200, { workspace: redact(await guardView(workspace)), busy: false });
  } catch (error) { return send(response, 409, { error: String((error as Error).message) }); }
}
export async function stopLab38() { for (const run of runs.values()) run.controller.abort(); await Promise.allSettled([...runs.values()].map(row => row.done)); await Promise.allSettled([...workspaces.values()].map(disposeGuard)); }
