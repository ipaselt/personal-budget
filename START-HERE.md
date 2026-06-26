# Personal Budget — run it on your Mac

A private, local budget app. Nothing leaves your computer — you import a CSV
from your bank and it does the rest. No accounts, no API keys, no internet.

## One-time setup

1. **Install Node.js** (version 22.5 or newer — version 24 recommended).
   - Easiest: go to <https://nodejs.org>, download the "LTS" (or Current) macOS
     installer, and run it.
   - To check it worked, open **Terminal** (Cmd+Space → type "Terminal") and run:
     ```
     node -v
     ```
     You should see something like `v24.x` (must be v22.5 or higher).

2. **Unzip** this folder somewhere you'll remember (e.g. your Desktop).

## Start the app

In **Terminal**, go into the folder and start it. If you unzipped to your
Desktop:
```
cd ~/Desktop/personal-budget
npm start
```
(The dependencies are already bundled, so there's no install step. If you ever
need to rebuild them, run `npm install` first.)

You'll see:
```
Personal Budget running:  http://localhost:4000
```

Open **http://localhost:4000** in your browser.

To stop it, press **Ctrl+C** in Terminal.

## Use it

1. Log in to your bank and **download a transactions CSV**.
2. Click **Import CSV** in the app and pick that file.
3. Set monthly budgets on the **Overview** tab; browse by **month** or **year**
   using the tabs.

Re-importing the same file is safe (no duplicates) — just import again whenever
you download new transactions.

## Notes
- Your data lives only in `data/budget.db` inside this folder, on your machine.
- Tip: if Terminal can't find the folder, type `cd ` (with a space) and then
  drag the unzipped folder onto the Terminal window — it fills in the path.
