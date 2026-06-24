import 'dotenv/config';
import express from 'express';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stmt, inTransaction } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));
// Never cache API responses, so the UI always reflects the latest data
// (e.g. budget totals updating immediately after recategorizing a transaction).
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// The built-in budget categories, in display order.
const DEFAULT_BUCKETS = [
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
const SAVINGS_BUCKET = 'Savings/Investing';

// Full category list = built-ins + any custom categories the user has added.
const expenseBuckets = () => [...DEFAULT_BUCKETS, ...stmt.listCategories.all().map((r) => r.name)];

// Keyword → category rules, checked in order (specific before general).
// 'Income' and 'Transfer' are not spending buckets — they're handled separately.
// Edit freely; anything unmatched falls back to Income (inflow) or Miscellaneous (outflow).
const RULES = [
  ['Income', ['PAYROLL', 'DIRECT DEP', 'DIRECT DEPOSIT', 'SALARY', 'PAYCHECK', 'GUSTO', 'INTEREST', 'DIVIDEND', 'TAX REF', 'IRS TREAS', 'SSA', 'PENSION']],
  // Savings before Transfer so "TRANSFER TO SAVINGS" lands in Savings, not the generic Transfer bucket.
  ['Savings/Investing', ['SAVINGS', 'TO S0001', 'S0001', 'VANGUARD', 'FIDELITY', 'SCHWAB', 'ROBINHOOD', 'ACORNS', 'WEALTHFRONT', 'BETTERMENT', '401K', 'ROTH', ' IRA', 'BROKERAGE', 'COINBASE', 'INVEST']],
  ['Transfer', ['TRANSFER TO', 'TRANSFER FROM', 'XFER', 'ATM', 'CASH WITHDRAWAL', 'ONLINE BANKING', 'TO SHARE', 'FROM SHARE', 'OVERDRAFT', 'INTERNAL']],
  ['Debt Payments', ['STUDENT LOAN', 'CARD PAYMENT', 'CREDIT CARD', 'CC PAYMENT', 'PAYMENT THANK', 'DISCOVER E-PAY', 'CHASE CREDIT', 'CAPITAL ONE', 'AMEX EPAYMENT', 'SOFI', 'AFFIRM', 'KLARNA', 'LOAN PMT', 'LOAN PAYMENT']],
  ['Housing (Rent/Mortgage)', ['RENT', 'MORTGAGE', 'HOA', 'PROPERTY MGMT', 'APARTMENT', 'LANDLORD', 'LEASING', 'ZILLOW']],
  ['Utilities', ['ELECTRIC', 'NATURAL GAS', 'GAS COMPANY', 'GAS UTILITY', 'UTILITY', 'UTILITIES', 'WATER', 'SEWER', 'PG&E', 'PGE', 'CON ED', 'CONED', 'DUKE ENERGY', 'NATIONAL GRID', 'PSE&G', 'PECO', 'DOMINION', 'WASTE', 'GARBAGE']],
  ['Phone/Internet', ['VERIZON', 'AT&T', 'T-MOBILE', 'TMOBILE', 'SPRINT', 'COMCAST', 'XFINITY', 'SPECTRUM', 'COX COMM', 'CENTURYLINK', 'GOOGLE FI', 'INTERNET', 'WIRELESS']],
  ['Insurance', ['INSURANCE', 'GEICO', 'STATE FARM', 'PROGRESSIVE', 'ALLSTATE', 'LIBERTY MUTUAL', 'NATIONWIDE', 'USAA', 'METLIFE', 'AETNA', 'CIGNA', 'BLUE CROSS', 'INS PREM']],
  ['Subscriptions', ['NETFLIX', 'SPOTIFY', 'HULU', 'DISNEY', 'HBO', 'YOUTUBE PREMIUM', 'PRIME VIDEO', 'AMAZON PRIME', 'PARAMOUNT', 'PEACOCK', 'AUDIBLE', 'PATREON', 'ADOBE', 'OPENAI', 'CHATGPT', 'ICLOUD', 'DROPBOX', 'NYTIMES', 'SUBSTACK', 'APPLE.COM/BILL']],
  ['Groceries', ['GROCERY', 'SAFEWAY', 'TRADER JOE', 'WHOLE FOODS', 'KROGER', 'ALDI', 'PUBLIX', 'WEGMANS', 'FOOD LION', 'HARRIS TEETER', 'SHOPRITE', 'STOP & SHOP', 'SPROUTS', 'HEB', 'MEIJER', 'WINCO']],
  ['Dining Out', ['UBER EATS', 'DOORDASH', 'GRUBHUB', 'SEAMLESS', 'POSTMATES', 'RESTAURANT', 'MCDONALD', 'STARBUCKS', 'CHIPOTLE', 'KFC', 'BURGER', 'PIZZA', 'TACO', 'CAFE', 'COFFEE', 'DUNKIN', 'PANERA', 'CHICK-FIL-A', 'WENDY', 'SUBWAY', 'GRILL', 'DINER', 'BREWING', 'SHAKE SHACK', 'FIVE GUYS', 'WAWA', 'HANDEL', 'CAVA', 'POUR RICHARD', 'TREDICI']],
  ['Transportation/Gas', ['UBER', 'LYFT', 'SHELL', 'CHEVRON', 'EXXON', 'GULF OIL', 'GULF', 'SUNOCO', 'VALERO', 'ARCO', 'GAS', 'FUEL', 'PARKING', 'TOLL', 'EZPASS', 'TRANSIT', 'SEPTA', 'AMTRAK', 'METRO', 'AIRLINE', 'GASOLINE']],
  ['Health/Medical', ['PHARMACY', 'CVS', 'WALGREENS', 'RITE AID', 'DOCTOR', 'MEDICAL', 'HOSPITAL', 'CLINIC', 'DENTAL', 'DENTIST', 'OPTOMETRY', 'LABCORP', 'QUEST DIAG', 'COPAY', 'URGENT CARE']],
  ['Personal Care', ['SALON', 'BARBER', 'SPA', 'NAIL', 'HAIR', 'GYM', 'FITNESS', 'PLANET FIT', 'LA FITNESS', 'EQUINOX', 'CRUNCH', 'MASSAGE', 'SEPHORA', 'ULTA', 'NATHAN AND SONS']],
  ['Entertainment', ['MOVIE', 'CINEMA', 'AMC', 'REGAL', 'THEATER', 'STEAM', 'PLAYSTATION', 'XBOX', 'NINTENDO', 'CONCERT', 'TICKETMASTER', 'STUBHUB', 'GOLF', 'GLF*', 'LANDISCREEK', 'LANDIS CREEK', 'BOGEYS', 'BIRDIES', 'BOWLING', 'MUSEUM', 'SIX FLAGS', 'EVENTBRITE', 'TWITCH']],
  ['Shopping', ['AMAZON', 'AMZN', 'TARGET', 'WALMART', 'COSTCO', 'BEST BUY', 'EBAY', 'ETSY', 'MACY', 'NORDSTROM', 'NIKE', 'IKEA', 'HOME DEPOT', 'LOWES', 'WAYFAIR', 'MARSHALLS', 'TJ MAXX', 'OLD NAVY', 'H&M', 'ZARA', 'SHEIN', 'STAPLES']],
];

export function categorize(description, isInflow) {
  const d = (description || '').toUpperCase();
  for (const [bucket, keys] of RULES) {
    for (const k of keys) if (d.includes(k)) return bucket;
  }
  return isInflow ? 'Income' : 'Miscellaneous';
}

// --- CSV parsing -----------------------------------------------------------
// Minimal RFC-4180-ish parser: handles quoted fields, embedded commas, and "" escapes.
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = String(text).replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (v) => {
  if (v == null) return 0;
  let s = String(v).trim().replace(/[$,\s]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); } // (50.00) = -50
  const n = parseFloat(s);
  return isFinite(n) ? (neg ? -n : n) : 0;
};

