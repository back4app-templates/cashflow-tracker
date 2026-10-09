# Attaching your own domain

Why: your invoices get a share link on `https://<your-app>.b4a.run/share/…`. Most browsers open it without complaint, but
some security tools flag all `*.b4a.run` hosts (seen with NordVPN Threat Protection, 2026-10-09). With your own domain the
link reads `https://invoices.yourcompany.com/share/…`.

1. Back4app dashboard → your app → *Settings → Domains → Add domain* → type the name you want, e.g. `invoices.yourcompany.com`.
   The page shows the value to point a **CNAME** record at (your app's `b4a.run` hostname). SSL is issued automatically.
2. At the company that manages your domain (registrar or DNS host), add a CNAME record: **name** `invoices`,
   **target** the `….b4a.run` hostname from step 1. Where to click: *GoDaddy* → My Products → DNS; *Namecheap* → Domain
   List → Manage → Advanced DNS; *Cloudflare* → DNS → Records (turn the orange cloud off for this record); *Squarespace /
   Google Domains* → DNS → Custom records.
3. Wait a few minutes, reload the Domains page: it turns green when the certificate is issued.

If you would rather ask your registrar's support, send them this:

> Please add a DNS record to my domain `yourcompany.com`: type CNAME, name `invoices`, target `<your-app>.b4a.run`,
> TTL automatic. Thank you.

The app itself needs no change: share links use whichever hostname the invoice page was opened on.
