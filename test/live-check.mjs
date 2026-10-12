// Read-only-ish checks against the live deployment: demo role, share link headers, staff limits, backup download, pages.
import { readFileSync } from 'node:fs';
const creds = JSON.parse(readFileSync('.credentials.local.json', 'utf8')).live; const BASE = creds.base;
let cookie = '', passed = 0, failed = 0; const check = (n, ok, x = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ` — ${x}` : ''}`); };
const enc = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const req = async (p, o = {}) => { const r = await fetch(BASE + p, { method: o.method || 'GET', redirect: 'manual', headers: { cookie, ...(o.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: o.body ? enc(o.body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/fb_session=([^;]*)/); if (m) cookie = m[1] ? `fb_session=${m[1]}` : ''; } return { status: r.status, text: await r.text(), location: r.headers.get('location'), headers: r.headers }; };
const csrf = (t) => (t.match(/name="_csrf" value="([^"]*)"/) || [])[1], once = (t) => (t.match(/name="_once" value="([^"]*)"/) || [])[1];
const login = async (u) => { cookie = ''; return req('/login', { method: 'POST', body: { email: u.email, password: u.password } }); };
let r = await req('/'); check('anonymous → login', r.status === 302 && r.location === '/login');
r = await req('/setup'); check('setup page closed', r.status === 302);
r = await login(creds.demo); check('demo logs in', r.status === 302 && cookie);
for (const p of ['/', '/invoices', '/invoices?f=overdue', '/payments', '/bills', '/contacts', '/settings']) { r = await req(p); check(`demo GET ${p} → 200`, r.status === 200 && !/Something went wrong/.test(r.text)); }
r = await req('/invoices'); const invId = (r.text.match(/\/invoices\/(\d+)"/) || [])[1]; const issued = (r.text.match(/\/invoices\/(\d+)">INV-/) || [])[1];
r = await req('/contacts/new', { method: 'POST', body: { _csrf: csrf((await req('/contacts')).text), _once: 'demo-live-1234567890123', name: 'Nope' } }); check('demo cannot write (403)', r.status === 403);
r = await login(creds.staff); r = await req(`/invoices/${issued}`); check('staff sees the issued invoice', r.status === 200 && r.text.includes('Record a payment') || r.text.includes('Create share link'));
r = await req('/settings'); check('staff settings read-only', r.text.includes('Only the owner'));
r = await login(creds.owner); const page = await req(`/invoices/${issued}`);
r = await req(`/invoices/${issued}/share`, { method: 'POST', body: { _csrf: csrf(page.text), _once: once(page.text), enable: '1' } });
r = await req(`/invoices/${issued}`); const token = (r.text.match(/\/share\/([A-Za-z0-9_-]{40,})/) || [])[1]; check('owner created a share link', !!token);
const saved = cookie; cookie = ''; r = await req(`/share/${token}`);
check('share page public over HTTPS with noindex + no-referrer + no-store', r.status === 200 && /noindex/.test(r.headers.get('x-robots-tag') || '') && r.headers.get('referrer-policy') === 'no-referrer' && /no-store/.test(r.headers.get('cache-control') || ''));
check('share page has no navigation and no third-party assets', !r.text.includes('class="top"') && !/https?:\/\/(?!firmbook)/.test(r.text.replace(/github\.com\/templates-back4app\/firmbook/g, '')));
cookie = saved;
r = await fetch(BASE + '/settings/backup', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: enc({ _csrf: csrf((await req('/settings')).text) }) });
const zip = Buffer.from(await r.arrayBuffer()); check('backup downloads from the live app', r.status === 200 && zip.subarray(0, 2).toString() === 'PK', `${zip.length} bytes`);
r = await req('/healthz'); check('healthz hides first-run details once set up', !r.text.includes('firstRun'));
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
