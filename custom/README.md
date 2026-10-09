# custom/ — the files you may change

A release of the template never modifies this folder, so your edits here never conflict with *Sync fork*.

| File | What it controls |
|---|---|
| `theme.css` | Colors and fonts. The app reads only the CSS variables listed in the file. |
| `labels.json` | The app name shown in the header, the words "Invoice", "Bill" and "This week", and the line printed at the bottom of every invoice. |
| `logo.png` (optional) | Shown in the header and on invoices. PNG or SVG, up to 400 px wide. Add it as `custom/logo.png` or `custom/logo.svg`. |

`interface` in `labels.json` and the first line of `theme.css` say which version of this contract the files follow.
When a release changes the contract, its changelog says so and Settings shows a warning until you update the number.

Company details, tax settings and the invoice footer text are **not** files: set them in *Settings* inside the app.
Nothing in this repository should ever contain a password, a key or a customer's details — the repository is public.
