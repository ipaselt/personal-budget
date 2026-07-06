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

  -- Learned merchant rules: UPPER(description) -> category. Applied on import and
  -- when you recategorize, so fixing a merchant once sticks for every future match.
  CREATE TABLE IF NOT EXISTS learned_categories (
    pattern  TEXT PRIMARY KEY,   -- UPPER(transactions.name)
    category TEXT NOT NULL
  );

  -- Years the user has "closed out". Data stays; these are viewed read-only via Archive.
  CREATE TABLE IF NOT EXISTS archived_years (
    year TEXT PRIMARY KEY
  );

  -- Small key/value store (e.g. active_year).
  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
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
  allTxnIds: db.prepare(`SELECT transaction_id FROM transactions`),
  distinctMonths: db.prepare(
    `SELECT DISTINCT substr(date, 1, 7) AS month FROM transactions ORDER BY month DESC`
  ),
  counts: db.prepare(
    `SELECT COUNT(*) AS n, MIN(date) AS earliest, MAX(date) AS latest FROM transactions`
  ),
  setUserCategory: db.prepare(
    `UPDATE transactions SET user_category = ? WHERE transaction_id = ?`
  ),
  deleteTxnsForMonth: db.prepare(`DELETE FROM transactions WHERE date LIKE ?`),
  // Drop account rows (and their stale balance) once no transactions reference them.
  deleteOrphanAccounts: db.prepare(
    `DELETE FROM accounts WHERE account_id NOT IN (SELECT DISTINCT account_id FROM transactions)`
  ),
  // Refresh each surviving account's balance from its latest-dated balance-carrying
  // transaction (rowid breaks same-date ties by insertion order, matching import).
  // Used after clear_month so the balance never reflects a deleted month.
  recomputeAccountBalances: db.prepare(
    `UPDATE accounts SET
       current_balance = (SELECT t.balance FROM transactions t
         WHERE t.account_id = accounts.account_id AND t.balance IS NOT NULL
         ORDER BY t.date DESC, t.rowid DESC LIMIT 1),
       as_of = (SELECT t.date FROM transactions t
         WHERE t.account_id = accounts.account_id AND t.balance IS NOT NULL
         ORDER BY t.date DESC, t.rowid DESC LIMIT 1)
     WHERE EXISTS (SELECT 1 FROM transactions t
       WHERE t.account_id = accounts.account_id AND t.balance IS NOT NULL)`
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

  // --- Learned merchant rules ---
  getTxnName: db.prepare(`SELECT name FROM transactions WHERE transaction_id = ?`),
  upsertLearned: db.prepare(
    `INSERT INTO learned_categories (pattern, category) VALUES (?, ?)
     ON CONFLICT(pattern) DO UPDATE SET category = excluded.category`
  ),
  listLearned: db.prepare(`SELECT pattern, category FROM learned_categories`),
  deleteLearnedByCategory: db.prepare(`DELETE FROM learned_categories WHERE category = ?`),
  // Force every row of a merchant to a category (used when you recategorize).
  setUserCatByPattern: db.prepare(
    `UPDATE transactions SET user_category = ? WHERE UPPER(name) = ?`
  ),
  // Fill only rows with no manual choice yet (used after import to apply learned rules).
  fillUserCatByPattern: db.prepare(
    `UPDATE transactions SET user_category = ? WHERE UPPER(name) = ? AND user_category IS NULL`
  ),

  // --- Year archive + settings ---
  addArchivedYear: db.prepare(`INSERT OR IGNORE INTO archived_years (year) VALUES (?)`),
  removeArchivedYear: db.prepare(`DELETE FROM archived_years WHERE year = ?`),
  listArchivedYears: db.prepare(`SELECT year FROM archived_years ORDER BY year DESC`),
  countForYear: db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE date LIKE ?`),
  getSetting: db.prepare(`SELECT value FROM app_settings WHERE key = ?`),
  setSetting: db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ),
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
