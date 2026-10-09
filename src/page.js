import { layout, bare, h, loadCustom } from './render.js';
import { fmtMoney } from './money.js';

export function page(req, res, { title, body, active = '', status = 200, wide = false, noindex = false }) {
  const { labels, logo } = req.app.locals.custom;
  res.status(status).type('html').send(layout({ title, body, user: req.user, labels, logo, flash: req.flash, active, wide, noindex }));
}
export function barePage(req, res, { title, body, status = 200 }) {
  res.status(status).type('html').send(bare({ title, body, labels: req.app.locals.custom.labels }));
}
export const money = (req, cents) => fmtMoney(cents, req.settings.currency_symbol);
export const forbidden = (req, msg = 'You do not have permission to do that.') =>
  layout({ title: 'Not allowed', body: h`<h1>Not allowed</h1><p>${msg}</p><p><a href="/">Back</a></p>`, user: req.user, labels: req.app.locals.custom.labels, logo: req.app.locals.custom.logo });
export const refreshCustom = (app) => { app.locals.custom = loadCustom(); };
