import 'dotenv/config';
import express from 'express';
import * as XLSX from 'xlsx';
import { createHash, randomUUID } from 'node:crypto';
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
  const p = (n) => String(n).padStart(2, '0');
  let m;
  // Year-first, dash or slash: 2026-07-06 / 2026/07/06
  if ((m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)))
    return `${m[1]}-${p(m[2])}-${p(m[3])}`;
  // Month-first (US), dash or slash: 7/6/2026, 07-06-26
  if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/))) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = '20' + yr;
    return `${yr}-${p(mo)}-${p(da)}`;
  }
  // Textual months (e.g. "Jul 6, 2026", "6 January 2026") — only when letters are
  // present, so we never re-interpret an ambiguous all-numeric date. Local
  // components avoid a timezone day-shift.
  if (/[a-z]/i.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

// Build transaction records from tabular rows (array-of-arrays, row 0 = header) by
// auto-detecting columns. Shared by CSV and spreadsheet (XLS/XLSX) imports — both
// reduce to rows, so the column detection lives here once.
// Returns { error } on a header problem, else { detected, records, skipped }.
function rowsToRecords(rows) {
  if (!rows || rows.length < 2) return { error: 'File has no data rows.' };

  const rawHeader = rows[0].map((h) => String(h == null ? '' : h).trim());
  const header = rawHeader.map((h) => h.toLowerCase());
  const find = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const col = {
    account: find('account'),
    date: find('post date', 'date'),
    // Prefer the unambiguous description headers; only fall back to weaker synonyms
    // when none are present. (Chase's header is "Details,Posting Date,Description,…"
    // where the Details column holds DEBIT/CREDIT — a plain first-match on 'details'
    // would grab that instead of the real Description column and corrupt every row.)
    desc: find('description', 'memo', 'payee'),
    debit: find('debit', 'withdrawal', 'money out', 'paid out'),
    credit: find('credit', 'deposit', 'money in', 'paid in'),
    amount: find('amount'),
    balance: find('balance'),
    status: find('status'),
  };
  if (col.desc < 0) col.desc = find('merchant', 'details', 'narration', 'narrative');
  if (col.date < 0 || col.desc < 0)
    return { error: 'Could not find Date and Description columns in the header.' };
  if (col.debit < 0 && col.credit < 0 && col.amount < 0)
    return { error: 'Could not find Debit/Credit or Amount columns.' };

  const cell = (row, i) => (i >= 0 && row[i] != null ? String(row[i]) : '');
  const records = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length || row.every((c) => c == null || !String(c).trim())) continue; // blank line

    const date = parseDate(cell(row, col.date));
    if (!date) { skipped++; continue; }
    const desc = cell(row, col.desc).trim();
    const account = col.account >= 0 ? cell(row, col.account).trim() || 'account' : 'account';

    let amount;
    if (col.debit >= 0 || col.credit >= 0) {
      const debit = col.debit >= 0 ? Math.abs(num(cell(row, col.debit))) : 0;
      const credit = col.credit >= 0 ? Math.abs(num(cell(row, col.credit))) : 0;
      amount = credit > 0 ? credit : -debit; // + = money in, - = money out
    } else {
      amount = num(cell(row, col.amount)); // negative = outflow
    }
    if (amount === 0) { skipped++; continue; }

    const balance = col.balance >= 0 ? num(cell(row, col.balance)) : null;
    const pending = col.status >= 0 && /pending/i.test(cell(row, col.status)) ? 1 : 0;
    const category = categorize(desc, amount > 0);
    const id = createHash('sha1')
      .update([account, date, desc, amount, balance].join('|'))
      .digest('hex')
      .slice(0, 16);

    records.push({ id, account, date, desc, amount, category, balance, pending });
  }

  const detected = {
    date: rawHeader[col.date],
    description: rawHeader[col.desc],
    amount: col.debit >= 0 || col.credit >= 0
      ? [col.debit >= 0 ? rawHeader[col.debit] : null, col.credit >= 0 ? rawHeader[col.credit] : null]
          .filter(Boolean).join(' / ')
      : rawHeader[col.amount],
    balance: col.balance >= 0 ? rawHeader[col.balance] : null,
    account: col.account >= 0 ? rawHeader[col.account] : null,
  };
  return { detected, records, skipped };
}

