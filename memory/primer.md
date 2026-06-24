# Primer — personal-budget
*Rewrite each session. Last updated: 2026-06-23.*

## State
Local-first budget app, **CSV-import** based (Plaid was removed). Node 24 + Express 5 + built-in
`node:sqlite`; vanilla-JS frontend with a custom animated SVG donut. No build step, no external
data dependencies, no credentials. Runs on `:4000`. Owner = single user (Ardent Credit Union).

**Built & working (all verified):**
- Import bank CSV → keyword-categorize into 15 default buckets + `Income`/`Transfer`.
- Tabs: **Overview** (balance + all-time donut + editable budgets + add/delete custom categories),
  **per-year** (scaled budgets, no txn list), **per-month** (income row + budgets + spent + donut +
  paginated txns with an inline category dropdown to recategorize).
- Custom categories propagate to all tabs; deleting reverts txns to auto-category.
- `Cache-Control: no-store` on `/api/*` (fixed stale budget after recategorize).
- Owner's real data in `data/budget.db` (38 txns, June 2026 — gitignored).
- Packaged: `START-HERE.md` + `personal-budget.zip` shipped via iCloud Drive + OneDrive to the owner's Mac.

## Next
- Nothing blocking. Optional: make recategorize update in place (full refresh resets the txn pager to page 1).
- Keep growing keyword `RULES` as new merchants land in Miscellaneous (owner can self-serve via the dropdown).
- See [decisions.md](decisions.md) for the why, [lessons.md](lessons.md) for gotchas (Express ETag,
  node:sqlite version floor, zip-for-Mac, backup-before-test).

## How to run / test
- `npm start` → http://localhost:4000. Import a CSV via the **Import CSV** button.
- **Never test against the live DB** — back it up first (`cp data/budget.db /tmp/x.db`), test, restore.
  The categorizer is unit-testable: `import { categorize } from server.js` (it guards `app.listen`).
