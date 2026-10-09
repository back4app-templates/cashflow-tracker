# When something breaks

Where to look in the Back4app dashboard: **Deployments** (did the last deploy succeed?), **Runtime logs** (what the app
printed, including the reason for an unavailable page), **Instant Rollback** (previous code back in seconds, database
untouched), **Database** (your tables).

| What you see | Cause | Fix |
|---|---|---|
| "Temporarily unavailable" right after an update | The release migration failed; nothing was applied | *Runtime logs* for the reason → **Instant Rollback** → report the issue |
| "Temporarily unavailable" on a brand-new app | PostgreSQL add-on not switched on (`no-database` in `/healthz`) | *Settings → Plan → Add a PostgreSQL Database pack*, then deploy again |
| Setup page says `SETUP_SECRET is not set` | The variable is missing or shorter than 12 characters | *Settings → Environment variables* → add it → save → *Deploy the latest commit* (saving a variable does not redeploy by itself) |
| "Wrong passphrase" on the setup page | The value you typed differs from the variable | Check for trailing spaces; the comparison is exact |
| Lost password, have recovery codes | — | Log in page → *Use a recovery code* (each works once; a new set appears when you change your password) |
| Lost password and codes | — | Log in page → *Lost everything?* and follow the three steps (the code must travel through the dashboard variable `OWNER_RESET_TOKEN`; it works once, within 30 minutes of the deploy that introduced it) |
| A customer's security tool flags the share link | Some tools (seen: NordVPN Threat Protection) flag `*.b4a.run` | Attach your own domain — see *Custom domain* |
| "Cannot do that" with a message | The app refused a rule (void with payments, issuing a draft without lines…) | Read the message; the audit log in Settings shows what happened |
| "This form expired" | The page was open in two tabs or the session ended | Reload and try again — nothing was saved twice |
| Nothing loads, `/healthz` says `database: unreachable` | The add-on is down or the plan was canceled (the Database page then says *blocked*) | Reactivate the plan; the database comes back in place, data kept for 7 days after cancellation |

`/healthz` on your app URL answers with the release, schema version and database state — safe to share with support.
