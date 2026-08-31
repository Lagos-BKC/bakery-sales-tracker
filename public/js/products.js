let allProducts = [];

function renderProductsTable() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const category = document.getElementById('categoryFilter').value;
  let rows = allProducts;
  if (search) rows = rows.filter(p => (p.product_name + ' ' + p.sku_code).toLowerCase().includes(search));
  if (category) rows = rows.filter(p => p.category === category);

  const tbody = document.getElementById('productsBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No products found.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(p => `
    <tr>
      <td><span class="tag-chip">${escapeHtml(p.sku_code)}</span></td>
      <td>${escapeHtml(p.product_name)}</td>
      <td>${escapeHtml(p.category || '—')}</td>
      <td>${escapeHtml(p.unit_of_measure)}</td>
      <td class="num">${fmtMoney(p.default_price)}</td>
      <td class="num">${fmtNum(p.units_sold)}</td>
      <td class="num">${fmtMoney(p.revenue)}</td>
      <td><span class="badge ${p.status === 'active' ? 'badge-active' : 'badge-inactive'}">${p.status}</span></td>
      <td><button class="btn-icon" data-action="edit" data-id="${p.id}" title="Edit">✏️</button></td>
    </tr>`).join('');
}

async function loadProducts() {
  const status = document.getElementById('statusFilter').value;
  document.getElementById('productsBody').innerHTML = '<tr class="loading-row"><td colspan="9"><span class="spinner"></span></td></tr>';
  try {
    allProducts = await api('/api/products' + (status ? '?status=' + status : ''));
    const cats = await api('/api/products/categories');
    const sel = document.getElementById('categoryFilter');
    const current = sel.value;
    sel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    sel.value = current;
  } catch (e) { toast(e.message, 'error'); allProducts = []; }
  renderProductsTable();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('newProductBtn').addEventListener('click', () => Modals.openProduct({ onSaved: loadProducts }));
  document.getElementById('searchInput').addEventListener('input', debounce(renderProductsTable, 150));
  document.getElementById('categoryFilter').addEventListener('change', renderProductsTable);
  document.getElementById('statusFilter').addEventListener('change', loadProducts);
  document.getElementById('productsBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="edit"]');
    if (!btn) return;
    Modals.openProduct({ id: Number(btn.dataset.id), onSaved: loadProducts });
  });
  loadProducts();
});
