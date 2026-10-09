// File: scripts/check-permissions.mjs · Node 22
// The permission matrix: four callers × the 13 functions, direct class access with the JavaScript key,
// role reads/edits, identity edits and self-deletion on a regular user and on the locked demo user, sign-up.
//   node scripts/check-permissions.mjs
import { loadEnv, rest, where, args, login, fn, readCredentials, ptr, ParseError } from './lib.mjs';

const env = loadEnv();
const a = args();
const creds = readCredentials();
const FIN = { user: process.env.FINANCE_USER || 'finance', pass: process.env.FINANCE_PASSWORD || creds[process.env.FINANCE_USER || 'finance']?.password };
const VIEW = { user: process.env.VIEWER_USER || 'demo', pass: process.env.VIEWER_PASSWORD || creds[process.env.VIEWER_USER || 'demo']?.password };
if (!FIN.pass || !VIEW.pass) { console.error('Need finance and viewer passwords (.credentials.local.json or env).'); process.exit(1); }

let pass = 0, failed = 0;
const ok = (cond, label, detail = '') => { if (cond) { pass++; console.log(`  PASS  ${label}`); } else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); } };
const codeOf = (e) => (e instanceof ParseError ? e.code ?? e.status : e?.code);

// temp user without any role
const tmpName = `norole_${Date.now()}`;
const tmpPass = `Temp-${Date.now()}`;
const tmp = await rest(env, 'POST', '/users', { username: tmpName, password: tmpPass }, { master: true });
const sessions = { anonymous: null, norole: await login(env, tmpName, tmpPass) };
sessions.viewer = await login(env, VIEW.user, VIEW.pass);
sessions.finance = await login(env, FIN.user, FIN.pass);

const base = (await fn(env, 'base', {}, sessions.finance)).result;
const op = base.accounts[0].id, cat = base.categories[0].id;
const month = base.today.slice(0, 7);

// Calls that are valid for finance; for other callers the authorization check fires before any write.
const CALLS = {
  base: {}, listMonth: { month }, report: { from: `${month}-01`, to: base.today, basis: 'cash' },
  createAccount: { name: `ZZ perm ${Date.now()}` }, updateAccount: { id: 'LATER', name: 'ZZ perm renamed' }, deleteAccount: { id: 'LATER' },
  createCategory: { name: `ZZ perm cat ${Date.now()}` }, updateCategory: { id: 'LATER', name: 'ZZ perm cat renamed' }, deleteCategory: { id: 'LATER' },
  createTransaction: { type: 'expense', amount: 100, dueDate: base.today, accountId: op, categoryId: cat, description: 'perm test' },
  updateTransaction: { id: 'LATER', type: 'expense', amount: 200, dueDate: base.today, accountId: op, description: 'perm test 2' },
  setPaid: { id: 'LATER', paid: true }, deleteTransaction: { id: 'LATER' },
};
const EXPECT = { anonymous: 209, norole: 119, viewer: { base: 'ok', listMonth: 'ok', report: 'ok' }, finance: 'ok' };

console.log('functions × callers');
const made = {};
for (const [caller, session] of Object.entries(sessions)) {
  for (const [name, params] of Object.entries(CALLS)) {
    const p = { ...params };
    for (const k of Object.keys(p)) if (p[k] === 'LATER') p[k] = made[name.replace(/^(update|delete|setPaid)/, '')] || made[{ updateAccount: 'createAccount', deleteAccount: 'createAccount', updateCategory: 'createCategory', deleteCategory: 'createCategory', updateTransaction: 'createTransaction', setPaid: 'createTransaction', deleteTransaction: 'createTransaction' }[name]] || 'zzzzzzzz';
    const r = await fn(env, name, p, session);
    const want = typeof EXPECT[caller] === 'object' ? (EXPECT[caller][name] || 119) : EXPECT[caller];
    const got = r.ok ? 'ok' : r.code;
    ok(got === want, `${caller.padEnd(9)} ${name.padEnd(18)} → ${String(got).padEnd(4)} (expected ${want})`, r.ok ? '' : r.error);
    if (caller === 'finance' && r.ok && name.startsWith('create')) made[name] = r.result.id;
  }
}

console.log('\ndirect class access (JavaScript key, no Cloud Code)');
for (const [who, session] of [['anonymous', null], ['viewer', sessions.viewer], ['finance', sessions.finance]]) {
  for (const cls of ['Account', 'Category', 'Transaction', 'Snapshot']) {
    const r = await rest(env, 'GET', `/classes/${cls}?limit=1`, undefined, { session, headers: { 'X-Parse-REST-API-Key': '', 'X-Parse-Javascript-Key': env.jsKey } }).then((x) => ({ ok: true, n: x.results.length })).catch((e) => ({ ok: false, code: codeOf(e) }));
    ok(!r.ok && r.code === 119, `${who.padEnd(9)} GET /classes/${cls} → ${r.ok ? 'returned rows' : r.code} (expected 119)`);
  }
  const c = await rest(env, 'POST', '/classes/Transaction', { type: 'expense', amount: 1, dueDate: base.today, account: ptr('Account', op) }, { session, headers: { 'X-Parse-Javascript-Key': env.jsKey } }).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: codeOf(e) }));
  ok(!c.ok && c.code === 119, `${who.padEnd(9)} POST /classes/Transaction → ${c.ok ? 'created' : c.code} (expected 119)`);
}