function parseDate(v) {
  const s = String(v || '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)))
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/))) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = '20' + yr;
    return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  }
  return null;
}

const round2 = (n) => Math.round(n * 100) / 100;
const currentMonth = () => new Date().toISOString().slice(0, 7);
const displayCategory = (t) => t.user_category || t.category || 'Miscellaneous';

// Reduce transactions to income / spending / savings + per-bucket spend.
function computeTotals(txns) {
  let income = 0, spending = 0;
  const spentByBucket = Object.fromEntries(expenseBuckets().map((b) => [b, 0]));
  for (const t of txns) {
    const cat = t.user_category || t.category || 'Miscellaneous';
    if (cat === 'Income') {
      if (t.amount > 0) income += t.amount;
      continue;
    }
    if (cat === 'Transfer') continue; // moving your own money — ignore
    const spend = -t.amount; // outflow (negative) -> positive spend; refund (positive) reduces it
    spentByBucket[cat] = (spentByBucket[cat] || 0) + spend;
    if (cat !== SAVINGS_BUCKET) spending += spend;
  }
  const savings = spentByBucket[SAVINGS_BUCKET] || 0;
  return { income, spending, savings, leftover: Math.max(0, income - spending - savings), spentByBucket };
}

// --- API -------------------------------------------------------------------
app.post('/api/import', express.text({ type: '*/*', limit: '15mb' }), (req, res) => {
  try {
    const rows = parseCSV(req.body || '');
    if (rows.length < 2) return res.status(400).json({ error: 'CSV has no data rows.' });

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const find = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
    const col = {
      account: find('account'),
      date: find('post date', 'date'),
      desc: find('description', 'memo', 'payee'),
      debit: find('debit', 'withdrawal'),
      credit: find('credit', 'deposit'),
      amount: find('amount'),
      balance: find('balance'),
      status: find('status'),
    };
    if (col.date < 0 || col.desc < 0)
      return res.status(400).json({ error: 'Could not find Date and Description columns in the CSV header.' });
    if (col.debit < 0 && col.credit < 0 && col.amount < 0)
      return res.status(400).json({ error: 'Could not find Debit/Credit or Amount columns.' });

    const latestByAccount = {};
    let imported = 0, skipped = 0;

    inTransaction(() => {
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row.length || row.every((c) => !c || !c.trim())) continue;

        const date = parseDate(row[col.date]);
        if (!date) { skipped++; continue; }
        const desc = (row[col.desc] || '').trim();
        const account = col.account >= 0 ? (row[col.account] || '').trim() || 'account' : 'account';

        let amount;
        if (col.debit >= 0 || col.credit >= 0) {
          const debit = col.debit >= 0 ? Math.abs(num(row[col.debit])) : 0;
          const credit = col.credit >= 0 ? Math.abs(num(row[col.credit])) : 0;
          amount = credit > 0 ? credit : -debit; // + = money in, - = money out
        } else {
          amount = num(row[col.amount]); // negative = outflow
        }
        if (amount === 0) { skipped++; continue; }

        const balance = col.balance >= 0 ? num(row[col.balance]) : null;
        const pending = col.status >= 0 && /pending/i.test(row[col.status] || '') ? 1 : 0;
        const category = categorize(desc, amount > 0);

        const id = createHash('sha1')
          .update([account, date, desc, amount, balance].join('|'))
          .digest('hex')
          .slice(0, 16);

        stmt.upsertTxn.run(id, account, date, desc, amount, category, balance, pending);
        imported++;

        if (balance != null) {
          const prev = latestByAccount[account];
          if (!prev || date >= prev.date) latestByAccount[account] = { date, balance };
        }
      }
      for (const [account, info] of Object.entries(latestByAccount)) {
        stmt.upsertAccount.run(account, info.balance, info.date);
      }
    });

    res.json({ ok: true, imported, skipped });
  } catch (err) {
    console.error('Import error:', err);
    res.status(400).json({ error: 'Could not parse CSV: ' + err.message });
  }
});

