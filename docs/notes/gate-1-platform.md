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
