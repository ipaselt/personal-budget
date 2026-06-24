# Personal Budget — CONTEXT.md

Working detail for `projects/personal-budget/`. Last updated: 2026-06-23.

> **Solo, non-orchestrated** project (no `.orchestrated` marker). No planner/worker split, no PR-merge
> gate — work directly on `master` and commit when the owner asks. The orchestration boilerplate in the
> template does not apply here.

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
- **Never test against `data/budget.db`** (real data) — back it up, test, restore.
- Categories are baked at import → after a `RULES` change the owner must **re-import** the CSV.
- `node:sqlite` needs **Node ≥ 22.5**.

## What NOT to Do
- Never commit `.env` or `data/` (both gitignored — `data/` holds the owner's financial data).
- Don't add a bank/third-party network dependency — the whole point is local + credential-free.
- Don't reintroduce Plaid.
