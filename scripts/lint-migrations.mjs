// Migrations run inside one transaction per release, so they may only contain transactional statements.
import { readdirSync, readFileSync } from 'node:fs';
const FORBIDDEN = [/create\s+index\s+concurrently/i, /drop\s+index\s+concurrently/i, /alter\s+type\s+\S+\s+add\s+value/i, /\bvacuum\b/i, /\bcluster\b/i, /create\s+database/i, /drop\s+database/i, /create\s+tablespace/i, /\bcommit\b/i, /\brollback\b/i, /\bbegin\b/i];
let bad = 0;
for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
  if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(f)) { console.log(`FAIL ${f}: name must be NNN_snake_case.sql`); bad++; continue; }
  const sql = readFileSync(`migrations/${f}`, 'utf8').replace(/--.*$/gm, '');
  const hits = FORBIDDEN.filter((re) => re.test(sql));
  if (hits.length) { console.log(`FAIL ${f}: non-transactional or transaction-control statement (${hits.map(String).join(', ')})`); bad++; } else console.log(`ok   ${f}`);
}
process.exit(bad ? 1 : 0);
