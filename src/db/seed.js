// Seeds realistic sample data for first-run / demo purposes.
// Safe to run multiple times: it skips seeding if data already exists.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const db = require('./index');
const { computeDueDate, derivePaymentStatus, computeOutstanding, round2 } = require('../utils/calc');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260831);
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
function randInt(min, max) { return Math.floor(rand() * (max - min + 1)) + min; }
function chance(p) { return rand() < p; }

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'dolapoafolabi04@yahoo.co.uk';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || 'TD';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Bakery2026!';

const PRODUCTS = [
  ['BFB-001', 'Butter Filled Bread', 'Bread', 5.00, 'Loaf'],
  ['WB-002', 'White Bread', 'Bread', 4.00, 'Loaf'],
  ['WWB-003', 'Whole Wheat Bread', 'Bread', 4.50, 'Loaf'],
  ['BB-004', 'Butter Bread', 'Bread', 5.00, 'Loaf'],
  ['SRD-017', 'Sourdough Loaf', 'Bread', 6.50, 'Loaf'],
  ['BAG-009', 'Plain Bagels', 'Bread', 3.00, 'Half Dozen'],
  ['DR-005', 'Dinner Rolls', 'Rolls', 6.00, 'Dozen'],
  ['BUN-015', 'Hamburger Buns', 'Rolls', 5.50, 'Dozen'],
  ['BUN-016', 'Hot Dog Buns', 'Rolls', 5.50, 'Dozen'],
  ['CR-006', 'Cinnamon Rolls', 'Pastries', 8.00, 'Half Dozen'],
  ['CROI-007', 'Butter Croissant', 'Pastries', 3.50, 'Piece'],
  ['CHOC-008', 'Chocolate Croissant', 'Pastries', 4.00, 'Piece'],
  ['MUF-010', 'Blueberry Muffins', 'Pastries', 12.00, 'Dozen'],
  ['DOU-011', 'Glazed Doughnuts', 'Pastries', 9.00, 'Dozen'],
  ['CAKE-012', 'Vanilla Sponge Cake', 'Cakes', 22.00, 'Whole'],
  ['CAKE-013', 'Chocolate Fudge Cake', 'Cakes', 25.00, 'Whole'],
  ['CUP-014', 'Assorted Cupcakes', 'Cakes', 18.00, 'Dozen'],
  ['PIE-018', 'Meat Pie', 'Specialty', 4.50, 'Piece'],
];

const CUSTOMERS = [
  ['ABC Grocery', 'Adaeze Okafor', 'Net 30'],
  ['Golden Spoon Café', 'Marcus Lee', 'Net 15'],
  ['Riverside Hotel', 'Priya Sharma', 'Net 60'],
  ['Corner Deli', 'Tom Reyes', 'COD'],
  ['Sunshine Diner', 'Ella Brooks', 'Net 15'],
  ['Maple Leaf Market', 'James Wu', 'Net 30'],
  ['Downtown Bistro', 'Sofia Moretti', 'Net 7'],
  ['Harvest Foods', 'Nathan Cole', 'Net 30'],
  ['Lakeside Restaurant', 'Ingrid Voss', 'Net 15'],
  ['Fresh Mart', 'Devon Clarke', 'COD'],
  ['City Catering Co.', 'Renee Foster', 'Net 30'],
  ['Blue Ridge Coffee House', 'Owen Bailey', 'Net 7'],
  ['Sunrise Bakery Outlet', 'Grace Kim', 'Net 15'],
  ['Green Valley Supermarket', 'Victor Nguyen', 'Net 30'],
  ['Uptown Eatery', 'Chloe Bennett', 'Net 7'],
  ['Family Foods Grocers', 'Malik Johnson', 'Net 60'],
];

