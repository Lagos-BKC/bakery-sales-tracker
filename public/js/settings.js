let editingUserId = null;

async function loadUsers() {
  let users;
  try { users = await api('/api/users'); } catch (e) { toast(e.message, 'error'); return; }
  document.getElementById('usersBody').innerHTML = users.map(u => `
    <tr>
      <td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="badge ${u.role === 'admin' ? 'badge-admin' : 'badge-staff'}">${u.role === 'admin' ? 'Administrator' : 'Staff'}</span></td>
      <td><span class="badge ${u.status === 'active' ? 'badge-active' : 'badge-inactive'}">${u.status}</span></td>
      <td><button class="btn-icon" data-id="${u.id}" data-name="${escapeHtml(u.name)}" data-role="${u.role}" data-status="${u.status}" title="Edit">✏️</button></td>
    </tr>`).join('');
}

async function loadAudit() {
  let rows;
  try { rows = await api('/api/audit'); } catch (e) { return; }
  document.getElementById('auditBody').innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${new Date(r.changed_at + 'Z').toLocaleString()}</td>
      <td>${escapeHtml(r.changed_by_name || 'system')}</td>
      <td><span class="tag-chip">${escapeHtml(r.action)}</span></td>
      <td>${escapeHtml(r.entity_type)} #${r.entity_id}</td>
      <td>${escapeHtml(r.details || '')}</td>
    </tr>`).join('') : '<tr class="empty-row"><td colspan="5">No activity yet.</td></tr>';
}

function openUserModal(opts) {
  opts = opts || {};
  editingUserId = opts.id || null;
  document.getElementById('userModalError').innerHTML = '';
  document.getElementById('userModalTitle').textContent = editingUserId ? 'Edit User' : 'Add User';
  document.getElementById('userName').value = opts.name || '';
  document.getElementById('userEmail').value = opts.email || '';
  document.getElementById('userEmail').disabled = !!editingUserId;
  document.getElementById('userRole').value = opts.role || 'staff';
  document.getElementById('userStatus').value = opts.status || 'active';
  document.getElementById('userPassword').value = '';
  document.getElementById('userPasswordLabel').textContent = editingUserId ? 'New Password (leave blank to keep current)' : 'Password *';
  openModal('userModalOverlay');
}

async function saveUser() {
  const errEl = document.getElementById('userModalError');
  errEl.innerHTML = '';
  const payload = {
    name: document.getElementById('userName').value,
    email: document.getElementById('userEmail').value,
    role: document.getElementById('userRole').value,
    status: document.getElementById('userStatus').value,
    password: document.getElementById('userPassword').value,
  };
  const btn = document.getElementById('saveUserBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (editingUserId) await api('/api/users/' + editingUserId, { method: 'PUT', body: payload });
    else await api('/api/users', { method: 'POST', body: payload });
    closeModal('userModalOverlay');
    toast('User saved.', 'success');
    loadUsers();
  } catch (e) {
    errEl.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Save User';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!IS_ADMIN) return;
  loadUsers();
  loadAudit();
  document.getElementById('newUserBtn').addEventListener('click', () => openUserModal());
  document.getElementById('saveUserBtn').addEventListener('click', saveUser);
  document.getElementById('usersBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    openUserModal({ id: Number(btn.dataset.id), name: btn.dataset.name, role: btn.dataset.role, status: btn.dataset.status });
  });
});
