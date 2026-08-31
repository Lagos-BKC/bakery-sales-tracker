// ---------- Sidebar (mobile) ----------
document.addEventListener('DOMContentLoaded', () => {
  const hamburger = document.getElementById('hamburgerBtn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('show');
    });
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
  }
});

// ---------- Formatting ----------
function fmtMoney(n) {
  const v = Number(n) || 0;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtMoneyShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return fmtMoney(v);
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function statusBadge(status) {
  const map = { 'Paid': 'badge-paid', 'Partially Paid': 'badge-partial', 'Outstanding': 'badge-outstanding', 'Overdue': 'badge-overdue' };
  const cls = map[status] || 'badge-outstanding';
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}
function growthPill(val, label) {
  if (val === null || val === undefined) return `<span class="growth-pill flat">n/a</span>`;
  const cls = val > 0 ? 'up' : (val < 0 ? 'down' : 'flat');
  const arrow = val > 0 ? '▲' : (val < 0 ? '▼' : '–');
  return `<span class="growth-pill ${cls}">${arrow} ${Math.abs(val).toFixed(1)}% ${label || ''}</span>`;
}

// ---------- Toasts ----------
function toast(message, type) {
  const container = document.getElementById('toastContainer');
  if (!container) { alert(message); return; }
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ---------- Fetch helper ----------
async function api(url, options) {
  const opts = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {});
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-json */ }
  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// ---------- Debounce ----------
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms || 250); };
}

// ---------- Client-side CSV download (used by filtered Reports) ----------
function downloadCsvFromRows(rows, columns, filename) {
  const cols = columns || (rows.length ? Object.keys(rows[0]).map(k => ({ key: k, label: k })) : []);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = cols.map(c => c.label).join(',');
  const lines = rows.map(r => cols.map(c => esc(r[c.key])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename.endsWith('.csv') ? filename : filename + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Modal helpers ----------
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// ---------- Search-select combobox ----------
// Renders a text input + dropdown menu. `items` = [{id, label, sub}], onSelect(item), onAddNew(query) optional
function initCombo(containerEl, { items, onSelect, onAddNew, placeholder, addNewLabel }) {
  containerEl.innerHTML = `
    <input type="text" class="combo-input" placeholder="${escapeHtml(placeholder || 'Search...')}" autocomplete="off">
    <div class="combo-menu"></div>
  `;
  const input = containerEl.querySelector('.combo-input');
  const menu = containerEl.querySelector('.combo-menu');
  let currentItems = items;

  function render(filterText) {
    const q = (filterText || '').toLowerCase().trim();
    let filtered = currentItems.filter(it => !q || it.label.toLowerCase().includes(q) || (it.sub || '').toLowerCase().includes(q));
    filtered = filtered.slice(0, 50);
    let html = filtered.map(it => `<div class="combo-item" data-id="${it.id}">${escapeHtml(it.label)}${it.sub ? `<div class="sub">${escapeHtml(it.sub)}</div>` : ''}</div>`).join('');
    if (onAddNew && q) {
      html += `<div class="combo-item add-new" data-addnew="1">+ ${escapeHtml(addNewLabel || 'Add New')} "${escapeHtml(filterText)}"</div>`;
    }
    if (!html) html = `<div class="combo-item" style="color:#999;">No matches</div>`;
    menu.innerHTML = html;
    menu.classList.add('show');
  }

  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('input', () => render(input.value));
  input.addEventListener('blur', () => setTimeout(() => menu.classList.remove('show'), 180));
  menu.addEventListener('mousedown', (e) => {
    const itemEl = e.target.closest('.combo-item');
    if (!itemEl) return;
    e.preventDefault();
    if (itemEl.dataset.addnew) {
      onAddNew(input.value.trim());
    } else {
      const item = currentItems.find(it => String(it.id) === itemEl.dataset.id);
      if (item) { input.value = item.label; onSelect(item); }
    }
    menu.classList.remove('show');
  });

  return {
    setValue(label) { input.value = label; },
    setItems(newItems) { currentItems = newItems; },
    clear() { input.value = ''; },
    focus() { input.focus(); },
  };
}
