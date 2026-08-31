const express = require('express');
const db = require('../db');
const { dayjs } = require('../utils/dateRanges');
const { effectiveStatus, agingBucket, round2 } = require('../utils/calc');

const router = express.Router();

// GET /api/receivables - AR table (all transactions, filterable by status)
router.get('/', (req, res) => {
  const { status = '', customer_id = '' } = req.query;
  let sql = `
    SELECT t.id, t.transaction_code, t.transaction_date, t.due_date, t.transaction_total, t.amount_paid,
           t.outstanding_amount, t.payment_status, c.id customer_id, c.business_name
    FROM sales_transactions t JOIN customers c ON c.id = t.customer_id
    WHERE 1=1
  `;
  const params = [];
  if (customer_id) { sql += ' AND c.id = ?'; params.push(customer_id); }
  sql += ' ORDER BY t.transaction_date DESC';
  let rows = db.prepare(sql).all(...params).map(t => ({ ...t, display_status: effectiveStatus(t) }));
  if (status) rows = rows.filter(r => r.display_status === status);
  res.json(rows);
});

// GET /api/receivables/aging
router.get('/aging', (req, res) => {
  const today = dayjs().format('YYYY-MM-DD');
  const txns = db.prepare(`
    SELECT t.id, t.due_date, t.outstanding_amount, c.id customer_id, c.business_name
    FROM sales_transactions t JOIN customers c ON c.id = t.customer_id
    WHERE t.outstanding_amount > 0
  `).all();

  const byCustomer = {};
  for (const t of txns) {
    if (!byCustomer[t.customer_id]) {
      byCustomer[t.customer_id] = {
        customer_id: t.customer_id, business_name: t.business_name,
        current: 0, d1_7: 0, d8_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0,
      };
    }
    const bucket = agingBucket(t.due_date, today);
    byCustomer[t.customer_id][bucket] = round2(byCustomer[t.customer_id][bucket] + t.outstanding_amount);
    byCustomer[t.customer_id].total = round2(byCustomer[t.customer_id].total + t.outstanding_amount);
  }
  const rows = Object.values(byCustomer).sort((a, b) => b.total - a.total);
  const totals = rows.reduce((acc, r) => {
    ['current', 'd1_7', 'd8_30', 'd31_60', 'd61_90', 'd90_plus', 'total'].forEach(k => acc[k] = round2((acc[k] || 0) + r[k]));
    return acc;
  }, {});
  res.json({ rows, totals });
});

module.exports = router;
