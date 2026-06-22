// Plaid API client. Reads keys from environment (.env) — the secret stays
// server-side and is never sent to the browser.
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

const env = process.env.PLAID_ENV || 'sandbox';

export const plaidConfigured = Boolean(
  process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET
);

export const plaidEnv = env;

export const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  })
);
