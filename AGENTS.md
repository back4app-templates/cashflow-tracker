# AGENTS.md — running this project end to end without a human unsticking you

This file is for an AI agent (or a developer in a hurry) that has to set up, verify or redeploy the cash flow
tracker. It lists every step, which ones are unavoidably manual, and what to hand back to a human.

## What you are deploying

- **Backend**: a Back4app app (Parse Server). Classes `Account`, `Category`, `Transaction`, `Snapshot` are closed
  to clients; all access goes through 13 Cloud functions in `cloud/main.js`. Roles: `finance` (read+write), `viewer`
  (read only). Public sign-up is disabled.
- **Web**: `server.js` (Express) serves `public/` and `/config.js`; deployed on Back4app Containers from GitHub,
  Node.js Buildpack (no Dockerfile). `Dockerfile` exists only as a fallback.

## Secrets and where they live

- `.env` (gitignored): `APP_ID`, `JS_KEY`, `REST_KEY`, `MASTER_KEY`, `SERVER_URL`. Scripts read it. Never commit it,
  never print `MASTER_KEY`.
- `.credentials.local.json` (gitignored): usernames/passwords the scripts generate. Read it to sign in; do not print it.
- The Containers app gets only `APP_ID`, `JS_KEY`, `SERVER_URL`, `DEMO` as env vars. Never give it the master key.

## Steps (in order)

| # | Step | Manual? | Command / where |
|---|---|---|---|
| 1 | Create a Back4app account | **yes** | https://www.back4app.com/signup |
| 2 | Create a backend app | **yes** (dashboard) | Dashboard → New App → *Build your Backend* → name it → Create |
| 3 | Copy keys into `.env` | **yes** | App → App Settings → Security & Keys → *Show key* for the master key |
| 4 | Create classes, CLPs, roles, users, config | no | `npm run setup -- --demo --reference-date 2026-09-30` (omit flags for a real ledger) |
| 5 | Deploy Cloud Code | **yes** (dashboard) or CLI | Dashboard → Cloud Code → upload `cloud/main.js`, `cloud/generate.js`, `cloud/package.json` → Deploy. See "Cloud Code deploy quirk" below. |
| 6 | Load data | no | `npm run seed -- --reference-date 2026-09-30` (demo) — or start empty |
| 7 | Verify | no | `npm run check -- --reference-date 2026-09-30` · `npm run check:permissions` · `npm run check:concurrency` |
| 8 | Push the repo to GitHub | no | `git push` |
| 9 | Create the Containers app | **yes** (dashboard) | Containers → Deploy a web app → GitHub repository → select repo → *Build & run* → **Node.js Buildpack** → Port 8080, Health check `/healthz` → env vars `APP_ID`, `JS_KEY`, `SERVER_URL`, `DEMO` → Create app |
| 10 | Confirm the deploy | no | `curl -s https://<app>.b4a.run/healthz` → `{"ok":true,"commit":"…"}` |
| 11 | Schedule jobs | no (REST) or dashboard | `POST /jobs/nightlySnapshot` and, demo only, `POST /jobs/reseedDemo` with the master key from any cron |

Steps marked **yes** need a browser session that belongs to the account owner; hand them back with the exact path above.

## Commands and expected output

```text
$ npm run setup -- --demo --reference-date 2026-09-30
schema Account: created
schema Category: created
schema Transaction: created
schema Snapshot: created
schema _User: updated (1 new field(s))
schema _Role: updated (0 new field(s))
role finance: created (xxxxxxxxxx)
role viewer: created (xxxxxxxxxx)
user finance: created (xxxxxxxxxx); password saved to .credentials.local.json
user demo: created (xxxxxxxxxx); password saved to .credentials.local.json
config: orgTimezone=America/New_York demo=true referenceDate=2026-09-30

$ npm run seed -- --reference-date 2026-09-30
seeded 3 accounts, 12 categories, 144 transactions (reference date 2026-09-30) in N.N s

$ npm run check -- --reference-date 2026-09-30
… PASS lines …
NN passed, 0 failed
```

If `check` prints `FAIL base() answers — Sign in to use the ledger.`, Cloud Code is not deployed or the roles were not
created: redo steps 5 and 4.

## Cloud Code deploy quirk (Back4app, observed September 2026)

On a freshly created backend, the first Deploy in the Cloud Code editor can report "Success" while shipping nothing
(Logs: `main.js not found`). Prove a deploy with a request, never with the dialog:

```text
$ curl -s -X POST https://parseapi.back4app.com/functions/base \
    -H "X-Parse-Application-Id: $APP_ID" -H "X-Parse-REST-API-Key: $REST_KEY" -H "Content-Type: application/json" -d '{}'
{"code":209,"error":"Sign in to use the ledger."}     ← Cloud Code is live (the function exists and rejects anonymous calls)
{"code":141,"error":"Invalid function: \"base\""}      ← not deployed yet
```

## Guarantees and limits (do not overstate them)

- Every rule is enforced in `beforeSave`/`beforeDelete` hooks: they are validation, **not database constraints**.
  Cross-record invariants (unique names, "account in use", "at least one account") are not guaranteed under concurrent
  writes. `npm run check:concurrency` shows the window.
- `report` is capped at 24 months; `listMonth` returns at most 2,000 rows and `report` at most 20,000 items — beyond
  that the function returns `LIMIT_EXCEEDED` with the count instead of a truncated list. Totals are always computed over
  the full dataset with aggregate pipelines.
- No platform rate limiting is configured by this template.
- Nightly snapshots live in the same backend; `npm run export` is the off-platform copy.

## Permission boundaries

- Never paste credentials into chat, logs, commits or screenshots.
- Never create users with the master key except through `scripts/users.mjs` / `setup.mjs`.
- Never run `seed --force` or `restore --force` against a backend you did not create for this purpose.
