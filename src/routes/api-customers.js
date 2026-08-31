const express = require('express');
const dayjs = require('dayjs');
const db = require('../db');
const { effectiveStatus } = require('../utils/calc');
const { logAudit } = require('../utils/audit');

const router = express.Router();

function nextCustomerCode() {
  const row = db.prepare("SELECT COUNT(*) c FROM customers").get();
  return 'CUST-' + String(row.c + 1).padStart(4, '0');
}

// GET /api/customers?search=&status=
router.get('/', (req, res) => {
  const { search = '', status = '' } = req.query;
  let sql = 'SELECT * FROM customers WHERE 1=1';
  const params = [];
  if (search) {
    sql += ' AND (business_name LIKE ? OR contact_name LIKE ? OR customer_code LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY business_name ASC';
  const customers = db.prepare(sql).all(...params);

  // attach quick balance info
  const balStmt = db.prepare(`
    SELECT COALESCE(SUM(transaction_total),0) total, COALESCE(SUM(amount_paid),0) paid,
           COALESCE(SUM(outstanding_amount),0) outstanding, COUNT(*) txn_count
    FROM sales_transactions WHERE customer_id = ?
  `);
  const enriched = customers.map(c => {
    const bal = balStmt.get(c.id);
    return { ...c, ...bal };
  });
  res.json(enriched);
});

router.get('/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const summary = db.prepare(`
    SELECT COALESCE(SUM(transaction_total),0) total_purchases,
           COALESCE(SUM(amount_paid),0) total_paid,
           COALESCE(SUM(outstanding_amount),0) total_outstanding,
           COUNT(*) num_transactions,
           MAX(transaction_date) last_purchase_date
    FROM sales_transactions WHERE customer_id = ?
  `).get(req.params.id);
  summary.avg_transaction_value = summary.num_transactions > 0
    ? Math.round((summary.total_purchases / summary.num_transactions) * 100) / 100
    : 0;

  const transactions = db.prepare(`
    SELECT t.*, (SELECT GROUP_CONCAT(p.product_name, ', ') FROM sales_line_items li
                 JOIN products p ON p.id = li.product_id WHERE li.transaction_id = t.id) as products_summary
    FROM sales_transactions t WHERE customer_id = ? ORDER BY transaction_date DESC, id DESC
  `).all(req.params.id).map(t => ({ ...t, display_status: effectiveStatus(t) }));

  // most frequently purchased products
  const topProducts = db.prepare(`
    SELECT p.product_name, SUM(li.quantity) units, SUM(li.line_total) revenue
    FROM sales_line_items li
    JOIN sales_transactions t ON t.id = li.transaction_id
    JOIN products p ON p.id = li.product_id
    WHERE t.customer_id = ?
    GROUP BY p.id ORDER BY units DESC LIMIT 5
  `).all(req.params.id);

  // monthly trend
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', transaction_date) month, SUM(transaction_total) total
    FROM sales_transactions WHERE customer_id = ?
    GROUP BY month ORDER BY month ASC
  `).all(req.params.id);

  res.json({ customer, summary, transactions, topProducts, monthly });
});

router.post('/', (req, res) => {
  const { business_name, contact_name, phone, email, address, payment_terms, notes, status } = req.body;
  if (!business_name || !business_name.trim()) return res.status(400).json({ error: 'Business name is required.' });
  const code = nextCustomerCode();
  const stmt = db.prepare(`
    INSERT INTO customers (customer_code, business_name, contact_name, phone, email, address, payment_terms, status, notes)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  const info = stmt.run(code, business_name.trim(), contact_name || null, phone || null, email || null,
    address || null, payment_terms || 'COD', status || 'active', notes || null);
  logAudit(req, 'customer', info.lastInsertRowid, 'create', `Created customer ${business_name}`);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(customer);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  const { business_name, contact_name, phone, email, address, payment_terms, notes, status } = req.body;
  if (!business_name || !business_name.trim()) return res.status(400).json({ error: 'Business name is required.' });
  db.prepare(`
    UPDATE customers SET business_name=?, contact_name=?, phone=?, email=?, address=?, payment_terms=?, notes=?, status=?, updated_at=datetime('now')
    WHERE id=?
  `).run(business_name.trim(), contact_name || null, phone || null, email || null, address || null,
    payment_terms || 'COD', notes || null, status || 'active', req.params.id);
  logAudit(req, 'customer', req.params.id, 'update', `Updated customer ${business_name}`);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  res.json(customer);
});

module.exports = router;
