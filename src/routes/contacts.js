import { Router } from 'express';
import { pool, tx, audit } from '../db.js';
import { listInvoices, contactCredit } from '../ledger.js';
import { todayIn, fmtDate } from '../money.js';
import { h, field, input, button, form, badge } from '../render.js';
import { page, money } from '../page.js';
import { requireUser, requireRole, once, consumeOnce } from '../auth.js';

export const router = Router();
const write = requireRole('owner', 'staff');

router.get('/contacts', requireUser, async (req, res) => {
  const rows = (await pool.query(`select c.*, (select count(*) from invoices i where i.contact_id = c.id) as invoices, (select count(*) from bills b where b.supplier_id = c.id) as bills from contacts c order by c.name`)).rows;
  page(req, res, { title: 'Contacts', active: '/contacts', body: h`<h1>Contacts <a class="btn" href="/contacts/new">New contact</a></h1>
    ${rows.length ? h`<table><tr><th>Name</th><th>E-mail</th><th>Phone</th><th class="r">Invoices</th><th class="r">Bills</th></tr>${rows.map((c) => h`<tr><td><a href="/contacts/${c.id}">${c.name}</a> ${c.is_sample ? badge('sample', 'muted') : ''}</td><td>${c.email}</td><td>${c.phone}</td><td class="r">${c.invoices}</td><td class="r">${c.bills}</td></tr>`)}</table>` : h`<p class="muted">No contacts yet. Customers and suppliers both live here.</p>`}` });
});
const contactForm = (req, c, action) => form(action, req.user, once(), h`<div class="grid2">${field('Name', input('name', c?.name || '', 'required'))}${field('E-mail', input('email', c?.email || '', 'type="email"'))}
  ${field('Phone', input('phone', c?.phone || ''))}</div>${field('Address (shown on invoices)', h`<textarea name="address" rows="3">${c?.address || ''}</textarea>`)}${field('Notes (private)', input('notes', c?.notes || ''))}${button('Save')}`);
router.get('/contacts/new', write, (req, res) => page(req, res, { title: 'New contact', active: '/contacts', body: h`<h1>New contact</h1>${contactForm(req, null, '/contacts/new')}` }));
router.post('/contacts/new', write, async (req, res) => {
  if (!req.body.name?.trim()) return res.redirect('/contacts/new');
  const id = await tx(async (c) => { if (!(await consumeOnce(c, req))) return null;
    const r = await c.query('insert into contacts (name, email, phone, address, notes) values ($1,$2,$3,$4,$5) returning id', [req.body.name.trim(), req.body.email || '', req.body.phone || '', req.body.address || '', req.body.notes || '']);
    await audit(c, req.user, 'create', 'contact', r.rows[0].id); return r.rows[0].id; });
  res.redirect(id ? `/contacts/${id}` : '/contacts');
});
router.get('/contacts/:id', requireUser, async (req, res) => {
  const c = (await pool.query('select * from contacts where id = $1', [req.params.id])).rows[0]; if (!c) return res.status(404).send('not found');
  const invoices = await listInvoices(pool, { today: todayIn(req.settings.timezone), contactId: c.id }), credit = await contactCredit(pool, c.id);
  const body = h`<p class="crumbs"><a href="/contacts">Contacts</a> › ${c.name}</p><h1>${c.name}</h1>
  <div class="cols"><section><h2>Details</h2>${['owner', 'staff'].includes(req.user.role) ? contactForm(req, c, `/contacts/${c.id}`) : h`<p class="pre">${c.email}\n${c.phone}\n${c.address}</p>`}</section>
  <section><h2>Invoices ${credit ? badge(`credit ${money(req, credit)}`, 'ok') : ''}</h2><p><a class="btn ghost" href="/invoices/new?contact=${c.id}">New invoice</a> <a class="btn ghost" href="/payments/new?contact=${c.id}">Record payment</a></p>
  ${invoices.length ? h`<table><tr><th>Number</th><th>Due</th><th>State</th><th class="r">Balance</th></tr>${invoices.map((i) => h`<tr><td><a href="/invoices/${i.id}">${i.number || `draft #${i.id}`}</a></td><td>${fmtDate(i.due_on)}</td><td>${badge(i.state)} ${i.overdue ? badge('overdue', 'warn') : ''}</td><td class="r">${money(req, i.balance)}</td></tr>`)}</table>` : h`<p class="muted">None.</p>`}</section></div>`;
  page(req, res, { title: c.name, body, active: '/contacts', wide: true });
});
router.post('/contacts/:id', write, async (req, res) => {
  await tx(async (c) => { if (!(await consumeOnce(c, req))) return;
    await c.query('update contacts set name=$2, email=$3, phone=$4, address=$5, notes=$6 where id=$1', [req.params.id, req.body.name?.trim() || 'Unnamed', req.body.email || '', req.body.phone || '', req.body.address || '', req.body.notes || '']);
    await audit(c, req.user, 'update', 'contact', req.params.id); });
  res.redirect(`/contacts/${req.params.id}`);
});
