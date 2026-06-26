# Personal Budget

A local-first budget planner. You export a **CSV** from your bank and import it;
the app categorizes your transactions and tracks income, spending, and savings
against budgets you set per category. Everything runs on your own machine — your
financial data lives in a local SQLite file and is never sent anywhere. No bank
logins, API keys, or third parties.

## Setup

1. **Install dependencies** (once):
   ```
   npm install
   ```
2. **Start the app:**
   ```
   npm start
   ```
   Open <http://localhost:4000>. (No keys or config needed.)

## Using it

1. Download a transaction CSV from your bank's website.
2. Open a **year** tab, click a **month** in its grid, and use **Import CSV** to
   pick the file. It parses, categorizes, and populates the month. Re-importing the
   same file is safe (no duplicates) and re-applies categorization.
3. **Navigation:** the tab bar is **Overview · your year(s) · Archive**. Click a
   month in a year's grid to open its detail (budget vs. spent, a breakdown donut,
   a spending-by-category donut, and its transactions); use **← Back** to return.
4. On the **Overview**, set a monthly limit next to any category to create a budget
   (applies to every month), and **add/delete your own categories**. Click a month
   in the Overview grid to focus the donut on it.
5. **Recategorize** any transaction with the dropdown in its Category column — the
   app **remembers that merchant** and auto-applies your choice to future imports.
6. **Compare years:** open a month that also exists last year and the chart shows
   this year vs. last year side by side.
7. **New year:** **Start new year** archives the current year (kept, read-only under
   **Archive**) and opens a fresh one; **Restore** un-archives if you change your mind.

## Supported CSV format

Columns are auto-detected by header name. Works with separate **Debit/Credit**
columns or a single signed **Amount** column, plus optional **Balance**,
**Status**, and **Account** columns. Tuned for Ardent Credit Union:
```
Account Number, Post Date, Check, Description, Debit, Credit, Status, Balance
```

## How categorization works

Each transaction's description is matched against keyword rules (in `server.js`,
the `RULES` array) and sorted into one of the budget categories — e.g.
`TRADER JOES` → Groceries, `WAWA` → Dining Out, `GULF OIL` → Transportation.
Anything unmatched goes to **Income** (money in) or **Miscellaneous** (money out).
You can override any transaction's category in the app; overrides survive
re-imports. Add new merchants to `RULES` to teach it over time.

## How the totals work

Stored `amount` is **positive for money in (credit)** and **negative for money
out (debit)**. **Income** = inflows tagged Income; **Spending** = outflow
categories except Savings/Investing and Transfer; **Leftover** = income −
spending − savings. **Current balance** comes from the latest Balance value in
your CSV.
