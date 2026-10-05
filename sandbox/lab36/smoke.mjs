import assert from 'node:assert/strict';
import { startMcp } from './mcp.mjs';
const inventory = { marker: '0123456789abcdef', item: 'course-notebook', quantity: 7 };
const server = startMcp(inventory, 0);
await new Promise(resolve => server.once('listening', resolve));
const address = server.address();
assert.equal(address.address, '127.0.0.1');
const url = `http://127.0.0.1:${address.port}/mcp`;
async function rpc(method, params = {}) { const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }) }); assert.equal(response.status, 200); return response.json(); }
try {
  assert.equal((await rpc('initialize')).result.serverInfo.name, 'private-course-inventory');
  assert.deepEqual((await rpc('tools/list')).result.tools.map(tool => tool.name), ['get_inventory']);
  const result = await rpc('tools/call', { name: 'get_inventory', arguments: {} }); assert.deepEqual(result.result.structuredContent, inventory);
  assert.ok((await rpc('tools/call', { name: 'delete_inventory', arguments: {} })).error);
  assert.ok((await rpc('tools/call', { name: 'get_inventory', arguments: { path: '../private' } })).error);
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'https://external.test' }, body: '{}' })).status, 403);
  console.log(JSON.stringify({ source: 'actual local MCP HTTP smoke test', uid: process.getuid(), bind: address.address, inventory, checks: 6 }));
} finally { await new Promise(resolve => server.close(resolve)); }
