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
└── docs/README.md     — run + setup instructions
```

## Stack · Routing · Commands
- **Stack:** Node 24 + Express 5 · built-in `node:sqlite` · vanilla-JS frontend (custom animated SVG donut; no React/Tailwind/Chart.js, no build step).
- **Routing:** CSV parse/categorize + API → `server.js`; storage/schema → `db.js`; UI → `public/`.
- **Commands:** `npm install` · `npm start` (→ http://localhost:4000) · `npm run dev` (auto-reload).
- **No external dependencies for data:** no Plaid, no network calls to a bank, no credentials.

## How it works
- **Import:** `POST /api/import` takes raw CSV text. The parser auto-detects columns by header name (Date, Description, Debit/Credit *or* Amount, Balance, Status, Account). Tuned for Ardent Credit Union (`Account Number, Post Date, Check, Description, Debit, Credit, Status, Balance`) but flexible.
- **Sign convention:** stored `amount` is **+ = money in (credit)**, **− = money out (debit)**.
- **Categorization:** keyword `RULES` in `server.js` map a description → one of 15 buckets (or `Income`/`Transfer`). Unmatched inflow → `Income`, unmatched outflow → `Miscellaneous`. Per-txn `user_category` override wins and survives re-imports.
- **Totals:** Income = inflows categorized `Income`; Spending = outflow buckets except `Savings/Investing` and `Transfer`; Net/Leftover = income − spending − savings.
- **Balance:** current balance = sum of each account's latest-dated `Balance` value from the CSV.
- **Dedup:** transaction id = sha1(account|date|desc|amount|balance) → re-importing the same CSV is idempotent.

## Conventions
- One fact, one location; lowercase-hyphen naming. No secrets needed; `.env` holds only PORT.

## Current State
- ✅ Tabbed UI: **Overview** (current-balance card + all-time Spending/Savings/Leftover donut + editable budget table) and **one tab per month** (income row + read-only budgets + spent + that month's donut + paginated transactions).
- ✅ CSV import with keyword categorization; budgets are recurring per-category limits set on the Overview tab.
- ✅ Plaid fully removed (no `plaid.js`, no keys, no demo scripts, no tokens).
- ⏳ Categorization `RULES` are a starter set — expect to tune them to the owner's actual merchants; manual override exists for one-offs.

## Avoid
- Never commit `.env` or `data/`.
- Keep it dependency-light and local — no calling out to a bank/third party.
