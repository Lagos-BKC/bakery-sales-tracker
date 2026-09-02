// Bulk sales import via CSV/Excel upload. Rows are parsed in the browser
// (SheetJS reads both CSV and Excel), grouped into transactions by an
// Invoice # column, then matched against existing customers/products on the
// server (POST /api/sales/import/resolve). Anything that doesn't match
// confidently is left for the user to pick manually - using the same
// search-combo control used everywhere else in the app - before the
// resolved groups are sent to POST /api/sales/import to actually be created.

let importSalesGroups = [];
let importSalesCustomers = [];
let importSalesProducts = [];

const SALES_HEADER_ALIASES = {
  invoice_ref: ['invoice', 'invoiceno', 'invoicenumber', 'reference', 'ref', 'order', 'orderno', 'ordernumber', 'invoicereference'],
  date: ['date', 'transactiondate', 'invoicedate', 'saledate'],
  customer: ['customer', 'soldto', 'customersoldto', 'customername', 'client', 'business', 'businessname', 'company', 'account'],
  product: ['product', 'sku', 'productsku', 'item', 'description', 'productname', 'skuproduct'],
  quantity: ['quantity', 'qty'],
  unit_price: ['unitprice', 'price', 'rate', 'unitcost'],
  payment_status: ['paymentstatus', 'status'],
  amount_paid: ['amountpaid', 'paid', 'paidamount'],
  payment_date: ['paymentdate', 'datepaid'],
  payment_method: ['paymentmethod', 'method'],
  notes: ['notes', 'note', 'comments', 'comment'],
};

function normalizeHeaderKeySales(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapSalesRow(rawRow) {
  const out = {};
  const keys = Object.keys(rawRow);
  for (const field of Object.keys(SALES_HEADER_ALIASES)) {
    const aliases = SALES_HEADER_ALIASES[field];
    const foundKey = keys.find(k => aliases.includes(normalizeHeaderKeySales(k)));
    out[field] = foundKey !== undefined ? rawRow[foundKey] : '';
  }
  return out;
}

function parseFlexibleDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return isNaN(value) ? '' : value.toISOString().slice(0, 10);
  const s = String(value).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

function normalizePaymentStatus(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.startsWith('paid') && !s.includes('partial')) return 'Paid';
  if (s.includes('partial')) return 'Partially Paid';
  return 'Outstanding';
}

