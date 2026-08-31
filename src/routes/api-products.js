const express = require('express');
const db = require('../db');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.get('/', (req, res) => {
  const { search = '', status = '', category = '' } = req.query;
  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (search) {
    sql += ' AND (product_name LIKE ? OR sku_code LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s);
  }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY product_name ASC';
  const products = db.prepare(sql).all(...params);

  const statStmt = db.prepare(`
    SELECT COALESCE(SUM(li.quantity),0) units_sold, COALESCE(SUM(li.line_total),0) revenue, COUNT(DISTINCT li.transaction_id) txn_count
    FROM sales_line_items li WHERE li.product_id = ?
  `);
  const enriched = products.map(p => ({ ...p, ...statStmt.get(p.id) }));
  res.json(enriched);
});

router.get('/categories', (req, res) => {
  const rows = db.prepare("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != '' ORDER BY category").all();
  res.json(rows.map(r => r.category));
});

router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const stats = db.prepare(`
    SELECT COALESCE(SUM(li.quantity),0) total_units, COALESCE(SUM(li.line_total),0) total_revenue,
           COUNT(DISTINCT li.transaction_id) num_transactions,
           CASE WHEN SUM(li.quantity) > 0 THEN ROUND(SUM(li.line_total) / SUM(li.quantity), 2) ELSE 0 END avg_price
    FROM sales_line_items li WHERE li.product_id = ?
  `).get(req.params.id);

  const topCustomers = db.prepare(`
    SELECT c.business_name, SUM(li.line_total) revenue, SUM(li.quantity) units
    FROM sales_line_items li
    JOIN sales_transactions t ON t.id = li.transaction_id
    JOIN customers c ON c.id = t.customer_id
    WHERE li.product_id = ?
    GROUP BY c.id ORDER BY revenue DESC LIMIT 5
  `).all(req.params.id);

  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', t.transaction_date) month, SUM(li.quantity) units, SUM(li.line_total) revenue
    FROM sales_line_items li JOIN sales_transactions t ON t.id = li.transaction_id
    WHERE li.product_id = ? GROUP BY month ORDER BY month ASC
  `).all(req.params.id);

  res.json({ product, stats, topCustomers, monthly });
});

router.post('/', (req, res) => {
  const { sku_code, product_name, category, description, default_price, unit_of_measure, status } = req.body;
  if (!product_name || !product_name.trim()) return res.status(400).json({ error: 'Product name is required.' });
  if (!sku_code || !sku_code.trim()) return res.status(400).json({ error: 'SKU code is required.' });
  if (default_price == null || Number(default_price) < 0) return res.status(400).json({ error: 'Default price must be zero or positive.' });

  const dup = db.prepare('SELECT id FROM products WHERE sku_code = ?').get(sku_code.trim());
  if (dup) return res.status(400).json({ error: 'A product with this SKU code already exists.' });

  const info = db.prepare(`
    INSERT INTO products (sku_code, product_name, category, description, default_price, unit_of_measure, status)
    VALUES (?,?,?,?,?,?,?)
  `).run(sku_code.trim(), product_name.trim(), category || null, description || null,
    Number(default_price), unit_of_measure || 'Unit', status || 'active');
  logAudit(req, 'product', info.lastInsertRowid, 'create', `Created product ${product_name} (${sku_code})`);
  res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const { product_name, category, description, default_price, unit_of_measure, status } = req.body;
  if (!product_name || !product_name.trim()) return res.status(400).json({ error: 'Product name is required.' });
  if (default_price == null || Number(default_price) < 0) return res.status(400).json({ error: 'Default price must be zero or positive.' });

  db.prepare(`
    UPDATE products SET product_name=?, category=?, description=?, default_price=?, unit_of_measure=?, status=?, updated_at=datetime('now')
    WHERE id=?
  `).run(product_name.trim(), category || null, description || null, Number(default_price),
    unit_of_measure || 'Unit', status || 'active', req.params.id);
  logAudit(req, 'product', req.params.id, 'update',
    `Updated product ${product_name}. Note: historical sales retain price at time of sale.`);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

module.exports = router;
