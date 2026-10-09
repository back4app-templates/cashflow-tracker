# Firmbook

Invoices, bills and a weekly money view for one small business. One Node.js process, one PostgreSQL database, no build step,
no Dockerfile — deployed from a GitHub fork to [Back4app Containers](https://www.back4app.com/) with the PostgreSQL add-on,
using only a browser.

**Not accounting software:** no double-entry, no bank feeds, no tax filing, one currency.

## What it does
- Contacts (customers and suppliers), invoices with line items and tax (added or included), sequential numbers per year.
- Payments are cash movements; allocations link them to invoices. Partial and over-payments, contact credit, refunds, voiding
  with the payments preserved. States are derived (draft · issued · partially paid · paid · void) plus an *overdue* flag.
- Bills with payments and categories. **This week**: due in, due out, overdue, received and paid in the last 7 days.
- Share link per invoice (random token, revocable, `noindex`, no referrer), print-to-PDF.
- Owner / staff / demo roles, server-side sessions, recovery codes, dashboard-bound owner reset.
- One-file backup (`.firmbook-backup.zip`) and restore — on first run or from Settings; CSV export for spreadsheets.
- Tagged sample data with safe removal. Audit log.
- Release-level transactional migrations; a failed update shows a generic "temporarily unavailable" page and writes the
  reason to the runtime log; `Instant Rollback` in the dashboard brings the previous code back without touching the database.

## Deploy (browser only)
1. **Fork** this repository on GitHub (not "Use this template" — a fork can be updated with *Sync fork*).
2. Back4app → Containers → *Deploy a web app* → your fork. Build method is detected as **Node.js Buildpack**. Port `8080`,
   health check `/healthz`.
3. *Database* → switch **PostgreSQL** on. *Environment variables* → add `SETUP_SECRET` = a passphrase of five unrelated words.
4. *Create app*. Open the URL as soon as the deploy is green → the first-run page asks for the passphrase and creates the
   owner account (or restores a backup). Save the recovery codes.
5. Settings → company details, tax → *Add sample data* to explore → *Remove sample data* when you start for real.

Never commit a password, key or customer detail: the repository is public. Company details live in Settings (database);
`custom/` holds only the logo, theme and labels (see `custom/README.md`).

## Local development
```bash
brew install postgresql@17 && createdb -p 5433 firmbook_dev
cp .env.example .env && npm install && npm run dev
./test/run-all.sh        # unit, lint, smoke, restore, sample data, concurrency, migration failure
```

## Guides
`docs/guides/` — backup and restore · updates · when something breaks · customize safely · custom domain.
Evidence from the platform gates: `docs/notes/`.

MIT © Back4app Engineering