// Parse an OFX/QFX statement (Quicken/Money export) into records. OFX is a
// structured financial format: each <STMTTRN> carries a signed amount, a posted
// date, a description, and a bank-assigned unique id (FITID) — a better dedup key
// than the CSV hash. Balance is per-statement (LEDGERBAL), not per-row.
function ofxToRecords(text) {
  const field = (block, name) => {
    const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  };
  const account = field(text, 'ACCTID') || 'account';
  const ledgerBal = (text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]*)/i) || [])[1];
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  if (!blocks.length) return { error: 'No transactions (<STMTTRN>) found in the OFX/QFX file.' };

  const records = [];
  let skipped = 0, maxDate = null, newestIdx = -1;
  for (const b of blocks) {
    const dt = field(b, 'DTPOSTED'); // e.g. 20260702120000.000[0:GMT]
    const date = /^\d{8}/.test(dt) ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : null;
    const amount = num(field(b, 'TRNAMT')); // already signed: + in / - out
    if (!date || amount === 0) { skipped++; continue; }
    const desc = (field(b, 'MEMO') || field(b, 'NAME')).trim();
    const fitid = field(b, 'FITID');
    const id = fitid
      ? createHash('sha1').update(`ofx|${account}|${fitid}`).digest('hex').slice(0, 16)
      : createHash('sha1').update([account, date, desc, amount].join('|')).digest('hex').slice(0, 16);
    const category = categorize(desc, amount > 0);
    records.push({ id, account, date, desc, amount, category, balance: null, pending: 0 });
    if (!maxDate || date > maxDate) { maxDate = date; newestIdx = records.length - 1; }
  }
  // No per-row running balance in OFX; attach the statement ledger balance to the
  // newest transaction so the Balance KPI reflects the account after import.
  if (newestIdx >= 0 && ledgerBal) records[newestIdx].balance = num(ledgerBal);

  const detected = {
    date: 'DTPOSTED', description: 'MEMO / NAME', amount: 'TRNAMT (signed)',
    balance: ledgerBal ? 'LEDGERBAL' : null,
    account: field(text, 'ACCTID') ? 'ACCTID' : null,
  };
  return { detected, records, skipped };
}

// Dispatch an uploaded import file to the right parser by sniffing its bytes
// (filename is only a hint), then optionally flip signs for credit-card statements.
// Returns { error } or { format, detected, records, skipped, suggestFlip, flip }.
function analyzeImport(buf, nameHint = '', { flip = false } = {}) {
  if (!Buffer.isBuffer(buf) || !buf.length) return { error: 'Empty file.' };
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;                        // "PK"  → xlsx (zip)
  const isOle = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11;     // OLE  → legacy .xls
  const ext = (nameHint.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();

  let base, isOfxCard = false;
  if (isZip || isOle || ext === 'xls' || ext === 'xlsx') {
    let rows;
    try {
      const wb = XLSX.read(buf, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false, defval: '' });
    } catch (e) {
      return { error: 'Could not read the spreadsheet: ' + e.message };
    }
    const out = rowsToRecords(rows);
    if (out.error) return out;
    base = { format: 'Excel', ...out };
  } else {
    const text = buf.toString('utf8');
    if (/^\s*OFXHEADER|<OFX>/i.test(text)) {
      isOfxCard = /<CREDITCARDMSGSRSV1|<CCACCTFROM/i.test(text); // OFX marks credit-card accounts
      const out = ofxToRecords(text);
      if (out.error) return out;
      base = { format: 'OFX/QFX', ...out };
    } else {
      const out = rowsToRecords(parseCSV(text));
      if (out.error) return out;
      base = { format: 'CSV', ...out };
    }
  }

  // Credit-card statements invert the bank sign convention (purchases look like money
  // in). Suggest a flip when the file smells like a card: an OFX credit-card account, or
  // several inflows that landed in spending categories (the tell-tale of mis-signed
  // purchases). Computed on the natural parse; the user confirms via the preview.
  const spendingInflow = base.records.filter(
    (r) => r.amount > 0 && !['Income', 'Transfer', 'Savings/Investing'].includes(r.category)
  ).length;
  const suggestFlip = isOfxCard || (spendingInflow >= 3 && spendingInflow > base.records.length * 0.4);

  if (flip) {
    for (const rec of base.records) {
      rec.amount = -rec.amount;
      rec.balance = null; // a card balance is debt owed — keep it out of the asset KPI
      rec.category = categorize(rec.desc, rec.amount > 0);
      // A credit card has no income: an inflow (after flip) that reads as income or a
      // debt-payment is really a payment/credit TO the card → Transfer (excluded from
      // totals), robust across issuers ("PAYMENT THANK YOU", bare "PAYMENT", "Funds
      // Transfer", etc.). A refund keeps its merchant category so it still reduces spend.
      if (rec.amount > 0 && (rec.category === 'Income' || rec.category === 'Debt Payments')) {
        rec.category = 'Transfer';
      }
      // Namespace the id so a flipped import can't collide with the same file imported
      // un-flipped — deterministic (idempotent), consistent across CSV/Excel/OFX.
      rec.id = createHash('sha1').update(`flip|${rec.id}`).digest('hex').slice(0, 16);
    }
  }

  return { ...base, suggestFlip, flip };
}

