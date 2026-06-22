# In Progress — <project>

> The live **in-progress board** (🔄). **The planner** (sole writer of `planning/*.md` — hook-enforced via
> `planning-single-writer.sh`) **moves a task here** from `todo.md` at dispatch, and **out** to
> `../memory/completed-tasks.md` on merge — workers never edit this file (they read their assignment + report
> in their output). Dates absolute (`YYYY-MM-DD`).
> *(Where-are-we = this board + the top of `../memory/completed-tasks.md`; what's-next = `todo.md`.)*
>
> **Owner format:** `owner: <handle> · session: <uuid>` — `<handle>` = the stable worker name; `<session>` =
> its live `$CLAUDE_CODE_SESSION_ID` (echo it, never guess), the key the resume hook matches.

## In progress
- 🔄 **#<N>** <task title> · **owner:** <handle> · **session:** `<uuid>` · branch `branches/<task-slug>` · status: <where it stands · last update · blockers>
