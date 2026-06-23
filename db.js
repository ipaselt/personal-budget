// SQLite storage using Node's built-in driver (no native build needed).
// The database file lives in ./data and is gitignored — it holds your
// financial data and Plaid access tokens, which never leave this machine.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'budget.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    item_id          TEXT PRIMARY KEY,
    access_token     TEXT NOT NULL,
    institution_name TEXT,
    cursor           TEXT,
    created_at       TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS accounts (
    account_id        TEXT PRIMARY KEY,
    item_id           TEXT,
    name              TEXT,
    official_name     TEXT,
    type              TEXT,
    subtype           TEXT,
    mask              TEXT,
    current_balance   REAL,
    available_balance REAL,
    currency          TEXT
  );

  CREATE TABLE IF NOT EXISTS transactions (
    transaction_id TEXT PRIMARY KEY,
    account_id     TEXT,
    date           TEXT,
    name           TEXT,
    merchant_name  TEXT,
    amount         REAL,           -- Plaid sign: >0 = money out (spend), <0 = money in (income)
    category       TEXT,           -- Plaid personal_finance_category.primary
    detailed       TEXT,           -- Plaid personal_finance_category.detailed (used to map to budget buckets)
    user_category  TEXT,           -- optional manual override (preserved across syncs)
    pending        INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS budgets (
    category      TEXT PRIMARY KEY,
    monthly_limit REAL NOT NULL
  );
`);

// --- Prepared statements ---------------------------------------------------
export const stmt = {
  insertItem: db.prepare(
    `INSERT INTO items (item_id, access_token, institution_name) VALUES (?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET access_token = excluded.access_token`
  ),
  getItem: db.prepare(`SELECT * FROM items WHERE item_id = ?`),
  listItems: db.prepare(`SELECT * FROM items ORDER BY created_at`),
  setCursor: db.prepare(`UPDATE items SET cursor = ? WHERE item_id = ?`),

  upsertAccount: db.prepare(
    `INSERT INTO accounts
       (account_id, item_id, name, official_name, type, subtype, mask,
        current_balance, available_balance, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       name=excluded.name, official_name=excluded.official_name,
       type=excluded.type, subtype=excluded.subtype, mask=excluded.mask,
       current_balance=excluded.current_balance,
       available_balance=excluded.available_balance, currency=excluded.currency`
  ),
  listAccounts: db.prepare(`SELECT * FROM accounts ORDER BY name`),

  // Preserve user_category on update by leaving it out of the SET list.
  upsertTxn: db.prepare(
    `INSERT INTO transactions
       (transaction_id, account_id, date, name, merchant_name, amount, category, detailed, pending)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(transaction_id) DO UPDATE SET
       account_id=excluded.account_id, date=excluded.date, name=excluded.name,
       merchant_name=excluded.merchant_name, amount=excluded.amount,
       category=excluded.category, detailed=excluded.detailed, pending=excluded.pending`
  ),
  deleteTxn: db.prepare(`DELETE FROM transactions WHERE transaction_id = ?`),
  txnsForMonth: db.prepare(
    `SELECT * FROM transactions WHERE date LIKE ? ORDER BY date DESC, transaction_id`
  ),
  allTxns: db.prepare(`SELECT * FROM transactions ORDER BY date DESC, transaction_id`),
  distinctMonths: db.prepare(
    `SELECT DISTINCT substr(date, 1, 7) AS month FROM transactions ORDER BY month DESC`
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
