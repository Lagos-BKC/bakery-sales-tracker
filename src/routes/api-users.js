const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, status, created_at FROM users ORDER BY name').all();
  res.json(users);
});

router.post('/', requireAdmin, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!['admin', 'staff'].includes(role)) return res.status(400).json({ error: 'Role must be admin or staff.' });
  const dup = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
  if (dup) return res.status(400).json({ error: 'A user with this email already exists.' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)').run(name, email, hash, role);
  logAudit(req, 'user', info.lastInsertRowid, 'create', `Created user ${name} (${role})`);
  res.status(201).json({ id: info.lastInsertRowid, name, email, role, status: 'active' });
});

router.put('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  const { name, role, status, password } = req.body;
  db.prepare('UPDATE users SET name=?, role=?, status=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(name || existing.name, role || existing.role, status || existing.status, req.params.id);
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.params.id);
  }
  logAudit(req, 'user', req.params.id, 'update', `Updated user ${name || existing.name}`);
  res.json(db.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(req.params.id));
});

module.exports = router;
