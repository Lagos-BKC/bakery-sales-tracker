const express = require('express');
const db = require('../db');
const { effectiveStatus } = require('../utils/calc');

const router = express.Router();

function buildFilterClause(q) {
  const { date_from, date_to, customer_id, product_id, category, payment_status } = q;
  let sql = ' WHERE 1=1 ';
  const params = [];
  if (date_from) { sql += ' AND t.transaction_date >= ?'; params.push(date_from); }
  if (date_to) { sql += ' AND t.transaction_date <= ?'; params.push(date_to); }
  if (customer_id) { sql += ' AND t.customer_id = ?'; params.push(customer_id); }
  if (payment_status) { sql += ' AND t.payment_status = ?'; params.push(payment_status); }
  if (product_id) { sql += ' AND t.id IN (SELECT transaction_id FROM sales_line_items WHERE product_id = ?)'; params.push(product_id); }
  if (category) { sql += ' AND t.id IN (SELECT li.transaction_id FROM sales_line_items li JOIN products p ON p.id=li.product_id WHERE p.category = ?)'; params.push(category); }
  return { sql, params };
}

const UNITS_SUBQ = `(SELECT COALESCE(SUM(li.quantity),0) FROM sales_line_items li WHERE li.transaction_id = t.id)`;

router.get('/sales-by-day', (req, res) => {
  const { sql, params } = buildFilterClause(req.query);
  const rows = db.prepare(`
    SELECT t.transaction_date period, SUM(t.transaction_total) revenue, COUNT(*) transactions, SUM(${UNITS_SUBQ}) units
    FROM sales_transactions t ${sql} GROUP BY period ORDER BY period ASC
  `).all(...params);
  res.json(rows);
});

router.get('/sales-by-week', (req, res) => {
  const { sql, params } = buildFilterClause(req.query);
  const rows = db.prepare(`
    SELECT strftime('%Y-W%W', t.transaction_date) period, MIN(t.transaction_date) period_start,
           SUM(t.transaction_total) revenue, COUNT(*) transactions, SUM(${UNITS_SUBQ}) units
    FROM sales_transactions t ${sql} GROUP BY period ORDER BY period_start ASC
  `).all(...params);
  res.json(rows);
});

router.get('/sales-by-month', (req, res) => {
  const { sql, params } = buildFilterClause(req.query);
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', t.transaction_date) period, SUM(t.transaction_total) revenue, COUNT(*) transactions, SUM(${UNITS_SUBQ}) units
    FROM sales_transactions t ${sql} GROUP BY period ORDER BY period ASC
  `).all(...params);
  res.json(rows);
});

router.get('/sales-by-customer', (req, res) => {
  const { sql, params } = buildFilterClause(req.query);
  const rows = db.prepare(`
    SELECT c.id customer_id, c.business_name, SUM(t.transaction_total) revenue, SUM(t.amount_paid) paid,
           SUM(t.outstanding_amount) outstanding, COUNT(*) orders,
           ROUND(SUM(t.transaction_total) * 1.0 / COUNT(*), 2) avg_order_value,
           MAX(t.transaction_date) last_purchase
    FROM sales_transactions t JOIN customers c ON c.id = t.customer_id
    ${sql} GROUP BY c.id ORDER BY revenue DESC
  `).all(...params);
  res.json(rows);
});

router.get('/sales-by-sku', (req, res) => {
  const { sql, params } = buildFilterClause(req.query);
  const rows = db.prepare(`
    SELECT p.id product_id, p.sku_code, p.product_name, p.category, SUM(li.quantity) units,
           SUM(li.line_total) revenue, COUNT(DISTINCT li.transaction_id) transactions,
           ROUND(SUM(li.line_total) * 1.0 / SUM(li.quantity), 2) avg_price
    FROM sales_line_items li
    JOIN sales_transactions t ON t.id = li.transaction_id
    JOIN products p ON p.id = li.product_id
    ${sql} GROUP BY p.id ORDER BY revenue DESC
  `).all(...params);
  res.json(rows);
});

router.get('/sales-by-category', (req, res) => {
  const { sql, params } = buildFilterClause(req.query);
  const rows = db.prepare(`
    SELECT COALESCE(p.category, 'Uncategorized') category, SUM(li.quantity) units, SUM(li.line_total) revenue,
           COUNT(DISTINCT li.transaction_id) transactions
    FROM sales_line_items li
    JOIN sales_transactions t ON t.id = li.transaction_id
    JOIN products p ON p.id = li.product_id
    ${sql} GROUP BY category ORDER BY revenue DESC
  `).all(...params);
  res.json(rows);
});

router.get('/paid-vs-unpaid', (req, res) => {
  const { sql, params } = buildFilterClause(req.query);
  const rows = db.prepare(`
    SELECT t.payment_status, SUM(t.transaction_total) revenue, SUM(t.amount_paid) paid,
           SUM(t.outstanding_amount) outstanding, COUNT(*) transactions
    FROM sales_transactions t ${sql} GROUP BY t.payment_status
  `).all(...params);
  res.json(rows);
});

module.exports = router;
