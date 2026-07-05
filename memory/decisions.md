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

## 2026-06-25 — Charts: small-multiples grid + single-month + category donut
Overview's per-month trend is a **3×4 grid of mini bar charts** (one per month, shared scale, $ labels),
not one wide grouped chart — fills the space and reads cleaner. Clicking a grid cell **rescopes the
all-time donut** to that month (server adds `income` to `monthlySeries()` so the donut center has it).
Month views show a **single large bars chart** (spending/savings/leftover) + a **per-category breakdown
donut** (% of total) sharing the donut renderer (extracted `drawDonut` core so the design matches).

## 2026-06-26 — Merchant learning (fix once → sticks)
Recategorizing now does more than set one row's `user_category`: it saves `UPPER(name)→category` in a new
`learned_categories` table and applies it to every matching row immediately, and `applyLearnedRules()` runs
inside every import so future rows auto-categorize. Pattern = exact uppercased description (predictable;
recurring bills match, varying store-number descriptions won't generalize — acceptable v1). Deleting a
custom category also drops its learned rules. Chosen by owner over per-transaction-only memory.

## 2026-06-26 — Tab redesign: drill-down replaces month tabs
Owner wanted to stop tab accumulation. Removed the 12 Jan–Dec tabs. Tab bar = **Overview · [years] · Archive**.
Months are reached by **clicking a cell in a year's 3×4 grid** (drill-in) → month detail with **← Back**.
Year tabs shown = `(years-with-data ∪ active_year) − archived`, so normally one year; **archiving is the
de-clutter mechanism**. Empty months on the active year are clickable so you can drill in to import (no
header Import button anymore).

## 2026-06-26 — Year rollover/archive/restore data model
New tables: `app_settings` (key/value; holds `active_year`) and `archived_years`. **Start new year**
(`POST /api/new_year`) archives `active_year` and bumps it +1 — data is kept, just marked archived and shown
read-only. **Restore** (`POST /api/unarchive_year`) removes the archive mark; if the active year is the
*empty* year right after the restored one (classic accidental-archive), it **rolls `active_year` back** so no
empty year is stranded. Archived views are read-only: import/clear/add hidden AND per-row category dropdowns
`disabled` (the recategorize path was the gap that needed closing).

## 2026-06-26 — Year-over-year comparison on the month chart
`/api/summary` for a `YYYY-MM` period also computes the **same month one year earlier** (`prior`, null if no
data). The month bars chart then draws paired bars per series — this year solid, last year at `opacity 0.4`
(ghost) with its own price + year label; title becomes "Jan 2027 vs Jan 2026". Shared y-scale across both
years for fair comparison.

## 2026-07-05 — Frontend redesign "Mission Control", built in a SANDBOX (not ported)
Owner wanted the UI re-imagined, not recolored. Presented 3 previewable concepts (Calm Capital / Mission
Control / Soft Ledger) as static mockups; owner picked **Mission Control** (dense dark command-center: icon
rail, segmented tabs, KPI strip, bento, monospace figures, budget-progress rows). Built as a **full working
copy in `branches/redesign-preview/` (gitignored), on `:4001`, against a db copy** — real `public/` untouched
so the owner can live with it before we port. Port = owner's call; treat as a broad multi-file change (review
before it hits master). Rationale: iterate safely at full fidelity without risking the production frontend.

## 2026-07-05 — Overview scope: active-year KPIs + YoY, but cumulative all-years donut
On the redesigned Overview the **KPI strip shows the active year** (Income/Spending/Savings/Leftover) with
**year-over-year deltas vs the prior year** (only YoY makes those deltas meaningful). But the **donut shows
the cumulative ALL-YEARS total** — owner explicitly wants to "see it grow and grow." Deliberate split (two
income figures on one screen), each clearly labelled. Budgets/insight/recent stay active-year. Earlier I'd
made everything active-year; reverted the donut to cumulative per owner.

## 2026-07-05 — Distribution stays fully offline (no Google Fonts)
The redesign's dev sandbox loads Inter/Geist Mono from Google Fonts, but the **distributed zip strips those
links** — a local-first "nothing leaves your computer" app must not ping Google. Falls back to system fonts
(San Francisco on Mac). If an exact-font match is ever wanted, self-host woff2 in `public/fonts/` instead.

## 2026-07-05 — Sample CSVs = export the sandbox db, don't synthesize
Owner needed 2026/2027 sample CSVs. Generated by **reading the sandbox `budget.db` and re-emitting the import
schema** (Account Number, Post Date MM/DD/YYYY, Debit/Credit from the +/- amount, running Balance) per year —
216 rows each, accounts `2026`/`2027`. Faithful to the numbers the owner already sees; beats hand-synthesizing.
