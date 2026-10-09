// Sample data: every row is tagged is_sample; removal previews, deletes only tagged rows and refuses when real rows depend on them.
import { addDays } from './money.js';
import { audit } from './db.js';
import { computeLines, issueInvoice, recordPayment } from './ledger.js';

const CONTACTS = [['Harbor Lane Bakery', 'orders@harborlane.example', '12 Pier St, Portland, ME'], ['Juniper & Co. Design', 'hello@juniperco.example', '88 Elm Ave, Austin, TX'],
  ['Northwind Dental', 'office@northwinddental.example', '400 Lake Rd, Madison, WI'], ['Cobalt Fitness Studio', 'team@cobaltfit.example', '9 Bay View, San Diego, CA'],
  ['Maple Street Books', 'maple@books.example', '21 Maple St, Burlington, VT'], ['Riverside Vet Clinic', 'care@riversidevet.example', '5 Mill Ln, Boise, ID']];
const SUPPLIERS = [['Summit Web Hosting', 'expense', 'Software'], ['Cedar Office Supply', 'expense', 'Office'], ['Pine County Insurance', 'expense', 'Insurance'],
  ['Bluebird Accounting', 'expense', 'Professional fees'], ['Metro Utilities', 'expense', 'Utilities']];
const SERVICES = [['Website maintenance — monthly', 15000], ['Logo refresh', 65000], ['Consulting hour', 12000], ['Landing page', 180000], ['Newsletter template', 45000], ['Photo editing (batch of 20)', 24000]];

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

export async function sampleCounts(c) {
  const r = (await c.query(`select (select count(*) from contacts where is_sample) as contacts, (select count(*) from invoices where is_sample) as invoices,
    (select count(*) from payments where is_sample) as payments, (select count(*) from bills where is_sample) as bills, (select count(*) from categories where is_sample) as categories`)).rows[0];
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

export async function addSampleData(c, settings, today, user) {
  const r = rng(20261009);
  const ids = [];
  for (const [name, email, address] of CONTACTS) ids.push((await c.query('insert into contacts (name, email, address, is_sample) values ($1,$2,$3,true) returning id', [name, email, address])).rows[0].id);
  const sup = [];
  for (const [name, kind, cat] of SUPPLIERS) {
    const cid = (await c.query('insert into categories (name, kind, is_sample) values ($1,$2,true) on conflict (name, kind) do update set name = excluded.name returning id', [cat, kind])).rows[0].id;
    sup.push([(await c.query('insert into contacts (name, is_sample) values ($1,true) returning id', [name])).rows[0].id, cid]);
  }
  let invoices = 0, payments = 0, bills = 0;
  for (let k = 0; k < 24; k++) {
    const contactId = ids[k % ids.length], daysAgo = Math.floor(r() * 110);
    const issuedOn = addDays(today, -daysAgo);
    const n = 1 + Math.floor(r() * 3), body = { desc: [], qty: [], unit: [] };
    for (let j = 0; j < n; j++) { const [d, cents] = SERVICES[Math.floor(r() * SERVICES.length)]; body.desc.push(d); body.qty.push(String(1 + Math.floor(r() * 3))); body.unit.push((cents / 100).toFixed(2)); }
    const { lines, totals } = computeLines(body, settings);
    const id = (await c.query(`insert into invoices (contact_id, due_on, tax_label, tax_rate_bp, tax_inclusive, subtotal_cents, tax_cents, total_cents, is_sample, created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9) returning id`, [contactId, addDays(issuedOn, 14), settings.tax_label, Number(settings.tax_rate_bp), settings.tax_inclusive === '1', totals.subtotal, totals.tax, totals.total, `${issuedOn}T12:00:00Z`])).rows[0].id;
    for (const l of lines) await c.query('insert into invoice_items (invoice_id, position, description, qty_milli, unit_cents, net_cents, tax_cents, gross_cents) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, l.position, l.description, l.qty_milli, l.unit_cents, l.net_cents, l.tax_cents, l.gross_cents]);
    invoices++;
    if (k < 21) {
      await issueInvoice(c, id, settings, issuedOn, user);
      const roll = r();
      if (daysAgo > 20 && roll < 0.7) { await recordPayment(c, { contactId, amountCents: totals.total, paidOn: addDays(issuedOn, 5 + Math.floor(r() * 20)), method: 'bank transfer', invoiceId: id }, user); payments++; }
      else if (roll < 0.85) { await recordPayment(c, { contactId, amountCents: Math.round(totals.total / 2), paidOn: addDays(issuedOn, 7), method: 'card', invoiceId: id }, user); payments++; }
    }
  }
  for (let k = 0; k < 18; k++) {
    const [supplierId, categoryId] = sup[k % sup.length], dueOn = addDays(today, Math.floor(r() * 60) - 40), amount = [4900, 12000, 23000, 45000, 89000][k % 5];
    const id = (await c.query('insert into bills (supplier_id, category_id, description, amount_cents, due_on, is_sample) values ($1,$2,$3,$4,$5,true) returning id',
      [supplierId, categoryId, `${SUPPLIERS[k % sup.length][0]} — ${['monthly', 'quarterly', 'annual'][k % 3]}`, amount, dueOn])).rows[0].id;
    if (dueOn < addDays(today, -5) && r() < 0.7) await c.query('insert into bill_payments (bill_id, amount_cents, paid_on, method) values ($1,$2,$3,$4)', [id, amount, addDays(dueOn, -2), 'bank transfer']);
    bills++;
  }
  await c.query(`update payments set is_sample = true where contact_id = any($1::int[])`, [ids]);
  await audit(c, user, 'sample-data-added', 'sample', '', { contacts: ids.length + sup.length, invoices, payments, bills });
  return { contacts: ids.length + sup.length, invoices, payments, bills };
}

/** Real (untagged) rows that point at sample rows block removal; they are listed, never deleted. */
export async function sampleConflicts(c) {
  const q = async (sql) => Number((await c.query(sql)).rows[0].n);
  return {
    invoicesOnSampleContacts: await q(`select count(*) as n from invoices i join contacts c on c.id=i.contact_id where c.is_sample and not i.is_sample`),
    paymentsOnSampleContacts: await q(`select count(*) as n from payments p join contacts c on c.id=p.contact_id where c.is_sample and not p.is_sample`),
    billsOnSampleSuppliers: await q(`select count(*) as n from bills b join contacts c on c.id=b.supplier_id where c.is_sample and not b.is_sample`),
    allocationsMixing: await q(`select count(*) as n from allocations a join payments p on p.id=a.payment_id join invoices i on i.id=a.invoice_id where p.is_sample <> i.is_sample`),
  };
}
export async function removeSampleData(c, user) {
  const conflicts = await sampleConflicts(c);
  if (Object.values(conflicts).some((n) => n > 0)) return { removed: null, conflicts };
  const counts = await sampleCounts(c);
  await c.query('delete from allocations where payment_id in (select id from payments where is_sample)');
  await c.query('delete from payments where is_sample');
  await c.query('delete from invoices where is_sample');
  await c.query('delete from bills where is_sample');
  await c.query('delete from contacts where is_sample');
  await c.query('delete from categories where is_sample and id not in (select category_id from bills where category_id is not null)');
  await audit(c, user, 'sample-data-removed', 'sample', '', counts);
  return { removed: counts, conflicts };
}
