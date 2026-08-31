let custTrendChart = null;

async function loadCustomerDetail() {
  let data;
  try {
    data = await api('/api/customers/' + CUSTOMER_ID);
  } catch (e) { toast(e.message, 'error'); return; }

  const c = data.customer;
  document.getElementById('custName').textContent = c.business_name;
  document.getElementById('custMeta').innerHTML =
    `${escapeHtml(c.customer_code || '')} · ${escapeHtml(c.contact_name || 'No contact set')} · ${escapeHtml(c.phone || '')} ` +
    `<span class="tag-chip">${escapeHtml(c.payment_terms)}</span> <span class="badge ${c.status === 'active' ? 'badge-active' : 'badge-inactive'}">${c.status}</span>`;

  const s = data.summary;
  document.getElementById('statTotal').textContent = fmtMoney(s.total_purchases);
  document.getElementById('statPaid').textContent = fmtMoney(s.total_paid);
  document.getElementById('statOutstanding').textContent = fmtMoney(s.total_outstanding);
  document.getElementById('statCount').textContent = fmtNum(s.num_transactions);
  document.getElementById('statAvg').textContent = fmtMoney(s.avg_transaction_value);
  document.getElementById('statLast').textContent = s.last_purchase_date ? fmtDate(s.last_purchase_date) : '—';

  document.getElementById('topProductsBody').innerHTML = data.topProducts.length ? data.topProducts.map(p => `
    <tr><td>${escapeHtml(p.product_name)}</td><td class="num">${fmtNum(p.units)}</td><td class="num">${fmtMoney(p.revenue)}</td></tr>
  `).join('') : '<tr class="empty-row"><td colspan="3">No purchases yet.</td></tr>';

  const tbody = document.getElementById('txnBody');
  tbody.innerHTML = data.transactions.length ? data.transactions.map(t => `
    <tr>
      <td>${fmtDate(t.transaction_date)}</td>
      <td><strong>${t.transaction_code}</strong></td>
      <td style="max-width:220px;white-space:normal;">${escapeHtml(t.products_summary || '')}</td>
      <td class="num">${fmtMoney(t.transaction_total)}</td>
      <td class="num">${fmtMoney(t.amount_paid)}</td>
      <td class="num">${fmtMoney(t.outstanding_amount)}</td>
      <td>${statusBadge(t.display_status)}</td>
      <td>${t.outstanding_amount > 0 ? `<button class="btn-icon" data-action="pay" data-id="${t.id}" data-code="${t.transaction_code}" data-outstanding="${t.outstanding_amount}" title="Record Payment">💰</button>` : ''}
          <button class="btn-icon" data-action="edit" data-id="${t.id}" title="Edit">✏️</button></td>
    </tr>`).join('') : '<tr class="empty-row"><td colspan="8">No transactions yet.</td></tr>';

  const labels = data.monthly.map(m => m.month);
  const values = data.monthly.map(m => m.total);
  const ctx = document.getElementById('custTrendChart').getContext('2d');
  if (custTrendChart) custTrendChart.destroy();
  custTrendChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Monthly Sales ($)', data: values, borderColor: '#d98c2b', backgroundColor: 'rgba(217,140,43,0.12)', fill: true, tension: 0.3 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => fmtMoneyShort(v) } } } },
  });

  document.getElementById('custName').dataset.name = c.business_name;
}

document.addEventListener('DOMContentLoaded', () => {
  loadCustomerDetail();
  document.getElementById('editCustomerBtn').addEventListener('click', () => Modals.openCustomer({ id: CUSTOMER_ID, onSaved: loadCustomerDetail }));
  document.getElementById('newSaleForCustomerBtn').addEventListener('click', () => Modals.openSale({ customerId: CUSTOMER_ID, onSaved: loadCustomerDetail }));
  document.getElementById('txnBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit') Modals.openSale({ id: Number(btn.dataset.id), onSaved: loadCustomerDetail });
    if (btn.dataset.action === 'pay') Modals.openPayment({
      transactionId: Number(btn.dataset.id), transactionCode: btn.dataset.code,
      customerName: document.getElementById('custName').dataset.name,
      outstanding: Number(btn.dataset.outstanding), onSaved: loadCustomerDetail,
    });
  });
});
