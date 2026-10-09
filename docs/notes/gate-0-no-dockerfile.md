# Gate 0 — deploy without a Dockerfile (verified 2026-10-08, ~15:35 UTC)

Observed in https://containers.back4app.com/new-container, logged-in account, flow "Deploy a web app",
step 2 "Configure app", section "Build & run" (badge DETECTED), button Edit.

Sources offered at step 1: "GitHub repository — Build from your source code", "Docker Hub image — Deploy a prebuilt
image, public or private", "Upload files — Drag a folder from your computer".

Build method (radio):
- "Dockerfile — You control the runtime, dependencies and environment."
- "Node.js Buildpack — Back4app builds and updates the image for you — no Dockerfile needed."
  When selected: "Your Dockerfile won't be used — this app is built with Buildpacks."
  Fields: Runtime Version (placeholder "22"), Start Command (placeholder "e.g. gunicorn app:app";
  helper "We read this project as starting with node server.js. Use it" — detected from the repo),
  Port (placeholder 8080), Health check (default "/").
Only Node.js appeared as a buildpack on this date (no Python/other option shown).

Plans at creation: Free — "0.25 vCPU · 256 MB · URL expires", $0.00. Starter — "0.5 vCPU · 512 MB · always on",
$5.00/month, "Charged $5.00 now, then monthly. Cancel anytime."
Add-on: "Database — PostgreSQL · 1 GB — Requires Starter plan — +$5/mo".
Deploy settings: Auto deploy on push (Off by default), Environment variables.

