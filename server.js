import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Products, CountryCode } from 'plaid';
import { plaid, plaidConfigured, plaidEnv } from './plaid.js';
import { db, stmt, inTransaction } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// The budget categories the user tracks against, in display order.
const EXPENSE_BUCKETS = [
  'Housing (Rent/Mortgage)',
  'Utilities',
  'Groceries',
  'Dining Out',
  'Transportation/Gas',
  'Insurance',
  'Phone/Internet',
  'Subscriptions',
  'Health/Medical',
  'Personal Care',
  'Entertainment',
  'Shopping',
  'Savings/Investing',
  'Debt Payments',
  'Miscellaneous',
];
// Savings transfers are tracked as their own bucket but are NOT counted as
// consumption spending (so moving money to savings doesn't look like a cost).
const SAVINGS_BUCKET = 'Savings/Investing';

// Map a Plaid transaction's category to one of the buckets above.
// Uses Plaid's `detailed` category where it adds precision, else the primary.
// Returns null for things that are not real spending (internal transfers,
// credit-card payments) so they don't get counted or double-counted.
function mapToBucket(detailed, primary) {
  const d = detailed || '';
  const p = primary || '';

  if (d === 'RENT_AND_UTILITIES_RENT' || d === 'LOAN_PAYMENTS_MORTGAGE_PAYMENT') return 'Housing (Rent/Mortgage)';
  if (p === 'HOME_IMPROVEMENT') return 'Housing (Rent/Mortgage)';
  if (d === 'RENT_AND_UTILITIES_TELEPHONE' || d === 'RENT_AND_UTILITIES_INTERNET_AND_CABLE') return 'Phone/Internet';
  if (p === 'RENT_AND_UTILITIES') return 'Utilities';

  if (d === 'FOOD_AND_DRINK_GROCERIES') return 'Groceries';
  if (p === 'FOOD_AND_DRINK') return 'Dining Out';

  if (p === 'TRANSPORTATION') return 'Transportation/Gas';
  if (d === 'GENERAL_SERVICES_INSURANCE') return 'Insurance';

  if (d === 'ENTERTAINMENT_TV_AND_MOVIES' || d === 'ENTERTAINMENT_MUSIC_AND_AUDIO') return 'Subscriptions';
  if (p === 'MEDICAL') return 'Health/Medical';
  if (p === 'PERSONAL_CARE') return 'Personal Care';
  if (p === 'ENTERTAINMENT' || p === 'TRAVEL') return 'Entertainment';
  if (p === 'GENERAL_MERCHANDISE') return 'Shopping';

  if (d === 'TRANSFER_OUT_SAVINGS' || d === 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS') return SAVINGS_BUCKET;

  // Credit-card payments and pure transfers move money you've already
  // categorized (or between your own accounts) — don't count them.
  if (d === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT') return null;
  if (p === 'LOAN_PAYMENTS') return 'Debt Payments';
  if (p === 'TRANSFER_OUT' || p === 'TRANSFER_IN') return null;

  if (p === 'BANK_FEES' || p === 'GENERAL_SERVICES' || p === 'GOVERNMENT_AND_NON_PROFIT') return 'Miscellaneous';
  return 'Miscellaneous';
}

const currentMonth = () => new Date().toISOString().slice(0, 7); // "YYYY-MM"

// The category shown for a transaction in the list (override wins).
function displayCategory(t) {
  if (t.user_category) return t.user_category;
  if (t.category === 'INCOME') return 'Income';
  if (t.category === 'TRANSFER_IN') return 'Transfer';
  return mapToBucket(t.detailed, t.category) || 'Transfer';
}

// Reduce a set of transactions to income / spending / savings + per-bucket spend.
function computeTotals(txns) {
  let income = 0, spending = 0;
  const spentByBucket = Object.fromEntries(EXPENSE_BUCKETS.map((b) => [b, 0]));
  for (const t of txns) {
    if (t.category === 'INCOME') {
      if (t.amount < 0) income += -t.amount; // paycheck / deposit (inflow is negative)
      continue;
    }
    if (t.category === 'TRANSFER_IN') continue; // money moved in from your own accounts
    const bucket = t.user_category || mapToBucket(t.detailed, t.category);
    if (!bucket) continue; // transfer-out / credit-card payment — ignore (avoids double-count)
    // amount > 0 is spending; amount < 0 is a refund that reduces the bucket.
    spentByBucket[bucket] = (spentByBucket[bucket] || 0) + t.amount;
    if (bucket !== SAVINGS_BUCKET) spending += t.amount; // savings isn't consumption
  }
  const savings = spentByBucket[SAVINGS_BUCKET] || 0;
  return {
    income, spending, savings,
    leftover: Math.max(0, income - spending - savings),
    spentByBucket,
  };
}

// Surface Plaid errors clearly instead of a generic 500.
function sendPlaidError(res, err) {
  const data = err?.response?.data;
  console.error('Plaid error:', data || err.message);
  res.status(400).json({
    error: data?.error_message || err.message,
    error_code: data?.error_code,
  });
}

// --- Sync helpers ----------------------------------------------------------
async function syncAccounts(accessToken, itemId) {
  const { data } = await plaid.accountsGet({ access_token: accessToken });
  inTransaction(() => {
    for (const a of data.accounts) {
      stmt.upsertAccount.run(
        a.account_id, itemId, a.name, a.official_name ?? null,
        a.type ?? null, a.subtype ?? null, a.mask ?? null,
        a.balances?.current ?? null, a.balances?.available ?? null,
        a.balances?.iso_currency_code ?? null
      );
    }
  });
  return data.item?.institution_id ?? null;
}

async function syncTransactions(itemId) {
  const item = stmt.getItem.get(itemId);
  if (!item) throw new Error(`Unknown item ${itemId}`);

  let cursor = item.cursor || undefined;
  const added = [], modified = [], removed = [];
  let hasMore = true;

  while (hasMore) {
    const request = {
      access_token: item.access_token,
      options: { include_personal_finance_category: true },
    };
    if (cursor) request.cursor = cursor;
    const { data } = await plaid.transactionsSync(request);
    added.push(...data.added);
    modified.push(...data.modified);
    removed.push(...data.removed);
    hasMore = data.has_more;
    cursor = data.next_cursor;
  }

  inTransaction(() => {
    for (const t of [...added, ...modified]) {
      stmt.upsertTxn.run(
        t.transaction_id, t.account_id, t.date, t.name,
        t.merchant_name ?? null, t.amount,
        t.personal_finance_category?.primary ?? 'OTHER',
        t.personal_finance_category?.detailed ?? null,
        t.pending ? 1 : 0
      );
    }
    for (const r of removed) stmt.deleteTxn.run(r.transaction_id);
    stmt.setCursor.run(cursor, itemId);
  });

  return { added: added.length, modified: modified.length, removed: removed.length };
}

// --- API -------------------------------------------------------------------
app.get('/api/status', (req, res) => {
  const items = stmt.listItems.all();
  res.json({
    configured: plaidConfigured,
    env: plaidEnv,
    connected: items.length > 0,
    institutions: items.map((i) => i.institution_name).filter(Boolean),
  });
});

app.post('/api/create_link_token', async (req, res) => {
  if (!plaidConfigured) {
    return res.status(400).json({ error: 'Plaid keys are not set. Add them to .env.' });
  }
  try {
    const { data } = await plaid.linkTokenCreate({
      user: { client_user_id: 'local-user' },
      client_name: 'Personal Budget',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });
    res.json({ link_token: data.link_token });
  } catch (err) {
    sendPlaidError(res, err);
  }
});

app.post('/api/exchange_public_token', async (req, res) => {
  try {
    const { public_token, institution } = req.body;
    const { data } = await plaid.itemPublicTokenExchange({ public_token });
    stmt.insertItem.run(data.item_id, data.access_token, institution?.name ?? null);
    await syncAccounts(data.access_token, data.item_id);
    const counts = await syncTransactions(data.item_id);
    res.json({ ok: true, ...counts });
  } catch (err) {
    sendPlaidError(res, err);
  }
});

app.post('/api/sync', async (req, res) => {
  try {
    const items = stmt.listItems.all();
    let totals = { added: 0, modified: 0, removed: 0 };
    for (const item of items) {
      await syncAccounts(item.access_token, item.item_id);
      const c = await syncTransactions(item.item_id);
      totals.added += c.added; totals.modified += c.modified; totals.removed += c.removed;
    }
    res.json({ ok: true, ...totals });
  } catch (err) {
    sendPlaidError(res, err);
  }
});

// Per-month budget table + totals + pie (defaults to the current month).
app.get('/api/summary', (req, res) => {
  const month = req.query.month || currentMonth();
  const txns = stmt.txnsForMonth.all(`${month}%`);
  const budgets = Object.fromEntries(
    stmt.listBudgets.all().map((b) => [b.category, b.monthly_limit])
  );
  const t = computeTotals(txns);

  const categories = EXPENSE_BUCKETS.map((b) => ({
    category: b,
    spent: round2(t.spentByBucket[b] || 0),
    limit: budgets[b] ?? null,
  }));

  res.json({
    month,
    income: round2(t.income),
    spending: round2(t.spending),
    savings: round2(t.savings),
    leftover: round2(t.leftover),
    categories,
    transactions: txns.map((x) => ({ ...x, effective_category: displayCategory(x) })),
  });
});

// Landing view: all-time cumulative totals, cash/stash balances, month list,
// and recent transactions.
app.get('/api/overview', (req, res) => {
  const t = computeTotals(stmt.allTxns.all());
  const accounts = stmt.listAccounts.all();
  const sumBalance = (pred) =>
    accounts.filter(pred).reduce((s, a) => s + (a.current_balance || 0), 0);
  const sub = (a) => (a.subtype || '').toLowerCase();

  const cash = sumBalance(
    (a) => a.type === 'depository' && ['checking', 'cash management', 'prepaid'].includes(sub(a))
  );
  const stash = sumBalance(
    (a) =>
      (a.type === 'depository' && ['savings', 'money market', 'cd'].includes(sub(a))) ||
      a.type === 'investment'
  );

  const budgets = Object.fromEntries(
    stmt.listBudgets.all().map((b) => [b.category, b.monthly_limit])
  );

  res.json({
    income: round2(t.income),
    spending: round2(t.spending),
    savings: round2(t.savings),
    leftover: round2(t.leftover),
    cash: round2(cash),
    stash: round2(stash),
    months: stmt.distinctMonths.all().map((r) => r.month),
    categories: EXPENSE_BUCKETS.map((b) => ({ category: b, limit: budgets[b] ?? null })),
  });
});

app.post('/api/budget', (req, res) => {
  const { category, monthly_limit } = req.body;
  if (!category) return res.status(400).json({ error: 'category required' });
  if (monthly_limit === null || monthly_limit === '' || monthly_limit === undefined) {
    stmt.deleteBudget.run(category);
  } else {
    stmt.setBudget.run(category, Number(monthly_limit));
  }
  res.json({ ok: true });
});

app.post('/api/transaction_category', (req, res) => {
  const { transaction_id, user_category } = req.body;
  if (!transaction_id) return res.status(400).json({ error: 'transaction_id required' });
  stmt.setUserCategory.run(user_category || null, transaction_id);
  res.json({ ok: true });
});

const round2 = (n) => Math.round(n * 100) / 100;

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`\n  Personal Budget running:  http://localhost:${port}`);
  console.log(`  Plaid environment:        ${plaidEnv}`);
  console.log(`  Plaid keys configured:    ${plaidConfigured ? 'yes' : 'NO — add them to .env'}\n`);
});
