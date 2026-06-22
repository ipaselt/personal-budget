# Personal Budget

A local-first budget planner. It links your bank through **Plaid**, pulls your
transactions automatically, and tracks income, spending, and savings against
budgets you set per category. Everything runs on your own machine — your
financial data and Plaid tokens live in a local SQLite file and are never sent
anywhere except Plaid's API.

## Setup

1. **Install dependencies** (already done if you ran it once):
   ```
   npm install
   ```

2. **Add your Plaid keys.** Open `.env` and paste in:
   - `PLAID_CLIENT_ID` — your client_id
   - `PLAID_SECRET` — your **Sandbox** secret while testing

   Find both at <https://dashboard.plaid.com/developers/keys>.
   Leave `PLAID_ENV=sandbox` for now.

3. **Start the app:**
   ```
   npm start
   ```
   Open <http://localhost:4000>.

## Using it

- Click **Connect a bank**. In Sandbox, pick any bank and log in with
  `user_good` / `pass_good` (any MFA code works).
- Transactions pull automatically. Click **Sync** anytime to refresh.
- Set a monthly limit next to any category to create a budget; the progress
  bar turns red when you go over.

## Going live (after Plaid Production approval)

1. In `.env`, set `PLAID_ENV=production` and replace `PLAID_SECRET` with your
   **Production** secret.
2. Restart (`npm start`) and reconnect your real bank.

The code is identical between Sandbox and Production — only `.env` changes.

## How spending is calculated

Plaid reports `amount` as positive when money leaves your account (spending)
and negative when money comes in (income). Income excludes internal
`TRANSFER_IN`; spending excludes internal `TRANSFER_OUT`, so moving money to
savings doesn't look like spending. **Net = income − spending** is what you
saved this month.
