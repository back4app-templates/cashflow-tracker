// File: scripts/check.mjs · Node 22
// Verifies the live backend against numbers computed independently from the same fictitious dataset:
// balances, month lists, running balances, reports under both bases, pending/overdue counts, and every
// business rule. Run after `npm run setup`, Cloud Code deploy and `npm run seed --reference-date <date>`.
//   node scripts/check.mjs [--reference-date 2026-09-30] [--size large]
// The backend's Config.referenceDate must equal --reference-date (setup.mjs --reference-date sets it).
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadEnv, rest, args, login, fn, readCredentials, fmt, ROOT } from './lib.mjs';

const require = createRequire(import.meta.url);
const { generate } = require('../cloud/generate.js');

const a = args();
const env = loadEnv(a.env ? path.resolve(ROOT, a.env) : undefined);
const REF = a['reference-date'] || process.env.REFERENCE_DATE || '2026-09-30';
const creds = readCredentials();
const FIN_USER = process.env.FINANCE_USER || 'finance';
const FIN_PASS = process.env.FINANCE_PASSWORD || creds[FIN_USER]?.password;
if (!FIN_PASS) { console.error('No finance password: set FINANCE_PASSWORD or run setup.mjs first.'); process.exit(1); }

let pass = 0, failed = 0;
const ok = (cond, label, detail = '') => { if (cond) { pass++; console.log(`  PASS  ${label}`); } else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); } };
const eq = (x, y, label) => ok(x === y, label, x !== y ? `got ${JSON.stringify(x)}, expected ${JSON.stringify(y)}` : '');
const must = async (p, code, label) => { const r = await p; ok(!r.ok && r.code === code, label, r.ok ? 'succeeded unexpectedly' : `code ${r.code}: ${r.error}`); return r; };

// ---------------------------------------------------------------- expected values from the JSON

const data = generate({ referenceDate: REF, size: a.size });
const tx = data.transactions;
const effect = (t, acc) => {
  if (acc == null) return t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0;
  if (t.type === 'income') return t.account === acc ? t.amount : 0;
  if (t.type === 'expense') return t.account === acc ? -t.amount : 0;
  return (t.account === acc ? -t.amount : 0) + (t.toAccount === acc ? t.amount : 0);
};
const opening = (acc) => (acc ? data.accounts.find((x) => x.name === acc).openingBalance : data.accounts.reduce((s, x) => s + x.openingBalance, 0));
const dateOf = (t) => t.paidDate || t.dueDate;
const realizedBefore = (day, acc) => opening(acc) + tx.filter((t) => t.paidDate && t.paidDate < day).reduce((s, t) => s + effect(t, acc), 0);
const projectedBefore = (day, acc) => opening(acc) + tx.filter((t) => dateOf(t) < day).reduce((s, t) => s + effect(t, acc), 0);
const months = [...new Set(tx.map((t) => dateOf(t).slice(0, 7)))].sort();
const nextMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

// ---------------------------------------------------------------- run

const session = await login(env, FIN_USER, FIN_PASS);
console.log(`check.mjs · reference date ${REF} · ${tx.length} transactions in the dataset${a.size ? ` (size ${a.size})` : ''}\n`);

console.log('base');
const base = (await fn(env, 'base', {}, session));
ok(base.ok, 'base() answers', base.error);
const B = base.result;
eq(B.today, REF, 'backend "today" equals the reference date (Config.referenceDate)');
eq(B.accounts.length, data.accounts.length, 'account count');
eq(B.categories.length, data.categories.length, 'category count');
const accId = Object.fromEntries(B.accounts.map((x) => [x.name, x.id]));
const accName = Object.fromEntries(B.accounts.map((x) => [x.id, x.name]));
for (const acc of B.accounts) eq(acc.currentBalance, realizedBefore('9999-12-31', acc.name), `current balance · ${acc.name} = ${fmt(acc.currentBalance)}`);
const usesByAcc = {};
for (const t of tx) { usesByAcc[t.account] = (usesByAcc[t.account] || 0) + 1; if (t.toAccount) usesByAcc[t.toAccount] = (usesByAcc[t.toAccount] || 0) + 1; }
for (const acc of B.accounts) eq(acc.uses, usesByAcc[acc.name] || 0, `uses · ${acc.name}`);

