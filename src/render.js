// Server-side HTML: a tagged template that escapes every interpolation unless it is already HTML (raw / nested h``).
import { readFileSync, existsSync } from 'node:fs';

export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const render = (v) => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(render).join('') : v == null || v === false ? '' : esc(v);
export const h = (strings, ...vals) => raw(strings.reduce((acc, s, i) => acc + s + (i < vals.length ? render(vals[i]) : ''), ''));

export const CUSTOM_INTERFACE = 1;
export function loadCustom() {
  let labels = {}, themeVersion = null, logo = null;
  try { labels = JSON.parse(readFileSync('custom/labels.json', 'utf8')); } catch { /* defaults below */ }
  try { themeVersion = Number((readFileSync('custom/theme.css', 'utf8').match(/firmbook-custom-interface:\s*(\d+)/) || [])[1]); } catch { /* none */ }
  for (const f of ['logo.svg', 'logo.png']) if (existsSync(`custom/${f}`)) { logo = `/custom/${f}`; break; }
  const l = { appName: 'Firmbook', invoiceTitle: 'Invoice', billTitle: 'Bill', thisWeek: 'This week', invoiceFooter: '', ...labels };
  const mismatch = (labels.interface ?? null) !== CUSTOM_INTERFACE || themeVersion !== CUSTOM_INTERFACE;
  return { labels: l, logo, mismatch, labelsVersion: labels.interface ?? null, themeVersion };
}

export function layout({ title, body, user, labels, logo, flash, active = '', noindex = false, wide = false }) {
  const nav = user ? [['/', labels.thisWeek], ['/invoices', 'Invoices'], ['/payments', 'Payments'], ['/bills', 'Bills'], ['/contacts', 'Contacts'], ['/settings', 'Settings']] : [];
  return '<!doctype html>' + h`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${labels.appName}</title>${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
<link rel="stylesheet" href="/custom/theme.css"><link rel="stylesheet" href="/static/app.css"></head>
<body><header class="top"><a class="brand" href="/">${logo ? h`<img src="${logo}" alt="" height="28">` : ''}${labels.appName}</a>
<nav>${nav.map(([href, label]) => h`<a href="${href}" class="${active === href ? 'on' : ''}">${label}</a>`)}</nav>
${user ? h`<form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${user.csrf}"><span class="who">${user.name} · ${user.role}</span><button class="link">Log out</button></form>` : ''}</header>
${flash ? h`<div class="flash ${flash.kind}">${flash.text}</div>` : ''}
<main class="${wide ? 'wide' : ''}">${body}</main>
<footer class="foot">${labels.appName} · <a href="https://github.com/templates-back4app/firmbook" rel="noopener">source</a></footer></body></html>`;
}

/** Minimal public page (share links, unavailable screen): no navigation, no third-party assets. */
export function bare({ title, body, labels, noindex = true }) {
  return '<!doctype html>' + h`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
<link rel="stylesheet" href="/custom/theme.css"><link rel="stylesheet" href="/static/app.css"></head><body class="bare"><main>${body}</main></body></html>`;
}

export const field = (label, input) => h`<label class="f"><span>${label}</span>${input}</label>`;
export const input = (name, value = '', attrs = '') => h`<input name="${name}" value="${value}" ${raw(attrs)}>`;
export const select = (name, options, value) => h`<select name="${name}">${options.map(([v, l]) => h`<option value="${v}" ${String(v) === String(value) ? raw('selected') : ''}>${l}</option>`)}</select>`;
export const hidden = (name, value) => h`<input type="hidden" name="${name}" value="${value}">`;
export const button = (label, cls = 'btn') => h`<button class="${cls}">${label}</button>`;
/** A POST form that carries the CSRF token and a one-time key; `once` is created by the route. */
export const form = (action, user, once, body, attrs = '') => h`<form method="post" action="${action}" ${raw(attrs)}>${hidden('_csrf', user.csrf)}${once ? hidden('_once', once) : ''}${body}</form>`;
export const badge = (text, kind = '') => h`<span class="badge ${kind}">${text}</span>`;
