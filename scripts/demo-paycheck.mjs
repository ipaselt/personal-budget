// TEMPORARY: inserts one $5,000 "paycheck" (INCOME) into every month that has
// data, so the pie shows all three slices (Spending / Savings / Leftover) while
// testing on Sandbox data (which has no real paycheck).
// Remove before going to Production with:  node scripts/demo-paycheck.mjs remove
import { db, stmt } from '../db.js';

const PER_MONTH = 5000;

if (process.argv[2] === 'remove') {
  db.prepare("DELETE FROM transactions WHERE transaction_id LIKE 'DEMO_PAYCHECK_%'").run();
  console.log('Removed demo paychecks.');
} else {
  const months = stmt.distinctMonths.all().map((r) => r.month);
  for (const m of months) {
    // (id, account_id, date, name, merchant_name, amount, category, detailed, pending)
    stmt.upsertTxn.run(
      'DEMO_PAYCHECK_' + m, 'demo', m + '-15', 'Demo Paycheck', 'Employer Payroll',
      -PER_MONTH, 'INCOME', 'INCOME_WAGES', 0
    );
  }
  console.log(`Inserted $${PER_MONTH} demo paychecks for: ${months.join(', ')}`);
}
