#!/bin/bash
# A release whose second migration fails must apply nothing and serve the generic unavailable page; a newer schema must be refused.
set -u; export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH
DB=firmbook_mig PORT=8097 DIR=$(mktemp -d)
psql -p 5433 -d postgres -qc "drop database if exists $DB" && psql -p 5433 -d postgres -qc "create database $DB"
cp migrations/001_init.sql "$DIR/"; printf 'create table extra_ok (id serial primary key);\n' > "$DIR/002_extra.sql"; printf 'create table broken (id int references nope(id));\n' > "$DIR/003_broken.sql"
pass=0; fail=0; chk(){ if [ "$2" = 1 ]; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1 — $3"; fi; }
DATABASE_URL=postgres://localhost:5433/$DB SETUP_SECRET="mig setup secret words here" PORT=$PORT MIGRATIONS_DIR=$DIR node server.js > /tmp/firmbook-mig.log 2>&1 & P=$!; sleep 2
H=$(curl -s localhost:$PORT/healthz); chk "healthz reports maintenance=migration-failed (503)" $([[ "$H" == *'"maintenance":"migration-failed"'* ]] && echo 1 || echo 0) "$H"
B=$(curl -s -o /dev/null -w '%{http_code}' localhost:$PORT/); chk "home page answers 503" $([ "$B" = 503 ] && echo 1 || echo 0) "$B"
T=$(curl -s localhost:$PORT/setup); chk "unavailable page has no error text or SQL" $([[ "$T" == *"Temporarily unavailable"* && "$T" != *"nope"* && "$T" != *"relation"* ]] && echo 1 || echo 0) "$(echo "$T" | head -c 200)"
L=$(grep -c "MIGRATION FAILED" /tmp/firmbook-mig.log); chk "runtime log carries the reason" $([ "$L" -ge 1 ] && echo 1 || echo 0) "$L"
A=$(psql -p 5433 -d $DB -Atc "select string_agg(version, ',') from schema_migrations"); chk "nothing of the release applied (schema_migrations has only 001 or nothing)" $([[ "$A" != *002* && "$A" != *003* ]] && echo 1 || echo 0) "applied=$A"
E=$(psql -p 5433 -d $DB -Atc "select count(*) from information_schema.tables where table_name='extra_ok'"); chk "table from the first (good) migration does not exist" $([ "$E" = 0 ] && echo 1 || echo 0) "$E"
kill $P; sleep 1
rm "$DIR/003_broken.sql"
DATABASE_URL=postgres://localhost:5433/$DB SETUP_SECRET="mig setup secret words here" PORT=$PORT MIGRATIONS_DIR=$DIR node server.js > /tmp/firmbook-mig2.log 2>&1 & P=$!; sleep 2
H=$(curl -s localhost:$PORT/healthz); chk "corrected release boots and applies 002" $([[ "$H" == *'"schema":"002"'* && "$H" == *'"maintenance":null'* ]] && echo 1 || echo 0) "$H"
kill $P; sleep 1
psql -p 5433 -d $DB -qc "insert into schema_migrations (version) values ('099')"
DATABASE_URL=postgres://localhost:5433/$DB SETUP_SECRET="mig setup secret words here" PORT=$PORT MIGRATIONS_DIR=$DIR node server.js > /tmp/firmbook-mig3.log 2>&1 & P=$!; sleep 2
H=$(curl -s localhost:$PORT/healthz); chk "older code on a newer schema refuses to run (schema-newer)" $([[ "$H" == *'"maintenance":"schema-newer"'* ]] && echo 1 || echo 0) "$H"
kill $P; rm -rf "$DIR"
echo; echo "$pass passed, $fail failed"; [ $fail = 0 ]
