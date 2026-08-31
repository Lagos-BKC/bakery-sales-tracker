function toCsv(rows, columns) {
  const cols = columns || (rows.length ? Object.keys(rows[0]) : []);
  const escape = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = cols.map(c => (typeof c === 'object' ? c.label : c)).join(',');
  const lines = rows.map(r => cols.map(c => {
    const key = typeof c === 'object' ? c.key : c;
    return escape(r[key]);
  }).join(','));
  return [header, ...lines].join('\n');
}

module.exports = { toCsv };
