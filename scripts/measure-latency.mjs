// File: scripts/measure-latency.mjs · Node 22
// Latency of listMonth and report from this machine, sequential, after a warm-up. Writes every observation to a CSV.
//   node scripts/measure-latency.mjs [--runs 100] [--warmup 10] [--month 2026-09] [--out docs/evidence/latency.csv]
import { writeFileSync } from 'node:fs';
import { loadEnv, args, login, fn, readCredentials } from './lib.mjs';

const env = loadEnv();
const a = args();
const runs = Number(a.runs) || 100, warmup = Number(a.warmup) || 10;
const month = a.month || '2026-09';
const creds = readCredentials();
const user = process.env.VIEWER_USER || 'demo';
const session = await login(env, user, process.env.VIEWER_PASSWORD || creds[user]?.password);

const cases = {
  listMonth: { month },
  report: { from: `${month.slice(0, 4)}-04-01`, to: `${month}-30`, basis: 'cash' },
};
const rows = [['function', 'run', 'ms', 'ok']];
const stats = {};
for (const [name, params] of Object.entries(cases)) {
  for (let i = 0; i < warmup; i++) await fn(env, name, params, session);
  const ms = [];
  for (let i = 1; i <= runs; i++) {
    const t = performance.now();
    const r = await fn(env, name, params, session);
    const d = performance.now() - t;
    ms.push(d);
    rows.push([name, i, d.toFixed(1), r.ok]);
  }
  ms.sort((x, y) => x - y);
  const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  stats[name] = { runs, min: ms[0].toFixed(0), p50: q(0.5).toFixed(0), p95: q(0.95).toFixed(0), max: ms[ms.length - 1].toFixed(0), mean: (ms.reduce((s, x) => s + x, 0) / ms.length).toFixed(0) };
}
const out = a.out || `docs/evidence/latency-${new Date().toISOString().slice(0, 10)}.csv`;
writeFileSync(out, rows.map((r) => r.join(',')).join('\n') + '\n');
console.log(`measured ${new Date().toISOString()} from this machine, sequential, warm-up ${warmup}, ${runs} runs each, role ${user}`);
console.table(stats);
console.log(`observations → ${out}`);
