import { readFileSync } from 'node:fs';
const [csvPath, markerPath] = process.argv.slice(2);
if (!csvPath || !markerPath || process.argv.length !== 4) throw new Error('Supply CSV and run-marker paths.');
const lines = readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
if (lines.shift() !== 'product,units,price_cents' || !lines.length) throw new Error('Invalid sales CSV header or empty data.');
let total = 0n;
for (const line of lines) {
  const cells = line.split(',');
  if (cells.length !== 3 || !cells[0] || !/^\d+$/.test(cells[1]) || !/^\d+$/.test(cells[2])) throw new Error('Invalid sales row.');
  total += BigInt(cells[1]) * BigInt(cells[2]);
}
if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Total exceeds safe JSON integer range.');
const marker = readFileSync(markerPath, 'utf8').trim();
if (!/^[a-f0-9]{16}$/.test(marker)) throw new Error('Invalid run marker.');
console.log(JSON.stringify({ total_cents: Number(total), currency: 'EUR', source: 'data/sales.csv', marker }));
