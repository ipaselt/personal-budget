# <Project> — CONTEXT.md

Working detail for this project (`projects/<name>/`, or `clients/<client>/projects/<name>/`). Last updated: <YYYY-MM-DD>.

> Lean copy-me skeleton. The canonical orchestration loop is **VAN-CLIEF §9**; the richer reference kit is `guide-setup/van-clief/templates/new-project/`. Keep this a thin instance of those — don't fork the model here.

## What to Load
| Task | Load | Skip |
|------|------|------|
| Resume / "what's next" | `memory/primer.md` + `planning/progress.md` (your `🔄`) → else your assigned `⏳` in `planning/todo.md` | others' tasks |
| Cross-session state | `memory/primer.md` → `memory/decisions.md` | code |
| <common task> | `<file>` | <the rest> |

## The Process
**Worker startup:** before any task, read the project `CLAUDE.md` (L1) + this `CONTEXT.md` (L2) + your role
prompt `~/Developer/guide-setup/van-clief/templates/execution-workers/<role>.md` (the startup
sequence, the 6-tier Preview-first tool tree, the JSON result contract). The method itself is
`…/van-clief/VAN-CLIEF-RULES.md`.

Run by a **planning session** (sole assigner + **single writer of `planning/*.md`**) + **worker sessions**.
The planner moves a task `todo.md → progress.md` at dispatch; the worker reads its assignment, builds in
`branches/<slug>/` → PR → auto independent review (reviewer subagent; escalates → `/code-review ultra` if large/risky/critical) → the human reviews the live feature → merge → `/wrap` → `/compact`.
Production code reaches `main` only via merge; workers never edit `planning/*.md` (canonical: VAN-CLIEF §9).

<project-specific workflows + gotchas>

## Skills & Tools
| Skill / Tool | When | Purpose |
|--------------|------|---------|
| Preview (`mcp__Claude_Preview__*`) | verifying any web UI | DOM-aware, per-session — try FIRST |
| computer-use | only when Preview can't (native / cross-app) | shared physical screen — mutex-gated |

## What NOT to Do
- Workers: never commit code to `main` (merge-only); never touch a `🔄` (in-progress) task.
- <project-specific anti-pattern>
- Never hardcode secrets.
