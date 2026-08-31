let trendChart = null;
let trendRange = 'last_30';
let trendGranularity = 'daily';

function currentRangeParams() {
  const range = document.getElementById('rangeSelect').value;
  const params = new URLSearchParams({ range });
  if (range === 'custom') {
    params.set('from', document.getElementById('customFrom').value);
    params.set('to', document.getElementById('customTo').value);
  }
  return params;
}

async function loadDashboard() {
  const params = currentRangeParams();
  let data;
  try {
    data = await api('/api/dashboard?' + params.toString());
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  const k = data.kpis;
  document.getElementById('kpiToday').textContent = fmtMoney(k.todaySales);
  document.getElementById('kpiWeek').textContent = fmtMoney(k.weekSales);
  document.getElementById('kpiMonth').textContent = fmtMoney(k.monthSales);
  document.getElementById('kpiPaid').textContent = fmtMoney(k.totalPaidAllTime);
  document.getElementById('kpiOutstanding').textContent = fmtMoney(k.totalOutstanding);
  document.getElementById('kpiUnpaidCount').textContent = fmtNum(k.outstandingTxnCount);
  document.getElementById('kpiCustomers').textContent = fmtNum(k.activeCustomers);

  document.getElementById('kpiWowSub').innerHTML = data.growth.wowGrowth !== null ? growthPill(data.growth.wowGrowth, 'vs last week') : '';
  document.getElementById('kpiMomSub').innerHTML = data.growth.momGrowth !== null ? growthPill(data.growth.momGrowth, 'vs last month') : '<span class="small-muted">Not enough history yet</span>';

  // Top customers
  const tcBody = document.getElementById('topCustomersBody');
  tcBody.innerHTML = data.topCustomers.length ? data.topCustomers.map(c => `
    <tr>
      <td><a href="/customers/${c.id}" class="link-cell">${escapeHtml(c.business_name)}</a></td>
      <td class="num">${fmtMoney(c.sales)}</td>
      <td class="num">${c.pct}%</td>
    </tr>`).join('') : '<tr class="empty-row"><td colspan="3">No sales in this period yet.</td></tr>';

  // Top products
  const tpBody = document.getElementById('topProductsBody');
  tpBody.innerHTML = data.topProducts.length ? data.topProducts.map(p => `
    <tr>
      <td>${escapeHtml(p.product_name)} <span class="tag-chip">${escapeHtml(p.sku_code)}</span></td>
      <td class="num">${fmtNum(p.units)}</td>
      <td class="num">${fmtMoney(p.revenue)}</td>
    </tr>`).join('') : '<tr class="empty-row"><td colspan="3">No sales in this period yet.</td></tr>';

  // Outstanding customers
  const obody = document.getElementById('outstandingBody');
  obody.innerHTML = data.outstandingCustomers.length ? data.outstandingCustomers.map(c => `
    <tr>
      <td><a href="/customers/${c.id}" class="link-cell">${escapeHtml(c.business_name)}</a></td>
      <td class="num" style="color:var(--red-600);font-weight:700;">${fmtMoney(c.amount_owing)}</td>
      <td>${fmtDate(c.oldest_date)}</td>
      <td class="num">${fmtNum(c.txn_count)}</td>
    </tr>`).join('') : '<tr class="empty-row"><td colspan="4">🎉 No outstanding balances — everyone is paid up.</td></tr>';

  // Recent sales
  const rbody = document.getElementById('recentSalesBody');
  rbody.innerHTML = data.recentSales.length ? data.recentSales.map(t => `
    <tr>
      <td>${fmtDate(t.transaction_date)}</td>
      <td><a href="/customers/${t.customer_id}" class="link-cell">${escapeHtml(t.business_name)}</a></td>
      <td class="num">${fmtMoney(t.transaction_total)}</td>
      <td class="num">${fmtMoney(t.amount_paid)}</td>
      <td class="num">${fmtMoney(t.outstanding_amount)}</td>
      <td>${statusBadge(t.display_status)}</td>
    </tr>`).join('') : '<tr class="empty-row"><td colspan="6">No sales recorded yet.</td></tr>';

  document.getElementById('trendPeriodLabel').textContent = data.period.label;
}

async function loadTrend() {
  const params = new URLSearchParams({ granularity: trendGranularity, range: trendRange });
  let rows;
  try {
    rows = await api('/api/dashboard/trend?' + params.toString());
  } catch (e) { toast(e.message, 'error'); return; }

  const labels = rows.map(r => {
    if (trendGranularity === 'monthly') return r.bucket;
    if (trendGranularity === 'weekly') return 'Wk of ' + fmtDate(r.bucket_start);
    return fmtDate(r.bucket_start || r.bucket);
  });
  const revenue = rows.map(r => r.revenue);
  const units = rows.map(r => r.units);

  const ctx = document.getElementById('trendChart').getContext('2d');
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'line', label: 'Revenue ($)', data: revenue, borderColor: '#d98c2b', backgroundColor: 'rgba(217,140,43,0.12)',
          fill: true, tension: 0.3, yAxisID: 'y', pointRadius: 2, borderWidth: 2,
        },
        {
          type: 'bar', label: 'Units Sold', data: units, backgroundColor: 'rgba(107,66,38,0.25)', yAxisID: 'y1', borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { position: 'left', ticks: { callback: v => fmtMoneyShort(v) }, grid: { color: '#f0e6d8' } },
        y1: { position: 'right', grid: { display: false }, beginAtZero: true },
      },
      plugins: { legend: { position: 'bottom' } },
    },
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const rangeSelect = document.getElementById('rangeSelect');
  const customFrom = document.getElementById('customFrom');
  const customTo = document.getElementById('customTo');
  rangeSelect.addEventListener('change', () => {
    const custom = rangeSelect.value === 'custom';
    customFrom.style.display = custom ? 'inline-block' : 'none';
    customTo.style.display = custom ? 'inline-block' : 'none';
    if (!custom) loadDashboard();
  });
  customFrom.addEventListener('change', loadDashboard);
  customTo.addEventListener('change', loadDashboard);

  document.querySelectorAll('.chart-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.range) { trendRange = btn.dataset.range; trendGranularity = 'daily'; }
      if (btn.dataset.gran) { trendGranularity = btn.dataset.gran; trendRange = trendGranularity === 'monthly' ? 'last_365' : 'last_180'; }
      loadTrend();
    });
  });

  loadDashboard();
  loadTrend();
});
