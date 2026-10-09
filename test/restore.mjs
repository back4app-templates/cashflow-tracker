// Restore into a FRESH deployment (first-run page) and Settings → Restore on an existing one. BASE_FRESH / BASE_LIVE.
import { readFileSync } from 'node:fs';
const FRESH = process.env.BASE_FRESH || 'http://localhost:8099', LIVE = process.env.BASE_LIVE || 'http://localhost:8080';
const zip = readFileSync(process.env.BACKUP || '/tmp/firmbook-smoke-backup.zip');
let passed = 0, failed = 0; const check = (n, ok, x = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ` — ${x}` : ''}`); };
function jar() { let cookie = ''; const req = async (base, path, o = {}) => { const r = await fetch(base + path, { method: o.method || 'GET', redirect: 'manual', headers: { cookie, ...(o.form ? {} : o.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: o.form || (o.body ? new URLSearchParams(o.body).toString() : undefined) }); const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/fb_session=([^;]*)/); if (m) cookie = m[1] ? `fb_session=${m[1]}` : ''; } return { status: r.status, text: await r.text(), location: r.headers.get('location') }; }; return { req, get: () => cookie, set: (c) => { cookie = c; } }; }
const csrf = (t) => (t.match(/name="_csrf" value="([^"]*)"/) || [])[1], once = (t) => (t.match(/name="_once" value="([^"]*)"/) || [])[1];

// 1. fresh deployment
let j = jar(), r = await j.req(FRESH, '/'); check('fresh app redirects to /setup', r.location === '/setup');
r = await j.req(FRESH, '/setup'); let fd = new FormData(); fd.set('_once', once(r.text)); fd.set('secret', 'wrong words'); fd.set('file', new Blob([zip], { type: 'application/zip' }), 'b.zip');
r = await j.req(FRESH, '/setup/restore', { method: 'POST', form: fd }); check('first-run restore refuses a wrong passphrase', r.status === 403);
fd = new FormData(); fd.set('_once', once((await j.req(FRESH, '/setup')).text)); fd.set('secret', 'test setup secret words here'); fd.set('file', new Blob([zip], { type: 'application/zip' }), 'b.zip');
r = await j.req(FRESH, '/setup/restore', { method: 'POST', form: fd }); check('first-run restore accepted', r.status === 200 && r.text.includes('Backup restored'), r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160));
r = await j.req(FRESH, '/setup'); check('setup page closed after restore', r.location === '/login');
r = await j.req(FRESH, '/login', { method: 'POST', body: { email: 'owner@example.com', password: 'new-owner-password-1' } }); check('owner logs in with the password from the backup', r.status === 302 && j.get());
r = await j.req(FRESH, '/invoices'); check('restored invoices are there (INV-…-0001 and a void one)', r.text.includes('-0001') && r.text.includes('>void<'));
r = await j.req(FRESH, '/payments'); check('restored payments: 2 cash movements', (r.text.match(/\/payments\/\d+"/g) || []).length === 2);
r = await j.req(FRESH, '/settings'); check('restored settings (company name) and people', r.text.includes('Bluefin Studio LLC') && r.text.includes('staff@example.com'));
r = await j.req(FRESH, '/contacts/new', { method: 'POST', body: { _csrf: csrf((await j.req(FRESH, '/contacts')).text), _once: 'after-restore-1234567890', name: 'New After Restore' } });
check('sequences continue after restore (insert works)', r.status === 302 && /\/contacts\/\d+/.test(r.location), r.location);

// 2. Settings → Restore on the live app: add a row first, restore, the row must be gone and everyone signed out
const k = jar(); r = await k.req(LIVE, '/login', { method: 'POST', body: { email: 'owner@example.com', password: 'new-owner-password-1' } });
r = await k.req(LIVE, '/contacts/new', { method: 'POST', body: { _csrf: csrf((await k.req(LIVE, '/contacts')).text), _once: 'pre-restore-12345678901', name: 'Temporary Contact' } });
r = await k.req(LIVE, '/contacts'); check('live app has the temporary contact', r.text.includes('Temporary Contact'));
const live = await k.req(LIVE, '/settings'); fd = new FormData(); fd.set('_csrf', csrf(live.text)); fd.set('_once', once(live.text)); fd.set('confirm', 'REPLACE'); fd.set('file', new Blob([zip], { type: 'application/zip' }), 'b.zip');
const before = k.get(); r = await k.req(LIVE, '/settings/restore', { method: 'POST', form: fd }); check('settings restore accepted', r.status === 200 && r.text.includes('Backup restored'));
k.set(before); r = await k.req(LIVE, '/'); check('session invalidated by restore', r.status === 302 && r.location === '/login');
r = await k.req(LIVE, '/login', { method: 'POST', body: { email: 'owner@example.com', password: 'new-owner-password-1' } }); r = await k.req(LIVE, '/contacts'); check('temporary contact gone after restore', !r.text.includes('Temporary Contact'));
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
