# Primer — personal-budget
*Rewrite each session. Last updated: 2026-07-05.*

## State
Local-first budget app, **CSV-import** based. Node 24 + Express 5 + built-in `node:sqlite`; vanilla-JS
frontend, custom animated SVG charts, no build step, no external data deps, no credentials. Real app runs
on `:4000`. Owner = single user (Ardent Credit Union). Real data in `data/budget.db` (gitignored).

**Git:** on branch `feature/archive-merchant-learning-yoy` (HEAD `066fc14` = archive-year fix). Pushed to a
**private GitHub repo `ipaselt/personal-budget`** (default branch `master` @ `821fc59`). The whole feature
branch is still **REVIEW-PENDING before merge to master** (schema migration + broad multi-file + balance math
= full-review triggers). Feature-branch pushes aren't gated; the PR/review is the gate before master.

## ⭐ THIS SESSION (2026-07-05) — frontend redesign, in a SANDBOX (not yet ported)
Owner wanted the frontend re-imagined (not recolored). Built **"Mission Control"** — a dense dark
command-center design — as a **full working copy in `branches/redesign-preview/` (GITIGNORED sandbox), runs
on `:4001`** against its own db copy. **The real app `public/` is UNTOUCHED.** Chosen from 3 previewable
concepts (Calm Capital / Mission Control / Soft Ledger — static mockups were at `:4001/concepts/*.html`).

Redesign includes (all verified via DOM eval + API curl on :4001):
- **Icon rail** (left) — clickable: home→Overview, calendar→active year, archive→archived year, import→CSV
  picker; active-state highlight; keyboard-accessible.
- **Segmented tabs**, **KPI strip** = active-year Income/Spending/Savings/Leftover with **YoY deltas vs prior
  year** (green/red by good-direction) + Balance + Saved%.
- **Overview donut = cumulative ALL-YEARS total** (owner wants it to "grow"; center $84,030 now) while the
  KPIs stay active-year — deliberate split.
- **Budget-progress rows** (spent vs year-scaled budget, over = red, still inline-editable), **plain-English
  insight line**, **recent-activity peek**, monospace tabular figures, hairline bento.
- **Backend:** `/api/overview` extended (additive) with per-category active-year `spent`/`yearLimit` + `recent`.
- Year view rebalanced to two columns; category-donut palette retuned; favicon added.

**Distribution + data (in OneDrive, for the owner's Mac):**
- `personal-budget-redesign.zip` — the redesign, unzip-and-run (bundled deps, **Google Fonts stripped →
  fully offline/system-fonts**, no data/.env). Rebuilt with forward-slash zip entries (macOS-safe).
- `personal-budget-2026.csv` / `personal-budget-2027.csv` — **216 rows each**, accounts `2026`/`2027`,
  exported from the sandbox db (faithful reproduction of the numbers the owner has been viewing).
- Old `personal-budget.zip` (original design) left untouched alongside.

## Next
- **Decide on the redesign:** port `branches/redesign-preview/` → real `public/` + `server.js` (owner's call).
  When porting: it's a broad multi-file change → run an independent review first (subagent over the diff),
  and flag `/code-review ultra` before it lands on master.
- **FIRST for the existing feature branch: review → merge to master** (still the gate; see Git above).
- Backlog: **leftover rollover / envelope budgeting** (deferred). Redesign feature ideas proposed; owner
  greenlit only the **insight line** (done) — budget pace/projection, txn search, CSV export were declined for now.

## How to run / test
- Real app: `npm start` → :4000. Redesign sandbox: `PORT=4001 node branches/redesign-preview/server.js` → :4001.
- **Background servers do NOT survive session boundaries here** — restart with the **absolute path** to
  `server.js` (the bg shell's cwd resets to `~/Developer`, so a relative path fails). See [lessons.md](lessons.md).
- **Never test mutations against the live DB** (back up first). Preview screenshot/eval tools are flaky
  (timeouts) — verify via DOM `eval` + API `curl`. See [decisions.md](decisions.md) / [lessons.md](lessons.md).
