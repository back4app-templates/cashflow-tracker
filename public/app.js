// File: public/app.js · browser, ES module, no bundler · talks to Back4app only through Cloud functions
'use strict';

/* ------------------------------------------------------------------ setup */

const CFG = window.APP_CONFIG || {};
if (!CFG.appId || !CFG.jsKey) {
  document.getElementById('app').innerHTML = '<div class="empty"><p>Missing configuration.</p><p class="hint">Set APP_ID and JS_KEY on the server and reload.</p></div>';
  throw new Error('APP_CONFIG missing');
}
Parse.initialize(CFG.appId, CFG.jsKey);
Parse.serverURL = CFG.serverUrl || 'https://parseapi.back4app.com';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948', '#0e7c86', '#9c6b2f', '#7a8794', '#c0392b'];
const TYPE_NAME = { income: 'Income', expense: 'Expense', transfer: 'Transfer' };
const ICONS = {
  income: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
  expense: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7L7 17M15 17H7V9"/></svg>',
  transfer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h12m0 0l-3-3m3 3l-3 3M17 16H5m0 0l3-3m-3 3l3 3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fmt = (cents) => { const r = Math.round(cents); return money.format((r === 0 ? 0 : r) / 100); };
const plain = (cents) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toCents = (text) => { const digits = String(text).replace(/\D/g, ''); const v = digits ? parseInt(digits, 10) : 0; return String(text).trim().startsWith('-') ? -v : v; };
const pct = (part, total) => (total ? (part / total * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '0.0%');
const monthName = (ym) => `${MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
const addMonths = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const endOfMonth = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 0)).toISOString().slice(0, 10);
const human = (ymd) => { if (!ymd) return ''; const [y, m, d] = ymd.split('-'); return `${MONTHS[+m - 1].slice(0, 3)} ${+d}, ${y}`; };

/* ------------------------------------------------------------------ api */

async function call(name, params = {}) {
  try {
    return await Parse.Cloud.run(name, params);
  } catch (err) {
    if (err && err.code === 209) {              // invalid session: show the sign-in screen
      await Parse.User.logOut().catch(() => {});
      state.user = null;
      render();
      throw new Error('Your session expired. Sign in again.');
    }
    const msg = (err && err.message) || 'Something went wrong. Try again.';
    throw new Error(msg.replace(/^LIMIT_EXCEEDED:\s*/, 'Too much data: '));
  }
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, error ? 6000 : 2600);
}

function confirm(title, text, label) {
  const dlg = $('#dlgConfirm');
  dlg.innerHTML = `
    <form method="dialog" class="confirm">
      <h2 id="confirmTitle">${esc(title)}</h2>
      <p>${esc(text)}</p>
      <div class="actions">
        <button class="btn" value="no">Cancel</button>
        <button class="btn danger" value="yes">${esc(label)}</button>
      </div>
    </form>`;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true });
    dlg.returnValue = 'no';
    dlg.showModal();
  });
}

function moneyMask(input, allowNegative = false) {
  input.addEventListener('input', () => {
    const negative = allowNegative && input.value.trim().startsWith('-');
    const digits = input.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 13);
    input.value = digits ? (negative ? '-' : '') + plain(parseInt(digits, 10)) : (negative ? '-' : '');
  });
}

/* ------------------------------------------------------------------ state */

const state = {
  user: Parse.User.current(),
  role: null, today: null, demo: false,
  accounts: [], categories: [], latestMonth: null,
  month: null, account: '', type: '', search: '', data: null,
  rep: { from: '', to: '', basis: 'cash', account: '', data: null, open: new Set() },
};
const canWrite = () => state.role === 'finance';
const account = (id) => state.accounts.find((a) => a.id === id);
const category = (id) => state.categories.find((c) => c.id === id);

async function loadBase() {
  const base = await call('base');
  state.role = base.role; state.today = base.today; state.demo = base.demo;
  state.accounts = base.accounts; state.categories = base.categories; state.latestMonth = base.latestMonth;
  if (!state.month) state.month = base.today.slice(0, 7);
  $('#demoBanner').hidden = !(CFG.demo || base.demo);
  $('#whoName').textContent = state.user.get('username');
  $('#whoRole').textContent = state.role === 'finance' ? 'Can edit' : 'Read only';
  return base;
}

/* ------------------------------------------------------------------ sign in */

function renderLogin() {
  $('#nav').hidden = true; $('#who').hidden = true; $('#demoBanner').hidden = !CFG.demo;
  $('#app').innerHTML = `
    <form class="panel login" id="loginForm" novalidate>
      <h1>Sign in</h1>
      <p class="muted">Cash flow tracker for ${CFG.demo ? 'Bluefin Studio (demo)' : 'your organization'}.</p>
      <label>Username<input name="username" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <p class="error" role="alert" hidden></p>
      <button class="btn primary" type="submit">Sign in</button>
      ${CFG.demo ? '<p class="hint">The demo sign-in is read only. The credentials are in the project README.</p>' : ''}
    </form>`;
  const f = $('#loginForm');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      state.user = await Parse.User.logIn(f.elements.username.value.trim(), f.elements.password.value);
      state.month = null;
      await render();
    } catch (err) {
      const p = $('.error', f); p.textContent = err.code === 101 ? 'Wrong username or password.' : (err.message || 'Could not sign in.'); p.hidden = false;
    } finally { btn.disabled = false; }
  });
  f.elements.username.focus();
}

$('#signOut').onclick = async () => {
  await Parse.User.logOut().catch(() => {});
  state.user = null; state.month = null; state.data = null;
  render();
};

/* ------------------------------------------------------------------ transactions */

function renderTransactions() {
  const write = canWrite();
  $('#app').innerHTML = `
    <header class="top">
      <h1>Transactions</h1>
      <div class="new" ${write ? '' : 'hidden'}>
        <button class="btn income" data-new="income">${ICONS.plus} Income</button>
        <button class="btn expense" data-new="expense">${ICONS.plus} Expense</button>
        <button class="btn" data-new="transfer">${ICONS.transfer} Transfer</button>
      </div>
    </header>
    <div class="bar">
      <div class="monthnav">
        <button class="btn icon" id="prevMonth" aria-label="Previous month">${ICONS.prev}</button>
        <strong id="monthLabel" aria-live="polite"></strong>
        <button class="btn icon" id="nextMonth" aria-label="Next month">${ICONS.next}</button>
        <button class="btn subtle" id="thisMonth">Today</button>
      </div>
      <div class="filters">
        <select id="fAccount" aria-label="Account">
          <option value="">All accounts</option>
          ${state.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
        </select>
        <input type="search" id="fSearch" placeholder="Search" aria-label="Search transactions" value="${esc(state.search)}">
      </div>
    </div>
    <div class="cards" id="cards"></div>
    <div class="panel"><div id="list"></div></div>
    <div class="summary" id="summary"></div>`;

  $('#fAccount').value = state.account;
  $('#prevMonth').onclick = () => goMonth(addMonths(state.month, -1));
  $('#nextMonth').onclick = () => goMonth(addMonths(state.month, 1));
  $('#thisMonth').onclick = () => goMonth(state.today.slice(0, 7));
  $('#fAccount').onchange = (e) => { state.account = e.target.value; loadMonth(); };
  $('#fSearch').oninput = (e) => { state.search = e.target.value; paintTransactions(); };
  $$('[data-new]').forEach((b) => { b.onclick = () => openTransaction(b.dataset.new); });
  $('#cards').onclick = (e) => { const b = e.target.closest('button[data-type]'); if (!b) return; state.type = b.dataset.type; paintTransactions(); };
  $('#list').onclick = async (e) => {
    const row = e.target.closest('tr[data-id]'); if (!row) return;
    const t = state.data.transactions.find((x) => x.id === row.dataset.id);
    if (e.target.closest('.pill') && write) {
      try { await call('setPaid', { id: t.id, paid: !t.paidDate }); await Promise.all([loadBase(), loadMonth()]); }
      catch (err) { toast(err.message, true); }
    } else if (e.target.closest('.open')) {
      openTransaction(t.type, t);
    }
  };
  return loadMonth();
}

function goMonth(ym) { state.month = ym; return loadMonth(); }

async function loadMonth() {
  const params = { month: state.month };
  if (state.account) params.accountId = state.account;
  try { state.data = await call('listMonth', params); }
  catch (err) { toast(err.message, true); return; }
  if ($('#list')) paintTransactions();
}

// Effect on the balance being displayed (all accounts, or the filtered one).
function effect(t) {
  if (t.type === 'income') return t.amount;
  if (t.type === 'expense') return -t.amount;
  if (!state.account) return 0;
  return t.accountId === state.account ? -t.amount : t.amount;
}
function status(t) {
  if (t.paidDate) return { cls: 'ok', txt: t.type === 'income' ? 'Received' : t.type === 'expense' ? 'Paid' : 'Done' };
  if (t.dueDate < state.today) return { cls: 'overdue', txt: 'Overdue' };
  return { cls: 'pending', txt: 'Pending' };
}

function paintTransactions() {
  const d = state.data, all = d.transactions, write = canWrite();
  $('#monthLabel').textContent = monthName(state.month);

  const t = { income: 0, expense: 0, transfer: 0, received: 0, paid: 0, transferDone: 0, pendIncome: 0, pendExpense: 0 };
  for (const x of all) {
    const done = !!x.paidDate;
    if (x.type === 'income') { t.income += x.amount; done ? (t.received += x.amount) : (t.pendIncome += x.amount); }
    else if (x.type === 'expense') { t.expense += x.amount; done ? (t.paid += x.amount) : (t.pendExpense += x.amount); }
    else { t.transfer += effect(x); if (done) t.transferDone += effect(x); }
  }
  const net = t.income - t.expense + t.transfer;
  const balance = d.previousBalance + t.received - t.paid + t.transferDone;
  const projected = d.previousProjected + net;

  const card = (type, label, value, cls, pending, pendLabel) => `
    <button class="card" data-type="${type}" aria-pressed="${state.type === type}">
      <span class="label">${label}</span>
      <span class="value ${cls}">${fmt(value)}</span>
      ${pending ? `<span class="note">${fmt(pending)} ${pendLabel}</span>` : ''}
    </button>`;
  $('#cards').innerHTML =
    card('', 'Net', net, net < 0 ? 'neg' : '', 0) +
    card('expense', 'Expenses', -t.expense, 'expense', t.pendExpense, 'to pay') +
    card('income', 'Income', t.income, 'income', t.pendIncome, 'to receive');

  // Running balance after each day, over every transaction of the month (not only the filtered ones).
  const byDay = new Map();
  let realized = d.previousBalance, proj = d.previousProjected;
  for (const x of all) { proj += effect(x); if (x.paidDate) realized += effect(x); byDay.set(x.date, { realized, proj }); }

  const q = state.search.trim().toLowerCase();
  const visible = all.filter((x) => {
    if (state.type && x.type !== state.type) return false;
    if (!q) return true;
    return [x.description, x.contact, category(x.categoryId)?.name, account(x.accountId)?.name, plain(x.amount)].join(' ').toLowerCase().includes(q);
  });

  let html = '';
  if (!visible.length) {
    html = `<div class="empty"><p>${all.length ? 'Nothing matches the filter.' : `No transactions in ${monthName(state.month)}.`}</p>
      ${all.length || !write ? '' : '<p class="hint">Use Income, Expense or Transfer to add the first one.</p>'}</div>`;
  } else {
    html = `<table class="tx"><thead><tr>
      <th class="c-type"><span class="sr">Type</span></th><th>Description</th><th class="c-cat">Category</th>
      <th class="c-account">Account</th><th class="num">Amount</th><th class="c-status">Status</th></tr></thead>`;
    let day = null;
    const closeDay = (date) => { const s = byDay.get(date); return `<tr class="daybalance"><td colspan="6">
      <span>Balance <strong class="${s.realized < 0 ? 'neg' : ''}">${fmt(s.realized)}</strong></span>
      ${s.proj !== s.realized ? `<span class="projected">Projected <strong>${fmt(s.proj)}</strong></span>` : ''}</td></tr>`; };
    for (const x of visible) {
      if (x.date !== day) {
        if (day) html += closeDay(day) + '</tbody>';
        day = x.date;
        const dt = new Date(day + 'T12:00:00Z');
        html += `<tbody><tr class="day"><th colspan="6" scope="rowgroup">${human(day)} <span>${DAYS[dt.getUTCDay()]}</span></th></tr>`;
      }
      const cat = category(x.categoryId), s = status(x), ef = effect(x);
      const value = x.type === 'transfer' && !state.account ? fmt(x.amount) : fmt(ef);
      const cls = x.type === 'transfer' ? (state.account && ef < 0 ? 'expense' : state.account ? 'income' : '') : x.type;
      const accounts = x.type === 'transfer'
        ? `${esc(account(x.accountId)?.name)} → ${esc(account(x.toAccountId)?.name)}` : esc(account(x.accountId)?.name);
      const desc = x.description || (x.type === 'transfer' ? 'Transfer between accounts' : '(no description)');
      html += `<tr class="row" data-id="${x.id}">
        <td class="c-type"><span class="type ${x.type}" title="${TYPE_NAME[x.type]}">${ICONS[x.type]}</span></td>
        <td class="c-desc"><button class="open">${esc(desc)}</button>${x.contact ? `<small>${esc(x.contact)}</small>` : ''}</td>
        <td class="c-cat">${cat ? `<span class="dot" style="background:${esc(cat.color)}"></span>${esc(cat.name)}` : '<span class="muted">–</span>'}</td>
        <td class="c-account">${accounts}</td>
        <td class="num value ${cls}">${value}</td>
        <td class="c-status"><button class="pill ${s.cls}" ${write ? '' : 'disabled'} title="${write ? (x.paidDate ? 'Mark as pending' : 'Mark as ' + (x.type === 'income' ? 'received' : 'paid')) : ''}">${x.paidDate ? ICONS.check : ''}${s.txt}</button></td>
      </tr>`;
    }
    html += closeDay(day) + '</tbody></table>';
  }
  $('#list').innerHTML = html;

  const item = (label, value, cls = '') => `<div><span>${label}</span><strong class="${cls}">${fmt(value)}</strong></div>`;
  $('#summary').innerHTML =
    item('Previous balance', d.previousBalance) + item('Received', t.received, 'income') + item('Paid', -t.paid, 'expense') +
    (state.account && t.transferDone ? item('Transfers', t.transferDone) : '') +
    item('Balance', balance, 'highlight' + (balance < 0 ? ' neg' : '')) + (projected !== balance ? item('Projected', projected) : '');
}

/* ------------------------------------------------------------------ transaction form */

function openTransaction(type, existing = null, duplicating = false) {
  const write = canWrite();
  const dlg = $('#dlg');
  const isNew = !existing || duplicating;
  const base = existing || {};
  const defaultDate = state.month === state.today.slice(0, 7) ? state.today : state.month + '-01';
  const due = base.dueDate || defaultDate;
  const defaultAccount = base.accountId || state.account || state.accounts[0]?.id;
  const doneLabel = { income: 'Received', expense: 'Paid', transfer: 'Done' }[type];
  const accountOptions = (sel) => state.accounts.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const defaultTo = base.toAccountId || state.accounts.find((a) => a.id !== defaultAccount)?.id;

  dlg.innerHTML = `
    <form class="form" novalidate>
      <header>
        <span class="type ${type}">${ICONS[type]}</span>
        <h2 id="dlgTitle">${isNew ? 'New' : write ? 'Edit' : ''} ${TYPE_NAME[type].toLowerCase()}</h2>
        <button type="button" class="btn icon close" aria-label="Close">✕</button>
      </header>
      <fieldset class="fields" ${write ? '' : 'disabled'} style="border:0;margin:0;min-width:0">
        <label class="wide">Description<input name="description" maxlength="200" autocomplete="off" value="${esc(base.description || '')}" placeholder="${type === 'transfer' ? 'Optional' : ''}"></label>
        <label>Amount<span class="with-prefix"><span>$</span><input name="amount" inputmode="numeric" autocomplete="off" placeholder="0.00" value="${base.amount ? plain(base.amount) : ''}"></span></label>
        <label>Date<input type="date" name="dueDate" value="${due}" required></label>
        ${type === 'transfer' ? `
          <label>From account<select name="accountId">${accountOptions(defaultAccount)}</select></label>
          <label>To account<select name="toAccountId">${accountOptions(defaultTo)}</select></label>
        ` : `
          <label>Category
            <select name="categoryId">
              <option value="">Uncategorized</option>
              ${state.categories.map((c) => `<option value="${c.id}" ${c.id === base.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              <option value="new">+ New category…</option>
            </select>
          </label>
          <label>Account<select name="accountId">${accountOptions(defaultAccount)}</select></label>
          <label class="wide" id="newCatField" hidden>New category name<input name="newCategory" maxlength="80" autocomplete="off"></label>
        `}
        <label class="toggle wide"><input type="checkbox" name="paid"> <span>${doneLabel}</span></label>
        <details ${base.contact || base.notes || (!isNew && (base.accrualDate !== base.dueDate || (base.paidDate && base.paidDate !== base.dueDate))) ? 'open' : ''}>
          <summary>More details</summary>
          <div class="fields">
            <label>Accrual date<input type="date" name="accrualDate" value="${base.accrualDate || due}"></label>
            <label>Payment date<input type="date" name="paidDate" value="${base.paidDate || ''}"></label>
            ${type === 'transfer' ? '' : `<label class="wide">${type === 'income' ? 'Customer' : 'Supplier'}<input name="contact" maxlength="120" autocomplete="off" value="${esc(base.contact || '')}"></label>`}
            <label class="wide">Notes<textarea name="notes" rows="2" maxlength="2000">${esc(base.notes || '')}</textarea></label>
          </div>
        </details>
        <p class="error" role="alert" hidden></p>
      </fieldset>
      <footer>
        ${isNew || !write ? '' : '<button type="button" class="btn danger-subtle" data-action="delete">Delete</button><button type="button" class="btn subtle" data-action="duplicate">Duplicate</button>'}
        <span class="space"></span>
        ${isNew && write ? '<button type="submit" class="btn" value="another">Save and add another</button>' : ''}
        ${write ? '<button type="submit" class="btn primary" value="save">Save</button>' : '<button type="button" class="btn close">Close</button>'}
      </footer>
    </form>`;

  const f = $('form', dlg), el = f.elements;
  moneyMask(el.amount);

  // "Paid", accrual date and payment date follow the Date until edited by hand. Paid defaults to today, never min(due, today).
  const follows = { paid: isNew, accrual: isNew || base.accrualDate === base.dueDate, paidDate: isNew || !base.paidDate };
  el.paid.checked = isNew ? due <= state.today : !!base.paidDate;
  const sync = () => {
    const date = el.dueDate.value;
    if (follows.paid && date) el.paid.checked = date <= state.today;
    if (follows.accrual) el.accrualDate.value = date;
    el.paidDate.disabled = !el.paid.checked;
    if (!el.paid.checked) el.paidDate.value = '';
    else if (follows.paidDate || !el.paidDate.value) el.paidDate.value = date <= state.today ? (isNew ? state.today : date) : state.today;
  };
  el.dueDate.addEventListener('input', sync);
  el.paid.addEventListener('change', () => { follows.paid = false; sync(); });
  el.accrualDate.addEventListener('input', () => { follows.accrual = false; });
  el.paidDate.addEventListener('input', () => { follows.paidDate = false; });
  sync();

  if (el.categoryId) {
    el.categoryId.addEventListener('change', () => {
      const isNewCat = el.categoryId.value === 'new';
      $('#newCatField', f).hidden = !isNewCat;
      if (isNewCat) el.newCategory.focus();
    });
  }
  const error = (msg, field) => { const p = $('.error', f); p.textContent = msg; p.hidden = false; if (field) field.focus(); };
  f.addEventListener('input', () => { $('.error', f).hidden = true; });

  let saving = false;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving || !write) return;
    const another = e.submitter && e.submitter.value === 'another';
    const amount = toCents(el.amount.value);
    if (amount <= 0) return error('Enter the amount.', el.amount);
    if (!el.dueDate.value) return error('Enter the date.', el.dueDate);
    if (type !== 'transfer' && !el.description.value.trim()) return error('Enter a description.', el.description);
    if (type === 'transfer' && el.accountId.value === el.toAccountId.value) return error('Choose different accounts.', el.toAccountId);
    if (el.categoryId && el.categoryId.value === 'new' && !el.newCategory.value.trim()) return error('Name the new category.', el.newCategory);
    saving = true;
    try {
      let categoryId = el.categoryId && el.categoryId.value ? el.categoryId.value : null;
      if (categoryId === 'new') {
        const name = el.newCategory.value.trim();
        const same = state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
        categoryId = same ? same.id : (await call('createCategory', { name })).id;
      }
      const body = {
        type, description: el.description.value, amount, dueDate: el.dueDate.value,
        accrualDate: el.accrualDate.value || el.dueDate.value,
        paidDate: el.paid.checked ? (el.paidDate.value || state.today) : null,
        accountId: el.accountId.value, toAccountId: el.toAccountId ? el.toAccountId.value : null,
        categoryId, contact: el.contact ? el.contact.value : '', notes: el.notes.value,
      };
      if (isNew) await call('createTransaction', body); else await call('updateTransaction', { id: existing.id, ...body });
      await loadBase();
      state.month = (body.paidDate || body.dueDate).slice(0, 7);
      if (state.account && state.account !== body.accountId && state.account !== body.toAccountId) state.account = '';
      if ($('#fAccount')) $('#fAccount').value = state.account;
      await loadMonth();
      toast(isNew ? `${TYPE_NAME[type]} saved.` : 'Changes saved.');
      if (another) openTransaction(type, { dueDate: body.dueDate, accountId: body.accountId, toAccountId: body.toAccountId, categoryId: body.categoryId }, true);
      else dlg.close();
    } catch (err) { error(err.message); }
    finally { saving = false; }
  });

  $$('.close', f).forEach((b) => { b.onclick = () => dlg.close(); });
  const del = $('[data-action="delete"]', f);
  if (del) {
    del.onclick = async () => {
      const desc = existing.description || TYPE_NAME[existing.type];
      if (!await confirm('Delete transaction?', `"${desc}" for ${fmt(existing.amount)} will be removed. This cannot be undone.`, 'Delete')) return;
      try { await call('deleteTransaction', { id: existing.id }); dlg.close(); await Promise.all([loadBase(), loadMonth()]); toast('Transaction deleted.'); }
      catch (err) { error(err.message); }
    };
    $('[data-action="duplicate"]', f).onclick = () => openTransaction(type, { ...existing, paidDate: null, dueDate: defaultDate, accrualDate: defaultDate }, true);
  }
  if (!dlg.open) dlg.showModal();
  if (duplicating && base.description) el.amount.select(); else el.description.focus();
}

/* ------------------------------------------------------------------ report */

function period(name) {
  const m = state.today.slice(0, 7);
  if (name === 'month') return [m + '-01', endOfMonth(m)];
  if (name === 'last') { const p = addMonths(m, -1); return [p + '-01', endOfMonth(p)]; }
  if (name === 'year') return [m.slice(0, 4) + '-01-01', m.slice(0, 4) + '-12-31'];
  return [addMonths(m, -5) + '-01', endOfMonth(m)];   // last 6 months
}

function renderReport() {
  const r = state.rep;
  if (!r.from) [r.from, r.to] = period('6m');
  $('#app').innerHTML = `
    <header class="top"><h1>Income and expenses by category</h1></header>
    <div class="bar">
      <div class="filters">
        <label>From<input type="date" id="rFrom" value="${r.from}"></label>
        <label>To<input type="date" id="rTo" value="${r.to}"></label>
        <label>Basis<select id="rBasis"><option value="cash">Cash (payment date)</option><option value="accrual">Accrual (includes pending)</option></select></label>
        <label>Account<select id="rAccount"><option value="">All</option>${state.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>
      </div>
      <div class="shortcuts" role="group" aria-label="Periods">
        <button class="btn subtle" data-p="month">This month</button>
        <button class="btn subtle" data-p="last">Last month</button>
        <button class="btn subtle" data-p="6m">Last 6 months</button>
        <button class="btn subtle" data-p="year">This year</button>
      </div>
    </div>
    <div id="reportBody"></div>`;
  $('#rBasis').value = r.basis; $('#rAccount').value = r.account;
  const change = () => { r.from = $('#rFrom').value; r.to = $('#rTo').value; r.basis = $('#rBasis').value; r.account = $('#rAccount').value; if (r.from && r.to) loadReport(); };
  ['#rFrom', '#rTo', '#rBasis', '#rAccount'].forEach((s) => { $(s).onchange = change; });
  $$('[data-p]').forEach((b) => { b.onclick = () => { [r.from, r.to] = period(b.dataset.p); $('#rFrom').value = r.from; $('#rTo').value = r.to; loadReport(); }; });
  return loadReport();
}

async function loadReport() {
  const r = state.rep;
  const params = { from: r.from, to: r.to, basis: r.basis };
  if (r.account) params.accountId = r.account;
  try { r.data = await call('report', params); } catch (err) { toast(err.message, true); return; }
  paintReport();
}

function arc(cx, cy, R, r, a0, a1) {
  if (a1 - a0 >= Math.PI * 2) a1 = a0 + Math.PI * 2 - 0.0001;
  const p = (radius, ang) => `${(cx + radius * Math.cos(ang)).toFixed(2)},${(cy + radius * Math.sin(ang)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z`;
}
function donut(group, key, title) {
  const total = group.total;
  let ang = -Math.PI / 2;
  const slices = group.categories.map((c, i) => {
    const a0 = ang; ang += (c.total / total) * Math.PI * 2;
    return `<path d="${arc(100, 100, 96, 62, a0, ang)}" fill="${esc(c.color)}" data-k="${key}${i}" data-tip="${esc(c.name)}|${fmt(c.total)}|${pct(c.total, total)}"/>`;
  }).join('');
  const summary = group.categories.slice(0, 5).map((c) => `${c.name} ${pct(c.total, total)}`).join(', ');
  return `<div class="donut"><svg viewBox="0 0 200 200" role="img" aria-label="${esc(title)} by category: ${esc(summary || 'none')}">
    ${total ? slices : '<circle cx="100" cy="100" r="79" fill="none" stroke="var(--border)" stroke-width="34"/>'}</svg>
    <div class="center"><span>${title}</span><strong>${fmt(total)}</strong></div></div>`;
}
function categoryTable(group, key) {
  if (!group.categories.length) return '<p class="empty small">No transactions in this period.</p>';
  const open = state.rep.open;
  return `<table class="cats"><thead><tr><th>Category</th><th class="num">Share</th><th class="num">Amount</th></tr></thead><tbody>
    ${group.categories.map((c, i) => {
      const k = key + ':' + c.id, isOpen = open.has(k);
      return `<tr class="cat" data-k="${key}${i}"><td><button class="expand" aria-expanded="${isOpen}" data-open="${esc(k)}">${ICONS.next}<span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</button></td>
        <td class="num">${pct(c.total, group.total)}</td><td class="num value">${fmt(c.total)}</td></tr>
      <tr class="items" ${isOpen ? '' : 'hidden'}><td colspan="3"><table>
        ${c.items.map((it) => `<tr><td class="date">${human(it.date)}</td><td>${esc(it.description || '(no description)')}${it.contact ? ` <span class="muted">· ${esc(it.contact)}</span>` : ''}</td><td class="num">${fmt(it.amount)}</td></tr>`).join('')}
      </table></td></tr>`;
    }).join('')}</tbody>
    <tfoot><tr><th scope="row">Total</th><td class="num">100%</td><td class="num value">${fmt(group.total)}</td></tr></tfoot></table>`;
}
function paintReport() {
  const d = state.rep.data, result = d.income.total - d.expense.total;
  $('#reportBody').innerHTML = `
    <p class="period">${human(d.from)} to ${human(d.to)}, ${d.basis === 'cash' ? 'cash basis (by payment date, paid only)' : 'accrual basis (by accrual date, pending included)'}. Transfers between accounts are not included.</p>
    <div class="cards">
      <div class="card"><span class="label">Income</span><span class="value income">${fmt(d.income.total)}</span></div>
      <div class="card"><span class="label">Expenses</span><span class="value expense">${fmt(-d.expense.total)}</span></div>
      <div class="card"><span class="label">Result</span><span class="value ${result < 0 ? 'neg' : ''}">${fmt(result)}</span></div>
    </div>
    <div class="two">
      <section class="panel"><div class="head"><h2>Income</h2></div>${donut(d.income, 'i', 'Income')}${categoryTable(d.income, 'i')}</section>
      <section class="panel"><div class="head"><h2>Expenses</h2></div>${donut(d.expense, 'e', 'Expenses')}${categoryTable(d.expense, 'e')}</section>
    </div>`;
  const body = $('#reportBody'), tip = $('#tip');
  const focus = (k) => {
    $$('[data-k]', body).forEach((n) => n.classList.toggle('focus', !!k && n.dataset.k === k));
    $$('.donut svg', body).forEach((svg) => svg.classList.toggle('focused', !!k && !!svg.querySelector(`[data-k="${k}"]`)));
  };
  body.onmousemove = (e) => {
    const slice = e.target.closest('path[data-k]'), row = e.target.closest('tr.cat');
    focus(slice ? slice.dataset.k : row ? row.dataset.k : null);
    if (!slice) { tip.hidden = true; return; }
    const [name, value, share] = slice.dataset.tip.split('|');
    tip.innerHTML = `<span class="dot" style="background:${slice.getAttribute('fill')}"></span><span>${esc(name)}</span><strong>${value}</strong><span class="muted">${share}</span>`;
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = (e.clientY + 16) + 'px';
  };
  body.onmouseleave = () => { tip.hidden = true; focus(null); };
  body.onclick = (e) => {
    const b = e.target.closest('[data-open]'); if (!b) return;
    const k = b.dataset.open, open = !state.rep.open.has(k);
    open ? state.rep.open.add(k) : state.rep.open.delete(k);
    b.setAttribute('aria-expanded', open);
    b.closest('tr').nextElementSibling.hidden = !open;
  };
}

/* ------------------------------------------------------------------ accounts & categories */

function renderSettings() {
  const write = canWrite();
  const total = state.accounts.reduce((s, a) => s + a.currentBalance, 0);
  $('#app').innerHTML = `
    <header class="top"><h1>Accounts &amp; categories</h1></header>
    <div class="two">
      <section class="panel">
        <div class="head"><h2>Accounts</h2>${write ? `<button class="btn" id="newAccount">${ICONS.plus} New account</button>` : ''}</div>
        <table class="cats"><thead><tr><th>Account</th><th class="num">Opening balance</th><th class="num">Current balance</th></tr></thead>
          <tbody>${state.accounts.map((a) => `<tr>
            <td>${write ? `<button class="expand" data-account="${a.id}">${esc(a.name)}</button>` : esc(a.name)}</td>
            <td class="num">${fmt(a.openingBalance)}</td>
            <td class="num value ${a.currentBalance < 0 ? 'neg' : ''}">${fmt(a.currentBalance)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th scope="row">Total</th><td></td><td class="num value">${fmt(total)}</td></tr></tfoot></table>
        <p class="hint" style="padding:0 16px 14px">The opening balance is what the account held before the first transaction recorded here. Changing it rewrites every balance.</p>
      </section>
      <section class="panel">
        <div class="head"><h2>Categories</h2>${write ? `<button class="btn" id="newCategory">${ICONS.plus} New category</button>` : ''}</div>
        ${state.categories.length ? `<table class="cats"><thead><tr><th>Category</th><th class="num">Transactions</th></tr></thead>
          <tbody>${state.categories.map((c) => `<tr>
            <td>${write ? `<button class="expand" data-category="${c.id}">` : ''}<span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}${write ? '</button>' : ''}</td>
            <td class="num">${c.uses}</td></tr>`).join('')}</tbody></table>` : '<p class="empty small">No categories yet.</p>'}
      </section>
    </div>`;
  if (!write) return;
  $('#newAccount').onclick = () => openEntity('account');
  $('#newCategory').onclick = () => openEntity('category');
  $$('[data-account]').forEach((b) => { b.onclick = () => openEntity('account', account(b.dataset.account)); });
  $$('[data-category]').forEach((b) => { b.onclick = () => openEntity('category', category(b.dataset.category)); });
}

function openEntity(kind, existing = null) {
  const dlg = $('#dlg'), isAccount = kind === 'account';
  const color = existing?.color || PALETTE[state.categories.length % PALETTE.length];
  dlg.innerHTML = `
    <form class="form" novalidate>
      <header><h2 id="dlgTitle">${existing ? 'Edit' : 'New'} ${kind}</h2><button type="button" class="btn icon close" aria-label="Close">✕</button></header>
      <div class="fields">
        <label class="wide">Name<input name="name" maxlength="80" autocomplete="off" value="${esc(existing?.name || '')}"></label>
        ${isAccount ? `
          <label class="wide">Opening balance<span class="with-prefix"><span>$</span><input name="opening" inputmode="numeric" autocomplete="off" placeholder="0.00" value="${existing ? plain(existing.openingBalance) : ''}"></span></label>` : `
          <fieldset class="colors wide"><legend>Color</legend>
            ${[...new Set([...PALETTE, color])].map((c) => `<label title="${c}"><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}
          </fieldset>`}
        <p class="error" role="alert" hidden></p>
      </div>
      <footer>
        ${existing ? '<button type="button" class="btn danger-subtle" data-action="delete">Delete</button>' : ''}
        <span class="space"></span>
        <button type="submit" class="btn primary">Save</button>
      </footer>
    </form>`;
  const f = $('form', dlg), el = f.elements;
  if (isAccount) moneyMask(el.opening, true);
  const error = (msg) => { const p = $('.error', f); p.textContent = msg; p.hidden = false; };
  const done = async (msg) => { dlg.close(); await loadBase(); renderSettings(); toast(msg); };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!el.name.value.trim()) { error('Enter the name.'); el.name.focus(); return; }
    const body = isAccount ? { name: el.name.value, openingBalance: toCents(el.opening.value) } : { name: el.name.value, color: el.color.value };
    const fn = (existing ? 'update' : 'create') + (isAccount ? 'Account' : 'Category');
    try { await call(fn, existing ? { id: existing.id, ...body } : body); await done(existing ? 'Changes saved.' : (isAccount ? 'Account created.' : 'Category created.')); }
    catch (err) { error(err.message); }
  });
  $('.close', f).onclick = () => dlg.close();
  const del = $('[data-action="delete"]', f);
  if (del) {
    del.onclick = async () => {
      if (!await confirm(`Delete ${kind}?`, `"${existing.name}" will be removed.`, 'Delete')) return;
      try { await call(isAccount ? 'deleteAccount' : 'deleteCategory', { id: existing.id }); await done(isAccount ? 'Account deleted.' : 'Category deleted.'); }
      catch (err) { error(err.message); }
    };
  }
  dlg.showModal();
  el.name.focus();
}

/* ------------------------------------------------------------------ routing */

const ROUTES = { transactions: renderTransactions, report: renderReport, settings: renderSettings };

async function render() {
  if (!state.user) { renderLogin(); return; }
  const route = location.hash.replace('#/', '');
  if (!ROUTES[route]) { location.replace('#/transactions'); return; }
  $('#nav').hidden = false; $('#who').hidden = false;
  $$('.sidebar nav a').forEach((a) => { if (a.dataset.route === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('#tip').hidden = true;
  try {
    const first = !state.today;
    await loadBase();
    if (first && state.latestMonth && state.latestMonth < state.month) {
      // Open on the current month; if it is empty, on the latest month that has data.
      const current = await call('listMonth', { month: state.month });
      if (!current.transactions.length) state.month = state.latestMonth;
    }
    await ROUTES[route]();
  } catch (err) {
    if (!state.user) return;
    $('#app').innerHTML = `<div class="empty"><p>Could not load the ledger.</p><p class="hint">${esc(err.message)}</p></div>`;
  }
}

window.addEventListener('hashchange', render);
render();
