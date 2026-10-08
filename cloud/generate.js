// File: cloud/generate.js · shared by Cloud Code (demo reseed job) and scripts/generate-demo-data.mjs
// Deterministic fictitious dataset for an invented company, "Bluefin Studio, LLC". Every name is invented.
// Amounts are integer cents. Dates are YYYY-MM-DD strings. Nothing here comes from real books.
'use strict';

const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300',
  '#4a3aa7', '#e34948', '#0e7c86', '#9c6b2f', '#7a8794', '#c0392b'];

const ACCOUNTS = [
  { name: 'Operating checking', openingBalance: 4825000, currency: 'USD' },
  { name: 'Payroll', openingBalance: 1200000, currency: 'USD' },
  { name: 'Savings reserve', openingBalance: 7500000, currency: 'USD' },
];

const CATEGORIES = ['Subscriptions', 'Services', 'Salaries', 'Contractors', 'Cloud hosting', 'SaaS tools',
  'Marketing', 'Legal & accounting', 'Office', 'Travel', 'Taxes', 'Bank fees']
  .map((name, i) => ({ name, color: PALETTE[i % PALETTE.length] }));

const CLIENTS = ['Harbor Lane Coffee', 'Northwind Dental', 'Pinecrest Realty', 'Alder & Finch Law', 'Summit Yoga Co.',
  'Blue Door Bakery', 'Granite Peak Outfitters', 'Lumen Pediatrics'];
const CONTRACTORS = ['Mara Okonjo (design)', 'Teo Lindqvist (QA)', 'Priya Raman (content)'];
const SAAS = [['Figma team plan', 7500], ['GitHub Team', 4800], ['Linear', 2400], ['Notion', 3200], ['1Password Business', 1596]];
const MARKETING = ['Google Ads', 'LinkedIn sponsored posts', 'Podcast sponsorship', 'Conference booth deposit'];
const TRAVEL = ['Flight to client workshop', 'Hotel — 2 nights', 'Train tickets', 'Per diem'];
const OFFICE = ['Coworking desk × 3', 'Office supplies', 'Internet', 'Coffee & snacks'];

// mulberry32: small, deterministic, good enough for sample data.
function prng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m is 1-based

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function monthsBack(y, m, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    let yy = y, mm = m - i;
    while (mm <= 0) { mm += 12; yy -= 1; }
    out.push([yy, mm]);
  }
  return out;
}

/**
 * generate({ referenceDate, months = 6, seed = 20260930, size = 'default' })
 * Returns { accounts, categories, transactions } with account/category NAMES (ids are assigned at seed time).
 * Rules of the dataset:
 *  - everything with dueDate <= referenceDate is paid, except a handful left pending (so Overdue shows up);
 *  - everything with dueDate > referenceDate is pending (so Pending and projected balances show up);
 *  - transfers are always paid on their due date.
 */
