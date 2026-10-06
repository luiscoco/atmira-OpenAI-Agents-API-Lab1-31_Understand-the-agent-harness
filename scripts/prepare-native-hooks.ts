import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
// Prepare a disposable project, without changing the user's runtime trust/configuration.
const root = join(import.meta.dirname, '..', '.lab-data', 'lab45-native-project');
await mkdir(join(root, '.codex'), { recursive: true });
await copyFile(join(import.meta.dirname, '..', 'sandbox', 'lab45', 'validate-report.mjs'), join(root, 'validate-report.mjs'));
const config = JSON.parse(await readFile(join(import.meta.dirname, '..', 'sandbox', 'lab45', 'project-hooks.json'), 'utf8'));
config.hooks.PostToolUse[0].hooks[0].command = 'node validate-report.mjs';
await writeFile(join(root, '.codex', 'hooks.json'), JSON.stringify(config, null, 2));
await writeFile(join(root, 'report.md'), '# Release report\nTotal: 2800\n', { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
await writeFile(join(root, 'README.md'), '# Native hook verification\n\nOpen this directory in a supported Codex runtime. Review /hooks, then ask it to edit report.md using apply_patch. Use Total: 2801 to observe failure and Total: 2800 to observe success. The ledger records session, turn and tool-call IDs without prompts or credentials. Preparation preserves an existing report and ledger.\n\nExport Codex app-server JSONL notifications including item/completed and hook/completed. From the course repository root, run:\n\n```powershell\nnode --import tsx scripts/verify-native-hooks.ts <notification-export.jsonl>\n```\n\nThe verifier correlates successful report edits with synchronous project hook completions and both validation outcomes, using IDs, exact config paths and timestamps. Its output is native-hook-review.json beside this file. Imported evidence is not authenticated proof: compare it with the original runtime and trusted hook definition. Direct script calls or a ledger alone cannot establish dispatch. No runtime trust settings are changed by preparation or verification.\n');
console.log(JSON.stringify({ project: root, status: 'prepared; native dispatch unverified', ledger: join(root, 'hook-invocations.jsonl') }));
