// File: scripts/export.mjs · Node 22 · the off-platform copy (administrator, master key)
// Writes accounts, categories and transactions — or a chosen in-backend Snapshot — to exports/<timestamp>.json.
//   node scripts/export.mjs [--snapshot <objectId>] [--out exports/file.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, rest, args, allOf, ROOT } from './lib.mjs';

const env = loadEnv();
const a = args();
const out = a.out || path.join(ROOT, 'exports', `export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
mkdirSync(path.dirname(out), { recursive: true });

let data;
if (a.snapshot) {
  const snap = await rest(env, 'GET', `/classes/Snapshot/${a.snapshot}`, undefined, { master: true });
  data = JSON.parse(snap.payload);
  data.fromSnapshot = { id: snap.objectId, createdAt: snap.createdAt, counts: snap.counts };
} else {
  const [accounts, categories, transactions] = await Promise.all([allOf(env, 'Account'), allOf(env, 'Category'), allOf(env, 'Transaction')]);
  const strip = (o) => { const { ACL, createdAt, updatedAt, ...rest } = o; return rest; };
  data = {
    exportedAt: new Date().toISOString(),
    accounts: accounts.map((x) => ({ id: x.objectId, name: x.name, openingBalance: x.openingBalance, currency: x.currency })),
    categories: categories.map((x) => ({ id: x.objectId, name: x.name, color: x.color })),
    transactions: transactions.map((x) => ({
      id: x.objectId, type: x.type, description: x.description || '', amount: x.amount, accrualDate: x.accrualDate, dueDate: x.dueDate,
      paidDate: x.paidDate ?? null, date: x.date, accountId: x.accountId, toAccountId: x.toAccountId ?? null, categoryId: x.categoryId ?? null,
      contact: x.contact || '', notes: x.notes || '',
    })),
  };
}
writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
console.log(`exported ${data.accounts.length} accounts, ${data.categories.length} categories, ${data.transactions.length} transactions → ${out}`);
