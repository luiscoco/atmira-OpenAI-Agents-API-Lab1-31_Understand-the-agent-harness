import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseEvidenceLines, reviewNativeHookEvidence } from '../src/nativeHookEvidence.ts';
const project = resolve('.lab-data/lab45-native-project');
const trace = resolve(process.argv[2] || join(project, 'runtime-notifications.jsonl'));
const missingInputs: string[] = [];
async function load(path: string, name: string) { try { return parseEvidenceLines(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; missingInputs.push(name); return []; } }
const result = reviewNativeHookEvidence(await load(join(project, 'hook-invocations.jsonl'), 'Hook ledger'), await load(trace, 'Codex app-server notification export'), join(project, '.codex/hooks.json'), join(project, 'report.md'));
const output = join(project, 'native-hook-review.json');
await writeFile(output, JSON.stringify({ recordedAt: new Date().toISOString(), missingInputs, ...result }, null, 2) + '\n');
console.log(JSON.stringify({ outcome: result.outcome, missingInputs, passObserved: result.passObserved, failureObserved: result.failureObserved, evidence: output, limitation: result.limitation }));
if (result.outcome !== 'consistent') process.exitCode = 1;
