// Scale run against a live deployment through its own forms: N invoices (3 lines each), ~2 payments per invoice, in parallel
// batches. Takes a backup first (saved under .local/) so the dataset can be removed again with Settings → Restore.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const creds = JSON.parse(readFileSync('.credentials.local.json', 'utf8')).live, BASE = creds.base;
const N = Number(process.env.N || 1000), PAR = Number(process.env.PAR || 6);
let cookie = '';
const enc = (o) => Object.entries(o).flatMap(([k, v]) => [].concat(v).map((x) => `${encodeURIComponent(k)}=${encodeURIComponent(x)}`)).join('&');
const req = async (p, o = {}) => { for (let a = 0; a < 3; a++) { try { const r = await fetch(BASE + p, { method: o.method || 'GET', redirect: 'manual', headers: { cookie, ...(o.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: o.body ? enc(o.body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/fb_session=([^;]*)/); if (m) cookie = `fb_session=${m[1]}`; } return { status: r.status, text: await r.text(), location: r.headers.get('location') }; } catch (e) { if (a === 2) throw e; await new Promise((s) => setTimeout(s, 500)); } } };
const csrf = (t) => (t.match(/name="_csrf" value="([^"]*)"/) || [])[1], once = (t) => (t.match(/name="_once" value="([^"]*)"/) || [])[1];
const post = async (p, f, fp = p) => { const g = await req(fp); return req(p, { method: 'POST', body: { _csrf: csrf(g.text), _once: once(g.text), ...f } }); };
await req('/login', { method: 'POST', body: { email: creds.owner.email, password: creds.owner.password } });
mkdirSync('.local', { recursive: true });
const b = await fetch(BASE + '/settings/backup', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: enc({ _csrf: csrf((await req('/settings')).text) }) });
writeFileSync('.local/pre-scale-backup.zip', Buffer.from(await b.arrayBuffer())); console.log('pre-scale backup saved');
const contacts = [...(await req('/contacts')).text.matchAll(/\/contacts\/(\d+)"/g)].map((m) => m[1]);
const t0 = Date.now(); let made = 0, paid = 0, failed = 0;
const one = async (i) => {
  const cid = contacts[i % contacts.length];
  const r = await post('/invoices/new', { contact_id: cid, desc: [`Service ${i}-a`, `Service ${i}-b`, `Service ${i}-c`], qty: ['1', '2', '1.5'], unit: ['120.00', '45.50', '80.00'] });
  if (r.status !== 302) { failed++; return; }
  const id = r.location.split('/').pop();
  const ir = await post(`/invoices/${id}/issue`, {}, `/invoices/${id}`); if (ir.status !== 302) { failed++; return; } made++;
  for (const amt of ['100.00', '50.00']) { const pr = await post('/payments/new', { invoice_id: id, contact_id: cid, direction: 'received', amount: amt, paid_on: '2026-10-0' + (1 + (i % 9)), method: 'card' }, `/payments/new?invoice=${id}`); if (pr.status === 302) paid++; else failed++; }
};
for (let i = 0; i < N; i += PAR) { await Promise.all(Array.from({ length: Math.min(PAR, N - i) }, (_, k) => one(i + k))); if ((i / PAR) % 20 === 0) process.stdout.write(`${made} invoices, ${paid} payments, ${failed} failed, ${Math.round((Date.now() - t0) / 1000)} s\n`); }
console.log(`done: ${made} invoices, ${paid} payments, ${failed} failed in ${Math.round((Date.now() - t0) / 1000)} s`);
