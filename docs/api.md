# API — the 13 Cloud functions

Every function is called as `POST /functions/<name>` (REST) or `Parse.Cloud.run(name, params)` (JS SDK) with a
session token. Money is integer cents. Dates are `YYYY-MM-DD` strings. Errors use Parse codes:

| Code | Meaning here |
|---|---|
| 209 | not signed in (`INVALID_SESSION_TOKEN`) |
| 119 | signed in but not allowed: missing role, or a rule like "account in use" (`OPERATION_FORBIDDEN`) |
| 142 | invalid input; `LIMIT_EXCEEDED:` prefix when a cap was hit (`VALIDATION_ERROR`) |
| 101 | object not found (`OBJECT_NOT_FOUND`) |

Roles: `viewer` may call the three reads; `finance` may call everything.

## Reads

### `base` → ledger summary
Request: `{}`
```json
{ "role": "finance", "today": "2026-09-30", "demo": true, "timezone": "America/New_York", "latestMonth": "2026-10",
  "accounts": [ { "id": "…", "name": "Operating checking", "openingBalance": 4825000, "currency": "USD", "currentBalance": 5123456, "uses": 120 } ],
  "categories": [ { "id": "…", "name": "Bank fees", "color": "#7a8794", "uses": 6 } ] }
```
`currentBalance` = opening balance + every **paid** transaction's effect. `today` is the organization's date
(or `Config.referenceDate` on a test backend).

### `listMonth` → one month of transactions with the balances before it
Request: `{ "month": "2026-09", "accountId": "optional" }`
```json
{ "month": "2026-09", "accountId": null, "today": "2026-09-30",
  "previousBalance": 5000000, "previousProjected": 4950000,
  "transactions": [ { "id": "…", "type": "expense", "description": "Cloud hosting — Back4app + CDN", "amount": 45000,
      "accrualDate": "2026-09-01", "dueDate": "2026-09-03", "paidDate": "2026-09-03", "date": "2026-09-03",
      "accountId": "…", "toAccountId": null, "categoryId": "…", "contact": "Back4app", "notes": "" } ] }
```
Rows are ordered by `date` (= `paidDate ?? dueDate`) then creation. `previousBalance` counts paid rows with
`paidDate < month start`; `previousProjected` counts every row with `date < month start`. With `accountId`, both are
for that account and rows include transfers in and out of it. More than 2,000 rows → `142 LIMIT_EXCEEDED`.

### `report` → income and expenses by category
Request: `{ "from": "2026-04-01", "to": "2026-09-30", "basis": "cash" | "accrual", "accountId": "optional" }`
```json
{ "from": "2026-04-01", "to": "2026-09-30", "basis": "cash", "accountId": null,
  "income":  { "total": 26000000, "categories": [ { "id": "…", "name": "Subscriptions", "color": "#2a78d6", "total": 21000000,
                "items": [ { "id": "…", "date": "2026-04-07", "description": "Stripe payout", "contact": "Stripe", "amount": 812000 } ] } ] },
  "expense": { "total": 19000000, "categories": [ … ] } }
```
Cash basis groups by `paidDate` and includes only paid rows; accrual basis groups by `accrualDate` and includes pending
rows. Transfers are never included. Range over 24 months or more than 20,000 items → `142 LIMIT_EXCEEDED`.

## Writes (role `finance`)

### `createTransaction` / `updateTransaction`
Request (update adds `"id"`):
```json
{ "type": "expense", "description": "Office supplies", "amount": 4599, "dueDate": "2026-09-12", "accrualDate": "2026-09-12",
  "paidDate": null, "accountId": "…", "toAccountId": null, "categoryId": "…", "contact": "Staples", "notes": "" }
```
Response: the stored row in `listMonth` shape. Rules: `type` ∈ income|expense|transfer; `amount` a positive safe
integer; dates real calendar dates; `accountId` must exist; transfers need `toAccountId` ≠ `accountId` with the same
currency and ignore `categoryId`; `categoryId`, when given, must exist. `description` ≤ 200, `contact` ≤ 120,
`notes` ≤ 2000 characters.

### `deleteTransaction` → `{ "id": "…", "deleted": true }`
Request: `{ "id": "…" }`

### `setPaid` → the updated row
Request: `{ "id": "…", "paid": true, "paidDate": "optional YYYY-MM-DD" }`
`paid: true` without `paidDate` uses **today** in the organization timezone (never the due date). `paid: false`
clears `paidDate`.

### `createAccount` / `updateAccount` → `{ "id", "name", "openingBalance", "currency" }`
Request: `{ "name": "Savings reserve", "openingBalance": 7500000, "currency": "USD" }` (update adds `"id"`; omitted fields keep their value).
Names are unique (hook-validated). The currency of an account that has transactions cannot change → `119`.

### `deleteAccount` → `{ "id", "deleted": true }`
`119` if the account has transactions or is the last account.

### `createCategory` / `updateCategory` → `{ "id", "name", "color" }`
Request: `{ "name": "Marketing", "color": "#eda100" }` — `color` optional on create (palette default). Names unique.

### `deleteCategory` → `{ "id", "deleted": true }`
`119` if any transaction uses it.

## Jobs (master key, `POST /jobs/<name>`)

- `nightlySnapshot` — writes one `Snapshot` row (JSON export as a string, master-key only), keeps 14.
- `reseedDemo` — only when `Config.demo = true`: wipes the ledger and loads the deterministic dataset for today
  (`params: { "referenceDate": "YYYY-MM-DD", "size": "large" }` optional).

## Guarantees

Hooks validate; they are not database constraints. Cross-record invariants are not guaranteed under concurrent writes
(two tabs, a double-click, a retry). See `scripts/check-concurrency.mjs` for the demonstrated window.
