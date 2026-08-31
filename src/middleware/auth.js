function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ error: 'Administrator access required' });
  return res.status(403).render('error', { message: 'Administrator access required', user: req.session.user });
}

module.exports = { requireLogin, requireAdmin };
