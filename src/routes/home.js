import { Router } from 'express';
import { pool } from '../db.js';
import { weekSummary } from '../ledger.js';
import { todayIn, fmtDate } from '../money.js';
import { h, badge } from '../render.js';
import { page, money } from '../page.js';
import { requireUser } from '../auth.js';

export const router = Router();
router.get('/', requireUser, async (req, res) => {
  const today = todayIn(req.settings.timezone), w = await weekSummary(pool, today);
  const m = (c) => money(req, c);
  const body = h`<h1>${req.app.locals.custom.labels.thisWeek} <span class="muted">${fmtDate(today)} → ${fmtDate(w.end)}</span></h1>
  <div class="tiles">
    <a class="tile" href="/invoices?f=open"><span>Money in, due this week</span><b>${m(w.inv.dueSoon)}</b></a>
    <a class="tile warn" href="/invoices?f=overdue"><span>Overdue invoices (${w.inv.overdueCount})</span><b>${m(w.inv.overdue)}</b></a>
    <a class="tile" href="/bills?f=open"><span>Money out, due this week</span><b>${m(w.bills.dueSoon)}</b></a>
    <a class="tile warn" href="/bills?f=overdue"><span>Overdue bills (${w.bills.overdueCount})</span><b>${m(w.bills.overdue)}</b></a>
    <a class="tile ok" href="/payments"><span>Received, last 7 days</span><b>${m(w.cash.received - w.cash.refunded)}</b></a>
    <a class="tile" href="/bills?f=paid"><span>Paid out, last 7 days</span><b>${m(w.cash.paid)}</b></a>
  </div>
  <div class="cols"><section><h2>Invoices due by ${fmtDate(w.end)}</h2>${w.dueInvoices.length ? h`<table><tr><th>Due</th><th>Invoice</th><th>Contact</th><th class="r">Balance</th></tr>
    ${w.dueInvoices.map((i) => h`<tr><td>${fmtDate(i.due_on)}</td><td><a href="/invoices/${i.id}">${i.number}</a> ${i.overdue ? badge('overdue', 'warn') : ''}</td><td>${i.contact_name}</td><td class="r">${m(i.balance)}</td></tr>`)}</table>` : h`<p class="muted">Nothing due. <a href="/invoices/new">Create an invoice</a>.</p>`}</section>
  <section><h2>Bills due by ${fmtDate(w.end)}</h2>${w.dueBills.length ? h`<table><tr><th>Due</th><th>Bill</th><th>Supplier</th><th class="r">Balance</th></tr>
    ${w.dueBills.map((b) => h`<tr><td>${fmtDate(b.due_on)}</td><td><a href="/bills/${b.id}">${b.description}</a> ${b.overdue ? badge('overdue', 'warn') : ''}</td><td>${b.supplier_name}</td><td class="r">${m(b.balance)}</td></tr>`)}</table>` : h`<p class="muted">Nothing due. <a href="/bills/new">Add a bill</a>.</p>`}</section></div>`;
  page(req, res, { title: req.app.locals.custom.labels.thisWeek, body, active: '/', wide: true });
});
