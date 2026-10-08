// File: scripts/generate-demo-data.mjs · Node 22
// Prints (or writes) the deterministic fictitious dataset. Same generator the demo backend's reseed job uses.
//   node scripts/generate-demo-data.mjs --reference-date 2026-09-30 [--size large] [--out data/demo.json]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { args } from './lib.mjs';

const require = createRequire(import.meta.url);
const { generate } = require('../cloud/generate.js');

const a = args();
const referenceDate = a['reference-date'] || process.env.REFERENCE_DATE || new Date().toISOString().slice(0, 10);
const data = generate({ referenceDate, size: a.size, perDay: a['per-day'] ? Number(a['per-day']) : undefined });
const json = JSON.stringify(data, null, a.compact ? 0 : 2);
if (a.out) {
  writeFileSync(a.out, json + '\n');
  console.log(`Wrote ${a.out}: ${data.accounts.length} accounts, ${data.categories.length} categories, ${data.transactions.length} transactions (reference date ${referenceDate}).`);
} else {
  process.stdout.write(json + '\n');
}
