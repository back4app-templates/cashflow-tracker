// File: cloud/main.js · Parse Server Cloud Code · the only door into the ledger
// Classes Account, Category and Transaction are closed to clients (CLP: master key only). Every read and write
// goes through the 13 functions below, which require a signed-in user with the "finance" (read+write) or
// "viewer" (read only) role. Validation lives in the beforeSave/beforeDelete hooks, so it runs for every writer,
// including the seed and restore scripts.
'use strict';

const { generate } = require('./generate.js');

const LIMITS = { pageSize: 1000, monthRows: 2000, reportItems: 20000, reportMonths: 24, snapshotsKept: 14 };
const STR = { description: 200, contact: 120, notes: 2000, name: 80 };
const TYPES = ['income', 'expense', 'transfer'];
const READ = ['finance', 'viewer'];
const WRITE = ['finance'];
const E = Parse.Error;

// ---------------------------------------------------------------- helpers

const fail = (code, message) => { throw new E(code, message); };
const invalid = (message) => fail(E.VALIDATION_ERROR, message);               // 142
const forbidden = (message) => fail(E.OPERATION_FORBIDDEN, message);          // 119
const notFound = (message) => fail(E.OBJECT_NOT_FOUND, message);              // 101

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const nextMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const monthsBetween = (from, to) => { const [fy, fm] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number); return (ty - fy) * 12 + (tm - fm) + 1; };

function text(v, max, field) {
  if (v == null) return '';
  if (typeof v !== 'string') invalid(`${field} must be text.`);
  const s = v.trim();
  if (s.length > max) invalid(`${field} is longer than ${max} characters.`);
  return s;
}
function cents(v, field) {
  if (!Number.isSafeInteger(v)) invalid(`${field} must be an integer number of cents.`);
  return v;
}
function id(v, field) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9]{8,12}$/.test(v)) invalid(`${field} is not a valid id.`);
  return v;
}