app.get('/api/status', (req, res) => {
  const c = stmt.counts.get();
  res.json({ hasData: (c.n || 0) > 0, count: c.n || 0, earliest: c.earliest, latest: c.latest });
});

// Transactions for a period: 'all', a year 'YYYY', or a month 'YYYY-MM'.
function txnsForPeriod(period) {
  if (period === 'all') return stmt.allTxns.all();
  if (/^\d{4}(-\d{2})?$/.test(period)) return stmt.txnsForMonth.all(`${period}%`);
  return stmt.txnsForMonth.all(`${currentMonth()}%`);
}

// Budget table + totals + donut for a period (month, year, or all-time).
// Budgets are monthly limits, so they're scaled by the number of months with
// data in the period — keeping "budget vs spent" a fair comparison.
app.get('/api/summary', (req, res) => {
  const period = req.query.period || currentMonth();
  const txns = txnsForPeriod(period);
  const budgets = Object.fromEntries(stmt.listBudgets.all().map((b) => [b.category, b.monthly_limit]));
  const t = computeTotals(txns);
  const monthCount = new Set(txns.map((x) => x.date.slice(0, 7))).size || 1;

  res.json({
    period,
    monthCount,
    income: round2(t.income),
    spending: round2(t.spending),
    savings: round2(t.savings),
    leftover: round2(t.leftover),
    categories: expenseBuckets().map((b) => ({
      category: b,
      spent: round2(t.spentByBucket[b] || 0),
      limit: budgets[b] != null ? round2(budgets[b] * monthCount) : null,
    })),
    transactions: txns.map((x) => ({ ...x, effective_category: displayCategory(x) })),
  });
});

