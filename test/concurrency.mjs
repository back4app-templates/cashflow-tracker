// Concurrency on a FRESH instance: simultaneous setups, simultaneous issues, double-submitted payment, backup under writes.
import { unzipSync, strFromU8 } from 'fflate';
const BASE = process.env.BASE || 'http://localhost:8098', SECRET = process.env.SETUP_SECRET || 'conc setup secret words here';
let passed = 0, failed = 0; const check = (n, ok, x = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ` — ${x}` : ''}`); };
let cookie = '';
const enc = (o) => Object.entries(o).flatMap(([k, v]) => [].concat(v).map((x) => `${encodeURIComponent(k)}=${encodeURIComponent(x)}`)).join('&');
const req = async (path, o = {}) => { const r = await fetch(BASE + path, { method: o.method || 'GET', redirect: 'manual', headers: { cookie: o.cookie ?? cookie, ...(o.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: o.body ? enc(o.body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc && o.cookie === undefined) { const m = sc.match(/fb_session=([^;]*)/); if (m) cookie = m[1] ? `fb_session=${m[1]}` : ''; } return { status: r.status, text: await r.text(), location: r.headers.get('location'), raw: r }; };
const csrf = (t) => (t.match(/name="_csrf" value="([^"]*)"/) || [])[1], once = (t) => (t.match(/name="_once" value="([^"]*)"/) || [])[1];

// 1. ten simultaneous setup requests with the right passphrase → exactly one owner
const setups = await Promise.all(Array.from({ length: 10 }, (_, i) => fetch(BASE + '/setup', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: enc({ _once: `setup-${i}-1234567890123`, secret: SECRET, name: `Racer ${i}`, email: `racer${i}@example.com`, password: 'racer-password-12345' }) }).then(async (r) => ({ status: r.status, cookie: (r.headers.get('set-cookie') || '').match(/fb_session=([^;]*)/)?.[1] }))));
const winners = setups.filter((s) => s.status === 200);
check('exactly one of 10 simultaneous setups wins', winners.length === 1, setups.map((s) => s.status).join(','));
cookie = `fb_session=${winners[0].cookie}`;
let r = await req('/settings'); check('winner is signed in as owner', r.status === 200 && r.text.includes('Add a person'));
const people = (r.text.match(/racer\d@example\.com/g) || []).length; check('only one user exists', people === 1, `${people}`);

// 2. ten drafts issued simultaneously → ten distinct consecutive numbers
r = await req('/contacts/new', { method: 'POST', body: { _csrf: csrf((await req('/contacts')).text), _once: 'c-12345678901234567890', name: 'Racing Client' } });
const contactId = r.location.split('/').pop();
const drafts = [];
for (let i = 0; i < 10; i++) { const f = await req('/invoices/new'); const d = await req('/invoices/new', { method: 'POST', body: { _csrf: csrf(f.text), _once: once(f.text), contact_id: contactId, desc: `Item ${i}`, qty: '1', unit: '10.00' } }); drafts.push(d.location.split('/').pop()); }
const pages = await Promise.all(drafts.map((id) => req(`/invoices/${id}`)));
await Promise.all(drafts.map((id, i) => req(`/invoices/${id}/issue`, { method: 'POST', body: { _csrf: csrf(pages[i].text), _once: once(pages[i].text) } })));
r = await req('/invoices'); const numbers = [...new Set(r.text.match(/INV-\d{4}-\d{4}/g) || [])].sort();
check('10 simultaneous issues → 10 distinct numbers', numbers.length === 10, numbers.join(' '));
check('numbers are consecutive 0001..0010', numbers.map((n) => n.slice(-4)).join(',') === '0001,0002,0003,0004,0005,0006,0007,0008,0009,0010');

// 3. the same payment form posted 5 times at once → one payment
const f = await req(`/payments/new?invoice=${drafts[0]}`); const body = { _csrf: csrf(f.text), _once: once(f.text), invoice_id: drafts[0], contact_id: contactId, direction: 'received', amount: '10.00', paid_on: '2026-10-09', method: 'card' };
await Promise.all(Array.from({ length: 5 }, () => req('/payments/new', { method: 'POST', body })));
r = await req('/payments'); const n = (r.text.match(/\/payments\/\d+"/g) || []).length; check('5 simultaneous submits of one form → 1 payment', n === 1, `${n}`);

// 4. backup while payments are being recorded → every allocation in the file points at a payment in the same file
const writers = Array.from({ length: 8 }, async (_, i) => { const g = await req(`/payments/new?invoice=${drafts[1 + (i % 9)]}`); return req('/payments/new', { method: 'POST', body: { _csrf: csrf(g.text), _once: once(g.text), invoice_id: drafts[1 + (i % 9)], contact_id: contactId, direction: 'received', amount: '5.00', paid_on: '2026-10-09', method: 'cash' } }); });
const backupP = fetch(BASE + '/settings/backup', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: enc({ _csrf: csrf((await req('/settings')).text) }) }).then(async (x) => Buffer.from(await x.arrayBuffer()));
const [zip] = await Promise.all([backupP, ...writers]);
const files = unzipSync(new Uint8Array(zip)); const pay = JSON.parse(strFromU8(files['data/payments.json'])), alloc = JSON.parse(strFromU8(files['data/allocations.json']));
const ids = new Set(pay.map((p) => p.id)); const dangling = alloc.filter((a) => !ids.has(a.payment_id)).length;
check('backup taken during writes is internally consistent (no dangling allocation)', dangling === 0, `${pay.length} payments, ${alloc.length} allocations in the snapshot`);
check('manifest excludes sessions and tokens', JSON.parse(strFromU8(files['manifest.json'])).excludes.includes('sessions') && !files['data/sessions.json']);
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
