import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
export function answer(message, inventory) {
  const result = value => ({ jsonrpc: '2.0', id: message.id, result: value });
  const error = (code, text) => ({ jsonrpc: '2.0', id: message.id ?? null, error: { code, message: text } });
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return error(-32600, 'Invalid request');
  if (message.id === undefined) return null;
  if (message.method === 'initialize') return result({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'private-course-inventory', version: '1.0.0' } });
  if (message.method === 'tools/list') return result({ tools: [{ name: 'get_inventory', description: 'Read the synthetic private course inventory.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } }] });
  if (message.method === 'tools/call') {
    if (message.params?.name !== 'get_inventory' || !message.params.arguments || typeof message.params.arguments !== 'object' || Array.isArray(message.params.arguments) || Object.keys(message.params.arguments).length) return error(-32602, 'Only get_inventory({}) is allowed');
    return result({ content: [{ type: 'text', text: JSON.stringify(inventory) }], structuredContent: inventory, isError: false });
  }
  if (message.method === 'ping') return result({});
  return error(-32601, 'Method not found');
}
export function startMcp(inventory, port = 8765) {
  const server = createServer(async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Allow': 'POST' }); response.end(body === null ? undefined : JSON.stringify(body)); };
    if (request.url !== '/mcp') return send(404, { error: 'Not found' });
    if (request.method !== 'POST') return send(405, { error: 'Use POST' });
    // Reject browser origins; the executor connection is server-to-server.
    if (request.headers.origin) return send(403, { error: 'Browser origins are not allowed' });
    try {
      let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 16000) throw new Error('Body limit'); }
      const message = JSON.parse(raw); if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Object required');
      const result = answer(message, inventory); send(result === null ? 202 : 200, result);
    } catch { send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid or oversized request' } }); }
  });
  server.listen(port, '127.0.0.1'); return server;
}
if (process.argv[1]?.endsWith('/mcp.mjs')) {
  const inventory = JSON.parse(readFileSync('/workspace/inventory.json', 'utf8'));
  startMcp(inventory);
}
