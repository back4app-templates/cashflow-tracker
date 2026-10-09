// End-to-end smoke run against a running server (BASE), using fetch with a cookie jar. Prints PASS/FAIL lines.
const BASE = process.env.BASE || 'http://localhost:8080';
const SECRET = process.env.SETUP_SECRET || 'maple river candle orbit seven';
let cookie = '', passed = 0, failed = 0;
const check = (name, ok, extra = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
async function req(path, { method = 'GET', body, redirect = 'manual', headers = {} } = {}) {
  const r = await fetch(BASE + path, { method, redirect, headers: { cookie, ...headers, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: body instanceof FormData ? body : body ? enc(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/fb_session=([^;]*)/); if (m) cookie = m[1] ? `fb_session=${m[1]}` : ''; }
  const text = await r.text(); return { status: r.status, text, location: r.headers.get('location'), headers: r.headers, buf: null };
}
const enc = (o) => Object.entries(o).flatMap(([k, v]) => [].concat(v).map((x) => `${encodeURIComponent(k)}=${encodeURIComponent(x)}`)).join('&');
const csrfOf = (html) => (html.match(/name="_csrf" value="([^"]*)"/) || [])[1];
const onceOf = (html) => (html.match(/name="_once" value="([^"]*)"/) || [])[1];
const get = (p) => req(p);
async function post(path, fields, formPath = path) { const page = await get(formPath); return req(path, { method: 'POST', body: { _csrf: csrfOf(page.text), _once: onceOf(page.text), ...fields } }); }

let r = await get('/'); check('first run redirects to /setup', r.status === 302 && r.location === '/setup');
r = await get('/setup'); const once0 = onceOf(r.text);
r = await req('/setup', { method: 'POST', body: { _once: once0, secret: 'wrong secret entirely', name: 'Owner', email: 'owner@example.com', password: 'owner-password-123' } });
check('setup rejects a wrong passphrase', r.status === 403);
r = await req('/setup', { method: 'POST', body: { _once: once0, secret: SECRET, name: 'Ada Owner', email: 'owner@example.com', password: 'owner-password-123' } });
check('setup creates the owner and shows 8 recovery codes', r.status === 200 && (r.text.match(/[0-9a-f]{6}-[0-9a-f]{6}/g) || []).length === 8);
const codes = r.text.match(/[0-9a-f]{6}-[0-9a-f]{6}/g);
r = await get('/setup'); check('setup page is gone after the first user', r.status === 302 && r.location === '/login');
r = await req('/setup', { method: 'POST', body: { _once: once0, secret: SECRET, name: 'X', email: 'x@example.com', password: 'another-password-123' } });
check('second setup attempt is refused', [403, 409].includes(r.status), String(r.status));

r = await post('/settings/company', { company_name: 'Bluefin Studio LLC', company_address: '1 Pier St\nPortland, ME', company_email: 'hello@bluefin.example', company_phone: '', invoice_footer: 'Pay within 14 days.', timezone: 'America/New_York', currency_symbol: '$' }, '/settings');
check('company settings saved', r.status === 302);
r = await post('/settings/tax', { tax_label: 'Sales tax', tax_rate: '10', tax_inclusive: '0', invoice_prefix: 'INV' }, '/settings'); check('tax settings saved', r.status === 302);

r = await post('/contacts/new', { name: 'Harbor Lane Bakery', email: 'orders@harborlane.example', address: '12 Pier St' }); check('contact created', r.status === 302 && /\/contacts\/\d+/.test(r.location));
const contactId = r.location.split('/').pop();
r = await post('/invoices/new', { contact_id: contactId, due_on: '', notes: 'Thanks!', desc: ['Consulting hour', 'Landing page'], qty: ['3', '1'], unit: ['120.00', '1800.00'] });
check('draft invoice created', r.status === 302 && /\/invoices\/\d+/.test(r.location)); const invId = r.location.split('/').pop();
r = await get(`/invoices/${invId}`); check('draft totals: subtotal 2,160.00 / tax 216.00 / total 2,376.00', r.text.includes('$2,160.00') && r.text.includes('$216.00') && r.text.includes('$2,376.00'), r.text.match(/\$[\d,]+\.\d\d/g)?.slice(0, 8).join(' '));
r = await post(`/invoices/${invId}/issue`, {}, `/invoices/${invId}`); check('issue redirects', r.status === 302);
r = await get(`/invoices/${invId}`); const number = (r.text.match(/INV-\d{4}-0001/) || [])[0]; check('issued with number INV-YYYY-0001', !!number, number);
check('state is issued', /badge "?>issued/.test(r.text) || r.text.includes('>issued<'));
// double submit of the same issue form must not change anything
const page1 = await get(`/invoices/${invId}`); const csrf = csrfOf(page1.text);
r = await req(`/invoices/${invId}/issue`, { method: 'POST', body: { _csrf: csrf, _once: 'replayed-key-1234567890' } }); check('issue on an issued invoice is refused', r.status === 409);
// partial payment 1,000 then overpayment
r = await post('/payments/new', { invoice_id: invId, contact_id: contactId, direction: 'received', amount: '1000.00', paid_on: '2026-10-01', method: 'card' }, `/payments/new?invoice=${invId}`);
check('partial payment recorded', r.status === 302);
r = await get(`/invoices/${invId}`); check('state is partially paid, balance 1,376.00', r.text.includes('>partially paid<') && r.text.includes('$1,376.00'));
// idempotency: resend the exact same form (same _once) → no second payment
const form2 = await get(`/payments/new?invoice=${invId}`); const body2 = { _csrf: csrfOf(form2.text), _once: onceOf(form2.text), invoice_id: invId, contact_id: contactId, direction: 'received', amount: '1500.00', paid_on: '2026-10-02', method: 'bank transfer' };
await req('/payments/new', { method: 'POST', body: body2 }); await req('/payments/new', { method: 'POST', body: body2 });
r = await get('/payments'); const n = (r.text.match(/\/payments\/\d+"/g) || []).length; check('the same form submitted twice records one payment (2 total)', n === 2, `${n} payments`);
r = await get(`/invoices/${invId}`); check('overpaid: invoice paid in full, the excess 124.00 is contact credit (never over-allocated)', r.text.includes('>paid<') && r.text.includes('has $124.00 of unapplied credit'));
r = await get('/payments'); check('cash received list shows 2,500.00 total and the 124.00 credit remainder', r.text.includes('$1,000.00') && r.text.includes('$1,500.00') && r.text.includes('$124.00'));
// second invoice, apply credit: cash stays 2,500
r = await post('/invoices/new', { contact_id: contactId, desc: ['Newsletter template'], qty: ['1'], unit: ['450.00'] }); const inv2 = r.location.split('/').pop();
await post(`/invoices/${inv2}/issue`, {}, `/invoices/${inv2}`);
r = await post(`/invoices/${inv2}/apply-credit`, {}, `/invoices/${inv2}`); check('apply credit redirects', r.status === 302);
r = await get(`/invoices/${inv2}`); check('invoice 2 shows 124.00 applied, balance 371.00 (total 495.00)', r.text.includes('$124.00') && r.text.includes('$371.00'));
r = await get('/payments'); check('still exactly 2 cash payments after applying credit', (r.text.match(/\/payments\/\d+"/g) || []).length === 2);
// void invoice 2 with allocations → to credit; cash untouched
r = await post(`/invoices/${inv2}/void`, { move_to: 'credit' }, `/invoices/${inv2}`); check('void with allocations moved to credit', r.status === 302);
r = await get(`/invoices/${inv2}`); check('invoice 2 is void', r.text.includes('>void<'));
r = await get(`/contacts/${contactId}`); check('contact credit is back to 124.00', r.text.includes('credit $124.00'));
// share link
r = await post(`/invoices/${invId}/share`, { enable: '1' }, `/invoices/${invId}`); r = await get(`/invoices/${invId}`); const share = (r.text.match(/\/share\/([A-Za-z0-9_-]{40,})/) || [])[1]; check('share link created (random token)', !!share);
const saved = cookie; cookie = '';
r = await get(`/share/${share}`); check('share page public, noindex + no-referrer', r.status === 200 && r.headers.get('x-robots-tag')?.includes('noindex') && r.headers.get('referrer-policy') === 'no-referrer' && r.text.includes(number));
r = await get('/share/not-a-real-token-at-all-0123456789012345'); check('wrong token → 404', r.status === 404);
r = await get(`/invoices/${invId}`); check('anonymous cannot open the invoice page', r.status === 302 && r.location === '/login');
cookie = saved;
r = await post(`/invoices/${invId}/share`, { enable: '0' }, `/invoices/${invId}`); cookie = ''; r = await get(`/share/${share}`); check('revoked link → 404', r.status === 404); cookie = saved;
// bills + week
r = await post('/contacts/new', { name: 'Summit Web Hosting' }); const supId = r.location.split('/').pop();
r = await post('/bills/new', { supplier_id: supId, category_id: '', new_category: 'Software', description: 'Hosting — October', amount: '49.00', due_on: '2026-10-12' }); const billId = r.location.split('/').pop(); check('bill created', !!billId && r.status === 302);
r = await post(`/bills/${billId}/pay`, { amount: '20.00', paid_on: '2026-10-09', method: 'card' }, `/bills/${billId}`); r = await get(`/bills/${billId}`); check('bill partially paid, balance 29.00', r.text.includes('>partially paid<') && r.text.includes('$29.00'));
r = await get('/'); check('This week renders with tiles', r.status === 200 && r.text.includes('Money out, due this week') && r.text.includes('$29.00'));
// staff cannot delete payments; demo cannot write
r = await post('/settings/users', { name: 'Sam Staff', email: 'staff@example.com', password: 'staff-password-123', role: 'staff' }, '/settings');
r = await post('/settings/users', { name: 'Demo', email: 'demo@example.com', password: 'demo-password-1234', role: 'demo' }, '/settings');
const ownerCookie = cookie; cookie = '';
r = await req('/login', { method: 'POST', body: { email: 'staff@example.com', password: 'staff-password-123' } }); check('staff logs in', r.status === 302 && cookie);
r = await get('/payments/1'); check('staff sees no delete button', r.status === 200 && !r.text.includes('Delete this payment'));
r = await req('/payments/1/delete', { method: 'POST', body: { _csrf: csrfOf((await get('/payments')).text), _once: 'staff-try-1234567890123' } }); check('staff POST delete → 403', r.status === 403);
r = await get('/settings'); check('staff settings page is read-only', r.text.includes('Only the owner'));
cookie = '';
r = await req('/login', { method: 'POST', body: { email: 'demo@example.com', password: 'demo-password-1234' } }); check('demo logs in', r.status === 302 && cookie);
r = await req('/contacts/new', { method: 'POST', body: { _csrf: csrfOf((await get('/contacts')).text), _once: 'demo-try-12345678901234', name: 'Nope' } }); check('demo POST → 403', r.status === 403);
// logout invalidates the session row; replaying the old cookie must fail
cookie = ownerCookie; const old = cookie;
r = await req('/logout', { method: 'POST', body: { _csrf: csrfOf((await get('/')).text) } }); check('logout redirects', r.status === 302);
cookie = old; r = await get('/'); check('old cookie after logout is rejected', r.status === 302 && r.location === '/login');
// recovery code resets password and kills sessions
cookie = ''; r = await req('/login', { method: 'POST', body: { email: 'owner@example.com', password: 'owner-password-123' } }); const s1 = cookie;
cookie = ''; r = await req('/recover', { method: 'POST', body: { _once: 'rec-1234567890123456', email: 'owner@example.com', code: codes[0], password: 'new-owner-password-1' } }); check('recovery code accepted', r.status === 200 && r.text.includes('Password reset'));
cookie = s1; r = await get('/'); check('previous owner session revoked after recovery', r.status === 302);
cookie = ''; r = await req('/recover', { method: 'POST', body: { _once: 'rec-2234567890123456', email: 'owner@example.com', code: codes[0], password: 'new-owner-password-2' } }); check('a used recovery code is refused', r.status === 401);
r = await req('/login', { method: 'POST', body: { email: 'owner@example.com', password: 'new-owner-password-1' } }); check('login with the new password', r.status === 302 && cookie);
// lost-access: e-mail alone is not enough
r = await req('/lost-access', { method: 'POST', body: { _once: 'la-12345678901234567', code: 'anything-the-attacker-types', email: 'owner@example.com', password: 'attacker-password-123' } }); check('lost-access refuses a code that is not in the environment', r.status === 403);
// backup → bytes
r = await fetch(BASE + '/settings/backup', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrfOf((await get('/settings')).text) }) });
const zip = Buffer.from(await r.arrayBuffer()); check('backup downloads a zip', r.status === 200 && zip.subarray(0, 2).toString() === 'PK', `${zip.length} bytes`);
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (process.env.SAVE_BACKUP) (await import('node:fs')).writeFileSync(process.env.SAVE_BACKUP, zip);
process.exit(failed ? 1 : 0);