// Landing view: all-time totals, current balance, month list, budgets.
app.get('/api/overview', (req, res) => {
  const t = computeTotals(stmt.allTxns.all());
  const accounts = stmt.listAccounts.all();
  const balance = accounts.reduce((s, a) => s + (a.current_balance || 0), 0);
  const budgets = Object.fromEntries(stmt.listBudgets.all().map((b) => [b.category, b.monthly_limit]));
  const c = stmt.counts.get();

  res.json({
    income: round2(t.income),
    spending: round2(t.spending),
    savings: round2(t.savings),
    leftover: round2(t.leftover),
    balance: round2(balance),
    accountCount: accounts.length,
    latest: c.latest,
    months: stmt.distinctMonths.all().map((r) => r.month),
    categories: expenseBuckets().map((b) => ({
      category: b,
      limit: budgets[b] ?? null,
      custom: !DEFAULT_BUCKETS.includes(b),
    })),
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

app.post('/api/category', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name required.' });
  if (name.length > 40) return res.status(400).json({ error: 'Name is too long (max 40 chars).' });
  if (/[<>"'&]/.test(name)) return res.status(400).json({ error: 'Name cannot contain < > " \' or &.' });
  const taken = new Set(
    [...DEFAULT_BUCKETS, 'Income', 'Transfer', ...stmt.listCategories.all().map((r) => r.name)]
      .map((s) => s.toLowerCase())
  );
  if (taken.has(name.toLowerCase()))
    return res.status(400).json({ error: 'That category already exists.' });
  stmt.insertCategory.run(name);
  res.json({ ok: true });
});

app.delete('/api/category', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name required.' });
  if (DEFAULT_BUCKETS.includes(name))
    return res.status(400).json({ error: 'Built-in categories cannot be deleted.' });
  inTransaction(() => {
    stmt.deleteCategory.run(name); // remove the custom category
    stmt.clearUserCategory.run(name); // revert any transactions assigned to it
    stmt.deleteBudget.run(name); // drop its budget
  });
  res.json({ ok: true });
});

app.post('/api/transaction_category', (req, res) => {
  const { transaction_id, user_category } = req.body;
  if (!transaction_id) return res.status(400).json({ error: 'transaction_id required' });
  stmt.setUserCategory.run(user_category || null, transaction_id);
  res.json({ ok: true });
});

const port = process.env.PORT || 4000;
// Only start the server when run directly (so the categorizer can be imported for tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, () => {
    console.log(`\n  Personal Budget running:  http://localhost:${port}`);
    console.log(`  Data source:              CSV import (local only)\n`);
  });
}
