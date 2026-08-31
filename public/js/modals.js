const Modals = (function () {
  let customersCache = [];
  let productsCache = [];
  let saleLineIdSeq = 0;
  let editingSaleId = null;
  let currentPaymentCtx = null;

  async function loadCustomers() {
    customersCache = await api('/api/customers?status=active');
    return customersCache;
  }
  async function loadProducts() {
    productsCache = await api('/api/products?status=active');
    return productsCache;
  }

  function showError(id, msg) {
    const el = document.getElementById(id);
    el.innerHTML = msg ? `<div class="alert alert-error">${escapeHtml(msg)}</div>` : '';
  }

  // ============ SALE MODAL ============
  function addLineItemRow(prefill) {
    const tbody = document.getElementById('saleLineItemsBody');
    const rowId = 'line_' + (saleLineIdSeq++);
    const tr = document.createElement('tr');
    tr.id = rowId;
    tr.innerHTML = `
      <td><div class="combo" data-role="product-combo"></div></td>
      <td><input type="number" min="0.01" step="0.01" data-role="qty" value="${prefill && prefill.quantity ? prefill.quantity : 1}"></td>
      <td><input type="number" min="0" step="0.01" data-role="price" value="${prefill && prefill.unit_price !== undefined ? prefill.unit_price : ''}"></td>
      <td><span data-role="line-total">$0.00</span></td>
      <td><button type="button" class="remove-line" title="Remove">✕</button></td>
    `;
    tbody.appendChild(tr);
    tr.dataset.productId = prefill && prefill.product_id ? prefill.product_id : '';

    const comboEl = tr.querySelector('[data-role="product-combo"]');
    const combo = initCombo(comboEl, {
      items: productsCache.map(p => ({ id: p.id, label: `${p.product_name}`, sub: `${p.sku_code} · ${fmtMoney(p.default_price)}/${p.unit_of_measure}` })),
      placeholder: 'Search SKU / product…',
      addNewLabel: 'Add New SKU',
      onSelect: (item) => {
        tr.dataset.productId = item.id;
        const product = productsCache.find(p => p.id === item.id);
        const priceInput = tr.querySelector('[data-role="price"]');
        if (product && (!priceInput.value || Number(priceInput.value) === 0)) priceInput.value = product.default_price;
        recalcLine(tr);
      },
      onAddNew: (query) => {
        Modals.openProduct({
          prefillName: query,
          onSaved: async (product) => {
            await loadProducts();
            combo.setItems(productsCache.map(p => ({ id: p.id, label: p.product_name, sub: `${p.sku_code} · ${fmtMoney(p.default_price)}/${p.unit_of_measure}` })));
            combo.setValue(product.product_name);
            tr.dataset.productId = product.id;
            tr.querySelector('[data-role="price"]').value = product.default_price;
            recalcLine(tr);
          },
        });
      },
    });
    if (prefill && prefill.product_name) combo.setValue(`${prefill.product_name}`);

    tr.querySelector('[data-role="qty"]').addEventListener('input', () => recalcLine(tr));
    tr.querySelector('[data-role="price"]').addEventListener('input', () => recalcLine(tr));
    tr.querySelector('.remove-line').addEventListener('click', () => { tr.remove(); recalcTotal(); });
    recalcLine(tr);
  }

  function recalcLine(tr) {
    const qty = Number(tr.querySelector('[data-role="qty"]').value) || 0;
    const price = Number(tr.querySelector('[data-role="price"]').value) || 0;
    tr.querySelector('[data-role="line-total"]').textContent = fmtMoney(qty * price);
    recalcTotal();
  }

  function recalcTotal() {
    let total = 0;
    document.querySelectorAll('#saleLineItemsBody tr').forEach(tr => {
      const qty = Number(tr.querySelector('[data-role="qty"]').value) || 0;
      const price = Number(tr.querySelector('[data-role="price"]').value) || 0;
      total += qty * price;
    });
    document.getElementById('saleTransactionTotal').textContent = fmtMoney(total);
    const status = document.querySelector('input[name="saleStatus"]:checked').value;
    if (status === 'Paid') document.getElementById('saleAmountPaid').value = total.toFixed(2);
    return total;
  }

  function updatePaymentFieldsVisibility() {
    const status = document.querySelector('input[name="saleStatus"]:checked').value;
    document.getElementById('saleAmountPaidField').style.display = (status === 'Partial') ? 'flex' : 'none';
    const showDateMethod = status === 'Paid' || status === 'Partial';
    document.getElementById('salePaymentDateField').style.display = showDateMethod ? 'flex' : 'none';
    document.getElementById('salePaymentMethodField').style.display = showDateMethod ? 'flex' : 'none';
    if (status === 'Paid') recalcTotal();
    if (status === 'Unpaid') document.getElementById('saleAmountPaid').value = '';
  }

  async function openSale(opts) {
    opts = opts || {};
    editingSaleId = opts.id || null;
    showError('saleModalError', null);
    document.getElementById('saleModalTitle').textContent = editingSaleId ? 'Edit Sale' : 'New Sale';
    document.getElementById('saleLineItemsBody').innerHTML = '';
    document.getElementById('saleNotes').value = '';
    document.getElementById('saleDate').value = todayStr();
    document.querySelector('input[name="saleStatus"][value="Unpaid"]').checked = true;
    document.getElementById('saleAmountPaid').value = '';
    document.getElementById('salePaymentDate').value = todayStr();

    // In edit mode, payment status is managed via the Payments section, not here.
    document.querySelectorAll('input[name="saleStatus"]').forEach(r => r.closest('.form-field').style.display = editingSaleId ? 'none' : '');
    document.getElementById('saleAmountPaidField').style.display = 'none';
    document.getElementById('salePaymentDateField').style.display = 'none';
    document.getElementById('salePaymentMethodField').style.display = 'none';

    await Promise.all([loadCustomers(), loadProducts()]);

    const comboEl = document.getElementById('saleCustomerCombo');
    comboEl.dataset.customerId = '';
    const combo = initCombo(comboEl, {
      items: customersCache.map(c => ({ id: c.id, label: c.business_name, sub: c.contact_name || '' })),
      placeholder: 'Search customer…',
      addNewLabel: 'Add New Customer',
      onSelect: (item) => { comboEl.dataset.customerId = item.id; },
      onAddNew: (query) => {
        Modals.openCustomer({
          prefillName: query,
          onSaved: async (customer) => {
            await loadCustomers();
            combo.setItems(customersCache.map(c => ({ id: c.id, label: c.business_name, sub: c.contact_name || '' })));
            combo.setValue(customer.business_name);
            comboEl.dataset.customerId = customer.id;
          },
        });
      },
    });

    if (opts.id) {
      const txn = await api('/api/sales/' + opts.id);
      document.getElementById('saleDate').value = txn.transaction_date;
      document.getElementById('saleNotes').value = txn.notes || '';
      comboEl.dataset.customerId = txn.customer_id;
      combo.setValue(txn.business_name);
      txn.line_items.forEach(li => addLineItemRow(li));
    } else {
      if (opts.customerId) {
        const c = customersCache.find(c => c.id === opts.customerId);
        if (c) { comboEl.dataset.customerId = c.id; combo.setValue(c.business_name); }
      }
      addLineItemRow();
    }

    Modals._onSaleSaved = opts.onSaved;
    openModal('saleModalOverlay');
  }

  async function saveSale() {
    showError('saleModalError', null);
    const customerId = document.getElementById('saleCustomerCombo').dataset.customerId;
    const date = document.getElementById('saleDate').value;
    if (!customerId) return showError('saleModalError', 'Please select a customer.');
    if (!date) return showError('saleModalError', 'Please select a transaction date.');

    const rows = Array.from(document.querySelectorAll('#saleLineItemsBody tr'));
    if (!rows.length) return showError('saleModalError', 'Add at least one line item.');
    const lineItems = [];
    for (const tr of rows) {
      const productId = tr.dataset.productId;
      const qty = Number(tr.querySelector('[data-role="qty"]').value);
      const price = Number(tr.querySelector('[data-role="price"]').value);
      if (!productId) return showError('saleModalError', 'Every line needs a SKU selected.');
      if (!qty || qty <= 0) return showError('saleModalError', 'Quantity must be greater than zero.');
      if (price < 0) return showError('saleModalError', 'Unit price cannot be negative.');
      lineItems.push({ product_id: Number(productId), quantity: qty, unit_price: price });
    }

    const btn = document.getElementById('saveSaleBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (editingSaleId) {
        await api('/api/sales/' + editingSaleId, {
          method: 'PUT',
          body: { customer_id: Number(customerId), transaction_date: date, line_items: lineItems, notes: document.getElementById('saleNotes').value },
        });
      } else {
        const status = document.querySelector('input[name="saleStatus"]:checked').value;
        const mappedStatus = status === 'Partial' ? 'Partially Paid' : status;
        await api('/api/sales', {
          method: 'POST',
          body: {
            customer_id: Number(customerId), transaction_date: date, line_items: lineItems,
            payment_status: mappedStatus,
            amount_paid: document.getElementById('saleAmountPaid').value,
            payment_date: document.getElementById('salePaymentDate').value,
            payment_method: document.getElementById('salePaymentMethod').value,
            notes: document.getElementById('saleNotes').value,
          },
        });
      }
      closeModal('saleModalOverlay');
      toast('Sale saved.', 'success');
      if (Modals._onSaleSaved) Modals._onSaleSaved();
    } catch (e) {
      showError('saleModalError', e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Save Sale';
    }
  }

  // ============ CUSTOMER MODAL ============
  async function openCustomer(opts) {
    opts = opts || {};
    showError('customerModalError', null);
    document.getElementById('customerModalTitle').textContent = opts.id ? 'Edit Customer' : 'Add New Customer';
    document.getElementById('customerModalOverlay').dataset.editId = opts.id || '';
    document.getElementById('custBusinessName').value = opts.prefillName || '';
    document.getElementById('custContactName').value = '';
    document.getElementById('custPhone').value = '';
    document.getElementById('custEmail').value = '';
    document.getElementById('custAddress').value = '';
    document.getElementById('custPaymentTerms').value = 'COD';
    document.getElementById('custStatus').value = 'active';
    document.getElementById('custNotes').value = '';

    if (opts.id) {
      const data = await api('/api/customers/' + opts.id);
      const c = data.customer;
      document.getElementById('custBusinessName').value = c.business_name || '';
      document.getElementById('custContactName').value = c.contact_name || '';
      document.getElementById('custPhone').value = c.phone || '';
      document.getElementById('custEmail').value = c.email || '';
      document.getElementById('custAddress').value = c.address || '';
      document.getElementById('custPaymentTerms').value = c.payment_terms || 'COD';
      document.getElementById('custStatus').value = c.status || 'active';
      document.getElementById('custNotes').value = c.notes || '';
    }
    Modals._onCustomerSaved = opts.onSaved;
    openModal('customerModalOverlay');
    setTimeout(() => document.getElementById('custBusinessName').focus(), 50);
  }

  async function saveCustomer() {
    showError('customerModalError', null);
    const editId = document.getElementById('customerModalOverlay').dataset.editId;
    const payload = {
      business_name: document.getElementById('custBusinessName').value,
      contact_name: document.getElementById('custContactName').value,
      phone: document.getElementById('custPhone').value,
      email: document.getElementById('custEmail').value,
      address: document.getElementById('custAddress').value,
      payment_terms: document.getElementById('custPaymentTerms').value,
      status: document.getElementById('custStatus').value,
      notes: document.getElementById('custNotes').value,
    };
    const btn = document.getElementById('saveCustomerBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const customer = editId ? await api('/api/customers/' + editId, { method: 'PUT', body: payload })
        : await api('/api/customers', { method: 'POST', body: payload });
      closeModal('customerModalOverlay');
      toast('Customer saved.', 'success');
      if (Modals._onCustomerSaved) Modals._onCustomerSaved(customer);
    } catch (e) {
      showError('customerModalError', e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Save Customer';
    }
  }

  // ============ PRODUCT MODAL ============
  async function openProduct(opts) {
    opts = opts || {};
    showError('productModalError', null);
    document.getElementById('productModalTitle').textContent = opts.id ? 'Edit Product' : 'Add New SKU';
    document.getElementById('productModalOverlay').dataset.editId = opts.id || '';
    document.getElementById('prodSkuCode').value = '';
    document.getElementById('prodSkuCode').disabled = false;
    document.getElementById('prodName').value = opts.prefillName || '';
    document.getElementById('prodCategory').value = '';
    document.getElementById('prodUnit').value = 'Unit';
    document.getElementById('prodPrice').value = '';
    document.getElementById('prodStatus').value = 'active';
    document.getElementById('prodDescription').value = '';

    try {
      const cats = await api('/api/products/categories');
      document.getElementById('categoryList').innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
    } catch (e) { /* ignore */ }

    if (opts.id) {
      const data = await api('/api/products/' + opts.id);
      const p = data.product;
      document.getElementById('prodSkuCode').value = p.sku_code;
      document.getElementById('prodSkuCode').disabled = true;
      document.getElementById('prodName').value = p.product_name;
      document.getElementById('prodCategory').value = p.category || '';
      document.getElementById('prodUnit').value = p.unit_of_measure || 'Unit';
      document.getElementById('prodPrice').value = p.default_price;
      document.getElementById('prodStatus').value = p.status;
      document.getElementById('prodDescription').value = p.description || '';
    }
    Modals._onProductSaved = opts.onSaved;
    openModal('productModalOverlay');
    setTimeout(() => document.getElementById('prodName').focus(), 50);
  }

  async function saveProduct() {
    showError('productModalError', null);
    const editId = document.getElementById('productModalOverlay').dataset.editId;
    const payload = {
      sku_code: document.getElementById('prodSkuCode').value,
      product_name: document.getElementById('prodName').value,
      category: document.getElementById('prodCategory').value,
      unit_of_measure: document.getElementById('prodUnit').value || 'Unit',
      default_price: document.getElementById('prodPrice').value,
      status: document.getElementById('prodStatus').value,
      description: document.getElementById('prodDescription').value,
    };
    const btn = document.getElementById('saveProductBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const product = editId ? await api('/api/products/' + editId, { method: 'PUT', body: payload })
        : await api('/api/products', { method: 'POST', body: payload });
      closeModal('productModalOverlay');
      toast('Product saved.', 'success');
      if (Modals._onProductSaved) Modals._onProductSaved(product);
    } catch (e) {
      showError('productModalError', e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Save Product';
    }
  }

  // ============ PAYMENT MODAL ============
  function openPayment(opts) {
    showError('paymentModalError', null);
    currentPaymentCtx = opts;
    document.getElementById('paymentModalContext').textContent =
      `${opts.transactionCode} — ${opts.customerName || ''} — Outstanding: ${fmtMoney(opts.outstanding)}`;
    document.getElementById('payDate').value = todayStr();
    document.getElementById('payAmount').value = opts.outstanding;
    document.getElementById('payMethod').value = 'Cash';
    document.getElementById('payReference').value = '';
    document.getElementById('payNotes').value = '';
    Modals._onPaymentSaved = opts.onSaved;
    openModal('paymentModalOverlay');
  }

  async function savePayment() {
    showError('paymentModalError', null);
    const amount = Number(document.getElementById('payAmount').value);
    const date = document.getElementById('payDate').value;
    if (!amount || amount <= 0) return showError('paymentModalError', 'Enter a payment amount greater than zero.');
    if (!date) return showError('paymentModalError', 'Select a payment date.');
    const btn = document.getElementById('savePaymentBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await api(`/api/sales/${currentPaymentCtx.transactionId}/payments`, {
        method: 'POST',
        body: {
          payment_date: date, amount, payment_method: document.getElementById('payMethod').value,
          reference_number: document.getElementById('payReference').value, notes: document.getElementById('payNotes').value,
        },
      });
      closeModal('paymentModalOverlay');
      toast('Payment recorded.', 'success');
      if (Modals._onPaymentSaved) Modals._onPaymentSaved();
    } catch (e) {
      showError('paymentModalError', e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Record Payment';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('addLineItemBtn').addEventListener('click', () => addLineItemRow());
    document.getElementById('saveSaleBtn').addEventListener('click', saveSale);
    document.querySelectorAll('input[name="saleStatus"]').forEach(r => r.addEventListener('change', updatePaymentFieldsVisibility));
    document.getElementById('saveCustomerBtn').addEventListener('click', saveCustomer);
    document.getElementById('saveProductBtn').addEventListener('click', saveProduct);
    document.getElementById('savePaymentBtn').addEventListener('click', savePayment);
  });

  return { openSale, openCustomer, openProduct, openPayment, loadCustomers, loadProducts, getCustomersCache: () => customersCache, getProductsCache: () => productsCache };
})();
