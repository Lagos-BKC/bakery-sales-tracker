const express = require('express');
const db = require('../db');
const { resolveRange, dayjs } = require('../utils/dateRanges');
const { round2, effectiveStatus } = require('../utils/calc');

const router = express.Router();

function sumSales(from, to) {
  return db.prepare(`
    SELECT COALESCE(SUM(transaction_total),0) total, COUNT(*) cnt, COALESCE(SUM(
      (SELECT COALESCE(SUM(li.quantity),0) FROM sales_line_items li WHERE li.transaction_id = t.id)
    ),0) units
    FROM sales_transactions t WHERE transaction_date BETWEEN ? AND ?
  `).get(from, to);
}

function sumPaidInPeriod(from, to) {
  return db.prepare(`SELECT COALESCE(SUM(amount),0) total FROM payments WHERE payment_date BETWEEN ? AND ?`).get(from, to).total;
}

router.get('/', (req, res) => {
  const { range = 'this_month', from, to } = req.query;
  const period = resolveRange(range, from, to);
  const today = dayjs();

  // Fixed reference windows (always current, independent of the selector)
  const todaySales = sumSales(today.format('YYYY-MM-DD'), today.format('YYYY-MM-DD'));
  const weekSales = sumSales(today.startOf('isoWeek').format('YYYY-MM-DD'), today.format('YYYY-MM-DD'));
  const monthSales = sumSales(today.startOf('month').format('YYYY-MM-DD'), today.format('YYYY-MM-DD'));

  // Live AR position (not period-filtered: money owed doesn't expire out of view)
  const arTotals = db.prepare(`
    SELECT COALESCE(SUM(transaction_total),0) total_sales_all_time,
           COALESCE(SUM(amount_paid),0) total_paid_all_time,
           COALESCE(SUM(outstanding_amount),0) total_outstanding,
           COUNT(CASE WHEN outstanding_amount > 0 THEN 1 END) outstanding_txn_count
    FROM sales_transactions
  `).get();
  const activeCustomers = db.prepare("SELECT COUNT(*) c FROM customers WHERE status = 'active'").get().c;

  // Selected-period summary
  const periodSales = sumSales(period.from, period.to);
  const periodPaid = sumPaidInPeriod(period.from, period.to);

  // Growth indicators
  const momCurrent = sumSales(today.startOf('month').format('YYYY-MM-DD'), today.format('YYYY-MM-DD')).total;
  const lastMonth = today.subtract(1, 'month');
  const momPrevSameSpan = sumSales(lastMonth.startOf('month').format('YYYY-MM-DD'),
    lastMonth.startOf('month').add(today.date() - 1, 'day').format('YYYY-MM-DD')).total;
  const hasLastMonthData = db.prepare("SELECT COUNT(*) c FROM sales_transactions WHERE transaction_date < ?").get(today.startOf('month').format('YYYY-MM-DD')).c > 0;
  const momGrowth = hasLastMonthData && momPrevSameSpan > 0 ? round2(((momCurrent - momPrevSameSpan) / momPrevSameSpan) * 100) : null;

  const wowCurrent = weekSales.total;
  const lastWeek = today.subtract(1, 'week');
  const wowPrevSameSpan = sumSales(lastWeek.startOf('isoWeek').format('YYYY-MM-DD'),
    lastWeek.startOf('isoWeek').add(today.isoWeekday() - 1, 'day').format('YYYY-MM-DD')).total;
  const hasLastWeekData = db.prepare("SELECT COUNT(*) c FROM sales_transactions WHERE transaction_date < ?").get(today.startOf('isoWeek').format('YYYY-MM-DD')).c > 0;
  const wowGrowth = hasLastWeekData && wowPrevSameSpan > 0 ? round2(((wowCurrent - wowPrevSameSpan) / wowPrevSameSpan) * 100) : null;

  const earliestTxn = db.prepare('SELECT MIN(transaction_date) d FROM sales_transactions').get().d;
  let yoyGrowth = null;
  if (earliestTxn && dayjs(earliestTxn).isBefore(today.subtract(1, 'year'))) {
    const yoyCurrent = sumSales(today.startOf('year').format('YYYY-MM-DD'), today.format('YYYY-MM-DD')).total;
    const lastYear = today.subtract(1, 'year');
    const yoyPrev = sumSales(lastYear.startOf('year').format('YYYY-MM-DD'), lastYear.format('YYYY-MM-DD')).total;
    yoyGrowth = yoyPrev > 0 ? round2(((yoyCurrent - yoyPrev) / yoyPrev) * 100) : null;
  }

  // Top customers (by period)
  const topCustomers = db.prepare(`
    SELECT c.id, c.business_name, SUM(t.transaction_total) sales, COUNT(*) orders
    FROM sales_transactions t JOIN customers c ON c.id = t.customer_id
    WHERE t.transaction_date BETWEEN ? AND ?
    GROUP BY c.id ORDER BY sales DESC LIMIT 8
  `).all(period.from, period.to);
  const periodTotalForPct = periodSales.total || 1;
  topCustomers.forEach(c => { c.pct = round2((c.sales / periodTotalForPct) * 100); });

  // Top products (by period)
  const topProducts = db.prepare(`
    SELECT p.id, p.product_name, p.sku_code, SUM(li.quantity) units, SUM(li.line_total) revenue
    FROM sales_line_items li
    JOIN sales_transactions t ON t.id = li.transaction_id
    JOIN products p ON p.id = li.product_id
    WHERE t.transaction_date BETWEEN ? AND ?
    GROUP BY p.id ORDER BY revenue DESC LIMIT 8
  `).all(period.from, period.to);

  // Outstanding customers (all-time balances owed, live)
  const outstandingCustomers = db.prepare(`
    SELECT c.id, c.business_name, SUM(t.outstanding_amount) amount_owing, MIN(t.transaction_date) oldest_date,
           COUNT(*) txn_count
    FROM sales_transactions t JOIN customers c ON c.id = t.customer_id
    WHERE t.outstanding_amount > 0
    GROUP BY c.id ORDER BY amount_owing DESC LIMIT 10
  `).all();

  // Recent sales
  const recentSales = db.prepare(`
    SELECT t.id, t.transaction_code, t.transaction_date, t.customer_id, c.business_name, t.transaction_total,
           t.amount_paid, t.outstanding_amount, t.payment_status, t.due_date
    FROM sales_transactions t JOIN customers c ON c.id = t.customer_id
    ORDER BY t.transaction_date DESC, t.id DESC LIMIT 10
  `).all().map(t => ({ ...t, display_status: effectiveStatus(t) }));

  // Daily trend across the selected period
  const dailyTrend = db.prepare(`
    SELECT t.transaction_date date, SUM(t.transaction_total) revenue,
           (SELECT COALESCE(SUM(li.quantity),0) FROM sales_line_items li WHERE li.transaction_id IN
             (SELECT id FROM sales_transactions WHERE transaction_date = t.transaction_date)) units
    FROM sales_transactions t
    WHERE t.transaction_date BETWEEN ? AND ?
    GROUP BY t.transaction_date ORDER BY t.transaction_date ASC
  `).all(period.from, period.to);

  res.json({
    period,
    kpis: {
      todaySales: todaySales.total,
      weekSales: weekSales.total,
      monthSales: monthSales.total,
      totalPaidAllTime: arTotals.total_paid_all_time,
      totalOutstanding: arTotals.total_outstanding,
      outstandingTxnCount: arTotals.outstanding_txn_count,
      activeCustomers,
      periodSales: periodSales.total,
      periodPaid,
      periodUnits: periodSales.units,
      periodTxnCount: periodSales.cnt,
    },
    growth: { momGrowth, wowGrowth, yoyGrowth },
    topCustomers,
    topProducts,
    outstandingCustomers,
    recentSales,
    dailyTrend,
  });
});

