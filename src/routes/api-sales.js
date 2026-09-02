const express = require('express');
const dayjs = require('dayjs');
const db = require('../db');
const { computeDueDate, derivePaymentStatus, computeOutstanding, round2, effectiveStatus } = require('../utils/calc');
const { logAudit } = require('../utils/audit');
const { requireAdmin } = require('../middleware/auth');
const { bestMatch } = require('../utils/fuzzyMatch');
const { extractInvoiceData } = require('../utils/invoiceScanner');

const router = express.Router();

// Transaction codes are derived from the row's own auto-increment id (assigned
// by SQLite after insert), never from COUNT(*) or MAX(id) computed beforehand.
// AUTOINCREMENT ids are never reused, even after deletions, so a code derived
// this way can never collide with an existing row - unlike a COUNT(*)-based
// scheme, which regenerates an already-used code as soon as any earlier
// transaction has been deleted (the gap makes COUNT(*) fall behind the
// highest id actually in use).
function codeForId(id) {
  return 'TXN-' + String(id).padStart(6, '0');
}

function validateLineItems(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return 'At least one line item (SKU) is required.';
  for (const l of lines) {
    if (!l.product_id) return 'Each line item requires a product/SKU.';
    if (l.quantity == null || Number(l.quantity) <= 0) return 'Quantity must be greater than zero.';
    if (l.unit_price == null || Number(l.unit_price) < 0) return 'Unit price cannot be negative.';
  }
  return null;
}

// GET /api/sales - master table with filters
router.get('/', (req, res) => {
  const { search = '', customer_id = '', product_id = '', status = '', date_from = '', date_to = '', category = '' } = req.query;
  let sql = `
    SELECT t.*, c.business_name
    FROM sales_transactions t
    JOIN customers c ON c.id = t.customer_id
    WHERE 1=1
  `;
  const params = [];
  if (search) {
    sql += ' AND (c.business_name LIKE ? OR t.transaction_code LIKE ? OR t.notes LIKE ?)';
    const s = `%${search}%`; params.push(s, s, s);
  }
  if (customer_id) { sql += ' AND t.customer_id = ?'; params.push(customer_id); }
  if (status) { sql += ' AND t.payment_status = ?'; params.push(status); }
  if (date_from) { sql += ' AND t.transaction_date >= ?'; params.push(date_from); }
  if (date_to) { sql += ' AND t.transaction_date <= ?'; params.push(date_to); }
  if (product_id) {
    sql += ' AND t.id IN (SELECT transaction_id FROM sales_line_items WHERE product_id = ?)';
    params.push(product_id);
  }
  if (category) {
    sql += ' AND t.id IN (SELECT li.transaction_id FROM sales_line_items li JOIN products p ON p.id = li.product_id WHERE p.category = ?)';
    params.push(category);
  }
  sql += ' ORDER BY t.transaction_date DESC, t.id DESC LIMIT 1000';
  const txns = db.prepare(sql).all(...params);

  const lineStmt = db.prepare(`
    SELECT li.*, p.product_name, p.sku_code FROM sales_line_items li
    JOIN products p ON p.id = li.product_id WHERE li.transaction_id = ?
  `);
  const result = txns.map(t => ({
    ...t,
    display_status: effectiveStatus(t),
    line_items: lineStmt.all(t.id),
  }));
  res.json(result);
});

router.get('/:id', (req, res) => {
  const txn = db.prepare(`
    SELECT t.*, c.business_name, c.payment_terms FROM sales_transactions t
    JOIN customers c ON c.id = t.customer_id WHERE t.id = ?
  `).get(req.params.id);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });
  const lineItems = db.prepare(`
    SELECT li.*, p.product_name, p.sku_code FROM sales_line_items li
    JOIN products p ON p.id = li.product_id WHERE li.transaction_id = ?
  `).all(req.params.id);
  const payments = db.prepare('SELECT * FROM payments WHERE transaction_id = ? ORDER BY payment_date ASC, id ASC').all(req.params.id);
  res.json({ ...txn, display_status: effectiveStatus(txn), line_items: lineItems, payments });
});

