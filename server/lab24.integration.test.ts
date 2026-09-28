import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { handleMcp, currentToken, mintToken, revokeRetiring, allTokenValues } from './lab24Mcp.ts';
import { itemsLab24, stateLab24, testLab24 } from './lab24.ts';
import { runVaultSuite } from '../src/lab24Tests.ts';
import { parseVault } from '../src/lab24Vault.ts';

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const handler = path === '/state' ? stateLab24 : path === '/test' ? testLab24 : path === '/items' ? itemsLab24 : handleMcp;
  Promise.resolve(handler(request, response)).catch(() => { response.writeHead(500); response.end(); });
});
let base: string;
before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});
after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
const rpc = (method: string, params?: unknown) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) });
const post = (body: string, token?: string) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body });

test('browser rules and HTTP test endpoint pass the same suite', async () => {
  const local = runVaultSuite();
  assert.equal(local.filter((item) => !item.pass).length, 0);
  const response = await fetch(`${base}/test`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results, local);
});

test('missing and unknown tokens get a challenge without private data', async () => {
  for (const token of [undefined, 'unknown-token-for-test']) {
    const response = await post(rpc('tools/list'), token);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate') ?? '', /^Bearer /);
    assert.equal((await response.json()).error.message, 'Unauthorized');
  }
});

test('malformed JSON and non-object bodies return 400 rather than crash', async () => {
  for (const body of ['{', 'null', '[]', '123', '"text"']) {
    const response = await post(body, currentToken()!.value);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, -32700);
  }
  const response = await post('{"id":1,"method":"tools/list"}', currentToken()!.value);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, -32600);
});

test('authenticated discovery, notification and lookup do not expose a token', async () => {
  const token = currentToken()!.value;
  const list = await post(rpc('tools/list'), token);
  assert.deepEqual((await list.json()).result.tools.map((item: { name: string }) => item.name), ['list_my_labs', 'get_lab_feedback']);
  const notification = await post('{"jsonrpc":"2.0","method":"notifications/initialized"}', token);
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');
  const lookup = await post(rpc('tools/call', { name: 'get_lab_feedback', arguments: { lab: 20 } }), token);
  const raw = await lookup.text();
  assert.equal(allTokenValues().some((value) => raw.includes(value)), false);
  assert.equal(JSON.parse(raw).result.structuredContent.lab, 20);
});

test('tool schemas reject extra fields, arrays and invalid lab numbers', async () => {
  for (const args of [{ lab: 20, token: 'unexpected' }, [], null]) {
    const response = await post(rpc('tools/call', { name: 'get_lab_feedback', arguments: args }), currentToken()!.value);
    assert.equal((await response.json()).error.code, -32602);
  }
  for (const lab of [0, 51, 20.5, '20']) {
    const response = await post(rpc('tools/call', { name: 'get_lab_feedback', arguments: { lab } }), currentToken()!.value);
    assert.equal((await response.json()).result.isError, true);
  }
});

test('rotation overlaps credentials and rejects the old token after revocation', async () => {
  const old = currentToken()!.value;
  mintToken();
  const fresh = currentToken()!.value;
  assert.equal((await post(rpc('tools/list'), old)).status, 200);
  assert.equal((await post(rpc('tools/list'), fresh)).status, 200);
  revokeRetiring();
  assert.equal((await post(rpc('tools/list'), old)).status, 401);
  assert.equal((await post(rpc('tools/list'), fresh)).status, 200);
});

test('failed vault discovery retries and credentials are read across pages', async () => {
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only-not-a-real-key';
  const realFetch = globalThis.fetch;
  let attempts = 0;
  let pages = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'api.openai.com') return realFetch(input, init);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/v1/vaults') {
      attempts += 1;
      return attempts === 1 ? json({ error: { message: 'Temporary lookup failure', type: 'test' } }, 401) : json({ data: [{ id: 'vault_test', metadata: { course: 'agents-api-labs', lab: '24' } }], has_more: false });
    }
    if (url.pathname.endsWith('/credentials')) {
      pages += 1;
      const id = url.searchParams.get('after') ? 'credential_second' : 'credential_first';
      return json({ data: [{ id, vault_id: 'vault_test', auth: { type: 'static_bearer', mcp_server_url: 'https://example.com/mcp' } }], has_more: id === 'credential_first' });
    }
    return json({ id: 'vault_test', name: 'Lab 24', metadata: { course: 'agents-api-labs', lab: '24' }, created_at: 1 });
  };
  try {
    const failed = await (await realFetch(`${base}/state`)).json();
    assert.match(failed.vaultError, /Temporary lookup failure/);
    const recovered = await (await realFetch(`${base}/state`)).json();
    assert.equal(recovered.vaultError, null);
    assert.equal(recovered.vault.credentials.length, 2);
    // Exercise the exact browser parser on the actual HTTP metadata response.
    assert.equal(parseVault(recovered.vault)?.credentials.length, 2);
    assert.equal(attempts, 2);
    assert.equal(pages, 2);
  } finally {
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
  }
});

test('saved-item replies redact even revoked token values', async () => {
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only-not-a-real-key';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'api.openai.com') return realFetch(input, init);
    return new Response(JSON.stringify({ data: [{ id: 'msg_test', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: allTokenValues()[0] }] }], has_more: false }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const response = await realFetch(`${base}/items?sessionId=sess_test`);
    const raw = await response.text();
    assert.equal(response.status, 200);
    assert.equal(allTokenValues().some((value) => raw.includes(value)), false);
    assert.equal(JSON.parse(raw).items[0].text, '«redacted»');
  } finally {
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
  }
});
