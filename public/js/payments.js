let allAr = [];

function renderArTable() {
  const status = document.getElementById('statusFilter').value;
  let rows = allAr;
  if (status) rows = rows.filter(r => r.display_status === status);

  const tbody = document.getElementById('arBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">Nothing to show here.</td></tr>';
  } else {
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><a class="link-cell" href="/customers/${r.customer_id}">${escapeHtml(r.business_name)}</a></td>
        <td><strong>${r.transaction_code}</strong></td>
        <td>${fmtDate(r.transaction_date)}</td>
        <td>${fmtDate(r.due_date)}</td>
        <td class="num">${fmtMoney(r.transaction_total)}</td>
        <td class="num">${fmtMoney(r.amount_paid)}</td>
        <td class="num">${fmtMoney(r.outstanding_amount)}</td>
        <td>${statusBadge(r.display_status)}</td>
        <td>${r.outstanding_amount > 0 ? `<button class="btn-icon" data-action="pay" data-id="${r.id}" data-code="${r.transaction_code}" data-customer="${escapeHtml(r.business_name)}" data-outstanding="${r.outstanding_amount}" title="Record Payment">💰</button>` : ''}</td>
      </tr>`).join('');
  }

  const sumOutstanding = allAr.reduce((s, r) => s + r.outstanding_amount, 0);
  const sumCount = allAr.filter(r => r.outstanding_amount > 0).length;
  const sumOverdue = allAr.filter(r => r.display_status === 'Overdue').reduce((s, r) => s + r.outstanding_amount, 0);
  document.getElementById('sumOutstanding').textContent = fmtMoney(sumOutstanding);
  document.getElementById('sumCount').textContent = fmtNum(sumCount);
  document.getElementById('sumOverdue').textContent = fmtMoney(sumOverdue);
}

async function loadAr() {
  try { allAr = await api('/api/receivables'); } catch (e) { toast(e.message, 'error'); allAr = []; }
  renderArTable();
}

async function loadAging() {
  let data;
  try { data = await api('/api/receivables/aging'); } catch (e) { toast(e.message, 'error'); return; }
  const tbody = document.getElementById('agingBody');
  tbody.innerHTML = data.rows.length ? data.rows.map(r => `
    <tr>
      <td><a class="link-cell" href="/customers/${r.customer_id}">${escapeHtml(r.business_name)}</a></td>
      <td class="num">${fmtMoney(r.current)}</td>
      <td class="num">${fmtMoney(r.d1_7)}</td>
      <td class="num">${fmtMoney(r.d8_30)}</td>
      <td class="num" style="${r.d31_60 > 0 ? 'color:var(--amber-600);font-weight:700;' : ''}">${fmtMoney(r.d31_60)}</td>
      <td class="num" style="${r.d61_90 > 0 ? 'color:var(--red-600);font-weight:700;' : ''}">${fmtMoney(r.d61_90)}</td>
      <td class="num" style="${r.d90_plus > 0 ? 'color:var(--red-600);font-weight:800;' : ''}">${fmtMoney(r.d90_plus)}</td>
      <td class="num"><strong>${fmtMoney(r.total)}</strong></td>
    </tr>`).join('') : '<tr class="empty-row"><td colspan="8">🎉 No outstanding balances.</td></tr>';

  document.getElementById('agingFoot').innerHTML = data.rows.length ? `
    <tr style="font-weight:800; background:var(--cream-200);">
      <td>Total</td>
      <td class="num">${fmtMoney(data.totals.current)}</td>
      <td class="num">${fmtMoney(data.totals.d1_7)}</td>
      <td class="num">${fmtMoney(data.totals.d8_30)}</td>
      <td class="num">${fmtMoney(data.totals.d31_60)}</td>
      <td class="num">${fmtMoney(data.totals.d61_90)}</td>
      <td class="num">${fmtMoney(data.totals.d90_plus)}</td>
      <td class="num">${fmtMoney(data.totals.total)}</td>
    </tr>` : '';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('statusFilter').addEventListener('change', renderArTable);
  document.getElementById('arBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="pay"]');
    if (!btn) return;
    Modals.openPayment({
      transactionId: Number(btn.dataset.id), transactionCode: btn.dataset.code, customerName: btn.dataset.customer,
      outstanding: Number(btn.dataset.outstanding), onSaved: () => { loadAr(); loadAging(); },
    });
  });
  loadAr();
  loadAging();
});
