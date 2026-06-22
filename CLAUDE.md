# CLAUDE.md — Personal Budget

A local-first personal budget planner that links the owner's bank via Plaid, pulls transactions automatically, and tracks income, spending, and savings against per-category budgets. Single user (the owner), runs on their own machine. Home base: `projects/personal-budget/` (repo root = main checkout).

> Auto-loads when an agent works in this project. Solo, non-orchestrated (no `.orchestrated` marker → direct commits to main are allowed).

## Workspace Map
```
personal-budget/
├── CLAUDE.md          — this file
├── server.js          — Express server: API + serves the frontend
├── plaid.js           — Plaid API client (reads keys from .env)
├── db.js              — SQLite storage (node:sqlite, no native build) + prepared statements
├── public/            — frontend (index.html, app.js, style.css) — no build step
├── data/              — budget.db lives here (GITIGNORED: holds financial data + tokens)
├── .env               — Plaid keys (GITIGNORED) · .env.example is the template
└── docs/README.md     — run + setup instructions
```

## Stack · Routing · Commands
- **Stack:** Node 24 + Express 5 · `plaid` SDK · built-in `node:sqlite` · vanilla-JS frontend (Plaid Link + Chart.js via CDN).
- **Routing:** API + sync logic → `server.js`; storage/schema → `db.js`; UI → `public/`.
- **Commands:** `npm install` · `npm start` (→ http://localhost:4000) · `npm run dev` (auto-reload).

## How the money math works
- Plaid `amount` sign: **>0 = money out (spending)**, **<0 = money in (income)**.
- Income = sum of inflows, excluding `TRANSFER_IN`. Spending = sum of outflows, excluding `TRANSFER_OUT`. Net = income − spending.
- Category = Plaid `personal_finance_category.primary`, overridable per-txn via `user_category` (preserved across syncs).
- Transactions pulled via `/transactions/sync` with a stored cursor (incremental).

## Conventions
- Secrets in `.env` only (gitignored). Never hardcode keys. Agent does not write real keys — the owner pastes them in.
- One fact, one location; lowercase-hyphen naming.

## Current State
- ✅ Tabbed UI: **Overview** (all-time cumulative Spending/Savings/Leftover pie + Cash/Stash balance cards + 15 recent txns + accounts) and **one tab per month** (Category/Budget/Spent table with column totals + that month's pie + that month's transactions).
- ✅ Plaid→budget-bucket mapping into 15 expense categories; budgets are recurring per-category limits; refunds offset their bucket; transfers & credit-card payments excluded (no double-count).
- ✅ Verified end-to-end on Sandbox; cumulative Overview pie = sum of the monthly pies.
- ✅ Sandbox keys in `.env`; "First Platypus Bank" linked in `data/budget.db` (4 months of data).
- ⚠️ **Demo data present — REMOVE before Production:** `node scripts/demo-savings.mjs remove` + `node scripts/demo-paycheck.mjs remove`. Sandbox has no real income/savings, so these fake a $500 savings + monthly paychecks to exercise the pie.
- ⏳ Plaid **Production** pending → flip `PLAID_ENV=production` + Production secret, remove demo data, reconnect real bank. (Money/correctness-critical — run an independent review before going live, per the review-before-push rule.)
- 💡 Dev helpers in `scripts/`: `sandbox-link.mjs` (link a Sandbox bank headlessly), `demo-savings.mjs`, `demo-paycheck.mjs`.

## Avoid
- Never commit `.env` or `data/`. Never log access tokens.
- Never put the Plaid secret in frontend/`public` code — it stays server-side.