console.log('\nlistMonth · previous balances, rows, running balances');
const refMonth = REF.slice(0, 7);
for (const ym of months) {
  const start = `${ym}-01`, end = `${nextMonth(ym)}-01`;
  for (const acc of [null, ...data.accounts.map((x) => x.name)]) {
    const r = await fn(env, 'listMonth', acc ? { month: ym, accountId: accId[acc] } : { month: ym }, session);
    const label = `${ym} · ${acc || 'all accounts'}`;
    const inMonth = tx.filter((t) => dateOf(t) >= start && dateOf(t) < end && (!acc || t.account === acc || t.toAccount === acc));
    if (inMonth.length > 2000) {
      ok(!r.ok && /LIMIT_EXCEEDED/.test(r.error || ''), `${label}: ${inMonth.length} rows → LIMIT_EXCEEDED instead of a truncated list`, r.ok ? `returned ${r.result.transactions.length} rows` : r.error);
      continue;
    }
    if (!r.ok) { ok(false, label, r.error); continue; }
    eq(r.result.transactions.length, inMonth.length, `${label}: ${inMonth.length} rows`);
    eq(r.result.previousBalance, realizedBefore(start, acc), `${label}: previous balance ${fmt(r.result.previousBalance)}`);
    eq(r.result.previousProjected, projectedBefore(start, acc), `${label}: previous projected ${fmt(r.result.previousProjected)}`);
    if (ym === refMonth) {
      // running balance at the end of each day, the way the screen computes it, vs the JSON
      const accIdOf = (name) => (name ? accId[name] : null);
      let realized = r.result.previousBalance, projected = r.result.previousProjected;
      const apiByDay = new Map();
      for (const t of r.result.transactions) {
        const e = acc == null ? (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0)
          : (t.type === 'income' ? (t.accountId === accIdOf(acc) ? t.amount : 0) : t.type === 'expense' ? (t.accountId === accIdOf(acc) ? -t.amount : 0)
            : (t.accountId === accIdOf(acc) ? -t.amount : 0) + (t.toAccountId === accIdOf(acc) ? t.amount : 0));
        projected += e; if (t.paidDate) realized += e; apiByDay.set(t.date, { realized, projected });
      }
      const days = [...apiByDay.keys()].sort();
      const lastDay = days[days.length - 1];
      const afterLast = `${lastDay.slice(0, 8)}${String(Number(lastDay.slice(8)) + 1).padStart(2, '0')}`;
      eq(apiByDay.get(lastDay).realized, realizedBefore(afterLast, acc), `${label}: running realized balance on ${lastDay}`);
      eq(apiByDay.get(lastDay).projected, projectedBefore(afterLast, acc), `${label}: running projected balance on ${lastDay}`);
      const pending = inMonth.filter((t) => !t.paidDate), overdue = pending.filter((t) => t.dueDate < REF);
      eq(r.result.transactions.filter((t) => !t.paidDate).length, pending.length, `${label}: ${pending.length} pending`);
      eq(r.result.transactions.filter((t) => !t.paidDate && t.dueDate < REF).length, overdue.length, `${label}: ${overdue.length} overdue`);
    }
  }
}

console.log('\nreport · cash and accrual, all and per account');
const from = `${months[0]}-01`, to = `${nextMonth(months[months.length - 1])}-01`;
for (const basis of ['cash', 'accrual']) {
  for (const acc of [null, 'Operating checking', 'Payroll']) {
    const r = await fn(env, 'report', { from, to: `${nextMonth(months[months.length - 1])}-01`, basis, ...(acc ? { accountId: accId[acc] } : {}) }, session);
    const label = `${basis} · ${acc || 'all'}`;
    if (!r.ok) { ok(false, label, r.error); continue; }
    const field = basis === 'cash' ? 'paidDate' : 'accrualDate';
    const rows = tx.filter((t) => t.type !== 'transfer' && t[field] && t[field] >= from && t[field] <= to && (!acc || t.account === acc));
    const sum = (type) => rows.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);
    eq(r.result.income.total, sum('income'), `${label}: income ${fmt(r.result.income.total)}`);
    eq(r.result.expense.total, sum('expense'), `${label}: expenses ${fmt(r.result.expense.total)}`);
    const byCat = {};
    for (const t of rows) if (t.type === 'expense') byCat[t.category || 'Uncategorized'] = (byCat[t.category || 'Uncategorized'] || 0) + t.amount;
    const apiByCat = Object.fromEntries(r.result.expense.categories.map((c) => [c.name, c.total]));
    ok(JSON.stringify(apiByCat) === JSON.stringify(Object.fromEntries(Object.entries(byCat).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])))), `${label}: expense categories match`, JSON.stringify(apiByCat));
    eq(r.result.expense.categories.reduce((s, c) => s + c.items.length, 0), rows.filter((t) => t.type === 'expense').length, `${label}: every expense row listed`);
    if (basis === 'accrual' && !acc) ok(rows.some((t) => !t.paidDate), 'accrual report includes pending rows');
    if (basis === 'cash' && !acc) ok(!rows.some((t) => !t.paidDate), 'cash report excludes pending rows');
  }
}

