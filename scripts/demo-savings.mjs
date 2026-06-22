// TEMPORARY: inserts one $500 savings transaction so the "Savings" pie slice
// renders while testing on Sandbox data (which has no real savings transfers).
// Remove it before going to Production with:  node scripts/demo-savings.mjs remove
import { stmt } from '../db.js';

const ID = 'DEMO_SAVINGS_500';

if (process.argv[2] === 'remove') {
  stmt.deleteTxn.run(ID);
  console.log('Removed demo savings transaction.');
} else {
  const date = new Date().toISOString().slice(0, 10); // today (current month)
  // (id, account_id, date, name, merchant_name, amount, category, detailed, pending)
  stmt.upsertTxn.run(
    ID, 'demo', date, 'Demo Savings Transfer', null, 500,
    'TRANSFER_OUT', 'TRANSFER_OUT_SAVINGS', 0
  );
  console.log(`Inserted $500 demo savings transaction dated ${date}.`);
}
