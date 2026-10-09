// Business rules. Payments are cash movements; allocations link cash to invoices; states are derived, never stored.
import { lineTotals, sumTotals, parseMoney, parseQty, addDays, isDate } from './money.js';
import { audit } from './db.js';
import { newToken } from './auth.js';

const num = (v) => Number(v ?? 0);
const INVOICE_SELECT = `select i.*, c.name as contact_name,
  coalesce((select sum(a.amount_cents) from allocations a where a.invoice_id = i.id), 0)::bigint as allocated_cents
  from invoices i join contacts c on c.id = i.contact_id`;

/** draft · issued · partially paid · paid (credit when over) · void — plus the overdue flag, which is separate. */
export function invoiceState(inv, today) {
  const total = num(inv.total_cents), allocated = num(inv.allocated_cents), balance = total - allocated;
  if (inv.status === 'draft') return { state: 'draft', balance, credit: 0, overdue: false };
  if (inv.status === 'void') return { state: 'void', balance: 0, credit: 0, overdue: false };
  const state = allocated === 0 ? 'issued' : allocated < total ? 'partially paid' : 'paid';
  const overdue = balance > 0 && !!inv.due_on && String(inv.due_on).slice(0, 10) < today;
  return { state, balance: Math.max(balance, 0), credit: Math.max(-balance, 0), overdue };
}

export async function loadInvoice(c, id) {
  const inv = (await c.query(`${INVOICE_SELECT} where i.id = $1`, [id])).rows[0];
  if (!inv) return null;
  inv.items = (await c.query('select * from invoice_items where invoice_id = $1 order by position', [id])).rows;
  inv.allocations = (await c.query(`select a.*, p.paid_on, p.method, p.reference, p.direction, p.amount_cents as payment_cents
    from allocations a join payments p on p.id = a.payment_id where a.invoice_id = $1 order by p.paid_on, a.id`, [id])).rows;
  return inv;
}
export async function listInvoices(c, { filter = 'all', today, contactId = null } = {}) {
  const rows = (await c.query(`${INVOICE_SELECT} where ($1::int is null or i.contact_id = $1) order by coalesce(i.issued_on, i.created_at::date) desc, i.id desc`, [contactId])).rows;
  return rows.map((r) => ({ ...r, ...invoiceState(r, today) })).filter((r) => filter === 'all' ? true
    : filter === 'open' ? r.state === 'issued' || r.state === 'partially paid' : filter === 'overdue' ? r.overdue : r.state === filter);
}

/** Validates the posted line rows and computes their totals with the given tax settings. */
export function computeLines(body, settings) {
  const errors = [], lines = [];
  const descs = [].concat(body.desc ?? []), qtys = [].concat(body.qty ?? []), units = [].concat(body.unit ?? []);
  const inclusive = settings.tax_inclusive === '1', rateBp = num(settings.tax_rate_bp);
  descs.forEach((d, i) => {
    const desc = String(d ?? '').trim(); if (!desc && !String(units[i] ?? '').trim()) return;
    const qtyMilli = parseQty(qtys[i] || '1'), unitCents = parseMoney(units[i]);
    if (!desc) errors.push(`Line ${i + 1}: description is missing.`);
    if (Number.isNaN(qtyMilli) || qtyMilli <= 0) errors.push(`Line ${i + 1}: quantity must be a number above zero (up to 3 decimals).`);
    if (Number.isNaN(unitCents) || unitCents < 0) errors.push(`Line ${i + 1}: price must be an amount like 120.00.`);
    if (errors.length) return;
    lines.push({ position: lines.length + 1, description: desc, qty_milli: qtyMilli, unit_cents: unitCents, ...rename(lineTotals({ qtyMilli, unitCents, rateBp, inclusive })) });
  });
  if (!lines.length && !errors.length) errors.push('Add at least one line.');
  return { lines, totals: sumTotals(lines.map((l) => ({ net: l.net_cents, tax: l.tax_cents, gross: l.gross_cents }))), errors };
}
const rename = ({ net, tax, gross }) => ({ net_cents: net, tax_cents: tax, gross_cents: gross });