Public docs (https://www.back4app.com/docs-containers/get-started) on the same date still say a Dockerfile is
mandatory. Flow was cancelled; nothing created.

# Backend app created 2026-10-08 (~16:10 UTC)

Dashboard → New App → "Build your Backend" → name "cashflow-tracker" → Create. Ready in < 10 s.
App id 37683719-6045-45c0-868e-19ee7f4e12bb · Parse Server 7.5.2 · MongoDB 3.6 · USA East · Free plan
(Plan Usage card: "Requests / Month 0 / 25 K · Storage 1 GB · Database Storage 0.25 GB").

Observation (candidate for the article, verify before citing): the Overview's Security card warns
"The latest stable Parse Server version supported by Back4App is 6.2.0 and the app is still using the version 7.5.2.
Please consider upgrading…" — the warning text is inverted for a newly created 7.5.2 app.
Overview also offers "MCP · Connect your AI agent" and a "BACKEND AGENT" side panel.

# Containers app created 2026-10-08 14:34:33Z (click "Create app"), Free plan
id 9aec08a0-bf4c-45a3-afe1-13d8a51a9a59 · https://cashflowtracker-yg1lw573.b4a.run · source back4app-templates/cashflow-tracker main
Build: Node.js Buildpack · "Runtime Version" placeholder showed ">=22" (read from package.json engines) · start command
detected "node server.js" ("Use it") · port 8080 · health check /healthz · 4 env vars (APP_ID, JS_KEY, SERVER_URL, DEMO).
Observations:
- Step 2 pre-filled "Environment variables: 2 set" from .env.example (APP_ID, JS_KEY with empty values) — removed and re-added via "Paste .env".
- "Auto deploy on push — Available on paid plans — turning it on selects Starter." (Free plan: manual deploys only.)
- Free overview: "Temporary URL Active — URL is temporary and will be live for 60 minutes · Upgrade for a Permanent URL"; plan line "0.25 vCPU · 256MB · 100 GB transfer".
- Deployment log first lines: PREPARING DEPLOYMENT → FETCHING GITHUB REPOSITORY → "Build Method: Buildpacks — detecting your app stack" →
  BUILDING IMAGE → "Back4app: using Node 22, pinned in your app's settings." → "Detecting your app's stack..." → "Preparing build without layer reuse...".
- Repo visibility: a repo created after the GitHub App install does NOT appear in Containers until the GitHub→Back4app
  setup redirect runs ("Importing repositories…"); "All repositories" alone was not enough, a push did not help either.
  Trigger: change the installation's repository selection on GitHub and Save (redirects to containers.back4app.com/new-container?installation_id=…&setup_action=update).

# First deploy timeline (Free plan, Node.js Buildpack, from the Containers deployment log, UTC, 2026-10-08)
click "Create app" ≈14:34:33 (local clock) · 14:34:40.830 PREPARING DEPLOYMENT · 14:34:41.180 "Build Method: Buildpacks — detecting your app stack"
· 14:34:51.864 Building your app (Node.js: detected range `22`, resolved 22.23.2, npm 10.9.8, `npm ci` 1.2 s, `npm prune`, "No build scripts found",
"Adding default web process for `npm start`", "Back4app: default web process set to: node server.js", build finished in 4.3 s)
· 14:34:57.574 Pushing image · 14:35:19.249 LAUNCHING CONTAINER ("Using port 8080 (from the Port setting)") · 14:35:37.917 CHECKING HEALTH
("trying to hit the 8080 port using http") · 14:35:39.603 DEPLOYMENT READY.
→ PREPARING → READY = 58.8 s; click → READY ≈ 66 s. /healthz answered {"ok":true,"version":"0.1.1","commit":"unknown"} (buildpack exposes no commit env).
Note: the health check line says it hits the port over http — a port check, as observed on earlier apps; do not claim path-based checks.

# Cloud Code deploy, 2026-10-09 (dashboard editor, files loaded from the public mirror via fetch + Monaco setValue)
- Deploy #1 12:31:04Z: dialog "Deploying… / Success on deploying your changes!" but System Logs at 12:31:11Z:
  "Warning: main.js not found: to run any cloud code functions you need first to create a main.js file"; /functions/base → 141 "Invalid function" for 3+ min.
- Re-marked both files as pending (setValue with a trailing newline → "Files pending deploy (2)"), Deploy #2 12:35:18Z → /functions/base answered 209 at 12:35:20Z.
  Same first-deploy-ships-nothing behavior seen on earlier apps (Sept 2026). The dialog is not proof; the request is.
- "Upload → Upload Files" opens a native file dialog (not scriptable); cloud/package.json was not uploaded (no deps, not needed).

# Verification results 2026-10-09 (default dataset, reference date 2026-09-30, backend Free plan, USA East)
- check.mjs: 159 passed, 0 failed (balances, month lists, running balances, reports cash+accrual, all rules).
- check-permissions.mjs: 82 passed (4 callers × 13 functions; direct class access 119; roles 119; locked demo identity 119;
  regular user editing another user → 206 "not own session" — still a denial; public sign-up 119; reset request for demo accepted).
- check-concurrency.mjs (10 parallel): duplicate names 1 of 10 created (hooks serialized by timing, not a guarantee);
  delete vs 10 creates: delete rejected 119 because creates landed first, account survived, consistent; double submit: 2 rows stored.
- Large dataset (3,744 rows, 3,627 in the reference month): seed 51.5 s; listMonth → 142 LIMIT_EXCEEDED (all accounts and Operating checking),
  report totals still exact over the full dataset; 147 passed. Reseed back to default 42.0 s (deleting 3,744 first).
- Latency (100 sequential runs each after 10 warm-ups, from the author's machine in Brazil to USA East, role demo):
  listMonth p50 439 ms · p95 514 ms (min 420, max 541); report p50 442 · p95 542 (min 424, max 602). CSV in docs/evidence.
- nightlySnapshot via POST /jobs (master key): HTTP 200; Snapshot row 41,541 bytes, counts 3/12/144, ACL {}; anonymous read → 119.
- export.mjs → exports/export-2026-10-09T12-45-25-880Z.json (3/12/144).

# Restore drill 2026-10-09 (second backend "cashflow-tracker-restore", id 2248bfcf-e798-4d01-afa2-9eea6db7b5d4, Free)
- setup.mjs --env .env.restore: classes/CLPs/roles/users/config created in one run.
- Cloud Code on the fresh backend: deploy #1 12:48:36Z and #2 12:49:29Z both logged "main.js not found" — #2 was clicked without the
  "Files pending deploy" badge (setValue after the Success dialog did not mark files dirty). After a page reload + re-marking (badge "2"),
  deploy #3 at 12:54:48Z answered 209 at 12:54:50Z. Rule: only a deploy that starts with the pending badge ships files; verify by request.
- restore.mjs from exports/export-2026-10-09T12-45-25-880Z.json → see check-restore log for the result.

# Observation 2026-10-09 ~15:05 UTC — NordVPN Threat Protection Pro blocks *.b4a.run as phishing (author's Mac)
Headless Chrome on the author's machine (NordVPN Threat Protection Pro enabled) rendered "Website blocked — We blocked this website
for your protection because it's a known phishing site" for https://cashflowtracker-yg1lw573.b4a.run/ AND for
https://fastapitasks-sk2podfb.b4a.run/healthz (another Containers app), while https://www.back4app.com/ loaded normally.
The Claude desktop Browser pane loaded the same demo URL fine (different network path). Reader-facing risk for every *.b4a.run demo;
report to Back4app (domain reputation with Nord's list), and consider a custom domain for the demo. Screenshots for the article were
taken from a local copy of the web app (localhost → real backend) instead.