// POST /api/sales - create new multi-line transaction
router.post('/', (req, res) => {
  const { customer_id, transaction_date, line_items, payment_status, amount_paid, payment_date, payment_method, notes } = req.body;

  if (!customer_id) return res.status(400).json({ error: 'Customer is required.' });
  if (!transaction_date) return res.status(400).json({ error: 'Transaction date is required.' });
  const lineErr = validateLineItems(line_items);
  if (lineErr) return res.status(400).json({ error: lineErr });

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
  if (!customer) return res.status(400).json({ error: 'Selected customer does not exist.' });

  let transactionTotal = 0;
  const preparedLines = line_items.map(l => {
    const qty = round2(Number(l.quantity));
    const price = round2(Number(l.unit_price));
    const lineTotal = round2(qty * price);
    transactionTotal = round2(transactionTotal + lineTotal);
    return { product_id: l.product_id, quantity: qty, unit_price: price, line_total: lineTotal };
  });

  let paid = 0;
  if (payment_status === 'Paid') paid = transactionTotal;
  else if (payment_status === 'Partially Paid') paid = round2(Number(amount_paid) || 0);
  else paid = 0;

  if (paid > transactionTotal) {
    return res.status(400).json({ error: 'Amount paid cannot exceed the transaction total.' });
  }
  const outstanding = computeOutstanding(transactionTotal, paid);
  const finalStatus = derivePaymentStatus(transactionTotal, paid);
  const dueDate = computeDueDate(transaction_date, customer.payment_terms);

  const insertTxn = db.prepare(`
    INSERT INTO sales_transactions
      (transaction_code, customer_id, transaction_date, transaction_total, amount_paid, outstanding_amount,
       payment_status, due_date, payment_date, payment_method, notes, created_by, updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const updateCode = db.prepare('UPDATE sales_transactions SET transaction_code = ? WHERE id = ?');
  const insertLine = db.prepare(`
    INSERT INTO sales_line_items (transaction_id, product_id, quantity, unit_price, line_total)
    VALUES (?,?,?,?,?)
  `);
  const insertPayment = db.prepare(`
    INSERT INTO payments (transaction_id, payment_date, amount, payment_method, reference_number, notes, created_by)
    VALUES (?,?,?,?,?,?,?)
  `);

  const userId = req.session.user.id;
  const { txnId, code } = db.transaction(() => {
    const info = insertTxn.run(
      null, customer_id, transaction_date, transactionTotal, paid, outstanding, finalStatus,
      dueDate, paid > 0 ? (payment_date || transaction_date) : null, paid > 0 ? (payment_method || 'Cash') : null,
      notes || null, userId, userId
    );
    const txnId = info.lastInsertRowid;
    const code = codeForId(txnId);
    updateCode.run(code, txnId);
    for (const l of preparedLines) insertLine.run(txnId, l.product_id, l.quantity, l.unit_price, l.line_total);
    if (paid > 0) {
      insertPayment.run(txnId, payment_date || transaction_date, paid, payment_method || 'Cash', null, 'Recorded at sale entry', userId);
    }
    return { txnId, code };
  })();

  logAudit(req, 'sales_transaction', txnId, 'create', `Created ${code} for ${customer.business_name}, total $${transactionTotal}`);
  res.status(201).json({ id: txnId, transaction_code: code });
});

// POST /api/sales/scan-invoice - reads a photographed/scanned invoice with
// Claude's vision model and returns the extracted fields plus best-guess
// matches against existing customers/products. This never writes to the
// database - the New Sale form pre-fills from the response and the user
// still reviews everything and hits Save Sale as normal.
router.post('/scan-invoice', async (req, res) => {
  const { image_base64, media_type } = req.body;
  if (!image_base64) return res.status(400).json({ error: 'No image was provided.' });
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const mediaType = allowedTypes.includes(media_type) ? media_type : 'image/jpeg';

  let extracted;
  try {
    extracted = await extractInvoiceData(image_base64, mediaType);
  } catch (err) {
    const status = err.code === 'NOT_CONFIGURED' ? 400 : 502;
    return res.status(status).json({ error: err.message });
  }

  const customers = db.prepare("SELECT id, business_name FROM customers WHERE status = 'active'").all();
  const products = db.prepare("SELECT id, product_name, sku_code, default_price FROM products WHERE status = 'active'").all();

  const customerMatch = bestMatch(extracted.sold_to, customers, c => c.business_name);

  const lineItems = (extracted.line_items || []).map(li => {
    const match = bestMatch(li.description, products, p => p.product_name) || bestMatch(li.description, products, p => p.sku_code);
    return {
      description: li.description,
      quantity: li.quantity || 1,
      unit_price: li.unit_price != null && li.unit_price !== '' ? li.unit_price : (match ? match.item.default_price : 0),
      product_match: match
        ? { id: match.item.id, product_name: match.item.product_name, sku_code: match.item.sku_code, score: round2(match.score) }
        : null,
    };
  });

  logAudit(req, 'sales_transaction', 0, 'scan', `Scanned an invoice photo (Sold To: "${extracted.sold_to || 'unknown'}")`);

  res.json({
    extracted,
    customer_match: customerMatch
      ? { id: customerMatch.item.id, business_name: customerMatch.item.business_name, score: round2(customerMatch.score) }
      : null,
    line_items: lineItems,
  });
});

// POST /api/sales/import/resolve - given the distinct free-text customer and
// product strings found in an uploaded spreadsheet, returns best-guess
// matches against existing records so the bulk-import preview can show them
// (and let the user correct anything wrong or unmatched) before anything is
// actually created.
router.post('/import/resolve', (req, res) => {
  const customerNames = Array.isArray(req.body.customer_names) ? req.body.customer_names : [];
  const productDescriptions = Array.isArray(req.body.product_descriptions) ? req.body.product_descriptions : [];

  const customers = db.prepare("SELECT id, business_name FROM customers WHERE status = 'active'").all();
  const products = db.prepare("SELECT id, product_name, sku_code, default_price FROM products WHERE status = 'active'").all();

  const customerMatches = {};
  for (const name of customerNames) {
    const match = bestMatch(name, customers, c => c.business_name);
    customerMatches[name] = match
      ? { id: match.item.id, business_name: match.item.business_name, score: round2(match.score) }
      : null;
  }

  const productMatches = {};
  for (const desc of productDescriptions) {
    const match = bestMatch(desc, products, p => p.product_name) || bestMatch(desc, products, p => p.sku_code);
    productMatches[desc] = match
      ? { id: match.item.id, product_name: match.item.product_name, sku_code: match.item.sku_code, default_price: match.item.default_price, score: round2(match.score) }
      : null;
  }

  res.json({ customers: customerMatches, products: productMatches });
});

// POST /api/sales/import - bulk-creates transactions parsed client-side from
// an uploaded CSV/Excel file, one entry per invoice/reference group (each
// carrying its own resolved customer_id and line items with resolved
// product_ids - resolution happens via /import/resolve plus manual user
// correction before this is called). Mirrors the validation used by POST /
// for a single sale, but reports per-group success/skip rather than failing
// the whole batch over one bad row.
router.post('/import', (req, res) => {
  const groups = Array.isArray(req.body.sales) ? req.body.sales : null;
  if (!groups || !groups.length) return res.status(400).json({ error: 'No sale rows were provided.' });
  if (groups.length > 2000) return res.status(400).json({ error: 'Import is limited to 2000 transactions at a time.' });

  const insertTxn = db.prepare(`
    INSERT INTO sales_transactions
      (transaction_code, customer_id, transaction_date, transaction_total, amount_paid, outstanding_amount,
       payment_status, due_date, payment_date, payment_method, notes, created_by, updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const updateCode = db.prepare('UPDATE sales_transactions SET transaction_code = ? WHERE id = ?');
  const insertLine = db.prepare(`
    INSERT INTO sales_line_items (transaction_id, product_id, quantity, unit_price, line_total)
    VALUES (?,?,?,?,?)
  `);
  const insertPayment = db.prepare(`
    INSERT INTO payments (transaction_id, payment_date, amount, payment_method, reference_number, notes, created_by)
    VALUES (?,?,?,?,?,?,?)
  `);

  const userId = req.session.user.id;
  const skipped = [];
  const inserted = [];

  groups.forEach((group, idx) => {
    const label = group.invoice_ref || `Row group ${idx + 1}`;
    const customer = group.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(group.customer_id) : null;
    if (!customer) { skipped.push({ group: label, reason: 'No matching customer selected' }); return; }
    if (!group.transaction_date) { skipped.push({ group: label, reason: 'Missing transaction date' }); return; }
    const lineErr = validateLineItems(group.line_items);
    if (lineErr) { skipped.push({ group: label, reason: lineErr }); return; }

    let transactionTotal = 0;
    const preparedLines = group.line_items.map(l => {
      const qty = round2(Number(l.quantity));
      const price = round2(Number(l.unit_price));
      const lineTotal = round2(qty * price);
      transactionTotal = round2(transactionTotal + lineTotal);
      return { product_id: l.product_id, quantity: qty, unit_price: price, line_total: lineTotal };
    });

    let paid = 0;
    if (group.payment_status === 'Paid') paid = transactionTotal;
    else if (group.payment_status === 'Partially Paid') paid = round2(Number(group.amount_paid) || 0);
    if (paid > transactionTotal) { skipped.push({ group: label, reason: 'Amount paid exceeds transaction total' }); return; }

    const outstanding = computeOutstanding(transactionTotal, paid);
    const finalStatus = derivePaymentStatus(transactionTotal, paid);
    const dueDate = computeDueDate(group.transaction_date, customer.payment_terms);

    try {
      const { txnId, code } = db.transaction(() => {
        const info = insertTxn.run(
          null, customer.id, group.transaction_date, transactionTotal, paid, outstanding, finalStatus,
          dueDate, paid > 0 ? (group.payment_date || group.transaction_date) : null, paid > 0 ? (group.payment_method || 'Cash') : null,
          group.notes || null, userId, userId
        );
        const txnId = info.lastInsertRowid;
        const code = codeForId(txnId);
        updateCode.run(code, txnId);
        for (const l of preparedLines) insertLine.run(txnId, l.product_id, l.quantity, l.unit_price, l.line_total);
        if (paid > 0) insertPayment.run(txnId, group.payment_date || group.transaction_date, paid, group.payment_method || 'Cash', null, 'Recorded via bulk import', userId);
        return { txnId, code };
      })();
      inserted.push({ id: txnId, transaction_code: code, customer: customer.business_name, total: transactionTotal });
    } catch (err) {
      skipped.push({ group: label, reason: 'Could not save this transaction (' + err.message + ')' });
    }
  });

  logAudit(req, 'sales_transaction', 0, 'import',
    `Bulk imported ${inserted.length} transaction(s) via CSV/Excel upload${skipped.length ? `, ${skipped.length} skipped` : ''}`);

  res.status(201).json({ inserted: inserted.length, skipped, transactions: inserted });
});

// PUT /api/sales/:id - edit transaction (preserves original date unless changed by admin/staff explicitly)
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM sales_transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });

  const { customer_id, transaction_date, line_items, notes } = req.body;
  if (!customer_id) return res.status(400).json({ error: 'Customer is required.' });
  if (!transaction_date) return res.status(400).json({ error: 'Transaction date is required.' });
  const lineErr = validateLineItems(line_items);
  if (lineErr) return res.status(400).json({ error: lineErr });

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
  if (!customer) return res.status(400).json({ error: 'Selected customer does not exist.' });

  let transactionTotal = 0;
  const preparedLines = line_items.map(l => {
    const qty = round2(Number(l.quantity));
    const price = round2(Number(l.unit_price));
    const lineTotal = round2(qty * price);
    transactionTotal = round2(transactionTotal + lineTotal);
    return { product_id: l.product_id, quantity: qty, unit_price: price, line_total: lineTotal };
  });

  // amount_paid comes from actual payments recorded, not re-entered here
  const totalPaid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE transaction_id = ?').get(req.params.id).s;
  if (round2(totalPaid) > transactionTotal) {
    return res.status(400).json({ error: `Cannot reduce transaction total below the $${round2(totalPaid)} already recorded in payments. Adjust payments first.` });
  }
  const outstanding = computeOutstanding(transactionTotal, totalPaid);
  const finalStatus = derivePaymentStatus(transactionTotal, totalPaid);
  const dueDate = computeDueDate(transaction_date, customer.payment_terms);
  const userId = req.session.user.id;

  db.transaction(() => {
    db.prepare('DELETE FROM sales_line_items WHERE transaction_id = ?').run(req.params.id);
    const insertLine = db.prepare(`
      INSERT INTO sales_line_items (transaction_id, product_id, quantity, unit_price, line_total) VALUES (?,?,?,?,?)
    `);
    for (const l of preparedLines) insertLine.run(req.params.id, l.product_id, l.quantity, l.unit_price, l.line_total);
    db.prepare(`
      UPDATE sales_transactions SET customer_id=?, transaction_date=?, transaction_total=?, outstanding_amount=?,
        payment_status=?, due_date=?, notes=?, updated_by=?, updated_at=datetime('now')
      WHERE id=?
    `).run(customer_id, transaction_date, transactionTotal, outstanding, finalStatus, dueDate, notes || null, userId, req.params.id);
  })();

  logAudit(req, 'sales_transaction', req.params.id, 'update', `Edited ${existing.transaction_code}`);
  res.json(db.prepare('SELECT * FROM sales_transactions WHERE id = ?').get(req.params.id));
});

