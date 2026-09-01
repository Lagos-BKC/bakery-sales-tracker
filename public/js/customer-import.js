// Bulk customer import via CSV/Excel upload. Parsing happens entirely in the
// browser (using SheetJS, which reads both CSV and Excel formats); only the
// validated rows are sent to the server.

let importParsedRows = []; // full parsed rows with validation status
const IMPORT_TEMPLATE_HEADERS = ['Business Name', 'Contact Name', 'Phone', 'Email', 'Payment Terms', 'Address', 'Notes'];

// Maps a variety of header spellings to our internal field names.
const IMPORT_HEADER_ALIASES = {
  business_name: ['businessname', 'business', 'company', 'companyname', 'customer', 'customername', 'name'],
  contact_name: ['contactname', 'contact', 'contactperson'],
  phone: ['phone', 'phonenumber', 'telephone', 'tel', 'mobile'],
  email: ['email', 'emailaddress', 'e-mail'],
  payment_terms: ['paymentterms', 'terms', 'paymentterm'],
  address: ['address', 'streetaddress', 'location'],
  notes: ['notes', 'note', 'comments', 'comment'],
};

function normalizeHeaderKey(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapRowToCustomer(rawRow) {
  const out = { business_name: '', contact_name: '', phone: '', email: '', payment_terms: '', address: '', notes: '' };
  const keys = Object.keys(rawRow);
  for (const field of Object.keys(IMPORT_HEADER_ALIASES)) {
    const aliases = IMPORT_HEADER_ALIASES[field];
    const foundKey = keys.find(k => aliases.includes(normalizeHeaderKey(k)));
    if (foundKey !== undefined) out[field] = String(rawRow[foundKey] || '').trim();
  }
  return out;
}

function resetImportModal() {
  importParsedRows = [];
  document.getElementById('importStep1').style.display = '';
  document.getElementById('importStep2').style.display = 'none';
  document.getElementById('confirmImportBtn').style.display = 'none';
  document.getElementById('importFileInput').value = '';
  document.getElementById('importModalError').innerHTML = '';
}

function validateImportRows(customers) {
  const existingNames = new Set(allCustomers.map(c => c.business_name.trim().toLowerCase()));
  const seen = new Set();
  return customers.map((c, idx) => {
    const key = c.business_name.trim().toLowerCase();
    let status = 'ready', reason = '';
    if (!c.business_name.trim()) {
      status = 'invalid'; reason = 'Missing business name';
    } else if (existingNames.has(key)) {
      status = 'invalid'; reason = 'Already exists';
    } else if (seen.has(key)) {
      status = 'invalid'; reason = 'Duplicate in file';
    } else {
      seen.add(key);
    }
    return { ...c, row: idx + 2, status, reason };
  });
}

function renderImportPreview() {
  const valid = importParsedRows.filter(r => r.status === 'ready');
  const invalid = importParsedRows.filter(r => r.status !== 'ready');

  document.getElementById('importSummary').innerHTML = `
    <div class="alert ${invalid.length ? 'alert-error' : 'alert-success'}">
      ${importParsedRows.length} row(s) found — <strong>${valid.length} ready to import</strong>${invalid.length ? `, ${invalid.length} will be skipped` : ''}.
    </div>`;

  document.getElementById('importPreviewBody').innerHTML = importParsedRows.map(r => `
    <tr>
      <td>${r.row}</td>
      <td>${escapeHtml(r.business_name || '—')}</td>
      <td>${escapeHtml(r.contact_name || '—')}</td>
      <td>${escapeHtml(r.payment_terms || 'COD')}</td>
      <td>${r.status === 'ready' ? '<span class="badge badge-active">Ready</span>' : `<span class="badge badge-inactive">${escapeHtml(r.reason)}</span>`}</td>
    </tr>`).join('');

  document.getElementById('importStep1').style.display = 'none';
  document.getElementById('importStep2').style.display = '';
  const confirmBtn = document.getElementById('confirmImportBtn');
  confirmBtn.style.display = '';
  confirmBtn.disabled = valid.length === 0;
  confirmBtn.textContent = valid.length ? `Import ${valid.length} Customer${valid.length === 1 ? '' : 's'}` : 'Nothing to Import';
}

function handleImportFile(file) {
  const errEl = document.getElementById('importModalError');
  errEl.innerHTML = '';
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
      if (!rawRows.length) {
        errEl.innerHTML = '<div class="alert alert-error">That file has no data rows.</div>';
        return;
      }
      const mapped = rawRows.map(mapRowToCustomer);
      importParsedRows = validateImportRows(mapped);
      renderImportPreview();
    } catch (err) {
      errEl.innerHTML = `<div class="alert alert-error">Could not read that file: ${escapeHtml(err.message)}</div>`;
    }
  };
  reader.onerror = () => { errEl.innerHTML = '<div class="alert alert-error">Could not read that file.</div>'; };
  reader.readAsArrayBuffer(file);
}

async function submitImport() {
  const valid = importParsedRows.filter(r => r.status === 'ready')
    .map(r => ({
      business_name: r.business_name, contact_name: r.contact_name, phone: r.phone,
      email: r.email, payment_terms: r.payment_terms, address: r.address, notes: r.notes,
    }));
  if (!valid.length) return;
  const btn = document.getElementById('confirmImportBtn');
  btn.disabled = true; btn.textContent = 'Importing…';
  try {
    const result = await api('/api/customers/import', { method: 'POST', body: { customers: valid } });
    closeModal('importModalOverlay');
    toast(`Imported ${result.inserted} customer${result.inserted === 1 ? '' : 's'}.${result.skipped.length ? ` ${result.skipped.length} skipped.` : ''}`, 'success');
    loadCustomers();
  } catch (e) {
    document.getElementById('importModalError').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const importBtn = document.getElementById('importCustomersBtn');
  if (!importBtn) return;

  importBtn.addEventListener('click', () => {
    resetImportModal();
    openModal('importModalOverlay');
  });

  document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
    const sampleRow = {
      'Business Name': 'ABC Grocery', 'Contact Name': 'Jane Doe', 'Phone': '(555) 555-0100',
      'Email': 'jane@abcgrocery.com', 'Payment Terms': 'Net 30', 'Address': '123 Main St',
      'Notes': '',
    };
    downloadCsvFromRows(
      [sampleRow],
      IMPORT_TEMPLATE_HEADERS.map(h => ({ key: h, label: h })),
      'customer_import_template.csv'
    );
  });

  document.getElementById('importFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleImportFile(file);
  });

  document.getElementById('importChooseAnotherBtn').addEventListener('click', resetImportModal);
  document.getElementById('confirmImportBtn').addEventListener('click', submitImport);
});
