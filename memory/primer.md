# Primer — personal-budget
*Rewrite each session. Last updated: 2026-07-07.*

## State
Local-first budget app, **CSV-import** based. Node 24 + Express 5 + built-in `node:sqlite`; vanilla-JS
frontend, custom animated SVG charts, no build step, no external data deps, no credentials. Real app runs
on `:4000`. Owner = single user (Ardent Credit Union). **In REAL USE now**: after the 2026 reset the owner
began importing their real bank CSV — `data/budget.db` (gitignored) holds real financial data (back up before
any mutating test). **Desktop app (Electron) added 2026-07-06** to share with friends (each runs their own local
copy) — `electron/main.mjs` hosts `server.js` in-process; per-user DB in the OS user-data dir via `BUDGET_DATA_DIR`.
**Import preview + generic parser + uncategorized triage added 2026-07-07** (for friends on different banks):
preview→confirm modal before saving, bank-agnostic column/date detection, and an amber "needs category" marker +
"Needs category · N" filter (flag = not-yet-reviewed; picking any category, incl. Miscellaneous, clears it).

**Git:** **`master`, pushed to private GitHub `ipaselt/personal-budget`.** Recent commits: Mission Control
redesign (`9f3330e`) → Electron desktop wrapper (`2a07153`) → import preview + generic parser + triage (this
commit). Each landed on master after an independent fresh-context subagent review (light path); blockers fixed.
Direct-to-master commits are allowed here (solo, non-orchestrated), gated by the pre-push review hook.

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
- **Distribution method decided & working:** friends are **added to the repo and each builds locally** (`npm install
  && npm run dist:mac`) rather than being sent a `.dmg` — a local build auto-targets their Mac's chip AND skips the
  Gatekeeper quarantine wall. One friend already cloned, built, and ran it successfully; now testing with his own
  bank CSV. After building, the app is in `dist/` (NOT auto-installed to /Applications) — open the `.dmg` or run the
  `.app` in `dist/mac*`. Signing (~$99/yr) still optional/deferred. **Owner dislikes the current app icon**
  (`build/icon.svg`/`.png`) — redesign later.
- **Multi-user on different banks:** the generic parser + import preview handle most banks; if a friend's import
  looks wrong, get their header + one sample row and extend `analyzeCsv` synonyms/date formats (don't special-case
  one bank). Owner is actively categorizing their own June data (watch Miscellaneous; merchant learning is global).
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
