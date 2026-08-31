const db = require('../db');

function logAudit(req, entityType, entityId, action, details) {
  const user = req.session && req.session.user;
  db.prepare(`
    INSERT INTO audit_log (entity_type, entity_id, action, changed_by, changed_by_name, details)
    VALUES (?,?,?,?,?,?)
  `).run(entityType, entityId, action, user ? user.id : null, user ? user.name : 'system', details || null);
}

module.exports = { logAudit };
