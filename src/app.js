require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');

const db = require('./db');
const SqliteSessionStore = require('./utils/sqliteSessionStore');
const { requireLogin, requireAdmin } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(session({
  store: new SqliteSessionStore(db),
  secret: process.env.SESSION_SECRET || 'bakery-sales-tracker-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 14 },
}));

// Make current user + active nav available to all views
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.path = req.path;
  next();
});

app.use('/', require('./routes/auth'));

// Page routes (server-rendered shells; data loaded client-side via /api)
app.get('/', requireLogin, (req, res) => res.render('dashboard', { title: 'Dashboard' }));
app.get('/sales', requireLogin, (req, res) => res.render('sales', { title: 'Sales' }));
app.get('/customers', requireLogin, (req, res) => res.render('customers', { title: 'Customers' }));
app.get('/customers/:id', requireLogin, (req, res) => res.render('customer-detail', { title: 'Customer Profile', customerId: req.params.id }));
app.get('/products', requireLogin, (req, res) => res.render('products', { title: 'Products / SKUs' }));
app.get('/payments', requireLogin, (req, res) => res.render('payments', { title: 'Payments / Receivables' }));
app.get('/reports', requireLogin, (req, res) => res.render('reports', { title: 'Reports' }));
app.get('/settings', requireLogin, (req, res) => res.render('settings', { title: 'Settings' }));

// JSON APIs
app.use('/api/customers', requireLogin, require('./routes/api-customers'));
app.use('/api/products', requireLogin, require('./routes/api-products'));
app.use('/api/sales', requireLogin, require('./routes/api-sales'));
app.use('/api/dashboard', requireLogin, require('./routes/api-dashboard'));
app.use('/api/receivables', requireLogin, require('./routes/api-receivables'));
app.use('/api/reports', requireLogin, require('./routes/api-reports'));
app.use('/api/export', requireLogin, require('./routes/api-export'));
app.use('/api/users', requireLogin, require('./routes/api-users'));
app.use('/api/audit', requireLogin, require('./routes/api-audit'));

app.get('/api/session', (req, res) => res.json({ user: req.session.user || null }));

app.use((req, res) => res.status(404).render('error', { message: 'Page not found', user: req.session.user }));

app.listen(PORT, () => {
  console.log(`Bakery Sales Tracker running on port ${PORT}`);
});
