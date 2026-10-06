import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { evaluationDataset, evaluateDataset } from '../src/capstoneRules.ts';
const args = process.argv.slice(2); const option = (name: string) => args[args.indexOf(name) + 1];
const dataset = args.includes('--dataset') ? JSON.parse(await readFile(resolve(option('--dataset')), 'utf8')) : evaluationDataset;
const report = { before: evaluateDataset(dataset, 'baseline'), after: evaluateDataset(dataset, 'enforced') };
const path = resolve(args.includes('--out') ? option('--out') : '.lab-data/evaluation-report.json'); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.after.results.filter(row => row.outcome === 'pass').length}/${report.after.results.length} boundary cases passed; ${report.after.criteria.filter(row => row.outcome === 'unknown').length} criteria require other evidence. Report: ${path}`);
if (report.after.results.some(row => row.outcome === 'fail')) process.exitCode = 1;
