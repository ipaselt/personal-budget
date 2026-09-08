# Personal Budget

A local-first personal budget planner. Export a statement from your bank (CSV, Excel, or QFX/OFX), drop it into the app, and it parses the file, auto-categorizes every transaction, and tracks income, spending, and savings against per-category monthly budgets. There are no bank credentials, no API keys, and no third-party services: the server, the SQLite database, and the UI all run on your own machine, and nothing is uploaded anywhere.

## What it does

- **Statement import (preview, then confirm).** The upload goes to a preview endpoint that parses without saving; a modal shows the detected format and columns, a sample of parsed rows, and new-vs-duplicate counts before anything is written. Columns are auto-detected by header synonyms (Date/Post Date, Description/Memo/Payee, Debit+Credit or a signed Amount, Balance, Status, Account), dates in ISO, US, or textual form. The parser is generic, not tuned to one bank.
- **Multiple formats, one pipeline.** The server sniffs the bytes (zip -> `.xlsx`, OLE -> legacy `.xls`, `OFXHEADER`/`<OFX>` -> OFX, else CSV) and normalizes every format into the same record shape that feeds dedup, categorization, and the preview.
- **Credit-card statements.** Cards invert the sign convention (a purchase looks like money in). The preview offers a "flip signs" toggle, auto-suggested when the file looks like a card, that negates amounts, re-categorizes, and drops the liability balance. Card payments are excluded from totals so a two-account setup never double-counts a purchase.
- **Three-layer categorization.** (1) Ordered keyword rules assign a default category at import time. (2) A per-transaction manual override wins and survives re-imports. (3) Recategorizing also *learns the merchant*: a date-insensitive key for the description is stored and applied to every matching row now and on every future import. A "just this one" scope skips the learning for one-off cases.
- **Uncategorized triage.** Rows that landed in Miscellaneous and have not been touched are flagged; a "Needs category" filter isolates them and shrinks as you review.
- **Budgets and custom categories.** Set a monthly limit per category (built-in or your own); the Overview panel shows the latest month's spend against it, and year views scale limits by months with data.
- **Transfers and savings.** Transfers between your own accounts are excluded from income and spending; a Savings/Investing bucket is tracked separately so "leftover" means income minus spending minus savings.
- **Years, archive, year-over-year.** Navigate Overview -> year -> month. Close out a year to archive it read-only; month views chart this year against the same month last year.
- **Idempotent re-imports.** Re-importing the same file adds nothing; download a fresh statement whenever you like.
- **Desktop app.** An Electron shell hosts the same server in-process and opens a window, so non-technical users get a double-clickable app with their own isolated database.

## Why local-first

The project started with a bank-aggregator integration and deliberately dropped it. A CSV you download yourself has a much smaller security surface than a stored API secret or a revocable access token: nothing to leak, nothing to revoke, no third party holding your transaction history, and no internet required. The cost is a manual download and having to build categorization ourselves; for a personal tool that trade is clearly worth it. The distributed build even strips web fonts so the app never makes a network request.

## Architecture

- `server.js` — Express 5 API: byte-sniffing import dispatcher, CSV/spreadsheet/OFX parsers, keyword categorizer, merchant learning, totals, budgets, year archive. Exports `app` (for Electron) and `categorize`/`merchantKey` (for tests) and only listens when run directly.
- `db.js` — SQLite via Node's built-in `node:sqlite` (no native build step, no compiler needed), schema creation, prepared statements, and a small transaction helper.
- `public/` — vanilla JS, HTML, and CSS; no framework, no bundler. Custom animated SVG donut and bar charts.
- `electron/main.mjs` — desktop wrapper: imports `server.js`, binds it to a free localhost port, redirects the database to the OS user-data directory, opens a window. External links open in the system browser.

## Hard problems and lessons

**Keyword rules are order-sensitive and substring matching bites.** "TRANSFER TO SAVINGS" must hit Savings before the generic Transfer rule; "UBER EATS" must hit Dining before Transportation; a payment memo containing "interest: 0.00" tripped the Income rule. An early fix reordered the rule table, which quietly turned credit-union dividend and interest deposits into transfers. An independent review caught it, and the fix became a narrowly scoped override (flip-mode inflows that read as income become transfers) instead of a global reorder. The durable lesson: never broaden or reorder a rule without a regression check on the cases it already handles, and when a label looks wrong, check the stored category, the manual override, and the learned rules *before* blaming the rule table.

**Deduplication has a provenance trade-off.** A CSV row's id is a hash of account, date, description, amount, and the running balance. That makes re-imports idempotent, but a bank re-export with recomputed balances can re-add rows, and two genuinely identical same-day rows collapse into one. OFX uses the bank's own transaction id, so the same statement imported once as CSV and once as QFX would not cross-dedup. Changing the hash risks merging distinct transactions, so this is documented as a design decision rather than patched.

**With financial data, a silent misparse is the real danger.** A wrong column or a flipped sign produces confident, wrong numbers. That is why import is two-step and why credit-card handling is a user-confirmed toggle rather than automatic detection. Every parser quirk in this project (a `Details` column that held DEBIT/CREDIT rather than a description, OLE-binary `.xls` files, inverted card signs) was found by parsing a real sample first, not by guessing the convention.

## Stack

Node 24 (>= 22.5 for `node:sqlite`) · Express 5 · built-in SQLite · SheetJS for Excel · vanilla JS/HTML/CSS · Electron + electron-builder for the desktop build.

## Running it

```
npm install
npm start          # http://localhost:4000
npm run dev        # same, with auto-reload
npm run app        # Electron desktop window
npm run dist:mac   # package a macOS .dmg/.zip (must run on a Mac)
npm run dist:win   # package a Windows portable .exe
```

Data lives in `data/budget.db` (gitignored). The desktop build stores it under the OS user-data directory instead (`BUDGET_DATA_DIR` overrides either). `.env` holds only `PORT`; copy `.env.example` if you want to change it.

## Status / next

In daily use by the author and a few friends on different banks; each runs their own local copy. There is no automated test suite yet, though the categorizer is exported so its rules can be unit-tested without starting the server.

Open items: leftover rollover / envelope budgeting, the dedup-vs-re-export trade-off above, and PDF statements (unsupported; most banks offer CSV, Excel, or QFX).
