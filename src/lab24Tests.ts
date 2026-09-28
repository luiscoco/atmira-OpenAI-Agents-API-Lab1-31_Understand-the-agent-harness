// Lab 24: the test page. Every case runs the real functions (buildPrivateRequest, matchCredential, checkOneSource,
// findSecrets, redact, withSecret, rotationPlan, checkRevoke, judgeAuthRun) on fixed inputs: no network, no API key.
import type { McpCall } from './lab22Mcp.ts';
import {
  buildPrivateRequest, checkOneSource, checkRevoke, defaultAuthSettings, findSecrets, heldOnServer, judgeAuthRun, matchCredential, parseCredential, parseVault, redact, rotationPlan, withSecret,
  type AccessEntry, type AuthRun, type AuthSettings, type PublicCredential, type RotationState, type TokenInfo, type VaultView,
} from './lab24Vault.ts';

export type TestGroup = 'declare' | 'match' | 'secret' | 'rotate' | 'judge';
export type VaultTest = { id: string; label: string; group: TestGroup; expect: string; note: string; run: () => { got: string; detail: string } };
export type TestResult = { id: string; got: string; detail: string; pass: boolean };

const url = 'https://records.example.com/mcp';
const levelOf = (findings: Array<{ level: string }>) => (findings.some((item) => item.level === 'error') ? 'error' : findings.some((item) => item.level === 'warn') ? 'warn' : 'ok');
const cred = (patch: Partial<PublicCredential> = {}): PublicCredential => ({ id: 'credential_a', name: 'course_records bearer', vaultId: 'vault_1', type: 'static_bearer', serverUrl: url, expiresAt: null, refresh: false, createdAt: 1, updatedAt: 1, ...patch });
const vault = (credentials: PublicCredential[] = [cred()]): VaultView => ({ id: 'vault_1', name: 'Lab 24', metadata: { lab: '24' }, createdAt: 1, credentials });
const settings = (patch: Partial<AuthSettings> = {}): AuthSettings => ({ ...defaultAuthSettings, serverUrl: url, ...patch });
const declared = (patch: Partial<AuthSettings>, v: VaultView | null = vault()) => {
  const { request, findings } = buildPrivateRequest(settings(patch), v);
  const shape = !request ? 'no request' : request.vault_ids ? `vault${request.tool.credential_id ? ' + credential_id' : ''}` : request.tool.transport.authorization ? 'inline' : 'no credential';
  return { got: `${levelOf(findings)} · ${shape}`, detail: [JSON.stringify(request, null, 2), ...findings.map((item) => `${item.level}: ${item.text}`)].join('\n') };
};
const matched = (credentials: PublicCredential[], id: string | null = null, serverUrl = url) => {
  const result = matchCredential(credentials, serverUrl, id, Date.parse('2026-09-28T12:00:00Z'));
  return { got: result.credential ? `${result.credential.id}${result.auto ? ' (auto)' : ''}` : levelOf(result.findings), detail: result.findings.map((item) => `${item.level}: ${item.text}`).join('\n') };
};
const token = (version: number, state: TokenInfo['state']): TokenInfo => ({ version, fingerprint: `fp${version}`, state, createdAt: version, revokedAt: state === 'revoked' ? 9 : null });
const plan = (state: RotationState) => { const steps = rotationPlan(state); return { got: steps.map((step) => `${step.id}:${step.status}`).join(' '), detail: steps.map((step) => `${step.label}: ${step.text}`).join('\n') }; };
const entry = (status: number, tokenVersion: number | null, tool: string | null = null, reason = ''): AccessEntry => ({ at: 1, method: tool ? 'tools/call' : 'initialize', tool, status, tokenVersion, reason: reason || (tokenVersion ? `token v${tokenVersion}` : 'no Authorization header') });
const call = (name: string, patch: Partial<McpCall> = {}): McpCall => ({ id: `mcp_${name}`, server: 'course_records', name, status: 'completed', turnId: 't', arguments: {}, output: '{"labs":[]}', isError: false, error: null, kind: 'tool', ...patch });
const authRun = (patch: Partial<AuthRun>): AuthRun => ({ mode: 'vault', prompt: 'q', sessionId: 'sess_1', turnStatus: 'completed', calls: [], answer: '', error: null, access: [], redacted: 0, durationMs: 1, ...patch });
const judged = (run: AuthRun, expected: number | null = null) => { const verdict = judgeAuthRun(run, expected); return { got: verdict.outcome, detail: `${verdict.title}: ${verdict.text}` }; };
const secret = 'lab24_Q3v9xK2mZr8TtYwLp0aBcDeFgHiJ';

