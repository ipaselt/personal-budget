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
- **Custom categories:** user adds/removes them on the Overview (`custom_categories` table; `POST`/`DELETE /api/category`). The full list = `DEFAULT_BUCKETS` + custom (via `expenseBuckets()`), so a new category shows in every tab. Deleting one reverts its transactions to auto-category and clears its budget. Built-ins can't be deleted.
- **Periods:** `GET /api/summary?period=` accepts `YYYY-MM` (month) or `YYYY` (year). Budgets are monthly, so a year view scales budget by `monthCount` (months with data). Year tabs show no transaction list; month tabs do. (`all` is still supported server-side but the All-Time tab was removed.)
- **Totals:** Income = inflows categorized `Income`; Spending = outflow buckets except `Savings/Investing` and `Transfer`; Net/Leftover = income − spending − savings.
- **Balance:** current balance = sum of each account's latest-dated `Balance` value from the CSV.
- **Dedup:** transaction id = sha1(account|date|desc|amount|balance) → re-importing the same CSV is idempotent.
- **No-cache:** API responses send `Cache-Control: no-store` (Express ETags were serving stale budget data after recategorizing).

## Conventions
- One fact, one location; lowercase-hyphen naming. No secrets needed; `.env` holds only PORT.

## Current State (2026-06-23)
- ✅ Tabbed UI: **Overview** (current-balance card + all-time donut + editable budget table with **add/delete custom categories**) · **per-year** tab (budget/spent table + donut, no txn list) · **per-month** tab (income row + read-only budgets + spent + donut + paginated transactions with an **inline category dropdown**).
- ✅ CSV import + keyword categorization; budgets are recurring monthly limits set on Overview; custom categories propagate to all tabs.
- ✅ API responses are `no-store` (fixed stale budget after recategorize). Plaid fully removed.
- ✅ Owner's real Ardent data loaded in `data/budget.db` (38 txns, June 2026). Server typically left running on :4000.
- ✅ **Packaged for distribution:** `START-HERE.md` + cleaned `package.json` (no `plaid`, `engines>=22.5`); a `personal-budget.zip` (bundled node_modules, forward-slash paths, excludes `.env`/`data/`) was built and dropped in the owner's iCloud Drive + OneDrive to move to their Mac. Rebuild via the stage→zip steps in `memory/lessons.md`.
- ⏳ Categorization `RULES` are a starter set — keep tuning to real merchants (the owner can now self-serve via the dropdown). Last tuning pass: WAWA→Dining, GULF→Transport, golf→Entertainment, S0001→Savings, "via Mobile"→MOBIL fix.

## Next up (none committed-blocking)
- Optional polish the owner flagged: recategorize currently triggers a full refresh (resets txn pager to page 1) — could update in place.
- Possible future: CSV export of a month, category delete from month views too, multi-account balance breakdown.

## Avoid
- Never commit `.env` or `data/`.
- Keep it dependency-light and local — no calling out to a bank/third party.
