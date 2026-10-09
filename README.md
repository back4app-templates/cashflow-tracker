# Cash flow tracker on Back4app

A single-organization cash book — transactions, running balances per day, income and expenses by category — with
sign-in, server-enforced rules and a read-only demo. Three screens, no framework, no bundler. The backend is a
Back4app app (Parse Server) whose classes are closed to clients: every read and write goes through 13 Cloud
functions. The web app is a 40-line Express server deployed on Back4app Containers straight from this repository,
built with the Node.js Buildpack — no Dockerfile to write.

> Article: link added at publication. · Live demo: link added at publication (read-only sign-in below).

**What it is not:** multi-tenant SaaS, bank sync, an audit trail, or double-entry accounting. It is a customizable
internal-tool starter; `docs/api.md` → *Guarantees* says exactly what is and is not enforced.

## Try the demo

Live demo: **https://cashflowtracker-yg1lw573.b4a.run** — sign in with username `demo` and password `bluefin-demo-2026`
(read only; the account is locked so nobody can change its password). The data is fictitious ("Bluefin Studio, LLC")
and is regenerated every night at 03:15 UTC.

## Deploy your own (about 20 minutes)

1. **Sign up** at https://www.back4app.com/signup and create a backend app: *New App → Build your Backend*.
2. **Keys**: *App Settings → Security & Keys*. Copy `.env.example` to `.env` and fill `APP_ID`, `JS_KEY`, `REST_KEY`,
   `MASTER_KEY`.
3. **Set up the backend** (classes, permissions, roles, first users, config) — nothing to click:
   ```bash
   npm install
   npm run setup
   ```
   Add `-- --demo --reference-date 2026-09-30` to reproduce the demo exactly. Generated passwords land in
   `.credentials.local.json` (gitignored).
4. **Deploy Cloud Code**: *Cloud Code* in the dashboard → upload the three files in `cloud/` → Deploy. Verify with a
   request, not the dialog (see `AGENTS.md`).
5. **Load data** (optional): `npm run seed` loads the fictitious dataset. Skip it for an empty ledger.
6. **Verify**: `npm run check` (business rules against independently computed numbers), `npm run check:permissions`
   (the permission matrix), `npm run check:concurrency` (what hooks cannot guarantee).
7. **Deploy the web app**: push this repo to GitHub → Back4app Containers → *Deploy a web app* → your repository →
   *Build & run* → **Node.js Buildpack** → port `8080`, health check `/healthz` → environment variables `APP_ID`,
   `JS_KEY`, `SERVER_URL` (and `DEMO=true` only for a public demo) → Create app.
8. **Confirm**: `curl https://<your-app>.b4a.run/healthz` returns `{"ok":true,"version":"…"}`. Sign in with the
   `finance` user from `.credentials.local.json`.

Cost as tested: numbers added at publication (backend plan, Containers plan, what happens at the quota).

## How it works

| Layer | Does | Does not |
|---|---|---|
| Browser (`public/`) | Renders 3 screens + sign-in; calls Cloud functions through the Parse JS SDK; hides controls the role cannot use | Touch any class directly; decide anything on its own |
| Backend (`cloud/`) | Users, sessions, roles; all validation in `beforeSave`/`beforeDelete` hooks; balances and reports with aggregate pipelines; nightly snapshot job | Expose classes to clients (CLPs: master key only) |
| Containers (`server.js`) | Serves the SPA, `/config.js` from env vars, `/healthz` with the running version | Hold the master key; run business logic |

- Dates are `YYYY-MM-DD` strings; `Transaction.date = paidDate ?? dueDate` is maintained at write time so a month is
  one indexed range query and the aggregate pipelines stay single-pass.
- Money is integer cents everywhere.
- "Mark as paid" records **today** in the organization timezone (`Config.orgTimezone`), never the due date.
- Totals are always computed over the full dataset; lists are complete or return `LIMIT_EXCEEDED`, never truncated.

## Scripts

| Command | What |
|---|---|
| `npm run setup` | idempotent backend setup (schema, CLPs, roles, users, config) |
| `npm run seed` | load the deterministic fictitious dataset (`--force` replaces, `--size large` for limit tests) |
| `npm run check` | business-rule verification against the live backend |
| `npm run check:permissions` | 4 callers × 13 functions, direct class access, roles, identities, sign-up |
| `npm run check:concurrency` | the races hooks cannot close, demonstrated |
| `npm run users -- list \| add \| set-password \| remove` | administrator user management |
| `npm run export` / `npm run restore <file>` | off-platform copy and rebuild into another backend |
| `npm run generate -- --reference-date …` | print the dataset as JSON |

## Project layout

```
cloud/main.js          13 Cloud functions, hooks, 2 jobs
cloud/generate.js      deterministic demo dataset (shared with scripts)
public/                index.html, app.js, style.css — the SPA
server.js              Express: static files, /config.js, /healthz
scripts/               setup, seed, check*, users, export, restore, generate
docs/api.md            function contracts, error codes, guarantees
AGENTS.md              step list for agents: what is manual, what to hand back
Dockerfile             fallback only; the Containers app uses the Node.js Buildpack
```

Published by Back4app Engineering.