function groupSalesRows(rawRows) {
  const mapped = rawRows.map(mapSalesRow);
  const map = new Map();
  const order = [];
  mapped.forEach((row, idx) => {
    const ref = String(row.invoice_ref || '').trim();
    const key = ref || `__row_${idx}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        invoice_ref: ref,
        transaction_date: parseFlexibleDate(row.date),
        customer_name: String(row.customer || '').trim(),
        customer_id: null,
        payment_status: normalizePaymentStatus(row.payment_status),
        amount_paid: Number(row.amount_paid) || 0,
        payment_date: parseFlexibleDate(row.payment_date),
        payment_method: String(row.payment_method || '').trim(),
        notes: String(row.notes || '').trim(),
        line_items: [],
      });
      order.push(key);
    }
    map.get(key).line_items.push({
      description: String(row.product || '').trim(),
      quantity: row.quantity === '' ? null : Number(row.quantity),
      unit_price: row.unit_price === '' || row.unit_price === undefined ? null : Number(row.unit_price),
      product_id: null,
    });
  });
  return order.map(k => map.get(k));
}

async function resolveSalesMatches(groups) {
  const customerNames = [...new Set(groups.map(g => g.customer_name).filter(Boolean))];
  const productDescs = [...new Set(groups.flatMap(g => g.line_items.map(li => li.description)).filter(Boolean))];
  const result = await api('/api/sales/import/resolve', {
    method: 'POST',
    body: { customer_names: customerNames, product_descriptions: productDescs },
  });
  groups.forEach(g => {
    const cm = result.customers[g.customer_name];
    g.customer_id = cm ? cm.id : null;
    g.customer_display = cm ? cm.business_name : g.customer_name;
    g.line_items.forEach(li => {
      const pm = result.products[li.description];
      li.product_id = pm ? pm.id : null;
      li.display_name = pm ? pm.product_name : li.description;
      if (li.unit_price == null) li.unit_price = pm ? pm.default_price : 0;
      if (li.quantity == null) li.quantity = 1;
    });
  });
}

function groupIsReady(g) {
  if (!g.transaction_date) return false;
  if (!g.customer_id) return false;
  if (!g.line_items.length) return false;
  return g.line_items.every(li => li.product_id && li.quantity > 0 && li.unit_price != null && li.unit_price >= 0);
}

function fmtMoneySafe(n) { return typeof fmtMoney === 'function' ? fmtMoney(n) : '$' + (Number(n) || 0).toFixed(2); }

function groupTotal(g) {
  return g.line_items.reduce((sum, li) => sum + (Number(li.quantity) || 0) * (Number(li.unit_price) || 0), 0);
}

function updateImportSalesSummary() {
  const ready = importSalesGroups.filter(groupIsReady);
  const attention = importSalesGroups.length - ready.length;
  document.getElementById('importSalesSummary').innerHTML = `
    <div class="alert ${attention ? 'alert-error' : 'alert-success'}">
      ${importSalesGroups.length} sale(s) found — <strong>${ready.length} ready to import</strong>${attention ? `, ${attention} need attention (highlighted below)` : ''}.
    </div>`;
  const btn = document.getElementById('confirmImportSalesBtn');
  btn.style.display = '';
  btn.disabled = ready.length === 0;
  btn.textContent = ready.length ? `Import ${ready.length} Sale${ready.length === 1 ? '' : 's'}` : 'Nothing to Import';
}

function renderLineItemRow(group, li, lineIdx) {
  const row = document.createElement('div');
  row.className = 'import-line-row';
  row.innerHTML = `
    <div class="combo" data-role="product-combo"></div>
    <input type="number" min="0.01" step="0.01" data-role="qty" value="${li.quantity != null ? li.quantity : ''}">
    <input type="number" min="0" step="0.01" data-role="price" value="${li.unit_price != null ? li.unit_price : ''}">
    <span data-role="line-total" class="small-muted">${fmtMoneySafe((li.quantity || 0) * (li.unit_price || 0))}</span>
  `;
  const comboEl = row.querySelector('[data-role="product-combo"]');
  const combo = initCombo(comboEl, {
    items: importSalesProducts.map(p => ({ id: p.id, label: p.product_name, sub: p.sku_code })),
    placeholder: 'Pick a SKU…',
    onSelect: (item) => {
      li.product_id = item.id;
      const product = importSalesProducts.find(p => p.id === item.id);
      if (product && !li.unit_price) {
        li.unit_price = product.default_price;
        row.querySelector('[data-role="price"]').value = product.default_price;
      }
      updateCardStatus(group.key);
    },
  });
  combo.setValue(li.display_name || li.description);

  row.querySelector('[data-role="qty"]').addEventListener('input', (e) => {
    li.quantity = Number(e.target.value) || 0;
    row.querySelector('[data-role="line-total"]').textContent = fmtMoneySafe(li.quantity * (li.unit_price || 0));
    updateCardStatus(group.key);
  });
  row.querySelector('[data-role="price"]').addEventListener('input', (e) => {
    li.unit_price = e.target.value === '' ? null : Number(e.target.value);
    row.querySelector('[data-role="line-total"]').textContent = fmtMoneySafe((li.quantity || 0) * (li.unit_price || 0));
    updateCardStatus(group.key);
  });
  return row;
}

function renderGroupCard(group) {
  const card = document.createElement('div');
  card.dataset.key = group.key;
  card.className = 'import-group-card';

  const header = document.createElement('div');
  header.className = 'import-group-header';
  header.innerHTML = `
    <div>
      <strong>${escapeHtml(group.invoice_ref || 'Single-line sale')}</strong>
      <div class="meta">${escapeHtml(group.transaction_date || 'No date')} · ${group.line_items.length} item(s) · <span data-role="group-total">${fmtMoneySafe(groupTotal(group))}</span></div>
    </div>
    <span data-role="status-badge"></span>
  `;
  card.appendChild(header);

  const customerField = document.createElement('div');
  customerField.className = 'form-field';
  customerField.style.marginBottom = '10px';
  customerField.innerHTML = `<label style="font-size:11.5px;">Customer</label><div class="combo import-customer-combo" data-role="customer-combo"></div>`;
  card.appendChild(customerField);

  const customerCombo = initCombo(customerField.querySelector('[data-role="customer-combo"]'), {
    items: importSalesCustomers.map(c => ({ id: c.id, label: c.business_name, sub: c.contact_name || '' })),
    placeholder: 'Pick a customer…',
    onSelect: (item) => { group.customer_id = item.id; updateCardStatus(group.key); },
  });
  customerCombo.setValue(group.customer_display || group.customer_name);

  const linesWrap = document.createElement('div');
  group.line_items.forEach((li, idx) => linesWrap.appendChild(renderLineItemRow(group, li, idx)));
  card.appendChild(linesWrap);

  return card;
}

function updateCardStatus(key) {
  const group = importSalesGroups.find(g => g.key === key);
  const card = document.querySelector(`.import-group-card[data-key="${CSS.escape(key)}"]`);
  if (!group || !card) return;
  const ready = groupIsReady(group);
  card.classList.toggle('needs-attention', !ready);
  card.querySelector('[data-role="status-badge"]').innerHTML = ready
    ? '<span class="badge badge-active">Ready</span>'
    : '<span class="badge badge-inactive">Needs attention</span>';
  card.querySelector('[data-role="group-total"]').textContent = fmtMoneySafe(groupTotal(group));
  updateImportSalesSummary();
}

function renderImportSalesPreview() {
  const list = document.getElementById('importSalesPreviewList');
  list.innerHTML = '';
  importSalesGroups.forEach(g => list.appendChild(renderGroupCard(g)));
  importSalesGroups.forEach(g => updateCardStatus(g.key));
  document.getElementById('importSalesStep1').style.display = 'none';
  document.getElementById('importSalesStep2').style.display = '';
  updateImportSalesSummary();
}

function resetImportSalesModal() {
  importSalesGroups = [];
  document.getElementById('importSalesStep1').style.display = '';
  document.getElementById('importSalesStep2').style.display = 'none';
  document.getElementById('confirmImportSalesBtn').style.display = 'none';
  document.getElementById('importSalesFileInput').value = '';
  document.getElementById('importSalesError').innerHTML = '';
}

async function handleImportSalesFile(file) {
  const errEl = document.getElementById('importSalesError');
  errEl.innerHTML = '';
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
      if (!rawRows.length) { errEl.innerHTML = '<div class="alert alert-error">That file has no data rows.</div>'; return; }

      errEl.innerHTML = '<div class="alert alert-info">Matching customers and products…</div>';
      const [customers, products] = await Promise.all([
        api('/api/customers?status=active'), api('/api/products?status=active'),
      ]);
      importSalesCustomers = customers;
      importSalesProducts = products;

      importSalesGroups = groupSalesRows(rawRows);
      await resolveSalesMatches(importSalesGroups);
      errEl.innerHTML = '';
      renderImportSalesPreview();
    } catch (err) {
      errEl.innerHTML = `<div class="alert alert-error">Could not read that file: ${escapeHtml(err.message)}</div>`;
    }
  };
  reader.onerror = () => { errEl.innerHTML = '<div class="alert alert-error">Could not read that file.</div>'; };
  reader.readAsArrayBuffer(file);
}

async function submitImportSales() {
  const ready = importSalesGroups.filter(groupIsReady);
  if (!ready.length) return;
  const btn = document.getElementById('confirmImportSalesBtn');
  btn.disabled = true; btn.textContent = 'Importing…';
  try {
    const payload = ready.map(g => ({
      invoice_ref: g.invoice_ref,
      customer_id: g.customer_id,
      transaction_date: g.transaction_date,
      line_items: g.line_items.map(li => ({ product_id: li.product_id, quantity: li.quantity, unit_price: li.unit_price })),
      payment_status: g.payment_status,
      amount_paid: g.amount_paid,
      payment_date: g.payment_date,
      payment_method: g.payment_method,
      notes: g.notes,
    }));
    const result = await api('/api/sales/import', { method: 'POST', body: { sales: payload } });
    const readyKeys = new Set(ready.map(g => g.key));
    importSalesGroups = importSalesGroups.filter(g => !readyKeys.has(g.key));

    toast(`Imported ${result.inserted} sale${result.inserted === 1 ? '' : 's'}.${result.skipped.length ? ` ${result.skipped.length} could not be saved.` : ''}`, 'success');

    if (importSalesGroups.length) {
      renderImportSalesPreview();
    } else {
      closeModal('importSalesModalOverlay');
    }
    if (typeof loadSales === 'function') loadSales();
  } catch (e) {
    document.getElementById('importSalesError').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const importBtn = document.getElementById('importSalesBtn');
  if (!importBtn) return;

  importBtn.addEventListener('click', () => {
    resetImportSalesModal();
    openModal('importSalesModalOverlay');
  });

  document.getElementById('downloadSalesTemplateBtn').addEventListener('click', () => {
    const rows = [
      { 'Invoice #': 'INV-1001', 'Date': '2026-09-01', 'Customer (Sold To)': 'ABC Grocery', 'Product/SKU': 'White Bread', 'Quantity': 10, 'Unit Price': 4, 'Payment Status': 'Paid', 'Amount Paid': 40, 'Payment Date': '2026-09-01', 'Payment Method': 'Cash', 'Notes': '' },
      { 'Invoice #': 'INV-1001', 'Date': '2026-09-01', 'Customer (Sold To)': 'ABC Grocery', 'Product/SKU': 'Butter Croissant', 'Quantity': 6, 'Unit Price': 3.5, 'Payment Status': 'Paid', 'Amount Paid': '', 'Payment Date': '', 'Payment Method': '', 'Notes': '' },
      { 'Invoice #': '', 'Date': '2026-09-02', 'Customer (Sold To)': 'Downtown Bistro', 'Product/SKU': 'Sourdough Loaf', 'Quantity': 4, 'Unit Price': 6.5, 'Payment Status': 'Outstanding', 'Amount Paid': '', 'Payment Date': '', 'Payment Method': '', 'Notes': '' },
    ];
    const cols = ['Invoice #', 'Date', 'Customer (Sold To)', 'Product/SKU', 'Quantity', 'Unit Price', 'Payment Status', 'Amount Paid', 'Payment Date', 'Payment Method', 'Notes']
      .map(h => ({ key: h, label: h }));
    downloadCsvFromRows(rows, cols, 'sales_import_template.csv');
  });

  document.getElementById('importSalesFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleImportSalesFile(file);
  });

  document.getElementById('importSalesChooseAnotherBtn').addEventListener('click', resetImportSalesModal);
  document.getElementById('confirmImportSalesBtn').addEventListener('click', submitImportSales);
});
