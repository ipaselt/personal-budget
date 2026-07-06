# Primer — personal-budget
*Rewrite each session. Last updated: 2026-07-05.*

## State
Local-first budget app, **CSV-import** based. Node 24 + Express 5 + built-in `node:sqlite`; vanilla-JS
frontend, custom animated SVG charts, no build step, no external data deps, no credentials. Real app runs
on `:4000`. Owner = single user (Ardent Credit Union). Real data in `data/budget.db` (gitignored).

**Git:** **`master` @ `9f3330e`, pushed to private GitHub `ipaselt/personal-budget`** — the feature branch
`feature/archive-merchant-learning-yoy` (merchant learning, year rollover/archive, YoY, chart redesign,
archive-year fix, the redesign port + first-run polish + ultra-review fixes) fast-forward-merged to master
this session. Reviewed before merge: an independent subagent pass + a local max-effort multi-agent pass
(cloud `ultrareview` unavailable in-session); blockers fixed. The old feature branch ref still exists locally.

## ⭐ THIS SESSION (2026-07-05) — redesign PORTED to production + first-run polish + data reset
The "Mission Control" redesign (previously a `branches/redesign-preview/` sandbox on `:4001`) is now **PORTED
into the real `public/` + `server.js` + `db.js`** — the real app on `:4000` IS the redesign; the sandbox is
superseded (kept, gitignored). Added this session: **first-run empty state** (no data → "Import your bank CSV"
CTA, hides the $0 KPIs/charts; needs the `[hidden]{display:none!important}` reset to work — see lessons),
**import feedback** (`/api/import` → added/duplicates/uncategorized; banner shows them), **red recent-activity
spending amounts**, and escaping of CSV descriptions in the txn table. **DB reset to a clean 2026 slate**
(0 txns/accounts/budgets/archived, `active_year=2026`) for the owner's real data; sample + real-data backups
in `data/budget.*-backup-*.db` (gitignored). Chosen earlier from 3 concepts (Calm Capital / Mission Control /
Soft Ledger).

Redesign includes (verified via computed-display DOM eval + API curl on :4000):
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
- **Owner imports their real bank CSV** on the clean 2026 DB (`master` app, `:4000`) — real testing.
- Refresh the OneDrive distribution zip from the merged real app if the owner wants the updated build on the Mac.
- **Deferred ultra-review items (not blockers):** dedup id folds in running balance → re-export double-count
  (design trade-off, not a quick fix); redundant full-table reads on `/api/overview` `/api/import` `/api/summary`
  (negligible at scale). Details in [CLAUDE.md](../CLAUDE.md) "Next up".
- Backlog: **leftover rollover / envelope budgeting** (deferred). Redesign feature ideas proposed; owner
  greenlit only the **insight line** (done) — budget pace/projection, txn search, CSV export were declined for now.

## How to run / test
- Real app: `npm start` → :4000. Redesign sandbox: `PORT=4001 node branches/redesign-preview/server.js` → :4001.
- **Background servers do NOT survive session boundaries here** — restart with the **absolute path** to
  `server.js` (the bg shell's cwd resets to `~/Developer`, so a relative path fails). See [lessons.md](lessons.md).
- **Never test mutations against the live DB** (back up first). Preview screenshot/eval tools are flaky
  (timeouts) — verify via DOM `eval` + API `curl`. See [decisions.md](decisions.md) / [lessons.md](lessons.md).
