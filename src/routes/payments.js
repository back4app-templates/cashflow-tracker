import { Router } from 'express';
import { pool, tx } from '../db.js';
import { recordPayment, deletePayment, loadInvoice, contactCredit, invoiceState } from '../ledger.js';
import { todayIn, fmtDate, parseMoney } from '../money.js';
import { h, field, input, select, hidden, button, form, badge } from '../render.js';
import { page, money } from '../page.js';
import { requireUser, requireRole, once, consumeOnce, setFlash } from '../auth.js';

export const router = Router();
const write = requireRole('owner', 'staff');

router.get('/payments', requireUser, async (req, res) => {
  const rows = (await pool.query(`select p.*, c.name as contact_name, u.name as by_name,
    coalesce((select sum(amount_cents) from allocations a where a.payment_id = p.id),0)::bigint as allocated_cents,
    (select string_agg(i.number, ', ') from allocations a join invoices i on i.id = a.invoice_id where a.payment_id = p.id) as invoices
    from payments p join contacts c on c.id = p.contact_id left join users u on u.id = p.created_by order by p.paid_on desc, p.id desc limit 500`)).rows;
  const body = h`<h1>Payments <a class="btn" href="/payments/new">Record a payment</a></h1><p class="muted">Cash movements, in and out of your contacts. Allocation to invoices is shown on the right; the total received is the sum of this list, never of allocations.</p>
  ${rows.length ? h`<table><tr><th>Date</th><th>Contact</th><th>Direction</th><th>Method</th><th class="r">Amount</th><th>Applied to</th></tr>
  ${rows.map((p) => h`<tr><td>${fmtDate(p.paid_on)}</td><td>${p.contact_name}</td><td>${p.direction === 'refunded' ? badge('refund', 'warn') : badge('received', 'ok')}</td><td>${p.method}</td><td class="r"><a href="/payments/${p.id}">${money(req, p.amount_cents)}</a></td>
    <td>${p.invoices || h`<span class="muted">${p.direction === 'received' ? 'credit' : '—'}</span>`}${Number(p.allocated_cents) && Number(p.allocated_cents) < Number(p.amount_cents) ? h` <span class="muted">(+${money(req, p.amount_cents - p.allocated_cents)} credit)</span>` : ''}</td></tr>`)}</table>` : h`<p class="muted">No payments yet.</p>`}`;
  page(req, res, { title: 'Payments', body, active: '/payments', wide: true });
});

router.get('/payments/new', write, async (req, res) => {
  const contacts = (await pool.query('select id, name from contacts order by name')).rows;
  const inv = req.query.invoice ? await loadInvoice(pool, req.query.invoice) : null;
  const st = inv ? invoiceState(inv, todayIn(req.settings.timezone)) : null;
  const body = h`<h1>Record a payment</h1>${inv ? h`<p>For invoice <a href="/invoices/${inv.id}">${inv.number}</a> (${inv.contact_name}), balance ${money(req, st.balance)}. Anything above the balance stays as credit for ${inv.contact_name}.</p>` : ''}
  ${form('/payments/new', req.user, once(), h`${inv ? hidden('invoice_id', inv.id) : ''}
  <div class="grid2">${field('Contact', inv ? h`${hidden('contact_id', inv.contact_id)}<input value="${inv.contact_name}" disabled>` : select('contact_id', contacts.map((c) => [c.id, c.name]), req.query.contact))}
  ${field('Direction', select('direction', [['received', 'Received (money in)'], ['refunded', 'Refunded (money out)']], 'received'))}
  ${field('Amount', input('amount', inv ? (st.balance / 100).toFixed(2) : '', 'required inputmode="decimal"'))}${field('Date', input('paid_on', todayIn(req.settings.timezone), 'type="date" required'))}
  ${field('Method', select('method', [['bank transfer', 'Bank transfer'], ['card', 'Card'], ['cash', 'Cash'], ['check', 'Check'], ['other', 'Other']]))}${field('Reference (optional)', input('reference'))}</div>
  ${field('Notes', input('notes'))}${button('Save payment')} <a class="btn ghost" href="${inv ? `/invoices/${inv.id}` : '/payments'}">Cancel</a>`)}`;
  page(req, res, { title: 'Record a payment', body, active: '/payments' });
});
router.post('/payments/new', write, async (req, res) => {
  const amountCents = parseMoney(req.body.amount);
  const invoiceId = req.body.invoice_id ? Number(req.body.invoice_id) : null;
  const out = await tx(async (c) => (await consumeOnce(c, req)) ? recordPayment(c, { contactId: Number(req.body.contact_id), direction: req.body.direction === 'refunded' ? 'refunded' : 'received', amountCents, paidOn: req.body.paid_on,
    method: String(req.body.method || ''), reference: String(req.body.reference || ''), notes: String(req.body.notes || ''), invoiceId }, req.user) : null);
  if (out) await setFlash(req, 'ok', out.credit && invoiceId ? `Payment saved: ${money(req, out.allocated)} applied, ${money(req, out.credit)} kept as credit.` : 'Payment saved.');
  res.redirect(invoiceId ? `/invoices/${invoiceId}` : '/payments');
});
router.get('/payments/:id', requireUser, async (req, res) => {
  const p = (await pool.query(`select p.*, c.name as contact_name from payments p join contacts c on c.id = p.contact_id where p.id = $1`, [req.params.id])).rows[0];
  if (!p) return res.status(404).send('not found');
  const allocs = (await pool.query(`select a.*, i.number from allocations a join invoices i on i.id = a.invoice_id where a.payment_id = $1`, [p.id])).rows;
  const body = h`<p class="crumbs"><a href="/payments">Payments</a> › #${p.id}</p><h1>${p.direction === 'refunded' ? 'Refund' : 'Payment'} of ${money(req, p.amount_cents)}</h1>
  <table><tr><th>Contact</th><td>${p.contact_name}</td></tr><tr><th>Date</th><td>${fmtDate(p.paid_on)}</td></tr><tr><th>Method</th><td>${p.method}</td></tr><tr><th>Reference</th><td>${p.reference}</td></tr><tr><th>Notes</th><td>${p.notes}</td></tr>
  <tr><th>Applied to</th><td>${allocs.length ? allocs.map((a) => h`<a href="/invoices/${a.invoice_id}">${a.number}</a> ${money(req, a.amount_cents)}<br>`) : h`<span class="muted">nothing — it is credit on the contact</span>`}</td></tr></table>
  ${req.user.role === 'owner' ? form(`/payments/${p.id}/delete`, req.user, once(), button('Delete this payment', 'btn danger'), 'onsubmit="return confirm(\'Delete this payment? Its allocations are removed too.\')"') : ''}`;
  page(req, res, { title: `Payment #${p.id}`, body, active: '/payments' });
});
router.post('/payments/:id/delete', requireRole('owner'), async (req, res) => {
  await tx(async (c) => { if (await consumeOnce(c, req)) await deletePayment(c, Number(req.params.id), req.user); });
  await setFlash(req, 'ok', 'Payment deleted (recorded in the audit log).');
  res.redirect('/payments');
});
