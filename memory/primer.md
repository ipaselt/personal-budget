# Primer — personal-budget
*Rewrite each session. Last updated: 2026-06-26.*

## State
Local-first budget app, **CSV-import** based. Node 24 + Express 5 + built-in `node:sqlite`; vanilla-JS
frontend, custom animated SVG charts, no build step, no external data deps, no credentials. Runs on `:4000`.
Owner = single user (Ardent Credit Union). Real data in `data/budget.db` (**414 txns, Jan–Jun 2026**, gitignored).

**⚠️ STATUS: this whole session's work is committed on a FEATURE BRANCH, NOT master, and is REVIEW-PENDING.**
It hit the full-review triggers (schema migration, broad multi-file, balance/comparison math). `master` is
still at `821fc59`. Next step before merge: an independent adversarial review (subagent over the diff, or
the owner runs `/code-review ultra`). See branch name in `git log`.

**Built & working this session (all verified in-browser via preview DOM eval + API curl):**
- **Merchant learning** — recategorizing a txn saves a rule (`UPPER(description)→category`, table
  `learned_categories`); applies to all matching rows now AND on every future import (so a fix sticks).
- **Tab redesign** — Jan–Dec month tabs are GONE. Tab bar = **Overview · [non-archived years] · Archive ▾**.
  Months are reached by **drilling into a year's grid** (click a cell), with a **← Back to {year}** button.
- **Year rollover** — **Start new year ↻** archives the active year (`app_settings.active_year`,
  `archived_years`) and opens the next; archived years show in the **Archive ▾** dropdown, **read-only**
  (import/clear/add hidden, per-row category dropdowns disabled). **↩ Restore year** un-archives (undoes
  accidental archiving; rolls active back if the new year is still empty).
- **Year-over-year** — a month view shows this-year (solid) vs same-month-last-year (faded ghost) bars when
  prior data exists (`/api/summary` returns `prior`); title "Jan 2027 vs Jan 2026".
- **Charts** — Overview has a **3×4 month grid** (small-multiples, one mini bar chart per month, $ labels);
  **click a month cell → the all-time donut rescopes to that month** (toggle off by re-click). Each month
  view shows a **single large bars chart** + a **per-category breakdown donut** (% of spending). Year view
  shows the 3×4 grid (no budget table, capped width).
- Earlier this session: manual **Add transaction** form, **Clear month** (+ orphan-account cleanup),
  empty-state keeps the UI (zeroed) instead of blanking, **per-month Import CSV** that jumps to the
  imported month, removed the header Import button.

## Next
- **FIRST: review the feature branch, then merge to master** (it's the gate; see STATUS above).
- Backlog (owner-requested, in CLAUDE.md "Next up"): **leftover rollover / envelope budgeting** (deferred).
- Possible: CSV export of a year (esp. before archiving), true hard-delete of an archived year's data.

## How to run / test
- `npm start` → http://localhost:4000. Hard-refresh (`Ctrl+Shift+R`) for frontend changes.
- **Never test mutations against the live DB** — back up first (`cp data/budget.db /tmp/x.db`), test on a
  throwaway month (e.g. `2099-xx`), restore/clear. The preview screenshot/eval tools are flaky on this
  machine (timeouts) — verify via DOM `eval` + API `curl`, hand the final visual check to the owner.
- Sample data for testing: full-year CSVs delivered to owner (`personal-budget-2026.csv`, `-2027.csv`,
  account ids `2026`/`2027` so they don't collide with real data); 2-year file in OneDrive.
- See [decisions.md](decisions.md) for the why, [lessons.md](lessons.md) for gotchas.