console.log('\nroles');
const role = (await rest(env, 'GET', `/roles?where=${where({ name: 'finance' })}`, undefined, { master: true })).results[0];
for (const [who, session] of [['viewer', sessions.viewer], ['finance', sessions.finance]]) {
  const r = await rest(env, 'GET', '/roles', undefined, { session, headers: { 'X-Parse-Javascript-Key': env.jsKey } }).then((x) => ({ ok: true, n: x.results.length })).catch((e) => ({ ok: false, code: codeOf(e) }));
  ok(!r.ok && r.code === 119, `${who.padEnd(9)} GET /roles → ${r.ok ? `${r.n} rows` : r.code} (expected 119)`);
  const w = await rest(env, 'PUT', `/roles/${role.objectId}`, { users: { __op: 'AddRelation', objects: [ptr('_User', tmp.objectId)] } }, { session, headers: { 'X-Parse-Javascript-Key': env.jsKey } }).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: codeOf(e) }));
  ok(!w.ok && (w.code === 119 || w.code === 101), `${who.padEnd(9)} PUT /roles/finance add member → ${w.ok ? 'changed!' : w.code} (expected 119/101)`);
}

console.log('\nidentity');
const me = async (session) => rest(env, 'GET', '/users/me', undefined, { session, headers: { 'X-Parse-Javascript-Key': env.jsKey } });
const viewerMe = await me(sessions.viewer), financeMe = await me(sessions.finance);
ok(viewerMe.locked === true, 'demo (viewer) user is locked');
const tryPut = (session, id, body) => rest(env, 'PUT', `/users/${id}`, body, { session, headers: { 'X-Parse-Javascript-Key': env.jsKey } }).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: codeOf(e) }));
const tryDel = (session, id) => rest(env, 'DELETE', `/users/${id}`, undefined, { session, headers: { 'X-Parse-Javascript-Key': env.jsKey } }).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: codeOf(e) }));
let r;
r = await tryPut(sessions.viewer, viewerMe.objectId, { password: 'hijacked' }); ok(!r.ok && r.code === 119, `locked user changes own password → ${r.ok ? 'changed!' : r.code} (expected 119)`);
r = await tryPut(sessions.viewer, viewerMe.objectId, { email: 'x@example.com' }); ok(!r.ok && r.code === 119, `locked user changes own e-mail → ${r.ok ? 'changed!' : r.code} (expected 119)`);
r = await tryPut(sessions.viewer, viewerMe.objectId, { username: 'stolen' }); ok(!r.ok && r.code === 119, `locked user changes own username → ${r.ok ? 'changed!' : r.code} (expected 119)`);
r = await tryPut(sessions.viewer, viewerMe.objectId, { locked: false }); ok(!r.ok && r.code === 119, `locked user unlocks itself → ${r.ok ? 'changed!' : r.code} (expected 119)`);
r = await tryDel(sessions.viewer, viewerMe.objectId); ok(!r.ok && r.code === 119, `locked user deletes itself → ${r.ok ? 'deleted!' : r.code} (expected 119)`);
r = await tryPut(sessions.finance, financeMe.objectId, { email: `finance+${Date.now()}@example.com` }); ok(r.ok, `regular user changes own e-mail → ${r.ok ? 'ok' : r.code} (expected ok)`);
if (r.ok) await rest(env, 'PUT', `/users/${financeMe.objectId}`, { email: { __op: 'Delete' } }, { master: true });
r = await tryPut(sessions.finance, financeMe.objectId, { locked: true }); ok(!r.ok && r.code === 119, `regular user locks itself → ${r.ok ? 'changed!' : r.code} (expected 119)`);
r = await tryPut(sessions.finance, viewerMe.objectId, { email: 'y@example.com' }); ok(!r.ok && (r.code === 101 || r.code === 206), `regular user edits another user → ${r.ok ? 'changed!' : r.code} (expected 101 or 206: not visible / not own session)`);
r = await tryDel(sessions.finance, financeMe.objectId); ok(!r.ok && r.code === 119, `regular user deletes itself → ${r.ok ? 'deleted!' : r.code} (expected 119)`);
r = await rest(env, 'POST', '/users', { username: `signup_${Date.now()}`, password: 'x' }, { headers: { 'X-Parse-Javascript-Key': env.jsKey } }).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: codeOf(e) }));
ok(!r.ok && r.code === 119, `public sign-up → ${r.ok ? 'created!' : r.code} (expected 119)`);
r = await rest(env, 'POST', '/requestPasswordReset', { email: viewerMe.email || 'demo@example.invalid' }, { headers: { 'X-Parse-Javascript-Key': env.jsKey } }).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: codeOf(e) }));
console.log(`  INFO  password reset request for the demo user → ${r.ok ? 'accepted (e-mail goes to a mailbox we control)' : `code ${r.code}`}`);

// cleanup
for (const [cls, id] of [['Transaction', made.createTransaction], ['Category', made.createCategory], ['Account', made.createAccount]]) {
  if (id) await rest(env, 'DELETE', `/classes/${cls}/${id}`, undefined, { master: true }).catch(() => {});
}
await rest(env, 'DELETE', `/users/${tmp.objectId}`, undefined, { master: true }).catch(() => {});

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
