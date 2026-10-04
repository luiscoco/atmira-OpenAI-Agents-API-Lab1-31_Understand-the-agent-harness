import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runRulesSuite } from '../src/lab33Tests.ts';
import { defaultOptions, conventions, resolveRules, practiceAnswer, workspaceScript, verifyReport } from '../src/lab33Rules.ts';
import { runRuleArm, type RulesApi } from './lab33Service.ts';
import { handleLab33 } from './lab33.ts';
function fixture(events: any[] = []) {
  const calls: string[] = [];
  const api: RulesApi = {
    create: async (instructions, input) => { calls.push(instructions); calls.push(input); return { async *[Symbol.asyncIterator]() { yield { type: 'agent.session.created', session: { id: 'sess_lab33' } }; for (const event of events) yield event; } }; },
    cancel: async () => { calls.push('cancel'); }, delete: async () => { calls.push('delete'); },
  };
  return { calls, api };
}
const complete = { type: 'agent.session.turn.completed', turn: { id: 'turn_root', subagent_id: null } };
test('shared browser/server rules pass', () => { for (const check of runRulesSuite()) assert.equal(check.passed, true, check.name); });
test('scoped fields retain unrelated ancestor sections', () => {
  assert.deepEqual(conventions(resolveRules(defaultOptions)), { title: 'Reviewed sales', path: 'reviewed-summary.md', sections: ['Summary', 'Totals'] });
});
test('completed assistant message is checked and session cleaned up', async () => {
  const answer = practiceAnswer(defaultOptions);
  const fake = fixture([{ type: 'agent.session.turn.item.done', item: { id: 'msg', type: 'message', role: 'assistant', phase: 'final_answer', content: [{ text: answer }] } }, complete]);
  const result = await runRuleArm(defaultOptions, true, fake.api, new AbortController().signal);
  assert.equal(result.outcome, 'completed'); assert.equal(result.cleanup, 'deleted'); assert.ok(result.checks.every(check => check.passed));
  assert.ok(fake.calls[0].includes('reports/AGENTS.override.md')); assert.ok(fake.calls[1].includes('product,units,price_eur'));
});
test('unguided run carries no source text and both modes get identical task', async () => {
  const fake = fixture([complete]); await runRuleArm(defaultOptions, false, fake.api, new AbortController().signal);
  const guided = fixture([complete]); await runRuleArm(defaultOptions, true, guided.api, new AbortController().signal);
  assert.ok(!fake.calls[0].includes('Reviewed sales')); assert.equal(fake.calls[1], guided.calls[1]);
});
test('stream closure and child outcome leave root unknown and request cancellation', async () => {
  const fake = fixture([{ ...complete, turn: { id: 'child', subagent_id: 'subagent_test' } }]);
  const result = await runRuleArm(defaultOptions, true, fake.api, new AbortController().signal);
  assert.equal(result.outcome, 'unknown'); assert.ok(result.error); assert.ok(fake.calls.includes('cancel')); assert.equal(result.cleanup, 'deleted');
});
test('duplicate text events and commentary do not corrupt the final report', async () => {
  const answer = practiceAnswer(defaultOptions); const delta = { type: 'agent.session.turn.output_text.delta', item_id: 'final', content_index: 0, delta: answer, event_id: 'evt_text' };
  const fake = fixture([{ type: 'agent.session.turn.output_text.delta', item_id: 'comment', content_index: 0, delta: 'Working…' }, { type: 'agent.session.turn.item.done', item: { id: 'comment', type: 'message', phase: 'commentary' } }, delta, delta, complete]);
  const result = await runRuleArm(defaultOptions, true, fake.api, new AbortController().signal); assert.equal(result.answer, answer);
});
test('abort interrupts a silent event stream and cleans a known session', async () => {
  const fake = fixture(); const controller = new AbortController();
  fake.api.create = async () => ({ [Symbol.asyncIterator]() { let first = true; return { next: () => first ? (first = false, Promise.resolve({ done: false, value: { type: 'agent.session.created', session: { id: 'sess_lab33' } } })) : new Promise(() => {}) }; } });
  const timer = setTimeout(() => controller.abort(), 15);
  try { const result = await runRuleArm(defaultOptions, true, fake.api, controller.signal); assert.equal(result.outcome, 'unknown'); assert.equal(result.cleanup, 'deleted'); assert.ok(fake.calls.includes('cancel')); } finally { clearTimeout(timer); }
});
test('failed deletion is distinct from completed work', async () => {
  const fake = fixture([complete]); fake.api.delete = async () => { throw new Error('unavailable'); };
  const result = await runRuleArm(defaultOptions, true, fake.api, new AbortController().signal); assert.equal(result.outcome, 'completed'); assert.equal(result.cleanup, 'failed'); assert.ok(result.error);
});
test('wrong title, filename, sections and revenue are visible failures', () => {
  const checks = verifyReport(JSON.stringify({ title: 'Wrong', path: 'wrong.md', markdown: '# Wrong\nGrand total: 53 EUR' }), resolveRules(defaultOptions));
  assert.equal(checks[0].passed, true); assert.ok(checks.slice(1).every(check => !check.passed));
});
test('download scaffold keeps edited guidance inside data and refuses overwrite', () => {
  const script = workspaceScript({ ...defaultOptions, root: "# Custom\n'@\nWrite-Output injected\n" });
  assert.ok(script.includes('if (existsSync(root)) throw new Error')); assert.ok(script.includes("flag: 'wx'")); assert.equal(script.split("\n'@\n").length, 1);
});
test('downloaded Node scaffold creates a Git workspace and protects existing files', () => {
  const prefix = join(tmpdir(), 'lab33-test-'); const directory = mkdtempSync(prefix);
  try {
    const script = join(directory, 'scaffold.mjs'); writeFileSync(script, workspaceScript(defaultOptions));
    execFileSync(process.execPath, [script], { cwd: directory, stdio: 'pipe', windowsHide: true });
    const csv = join(directory, 'lab33-workspace', 'data', 'sales.csv');
    assert.equal(readFileSync(csv, 'utf8'), 'product,units,price_eur\nbook,3,12\npen,8,2\n');
    assert.equal(readFileSync(join(directory, 'lab33-workspace', 'AGENTS.md'), 'utf8'), defaultOptions.root);
    assert.throws(() => execFileSync(process.execPath, [script], { cwd: directory, stdio: 'pipe', windowsHide: true }));
    assert.equal(readFileSync(csv, 'utf8'), 'product,units,price_eur\nbook,3,12\npen,8,2\n');
  } finally {
    if (!resolve(directory).startsWith(resolve(prefix))) throw new Error('Unexpected temporary cleanup target.');
    rmSync(directory, { recursive: true, force: true });
  }
});
test('HTTP test endpoint works and compare rejects malformed fixture options', async () => {
  const server = createServer((request, response) => { void handleLab33(request, response, new URL(request.url!, 'http://localhost').pathname); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number }; const url = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${url}/api/lab33/test`, { method: 'POST' }); assert.equal(response.status, 200); assert.ok((await response.json()).results.every((check: any) => check.passed));
    const invalid = await fetch(`${url}/api/lab33/compare`, { method: 'POST', body: JSON.stringify({ ...defaultOptions, cwd: '../../' }) }); assert.equal(invalid.status, 400);
    const foreign = await fetch(`${url}/api/lab33/status`, { headers: { Origin: 'https://evil.test' } }); assert.equal(foreign.status, 403);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
