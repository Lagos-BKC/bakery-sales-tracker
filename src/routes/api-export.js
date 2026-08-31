const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { toCsv } = require('../utils/csv');
const { effectiveStatus } = require('../utils/calc');

const router = express.Router();

async function sendData(req, res, rows, columns, filename) {
  const format = (req.query.format || 'csv').toLowerCase();
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.columns = columns.map(c => ({ header: typeof c === 'object' ? c.label : c, key: typeof c === 'object' ? c.key : c, width: 20 }));
    ws.getRow(1).font = { bold: true };
    rows.forEach(r => ws.addRow(r));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } else {
    const csv = toCsv(rows, columns);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    res.send(csv);
  }
}

router.get('/sales', async (req, res) => {
  const rows = db.prepare(`
    SELECT t.transaction_code, t.transaction_date, c.business_name customer, p.sku_code, p.product_name,
           li.quantity, li.unit_price, li.line_total, t.transaction_total, t.amount_paid, t.outstanding_amount,
           t.payment_status, t.payment_date, t.payment_method, t.notes
    FROM sales_line_items li
    JOIN sales_transactions t ON t.id = li.transaction_id
    JOIN customers c ON c.id = t.customer_id
    JOIN products p ON p.id = li.product_id
    ORDER BY t.transaction_date DESC
  `).all();
  const columns = [
    { key: 'transaction_code', label: 'Transaction ID' }, { key: 'transaction_date', label: 'Date' },
    { key: 'customer', label: 'Customer' }, { key: 'sku_code', label: 'SKU' }, { key: 'product_name', label: 'Product' },
    { key: 'quantity', label: 'Quantity' }, { key: 'unit_price', label: 'Unit Price' }, { key: 'line_total', label: 'Line Total' },
    { key: 'transaction_total', label: 'Transaction Total' }, { key: 'amount_paid', label: 'Amount Paid' },
    { key: 'outstanding_amount', label: 'Outstanding' }, { key: 'payment_status', label: 'Payment Status' },
    { key: 'payment_date', label: 'Payment Date' }, { key: 'payment_method', label: 'Payment Method' }, { key: 'notes', label: 'Notes' },
  ];
  await sendData(req, res, rows, columns, 'sales_export');
});

router.get('/customers', async (req, res) => {
  const rows = db.prepare('SELECT * FROM customers ORDER BY business_name').all();
  await sendData(req, res, rows, ['customer_code', 'business_name', 'contact_name', 'phone', 'email', 'address', 'payment_terms', 'status', 'notes'], 'customers_export');
});

router.get('/products', async (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY product_name').all();
  await sendData(req, res, rows, ['sku_code', 'product_name', 'category', 'description', 'default_price', 'unit_of_measure', 'status'], 'products_export');
});

router.get('/receivables', async (req, res) => {
  const rows = db.prepare(`
    SELECT t.transaction_code, c.business_name, t.transaction_date, t.due_date, t.transaction_total, t.amount_paid,
           t.outstanding_amount, t.payment_status
    FROM sales_transactions t JOIN customers c ON c.id = t.customer_id
    WHERE t.outstanding_amount > 0 ORDER BY t.transaction_date ASC
  `).all().map(r => ({ ...r, display_status: effectiveStatus(r) }));
  const columns = [
    { key: 'transaction_code', label: 'Transaction ID' }, { key: 'business_name', label: 'Customer' },
    { key: 'transaction_date', label: 'Date' }, { key: 'due_date', label: 'Due Date' },
    { key: 'transaction_total', label: 'Amount' }, { key: 'amount_paid', label: 'Paid' },
    { key: 'outstanding_amount', label: 'Outstanding' }, { key: 'display_status', label: 'Status' },
  ];
  await sendData(req, res, rows, columns, 'outstanding_receivables');
});

router.get('/payments', async (req, res) => {
  const rows = db.prepare(`
    SELECT p.payment_date, c.business_name customer, t.transaction_code, p.amount, p.payment_method, p.reference_number, p.notes
    FROM payments p JOIN sales_transactions t ON t.id = p.transaction_id JOIN customers c ON c.id = t.customer_id
    ORDER BY p.payment_date DESC
  `).all();
  const columns = [
    { key: 'payment_date', label: 'Payment Date' }, { key: 'customer', label: 'Customer' },
    { key: 'transaction_code', label: 'Transaction ID' }, { key: 'amount', label: 'Amount' },
    { key: 'payment_method', label: 'Method' }, { key: 'reference_number', label: 'Reference #' }, { key: 'notes', label: 'Notes' },
  ];
  await sendData(req, res, rows, columns, 'payment_history');
});

module.exports = router;
