const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'bakery.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// --- Migrations -------------------------------------------------------
// schema.sql only ever CREATEs tables/indexes IF NOT EXISTS, so a database
// that already existed before a column was added needs that column bolted
// on separately. These are additive and safe to run on every boot.
function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

if (!columnExists('sales_transactions', 'source')) {
  db.exec("ALTER TABLE sales_transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
}
if (!columnExists('sales_transactions', 'import_dedupe_key')) {
  db.exec('ALTER TABLE sales_transactions ADD COLUMN import_dedupe_key TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_sales_source ON sales_transactions(source)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_import_dedupe ON sales_transactions(import_dedupe_key) WHERE import_dedupe_key IS NOT NULL');

// One-time backfill for the two bulk-import batches that were run before
// the `source` column existed, so they're recognized as imports too. Scoped
// two ways at once so it can never mistakenly tag a hand-entered sale:
//   1. created_at falls in the same calendar day as a known import batch
//   2. the row has no individual 'create' audit entry - every manual or
//      scanned-and-saved sale logs one (see api-sales.js), but a bulk
//      import only ever logs one combined summary entry for the whole
//      batch, never a per-row entry.
// A row only gets re-tagged while it's still at the untouched 'manual'
// default, so this is a no-op once it has already run.
const LEGACY_IMPORT_BATCH_DAYS = ['2026-09-06'];
if (LEGACY_IMPORT_BATCH_DAYS.length) {
  const dayConditions = LEGACY_IMPORT_BATCH_DAYS.map(() => "date(created_at) = ?").join(' OR ');
  db.prepare(`
    UPDATE sales_transactions
    SET source = 'import'
    WHERE source = 'manual'
      AND (${dayConditions})
      AND id NOT IN (
        SELECT entity_id FROM audit_log WHERE entity_type = 'sales_transaction' AND action = 'create'
      )
  `).run(...LEGACY_IMPORT_BATCH_DAYS);
}

// node:sqlite's DatabaseSync has no built-in `.transaction()` helper like
// better-sqlite3 does. Add a small compatible shim so the rest of the app
// (which calls `db.transaction(fn)()`) doesn't need to change.
db.transaction = function (fn) {
  return function (...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
      throw err;
    }
  };
};

module.exports = db;