async function settings() {
  const c = await Parse.Config.get({ useMasterKey: true });
  return {
    tz: c.get('orgTimezone') || 'America/New_York',
    referenceDate: c.get('referenceDate') || null,   // test backends only: freezes "today"
    demo: c.get('demo') === true,
  };
}
function todayIn(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
async function today() {
  const s = await settings();
  return s.referenceDate && isDate(s.referenceDate) ? s.referenceDate : todayIn(s.tz);
}

async function requireRole(request, roles) {
  if (!request.user) fail(E.INVALID_SESSION_TOKEN, 'Sign in to use the ledger.');   // 209
  const q = new Parse.Query(Parse.Role);
  q.containedIn('name', roles);
  q.equalTo('users', request.user);
  const role = await q.first({ useMasterKey: true });
  if (!role) forbidden(`This action needs the ${roles.length > 1 ? roles.join(' or ') : roles[0]} role.`);
  return role.get('name');
}

const Account = Parse.Object.extend('Account');
const Category = Parse.Object.extend('Category');
const Transaction = Parse.Object.extend('Transaction');
const Snapshot = Parse.Object.extend('Snapshot');
const ptr = (Cls, objectId) => Cls.createWithoutData(objectId);

// Complete results or an explicit error — never a silently truncated page.
async function fetchAll(query, ceiling, what) {
  const count = await query.count({ useMasterKey: true });
  if (count > ceiling) invalid(`LIMIT_EXCEEDED: ${what} matches ${count} rows; the limit is ${ceiling}. Narrow the range.`);
  const out = [];
  for (let skip = 0; ; skip += LIMITS.pageSize) {
    query.limit(LIMITS.pageSize);
    query.skip(skip);
    const page = await query.find({ useMasterKey: true });
    out.push(...page);
    if (page.length < LIMITS.pageSize) break;
  }
  return out;
}

// Sum of amounts grouped by (type, accountId, toAccountId) for the rows matching `match`.
// This is the one aggregate pipeline the app uses; the fold below turns it into a signed balance.
async function groupedEffects(match) {
  const pipeline = [
    { $match: match },
    { $group: { _id: { type: '$type', accountId: '$accountId', toAccountId: '$toAccountId' }, total: { $sum: '$amount' } } },
  ];
  const rows = await new Parse.Query(Transaction).aggregate(pipeline, { useMasterKey: true });
  return rows.map((r) => ({ ...(r.objectId || r._id || {}), total: r.total || 0 }));
}
function fold(rows, accountId) {
  let sum = 0;
  for (const r of rows) {
    if (accountId == null) {
      if (r.type === 'income') sum += r.total;
      else if (r.type === 'expense') sum -= r.total;      // transfers net to zero across all accounts
    } else {
      if (r.type === 'income' && r.accountId === accountId) sum += r.total;
      else if (r.type === 'expense' && r.accountId === accountId) sum -= r.total;
      else if (r.type === 'transfer') {
        if (r.accountId === accountId) sum -= r.total;
        if (r.toAccountId === accountId) sum += r.total;
      }
    }
  }
  return sum;
}
const PAID = { paidDate: { $gte: '0' } };   // string-typed only: null sorts below strings in MongoDB, so $lt alone would match pending rows

function plain(t) {
  return {
    id: t.id, type: t.get('type'), description: t.get('description') || '', amount: t.get('amount'),
    accrualDate: t.get('accrualDate'), dueDate: t.get('dueDate'), paidDate: t.get('paidDate') || null, date: t.get('date'),
    accountId: t.get('accountId'), toAccountId: t.get('toAccountId') || null, categoryId: t.get('categoryId') || null,
    contact: t.get('contact') || '', notes: t.get('notes') || '',
  };
}

// ---------------------------------------------------------------- hooks: validation for every writer

Parse.Cloud.beforeSave('Account', async (request) => {
  const o = request.object;
  if (request.context && request.context.reseed) return;
  const name = text(o.get('name'), STR.name, 'Name');
  if (!name) invalid('Give the account a name.');
  o.set('name', name);
  o.set('openingBalance', cents(o.get('openingBalance') ?? 0, 'Opening balance'));
  const currency = (o.get('currency') || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) invalid('Currency must be a 3-letter code.');
  o.set('currency', currency);

  const dup = new Parse.Query(Account); dup.equalTo('name', name);
  if (o.id) dup.notEqualTo('objectId', o.id);
  if (await dup.first({ useMasterKey: true })) invalid(`An account named "${name}" already exists.`);

  if (o.id && o.dirty('currency')) {
    const q = Parse.Query.or(new Parse.Query(Transaction).equalTo('accountId', o.id), new Parse.Query(Transaction).equalTo('toAccountId', o.id));
    if (await q.count({ useMasterKey: true })) fail(E.OPERATION_FORBIDDEN, 'The currency of an account with transactions cannot change.');
  }
});

Parse.Cloud.beforeDelete('Account', async (request) => {
  if (request.context && request.context.reseed) return;
  const o = request.object;
  const q = Parse.Query.or(new Parse.Query(Transaction).equalTo('accountId', o.id), new Parse.Query(Transaction).equalTo('toAccountId', o.id));
  const uses = await q.count({ useMasterKey: true });
  if (uses) fail(E.OPERATION_FORBIDDEN, `This account has ${uses} transaction(s). Move or delete them first.`);
  if ((await new Parse.Query(Account).count({ useMasterKey: true })) <= 1) fail(E.OPERATION_FORBIDDEN, 'Keep at least one account.');
});

Parse.Cloud.beforeSave('Category', async (request) => {
  const o = request.object;
  if (request.context && request.context.reseed) return;
  const name = text(o.get('name'), STR.name, 'Name');
  if (!name) invalid('Give the category a name.');
  o.set('name', name);
  const color = String(o.get('color') || '').toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) invalid('Color must be a hex value like #2a78d6.');
  o.set('color', color);
  const dup = new Parse.Query(Category); dup.equalTo('name', name);
  if (o.id) dup.notEqualTo('objectId', o.id);
  if (await dup.first({ useMasterKey: true })) invalid(`A category named "${name}" already exists.`);
});

Parse.Cloud.beforeDelete('Category', async (request) => {
  if (request.context && request.context.reseed) return;
  const uses = await new Parse.Query(Transaction).equalTo('categoryId', request.object.id).count({ useMasterKey: true });
  if (uses) fail(E.OPERATION_FORBIDDEN, `This category is used by ${uses} transaction(s). Recategorize them first.`);
});

