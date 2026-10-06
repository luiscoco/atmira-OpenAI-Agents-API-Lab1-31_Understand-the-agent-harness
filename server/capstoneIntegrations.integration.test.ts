import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { integrationConfiguration, researchPluginFiles, externalSources, reviewExternalFindings, nativeEvidence, mcpText } from './capstoneIntegrations.ts';
import { WorkspaceStore } from './capstoneStore.ts';
import { ResearchRunner, type ResearchApi } from './capstoneRunner.ts';
import { readZip, checkPlugin } from '../src/lab25Plugin.ts';
import { pluginAvailability } from '../src/lab25Reinforcement.ts';
import PluginReinforcement from '../src/PluginReinforcement.tsx';
const url = 'https://developers.openai.com/api/docs/guides/agents-api/tools/web-search';
const text = 'Built-in web search retrieves current documentation.';
function workspace() { const store = new WorkspaceStore(':memory:'); const user = store.register('test@example.test', 'course-password-123').user.id; const ws = store.createWorkspace(user, 'Integration'); const doc = store.upload(user, ws.id, 'source.md', text); const inv = store.createInvestigation(user, ws.id, 'Research'); return { store, user, ws, doc, inv }; }
test('Hosted configuration packages native skills, bounded MCP and owned files without application secrets', () => {
  const config = integrationConfiguration('hosted', [{ id: randomUUID(), name: 'source.md', content: text }]);
  assert.equal(config.environment.type, 'openai_hosted'); if (config.environment.type !== 'openai_hosted') return;
  const file = config.environment.files![0]; assert.equal(file.type, 'inline'); if (file.type !== 'inline') return; assert.equal(Buffer.from(file.data, 'base64').toString(), text); assert.ok(file.path.startsWith('/workspace/sources/'));
  const plugin = config.environment.plugins![0]; assert.ok(readZip(Buffer.from(plugin.source.data, 'base64')).some(entry => entry.path.endsWith('/skills/report-review/SKILL.md'))); assert.equal(checkPlugin(researchPluginFiles).findings.filter(row => row.level === 'error').length, 0);
  assert.ok(!JSON.stringify(config).includes('OPENAI_API_KEY')); const mcp = config.tools.find(tool => tool.type === 'mcp'); assert.equal(mcp?.connection_origin, 'service'); assert.deepEqual(mcp?.allowed_tools, ['search_openai_docs', 'fetch_openai_doc']);
});
test('External review rejects model-authored, failed-tool and nonofficial URLs; annotations do not verify quotes', () => {
  const sources = externalSources([{ id: 'failed', type: 'mcp_call', server_label: 'openai_docs', status: 'failed', output: url }, { id: 'answer', type: 'message', role: 'assistant', content: [{ text: url }] }, { id: 'annotation', type: 'message', role: 'assistant', content: [{ annotations: [{ type: 'url_citation', url }] }] }]);
  assert.equal(sources.length, 1); const result = reviewExternalFindings([{ claim: 'Current documentation', url, quote: text }, { claim: 'Private server', url: 'http://169.254.169.254', quote: text }], sources); assert.equal(result.accepted[0].quoteVerified, false); assert.equal(result.rejected.length, 1);
  const mcp = externalSources([{ id: 'mcp', type: 'mcp_call', server_label: 'openai_docs', status: 'completed', output: `${url}\n${text}` }]); assert.equal(reviewExternalFindings([{ claim: 'Supported', url, quote: text }], mcp).accepted[0].quoteVerified, true);
});
function adapter(docId: string, ready = true) {
  const log: string[] = [], items: any[] = [], turns: any[] = []; let run = 0;
  const api: ResearchApi = { create: async () => { log.push('created'); return { id: 'sess_test_hosted' }; }, inspect: async () => ({ items, turns }), ready: async () => true,
    stream: async () => { const root = `root-${++run}`; return { async *[Symbol.asyncIterator]() {
      if (ready) { log.push('ready'); yield { type: 'agent.session.environment.ready' }; } else { yield { type: 'agent.session.environment.failed' }; return; }
      yield { type: 'agent.session.turn.in_progress', turn: { id: root, subagent_id: null, status: 'in_progress' } };
      items.push({ id: `mcp-${run}`, turn_id: root, type: 'mcp_call', server_label: 'openai_docs', name: 'fetch_openai_doc', status: 'completed', output: `${url}\n${text}` });
      items.push({ id: `read-${run}`, turn_id: root, type: 'command_execution', status: 'completed', exit_code: 0, command: 'cat /workspace/plugins/research-workspace/skills/grounded-research/SKILL.md', output: 'Research skill' });
      items.push({ id: `message-${run}`, turn_id: root, type: 'message', role: 'assistant', content: [{ text: JSON.stringify({ findings: [{ claim: 'Source supports search', documentId: docId, quote: text }], externalFindings: [{ claim: 'Documentation supports search', url, quote: text }], limitations: [] }) }] });
      const turn = { id: root, subagent_id: null, status: 'completed' }; turns.push(turn); yield { type: 'agent.session.turn.completed', turn };
    } }; }, send: async (_id, events) => { log.push(events[0].type); }, remove: async () => {} };
  return { api, log, items };
}
test('Hosted runner waits for readiness, captures native and external evidence and retains staged fingerprint across follow-ups', async () => {
  const w = workspace(), mock = adapter(w.doc.id), runner = new ResearchRunner(w.store, () => mock.api);
  try {
    for (let index = 0; index < 2; index++) { const entry = w.store.createOperation(w.user, w.inv.id, randomUUID(), 'Research', 'live', { delegation: false, failure: false, profile: 'hosted' }); runner.start(w.user, entry.operation.id, false, false); await runner.jobs.get(entry.operation.id)!.done; const op = w.store.operation(w.user, entry.operation.id); assert.equal(op.status, 'completed'); assert.ok(op.evidence.stagedFingerprint); assert.equal(op.evidence.native.skillReads.length, 1); assert.equal(op.evidence.externalFindings[0].quoteVerified, true); assert.equal(op.evidence.externalSources.length, 1); }
    assert.ok(mock.log.indexOf('ready') < mock.log.indexOf('agent.session.input.message')); assert.equal(mock.log.filter(row => row === 'created').length, 1);
    w.store.upload(w.user, w.ws.id, 'new.md', 'Additional source content.'); assert.throws(() => w.store.createOperation(w.user, w.inv.id, randomUUID(), 'Research', 'live', { delegation: false, failure: false, profile: 'hosted' }), /sources changed/);
    assert.throws(() => w.store.createOperation(w.user, w.inv.id, randomUUID(), 'Research', 'live', { delegation: false, failure: false, profile: 'connected' }), /capabilities/);
  } finally { await runner.shutdown(); w.store.close(); }
});
test('Failed hosted readiness never submits a question', async () => {
  const w = workspace(), mock = adapter(w.doc.id, false), runner = new ResearchRunner(w.store, () => mock.api);
  try { const entry = w.store.createOperation(w.user, w.inv.id, randomUUID(), 'Research', 'live', { delegation: false, failure: false, profile: 'hosted' }); runner.start(w.user, entry.operation.id, false, false); await runner.jobs.get(entry.operation.id)!.done; assert.equal(w.store.operation(w.user, entry.operation.id).status, 'unknown'); assert.ok(!mock.log.includes('agent.session.input.message')); } finally { await runner.shutdown(); w.store.close(); }
});
test('Native evidence cannot be established by a failed skill command', () => { assert.equal(nativeEvidence([{ type: 'command_execution', status: 'failed', command: 'cat grounded-research/SKILL.md' }]).skillReads.length, 0); });
test('Structured MCP text preserves literal quotes and newlines for citation checks', () => { const output = { content: [{ type: 'text', text: `${url}\nThe user's report requires review.` }] }; assert.ok(mcpText(JSON.stringify(output)).includes("The user's report requires review.")); const sources = externalSources([{ type: 'mcp_call', id: 'mcp', server_label: 'openai_docs', status: 'completed', output }]); assert.equal(reviewExternalFindings([{ claim: 'Review required', url, quote: "The user's report requires review." }], sources).accepted[0].quoteVerified, true); });
test('Initial input completed before stream subscription is recovered without a second submission', async () => {
  const w = workspace(); let sent = 0, streams = 0;
  const api: ResearchApi = { create: async request => { assert.equal(request.input, 'Research'); return { id: 'sess_initial' }; }, inspect: async () => ({ turns: [{ id: 'initial', subagent_id: null, status: 'completed' }], items: [{ turn_id: 'initial', type: 'message', role: 'assistant', content: [{ text: JSON.stringify({ findings: [{ claim: 'Search supported', documentId: w.doc.id, quote: text }], limitations: ['Observed initial result'] }) }] }] }), stream: async () => { streams++; throw new Error('Should not subscribe after saved completion'); }, send: async () => { sent++; }, remove: async () => {} };
  const runner = new ResearchRunner(w.store, () => api);
  try { const entry = w.store.createOperation(w.user, w.inv.id, randomUUID(), 'Research', 'live'); runner.start(w.user, entry.operation.id, false, false); await runner.jobs.get(entry.operation.id)!.done; assert.equal(w.store.operation(w.user, entry.operation.id).status, 'completed'); assert.equal(sent, 0); assert.equal(streams, 0); } finally { await runner.shutdown(); w.store.close(); }
});
test('A broken stream reconnects within the original operation without another input', async () => {
  const w = workspace(); let subscriptions = 0, submissions = 0; const turns: any[] = [], items: any[] = [];
  const api: ResearchApi = { create: async request => { assert.equal(request.input, 'Research'); return { id: 'sess_reconnect' }; }, inspect: async () => ({ turns, items }), stream: async () => { const index = ++subscriptions; return { async *[Symbol.asyncIterator]() { if (index === 1) { turns.push({ id: 'root', subagent_id: null, status: 'in_progress' }); yield { type: 'agent.session.turn.in_progress', turn: turns[0] }; return; } items.push({ turn_id: 'root', type: 'message', role: 'assistant', content: [{ text: JSON.stringify({ findings: [{ claim: 'Search supported', documentId: w.doc.id, quote: text }] }) }] }); turns[0] = { ...turns[0], status: 'completed' }; yield { type: 'agent.session.turn.completed', turn: turns[0] }; } }; }, send: async () => { submissions++; }, remove: async () => {} };
  const runner = new ResearchRunner(w.store, () => api);
  try { const entry = w.store.createOperation(w.user, w.inv.id, randomUUID(), 'Research', 'live'); runner.start(w.user, entry.operation.id, false, false); await runner.jobs.get(entry.operation.id)!.done; const operation = w.store.operation(w.user, entry.operation.id); assert.equal(operation.status, 'completed'); assert.equal(operation.evidence.reconnects, 1); assert.equal(subscriptions, 2); assert.equal(submissions, 0); } finally { await runner.shutdown(); w.store.close(); }
});
test('Lab 25 comparison preserves skills and explicitly reports an unavailable MCP', () => {
  const files = [...researchPluginFiles, { path: '.mcp.json', text: JSON.stringify({ mcpServers: { openai_docs: { type: 'http', url: 'https://developers.openai.com/mcp' } } }) }].map(file => file.path === '.codex-plugin/plugin.json' ? { ...file, text: JSON.stringify({ ...JSON.parse(file.text), mcpServers: './.mcp.json' }) } : file);
  const result = pluginAvailability(files, { installed: [{ name: 'research-workspace', description: '' }], calls: [{ id: 'error', server: 'openai_docs', name: 'fetch_openai_doc', kind: 'tool', status: 'failed', turnId: 't', arguments: {}, output: null, isError: true, error: { code: null, message: 'unavailable' } }] }); assert.ok(result.skills.every(skill => skill.available)); assert.equal(result.servers[0].status, 'observed-failure'); assert.ok(renderToStaticMarkup(createElement(PluginReinforcement, { files })).includes('injected exercise'));
});
