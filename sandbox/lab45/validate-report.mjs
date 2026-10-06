import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 16000) throw new Error('Hook input limit'); }
const event = JSON.parse(input || '{}');
if (event.hook_event_name !== 'PostToolUse' || !['apply_patch', 'Edit', 'Write'].includes(event.tool_name)) { console.log(JSON.stringify({ source: 'validation-command', skipped: true })); process.exit(0); }
const fixture = process.argv.indexOf('--fixture');
const text = fixture >= 0 ? (process.argv[fixture + 1] === 'pass' ? '# Release report\nTotal: 2800\n' : '# Release report\nTotal: 2801\n') : await readFile(resolve(event.cwd || process.cwd(), 'report.md'), 'utf8').catch(() => '');
const passed = text.startsWith('# Release report\n') && /^Total: 2800$/m.test(text);
// Keep local dispatch evidence beside this validator, never at a path supplied by hook input.
// The ledger alone is not proof: compare it with the actual Codex lifecycle trace.
if (fixture < 0) await appendFile(new URL('./hook-invocations.jsonl', import.meta.url), JSON.stringify({ recordedAt: new Date().toISOString(), event: event.hook_event_name, tool: event.tool_name, sessionId: typeof event.session_id === 'string' ? event.session_id : null, turnId: typeof event.turn_id === 'string' ? event.turn_id : null, toolUseId: typeof event.tool_use_id === 'string' ? event.tool_use_id : null, passed, source: 'hook stdin; corroborate with native runtime trace' }) + '\n');
console.log(JSON.stringify(passed ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Report validation passed: header and total.' } } : { decision: 'block', reason: 'Report must contain the Release report header and Total: 2800. PostToolUse cannot undo the preceding edit.' }));
process.exitCode = passed ? 0 : 2;