// GET /api/dashboard/trend?granularity=daily|weekly|monthly&range=...
router.get('/trend', (req, res) => {
  const { granularity = 'daily', range = 'last_30', from, to } = req.query;
  let start, end;
  const today = dayjs();
  if (range === 'last_7') { start = today.subtract(6, 'day'); end = today; }
  else if (range === 'last_30') { start = today.subtract(29, 'day'); end = today; }
  else if (range === 'last_90') { start = today.subtract(89, 'day'); end = today; }
  else if (range === 'last_180') { start = today.subtract(179, 'day'); end = today; }
  else if (range === 'last_365') { start = today.subtract(364, 'day'); end = today; }
  else if (range === 'custom') { start = dayjs(from); end = dayjs(to); }
  else { start = today.subtract(29, 'day'); end = today; }

  const s = start.format('YYYY-MM-DD');
  const e = end.format('YYYY-MM-DD');

  let groupExpr = "transaction_date";
  if (granularity === 'weekly') groupExpr = "strftime('%Y-W%W', transaction_date)";
  if (granularity === 'monthly') groupExpr = "strftime('%Y-%m', transaction_date)";

  const revenueRows = db.prepare(`
    SELECT ${groupExpr} bucket, MIN(transaction_date) bucket_start, SUM(transaction_total) revenue, COUNT(*) txn_count
    FROM sales_transactions
    WHERE transaction_date BETWEEN ? AND ?
    GROUP BY bucket ORDER BY bucket_start ASC
  `).all(s, e);

  const unitRows = db.prepare(`
    SELECT ${groupExpr.replace(/transaction_date/g, 't.transaction_date')} bucket, SUM(li.quantity) units
    FROM sales_line_items li JOIN sales_transactions t ON t.id = li.transaction_id
    WHERE t.transaction_date BETWEEN ? AND ?
    GROUP BY bucket
  `).all(s, e);
  const unitsByBucket = Object.fromEntries(unitRows.map(r => [r.bucket, r.units]));

  const rows = revenueRows.map(r => ({ ...r, units: unitsByBucket[r.bucket] || 0 }));
  res.json(rows);
});

module.exports = router;
