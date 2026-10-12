// Sequential page latency from this machine as the demo user: N requests per page after a warm-up; prints p50/p95 and writes CSV.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const creds = JSON.parse(readFileSync('.credentials.local.json', 'utf8')).live, BASE = creds.base, N = Number(process.env.N || 100);
let cookie = '';
const r0 = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `email=${encodeURIComponent(creds.demo.email)}&password=${encodeURIComponent(creds.demo.password)}` });
cookie = (r0.headers.get('set-cookie').match(/fb_session=([^;]*)/))[0];
const pages = ['/', '/invoices', '/healthz'], rows = [['page', 'n', 'p50_ms', 'p95_ms', 'max_ms']], out = [];
for (const p of pages) {
  for (let i = 0; i < 5; i++) await fetch(BASE + p, { headers: { cookie } });
  const t = [];
  for (let i = 0; i < N; i++) { const s = performance.now(); const r = await fetch(BASE + p, { headers: { cookie } }); await r.text(); t.push(performance.now() - s); }
  t.sort((a, b) => a - b); const q = (f) => Math.round(t[Math.min(t.length - 1, Math.floor(f * t.length))]);
  rows.push([p, N, q(0.5), q(0.95), Math.round(t.at(-1))]); out.push(`${p}: p50 ${q(0.5)} ms · p95 ${q(0.95)} ms · max ${Math.round(t.at(-1))} ms (n=${N})`);
}
mkdirSync('docs/evidence', { recursive: true }); writeFileSync(`docs/evidence/latency-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => r.join(',')).join('\n') + '\n');
console.log(out.join('\n'));
