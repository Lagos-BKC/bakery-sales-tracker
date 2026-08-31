-- Bakery Sales Tracking & AR System schema

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','staff')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_code TEXT UNIQUE,
  business_name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  payment_terms TEXT NOT NULL DEFAULT 'COD' CHECK(payment_terms IN ('COD','Net 7','Net 15','Net 30','Net 60')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_code TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  default_price REAL NOT NULL CHECK(default_price >= 0),
  unit_of_measure TEXT NOT NULL DEFAULT 'Unit',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_code TEXT UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  transaction_date TEXT NOT NULL,
  transaction_total REAL NOT NULL DEFAULT 0 CHECK(transaction_total >= 0),
  amount_paid REAL NOT NULL DEFAULT 0 CHECK(amount_paid >= 0),
  outstanding_amount REAL NOT NULL DEFAULT 0 CHECK(outstanding_amount >= 0),
  payment_status TEXT NOT NULL DEFAULT 'Outstanding' CHECK(payment_status IN ('Paid','Partially Paid','Outstanding')),
  due_date TEXT,
  payment_date TEXT,
  payment_method TEXT CHECK(payment_method IN ('Cash','E-transfer','Cheque','Credit/Debit','Bank Transfer','Other') OR payment_method IS NULL),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  line_total REAL NOT NULL CHECK(line_total >= 0)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  payment_method TEXT CHECK(payment_method IN ('Cash','E-transfer','Cheque','Credit/Debit','Bank Transfer','Other')),
  reference_number TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id),
  changed_by_name TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales_transactions(payment_status);
CREATE INDEX IF NOT EXISTS idx_line_items_txn ON sales_line_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_line_items_product ON sales_line_items(product_id);
CREATE INDEX IF NOT EXISTS idx_payments_txn ON payments(transaction_id);
