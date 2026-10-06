import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
// Prepare a disposable project, without changing the user's runtime trust/configuration.
const root = join(import.meta.dirname, '..', '.lab-data', 'lab45-native-project');
await mkdir(join(root, '.codex'), { recursive: true });
await copyFile(join(import.meta.dirname, '..', 'sandbox', 'lab45', 'validate-report.mjs'), join(root, 'validate-report.mjs'));
const config = JSON.parse(await readFile(join(import.meta.dirname, '..', 'sandbox', 'lab45', 'project-hooks.json'), 'utf8'));
config.hooks.PostToolUse[0].hooks[0].command = 'node validate-report.mjs';
await writeFile(join(root, '.codex', 'hooks.json'), JSON.stringify(config, null, 2));
await writeFile(join(root, 'report.md'), '# Release report\nTotal: 2800\n');
await writeFile(join(root, 'README.md'), '# Native hook verification\n\nOpen this directory in a supported Codex runtime. Review /hooks, then ask it to edit report.md using apply_patch. Use Total: 2801 to observe failure and Total: 2800 to observe success. Inspect hook output and hook-invocations.jsonl. A direct script call does not establish native dispatch. Export the runtime trace beside the ledger.\n');
console.log(JSON.stringify({ project: root, status: 'prepared; native dispatch unverified', ledger: join(root, 'hook-invocations.jsonl') }));