export const vaultTests: VaultTest[] = [
  { id: 'vault', label: 'Vault with one matching credential', group: 'declare', expect: 'ok · vault + credential_id', note: 'The default: vault_ids on the session, credential_id on the tool, no secret anywhere in the request.', run: () => declared({}) },
  { id: 'inline', label: 'Inline authorization', group: 'declare', expect: 'warn · inline', note: 'Works for one session. The browser sees the placeholder; the server adds the header last.', run: () => declared({ mode: 'inline' }) },
  { id: 'none', label: 'No credential', group: 'declare', expect: 'warn · no credential', note: 'Allowed so students can watch the private server answer 401.', run: () => declared({ mode: 'none' }) },
  { id: 'no-vault', label: 'Vault mode before the vault exists', group: 'declare', expect: 'error · no request', note: 'Create the vault and its credential first.', run: () => declared({}, null) },
  { id: 'saved-inline', label: 'A saved agent with inline authorization', group: 'declare', expect: 'error · no request', note: 'Live: agents.create answered 400 Unknown parameter tools[0].transport.authorization.', run: () => declared({ mode: 'inline', saveAsAgent: true }) },
  { id: 'saved-vault', label: 'A saved agent with a vault credential', group: 'declare', expect: 'ok · vault + credential_id', note: 'A declaration can name a credential. It never holds the secret.', run: () => declared({ saveAsAgent: true }) },
  { id: 'url-secret', label: 'A token in the query string', group: 'declare', expect: 'error · no request', note: 'Lab 22’s rule still applies: URLs end up in logs and saved sessions.', run: () => declared({ serverUrl: `${url}?token=abc123` }) },
  { id: 'local', label: 'A localhost URL', group: 'declare', expect: 'error · no request', note: 'OpenAI connects from its own network. Expose the private server with a tunnel.', run: () => declared({ serverUrl: 'https://localhost:5174/mcp' }) },
  { id: 'unknown-tool', label: 'An allowlist name the server does not have', group: 'declare', expect: 'error · no request', note: 'Lab 23: a name that matches nothing allows nothing, silently.', run: () => declared({ allowed: ['read_grades'] }) },
  { id: 'bypass-id', label: 'Send anyway preserves an invalid credential ID', group: 'declare', expect: 'cred_missing · vault_1', note: 'The API must see the original invalid ID rather than a fallback declaration with no vault.', run: () => { const { request } = buildPrivateRequest(settings({ credentialId: 'cred_missing' }), vault(), true); return { got: `${request?.tool.credential_id} · ${request?.vault_ids?.[0]}`, detail: JSON.stringify(request) }; } },
  { id: 'bypass-tools', label: 'Send anyway preserves an empty allowlist', group: 'declare', expect: '0 tools', note: 'A teaching bypass must not silently replace the list with every private tool.', run: () => { const { request } = buildPrivateRequest(settings({ allowed: [] }), vault(), true); return { got: `${request?.tool.allowed_tools.length} tools`, detail: JSON.stringify(request) }; } },
  { id: 'bypass-url', label: 'Send anyway still refuses a secret in the URL', group: 'declare', expect: 'no request', note: 'URL guards always apply, including in the teaching bypass.', run: () => { const { request, findings } = buildPrivateRequest(settings({ serverUrl: `${url}?token=abc123` }), vault(), true); return { got: request ? 'request' : 'no request', detail: findings.map((item) => item.text).join('\n') }; } },

  { id: 'auto', label: 'One credential for the URL', group: 'match', expect: 'credential_a (auto)', note: 'Live: the API selected it without credential_id, and the saved session named it.', run: () => matched([cred()]) },
  { id: 'slash', label: 'Only a trailing-slash variant', group: 'match', expect: 'error', note: 'Live: “…/mcp/” was stored as a separate URL and not selected for “…/mcp”.', run: () => matched([cred({ serverUrl: `${url}/` })]) },
  { id: 'two', label: 'Two credentials for the URL', group: 'match', expect: 'error', note: 'Ambiguous: set credential_id to choose.', run: () => matched([cred(), cred({ id: 'credential_b', name: 'backup' })]) },
  { id: 'two-chosen', label: 'Two credentials, credential_id set', group: 'match', expect: 'credential_b', note: 'credential_id resolves the ambiguity.', run: () => matched([cred(), cred({ id: 'credential_b', name: 'backup' })], 'credential_b') },
  { id: 'missing-id', label: 'credential_id not in the vault', group: 'match', expect: 'error', note: 'Live: 400 “was not found in an attached vault”.', run: () => matched([cred()], 'cred_doesnotexist') },
  { id: 'other-url', label: 'credential_id for another server', group: 'match', expect: 'error', note: 'Live: 400 “does not match server_url”.', run: () => matched([cred({ serverUrl: 'https://mcp.example.com/mcp' })], 'credential_a') },
  { id: 'env-var', label: 'An environment_variable credential', group: 'match', expect: 'error', note: 'That type is for OpenAI-hosted sandboxes, not MCP.', run: () => matched([cred({ type: 'environment_variable', serverUrl: null })], 'credential_a') },
  { id: 'expired', label: 'An expired OAuth token without refresh', group: 'match', expect: 'credential_a (auto)', note: 'Selected, with a warning to rotate it.', run: () => { const result = matchCredential([cred({ type: 'mcp_oauth', expiresAt: '2026-09-01T00:00:00Z' })], url, null, Date.parse('2026-09-28T12:00:00Z')); return { got: `${result.credential?.id} (auto)`, detail: result.findings.map((item) => `${item.level}: ${item.text}`).join('\n') }; } },
  { id: 'one-source', label: 'Inline and vault for the same URL', group: 'match', expect: 'error', note: 'Live: 400 “provide credentials in only one place”.', run: () => { const findings = checkOneSource({ tool: { transport: { type: 'http', server_url: url, authorization: heldOnServer } }, vault_ids: ['vault_1'] }, [cred()]); return { got: levelOf(findings), detail: findings.map((item) => item.text).join('\n') || 'no findings' }; } },

  { id: 'metadata', label: 'A credential as the API returns it', group: 'secret', expect: '0 secrets', note: 'Live: create, retrieve, update, and list returned auth.type and mcp_server_url only.', run: () => { const raw = { id: 'credential_a', object: 'vault.credential', vault_id: 'vault_1', name: 'x', auth: { type: 'static_bearer', mcp_server_url: url }, created_at: 1, updated_at: 2 }; const hits = findSecrets(raw); return { got: `${hits.length} secrets`, detail: JSON.stringify(parseCredential(raw), null, 2) }; } },
  { id: 'public-vault', label: 'Read the server’s metadata-only vault in the browser', group: 'secret', expect: 'credential_a · 0 secrets', note: 'The browser must accept the already-normalized credential returned by vault setup and state, without requiring an auth wrapper.', run: () => { const parsed = parseVault(vault()); return { got: `${parsed?.credentials[0]?.id} · ${findSecrets(parsed).length} secrets`, detail: JSON.stringify(parsed, null, 2) }; } },
  { id: 'public-oauth', label: 'Keep OAuth metadata across the server/browser boundary', group: 'secret', expect: '2026-10-01T00:00:00Z · true', note: 'Reading a normalized credential must preserve expiry and refresh facts while dropping secret fields.', run: () => { const parsed = parseCredential({ ...cred({ type: 'mcp_oauth', expiresAt: '2026-10-01T00:00:00Z', refresh: true }), token: 'not-for-the-browser' }); return { got: `${parsed.expiresAt} · ${parsed.refresh}`, detail: JSON.stringify(parsed, null, 2) }; } },
  { id: 'placeholder', label: 'The browser’s copy of an inline request', group: 'secret', expect: '0 secrets', note: 'The placeholder is not a secret: it is what the page shows instead.', run: () => { const hits = findSecrets({ transport: { authorization: heldOnServer } }); return { got: `${hits.length} secrets`, detail: heldOnServer }; } },
  { id: 'real-inline', label: 'The server’s copy of an inline request', group: 'secret', expect: '1 secrets', note: 'withSecret adds the real header. This object must only go to the SDK, never to a log or the browser.', run: () => { const tool = withSecret({ type: 'mcp', server_label: 'course_records', transport: { type: 'http', server_url: url, authorization: heldOnServer }, required: true, connection_origin: 'service', allowed_tools: ['list_my_labs'] }, secret); const hits = findSecrets(tool, [secret]); return { got: `${hits.length} secrets`, detail: hits.map((hit) => `${hit.path}: ${hit.reason}`).join('\n') }; } },
  { id: 'nested', label: 'A token hidden in a log line', group: 'secret', expect: '1 secrets', note: 'Known values are found anywhere, even inside text.', run: () => { const hits = findSecrets({ log: [{ note: `retrying with ${secret}` }] }, [secret]); return { got: `${hits.length} secrets`, detail: hits.map((hit) => `${hit.path}: ${hit.reason}`).join('\n') }; } },
  { id: 'redact', label: 'Redact every copy', group: 'secret', expect: '2 · «redacted»', note: 'The leak guard replaces each copy before a line leaves the server.', run: () => { const out = redact(`a ${secret} b ${secret}`, [secret]); return { got: `${out.count} · ${out.text.includes('«redacted»') && !out.text.includes(secret) ? '«redacted»' : 'leaked'}`, detail: out.text }; } },

  { id: 'start', label: 'Before a rotation', group: 'rotate', expect: 'mint:next update:waiting verify:waiting revoke:waiting', note: 'The vault holds v1; issue v2 first.', run: () => plan({ tokens: [token(1, 'active')], vaultVersion: 1, verifiedVersion: 1 }) },
  { id: 'minted', label: 'New token issued, vault not updated', group: 'rotate', expect: 'mint:done update:next verify:waiting revoke:blocked', note: 'Revoking now would break every new vault session.', run: () => plan({ tokens: [token(1, 'retiring'), token(2, 'active')], vaultVersion: 1, verifiedVersion: 1 }) },
  { id: 'early-revoke', label: 'Revoke before the vault is updated', group: 'rotate', expect: 'error', note: 'The server refuses unless you force it, to show the 401 that follows.', run: () => { const findings = checkRevoke({ tokens: [token(1, 'retiring'), token(2, 'active')], vaultVersion: 1, verifiedVersion: 1 }); return { got: levelOf(findings), detail: findings[0].text }; } },
  { id: 'verified', label: 'Vault updated and proven', group: 'rotate', expect: 'mint:done update:done verify:done revoke:next', note: 'Now the old token can go.', run: () => plan({ tokens: [token(1, 'retiring'), token(2, 'active')], vaultVersion: 2, verifiedVersion: 2 }) },

  { id: 'ok', label: 'Tool calls with the active token', group: 'judge', expect: 'authenticated', note: 'The evidence is the server’s access log, not the answer.', run: () => judged(authRun({ calls: [call('list_my_labs')], access: [entry(200, 2), entry(200, 2, 'list_my_labs')] }), 2) },
  { id: '401', label: 'No credential', group: 'judge', expect: 'unauthorized', note: 'The private server logged 401 and no call succeeded.', run: () => judged(authRun({ mode: 'none', turnStatus: 'failed', error: 'MCP server initialization failed', access: [entry(401, null)] })) },
  { id: 'refused', label: 'The API refused the request', group: 'judge', expect: 'refused', note: 'A 400 before any session: nothing reached the private server.', run: () => judged(authRun({ sessionId: null, turnStatus: 'failed', error: '400 provide credentials in only one place' })) },
  { id: 'stale', label: 'Served with the old token', group: 'judge', expect: 'stale', note: 'After a rotation the server saw v1, not v2.', run: () => judged(authRun({ calls: [call('list_my_labs')], access: [entry(200, 1, 'list_my_labs')] }), 2) },
  { id: 'handshake-new-call-old', label: 'New token handshake, old token tool call', group: 'judge', expect: 'stale', note: 'A handshake with v2 does not prove that a tool call used v2.', run: () => judged(authRun({ calls: [call('list_my_labs')], access: [entry(200, 2), entry(200, 1, 'list_my_labs')] }), 2) },
  { id: 'missing-call-log', label: 'API result without a matching server call', group: 'judge', expect: 'failed', note: 'A rotation is proved by an authenticated tool call in the server log.', run: () => judged(authRun({ calls: [call('list_my_labs')], access: [entry(200, 2)] }), 2) },
  { id: 'unused', label: 'Connected, no tool called', group: 'judge', expect: 'unused', note: 'The handshake succeeded, but no private data was read.', run: () => judged(authRun({ access: [entry(200, 2)] })) },
  { id: 'leak', label: 'The guard had to redact', group: 'judge', expect: 'leak', note: 'Any redaction is a finding, even when the run worked.', run: () => judged(authRun({ calls: [call('list_my_labs')], access: [entry(200, 2, 'list_my_labs')], redacted: 1 })) },
];

export function runVaultTest(item: VaultTest): TestResult {
  try {
    const { got, detail } = item.run();
    return { id: item.id, got, detail, pass: got === item.expect };
  } catch (error) {
    return { id: item.id, got: 'crashed', detail: error instanceof Error ? error.message : String(error), pass: false };
  }
}

export const runVaultSuite = () => vaultTests.map(runVaultTest);
