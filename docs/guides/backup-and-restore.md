# Backup and restore

**A backup is one file.** In the app open *Settings → Backup and restore → Download backup*. You get
`YYYY-MM-DD.firmbook-backup.zip` with every contact, invoice, line, payment, allocation, bill, category, setting, person
(with their password hashes and recovery-code hashes) and the audit log. Sessions, one-time form keys and reset tokens are
never included. The file is taken as one consistent snapshot even while someone is recording a payment.

**Treat the file like a bank statement.** It contains your customers' details and your people's password hashes. Keep it
where only you can read it, never e-mail it, delete old copies you no longer need.

**Restore, two ways:**

1. *Into a fresh deployment* (your app is gone, or you are moving): deploy the template again (fork → Containers →
   PostgreSQL on → `SETUP_SECRET`), open the URL, and on the first-run page choose **Restore from a backup file**, enter the
   passphrase and pick the file. Then log in with the e-mail and password you used in the old deployment.
2. *Over an existing deployment* (*Settings → Restore from a backup file*): replaces **everything** with the file's contents
   and signs everyone out, including you. Type `REPLACE` to confirm.

A backup from a newer release than the app you restore into is refused with a message naming the release to install first.
Share links in the backup stay valid; revoke any you no longer want from the invoice page.

**CSV export is not a backup.** *Export CSVs* gives you spreadsheets (contacts, invoices, items, payments, allocations,
bills) for your accountant or another tool. It cannot be restored.

**What the platform does and does not do.** The Back4app dashboard shows your tables (Database page, with a SQL console and
CSV export of a page of rows) but has no snapshot or restore button for the add-on. Your backup file is the recovery path.
