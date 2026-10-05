import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 16000) throw new Error('Hook input limit'); }
const event = JSON.parse(input || '{}');
if (event.hook_event_name !== 'PostToolUse' || !['apply_patch', 'Edit', 'Write'].includes(event.tool_name)) { console.log(JSON.stringify({ source: 'validation-command', skipped: true })); process.exit(0); }
const fixture = process.argv.indexOf('--fixture');
const text = fixture >= 0 ? (process.argv[fixture + 1] === 'pass' ? '# Release report\nTotal: 2800\n' : '# Release report\nTotal: 2801\n') : await readFile(resolve(event.cwd || process.cwd(), 'report.md'), 'utf8').catch(() => '');
const passed = text.startsWith('# Release report\n') && /^Total: 2800$/m.test(text);
console.log(JSON.stringify(passed ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Report validation passed: header and total.' } } : { decision: 'block', reason: 'Report must contain the Release report header and Total: 2800. PostToolUse cannot undo the preceding edit.' }));
process.exitCode = passed ? 0 : 2;
