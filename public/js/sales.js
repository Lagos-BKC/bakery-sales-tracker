let allSales = [];

function renderSalesTable() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const status = document.getElementById('statusFilter').value;
  const from = document.getElementById('dateFrom').value;
  const to = document.getElementById('dateTo').value;

  let rows = allSales;
  if (search) rows = rows.filter(t => (t.business_name + ' ' + t.transaction_code + ' ' + (t.notes || '')).toLowerCase().includes(search));
  if (status) rows = rows.filter(t => t.display_status === status);
  if (from) rows = rows.filter(t => t.transaction_date >= from);
  if (to) rows = rows.filter(t => t.transaction_date <= to);

  const tbody = document.getElementById('salesBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No sales match these filters.</td></tr>';
    return;
  }
  const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin';
  tbody.innerHTML = rows.map(t => {
    const productsSummary = t.line_items.map(li => `${li.product_name} ×${li.quantity}`).join(', ');
    return `
    <tr>
      <td><strong>${t.transaction_code}</strong></td>
      <td>${fmtDate(t.transaction_date)}</td>
      <td><a class="link-cell" href="/customers/${t.customer_id}">${escapeHtml(t.business_name)}</a></td>
      <td style="max-width:220px;white-space:normal;">${escapeHtml(productsSummary)}</td>
      <td class="num">${fmtMoney(t.transaction_total)}</td>
      <td class="num">${fmtMoney(t.amount_paid)}</td>
      <td class="num">${fmtMoney(t.outstanding_amount)}</td>
      <td>${statusBadge(t.display_status)}</td>
      <td style="white-space:nowrap;">
        ${t.outstanding_amount > 0 ? `<button class="btn-icon" title="Record Payment" data-action="pay" data-id="${t.id}">💰</button>` : ''}
        <button class="btn-icon" title="Edit" data-action="edit" data-id="${t.id}">✏️</button>
        ${isAdmin ? `<button class="btn-icon" title="Delete" data-action="delete" data-id="${t.id}">🗑️</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

async function loadSales() {
  document.getElementById('salesBody').innerHTML = '<tr class="loading-row"><td colspan="9"><span class="spinner"></span></td></tr>';
  try {
    allSales = await api('/api/sales');
  } catch (e) {
    toast(e.message, 'error');
    allSales = [];
  }
  renderSalesTable();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('newSaleBtn').addEventListener('click', () => Modals.openSale({ onSaved: loadSales }));
  document.getElementById('fabNewSale').addEventListener('click', () => Modals.openSale({ onSaved: loadSales }));
  document.getElementById('searchInput').addEventListener('input', debounce(renderSalesTable, 150));
  document.getElementById('statusFilter').addEventListener('change', renderSalesTable);
  document.getElementById('dateFrom').addEventListener('change', renderSalesTable);
  document.getElementById('dateTo').addEventListener('change', renderSalesTable);
  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('statusFilter').value = '';
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    renderSalesTable();
  });

  document.getElementById('salesBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const txn = allSales.find(t => t.id === id);
    if (btn.dataset.action === 'edit') {
      Modals.openSale({ id, onSaved: loadSales });
    } else if (btn.dataset.action === 'pay') {
      Modals.openPayment({
        transactionId: id, transactionCode: txn.transaction_code, customerName: txn.business_name,
        outstanding: txn.outstanding_amount, onSaved: loadSales,
      });
    } else if (btn.dataset.action === 'delete') {
      if (confirm(`Delete transaction ${txn.transaction_code}? This cannot be undone.`)) {
        api('/api/sales/' + id, { method: 'DELETE' }).then(() => { toast('Transaction deleted.', 'success'); loadSales(); })
          .catch(err => toast(err.message, 'error'));
      }
    }
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get('new') === '1') Modals.openSale({ onSaved: loadSales });

  loadSales();
});
