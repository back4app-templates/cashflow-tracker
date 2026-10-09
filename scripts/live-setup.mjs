// One-time first run of a fresh deployment over HTTP: owner account, company settings, demo + staff users, sample data.
// Usage: BASE=https://app SETUP_SECRET=... node scripts/live-setup.mjs   (writes .credentials.local.json — gitignored)
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const BASE = process.env.BASE, SECRET = process.env.SETUP_SECRET;
if (!BASE || !SECRET) throw new Error('BASE and SETUP_SECRET are required');
let cookie = '';
const enc = (o) => Object.entries(o).flatMap(([k, v]) => [].concat(v).map((x) => `${encodeURIComponent(k)}=${encodeURIComponent(x)}`)).join('&');
const req = async (p, o = {}) => { const r = await fetch(BASE + p, { method: o.method || 'GET', redirect: 'manual', headers: { cookie, ...(o.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: o.body ? enc(o.body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/fb_session=([^;]*)/); if (m) cookie = m[1] ? `fb_session=${m[1]}` : ''; } return { status: r.status, text: await r.text(), location: r.headers.get('location') }; };
const csrf = (t) => (t.match(/name="_csrf" value="([^"]*)"/) || [])[1], once = (t) => (t.match(/name="_once" value="([^"]*)"/) || [])[1];
const post = async (p, fields, formPath = p) => { const f = await req(formPath); return req(p, { method: 'POST', body: { _csrf: csrf(f.text), _once: once(f.text), ...fields } }); };
const creds = existsSync('.credentials.local.json') ? JSON.parse(readFileSync('.credentials.local.json', 'utf8')) : {};
const pw = () => randomBytes(12).toString('base64url');
const owner = { email: 'articles@back4app.com', name: 'Back4app Engineering', password: creds.live?.owner?.password || pw() };
let r = await req('/setup'); if (r.status !== 200) throw new Error(`setup page: ${r.status} ${r.location || ''}`);
r = await req('/setup', { method: 'POST', body: { _once: once(r.text), secret: SECRET, ...owner } });
if (r.status !== 200) throw new Error(`setup failed: ${r.status} ${r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
const codes = r.text.match(/[0-9a-f]{6}-[0-9a-f]{6}/g);
await post('/settings/company', { company_name: 'Juniper Lane Design Co.', company_address: '210 Market Street, Suite 4\nBurlington, VT 05401', company_email: 'hello@juniperlane.example', company_phone: '(802) 555-0142', invoice_footer: 'Payment is due within 14 days. Thank you for working with us.', timezone: 'America/New_York', currency_symbol: '$' }, '/settings');
await post('/settings/tax', { tax_label: 'Sales tax', tax_rate: '6', tax_inclusive: '0', invoice_prefix: 'INV' }, '/settings');
const demo = { email: 'demo@juniperlane.example', password: 'juniper-demo-2026', name: 'Demo Visitor' }, staff = { email: 'staff@juniperlane.example', password: creds.live?.staff?.password || pw(), name: 'Sam Staff' };
await post('/settings/users', { ...demo, role: 'demo' }, '/settings'); await post('/settings/users', { ...staff, role: 'staff' }, '/settings');
r = await post('/settings/sample/add', {}, '/settings');
const home = await req('/'); const ok = home.status === 200 && home.text.includes('Overdue invoices (');
writeFileSync('.credentials.local.json', JSON.stringify({ ...creds, live: { base: BASE, owner, staff, demo, recoveryCodes: codes, createdAt: new Date().toISOString() } }, null, 2), { mode: 0o600 });
console.log(`owner created, settings saved, demo + staff added, sample data ${r.status === 302 ? 'added' : 'FAILED'}, home ${ok ? 'renders' : 'FAILED'}; credentials in .credentials.local.json`);
