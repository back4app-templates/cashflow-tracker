# Gate 1 — platform observations (Back4app Containers + PostgreSQL add-on)

Container `firmbook`, id 2030b86b-ecf7-4e26-8bb1-71657ea217d8, https://firmbook-2by9h9dh.b4a.run.

## 2026-10-09 — first attempt at Starter + PostgreSQL

- 16:03 UTC-3: app created on Free from branch `firmbook`; deploy #1 took 1m 0s; `/healthz` → `{"ok":true,"database":"missing DATABASE_URL"}`.
- 16:14: a second deployment (#2, same commit) appeared without a push — the plan change triggered a redeploy. Deploy #1 is
  listed as "Destroyed", #2 "Ready", 1m 1s.
- 16:30: the Overview still says **Free**, "Temporary URL active — live for 60 minutes", and `/healthz` still reports
  `missing DATABASE_URL`.
- The **Database** page shows a state the docs do not describe: **"BLOCKED — This database is blocked. The plan that paid
  for it was canceled, so your app cannot connect to it and this screen cannot read it. Nothing has been deleted. Data kept
  until Oct 16 2026, after that date: backed up then dropped. Reactivating restores it in place — the same database comes
  back on your next deploy, nothing to import."** Button: *Reactivate plan*. So a database **was** provisioned by the
  upgrade and the paying plan was then canceled (billing failure or a downgrade); retention after cancellation = 7 days.
- The Overview header has an **"Instant Rollback"** button — candidate for the browser-only rollback path (§3 of the brief).
  Not exercised yet (only one live deployment).

Open: redo the upgrade (owner's action), then measure provisioning time, `DATABASE_URL` shape, max connections,
persistence, billed amount, Instant Rollback behavior, env-var change → redeploy?, share-link deliverability matrix.

## 2026-10-09 — Gate 1 results after the owner reactivated Starter + PostgreSQL (14:35 UTC)

| Item | Result |
|---|---|
| Plan page | "Billed pro rata. A plan change redeploys the app." Current: Shared 0.5 vCPU · 512 MB · 1 × PostgreSQL = **$10/mo**, renews 2026-11-09. PostgreSQL = "$5 / pack · 1 GB each", packs can be added; storage meter "Not checked yet". |
| Reactivation | "Reactivate plan" → redeploy #3 (56 s) with log line `Database ready (reuse): appdb_2030b86b…` — the blocked database came back in place, nothing re-imported. |
| What the container receives | `PGHOST=agents.containers.back4app.com`, `PGPORT=5432`, `PGUSER=app_user_<id>`, `PGPASSWORD`, `PGDATABASE=appdb_<id>` **and** `DATABASE_URL` — but `DATABASE_URL` arrived **empty**: the create form had left a user-defined `DATABASE_URL` row (empty) which shadows the platform-managed one. The env page shows two rows: "Name of the database variable / Connection string — Set by Back4app" and a user row "DATABASE_URL" with Remove. node-postgres reads the `PG*` variables on its own when no connection string is passed, so the app falls back to them (0.0.3). Lesson for the template: never pre-create a `DATABASE_URL` variable; rely on `PG*` + `DATABASE_URL` whichever is non-empty. |
| Server | PostgreSQL **18.3** on aarch64 (shared host), TLS accepted with `rejectUnauthorized:false` (`pg_stat_ssl.ssl = true`), no `PGSSLMODE` given. Empty database = 8.2 MB. |
| Connection limit | `too many connections for role "app_user_…"` after **15** extra clients while the pool held 1 → **≈16 connections per app role** (server `max_connections` = 832 is shared). Pool `max: 5` is safe; anything above ~12 is not. |
| Autodeploy | **Off** on an app created on Free; upgrading does not switch it on. Settings → Build & deploy → Autodeploy → Save → dialog "Settings saved — they take effect on the next deploy. Deploy now?" Env-var changes likewise say "A change needs a redeploy". |
| Deploy times | Dashboard "Deploy now" → `/healthz` on the new version: **67 s**. Git push (autodeploy on) → live: **68 s** (14:52:02 → 14:53:10). Build log: buildpack reuses cached Node 22.23.2 + npm cache; `npm ci` 1.4 s. |
| Instant Rollback | Overview button. Dialog text: *"The previous image runs again. It uses the app's current environment variables. The database is not rolled back: its data and schema stay as they are now."* Rollback 0.0.3 → 0.0.2 answered in **~7 s**; the dialog then offers the newer image as "previous", roll-forward answered in **~3 s**. Deployments list marks the entry "· rollback". This is the browser-only path for "the release migration failed" (§3 of the brief). |
| Persistence | `gate_probe` rows survived redeploy, rollback and roll-forward (boots = 2, first_boot unchanged). |
| Database page | A real table browser: Tables / Views / Functions, Data / Columns / Indexes / Triggers, Filter rows, Add row, Refresh, **SQL console**, **Export this page as CSV**. **No backup/restore or snapshot feature** in the dashboard → the app's own backup file is the only recovery path, as the brief assumed. |
| Custom domain | Settings → Domains: "custom domain — Point a CNAME at your Back4app subdomain. SSL is issued automatically." Button *Add domain*. (Not attached yet.) |
| Deliverability | Google Safe Browsing: "No unsafe content found" for `firmbook-2by9h9dh.b4a.run` (checked 2026-10-09). NordVPN Threat Protection still blocked `*.b4a.run` on one Mac. Browser/AV matrix pending. |
| GitHub push protection | On the public `templates-back4app/cashflow-tracker`: `secret_scanning_push_protection: disabled` at repo level (default). A fork does not inherit repo settings. The template must enable it on itself and the article must not rely on it for forks. |
| Billing | Stated $10/mo; the owner's invoice confirms the actual charge (pending). |

Still open: storage behaviour at 1 GB, add-on removal, custom-domain attach time, the browser/AV deliverability matrix, invoice.

## 2026-10-09 — environment variables and redeploys (observed while setting `SETUP_SECRET`)

- The env page says "A change needs a redeploy" and, unlike *Build & deploy*, saving does **not** offer "Deploy now".
- *App actions → Deploy the latest commit* was clicked twice (15:28 and 15:39 UTC) and produced no deployment in the list
  and no restart (`bootedAt` unchanged). Pushing a commit (autodeploy) did redeploy both times, 68–79 s to live.
  → For the article: set `SETUP_SECRET` **in the create form**, before the first deploy, so the reader never needs a manual
  redeploy. Report the inert menu item to the Containers team.
- Values typed into the env form by setting the DOM value directly were not saved ("KEY 2" showed, reload showed one row);
  typing them normally saved. Irrelevant for a human reader; relevant for anyone automating the dashboard.
