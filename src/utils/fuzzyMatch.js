// Lightweight fuzzy string matching used to resolve free-text names captured
// from a scanned invoice or an uploaded spreadsheet (e.g. the "Sold To" line,
// or a hand-typed product description) against existing customer/product
// records. No external dependency - the data volumes involved (tens to a
// few thousand customers/products for a small business) make a plain
// Levenshtein-based scorer fast enough, and it keeps this self-contained.

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

// Score two normalized strings from 0 (no relation) to 1 (identical).
function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const longer = Math.max(a.length, b.length);
    const shorter = Math.min(a.length, b.length);
    return 0.8 + 0.2 * (shorter / longer); // strong but not perfect
  }
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

// Finds the best-scoring candidate for `query` among `candidates`.
// `getLabel(candidate)` returns the string to compare against.
// Returns { item, score } for the best match at/above `threshold`, else null.
function bestMatch(query, candidates, getLabel, threshold) {
  const t = threshold == null ? 0.55 : threshold;
  const q = normalize(query);
  if (!q || !candidates || !candidates.length) return null;
  let best = null;
  for (const item of candidates) {
    const label = normalize(getLabel(item));
    const score = similarity(q, label);
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= t ? best : null;
}

module.exports = { normalize, levenshtein, similarity, bestMatch };
