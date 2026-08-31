let allCustomers = [];

function renderCustomersTable() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  let rows = allCustomers;
  if (search) rows = rows.filter(c => (c.business_name + ' ' + (c.contact_name || '') + ' ' + (c.customer_code || '')).toLowerCase().includes(search));

  const tbody = document.getElementById('customersBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No customers found.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(c => `
    <tr>
      <td>${escapeHtml(c.customer_code || '—')}</td>
      <td><a class="link-cell" href="/customers/${c.id}">${escapeHtml(c.business_name)}</a></td>
      <td>${escapeHtml(c.contact_name || '—')}</td>
      <td><span class="tag-chip">${escapeHtml(c.payment_terms)}</span></td>
      <td class="num">${fmtMoney(c.total)}</td>
      <td class="num" style="${c.outstanding > 0 ? 'color:var(--red-600);font-weight:700;' : ''}">${fmtMoney(c.outstanding)}</td>
      <td><span class="badge ${c.status === 'active' ? 'badge-active' : 'badge-inactive'}">${c.status}</span></td>
      <td><button class="btn-icon" data-action="edit" data-id="${c.id}" title="Edit">✏️</button></td>
    </tr>`).join('');
}

async function loadCustomers() {
  const status = document.getElementById('statusFilter').value;
  document.getElementById('customersBody').innerHTML = '<tr class="loading-row"><td colspan="8"><span class="spinner"></span></td></tr>';
  try {
    allCustomers = await api('/api/customers' + (status ? '?status=' + status : ''));
  } catch (e) { toast(e.message, 'error'); allCustomers = []; }
  renderCustomersTable();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('newCustomerBtn').addEventListener('click', () => Modals.openCustomer({ onSaved: loadCustomers }));
  document.getElementById('searchInput').addEventListener('input', debounce(renderCustomersTable, 150));
  document.getElementById('statusFilter').addEventListener('change', loadCustomers);
  document.getElementById('customersBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="edit"]');
    if (!btn) return;
    Modals.openCustomer({ id: Number(btn.dataset.id), onSaved: loadCustomers });
  });
  loadCustomers();
});
