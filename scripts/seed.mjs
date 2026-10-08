// File: scripts/seed.mjs · Node 22
// Loads the fictitious dataset through the REST API with the master key. Every row passes the same
// beforeSave hooks the app uses, so the seed is also a validation run.
//   node scripts/seed.mjs [--reference-date 2026-09-30] [--size large] [--force] [--json data/demo.json]
// Refuses to touch a backend that already has accounts unless --force (which deletes transactions, categories and accounts first).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadEnv, rest, args, batch, allOf, ptr, ParseError } from './lib.mjs';

const require = createRequire(import.meta.url);
const { generate } = require('../cloud/generate.js');

const env = loadEnv();
const a = args();
const t0 = Date.now();

try {
  const existing = (await rest(env, 'GET', '/classes/Account?count=1&limit=0', undefined, { master: true })).count;
  if (existing && !a.force) {
    console.error(`This backend already has ${existing} account(s). Re-run with --force to replace all ledger data.`);
    process.exit(2);
  }
  if (existing) {
    for (const cls of ['Transaction', 'Category', 'Account']) {
      const rows = await allOf(env, cls);
      if (rows.length) await batch(env, rows.map((r) => ({ method: 'DELETE', path: `/classes/${cls}/${r.objectId}` })), { reseed: true });
      console.log(`deleted ${rows.length} ${cls}`);
    }
  }

  const referenceDate = a['reference-date'] || process.env.REFERENCE_DATE || new Date().toISOString().slice(0, 10);
  const data = a.json ? JSON.parse(readFileSync(a.json, 'utf8')) : generate({ referenceDate, size: a.size });

  const accounts = await batch(env, data.accounts.map((x) => ({ method: 'POST', path: '/classes/Account', body: x })));
  const categories = await batch(env, data.categories.map((x) => ({ method: 'POST', path: '/classes/Category', body: x })));
  const accId = Object.fromEntries(data.accounts.map((x, i) => [x.name, accounts[i].objectId]));
  const catId = Object.fromEntries(data.categories.map((x, i) => [x.name, categories[i].objectId]));

  const rows = data.transactions.map((t) => {
    const body = {
      type: t.type, description: t.description || '', amount: t.amount, accrualDate: t.accrualDate, dueDate: t.dueDate,
      paidDate: t.paidDate ?? null, contact: t.contact || '', notes: t.notes || '', account: ptr('Account', accId[t.account]),
    };
    if (t.type === 'transfer') body.toAccount = ptr('Account', accId[t.toAccount]);
    else if (t.category) body.category = ptr('Category', catId[t.category]);
    return { method: 'POST', path: '/classes/Transaction', body };
  });
  const created = await batch(env, rows);
  console.log(`seeded ${accounts.length} accounts, ${categories.length} categories, ${created.length} transactions (reference date ${data.referenceDate || referenceDate}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) {
  if (e instanceof ParseError) console.error(`Parse error ${e.code ?? e.status}: ${e.message}`);
  else console.error(e);
  process.exit(1);
}
