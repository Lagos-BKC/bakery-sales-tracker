const crypto = require('crypto');

// Content fingerprint for one imported sale (one invoice/reference group from
// a bulk CSV/Excel upload): customer + date + invoice # + the exact set of
// line items. Two rows produce the same key only if they represent the same
// sale, so re-uploading the same spreadsheet (or the same rows within one
// spreadsheet) can be caught and skipped instead of silently doubling every
// transaction. Fixing a typo and re-uploading still imports fine, since that
// changes the content and therefore the key.
function computeImportDedupeKey({ customerId, transactionDate, invoiceRef, lineItems }) {
  const linesPart = (lineItems || [])
    .map((l) => `${l.product_id}:${Number(l.quantity)}:${Number(l.unit_price)}`)
    .sort()
    .join('|');
  const raw = [
    customerId,
    transactionDate,
    String(invoiceRef || '').trim().toLowerCase(),
    linesPart,
  ].join('::');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { computeImportDedupeKey };
