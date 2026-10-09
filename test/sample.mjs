// Sample data on the dev instance: add, verify tags, block removal while a real row references a sample contact, then remove.
const BASE = process.env.BASE || 'http://localhost:8080'; let cookie = '', passed = 0, failed = 0;
const check = (n, ok, x = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ` — ${x}` : ''}`); };
const enc = (o) => Object.entries(o).flatMap(([k, v]) => [].concat(v).map((x) => `${encodeURIComponent(k)}=${encodeURIComponent(x)}`)).join('&');
const req = async (p, o = {}) => { const r = await fetch(BASE + p, { method: o.method || 'GET', redirect: 'manual', headers: { cookie, ...(o.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: o.body ? enc(o.body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/fb_session=([^;]*)/); if (m) cookie = m[1] ? `fb_session=${m[1]}` : ''; } return { status: r.status, text: await r.text(), location: r.headers.get('location') }; };
const csrf = (t) => (t.match(/name="_csrf" value="([^"]*)"/) || [])[1], once = (t) => (t.match(/name="_once" value="([^"]*)"/) || [])[1];
const post = async (p, fields, formPath = p) => { const f = await req(formPath); return req(p, { method: 'POST', body: { _csrf: csrf(f.text), _once: once(f.text), ...fields } }); };
await req('/login', { method: 'POST', body: { email: 'owner@example.com', password: 'new-owner-password-1' } });
let r = await req('/contacts'); const before = (r.text.match(/\/contacts\/\d+"/g) || []).length;
r = await post('/settings/sample/add', {}, '/settings'); check('add sample data redirects home', r.status === 302);
r = await req('/'); check('This week shows sample numbers', r.status === 200 && r.text.includes('Overdue invoices (') && !r.text.includes('Overdue invoices (0)'));
r = await req('/contacts'); const after = (r.text.match(/\/contacts\/\d+"/g) || []).length; check('11 sample contacts added', after - before === 11, `${before} → ${after}`);
const sampleBadges = (r.text.match(/>sample</g) || []).length; check('sample contacts are badged', sampleBadges === 11, `${sampleBadges}`);
r = await req('/settings'); check('settings shows counts and the remove button', /24 invoices/.test(r.text) && r.text.includes('Remove sample data'));
// a real invoice for a sample contact blocks removal
const sampleContact = ((await req('/contacts')).text.match(/\/contacts\/(\d+)">[^<]*<\/a> <span class="badge muted">sample/) || [])[1];
r = await post('/invoices/new', { contact_id: sampleContact, desc: 'Real work', qty: '1', unit: '100.00' }); const realInv = r.location.split('/').pop();
r = await req('/settings'); check('removal blocked while a real invoice points at a sample contact', r.text.includes('Removal is blocked') && r.text.includes('invoicesOnSampleContacts: 1'));
r = await post(`/invoices/${realInv}/delete`, {}, `/invoices/${realInv}`);
r = await post('/settings/sample/remove', {}, '/settings'); r = await req('/contacts'); const final = (r.text.match(/\/contacts\/\d+"/g) || []).length;
check('after deleting the real draft, removal works and real contacts stay', final === before, `${final} vs ${before}`);
r = await req('/invoices'); check('real invoices survive (INV-…-0001 still there)', r.text.includes('-0001'));
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
