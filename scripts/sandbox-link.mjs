// Dev helper: link a Sandbox bank WITHOUT the browser, to verify the full
// backend pipeline (exchange -> accounts -> transactions sync -> summary).
// Requires the server to be running.  Usage:  node scripts/sandbox-link.mjs
import 'dotenv/config';
import { Products } from 'plaid';
import { plaid } from '../plaid.js';

const SERVER = `http://localhost:${process.env.PORT || 4000}`;
const INSTITUTION = 'ins_109508'; // "First Platypus Bank" — a Plaid Sandbox test bank

const { data: tok } = await plaid.sandboxPublicTokenCreate({
  institution_id: INSTITUTION,
  initial_products: [Products.Transactions],
});

const res = await fetch(`${SERVER}/api/exchange_public_token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    public_token: tok.public_token,
    institution: { name: 'First Platypus Bank (Sandbox)' },
  }),
});

const body = await res.json();
console.log(res.ok ? 'LINKED ->' : 'FAILED ->', JSON.stringify(body));
process.exit(res.ok ? 0 : 1);
