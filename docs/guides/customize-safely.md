# Customize safely (with or without an AI assistant)

Only three files are yours to change, all in `custom/`: `theme.css` (colors, fonts), `labels.json` (app name, the words
"Invoice", "Bill", "This week", the line under every invoice) and an optional `logo.png` / `logo.svg`. Everything else is
the template's and gets replaced by updates. Company name, address, tax and the invoice footer are **settings inside the
app**, not files.

How to change a file from the browser: open your fork on GitHub → `custom/` → the file → pencil icon → edit → *Commit
changes*. Back4app deploys it within about a minute. To undo: the commit's page → *Revert*, or edit the file back.

Prompt to paste into ChatGPT or Claude, followed by the file's contents:

> I run a small-business invoicing app built from the Firmbook template. Only change files inside `custom/` —
> `custom/theme.css`, `custom/labels.json` and `custom/logo.*`. Do not propose changes to any other file, to the PostgreSQL
> schema, to Express routes or to migrations. If what I ask cannot be done inside `custom/`, say so and stop.
> Here is my request: [e.g. make the buttons dark green and rename "Invoice" to "Statement"]. Return the complete new file.

Changes to how the app calculates or stores data are not something to do from the browser or with a prompt: they need a
developer who can run the tests (`test/run-all.sh`) and understand migrations.
