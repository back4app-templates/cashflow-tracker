import { Router } from 'express';
import { pool, tx, audit } from '../db.js';
import { loadInvoice, listInvoices, computeLines, saveDraft, issueInvoice, voidInvoice, markSent, setShareToken, contactCredit, applyCredit, invoiceState } from '../ledger.js';
import { todayIn, fmtDate, fmtQty, fmtRate, parseMoney, isDate, fmtMoney } from '../money.js';
import { h, raw, field, input, select, hidden, button, form, badge } from '../render.js';
import { page, barePage, money } from '../page.js';
import { requireUser, requireRole, once, consumeOnce, setFlash } from '../auth.js';

export const router = Router();
const write = requireRole('owner', 'staff');
const stateBadge = (i) => h`${badge(i.state, i.state === 'paid' ? 'ok' : i.state === 'void' ? 'muted' : '')} ${i.overdue ? badge('overdue', 'warn') : ''}`;

router.get('/invoices', requireUser, async (req, res) => {
  const f = ['all', 'draft', 'open', 'overdue', 'paid', 'void'].includes(req.query.f) ? req.query.f : 'all';
  const rows = await listInvoices(pool, { filter: f, today: todayIn(req.settings.timezone) });
  const body = h`<h1>Invoices <a class="btn" href="/invoices/new">New invoice</a></h1>
  <p class="tabs">${['all', 'draft', 'open', 'overdue', 'paid', 'void'].map((x) => h`<a href="/invoices?f=${x}" class="${x === f ? 'on' : ''}">${x}</a>`)}</p>
  ${rows.length ? h`<table><tr><th>Number</th><th>Contact</th><th>Issued</th><th>Due</th><th>State</th><th class="r">Total</th><th class="r">Balance</th></tr>
  ${rows.map((i) => h`<tr><td><a href="/invoices/${i.id}">${i.number || h`<i>draft #${i.id}</i>`}</a></td><td>${i.contact_name}</td><td>${fmtDate(i.issued_on)}</td><td>${fmtDate(i.due_on)}</td>
    <td>${stateBadge(i)}</td><td class="r">${money(req, i.total_cents)}</td><td class="r">${i.credit ? h`credit ${money(req, i.credit)}` : money(req, i.balance)}</td></tr>`)}</table>` : h`<p class="muted">No invoices here yet.</p>`}`;
  page(req, res, { title: 'Invoices', body, active: '/invoices', wide: true });
});

async function draftForm(req, res, inv, errors = []) {
  const contacts = (await pool.query('select id, name from contacts order by name')).rows;
  if (!contacts.length) return page(req, res, { title: 'New invoice', body: h`<h1>New invoice</h1><p>Add a <a href="/contacts/new">contact</a> first — an invoice is always addressed to one.</p>` });
  const items = inv?.items?.length ? inv.items : [];
  const rows = [...items, ...Array(Math.max(5 - items.length, 2)).fill({})];
  const s = req.settings, taxLine = Number(s.tax_rate_bp) ? `${s.tax_label} ${fmtRate(s.tax_rate_bp)} (${s.tax_inclusive === '1' ? 'prices include tax' : 'added to prices'})` : 'No tax configured';
  const body = h`<h1>${inv ? `Edit draft #${inv.id}` : 'New invoice'}</h1>${errors.length ? h`<div class="flash warn">${errors.map((e) => h`<div>${e}</div>`)}</div>` : ''}
  ${form(inv ? `/invoices/${inv.id}/edit` : '/invoices/new', req.user, once(), h`
  <div class="grid2">${field('Contact', select('contact_id', contacts.map((c) => [c.id, c.name]), inv?.contact_id ?? req.query.contact))}${field('Due date (blank = 14 days after issue)', input('due_on', inv?.due_on ? String(inv.due_on).slice(0, 10) : '', 'type="date"'))}</div>
  <table class="lines"><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th></tr>
  ${rows.map((l) => h`<tr><td><input name="desc" value="${l.description || ''}" placeholder="What was done or sold"></td><td><input name="qty" class="r" value="${l.qty_milli ? fmtQty(l.qty_milli).replace(/,/g, '') : ''}" placeholder="1"></td><td><input name="unit" class="r" value="${l.unit_cents != null ? (l.unit_cents / 100).toFixed(2) : ''}" placeholder="0.00"></td></tr>`)}</table>
  <p class="muted">${taxLine} — change it in <a href="/settings">Settings</a> before issuing.</p>
  ${field('Notes shown on the invoice', h`<textarea name="notes" rows="3">${inv?.notes || ''}</textarea>`)}
  ${button('Save draft')} <a class="btn ghost" href="${inv ? `/invoices/${inv.id}` : '/invoices'}">Cancel</a>`)}`;
  page(req, res, { title: inv ? 'Edit draft' : 'New invoice', body, active: '/invoices', wide: true, status: errors.length ? 400 : 200 });
}
router.get('/invoices/new', write, (req, res) => draftForm(req, res, null));
router.get('/invoices/:id/edit', write, async (req, res) => { const inv = await loadInvoice(pool, req.params.id); if (!inv) return res.status(404).send('not found'); if (inv.status !== 'draft') return res.redirect(`/invoices/${inv.id}`); draftForm(req, res, inv); });

async function postDraft(req, res, id) {
  const { lines, totals, errors } = computeLines(req.body, req.settings);
  const contactId = Number(req.body.contact_id); if (!contactId) errors.push('Pick a contact.');
  if (req.body.due_on && !isDate(req.body.due_on)) errors.push('Due date must be a calendar date.');
  if (errors.length) return draftForm(req, res, id ? { ...(await loadInvoice(pool, id)), ...req.body, items: lines } : { contact_id: contactId, due_on: req.body.due_on, notes: req.body.notes, items: lines }, errors);
  const newId = await tx(async (c) => (await consumeOnce(c, req)) ? saveDraft(c, { id, contactId, dueOn: req.body.due_on, notes: String(req.body.notes || ''), lines, totals }, req.settings, req.user) : id);
  res.redirect(`/invoices/${newId}`);
}
router.post('/invoices/new', write, (req, res) => postDraft(req, res, null));
router.post('/invoices/:id/edit', write, (req, res) => postDraft(req, res, Number(req.params.id)));

export function invoiceSheet(req, inv, { labels, logo, settings, publicView = false }) {
  const snap = inv.contact_snapshot || { name: inv.contact_name };
  const m = (c) => fmtMoney(c, settings.currency_symbol);
  const st = invoiceState(inv, todayIn(settings.timezone));
  return h`<article class="sheet">
  <header class="sheet-head"><div>${logo ? h`<img src="${logo}" alt="" height="40">` : ''}<h2>${settings.company_name || labels.appName}</h2><p class="muted pre">${settings.company_address}${settings.company_email ? `\n${settings.company_email}` : ''}${settings.company_phone ? `\n${settings.company_phone}` : ''}</p></div>
  <div class="r"><h1>${labels.invoiceTitle} ${inv.number || h`<i>draft</i>`}</h1><p>Issued ${fmtDate(inv.issued_on) || '—'}<br>Due ${fmtDate(inv.due_on) || '—'}</p>${st.state === 'paid' ? badge('paid', 'ok') : st.overdue ? badge('overdue', 'warn') : ''}</div></header>
  <p><b>Bill to</b><br>${snap.name}${snap.address ? h`<br><span class="pre">${snap.address}</span>` : ''}${snap.email ? h`<br>${snap.email}` : ''}</p>
  <table><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">${inv.tax_inclusive ? 'Amount (incl. tax)' : 'Amount'}</th></tr>
  ${inv.items.map((l) => h`<tr><td>${l.description}</td><td class="r">${fmtQty(l.qty_milli)}</td><td class="r">${m(l.unit_cents)}</td><td class="r">${m(inv.tax_inclusive ? l.gross_cents : l.net_cents)}</td></tr>`)}
  <tr class="tot"><td colspan="3" class="r">Subtotal${inv.tax_inclusive ? ' (before tax)' : ''}</td><td class="r">${m(inv.subtotal_cents)}</td></tr>
  ${Number(inv.tax_rate_bp) ? h`<tr class="tot"><td colspan="3" class="r">${inv.tax_label} ${fmtRate(inv.tax_rate_bp)}${inv.tax_inclusive ? ' (included)' : ''}</td><td class="r">${m(inv.tax_cents)}</td></tr>` : ''}
  <tr class="tot big"><td colspan="3" class="r">Total</td><td class="r">${m(inv.total_cents)}</td></tr>
  ${Number(inv.allocated_cents) ? h`<tr class="tot"><td colspan="3" class="r">Paid</td><td class="r">${m(inv.allocated_cents)}</td></tr><tr class="tot big"><td colspan="3" class="r">${st.credit ? 'Credit' : 'Balance due'}</td><td class="r">${m(st.credit || st.balance)}</td></tr>` : ''}</table>
  ${inv.notes ? h`<p class="pre">${inv.notes}</p>` : ''}${settings.invoice_footer ? h`<p class="muted pre">${settings.invoice_footer}</p>` : ''}${labels.invoiceFooter ? h`<p class="muted">${labels.invoiceFooter}</p>` : ''}
  </article>`;
}

router.get('/invoices/:id', requireUser, async (req, res) => {
  const inv = await loadInvoice(pool, req.params.id); if (!inv) return res.status(404).send('not found');
  const today = todayIn(req.settings.timezone), st = invoiceState(inv, today), m = (c) => money(req, c), u = req.user, canWrite = ['owner', 'staff'].includes(u.role);
  const credit = await contactCredit(pool, inv.contact_id);
  const replacements = st.state !== 'void' && inv.status === 'issued' ? (await listInvoices(pool, { filter: 'open', today, contactId: inv.contact_id })).filter((x) => x.id !== inv.id) : [];
  const shareUrl = inv.share_token ? `${req.protocol}://${req.get('host')}/share/${inv.share_token}` : null;
  const actions = canWrite ? h`<div class="actions">
    ${inv.status === 'draft' ? h`<a class="btn ghost" href="/invoices/${inv.id}/edit">Edit draft</a> ${form(`/invoices/${inv.id}/issue`, u, once(), button('Issue invoice'), 'class="inline"')} ${form(`/invoices/${inv.id}/delete`, u, once(), button('Delete draft', 'btn danger'), 'class="inline" onsubmit="return confirm(\'Delete this draft?\')"')}` : ''}
    ${inv.status === 'issued' ? h`<a class="btn ghost" href="/invoices/${inv.id}/print" target="_blank" rel="noopener">Print / save as PDF</a>
      ${st.balance > 0 ? h`<a class="btn" href="/payments/new?invoice=${inv.id}">Record a payment</a>` : ''}
      ${st.balance > 0 && credit > 0 ? form(`/invoices/${inv.id}/apply-credit`, u, once(), button(`Apply credit (${m(Math.min(credit, st.balance))})`, 'btn ghost'), 'class="inline"') : ''}
      ${inv.sent_at ? badge(`sent ${fmtDate(inv.sent_at)}`, 'ok') : form(`/invoices/${inv.id}/mark-sent`, u, once(), button('Mark as sent', 'btn ghost'), 'class="inline"')}
      ${shareUrl ? form(`/invoices/${inv.id}/share`, u, once(), h`${hidden('enable', '0')}${button('Revoke share link', 'btn ghost')}`, 'class="inline"') : form(`/invoices/${inv.id}/share`, u, once(), h`${hidden('enable', '1')}${button('Create share link', 'btn ghost')}`, 'class="inline"')}` : ''}
    </div>
    ${shareUrl ? h`<p class="share">Share link (anyone with it can view this invoice, nothing else): <input readonly value="${shareUrl}" onclick="this.select()"></p>` : ''}
    ${inv.status === 'issued' ? h`<details class="void"><summary>Void this invoice</summary>${inv.allocations.length ? h`<p>It has ${m(inv.allocated_cents)} of payments allocated. Money received never disappears — choose where it goes:</p>` : h`<p>No payments are allocated; voiding keeps the invoice with a "void" mark.</p>`}
      ${form(`/invoices/${inv.id}/void`, u, once(), h`${inv.allocations.length ? field('Move the payments to', select('move_to', [['credit', `Contact credit (${inv.contact_name})`], ...replacements.map((r) => [r.id, `${r.number} — balance ${m(r.balance)}`])])) : hidden('move_to', 'none')}${button('Void invoice', 'btn danger')}`)}</details>` : ''}` : '';
  const body = h`<p class="crumbs"><a href="/invoices">Invoices</a> › ${inv.number || `draft #${inv.id}`} ${stateBadge({ ...inv, ...st })}</p>
  ${invoiceSheet(req, inv, { ...req.app.locals.custom, settings: req.settings })}${actions}
  <section><h2>Payments on this invoice</h2>${inv.allocations.length ? h`<table><tr><th>Date</th><th>Method</th><th>Reference</th><th class="r">Payment</th><th class="r">Applied here</th></tr>
    ${inv.allocations.map((a) => h`<tr><td>${fmtDate(a.paid_on)}</td><td>${a.method}</td><td>${a.reference}</td><td class="r"><a href="/payments/${a.payment_id}">${m(a.payment_cents)}</a></td><td class="r">${m(a.amount_cents)}</td></tr>`)}</table>` : h`<p class="muted">None yet.</p>`}
    ${credit > 0 ? h`<p class="muted">${inv.contact_name} has ${m(credit)} of unapplied credit.</p>` : ''}</section>`;
  page(req, res, { title: inv.number || 'Draft', body, active: '/invoices', wide: true });
});

router.get('/invoices/:id/print', requireUser, async (req, res) => {
  const inv = await loadInvoice(pool, req.params.id); if (!inv) return res.status(404).send('not found');
  barePage(req, res, { title: `${inv.number || 'Draft'}`, body: h`${invoiceSheet(req, inv, { ...req.app.locals.custom, settings: req.settings })}<p class="noprint"><button onclick="print()" class="btn">Print / save as PDF</button></p>` });
});

const act = (fn, msgFn) => async (req, res) => {
  const id = Number(req.params.id);
  const out = await tx(async (c) => (await consumeOnce(c, req)) ? fn(c, id, req) : null);
  if (out !== null && msgFn) await setFlash(req, 'ok', msgFn(out, req));
  res.redirect(`/invoices/${id}`);
};
router.post('/invoices/:id/issue', write, act((c, id, req) => issueInvoice(c, id, req.settings, todayIn(req.settings.timezone), req.user), (n) => `Invoice ${n} issued.`));
router.post('/invoices/:id/mark-sent', write, act((c, id, req) => markSent(c, id, req.user)));
router.post('/invoices/:id/share', write, act((c, id, req) => setShareToken(c, id, req.body.enable === '1', req.user)));
router.post('/invoices/:id/void', write, act((c, id, req) => voidInvoice(c, id, req.body.move_to, req.user), () => 'Invoice voided.'));
router.post('/invoices/:id/apply-credit', write, act(async (c, id, req) => { const inv = await loadInvoice(c, id); return applyCredit(c, { contactId: inv.contact_id, invoiceId: id }, req.user); }, (n, req) => `Applied ${money(req, n)} of credit.`));
router.post('/invoices/:id/delete', write, async (req, res) => {
  await tx(async (c) => { if (!(await consumeOnce(c, req))) return; const r = await c.query(`delete from invoices where id = $1 and status = 'draft' returning id`, [req.params.id]); if (r.rows[0]) await audit(c, req.user, 'delete-draft', 'invoice', req.params.id); });
  res.redirect('/invoices');
});

/** Public, token-only view. No navigation, no third-party assets, not indexable, no referrer leaks. */
router.get('/share/:token', async (req, res) => {
  res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'private, no-store' });
  const token = String(req.params.token || '');
  const row = token.length >= 32 ? (await pool.query(`select id from invoices where share_token = $1 and status = 'issued'`, [token])).rows[0] : null;
  if (!row) return barePage(req, res, { status: 404, title: 'Not found', body: h`<h1>This link is not valid</h1><p>The invoice may have been revoked. Ask the sender for a new link.</p>` });
  const inv = await loadInvoice(pool, row.id);
  barePage(req, res, { title: `${req.app.locals.custom.labels.invoiceTitle} ${inv.number}`, body: h`${invoiceSheet(req, inv, { ...req.app.locals.custom, settings: req.settings, publicView: true })}<p class="noprint"><button onclick="print()" class="btn">Print / save as PDF</button></p>` });
});