console.log('\nrules');
const pendingOverdue = tx.find((t) => !t.paidDate && t.dueDate < REF && t.type === 'income');
const list = (await fn(env, 'listMonth', { month: pendingOverdue.dueDate.slice(0, 7) }, session)).result.transactions;
const target = list.find((t) => !t.paidDate && t.dueDate === pendingOverdue.dueDate && t.amount === pendingOverdue.amount);
ok(!!target, 'found an overdue pending transaction to mark as paid');
if (target) {
  const paid = await fn(env, 'setPaid', { id: target.id, paid: true }, session);
  eq(paid.result?.paidDate, REF, `setPaid uses today (${REF}), not the due date (${target.dueDate})`);
  const un = await fn(env, 'setPaid', { id: target.id, paid: false }, session);
  eq(un.result?.paidDate, null, 'setPaid(false) clears the payment date');
}
const op = accId['Operating checking'], pay = accId['Payroll'];
const cat = B.categories[0].id;
await must(fn(env, 'createTransaction', { type: 'transfer', amount: 100, dueDate: REF, accountId: op, toAccountId: op }, session), 142, 'transfer to the same account → 142');
await must(fn(env, 'createTransaction', { type: 'expense', amount: 0, dueDate: REF, accountId: op }, session), 142, 'amount 0 → 142');
await must(fn(env, 'createTransaction', { type: 'expense', amount: 10.5, dueDate: REF, accountId: op }, session), 142, 'amount 10.5 (not integer cents) → 142');
await must(fn(env, 'createTransaction', { type: 'expense', amount: 100, dueDate: '2026-02-30', accountId: op }, session), 142, 'date 2026-02-30 → 142');
await must(fn(env, 'createTransaction', { type: 'expense', amount: 100, dueDate: REF, accountId: op, description: 'x'.repeat(201) }, session), 142, 'description of 201 chars → 142');
await must(fn(env, 'createTransaction', { type: 'expense', amount: 100, dueDate: REF, accountId: op, categoryId: 'nope12345' }, session), 142, 'unknown category → 142');
await must(fn(env, 'createTransaction', { type: 'refund', amount: 100, dueDate: REF, accountId: op }, session), 142, 'unknown type → 142');
await must(fn(env, 'createAccount', { name: 'Payroll' }, session), 142, 'duplicate account name → 142');
await must(fn(env, 'createCategory', { name: B.categories[0].name }, session), 142, 'duplicate category name → 142');
await must(fn(env, 'deleteAccount', { id: pay }, session), 119, 'delete an account in use → 119');
await must(fn(env, 'deleteCategory', { id: cat }, session), 119, 'delete a category in use → 119');
await must(fn(env, 'updateAccount', { id: pay, currency: 'EUR' }, session), 119, 'change currency of an account with transactions → 119');
await must(fn(env, 'report', { from: '2020-01-01', to: REF, basis: 'cash' }, session), 142, 'report over 24 months → 142 LIMIT_EXCEEDED');
const eur = await fn(env, 'createAccount', { name: 'ZZ check EUR', currency: 'EUR' }, session);
ok(eur.ok, 'create an EUR account (empty)');
if (eur.ok) {
  await must(fn(env, 'createTransaction', { type: 'transfer', amount: 100, dueDate: REF, accountId: op, toAccountId: eur.result.id }, session), 142, 'transfer USD → EUR → 142');
  const del = await fn(env, 'deleteAccount', { id: eur.result.id }, session);
  ok(del.ok, 'delete the empty EUR account');
}
const created = await fn(env, 'createTransaction', { type: 'expense', amount: 1234, dueDate: REF, accrualDate: '2026-01-15', accountId: op, categoryId: cat, description: 'check.mjs temp' }, session);
ok(created.ok, 'create a valid expense');
if (created.ok) {
  eq(created.result.date, REF, 'date = dueDate while pending');
  const p = await fn(env, 'setPaid', { id: created.result.id, paid: true, paidDate: '2026-09-02' }, session);
  eq(p.result?.date, '2026-09-02', 'date = paidDate once paid');
  const d = await fn(env, 'deleteTransaction', { id: created.result.id }, session);
  ok(d.ok, 'delete the temp expense');
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
