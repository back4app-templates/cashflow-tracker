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
