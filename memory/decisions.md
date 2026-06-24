# Decisions — personal-budget (append-only)

## 2026-06-23 — Drop Plaid, switch to CSV import
Owner reconsidered and preferred CSV-from-bank over Plaid for a personal, local tool. CSV has a
smaller security surface: no stored API secret, no reusable/revocable access token, no third party,
no internet needed. Cost: manual download + we build keyword categorization instead of Plaid's ML
categories. Kept ~80% of the app (donut, tabs, budgets, monthly views); only swapped the ingestion
layer. Removed `plaid.js`, the Plaid endpoints, demo scripts, and the keys in `.env`.

## 2026-06-23 — CSV sign convention = + in / − out
Stored `amount` is **positive for credits (money in), negative for debits (money out)** — natural
bank-statement convention, opposite of Plaid's. computeTotals + the transaction display were flipped
to match. Categorizer assigns at import time into the stored `category` column (not at query time).

## 2026-06-23 — Categorization = keyword RULES + manual override, tuned per-merchant
`RULES` (ordered, specific-first) in `server.js`. Order matters: Savings before Transfer (so
"TRANSFER TO SAVINGS"→Savings); Dining before Transportation (so "UBER EATS"→Dining not Transport).
Unmatched inflow→Income, outflow→Miscellaneous. Owner can self-correct via the inline dropdown
(`user_category`, preserved across re-imports) — preferred over me hand-editing rules each time.

## 2026-06-23 — Custom categories are additive; deletes revert, not orphan
`custom_categories` table; full list = `DEFAULT_BUCKETS` + custom via `expenseBuckets()`. One source
of truth → new categories appear in every tab automatically. Delete (custom only; built-ins
protected) reverts assigned txns to auto-category (`user_category=NULL`) and clears the budget,
inside a transaction — avoids orphaned spend counted with no row to show it.

## 2026-06-23 — Period views: budgets scale by months-with-data
`/api/summary?period=YYYY|YYYY-MM`. Budgets are monthly, so a year view multiplies each limit by the
number of months that have data in that period (fair budget-vs-spent). Removed the All-Time tab per
owner preference (backend still supports `all`). Year tabs omit the transaction list; month tabs keep it.

## 2026-06-23 — Current balance from CSV running Balance, single card
Replaced the Plaid-era Cash/Stash split (which needed account subtypes) with one "Current balance"
card = sum of each account's latest-dated `Balance` value. CSV doesn't reliably give account types.

## 2026-06-23 — no-store on API (Express ETag was serving stale budgets)
Recategorizing didn't update the budget table: Express auto-ETags JSON, and the re-fetch came back
stale. Fixed with `Cache-Control: no-store` middleware on `/api/*`.

## 2026-06-23 — Distribution = self-contained zip (bundled deps), moved via cloud drive
Deps are pure-JS (no native binaries) → bundle `node_modules` so the Mac needs only Node + `npm start`
(no install). Required Node ≥22.5 for `node:sqlite` (added `engines`). Email was a dead end (Gmail
blocks `.js` even inside zips); used iCloud Drive / OneDrive instead.
