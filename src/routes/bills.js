import { Router } from 'express';
import { pool, tx, audit } from '../db.js';
import { listBills, loadBill, billState } from '../ledger.js';
import { todayIn, fmtDate, parseMoney, isDate } from '../money.js';
import { h, field, input, select, button, form, badge } from '../render.js';
import { page, money } from '../page.js';
import { requireUser, requireRole, once, consumeOnce, setFlash } from '../auth.js';

export const router = Router();
const write = requireRole('owner', 'staff');
const sb = (b) => h`${badge(b.state, b.state === 'paid' ? 'ok' : b.state === 'void' ? 'muted' : '')} ${b.overdue ? badge('overdue', 'warn') : ''}`;

router.get('/bills', requireUser, async (req, res) => {
  const f = ['all', 'open', 'overdue', 'paid', 'void'].includes(req.query.f) ? req.query.f : 'all';
  const rows = await listBills(pool, { filter: f, today: todayIn(req.settings.timezone) });
  page(req, res, { title: 'Bills', active: '/bills', wide: true, body: h`<h1>Bills <a class="btn" href="/bills/new">New bill</a></h1>
  <p class="tabs">${['all', 'open', 'overdue', 'paid', 'void'].map((x) => h`<a href="/bills?f=${x}" class="${x === f ? 'on' : ''}">${x}</a>`)}</p>
  ${rows.length ? h`<table><tr><th>Due</th><th>Bill</th><th>Supplier</th><th>Category</th><th>State</th><th class="r">Amount</th><th class="r">Balance</th></tr>
  ${rows.map((b) => h`<tr><td>${fmtDate(b.due_on)}</td><td><a href="/bills/${b.id}">${b.description}</a></td><td>${b.supplier_name}</td><td>${b.category_name || ''}</td><td>${sb(b)}</td><td class="r">${money(req, b.amount_cents)}</td><td class="r">${money(req, b.balance)}</td></tr>`)}</table>` : h`<p class="muted">No bills here.</p>`}` });
});
router.get('/bills/new', write, async (req, res) => {
  const contacts = (await pool.query('select id, name from contacts order by name')).rows, cats = (await pool.query(`select id, name from categories where kind = 'expense' order by name`)).rows;
  if (!contacts.length) return page(req, res, { title: 'New bill', body: h`<h1>New bill</h1><p>Add the supplier as a <a href="/contacts/new">contact</a> first.</p>` });
  page(req, res, { title: 'New bill', active: '/bills', body: h`<h1>New bill</h1>${form('/bills/new', req.user, once(), h`<div class="grid2">${field('Supplier', select('supplier_id', contacts.map((c) => [c.id, c.name])))}
    ${field('Category', select('category_id', [['', '—'], ...cats.map((c) => [c.id, c.name])]))}${field('Description', input('description', '', 'required'))}${field('Amount', input('amount', '', 'required inputmode="decimal"'))}
    ${field('Due date', input('due_on', todayIn(req.settings.timezone), 'type="date" required'))}${field('New category (optional)', input('new_category', '', 'placeholder="e.g. Rent"'))}</div>${field('Notes', input('notes'))}${button('Save bill')}`)}` });
});
router.post('/bills/new', write, async (req, res) => {
  const amount = parseMoney(req.body.amount);
  if (Number.isNaN(amount) || amount <= 0 || !isDate(req.body.due_on) || !req.body.description?.trim()) { await setFlash(req, 'warn', 'Check the amount, the due date and the description.'); return res.redirect('/bills/new'); }
  const id = await tx(async (c) => { if (!(await consumeOnce(c, req))) return null;
    let cat = req.body.category_id ? Number(req.body.category_id) : null;
    if (req.body.new_category?.trim()) cat = (await c.query(`insert into categories (name, kind) values ($1,'expense') on conflict (name, kind) do update set name = excluded.name returning id`, [req.body.new_category.trim()])).rows[0].id;
    const r = await c.query('insert into bills (supplier_id, category_id, description, amount_cents, due_on, notes) values ($1,$2,$3,$4,$5,$6) returning id', [Number(req.body.supplier_id), cat, req.body.description.trim(), amount, req.body.due_on, req.body.notes || '']);
    await audit(c, req.user, 'create', 'bill', r.rows[0].id, { amount_cents: amount }); return r.rows[0].id; });
  res.redirect(id ? `/bills/${id}` : '/bills');
});
router.get('/bills/:id', requireUser, async (req, res) => {
  const b = await loadBill(pool, req.params.id); if (!b) return res.status(404).send('not found');
  const st = billState(b, todayIn(req.settings.timezone)), canWrite = ['owner', 'staff'].includes(req.user.role);
  page(req, res, { title: b.description, active: '/bills', body: h`<p class="crumbs"><a href="/bills">Bills</a> › ${b.description} ${sb({ ...b, ...st })}</p><h1>${b.description}</h1>
  <table><tr><th>Supplier</th><td>${b.supplier_name}</td></tr><tr><th>Category</th><td>${b.category_name || '—'}</td></tr><tr><th>Due</th><td>${fmtDate(b.due_on)}</td></tr><tr><th>Amount</th><td>${money(req, b.amount_cents)}</td></tr><tr><th>Paid</th><td>${money(req, b.paid_cents)}</td></tr><tr><th>Balance</th><td><b>${money(req, st.balance)}</b></td></tr>${b.notes ? h`<tr><th>Notes</th><td>${b.notes}</td></tr>` : ''}</table>
  <h2>Payments</h2>${b.payments.length ? h`<table><tr><th>Date</th><th>Method</th><th>Notes</th><th class="r">Amount</th></tr>${b.payments.map((p) => h`<tr><td>${fmtDate(p.paid_on)}</td><td>${p.method}</td><td>${p.notes}</td><td class="r">${money(req, p.amount_cents)}</td></tr>`)}</table>` : h`<p class="muted">None yet.</p>`}
  ${canWrite && b.status === 'open' && st.balance > 0 ? h`<h3>Record a payment on this bill</h3>${form(`/bills/${b.id}/pay`, req.user, once(), h`<div class="grid2">${field('Amount', input('amount', (st.balance / 100).toFixed(2), 'required inputmode="decimal"'))}${field('Date', input('paid_on', todayIn(req.settings.timezone), 'type="date" required'))}
    ${field('Method', select('method', [['bank transfer', 'Bank transfer'], ['card', 'Card'], ['cash', 'Cash'], ['check', 'Check'], ['other', 'Other']]))}${field('Notes', input('notes'))}</div>${button('Save payment')}`)}` : ''}
  ${canWrite && b.status === 'open' && !b.payments.length ? form(`/bills/${b.id}/void`, req.user, once(), button('Void this bill', 'btn danger'), 'class="mt" onsubmit="return confirm(\'Void this bill?\')"') : ''}` });
});
router.post('/bills/:id/pay', write, async (req, res) => {
  const amount = parseMoney(req.body.amount);
  if (Number.isNaN(amount) || amount <= 0 || !isDate(req.body.paid_on)) { await setFlash(req, 'warn', 'Check the amount and the date.'); return res.redirect(`/bills/${req.params.id}`); }
  await tx(async (c) => { if (!(await consumeOnce(c, req))) return;
    const b = (await c.query(`select status from bills where id = $1 for update`, [req.params.id])).rows[0]; if (!b || b.status !== 'open') throw Object.assign(new Error('This bill is not open.'), { status: 409 });
    await c.query('insert into bill_payments (bill_id, amount_cents, paid_on, method, notes, created_by) values ($1,$2,$3,$4,$5,$6)', [req.params.id, amount, req.body.paid_on, req.body.method || '', req.body.notes || '', req.user.id]);
    await audit(c, req.user, 'bill-paid', 'bill', req.params.id, { amount_cents: amount }); });
  res.redirect(`/bills/${req.params.id}`);
});
router.post('/bills/:id/void', write, async (req, res) => {
  await tx(async (c) => { if (!(await consumeOnce(c, req))) return;
    const r = await c.query(`update bills set status = 'void' where id = $1 and status = 'open' and not exists (select 1 from bill_payments where bill_id = $1) returning id`, [req.params.id]);
    if (r.rows[0]) await audit(c, req.user, 'void', 'bill', req.params.id); });
  res.redirect(`/bills/${req.params.id}`);
});
