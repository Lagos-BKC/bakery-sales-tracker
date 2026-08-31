let currentReport = 'sales-by-day';
let currentRows = [];
let reportChart = null;

const REPORT_CONFIG = {
  'sales-by-day': {
    title: 'Sales by Day', endpoint: '/api/reports/sales-by-day',
    columns: [{ key: 'period', label: 'Date', fmt: fmtDate }, { key: 'transactions', label: 'Transactions', num: true },
      { key: 'units', label: 'Units Sold', num: true }, { key: 'revenue', label: 'Revenue', num: true, money: true }],
    chart: { x: 'period', y: 'revenue', y2: 'units', xFmt: fmtDate },
  },
  'sales-by-week': {
    title: 'Sales by Week', endpoint: '/api/reports/sales-by-week',
    columns: [{ key: 'period_start', label: 'Week Of', fmt: fmtDate }, { key: 'transactions', label: 'Transactions', num: true },
      { key: 'units', label: 'Units Sold', num: true }, { key: 'revenue', label: 'Revenue', num: true, money: true }],
    chart: { x: 'period_start', y: 'revenue', y2: 'units', xFmt: fmtDate },
  },
  'sales-by-month': {
    title: 'Sales by Month', endpoint: '/api/reports/sales-by-month',
    columns: [{ key: 'period', label: 'Month' }, { key: 'transactions', label: 'Transactions', num: true },
      { key: 'units', label: 'Units Sold', num: true }, { key: 'revenue', label: 'Revenue', num: true, money: true }],
    chart: { x: 'period', y: 'revenue', y2: 'units' },
  },
  'sales-by-customer': {
    title: 'Sales by Customer', endpoint: '/api/reports/sales-by-customer',
    columns: [{ key: 'business_name', label: 'Customer' }, { key: 'orders', label: 'Orders', num: true },
      { key: 'avg_order_value', label: 'Avg Order Value', num: true, money: true }, { key: 'revenue', label: 'Revenue', num: true, money: true },
      { key: 'paid', label: 'Paid', num: true, money: true }, { key: 'outstanding', label: 'Outstanding', num: true, money: true },
      { key: 'last_purchase', label: 'Last Purchase', fmt: fmtDate }],
  },
  'sales-by-sku': {
    title: 'Sales by SKU', endpoint: '/api/reports/sales-by-sku',
    columns: [{ key: 'sku_code', label: 'SKU' }, { key: 'product_name', label: 'Product' }, { key: 'category', label: 'Category' },
      { key: 'units', label: 'Units', num: true }, { key: 'transactions', label: 'Transactions', num: true },
      { key: 'avg_price', label: 'Avg Price', num: true, money: true }, { key: 'revenue', label: 'Revenue', num: true, money: true }],
  },
  'sales-by-category': {
    title: 'Sales by Category', endpoint: '/api/reports/sales-by-category',
    columns: [{ key: 'category', label: 'Category' }, { key: 'units', label: 'Units', num: true },
      { key: 'transactions', label: 'Transactions', num: true }, { key: 'revenue', label: 'Revenue', num: true, money: true }],
  },
  'paid-vs-unpaid': {
    title: 'Paid vs Unpaid Sales', endpoint: '/api/reports/paid-vs-unpaid',
    columns: [{ key: 'payment_status', label: 'Status' }, { key: 'transactions', label: 'Transactions', num: true },
      { key: 'revenue', label: 'Revenue', num: true, money: true }, { key: 'paid', label: 'Paid', num: true, money: true },
      { key: 'outstanding', label: 'Outstanding', num: true, money: true }],
  },
  'outstanding': {
    title: 'Outstanding Receivables', endpoint: '/api/receivables',
    columns: [{ key: 'business_name', label: 'Customer' }, { key: 'transaction_code', label: 'Transaction' },
      { key: 'transaction_date', label: 'Date', fmt: fmtDate }, { key: 'due_date', label: 'Due Date', fmt: fmtDate },
      { key: 'transaction_total', label: 'Amount', num: true, money: true }, { key: 'amount_paid', label: 'Paid', num: true, money: true },
      { key: 'outstanding_amount', label: 'Outstanding', num: true, money: true }, { key: 'display_status', label: 'Status', badge: true }],
    filterOutstandingOnly: true,
  },
};

function buildFilterParams() {
  const params = new URLSearchParams();
  const from = document.getElementById('fDateFrom').value;
  const to = document.getElementById('fDateTo').value;
  const customer = document.getElementById('fCustomer').value;
  const category = document.getElementById('fCategory').value;
  const status = document.getElementById('fStatus').value;
  if (from) params.set('date_from', from);
  if (to) params.set('date_to', to);
  if (customer) params.set('customer_id', customer);
  if (category) params.set('category', category);
  if (status) params.set('payment_status', status);
  return params;
}

