// File: scripts/check-concurrency.mjs · Node 22
// Demonstrates (does not hide) the races the hooks cannot close: duplicate names under parallel creates,
// a delete racing a create that references the record, and a double submit. Results are reported as observed.
//   node scripts/check-concurrency.mjs [--parallel 10]
import { loadEnv, rest, args, login, fn, readCredentials, allOf } from './lib.mjs';

const env = loadEnv();
const a = args();
const N = Number(a.parallel) || 10;
const creds = readCredentials();
const FIN_USER = process.env.FINANCE_USER || 'finance';
const session = await login(env, FIN_USER, process.env.FINANCE_PASSWORD || creds[FIN_USER]?.password);
const base = (await fn(env, 'base', {}, session)).result;
const op = base.accounts[0].id;
const stamp = Date.now();

console.log(`check-concurrency.mjs · ${N} parallel requests per case\n`);

// 1. duplicate names
let name = `ZZ race cat ${stamp}`;
let results = await Promise.all(Array.from({ length: N }, () => fn(env, 'createCategory', { name }, session)));
let created = results.filter((r) => r.ok);
console.log(`1. ${N} parallel createCategory("${name}")`);
console.log(`   ${created.length} succeeded, ${results.length - created.length} rejected (${[...new Set(results.filter((r) => !r.ok).map((r) => r.code))].join(',') || 'none'})`);
console.log(`   → ${created.length <= 1 ? 'no duplicate (unique index or lucky timing)' : `DUPLICATES: ${created.length} categories with the same name exist — hooks are validation, not a constraint`}`);
for (const r of created) await rest(env, 'DELETE', `/classes/Category/${r.result.id}`, undefined, { master: true }).catch(() => {});

// 2. delete vs create referencing the deleted account
const acc = await fn(env, 'createAccount', { name: `ZZ race acc ${stamp}` }, session);
const [del, ...creates] = await Promise.all([
  fn(env, 'deleteAccount', { id: acc.result.id }, session),
  ...Array.from({ length: N }, (_, i) => fn(env, 'createTransaction', { type: 'expense', amount: 100 + i, dueDate: base.today, accountId: acc.result.id, description: 'race' }, session)),
]);
const orphans = (await allOf(env, 'Transaction', { where: JSON.stringify({ accountId: acc.result.id }) }));
const stillThere = await rest(env, 'GET', `/classes/Account/${acc.result.id}`, undefined, { master: true }).then(() => true).catch(() => false);
console.log(`\n2. deleteAccount ∥ ${N} × createTransaction on that account`);
console.log(`   delete ${del.ok ? 'succeeded' : `rejected (${del.code}: ${del.error})`}; ${creates.filter((r) => r.ok).length} creates succeeded; account ${stillThere ? 'still exists' : 'is gone'}; ${orphans.length} transaction(s) reference it`);
console.log(`   → ${!stillThere && orphans.length ? `ORPHANS: ${orphans.length} transaction(s) point at a deleted account` : stillThere ? 'consistent: the account survived because a transaction won the race' : 'consistent: nothing references the deleted account'}`);
for (const t of orphans) await rest(env, 'DELETE', `/classes/Transaction/${t.objectId}`, undefined, { master: true }).catch(() => {});
if (stillThere) {
  for (const t of await allOf(env, 'Transaction', { where: JSON.stringify({ accountId: acc.result.id }) })) await rest(env, 'DELETE', `/classes/Transaction/${t.objectId}`, undefined, { master: true });
  await rest(env, 'DELETE', `/classes/Account/${acc.result.id}`, undefined, { master: true }).catch(() => {});
}

// 3. double submit of the same transaction (what a double-click or a retry does)
results = await Promise.all([1, 2].map(() => fn(env, 'createTransaction', { type: 'expense', amount: 4242, dueDate: base.today, accountId: op, description: `double submit ${stamp}` }, session)));
const twice = results.filter((r) => r.ok);
console.log(`\n3. the same createTransaction sent twice at once`);
console.log(`   ${twice.length} created → ${twice.length === 2 ? 'both stored: the API has no idempotency key; the UI disables the button while saving, nothing more' : 'one stored'}`);
for (const r of twice) await rest(env, 'DELETE', `/classes/Transaction/${r.result.id}`, undefined, { master: true }).catch(() => {});

// 4. the last-account rule needs an empty ledger; report instead of pretending
console.log(`\n4. parallel deletes of the last two accounts: not exercised here (the ledger has ${base.accounts.length} accounts). The same window as case 2 applies.`);
console.log('\nDone. Every observation above is expected behavior of validation hooks without transactions; see docs/api.md → Guarantees.');