Parse.Cloud.beforeSave('Transaction', async (request) => {
  const o = request.object;
  const type = o.get('type');
  if (!TYPES.includes(type)) invalid('Type must be income, expense or transfer.');
  const amount = cents(o.get('amount'), 'Amount');
  if (amount <= 0) invalid('Amount must be greater than zero.');

  const dueDate = o.get('dueDate');
  if (!isDate(dueDate)) invalid('Due date must be a real calendar date (YYYY-MM-DD).');
  const accrualDate = o.get('accrualDate') || dueDate;
  if (!isDate(accrualDate)) invalid('Accrual date must be a real calendar date (YYYY-MM-DD).');
  const paidDate = o.get('paidDate') ?? null;
  if (paidDate !== null && !isDate(paidDate)) invalid('Payment date must be a real calendar date (YYYY-MM-DD) or empty.');

  const account = o.get('account');
  if (!account) invalid('Choose the account.');
  const acc = await new Parse.Query(Account).get(account.id, { useMasterKey: true }).catch(() => null);
  if (!acc) invalid('Account not found.');

  let toAccountId = null, categoryId = null;
  if (type === 'transfer') {
    const to = o.get('toAccount');
    if (!to) invalid('Choose the destination account.');
    if (to.id === account.id) invalid('Destination must differ from the source account.');
    const dest = await new Parse.Query(Account).get(to.id, { useMasterKey: true }).catch(() => null);
    if (!dest) invalid('Destination account not found.');
    if (dest.get('currency') !== acc.get('currency')) invalid('Transfers only move money between accounts of the same currency.');
    toAccountId = to.id;
    o.unset('category');
  } else {
    o.unset('toAccount');
    const cat = o.get('category');
    if (cat) {
      const c = await new Parse.Query(Category).get(cat.id, { useMasterKey: true }).catch(() => null);
      if (!c) invalid('Category not found.');
      categoryId = cat.id;
    }
  }

  o.set('accrualDate', accrualDate);
  o.set('paidDate', paidDate);
  o.set('date', paidDate || dueDate);            // pre-computed at write time: the month list is one indexed range query
  o.set('accountId', account.id);                // plain ids mirror the pointers so the aggregate pipeline can group on them
  o.set('toAccountId', toAccountId);
  o.set('categoryId', categoryId);
  o.set('description', text(o.get('description'), STR.description, 'Description'));
  o.set('contact', text(o.get('contact'), STR.contact, 'Contact'));
  o.set('notes', text(o.get('notes'), STR.notes, 'Notes'));
});

// Users: no public sign-up; locked accounts (the shared demo sign-in) cannot change their own identity.
Parse.Cloud.beforeSave(Parse.User, (request) => {
  if (request.master) return;
  const u = request.object;
  if (!u.existed()) forbidden('Sign-up is disabled. Ask an administrator for access.');
  if (u.get('locked')) {
    const touched = u.dirtyKeys().filter((k) => ['username', 'email', 'password', 'locked', 'authData', 'emailVerified'].includes(k));
    if (touched.length) forbidden('This shared account cannot change its identity.');
  }
  if (u.dirty('locked')) forbidden('Only an administrator can lock or unlock an account.');
});
Parse.Cloud.beforeDelete(Parse.User, (request) => {
  if (!request.master) forbidden('Accounts are removed by an administrator.');
});
Parse.Cloud.beforeSave(Parse.Role, (request) => { if (!request.master) forbidden('Roles are managed by an administrator.'); });
Parse.Cloud.beforeDelete(Parse.Role, (request) => { if (!request.master) forbidden('Roles are managed by an administrator.'); });

// ---------------------------------------------------------------- functions: reads

Parse.Cloud.define('base', async (request) => {
  const role = await requireRole(request, READ);
  const [accounts, categories, paid, s, t] = await Promise.all([
    new Parse.Query(Account).ascending('createdAt').find({ useMasterKey: true }),
    new Parse.Query(Category).ascending('name').find({ useMasterKey: true }),
    groupedEffects(PAID),
    settings(),
    today(),
  ]);
  const usesByAccount = {}, usesByCategory = {};
  for (const r of await groupedEffectsCount()) {
    if (r.accountId) usesByAccount[r.accountId] = (usesByAccount[r.accountId] || 0) + r.count;
    if (r.toAccountId) usesByAccount[r.toAccountId] = (usesByAccount[r.toAccountId] || 0) + r.count;
    if (r.categoryId) usesByCategory[r.categoryId] = (usesByCategory[r.categoryId] || 0) + r.count;
  }
  const latest = await new Parse.Query(Transaction).descending('date').first({ useMasterKey: true });
  return {
    role, today: t, demo: s.demo, timezone: s.tz,
    latestMonth: latest ? latest.get('date').slice(0, 7) : null,
    accounts: accounts.map((a) => ({
      id: a.id, name: a.get('name'), openingBalance: a.get('openingBalance'), currency: a.get('currency'),
      currentBalance: a.get('openingBalance') + fold(paid, a.id), uses: usesByAccount[a.id] || 0,
    })),
    categories: categories.map((c) => ({ id: c.id, name: c.get('name'), color: c.get('color'), uses: usesByCategory[c.id] || 0 })),
  };
});
async function groupedEffectsCount() {
  const rows = await new Parse.Query(Transaction).aggregate([
    { $group: { _id: { accountId: '$accountId', toAccountId: '$toAccountId', categoryId: '$categoryId' }, count: { $sum: 1 } } },
  ], { useMasterKey: true });
  return rows.map((r) => ({ ...(r.objectId || r._id || {}), count: r.count || 0 }));
}

