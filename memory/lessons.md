# Lessons — personal-budget (in-repo durable record)

> Project-specific lessons — the version-controlled subset distilled from this project's **native
> auto-memory** by `/wrap`; `/groom` consolidates. Keep it lean, one fact per entry, pointers not
> re-explanations. Cross-project orchestration wisdom lives in `~/Developer/memory/lessons.md`; truly
> universal lessons graduate up into `~/.claude/rules/`.

- **Never test against the live DB.** Owner's real data lives in `data/budget.db`. To verify anything
  that mutates (import, add/delete category, recategorize): stop server → `cp data/budget.db /tmp/x.db`
  → restart → test → restore the backup → restart. Used repeatedly this session; protects real data.
- **Categorizer is unit-testable.** `server.js` exports `categorize()` and guards `app.listen` with
  `if (process.argv[1] === fileURLToPath(import.meta.url))`, so a test can `import { categorize }` without
  starting a server. Use this to prove RULES changes before asking the owner to re-import.
- **Categories are assigned at import time** (stored in `category`). After editing `RULES`, the owner
  must **re-import the same CSV** to re-apply (idempotent; manual `user_category` overrides survive).
- **Express auto-ETags JSON responses** → fetch can return stale data after a write. Always set
  `Cache-Control: no-store` on API routes for a read-after-write UI.
- **`node:sqlite` needs Node ≥ 22.5** (experimental). Set in `engines`; surfaces as a `node:sqlite`
  import error on older Node. `--no-warnings` in the npm scripts hides the experimental warning.
- **Keyword-rule ordering matters** (first match wins): specific before general. Watch substring
  collisions — "via Mobile" matched the `MOBIL` gas keyword; "TRANSFER TO SAVINGS" needs Savings
  checked before Transfer; "UBER EATS" needs Dining before Transportation.
- **Packaging a Node app for Mac:** deps here are pure-JS (no `.node` binaries) so bundle `node_modules`
  for unzip-and-run. **PowerShell 5.1 `Compress-Archive` writes backslash paths that break on macOS** —
  build the zip via `System.IO.Compression.ZipArchive` with forward-slash entry names instead (`zip`
  isn't installed in this git-bash). Verify with `unzip -l`/`unzip -tq` and boot the extracted copy.
- **Gmail blocks `.js` attachments even inside a `.zip`** (scans archive contents). Move dev artifacts
  to the Mac via **iCloud Drive** (`~/iCloudDrive`) or **OneDrive** (`~/OneDrive`), not email.
- **Serena dashboard auto-open** (unrelated to this repo): set `web_dashboard_open_on_launch: false` in
  `~/.serena/serena_config.yml` to stop the browser tab popping on every Claude launch.
- **Preview tools are flaky here** — `preview_screenshot` and sometimes `preview_eval` time out (30s) even
  though the page is live. Verify behavior with DOM `eval` (read state directly) and API `curl`; `location.reload()`
  inside an eval races your follow-up clicks — set `active` + call `refresh()` instead of reloading.
- **Test schema/data changes on a throwaway month/year, then clean up.** Used `2099-xx` months and account
  ids like `7777`/`9999` for import/recategorize/clear tests; `clear_month` + `deleteOrphanAccounts` removes
  them. For the new tables you can open a 2nd `node:sqlite` connection (`import { db } from './db.js'`) for a
  quick DELETE/reset while the server holds the file — fast ops don't lock-conflict.
- **Stub `window.confirm = () => true` in preview eval** before clicking actions guarded by `confirm()`
  (Start new year, Restore, Clear month, delete category) or the eval hangs on the dialog.
- **Multi-year tab model:** shown year tabs = `(data years ∪ active_year) − archived`. A year that has data
  but is neither active nor archived still shows (don't strand data); archiving is what removes it from tabs.
