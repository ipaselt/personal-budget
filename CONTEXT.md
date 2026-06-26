# Personal Budget — CONTEXT.md

Working detail for `projects/personal-budget/`. Last updated: 2026-06-26.

> **Solo, non-orchestrated** project (no `.orchestrated` marker). No planner/worker split. Small/low-risk
> work commits **directly to `master`** when the owner asks. BUT per the global review-before-push rule,
> **large/risky changes still escalate to a feature branch + independent review before merge** — schema
> migrations, broad multi-file diffs, balance/correctness math. (2026-06-26: this session's batch is on
> such a branch, review-pending — see `memory/primer.md`.)

## What to Load
| Task | Load | Skip |
|------|------|------|
| Resume / "what's next" | `memory/primer.md` → `CLAUDE.md` Current State | template scaffolding |
| Why something is the way it is | `memory/decisions.md` | code |
| Gotchas before editing/testing | `memory/lessons.md` | — |
| Change categorization | `RULES` in `server.js` (then owner re-imports CSV) | — |
| Frontend tweak | `public/app.js` + `public/style.css` (no build step — refresh browser) | — |

## The Process (solo)
Edit → verify (run the server / unit-test `categorize` / backup-test-restore the DB) → tell the owner →
commit to `master` when they say so. The owner runs the app in their browser at http://localhost:4000
and gives feedback; the Chrome extension + Preview have been unreliable this machine, so hand off visual
checks to the owner (have them hard-refresh: `Ctrl+Shift+R`).

## Gotchas (see memory/lessons.md for the full list)
- **Never test mutations against `data/budget.db`** (real data) — use a throwaway month/year (`2099-xx`),
  back up, or clean up after; a 2nd `node:sqlite` connection can reset the new tables.
- Categories are baked at import → after a `RULES` change the owner must **re-import** the CSV. Manual
  `user_category` and `learned_categories` rules survive re-imports.
- `node:sqlite` needs **Node ≥ 22.5**.
- **Preview screenshot/eval tools time out on this machine** — verify via DOM `eval` + API `curl`, hand
  the final visual to the owner (hard-refresh `Ctrl+Shift+R`). Stub `window.confirm=()=>true` for guarded actions.

## What NOT to Do
- Never commit `.env` or `data/` (both gitignored — `data/` holds the owner's financial data).
- Don't add a bank/third-party network dependency — the whole point is local + credential-free.
- Don't reintroduce Plaid.
