const session = require('express-session');

// A minimal express-session store backed by our existing node:sqlite database.
// Avoids pulling in a native session-store package (connect-sqlite3 depends on
// the native `sqlite3` module, which fails to build on some hosts). Sessions
// persist in the same DB file, so they survive app restarts/redeploys.
class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.getStmt = db.prepare('SELECT session, expires FROM sessions WHERE sid = ?');
    this.setStmt = db.prepare('INSERT INTO sessions (sid, session, expires) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET session=excluded.session, expires=excluded.expires');
    this.destroyStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStmt = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
    this.cleanupStmt = db.prepare('DELETE FROM sessions WHERE expires < ?');
    // periodically clear expired sessions
    setInterval(() => {
      try { this.cleanupStmt.run(Date.now()); } catch (_) { /* ignore */ }
    }, 1000 * 60 * 60).unref();
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) { this.destroyStmt.run(sid); return cb(null, null); }
      cb(null, JSON.parse(row.session));
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = (sess.cookie && sess.cookie.maxAge) || 1000 * 60 * 60 * 24 * 14;
      const expires = Date.now() + maxAge;
      this.setStmt.run(sid, JSON.stringify(sess), expires);
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }

  destroy(sid, cb) {
    try { this.destroyStmt.run(sid); cb && cb(null); } catch (err) { cb && cb(err); }
  }

  touch(sid, sess, cb) {
    try {
      const maxAge = (sess.cookie && sess.cookie.maxAge) || 1000 * 60 * 60 * 24 * 14;
      this.touchStmt.run(Date.now() + maxAge, sid);
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }
}

module.exports = SqliteSessionStore;