Parse.Cloud.define('listMonth', async (request) => {
  await requireRole(request, READ);
  const { month, accountId } = request.params;
  if (!isMonth(month)) invalid('month must be YYYY-MM.');
  const start = `${month}-01`, end = `${nextMonth(month)}-01`;
  const acct = accountId ? id(accountId, 'accountId') : null;

  let opening;
  if (acct) {
    const a = await new Parse.Query(Account).get(acct, { useMasterKey: true }).catch(() => null);
    if (!a) notFound('Account not found.');
    opening = a.get('openingBalance');
  } else {
    const all = await new Parse.Query(Account).find({ useMasterKey: true });
    opening = all.reduce((s, a) => s + a.get('openingBalance'), 0);
  }
  const [realized, projected] = await Promise.all([
    groupedEffects({ paidDate: { $gte: '0', $lt: start } }),
    groupedEffects({ date: { $lt: start } }),
  ]);

  let q;
  if (acct) q = Parse.Query.or(new Parse.Query(Transaction).equalTo('accountId', acct), new Parse.Query(Transaction).equalTo('toAccountId', acct));
  else q = new Parse.Query(Transaction);
  q.greaterThanOrEqualTo('date', start).lessThan('date', end).ascending('date').addAscending('createdAt');
  const rows = await fetchAll(q, LIMITS.monthRows, `Month ${month}`);
  return {
    month, accountId: acct, today: await today(),
    previousBalance: opening + fold(realized, acct),
    previousProjected: opening + fold(projected, acct),
    transactions: rows.map(plain),
  };
});

