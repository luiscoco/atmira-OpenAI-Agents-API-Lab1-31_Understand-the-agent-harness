import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runAdvancedSuite } from '../src/advancedLabTests.ts';
import { privateMcpImage, privateMcpPractice, inventoryPrompt, verifyPrivateMcp } from '../src/lab36Mcp.ts';
import { createExecutorJob, executeListing, type ExecutorApi } from './lab32Service.ts';
import { executorArgs, type ExecutorProvider } from './lab32Docker.ts';
import { handleLab36 } from './lab36.ts';
test('shared Lab 36 suite passes', () => { for (const row of runAdvancedSuite(36)) assert.ok(row.passed, row.name); });
test('private MCP image has no published port, bind mount or host network', () => {
  const job = createExecutorJob('test', 36); const args = executorArgs({ name: job.containerName, nonce: job.trace.nonce, environmentId: 'env_test', remoteUrl: 'https://api.openai.com/v1/agents/api' }, 36, privateMcpImage);
  assert.ok(args.includes('agents.course.lab=36')); assert.ok(args.includes(privateMcpImage)); for (const option of ['-p', '--publish', '--mount', '--volume', '--network']) assert.ok(!args.includes(option));
});
test('MCP evidence is captured by the lifecycle observer and cleanup is independent', async () => {
  const practice = privateMcpPractice('success'); const job = { ...createExecutorJob('test', 36), origin: 'environment', mcpCalls: [] as any[] }; job.trace.nonce = practice.trace.nonce; let inputs = 0;
  const api: ExecutorApi = { create: async () => ({ id: 'sess_test', environment: { type: 'self_hosted', id: 'env_test', remote_url: 'https://api.openai.com/v1/agents/api' } }), stream: async () => ({ async *[Symbol.asyncIterator]() { yield { type: 'agent.session.environment.connected' }; yield { type: 'agent.session.turn.item.done', item: practice.mcpCalls[0] }; yield { type: 'agent.session.turn.output_text.done', item_id: 'answer', content_index: 0, text: practice.trace.answer }; yield { type: 'agent.session.turn.completed', turn: { subagent_id: null } }; } }), input: async (_id, prompt) => { inputs++; assert.equal(prompt, inventoryPrompt); }, cancel: async () => {}, delete: async () => {} };
  const provider: ExecutorProvider = { preflight: async () => {}, start: async () => {}, remove: async () => {} };
  await executeListing(job, api, provider, new AbortController(), undefined, () => inventoryPrompt, event => { if (event.item?.type === 'mcp_call') job.mcpCalls.push(event.item); }); assert.equal(inputs, 1); assert.ok(verifyPrivateMcp(job).every(row => row.passed));
});
test('actual MCP HTTP implementation initializes, lists and serves only its fixed tool', async () => {
  const { startMcp } = await import('../sandbox/lab36/mcp.mjs'); const inventory = { marker: '0123456789abcdef', item: 'course-notebook', quantity: 7 }; const server = startMcp(inventory, 0); await new Promise<void>(resolve => server.once('listening', resolve)); const address = server.address() as any; assert.equal(address.address, '127.0.0.1'); const url = `http://127.0.0.1:${address.port}/mcp`;
  async function rpc(method: string, params: any = {}) { return (await fetch(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json(); }
  try { assert.equal((await rpc('initialize')).result.protocolVersion, '2025-06-18'); assert.equal((await rpc('tools/list')).result.tools.length, 1); assert.deepEqual((await rpc('tools/call', { name: 'get_inventory', arguments: {} })).result.structuredContent, inventory); assert.ok((await rpc('tools/call', { name: 'get_inventory', arguments: { path: 'arbitrary' } })).error); assert.ok((await rpc('tools/call', { name: 'write_inventory', arguments: {} })).error); assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'https://external.test' }, body: '{}' })).status, 403); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('Lab 36 offline routes reject arbitrary endpoint overrides and foreign origins', async () => {
  const server = createServer((request, response) => { void handleLab36(request, response, new URL(request.url!, 'http://localhost').pathname); }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try { assert.equal((await fetch(`${base}/api/lab36/status`)).status, 200); assert.ok((await (await fetch(`${base}/api/lab36/test`, { method: 'POST' })).json()).results.every((row: any) => row.passed)); assert.equal((await fetch(`${base}/api/lab36/run`, { method: 'POST', body: JSON.stringify({ requestId: 'a'.repeat(20), origin: 'environment', server_url: 'https://external.test' }) })).status, 400); assert.equal((await fetch(`${base}/api/lab36/status`, { headers: { Origin: 'https://external.test' } })).status, 403); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
