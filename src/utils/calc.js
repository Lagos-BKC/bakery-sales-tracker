const dayjs = require('dayjs');

const TERMS_DAYS = {
  'COD': 0,
  'Net 7': 7,
  'Net 15': 15,
  'Net 30': 30,
  'Net 60': 60,
};

function computeDueDate(transactionDate, paymentTerms) {
  const days = TERMS_DAYS[paymentTerms] ?? 0;
  return dayjs(transactionDate).add(days, 'day').format('YYYY-MM-DD');
}

// Derive payment status purely from amounts. Overdue is a display-level
// concept layered on top of "Outstanding"/"Partially Paid" based on due date,
// used in the AR + aging views, but the stored payment_status only tracks
// Paid / Partially Paid / Outstanding per the business logic.
function derivePaymentStatus(total, amountPaid) {
  const paid = round2(amountPaid);
  const tot = round2(total);
  if (paid <= 0) return 'Outstanding';
  if (paid >= tot) return 'Paid';
  return 'Partially Paid';
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function computeOutstanding(total, amountPaid) {
  const o = round2(total) - round2(amountPaid);
  return o < 0 ? 0 : round2(o);
}

// Effective status for display purposes (adds "Overdue")
function effectiveStatus(txn, today) {
  const t = today || dayjs().format('YYYY-MM-DD');
  if (txn.payment_status === 'Paid') return 'Paid';
  if (txn.due_date && dayjs(t).isAfter(dayjs(txn.due_date), 'day') && txn.outstanding_amount > 0) {
    return 'Overdue';
  }
  return txn.payment_status; // Outstanding or Partially Paid
}

function agingBucket(dueDate, today) {
  const t = dayjs(today || dayjs().format('YYYY-MM-DD'));
  const due = dayjs(dueDate);
  const daysPast = t.diff(due, 'day');
  if (daysPast <= 0) return 'current';
  if (daysPast <= 7) return 'd1_7';
  if (daysPast <= 30) return 'd8_30';
  if (daysPast <= 60) return 'd31_60';
  if (daysPast <= 90) return 'd61_90';
  return 'd90_plus';
}

module.exports = {
  TERMS_DAYS,
  computeDueDate,
  derivePaymentStatus,
  computeOutstanding,
  round2,
  effectiveStatus,
  agingBucket,
};
