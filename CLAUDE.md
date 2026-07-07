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
├── electron/          — desktop wrapper (main.mjs: hosts server.js in-process, opens a window)
├── build/             — electron-builder resources (icon.svg source + icon.png) — COMMITTED, not output
├── data/              — budget.db lives here (GITIGNORED: holds your financial data)
├── .env               — only PORT now (GITIGNORED) · .env.example is the template
├── docs/README.md     — run + setup instructions
└── START-HERE.md      — end-user Mac run guide (shipped inside the distribution zip)
```

## Stack · Routing · Commands
- **Stack:** Node 24 + Express 5 · built-in `node:sqlite` · vanilla-JS frontend (custom animated SVG donut; no React/Tailwind/Chart.js, no build step).
- **Routing:** CSV parse/categorize + API → `server.js`; storage/schema → `db.js`; UI → `public/`.
- **Commands:** `npm install` · `npm start` (→ http://localhost:4000) · `npm run dev` (auto-reload) · `npm run app` (Electron desktop window) · `npm run dist:mac` / `dist:win` (package a distributable — **`dist:mac` must run ON a Mac**).
- **No external dependencies for data:** no Plaid, no network calls to a bank, no credentials.

## How it works
- **Import (two-step, preview→confirm):** picking a CSV first calls `POST /api/import_preview` (parse + auto-detect columns, **no save**) → a review modal shows the detected columns, a sample of parsed rows (red/green = out/in), and new-vs-duplicate counts; confirming calls `POST /api/import` (save). Both share `analyzeCsv()` so the preview reflects exactly what will be stored. The parser auto-detects columns by header-name synonyms (Date/Post Date, Description/Memo/Payee/Merchant/Details, Debit/Withdrawal + Credit/Deposit *or* Amount, Balance, Status, Account) and parses ISO / US `M/D/Y` / textual (`Jan 5, 2026`) dates — **generic across banks**, not tuned to one. Ardent Credit Union is just the default shape.
- **Sign convention:** stored `amount` is **+ = money in (credit)**, **− = money out (debit)**.
- **Categorization:** keyword `RULES` in `server.js` map a description → one of 15 default buckets (or `Income`/`Transfer`). Unmatched inflow → `Income`, unmatched outflow → `Miscellaneous`. Per-txn `user_category` override wins and survives re-imports; set it from the **inline dropdown on each transaction row** (POST `/api/transaction_category`). **Uncategorized triage:** a row "needs a category" only while it's *untouched auto-Miscellaneous* (`!user_category && category==='Miscellaneous'`) — picking any category (even Miscellaneous) marks it reviewed and clears it. Such rows show an **amber marker**, and an **"All / Needs category · N" filter** above the month table isolates them (import banner deep-links to it).
- **Merchant learning:** recategorizing also saves `UPPER(description)→category` in `learned_categories` and applies it to all matching rows now + on every future import (`applyLearnedRules()`). Fix a merchant once → it sticks. Deleting a custom category drops its learned rules too.
- **Custom categories:** user adds/removes them on the Overview (`custom_categories` table; `POST`/`DELETE /api/category`). Full list = `DEFAULT_BUCKETS` + custom (via `expenseBuckets()`). Deleting one reverts its transactions to auto-category and clears its budget. Built-ins can't be deleted.
- **Navigation:** tab bar = **Overview · [non-archived years] · Archive ▾** — NO month tabs. Drill into a month by clicking a cell in a year's 3×4 grid (→ month detail + **← Back**). `GET /api/summary?period=` accepts `YYYY-MM` or `YYYY`; a month summary also returns `prior` (same month, prior year) for the year-over-year chart. `/api/overview` returns `activeYear`, `archivedYears`, and `monthly` (per-month income/spend/save/leftover).
- **Year rollover:** `app_settings.active_year` + `archived_years` tables. `POST /api/new_year` archives the active year (kept, read-only) and bumps +1; `POST /api/unarchive_year` restores (rolls active back if the next year is still empty). Archived views are read-only (import/clear/add hidden, category dropdowns disabled).
- **Totals:** Income = inflows categorized `Income`; Spending = outflow buckets except `Savings/Investing` and `Transfer`; Net/Leftover = income − spending − savings.
- **Manual data:** `POST /api/transaction` (add one row), `POST /api/clear_month` (wipe a month + drop orphan accounts). **Balance** = sum of each account's latest-dated `Balance` from the CSV.
- **Dedup:** transaction id = sha1(account|date|desc|amount|balance) → re-importing the same CSV is idempotent. **No-cache:** `/api/*` sends `Cache-Control: no-store`.

## Conventions
- One fact, one location; lowercase-hyphen naming. No secrets needed; `.env` holds only PORT.

## Current State (2026-07-07)
- 🧾 **Import preview + generic parser + uncategorized triage (2026-07-07)** — for sharing with friends on *different banks*. (1) Import is now preview→confirm: a modal shows detected columns + sample rows + new/duplicate counts before any save (`/api/import_preview`, shared `analyzeCsv()`). (2) Parser generalized: broader header synonyms + ISO/US/textual dates, no bank-specific special-casing. (3) Uncategorized rows get an amber marker + a "Needs category · N" filter that shrinks as you fix them; the flag means *not-yet-reviewed* (picking any category, incl. Miscellaneous, clears it). Verified against 3 bank formats + the owner's real data (backed up + restored around tests). See `memory/decisions.md`.
- 🖥️ **Desktop app (Electron) added (2026-07-06)** so the owner can share copies with friends who each run their own local instance (data stays on their machine). `electron/main.mjs` hosts `server.js` in-process on a free port and opens a window; the SQLite DB is redirected to the OS user-data dir (`BUDGET_DATA_DIR`, since a packaged bundle is read-only) so each user gets an isolated DB that opens to the first-run empty state. `db.js`/`server.js` edits are backward-compatible (`npm start` unchanged, verified). App icon in `build/`. Verified end-to-end incl. a real packaged build (asar has no `data`/`.env`/`.db` leak). **The Mac `.dmg` must be built ON a Mac** (`npm run dist:mac`) — can't cross-build from Windows. Signing decision still open (unsigned + right-click-Open vs. ~$99/yr Apple Developer). See `memory/decisions.md`.
- ⭐ **Frontend redesign "Mission Control" is LIVE on `master`** (`821fc59` → `9f3330e`, pushed to private GitHub `ipaselt/personal-budget`). The real app is the redesign; `branches/redesign-preview/` sandbox is superseded (kept, gitignored). Shipped this session: **first-run empty state** (no data → import CTA, hides the $0 KPIs/charts), **import feedback** (`/api/import` → added/duplicates/uncategorized), **red recent-activity spending**, per-year month-grid scaling, real last-day date cap, `clear_month` balance recompute, `[hidden]` CSS reset, txn-description escaping. Google Fonts stripped (offline).
- ✅ **Reviewed before merge:** independent subagent review + a local max-effort multi-agent review (cloud `ultrareview` unavailable in-session). Blockers fixed; merchant-learning kept global by owner choice; dedup + efficiency items deferred to backlog (below). See `memory/decisions.md`.
- 🧹 **App is in REAL USE now** (`active_year=2026`): owner reset to a clean 2026 slate, then began importing their real bank CSV — `data/budget.db` (gitignored) now holds real financial data, not sample. Sample + earlier real-data backups in `data/budget.*-backup-*.db` (gitignored). **Never test mutations against it — back up first.**
- ✅ Prior work (verified): merchant learning · tab redesign (Overview · years · Archive) · year archive/restore + Start-new-year + **archive-year for non-active years** · YoY month comparison · 3×4 month-grid · per-month single-bars + category donut · Add/Clear/Import.
- ✅ Distribution (OneDrive, for owner's Mac): `personal-budget-redesign.zip` (redesign, offline/system-fonts, bundled deps, macOS-safe zip) + `personal-budget-2026.csv`/`-2027.csv` (216 rows each, accounts `2026`/`2027`, exported from the sandbox db). Old `personal-budget.zip` left in place.
- ⏳ Categorization `RULES` are a starter set — tune as new merchants land in Miscellaneous (owner self-serves via the dropdown + merchant learning now).

## Next up (none committed-blocking)
- **From the pre-merge ultra review (deferred, not blockers):** (1) **dedup id folds in the running `balance`** (`server.js` ~193) — a bank *re-export* with recomputed balances can re-add rows as new (double-count), and genuinely-identical in-CSV rows get reported as duplicates; changing the hash risks collapsing distinct same-day txns, so it's a real trade-off to design, not a quick fix. (2) **Redundant full-table reads**: `/api/overview` reads `allTxns` then `monthlySeries()` re-reads it; `/api/import` re-scans `allTxns` to count uncategorized; `/api/summary` computes `monthlySeries()` even for month drill-ins. Negligible at personal scale; easy wins if tidying.
- **Leftover rollover / envelope budgeting** (owner-requested backlog, 2026-06-25): let unspent "leftover" carry into the next month and be allocatable to categories (running surplus total, and/or full envelope budgeting with category rollover). Deferred — current model is CSV-actuals; the real surplus already rolls over in the running bank balance.
- Optional polish the owner flagged: recategorize currently triggers a full refresh (resets txn pager to page 1) — could update in place.
- Possible future: CSV export of a month (esp. before archiving a year), category delete from month views too, multi-account balance breakdown.

## Avoid
- Never commit `.env` or `data/`.
- Keep it dependency-light and local — no calling out to a bank/third party.