// Customers we intentionally make chronically slow-paying, for a realistic aging report
const SLOW_PAYERS = new Set(['Riverside Hotel', 'Family Foods Grocers', 'City Catering Co.']);

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount === 0) {
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
      .run(ADMIN_NAME, ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10), 'admin');
    console.log(`Created admin user: ${ADMIN_EMAIL}`);
  }
  const adminId = db.prepare('SELECT id FROM users WHERE role = ? ORDER BY id LIMIT 1').get('admin').id;

  const productCount = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  if (productCount > 0) {
    console.log('Sample data already present — skipping seed.');
    return;
  }

  console.log('Seeding products…');
  const insertProduct = db.prepare(`
    INSERT INTO products (sku_code, product_name, category, default_price, unit_of_measure, status) VALUES (?,?,?,?,?, 'active')
  `);
  const productIds = PRODUCTS.map(p => insertProduct.run(...p).lastInsertRowid);

  console.log('Seeding customers…');
  const insertCustomer = db.prepare(`
    INSERT INTO customers (customer_code, business_name, contact_name, phone, email, address, payment_terms, status)
    VALUES (?,?,?,?,?,?,?, 'active')
  `);
  const customers = CUSTOMERS.map((c, i) => {
    const code = 'CUST-' + String(i + 1).padStart(4, '0');
    const id = insertCustomer.run(
      code, c[0], c[1],
      `(416) 555-${String(1000 + i * 7).slice(-4)}`,
      c[1].toLowerCase().replace(/\s+/g, '.') + '@' + c[0].toLowerCase().replace(/[^a-z]+/g, '') + '.com',
      `${100 + i} Main Street, Toronto, ON`,
      c[2]
    ).lastInsertRowid;
    return { id, business_name: c[0], payment_terms: c[2], slow: SLOW_PAYERS.has(c[0]) };
  });

  console.log('Seeding sales transactions…');
  const insertTxn = db.prepare(`
    INSERT INTO sales_transactions
      (transaction_code, customer_id, transaction_date, transaction_total, amount_paid, outstanding_amount,
       payment_status, due_date, payment_date, payment_method, notes, created_by, updated_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertLine = db.prepare(`INSERT INTO sales_line_items (transaction_id, product_id, quantity, unit_price, line_total) VALUES (?,?,?,?,?)`);
  const insertPayment = db.prepare(`
    INSERT INTO payments (transaction_id, payment_date, amount, payment_method, reference_number, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)
  `);

  const methods = ['Cash', 'E-transfer', 'Cheque', 'Credit/Debit', 'Bank Transfer'];
  const today = dayjs();
  const startDate = today.subtract(150, 'day');
  let txnSeq = 1;

  const runAll = db.transaction(() => {
    for (let d = startDate; d.isBefore(today) || d.isSame(today, 'day'); d = d.add(1, 'day')) {
      // fewer orders on Sundays
      const isSunday = d.day() === 0;
      const numOrdersToday = isSunday ? randInt(0, 2) : randInt(1, 5);
      const daysAgo = today.diff(d, 'day');

      for (let o = 0; o < numOrdersToday; o++) {
        const customer = pick(customers);
        const numLines = randInt(1, 4);
        const usedProducts = new Set();
        const lines = [];
        let total = 0;
        for (let l = 0; l < numLines; l++) {
          let idx = randInt(0, PRODUCTS.length - 1);
          let guard = 0;
          while (usedProducts.has(idx) && guard++ < 10) idx = randInt(0, PRODUCTS.length - 1);
          usedProducts.add(idx);
          const [, , , defaultPrice] = PRODUCTS[idx];
          const qty = randInt(3, 30);
          // occasional manual price override (+/- up to 8%)
          const price = chance(0.12) ? round2(defaultPrice * (1 + (rand() - 0.5) * 0.16)) : defaultPrice;
          const lineTotal = round2(qty * price);
          total = round2(total + lineTotal);
          lines.push({ product_id: productIds[idx], quantity: qty, unit_price: price, line_total: lineTotal });
        }

        const dueDate = computeDueDate(d.format('YYYY-MM-DD'), customer.payment_terms);
        const termsDays = dayjs(dueDate).diff(d, 'day');

        // Decide payment behaviour
        let paid = 0;
        let paymentEvents = [];
        const isVeryRecent = daysAgo <= 2;
        const pastDue = today.isAfter(dayjs(dueDate));

        if (isVeryRecent) {
          // freshly entered sales: mostly unpaid or paid same day
          if (chance(0.4)) { paid = total; paymentEvents.push({ amount: total, offset: 0 }); }
          else if (chance(0.15)) { const p = round2(total * pick([0.3, 0.5, 0.6])); paid = p; paymentEvents.push({ amount: p, offset: 0 }); }
        } else if (customer.slow && chance(0.45)) {
          // chronic slow payer: leave a good chunk unpaid or partially paid, especially if past due
          if (chance(0.5)) {
            const p = round2(total * pick([0.2, 0.35, 0.5])); paid = p; paymentEvents.push({ amount: p, offset: randInt(2, 10) });
          } // else fully outstanding
        } else if (pastDue) {
          // normal customers mostly settle once past due, but leave a small tail outstanding
          if (chance(0.85)) {
            paid = total; paymentEvents.push({ amount: total, offset: randInt(0, termsDays + 5) });
          } else if (chance(0.5)) {
            const p = round2(total * pick([0.4, 0.6, 0.75])); paid = p; paymentEvents.push({ amount: p, offset: randInt(0, termsDays + 5) });
          }
        } else {
          // not yet due: some prepay, most wait
          if (chance(0.3)) { paid = total; paymentEvents.push({ amount: total, offset: randInt(0, Math.max(1, termsDays - 1)) }); }
        }

        paid = round2(Math.min(paid, total));
        const outstanding = computeOutstanding(total, paid);
        const status = derivePaymentStatus(total, paid);
        const code = 'TXN-' + String(txnSeq++).padStart(6, '0');
        const lastPaymentDate = paymentEvents.length ? d.add(paymentEvents[paymentEvents.length - 1].offset, 'day').format('YYYY-MM-DD') : null;
        const method = paymentEvents.length ? pick(methods) : null;

        const info = insertTxn.run(
          code, customer.id, d.format('YYYY-MM-DD'), total, paid, outstanding, status, dueDate,
          paid > 0 ? lastPaymentDate : null, method, null, adminId, adminId,
          d.format('YYYY-MM-DD HH:mm:ss'), d.format('YYYY-MM-DD HH:mm:ss')
        );
        const txnId = info.lastInsertRowid;
        for (const l of lines) insertLine.run(txnId, l.product_id, l.quantity, l.unit_price, l.line_total);
        for (const pe of paymentEvents) {
          const payDate = d.add(pe.offset, 'day').isAfter(today) ? today.format('YYYY-MM-DD') : d.add(pe.offset, 'day').format('YYYY-MM-DD');
          insertPayment.run(txnId, payDate, pe.amount, pick(methods), null, null, adminId, payDate + ' 12:00:00');
        }
      }
    }
  });
  runAll();

  const txnTotal = db.prepare('SELECT COUNT(*) c FROM sales_transactions').get().c;
  console.log(`Seed complete: ${customers.length} customers, ${PRODUCTS.length} products, ${txnTotal} transactions.`);
}

seed();