export async function saveDraft(c, { id, contactId, dueOn, notes, lines, totals }, settings, user) {
  const tax = [settings.tax_label, num(settings.tax_rate_bp), settings.tax_inclusive === '1'];
  if (id) {
    const cur = (await c.query('select status from invoices where id = $1 for update', [id])).rows[0];
    if (!cur || cur.status !== 'draft') throw Object.assign(new Error('Only drafts can be edited.'), { status: 409 });
    await c.query(`update invoices set contact_id=$2, due_on=$3, notes=$4, tax_label=$5, tax_rate_bp=$6, tax_inclusive=$7,
      subtotal_cents=$8, tax_cents=$9, total_cents=$10 where id=$1`, [id, contactId, dueOn || null, notes, ...tax, totals.subtotal, totals.tax, totals.total]);
    await c.query('delete from invoice_items where invoice_id = $1', [id]);
  } else {
    id = (await c.query(`insert into invoices (contact_id, due_on, notes, tax_label, tax_rate_bp, tax_inclusive, subtotal_cents, tax_cents, total_cents)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [contactId, dueOn || null, notes, ...tax, totals.subtotal, totals.tax, totals.total])).rows[0].id;
  }
  for (const l of lines) await c.query(`insert into invoice_items (invoice_id, position, description, qty_milli, unit_cents, net_cents, tax_cents, gross_cents)
    values ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, l.position, l.description, l.qty_milli, l.unit_cents, l.net_cents, l.tax_cents, l.gross_cents]);
  await audit(c, user, 'save-draft', 'invoice', id, { total_cents: totals.total });
  return id;
}

/** Issue: number from the per-year counter inside this transaction, contact and tax frozen on the invoice. */
export async function issueInvoice(c, id, settings, today, user) {
  const inv = (await c.query('select * from invoices where id = $1 for update', [id])).rows[0];
  if (!inv || inv.status !== 'draft') throw Object.assign(new Error('Only a draft can be issued.'), { status: 409 });
  if (!(await c.query('select 1 from invoice_items where invoice_id = $1 limit 1', [id])).rows.length) throw Object.assign(new Error('Add at least one line before issuing.'), { status: 409 });
  const contact = (await c.query('select name, email, phone, address from contacts where id = $1', [inv.contact_id])).rows[0];
  const year = Number(today.slice(0, 4));
  const last = (await c.query(`insert into invoice_counters (year, last) values ($1, 1) on conflict (year) do update set last = invoice_counters.last + 1 returning last`, [year])).rows[0].last;
  const number = `${settings.invoice_prefix || 'INV'}-${year}-${String(last).padStart(4, '0')}`;
  const dueOn = inv.due_on ? String(inv.due_on).slice(0, 10) : addDays(today, 14);
  await c.query(`update invoices set status='issued', number=$2, issued_on=$3, due_on=$4, contact_snapshot=$5 where id=$1`,
    [id, number, today, dueOn, JSON.stringify(contact)]);
  await audit(c, user, 'issue', 'invoice', id, { number });
  return number;
}

export async function markSent(c, id, user) {
  await c.query(`update invoices set sent_at = now() where id = $1 and status = 'issued'`, [id]);
  await audit(c, user, 'mark-sent', 'invoice', id);
}
export async function setShareToken(c, id, enable, user) {
  const token = enable ? newToken(32) : null;
  await c.query(`update invoices set share_token = $2 where id = $1 and status = 'issued'`, [id, token]);
  await audit(c, user, enable ? 'share-link-created' : 'share-link-revoked', 'invoice', id);
  return token;
}

/** Void: never while allocations remain, unless they are moved to a replacement invoice or released to contact credit. */
export async function voidInvoice(c, id, moveTo, user) {
  const inv = (await c.query('select * from invoices where id = $1 for update', [id])).rows[0];
  if (!inv || inv.status !== 'issued') throw Object.assign(new Error('Only an issued invoice can be voided.'), { status: 409 });
  const allocs = (await c.query('select * from allocations where invoice_id = $1 order by id', [id])).rows;
  if (allocs.length) {
    if (moveTo === 'credit') await c.query('delete from allocations where invoice_id = $1', [id]);
    else if (/^\d+$/.test(String(moveTo))) {
      const target = (await c.query(`${INVOICE_SELECT} where i.id = $1 for update of i`, [moveTo])).rows[0];
      if (!target || target.status !== 'issued' || target.contact_id !== inv.contact_id) throw Object.assign(new Error('The replacement must be an issued invoice for the same contact.'), { status: 409 });
      let room = num(target.total_cents) - num(target.allocated_cents);
      for (const a of allocs) {
        const move = Math.min(room, num(a.amount_cents));
        if (move > 0) { await c.query('update allocations set invoice_id = $2, amount_cents = $3 where id = $1', [a.id, target.id, move]); room -= move; }
        if (move < num(a.amount_cents)) { if (move > 0) { /* remainder becomes credit */ } await c.query('delete from allocations where id = $1 and amount_cents = $2 and invoice_id = $3', [a.id, a.amount_cents, id]); }
      }
      await c.query('update invoices set replaced_by_id = $2 where id = $1', [id, target.id]);
    } else throw Object.assign(new Error('This invoice has payments. Choose where they go first.'), { status: 409 });
  }
  await c.query(`update invoices set status='void', voided_at=now(), share_token=null where id=$1`, [id]);
  await audit(c, user, 'void', 'invoice', id, { moved_to: allocs.length ? moveTo : null, allocations: allocs.length });
}

export async function contactCredit(c, contactId) {
  const r = (await c.query(`select
    coalesce(sum(case when direction='received' then amount_cents else 0 end),0)::bigint as received,
    coalesce(sum(case when direction='refunded' then amount_cents else 0 end),0)::bigint as refunded,
    coalesce((select sum(a.amount_cents) from allocations a join payments p on p.id=a.payment_id where p.contact_id=$1),0)::bigint as allocated
    from payments where contact_id = $1`, [contactId])).rows[0];
  return num(r.received) - num(r.refunded) - num(r.allocated);
}

/** A cash movement; when `invoiceId` is given, as much as fits is allocated to it and the rest becomes credit. */
export async function recordPayment(c, { contactId, direction = 'received', amountCents, paidOn, method = '', reference = '', notes = '', invoiceId = null }, user) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw Object.assign(new Error('Amount must be above zero.'), { status: 400 });
  if (!isDate(paidOn)) throw Object.assign(new Error('Date must be a calendar date.'), { status: 400 });
  const p = (await c.query(`insert into payments (contact_id, direction, amount_cents, paid_on, method, reference, notes, created_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [contactId, direction, amountCents, paidOn, method, reference, notes, user?.id ?? null])).rows[0];
  let allocated = 0;
  if (invoiceId && direction === 'received') {
    const inv = (await c.query(`${INVOICE_SELECT} where i.id = $1 for update of i`, [invoiceId])).rows[0];
    if (!inv || inv.status !== 'issued' || inv.contact_id !== Number(contactId)) throw Object.assign(new Error('Payments can only be applied to an issued invoice of the same contact.'), { status: 409 });
    allocated = Math.min(amountCents, Math.max(num(inv.total_cents) - num(inv.allocated_cents), 0));
    if (allocated > 0) await c.query('insert into allocations (payment_id, invoice_id, amount_cents) values ($1,$2,$3)', [p.id, invoiceId, allocated]);
  }
  await audit(c, user, direction === 'received' ? 'payment-received' : 'refund', 'payment', p.id, { amount_cents: amountCents, invoice_id: invoiceId, allocated_cents: allocated });
  return { id: p.id, allocated, credit: amountCents - allocated };
}

/** Allocates existing credit (unallocated remainders of received payments, oldest first) to an invoice. No new cash. */
export async function applyCredit(c, { contactId, invoiceId, amountCents }, user) {
  const inv = (await c.query(`${INVOICE_SELECT} where i.id = $1 for update of i`, [invoiceId])).rows[0];
  if (!inv || inv.status !== 'issued' || inv.contact_id !== Number(contactId)) throw Object.assign(new Error('Credit can only be applied to an issued invoice of the same contact.'), { status: 409 });
  const credit = await contactCredit(c, contactId);
  const room = Math.max(num(inv.total_cents) - num(inv.allocated_cents), 0);
  let left = Math.min(amountCents || credit, credit, room);
  if (left <= 0) throw Object.assign(new Error('Nothing to apply: no credit or the invoice is already paid.'), { status: 409 });
  const applied = left;
  const sources = (await c.query(`select p.id, p.amount_cents - coalesce((select sum(a.amount_cents) from allocations a where a.payment_id = p.id),0) as remainder
    from payments p where p.contact_id = $1 and p.direction = 'received' order by p.paid_on, p.id`, [contactId])).rows;
  for (const s of sources) {
    const take = Math.min(left, num(s.remainder)); if (take <= 0) continue;
    await c.query('insert into allocations (payment_id, invoice_id, amount_cents) values ($1,$2,$3)', [s.id, invoiceId, take]);
    left -= take; if (!left) break;
  }
  await audit(c, user, 'apply-credit', 'invoice', invoiceId, { amount_cents: applied });
  return applied;
}

export async function deletePayment(c, id, user) {
  const p = (await c.query('delete from payments where id = $1 returning *', [id])).rows[0];
  if (!p) throw Object.assign(new Error('Payment not found.'), { status: 404 });
  await audit(c, user, 'delete-payment', 'payment', id, { amount_cents: p.amount_cents, paid_on: p.paid_on, contact_id: p.contact_id });
}

export function billState(bill, today) {
  const paid = num(bill.paid_cents), total = num(bill.amount_cents), balance = Math.max(total - paid, 0);
  if (bill.status === 'void') return { state: 'void', balance: 0, overdue: false };
  const state = paid === 0 ? 'open' : paid < total ? 'partially paid' : 'paid';
  return { state, balance, overdue: balance > 0 && String(bill.due_on).slice(0, 10) < today };
}
const BILL_SELECT = `select b.*, c.name as supplier_name, cat.name as category_name,
  coalesce((select sum(amount_cents) from bill_payments bp where bp.bill_id = b.id),0)::bigint as paid_cents
  from bills b join contacts c on c.id = b.supplier_id left join categories cat on cat.id = b.category_id`;
export async function listBills(c, { filter = 'all', today } = {}) {
  const rows = (await c.query(`${BILL_SELECT} order by b.due_on desc, b.id desc`)).rows;
  return rows.map((r) => ({ ...r, ...billState(r, today) })).filter((r) => filter === 'all' ? true
    : filter === 'open' ? r.state === 'open' || r.state === 'partially paid' : filter === 'overdue' ? r.overdue : r.state === filter);
}
export async function loadBill(c, id) {
  const b = (await c.query(`${BILL_SELECT} where b.id = $1`, [id])).rows[0];
  if (b) b.payments = (await c.query('select * from bill_payments where bill_id = $1 order by paid_on, id', [id])).rows;
  return b;
}

/** The "This week" numbers: next 7 days in and out, overdue totals, last 7 days received and paid. */
export async function weekSummary(c, today) {
  const end = addDays(today, 7), start = addDays(today, -7);
  const inv = (await c.query(`select coalesce(sum(case when due_on >= $1 and due_on <= $2 then bal else 0 end),0)::bigint as due_soon,
      coalesce(sum(case when due_on < $1 then bal else 0 end),0)::bigint as overdue,
      count(*) filter (where due_on < $1 and bal > 0) as overdue_count
    from (select i.due_on, i.total_cents - coalesce((select sum(a.amount_cents) from allocations a where a.invoice_id = i.id),0) as bal
      from invoices i where i.status = 'issued') t where bal > 0`, [today, end])).rows[0];
  const bills = (await c.query(`select coalesce(sum(case when due_on >= $1 and due_on <= $2 then bal else 0 end),0)::bigint as due_soon,
      coalesce(sum(case when due_on < $1 then bal else 0 end),0)::bigint as overdue,
      count(*) filter (where due_on < $1 and bal > 0) as overdue_count
    from (select b.due_on, b.amount_cents - coalesce((select sum(bp.amount_cents) from bill_payments bp where bp.bill_id = b.id),0) as bal
      from bills b where b.status = 'open') t where bal > 0`, [today, end])).rows[0];
  const cash = (await c.query(`select
      coalesce((select sum(amount_cents) from payments where direction='received' and paid_on > $1 and paid_on <= $2),0)::bigint as received,
      coalesce((select sum(amount_cents) from payments where direction='refunded' and paid_on > $1 and paid_on <= $2),0)::bigint as refunded,
      coalesce((select sum(amount_cents) from bill_payments where paid_on > $1 and paid_on <= $2),0)::bigint as paid`, [start, today])).rows[0];
  const dueInvoices = (await c.query(`${INVOICE_SELECT} where i.status='issued' and i.due_on <= $1 order by i.due_on, i.id`, [end])).rows
    .map((r) => ({ ...r, ...invoiceState(r, today) })).filter((r) => r.balance > 0);
  const dueBills = (await c.query(`${BILL_SELECT} where b.status='open' and b.due_on <= $1 order by b.due_on, b.id`, [end])).rows
    .map((r) => ({ ...r, ...billState(r, today) })).filter((r) => r.balance > 0);
  return { today, end, start, inv: { dueSoon: num(inv.due_soon), overdue: num(inv.overdue), overdueCount: num(inv.overdue_count) },
    bills: { dueSoon: num(bills.due_soon), overdue: num(bills.overdue), overdueCount: num(bills.overdue_count) },
    cash: { received: num(cash.received), refunded: num(cash.refunded), paid: num(cash.paid) }, dueInvoices, dueBills };
}