// Preview an import: report the detected columns, a sample of parsed rows, and
// how many are new vs. already-imported — WITHOUT saving. Lets the user confirm
// the CSV parsed correctly (right dates/amounts/signs) before committing.
app.post('/api/import_preview', express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
  try {
    const a = analyzeImport(req.body, req.query.name || '', { flip: req.query.flip === '1' });
    if (a.error) return res.status(400).json({ error: a.error });

    const existing = new Set(stmt.allTxnIds.all().map((r) => r.transaction_id));
    const seen = new Set();
    let newCount = 0, duplicateCount = 0;
    for (const rec of a.records) {
      if (existing.has(rec.id) || seen.has(rec.id)) duplicateCount++;
      else { newCount++; seen.add(rec.id); }
    }
    const samples = a.records.slice(0, 8).map((r) => ({
      date: r.date, desc: r.desc, amount: r.amount, category: r.category,
    }));
    res.json({ ok: true, format: a.format, detected: a.detected, samples, newCount, duplicateCount, skipped: a.skipped, suggestFlip: a.suggestFlip, flip: a.flip });
  } catch (err) {
    console.error('Preview error:', err);
    res.status(400).json({ error: 'Could not read the file: ' + err.message });
  }
});

app.post('/api/import', express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
  try {
    const a = analyzeImport(req.body, req.query.name || '', { flip: req.query.flip === '1' });
    if (a.error) return res.status(400).json({ error: a.error });

    const latestByAccount = {};
    // Ids already in the DB → tells new rows from re-imported duplicates.
    const existing = new Set(stmt.allTxnIds.all().map((r) => r.transaction_id));
    const addedIds = new Set();
    let added = 0, duplicates = 0, maxDate = null;

    inTransaction(() => {
      for (const rec of a.records) {
        stmt.upsertTxn.run(rec.id, rec.account, rec.date, rec.desc, rec.amount, rec.category, rec.balance, rec.pending);
        if (existing.has(rec.id)) duplicates++;
        else { added++; existing.add(rec.id); addedIds.add(rec.id); }
        if (!maxDate || rec.date > maxDate) maxDate = rec.date;

        if (rec.balance != null) {
          const prev = latestByAccount[rec.account];
          if (!prev || rec.date >= prev.date) latestByAccount[rec.account] = { date: rec.date, balance: rec.balance };
        }
      }
      for (const [account, info] of Object.entries(latestByAccount)) {
        stmt.upsertAccount.run(account, info.balance, info.date);
      }
      applyLearnedRules(); // auto-apply your remembered merchant categories to new rows
    });

    // Uncategorized = newly-added rows whose effective category is still
    // Miscellaneous (after learned merchant rules ran) — the nudge to fix.
    let uncategorized = 0;
    if (addedIds.size) {
      for (const t of stmt.allTxns.all()) {
        if (addedIds.has(t.transaction_id) && !t.user_category && t.category === 'Miscellaneous') uncategorized++;
      }
    }

    res.json({
      ok: true,
      imported: added + duplicates, added, duplicates, uncategorized, skipped: a.skipped,
      latestMonth: maxDate ? maxDate.slice(0, 7) : null,
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(400).json({ error: 'Could not read the file: ' + err.message });
  }
});

app.get('/api/status', (req, res) => {
  const c = stmt.counts.get();
  res.json({ hasData: (c.n || 0) > 0, count: c.n || 0, earliest: c.earliest, latest: c.latest });
});

// Apply every learned merchant rule to transactions that have no manual category yet.
function applyLearnedRules() {
  for (const { pattern, category } of stmt.listLearned.all()) {
    stmt.fillUserCatByPattern.run(category, pattern);
  }
}

// The year currently being worked on (the one top-level year tab). Defaults to the
// latest year with data, else the current calendar year; persisted once resolved.
function getActiveYear() {
  const s = stmt.getSetting.get('active_year');
  if (s && s.value) return s.value;
  const c = stmt.counts.get();
  const y = c.latest ? c.latest.slice(0, 4) : String(new Date().getFullYear());
  stmt.setSetting.run('active_year', y);
  return y;
}

// Transactions for a period: 'all', a year 'YYYY', or a month 'YYYY-MM'.
function txnsForPeriod(period) {
  if (period === 'all') return stmt.allTxns.all();
  if (/^\d{4}(-\d{2})?$/.test(period)) return stmt.txnsForMonth.all(`${period}%`);
  return stmt.txnsForMonth.all(`${currentMonth()}%`);
}

// Per-month spending / savings / leftover across all data (oldest first) — the
// trend bar chart shown on the Overview and on every month tab.
function monthlySeries() {
  const byMonth = {};
  for (const x of stmt.allTxns.all()) (byMonth[x.date.slice(0, 7)] ||= []).push(x);
  return Object.keys(byMonth)
    .sort()
    .map((month) => {
      const m = computeTotals(byMonth[month]);
      return {
        month,
        income: round2(m.income),
        spending: round2(m.spending),
        savings: round2(m.savings),
        leftover: round2(m.leftover),
      };
    });
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

  // For a month view, also compute the same month one year earlier so the chart
  // can show this-year vs last-year side by side. Null if there's no prior data.
  let prior = null;
  const mMatch = period.match(/^(\d{4})-(\d{2})$/);
  if (mMatch) {
    const pyPeriod = `${Number(mMatch[1]) - 1}-${mMatch[2]}`;
    const pyTxns = txnsForPeriod(pyPeriod);
    if (pyTxns.length) {
      const pt = computeTotals(pyTxns);
      prior = {
        period: pyPeriod,
        spending: round2(pt.spending),
        savings: round2(pt.savings),
        leftover: round2(pt.leftover),
      };
    }
  }

  res.json({
    period,
    monthCount,
    income: round2(t.income),
    spending: round2(t.spending),
    savings: round2(t.savings),
    leftover: round2(t.leftover),
    prior,
    monthly: monthlySeries(),
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
  const allTxns = stmt.allTxns.all();
  const t = computeTotals(allTxns);
  const accounts = stmt.listAccounts.all();
  const balance = accounts.reduce((s, a) => s + (a.current_balance || 0), 0);
  const budgets = Object.fromEntries(stmt.listBudgets.all().map((b) => [b.category, b.monthly_limit]));
  const c = stmt.counts.get();

  // Active-year slice — drives the budget-progress rows (spent vs a fairly-scaled
  // budget) and the recent-activity peek on the redesigned Overview.
  const activeYear = getActiveYear();
  const yearTxns = allTxns.filter((x) => x.date.startsWith(activeYear));
  const yt = computeTotals(yearTxns);
  const yMonthCount = new Set(yearTxns.map((x) => x.date.slice(0, 7))).size || 1;
  const recent = allTxns.slice(0, 6).map((x) => ({
    date: x.date,
    name: x.name,
    amount: round2(x.amount),
    category: displayCategory(x),
  }));

  res.json({
    income: round2(t.income),
    spending: round2(t.spending),
    savings: round2(t.savings),
    leftover: round2(t.leftover),
    balance: round2(balance),
    accountCount: accounts.length,
    latest: c.latest,
    months: stmt.distinctMonths.all().map((r) => r.month),
    monthly: monthlySeries(),
    activeYear,
    archivedYears: stmt.listArchivedYears.all().map((r) => r.year),
    recent,
    categories: expenseBuckets().map((b) => ({
      category: b,
      limit: budgets[b] ?? null,                                   // monthly limit (editable)
      spent: round2(yt.spentByBucket[b] || 0),                     // active-year spend
      yearLimit: budgets[b] != null ? round2(budgets[b] * yMonthCount) : null, // scaled for the year
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
    stmt.deleteLearnedByCategory.run(name); // forget any learned rules pointing to it
  });
  res.json({ ok: true });
});

// Manually add a single transaction (for testing / filling in data the CSV missed).
// amount sign follows the app convention: + = money in, - = money out.
app.post('/api/transaction', (req, res) => {
  const { date, name, amount, category } = req.body;
  if (!parseDate(date)) return res.status(400).json({ error: 'A valid date is required.' });
  const desc = String(name || '').trim();
  if (!desc) return res.status(400).json({ error: 'A description is required.' });
  const amt = Number(amount);
  if (!isFinite(amt) || amt === 0) return res.status(400).json({ error: 'Amount must be a non-zero number.' });
  const cat = String(category || '').trim() || (amt > 0 ? 'Income' : 'Miscellaneous');
  // Random id so identical manual rows don't collide (unlike the import dedup hash).
  stmt.upsertTxn.run(randomUUID().slice(0, 16), 'manual', parseDate(date), desc, round2(amt), cat, null, 0);
  res.json({ ok: true });
});

// Wipe every transaction in a month (e.g. to redo data you entered wrong).
app.post('/api/clear_month', (req, res) => {
  const month = String(req.body.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'A month (YYYY-MM) is required.' });
  let deleted = 0;
  inTransaction(() => {
    deleted = Number(stmt.deleteTxnsForMonth.run(`${month}%`).changes) || 0;
    stmt.deleteOrphanAccounts.run(); // clear the balance for any account left with no transactions
    stmt.recomputeAccountBalances.run(); // refresh survivors so balance can't reflect the cleared month
  });
  res.json({ ok: true, deleted });
});

// Recategorize a transaction. Beyond fixing this row, we "learn the merchant":
// remember UPPER(description) -> category and apply it to every matching row now
// and on future imports, so a fix sticks for that merchant going forward.
app.post('/api/transaction_category', (req, res) => {
  const { transaction_id, user_category } = req.body;
  if (!transaction_id) return res.status(400).json({ error: 'transaction_id required' });
  const row = stmt.getTxnName.get(transaction_id);
  const pattern = row ? String(row.name || '').toUpperCase() : null;
  inTransaction(() => {
    if (user_category && pattern) {
      stmt.upsertLearned.run(pattern, user_category); // remember the merchant
      stmt.setUserCatByPattern.run(user_category, pattern); // fix every matching row now
    } else {
      stmt.setUserCategory.run(user_category || null, transaction_id);
    }
  });
  res.json({ ok: true });
});

// Close out the active year: archive it (data kept, viewable read-only) and open
// the next year fresh. The user's explicit "Start new year" action.
app.post('/api/new_year', (req, res) => {
  const active = getActiveYear();
  const next = String(Number(active) + 1);
  inTransaction(() => {
    stmt.addArchivedYear.run(active);
    stmt.setSetting.run('active_year', next);
  });
  res.json({ ok: true, activeYear: next, archived: active });
});

// Archive an arbitrary past year without moving the active-year pointer. This covers
// years that aren't the active one — e.g. a year you just restored, or an older year
// that was imported directly and never closed out via "Start new year".
app.post('/api/archive_year', (req, res) => {
  const year = String(req.body.year || '').trim();
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'A year (YYYY) is required.' });
  if (year === String(getActiveYear()))
    return res.status(400).json({ error: 'Use "Start new year" to close out the active year.' });
  if (!stmt.countForYear.get(`${year}%`).n)
    return res.status(400).json({ error: 'That year has no data to archive.' });
  stmt.addArchivedYear.run(year);
  res.json({ ok: true, archived: year });
});

// Restore an archived year (undo an accidental archive). If the active year is the
// empty year immediately after it (the classic "I clicked Start new year by mistake"),
// roll the active pointer back so we don't leave an empty year stranded.
app.post('/api/unarchive_year', (req, res) => {
  const year = String(req.body.year || '').trim();
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'A year (YYYY) is required.' });
  inTransaction(() => {
    stmt.removeArchivedYear.run(year);
    const active = getActiveYear();
    if (Number(active) === Number(year) + 1 && !stmt.countForYear.get(`${active}%`).n) {
      stmt.setSetting.run('active_year', year);
    }
  });
  res.json({ ok: true, activeYear: getActiveYear() });
});

// Exported so the Electron wrapper (electron/main.mjs) can host the API in-process.
export { app };

const port = process.env.PORT || 4000;
// Only start the server when run directly (so the categorizer can be imported for tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, () => {
    console.log(`\n  Personal Budget running:  http://localhost:${port}`);
    console.log(`  Data source:              CSV import (local only)\n`);
  });
}