Parse.Cloud.define('report', async (request) => {
  await requireRole(request, READ);
  const { from, to, accountId } = request.params;
  const basis = request.params.basis === 'accrual' ? 'accrual' : 'cash';
  if (!isDate(from) || !isDate(to)) invalid('from and to must be real calendar dates (YYYY-MM-DD).');
  if (from > to) invalid('from must not be after to.');
  if (monthsBetween(from.slice(0, 7), to.slice(0, 7)) > LIMITS.reportMonths) invalid(`LIMIT_EXCEEDED: reports cover at most ${LIMITS.reportMonths} months.`);
  const acct = accountId ? id(accountId, 'accountId') : null;
  const field = basis === 'accrual' ? 'accrualDate' : 'paidDate';

  const q = new Parse.Query(Transaction);
  q.containedIn('type', ['income', 'expense']);
  q.greaterThanOrEqualTo(field, from).lessThanOrEqualTo(field, to);   // for cash basis this also excludes null paidDate
  if (acct) q.equalTo('accountId', acct);
  q.ascending(field).addAscending('createdAt');
  const rows = await fetchAll(q, LIMITS.reportItems, `Report ${from}..${to}`);

  const categories = await new Parse.Query(Category).find({ useMasterKey: true });
  const catById = Object.fromEntries(categories.map((c) => [c.id, { id: c.id, name: c.get('name'), color: c.get('color') }]));
  const side = (type) => {
    const groups = new Map();
    for (const t of rows) {
      if (t.get('type') !== type) continue;
      const cid = t.get('categoryId') || null;
      const meta = cid && catById[cid] ? catById[cid] : { id: null, name: 'Uncategorized', color: '#7a8794' };
      if (!groups.has(cid)) groups.set(cid, { ...meta, total: 0, items: [] });
      const g = groups.get(cid);
      g.total += t.get('amount');
      g.items.push({ id: t.id, date: t.get(field), description: t.get('description') || '', contact: t.get('contact') || '', amount: t.get('amount') });
    }
    const list = [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { total: list.reduce((s, g) => s + g.total, 0), categories: list };
  };
  return { from, to, basis, accountId: acct, income: side('income'), expense: side('expense') };
});

// ---------------------------------------------------------------- functions: transactions

function applyTransaction(o, p) {
  o.set('type', p.type);
  o.set('amount', p.amount);
  o.set('description', p.description ?? '');
  o.set('accrualDate', p.accrualDate || p.dueDate);
  o.set('dueDate', p.dueDate);
  o.set('paidDate', p.paidDate ?? null);
  o.set('contact', p.contact ?? '');
  o.set('notes', p.notes ?? '');
  if (p.accountId != null) o.set('account', ptr(Account, id(p.accountId, 'accountId')));
  if (p.type === 'transfer') { if (p.toAccountId != null) o.set('toAccount', ptr(Account, id(p.toAccountId, 'toAccountId'))); }
  else if (p.categoryId) o.set('category', ptr(Category, id(p.categoryId, 'categoryId'))); else o.unset('category');
}

Parse.Cloud.define('createTransaction', async (request) => {
  await requireRole(request, WRITE);
  const o = new Transaction();
  applyTransaction(o, request.params);
  await o.save(null, { useMasterKey: true });
  return plain(o);
});

Parse.Cloud.define('updateTransaction', async (request) => {
  await requireRole(request, WRITE);
  const o = await new Parse.Query(Transaction).get(id(request.params.id, 'id'), { useMasterKey: true }).catch(() => null);
  if (!o) notFound('Transaction not found.');
  applyTransaction(o, request.params);
  await o.save(null, { useMasterKey: true });
  return plain(o);
});

Parse.Cloud.define('deleteTransaction', async (request) => {
  await requireRole(request, WRITE);
  const o = await new Parse.Query(Transaction).get(id(request.params.id, 'id'), { useMasterKey: true }).catch(() => null);
  if (!o) notFound('Transaction not found.');
  await o.destroy({ useMasterKey: true });
  return { id: o.id, deleted: true };
});

Parse.Cloud.define('setPaid', async (request) => {
  await requireRole(request, WRITE);
  const o = await new Parse.Query(Transaction).get(id(request.params.id, 'id'), { useMasterKey: true }).catch(() => null);
  if (!o) notFound('Transaction not found.');
  if (request.params.paid) {
    const when = request.params.paidDate || await today();      // today in the organization timezone, never min(due, today)
    if (!isDate(when)) invalid('paidDate must be a real calendar date (YYYY-MM-DD).');
    o.set('paidDate', when);
  } else {
    o.set('paidDate', null);
  }
  await o.save(null, { useMasterKey: true });
  return plain(o);
});

// ---------------------------------------------------------------- functions: accounts and categories

const plainAccount = (a) => ({ id: a.id, name: a.get('name'), openingBalance: a.get('openingBalance'), currency: a.get('currency') });
const plainCategory = (c) => ({ id: c.id, name: c.get('name'), color: c.get('color') });

Parse.Cloud.define('createAccount', async (request) => {
  await requireRole(request, WRITE);
  const o = new Account();
  o.set('name', request.params.name);
  o.set('openingBalance', request.params.openingBalance ?? 0);
  o.set('currency', request.params.currency || 'USD');
  await o.save(null, { useMasterKey: true });
  return plainAccount(o);
});
Parse.Cloud.define('updateAccount', async (request) => {
  await requireRole(request, WRITE);
  const o = await new Parse.Query(Account).get(id(request.params.id, 'id'), { useMasterKey: true }).catch(() => null);
  if (!o) notFound('Account not found.');
  if (request.params.name !== undefined) o.set('name', request.params.name);
  if (request.params.openingBalance !== undefined) o.set('openingBalance', request.params.openingBalance);
  if (request.params.currency !== undefined) o.set('currency', request.params.currency);
  await o.save(null, { useMasterKey: true });
  return plainAccount(o);
});
Parse.Cloud.define('deleteAccount', async (request) => {
  await requireRole(request, WRITE);
  const o = await new Parse.Query(Account).get(id(request.params.id, 'id'), { useMasterKey: true }).catch(() => null);
  if (!o) notFound('Account not found.');
  await o.destroy({ useMasterKey: true });
  return { id: o.id, deleted: true };
});

Parse.Cloud.define('createCategory', async (request) => {
  await requireRole(request, WRITE);
  const o = new Category();
  o.set('name', request.params.name);
  const n = await new Parse.Query(Category).count({ useMasterKey: true });
  const { PALETTE } = require('./generate.js');
  o.set('color', request.params.color || PALETTE[n % PALETTE.length]);
  await o.save(null, { useMasterKey: true });
  return plainCategory(o);
});
Parse.Cloud.define('updateCategory', async (request) => {
  await requireRole(request, WRITE);
  const o = await new Parse.Query(Category).get(id(request.params.id, 'id'), { useMasterKey: true }).catch(() => null);
  if (!o) notFound('Category not found.');
  if (request.params.name !== undefined) o.set('name', request.params.name);
  if (request.params.color !== undefined) o.set('color', request.params.color);
  await o.save(null, { useMasterKey: true });
  return plainCategory(o);
});
Parse.Cloud.define('deleteCategory', async (request) => {
  await requireRole(request, WRITE);
  const o = await new Parse.Query(Category).get(id(request.params.id, 'id'), { useMasterKey: true }).catch(() => null);
  if (!o) notFound('Category not found.');
  await o.destroy({ useMasterKey: true });
  return { id: o.id, deleted: true };
});

// ---------------------------------------------------------------- jobs

async function exportAll() {
  const [accounts, categories, transactions] = await Promise.all([
    new Parse.Query(Account).ascending('createdAt').find({ useMasterKey: true }),
    new Parse.Query(Category).ascending('createdAt').find({ useMasterKey: true }),
    fetchAll(new Parse.Query(Transaction).ascending('createdAt'), Number.MAX_SAFE_INTEGER, 'Export'),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    accounts: accounts.map(plainAccount),
    categories: categories.map(plainCategory),
    transactions: transactions.map(plain),
  };
}

// Nightly in-backend snapshot: recovers a bad edit or delete; does NOT protect against losing the backend itself.
Parse.Cloud.job('nightlySnapshot', async (request) => {
  const startedAt = new Date();
  const data = await exportAll();
  const payload = JSON.stringify(data);
  const snap = new Snapshot();
  snap.set('payload', payload);
  snap.set('bytes', payload.length);
  snap.set('counts', { accounts: data.accounts.length, categories: data.categories.length, transactions: data.transactions.length });
  snap.set('startedAt', startedAt);
  snap.set('finishedAt', new Date());
  snap.setACL(new Parse.ACL());   // nobody but the master key
  await snap.save(null, { useMasterKey: true });
  const old = await new Parse.Query(Snapshot).descending('createdAt').skip(LIMITS.snapshotsKept).find({ useMasterKey: true });
  if (old.length) await Parse.Object.destroyAll(old, { useMasterKey: true });
  request.message(`Snapshot ${snap.id}: ${payload.length} bytes, ${data.transactions.length} transactions; ${old.length} old snapshot(s) removed.`);
});

async function destroyAllOf(Cls) {
  for (;;) {
    const page = await new Parse.Query(Cls).limit(LIMITS.pageSize).find({ useMasterKey: true });
    if (!page.length) break;
    await Parse.Object.destroyAll(page, { useMasterKey: true, context: { reseed: true } });
  }
}

// Loads the fictitious dataset. Refuses to run unless the backend is flagged as a demo in Parse Config.
Parse.Cloud.job('reseedDemo', async (request) => {
  const s = await settings();
  if (!s.demo) throw new Error('reseedDemo only runs on a backend whose Config has demo = true.');
  const referenceDate = (request.params && request.params.referenceDate) || s.referenceDate || todayIn(s.tz);
  const data = generate({ referenceDate, size: request.params && request.params.size });

  await destroyAllOf(Transaction);
  await destroyAllOf(Category);
  await destroyAllOf(Account);

  const accounts = await Parse.Object.saveAll(data.accounts.map((a) => new Account(a)), { useMasterKey: true });
  const categories = await Parse.Object.saveAll(data.categories.map((c) => new Category(c)), { useMasterKey: true });
  const accId = Object.fromEntries(accounts.map((a) => [a.get('name'), a.id]));
  const catId = Object.fromEntries(categories.map((c) => [c.get('name'), c.id]));
  const objects = data.transactions.map((t) => {
    const o = new Transaction();
    applyTransaction(o, { ...t, accountId: accId[t.account], toAccountId: t.toAccount ? accId[t.toAccount] : null, categoryId: t.category ? catId[t.category] : null });
    return o;
  });
  for (let i = 0; i < objects.length; i += 50) await Parse.Object.saveAll(objects.slice(i, i + 50), { useMasterKey: true });
  request.message(`Reseeded: ${accounts.length} accounts, ${categories.length} categories, ${objects.length} transactions, reference date ${referenceDate}.`);
});
