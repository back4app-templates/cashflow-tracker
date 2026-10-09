#!/bin/bash
# Runs every test group from scratch against a local PostgreSQL on port 5433 (brew postgresql@17). Exit code 0 = all green.
set -u; export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH; cd "$(dirname "$0")/.."
pkill -f 'node --env-file=.env' 2>/dev/null; pkill -f 'PORT=8098 node server.js' 2>/dev/null; sleep 1
for db in firmbook_dev firmbook_test firmbook_conc; do psql -p 5433 -d postgres -qc "drop database if exists $db" >/dev/null 2>&1; psql -p 5433 -d postgres -qc "create database $db" >/dev/null; done
node --env-file=.env server.js > /tmp/firmbook-dev.log 2>&1 & A=$!
node --env-file=.env.test server.js > /tmp/firmbook-test.log 2>&1 & B=$!
DATABASE_URL=postgres://localhost:5433/firmbook_conc SETUP_SECRET="conc setup secret words here" PORT=8098 node server.js > /tmp/firmbook-conc.log 2>&1 & C=$!
sleep 2; fail=0
run(){ echo "== $1"; shift; "$@" | tail -1; [ "${PIPESTATUS[0]}" = 0 ] || fail=1; }
run "unit: money" node --test test/money.test.mjs
run "lint: migrations" node scripts/lint-migrations.mjs
run "smoke (47 checks)" env SAVE_BACKUP=/tmp/firmbook-smoke-backup.zip node test/smoke.mjs
run "restore (13)" node test/restore.mjs
run "sample data (8)" node test/sample.mjs
run "concurrency (8)" node test/concurrency.mjs
run "migration failure (8)" ./test/migration.sh
kill $A $B $C 2>/dev/null; wait $A $B $C 2>/dev/null
echo; grep -h '^\[error\]' /tmp/firmbook-dev.log /tmp/firmbook-test.log /tmp/firmbook-conc.log | grep -v 'POST /setup/restore error' | head -5
[ $fail = 0 ] && echo "ALL GREEN" || { echo "FAILURES"; exit 1; }
