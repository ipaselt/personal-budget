// SQLite storage using Node's built-in driver (no native build needed).
// The database file lives in ./data and is gitignored — your financial data
// never leaves this machine.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'budget.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    account_id      TEXT PRIMARY KEY,
    current_balance REAL,
    as_of           TEXT
  );

  CREATE TABLE IF NOT EXISTS transactions (
    transaction_id TEXT PRIMARY KEY,
    account_id     TEXT,
    date           TEXT,           -- YYYY-MM-DD
    name           TEXT,
    amount         REAL,           -- sign: + = money in (credit), - = money out (debit)
    category       TEXT,           -- budget bucket, or 'Income' / 'Transfer'
    user_category  TEXT,           -- manual override (preserved across re-imports)
    balance        REAL,           -- running balance reported on the row
    pending        INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS budgets (
    category      TEXT PRIMARY KEY,
    monthly_limit REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_categories (
    name TEXT PRIMARY KEY
  );
`);

export const stmt = {
  upsertAccount: db.prepare(
    `INSERT INTO accounts (account_id, current_balance, as_of) VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       current_balance = excluded.current_balance, as_of = excluded.as_of`
  ),
  listAccounts: db.prepare(`SELECT * FROM accounts ORDER BY account_id`),

  // user_category is intentionally left out of the UPDATE list so manual
  // overrides survive re-importing the same rows.
  upsertTxn: db.prepare(
    `INSERT INTO transactions
       (transaction_id, account_id, date, name, amount, category, balance, pending)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(transaction_id) DO UPDATE SET
       account_id=excluded.account_id, date=excluded.date, name=excluded.name,
       amount=excluded.amount, category=excluded.category, balance=excluded.balance,
       pending=excluded.pending`
  ),
  txnsForMonth: db.prepare(
    `SELECT * FROM transactions WHERE date LIKE ? ORDER BY date DESC, transaction_id`
  ),
  allTxns: db.prepare(`SELECT * FROM transactions ORDER BY date DESC, transaction_id`),
  distinctMonths: db.prepare(
    `SELECT DISTINCT substr(date, 1, 7) AS month FROM transactions ORDER BY month DESC`
  ),
  counts: db.prepare(
    `SELECT COUNT(*) AS n, MIN(date) AS earliest, MAX(date) AS latest FROM transactions`
  ),
  setUserCategory: db.prepare(
    `UPDATE transactions SET user_category = ? WHERE transaction_id = ?`
  ),

  setBudget: db.prepare(
    `INSERT INTO budgets (category, monthly_limit) VALUES (?, ?)
     ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit`
  ),
  deleteBudget: db.prepare(`DELETE FROM budgets WHERE category = ?`),
  listBudgets: db.prepare(`SELECT * FROM budgets`),

  insertCategory: db.prepare(`INSERT OR IGNORE INTO custom_categories (name) VALUES (?)`),
  listCategories: db.prepare(`SELECT name FROM custom_categories ORDER BY rowid`),
  deleteCategory: db.prepare(`DELETE FROM custom_categories WHERE name = ?`),
  // revert transactions that were manually put in a (now-deleted) category
  clearUserCategory: db.prepare(`UPDATE transactions SET user_category = NULL WHERE user_category = ?`),
};

// Run a function inside a transaction (node:sqlite has no .transaction()).
export function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
