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