function generate(opts = {}) {
  const referenceDate = opts.referenceDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate || '')) throw new Error('referenceDate must be YYYY-MM-DD');
  const months = opts.months || 6;
  const rnd = prng(opts.seed || 20260930);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const [ry, rm] = referenceDate.split('-').map(Number);

  const tx = [];
  const push = (t) => tx.push(t);
  const paidIfDue = (due) => (due <= referenceDate ? due : null);

  let payoutBase = 820000;   // grows ~4% a month
  const monthList = monthsBack(ry, rm, months);

  monthList.forEach(([y, m], mi) => {
    const last = daysIn(y, m);
    const first = iso(y, m, 1);

    // Weekly Stripe payouts (Subscriptions) every Tuesday.
    for (let d = 1; d <= last; d++) {
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if (dow === 2) {
        const amount = Math.round(payoutBase * (0.9 + rnd() * 0.2));
        const due = iso(y, m, d);
        push({ type: 'income', description: 'Stripe payout', amount, accrualDate: due, dueDate: due,
          paidDate: paidIfDue(due), account: 'Operating checking', category: 'Subscriptions', contact: 'Stripe' });
      }
    }
    payoutBase = Math.round(payoutBase * 1.04);

    // 2–3 service invoices, net 30. Some stay unpaid past due.
    const invoices = between(2, 3);
    for (let i = 0; i < invoices; i++) {
      const issued = iso(y, m, between(2, 20));
      const due = addDays(issued, 30);
      const amount = between(180000, 950000);
      const overdue = due <= referenceDate && rnd() < 0.18;
      push({ type: 'income', description: `Invoice #${y}${pad(m)}-${pad(i + 1)} — ${pick(['website redesign', 'brand kit', 'quarterly retainer', 'app prototype'])}`,
        amount, accrualDate: issued, dueDate: due, paidDate: overdue ? null : paidIfDue(due),
        account: 'Operating checking', category: 'Services', contact: pick(CLIENTS) });
    }

    // Payroll: top up Payroll account on the 14th and the day before month end, pay salaries on 15th and last day.
    const salaryRun = 2460000 + mi * 20000;
    for (const [topDay, payDay] of [[14, 15], [last - 1, last]]) {
      const topUp = iso(y, m, topDay);
      push({ type: 'transfer', description: 'Payroll top-up', amount: salaryRun, accrualDate: topUp, dueDate: topUp,
        paidDate: topUp, account: 'Operating checking', toAccount: 'Payroll' });
      const pay = iso(y, m, payDay);
      push({ type: 'expense', description: 'Salaries — team of 6', amount: salaryRun, accrualDate: pay, dueDate: pay,
        paidDate: paidIfDue(pay), account: 'Payroll', category: 'Salaries', contact: 'Gusto' });
    }

    // Contractors: two invoices a month, net 15; one may be overdue.
    for (let i = 0; i < 2; i++) {
      const issued = iso(y, m, between(3, 25));
      const due = addDays(issued, 15);
      const overdue = due <= referenceDate && rnd() < 0.12;
      push({ type: 'expense', description: 'Contractor invoice', amount: between(120000, 420000), accrualDate: issued,
        dueDate: due, paidDate: overdue ? null : paidIfDue(due), account: 'Operating checking', category: 'Contractors',
        contact: pick(CONTRACTORS) });
    }

    // Fixed monthly costs.
    push({ type: 'expense', description: 'Cloud hosting — Back4app + CDN', amount: between(38000, 52000), accrualDate: first,
      dueDate: iso(y, m, 3), paidDate: paidIfDue(iso(y, m, 3)), account: 'Operating checking', category: 'Cloud hosting', contact: 'Back4app' });
    for (const [desc, amount] of SAAS.slice(0, 3 + (mi % 2))) {
      const due = iso(y, m, between(4, 9));
      push({ type: 'expense', description: desc, amount, accrualDate: due, dueDate: due, paidDate: paidIfDue(due),
        account: 'Operating checking', category: 'SaaS tools', contact: desc.split(' ')[0] });
    }
    for (let i = 0; i < between(1, 2); i++) {
      const due = iso(y, m, between(5, 27));
      push({ type: 'expense', description: pick(MARKETING), amount: between(45000, 260000), accrualDate: due, dueDate: due,
        paidDate: paidIfDue(due), account: 'Operating checking', category: 'Marketing', contact: '' });
    }
    for (let i = 0; i < 2; i++) {
      const due = iso(y, m, between(2, 26));
      push({ type: 'expense', description: pick(OFFICE), amount: between(9000, 95000), accrualDate: due, dueDate: due,
        paidDate: paidIfDue(due), account: 'Operating checking', category: 'Office', contact: '' });
    }
    if (rnd() < 0.6) {
      const due = iso(y, m, between(6, 24));
      push({ type: 'expense', description: pick(TRAVEL), amount: between(18000, 140000), accrualDate: due, dueDate: due,
        paidDate: paidIfDue(due), account: 'Operating checking', category: 'Travel', contact: '' });
    }
    const feeDay = iso(y, m, last);
    push({ type: 'expense', description: 'Monthly account fee', amount: 1500, accrualDate: feeDay, dueDate: feeDay,
      paidDate: paidIfDue(feeDay), account: 'Operating checking', category: 'Bank fees', contact: 'Bank' });

    // Quarterly: legal & accounting, estimated taxes.
    if (m % 3 === 0) {
      const due = iso(y, m, 20);
      push({ type: 'expense', description: 'Quarterly bookkeeping & filing', amount: between(90000, 160000), accrualDate: due,
        dueDate: due, paidDate: paidIfDue(due), account: 'Operating checking', category: 'Legal & accounting', contact: 'Alder & Finch Law' });
      const taxDue = iso(y, m, 15);
      push({ type: 'expense', description: 'Estimated tax payment', amount: between(600000, 980000), accrualDate: taxDue,
        dueDate: taxDue, paidDate: paidIfDue(taxDue), account: 'Operating checking', category: 'Taxes', contact: 'IRS' });
    }

    // Monthly transfer to reserve.
    const save = iso(y, m, between(24, 27));
    push({ type: 'transfer', description: 'Move to reserve', amount: 500000, accrualDate: save, dueDate: save,
      paidDate: save, account: 'Operating checking', toAccount: 'Savings reserve' });
  });

  // Next-month items already known (pending): hosting, a contractor invoice, two client invoices.
  const [ny, nm] = rm === 12 ? [ry + 1, 1] : [ry, rm + 1];
  const nextHosting = iso(ny, nm, 3);
  push({ type: 'expense', description: 'Cloud hosting — Back4app + CDN', amount: 49000, accrualDate: iso(ny, nm, 1),
    dueDate: nextHosting, paidDate: null, account: 'Operating checking', category: 'Cloud hosting', contact: 'Back4app' });
  push({ type: 'income', description: `Invoice #${ny}${pad(nm)}-01 — onboarding package`, amount: 640000,
    accrualDate: iso(ry, rm, 28), dueDate: iso(ny, nm, 27), paidDate: null, account: 'Operating checking',
    category: 'Services', contact: pick(CLIENTS) });

  // Large profile: a burst of micro-transactions in the reference month, to exceed every list limit.
  if (opts.size === 'large') {
    const per = opts.perDay || 120;
    const last = daysIn(ry, rm);
    for (let d = 1; d <= last; d++) {
      for (let i = 0; i < per; i++) {
        const due = iso(ry, rm, d);
        push({ type: 'expense', description: `Card purchase #${d}-${i}`, amount: between(100, 9900), accrualDate: due,
          dueDate: due, paidDate: paidIfDue(due), account: 'Operating checking', category: pick(['Office', 'Travel', 'SaaS tools']), contact: '' });
      }
    }
  }

  for (const t of tx) {
    if (!t.contact) delete t.contact;
    t.notes = '';
  }
  return { referenceDate, accounts: ACCOUNTS.map((a) => ({ ...a })), categories: CATEGORIES.map((c) => ({ ...c })), transactions: tx };
}

module.exports = { generate, PALETTE };