// DELETE /api/sales/:id - admin only
router.delete('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM sales_transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });
  db.prepare('DELETE FROM sales_transactions WHERE id = ?').run(req.params.id);
  logAudit(req, 'sales_transaction', req.params.id, 'delete', `Deleted ${existing.transaction_code}`);
  res.json({ success: true });
});

// POST /api/sales/:id/payments - record a payment against a transaction
router.post('/:id/payments', (req, res) => {
  const txn = db.prepare('SELECT * FROM sales_transactions WHERE id = ?').get(req.params.id);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });
  const { payment_date, amount, payment_method, reference_number, notes } = req.body;
  const amt = round2(Number(amount));
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Payment amount must be greater than zero.' });
  if (!payment_date) return res.status(400).json({ error: 'Payment date is required.' });

  const currentPaid = round2(txn.amount_paid);
  const newPaid = round2(currentPaid + amt);
  if (newPaid > round2(txn.transaction_total) + 0.001) {
    return res.status(400).json({ error: `Payment would exceed the outstanding balance of $${round2(txn.transaction_total - currentPaid)}.` });
  }
  const outstanding = computeOutstanding(txn.transaction_total, newPaid);
  const status = derivePaymentStatus(txn.transaction_total, newPaid);
  const userId = req.session.user.id;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO payments (transaction_id, payment_date, amount, payment_method, reference_number, notes, created_by)
      VALUES (?,?,?,?,?,?,?)
    `).run(req.params.id, payment_date, amt, payment_method || 'Cash', reference_number || null, notes || null, userId);
    db.prepare(`
      UPDATE sales_transactions SET amount_paid=?, outstanding_amount=?, payment_status=?, payment_date=?, payment_method=?, updated_by=?, updated_at=datetime('now')
      WHERE id=?
    `).run(newPaid, outstanding, status, payment_date, payment_method || 'Cash', userId, req.params.id);
  })();

  logAudit(req, 'payment', req.params.id, 'create', `Recorded payment of $${amt} on ${txn.transaction_code}`);
  res.status(201).json(db.prepare('SELECT * FROM sales_transactions WHERE id = ?').get(req.params.id));
});

module.exports = router;
