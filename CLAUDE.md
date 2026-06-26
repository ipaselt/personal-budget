# CLAUDE.md — Personal Budget

A local-first personal budget planner. The owner exports a **CSV** from their bank and imports it; the app categorizes transactions and tracks income, spending, and savings against per-category budgets. Single user, runs entirely on their own machine — no bank credentials, API keys, or third parties. Home base: `projects/personal-budget/` (repo root = main checkout).

> Auto-loads when an agent works in this project. Solo, non-orchestrated (no `.orchestrated` marker → direct commits to main are allowed).

## Workspace Map
```
personal-budget/
├── CLAUDE.md          — this file
├── server.js          — Express server: CSV import + API + serves the frontend
├── db.js              — SQLite storage (node:sqlite, no native build) + prepared statements
├── public/            — frontend (index.html, app.js, style.css) — no build step
├── data/              — budget.db lives here (GITIGNORED: holds your financial data)
├── .env               — only PORT now (GITIGNORED) · .env.example is the template
├── docs/README.md     — run + setup instructions
└── START-HERE.md      — end-user Mac run guide (shipped inside the distribution zip)
```

## Stack · Routing · Commands
- **Stack:** Node 24 + Express 5 · built-in `node:sqlite` · vanilla-JS frontend (custom animated SVG donut; no React/Tailwind/Chart.js, no build step).
- **Routing:** CSV parse/categorize + API → `server.js`; storage/schema → `db.js`; UI → `public/`.
- **Commands:** `npm install` · `npm start` (→ http://localhost:4000) · `npm run dev` (auto-reload).
- **No external dependencies for data:** no Plaid, no network calls to a bank, no credentials.

## How it works
- **Import:** `POST /api/import` takes raw CSV text. The parser auto-detects columns by header name (Date, Description, Debit/Credit *or* Amount, Balance, Status, Account). Tuned for Ardent Credit Union (`Account Number, Post Date, Check, Description, Debit, Credit, Status, Balance`) but flexible.
- **Sign convention:** stored `amount` is **+ = money in (credit)**, **− = money out (debit)**.
- **Categorization:** keyword `RULES` in `server.js` map a description → one of 15 default buckets (or `Income`/`Transfer`). Unmatched inflow → `Income`, unmatched outflow → `Miscellaneous`. Per-txn `user_category` override wins and survives re-imports; set it from the **inline dropdown on each transaction row** (POST `/api/transaction_category`).
- **Merchant learning:** recategorizing also saves `UPPER(description)→category` in `learned_categories` and applies it to all matching rows now + on every future import (`applyLearnedRules()`). Fix a merchant once → it sticks. Deleting a custom category drops its learned rules too.
- **Custom categories:** user adds/removes them on the Overview (`custom_categories` table; `POST`/`DELETE /api/category`). Full list = `DEFAULT_BUCKETS` + custom (via `expenseBuckets()`). Deleting one reverts its transactions to auto-category and clears its budget. Built-ins can't be deleted.
- **Navigation:** tab bar = **Overview · [non-archived years] · Archive ▾** — NO month tabs. Drill into a month by clicking a cell in a year's 3×4 grid (→ month detail + **← Back**). `GET /api/summary?period=` accepts `YYYY-MM` or `YYYY`; a month summary also returns `prior` (same month, prior year) for the year-over-year chart. `/api/overview` returns `activeYear`, `archivedYears`, and `monthly` (per-month income/spend/save/leftover).
- **Year rollover:** `app_settings.active_year` + `archived_years` tables. `POST /api/new_year` archives the active year (kept, read-only) and bumps +1; `POST /api/unarchive_year` restores (rolls active back if the next year is still empty). Archived views are read-only (import/clear/add hidden, category dropdowns disabled).
- **Totals:** Income = inflows categorized `Income`; Spending = outflow buckets except `Savings/Investing` and `Transfer`; Net/Leftover = income − spending − savings.
- **Manual data:** `POST /api/transaction` (add one row), `POST /api/clear_month` (wipe a month + drop orphan accounts). **Balance** = sum of each account's latest-dated `Balance` from the CSV.
- **Dedup:** transaction id = sha1(account|date|desc|amount|balance) → re-importing the same CSV is idempotent. **No-cache:** `/api/*` sends `Cache-Control: no-store`.

## Conventions
- One fact, one location; lowercase-hyphen naming. No secrets needed; `.env` holds only PORT.

## Current State (2026-06-26)
- ⚠️ **This session's large feature batch is committed on a FEATURE BRANCH, not `master`, and is REVIEW-PENDING** (schema migration + broad multi-file + balance/comparison math = full-review triggers). `master` is at `821fc59`. **Next: independent review of the branch → merge.** Details in `memory/primer.md`.
- ✅ Done this session (all verified in-browser): merchant learning · tab redesign (Overview · years · Archive, drill-into-month from year grids) · year archive/restore + Start-new-year · year-over-year month comparison (ghost bars) · Overview 3×4 month-grid (click → donut rescopes) · per-month single-bars + category-% donut · manual Add transaction · Clear month · empty-state keeps UI · per-month Import.
- ✅ Owner's real Ardent data in `data/budget.db` (**414 txns, Jan–Jun 2026**). Server usually left running on :4000.
- ✅ Distribution: `personal-budget.zip` in OneDrive; full-year sample CSVs (`personal-budget-2026.csv`/`-2027.csv`, accounts `2026`/`2027`) delivered for testing.
- ⏳ Categorization `RULES` are a starter set — tune as new merchants land in Miscellaneous (owner self-serves via the dropdown + merchant learning now).

## Next up (none committed-blocking)
- **Leftover rollover / envelope budgeting** (owner-requested backlog, 2026-06-25): let unspent "leftover" carry into the next month and be allocatable to categories (running surplus total, and/or full envelope budgeting with category rollover). Deferred — current model is CSV-actuals; the real surplus already rolls over in the running bank balance.
- Optional polish the owner flagged: recategorize currently triggers a full refresh (resets txn pager to page 1) — could update in place.
- Possible future: CSV export of a month (esp. before archiving a year), category delete from month views too, multi-account balance breakdown.

## Avoid
- Never commit `.env` or `data/`.
- Keep it dependency-light and local — no calling out to a bank/third party.
