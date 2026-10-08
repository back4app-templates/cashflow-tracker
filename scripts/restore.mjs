// File: scripts/restore.mjs · Node 22 · rebuilds a ledger from an export file into a backend (administrator, master key)
// Run setup.mjs on the target first (classes, CLPs, roles, config). Then:
//   node scripts/restore.mjs exports/export-....json [--env .env.target] [--force]
// Accounts and categories are recreated first, old ids are mapped to new ones, then transactions with remapped pointers.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, rest, args, batch, allOf, ptr, ROOT, ParseError } from './lib.mjs';

const a = args();
const file = a._[0];
if (!file) { console.error('usage: node scripts/restore.mjs <export.json> [--env .env.target] [--force]'); process.exit(2); }
const env = loadEnv(a.env ? path.resolve(ROOT, a.env) : undefined);
const data = JSON.parse(readFileSync(file, 'utf8'));

try {
  const existing = (await rest(env, 'GET', '/classes/Account?count=1&limit=0', undefined, { master: true })).count;
  if (existing && !a.force) { console.error(`Target already has ${existing} account(s). Use --force to replace its ledger.`); process.exit(2); }
  if (existing) {
    for (const cls of ['Transaction', 'Category', 'Account']) {
      const rows = await allOf(env, cls);
      if (rows.length) await batch(env, rows.map((r) => ({ method: 'DELETE', path: `/classes/${cls}/${r.objectId}` })), { reseed: true });
    }
  }
  const accounts = await batch(env, data.accounts.map((x) => ({ method: 'POST', path: '/classes/Account', body: { name: x.name, openingBalance: x.openingBalance, currency: x.currency || 'USD' } })));
  const categories = await batch(env, data.categories.map((x) => ({ method: 'POST', path: '/classes/Category', body: { name: x.name, color: x.color } })));
  const accMap = Object.fromEntries(data.accounts.map((x, i) => [x.id, accounts[i].objectId]));
  const catMap = Object.fromEntries(data.categories.map((x, i) => [x.id, categories[i].objectId]));
  const rows = data.transactions.map((t) => {
    const body = {
      type: t.type, description: t.description || '', amount: t.amount, accrualDate: t.accrualDate, dueDate: t.dueDate,
      paidDate: t.paidDate ?? null, contact: t.contact || '', notes: t.notes || '', account: ptr('Account', accMap[t.accountId]),
    };
    if (t.type === 'transfer') body.toAccount = ptr('Account', accMap[t.toAccountId]);
    else if (t.categoryId) body.category = ptr('Category', catMap[t.categoryId]);
    return { method: 'POST', path: '/classes/Transaction', body };
  });
  const created = await batch(env, rows);
  console.log(`restored ${accounts.length} accounts, ${categories.length} categories, ${created.length} transactions into ${env.appId.slice(0, 6)}… — run check.mjs against it to verify.`);
} catch (e) {
  if (e instanceof ParseError) console.error(`Parse error ${e.code ?? e.status}: ${e.message}`);
  else console.error(e);
  process.exit(1);
}