async function loadFilterOptions() {
  try {
    const customers = await api('/api/customers?status=active');
    document.getElementById('fCustomer').innerHTML = '<option value="">All Customers</option>' +
      customers.map(c => `<option value="${c.id}">${escapeHtml(c.business_name)}</option>`).join('');
    const cats = await api('/api/products/categories');
    document.getElementById('fCategory').innerHTML = '<option value="">All Categories</option>' +
      cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  } catch (e) { /* ignore */ }
}

async function loadReport() {
  const config = REPORT_CONFIG[currentReport];
  document.getElementById('reportTitle').textContent = config.title;
  document.getElementById('reportBody').innerHTML = `<tr class="loading-row"><td colspan="${config.columns.length}"><span class="spinner"></span></td></tr>`;

  let rows;
  try {
    rows = await api(config.endpoint + '?' + buildFilterParams().toString());
  } catch (e) { toast(e.message, 'error'); rows = []; }

  if (config.filterOutstandingOnly) rows = rows.filter(r => r.outstanding_amount > 0);
  currentRows = rows;

  document.getElementById('reportThead').innerHTML = '<tr>' + config.columns.map(c => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('') + '</tr>';
  document.getElementById('reportBody').innerHTML = rows.length ? rows.map(r => '<tr>' + config.columns.map(c => {
    let val = r[c.key];
    if (c.badge) return `<td>${statusBadge(val)}</td>`;
    if (c.fmt) val = c.fmt(val);
    else if (c.money) val = fmtMoney(val);
    else if (c.num) val = fmtNum(val);
    return `<td class="${c.num ? 'num' : ''}">${c.badge ? val : escapeHtml(val ?? '—')}</td>`;
  }).join('') + '</tr>').join('') : `<tr class="empty-row"><td colspan="${config.columns.length}">No data for this filter.</td></tr>`;

  // totals row for money columns
  const moneyCols = config.columns.filter(c => c.money);
  if (rows.length && moneyCols.length) {
    document.getElementById('reportTfoot').innerHTML = '<tr style="font-weight:800;background:var(--cream-200);">' +
      config.columns.map((c, i) => {
        if (i === 0) return '<td>Total</td>';
        if (c.money) return `<td class="num">${fmtMoney(rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0))}</td>`;
        if (c.num) return `<td class="num">${fmtNum(rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0))}</td>`;
        return '<td></td>';
      }).join('') + '</tr>';
  } else {
    document.getElementById('reportTfoot').innerHTML = '';
  }

  const chartCard = document.getElementById('chartCard');
  if (config.chart && rows.length) {
    chartCard.style.display = '';
    const labels = rows.map(r => config.chart.xFmt ? config.chart.xFmt(r[config.chart.x]) : r[config.chart.x]);
    const ctx = document.getElementById('reportChart').getContext('2d');
    if (reportChart) reportChart.destroy();
    reportChart = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          { type: 'line', label: 'Revenue ($)', data: rows.map(r => r[config.chart.y]), borderColor: '#d98c2b',
            backgroundColor: 'rgba(217,140,43,0.12)', fill: true, tension: 0.3, yAxisID: 'y' },
          { type: 'bar', label: 'Units Sold', data: rows.map(r => r[config.chart.y2]), backgroundColor: 'rgba(107,66,38,0.25)', yAxisID: 'y1', borderRadius: 4 },
        ],
      },
      options: { scales: { y: { position: 'left', ticks: { callback: v => fmtMoneyShort(v) } }, y1: { position: 'right', grid: { display: false } } },
        plugins: { legend: { position: 'bottom' } } },
    });
  } else {
    chartCard.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadFilterOptions();
  loadReport();

  document.querySelectorAll('#reportTabs .chart-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#reportTabs .chart-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentReport = btn.dataset.report;
      loadReport();
    });
  });

  ['fDateFrom', 'fDateTo', 'fCustomer', 'fCategory', 'fStatus'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadReport);
  });
  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    ['fDateFrom', 'fDateTo', 'fCustomer', 'fCategory', 'fStatus'].forEach(id => document.getElementById(id).value = '');
    loadReport();
  });
  document.getElementById('exportBtn').addEventListener('click', () => {
    const config = REPORT_CONFIG[currentReport];
    downloadCsvFromRows(currentRows, config.columns.map(c => ({ key: c.key, label: c.label })), currentReport);
  });
});
