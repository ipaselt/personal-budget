# Task Queue — <project>

> The **pending backlog** (`⏳`). The **planner is the sole assigner AND the single writer of `planning/*.md`** —
> workers never add, reassign, or move tasks here. Each task is tagged `owner: <handle> · session: <uuid>`.
>
> Loop (canonical spec: VAN-CLIEF §9): the planner moves a task `todo.md → progress.md` (`🔄`) **at dispatch**;
> the worker builds in `branches/<slug>/` → PR → auto independent review (reviewer subagent; escalates →
> `/code-review ultra` if large/risky/critical) → the human reviews the live feature → merge → the planner moves
> it to `../memory/completed-tasks.md` (`✅`). Workers read their assignment + report in their output — they
> never edit these files. (Surfaced post-compact by the resume hook, matched by `session:`.)

## Queue
*(stable `#N` IDs — never renumber. `session:` = the worker's `$CLAUDE_CODE_SESSION_ID` via `echo`, never guessed.)*
- ⏳ **#<N>** <task title> — <one-line scope> · **owner:** <handle | unassigned> · **session:** `<uuid>` · branch `<task-slug>`

✅ Completed → `../memory/completed-tasks.md` (the planner moves merged tasks there on merge).
