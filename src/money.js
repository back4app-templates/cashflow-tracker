// Money and date arithmetic. Cents and thousandths are integers; rounding is half-up (Math.round on non-negative values).
export const roundHalfUp = (x) => Math.round(x);

export function fmtMoney(cents, symbol = '$') {
  const n = Number(cents || 0), sign = n < 0 ? '−' : '';
  const abs = Math.abs(n), whole = Math.floor(abs / 100).toLocaleString('en-US'), frac = String(abs % 100).padStart(2, '0');
  return `${sign}${symbol}${whole}.${frac}`;
}
/** "1,234.56" → 123456 cents; NaN when not a money amount. */
export function parseMoney(s) {
  const t = String(s ?? '').trim().replace(/[,$\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return NaN;
  const neg = t.startsWith('-'), [w, f = ''] = t.replace('-', '').split('.');
  const cents = Number(w) * 100 + Number(f.padEnd(2, '0'));
  return neg ? -cents : cents;
}
export function parseQty(s) {
  const t = String(s ?? '1').trim();
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return NaN;
  const [w, f = ''] = t.split('.');
  return Number(w) * 1000 + Number(f.padEnd(3, '0'));
}
export const fmtQty = (milli) => (Number(milli) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });
export const fmtRate = (bp) => `${(Number(bp) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;

/**
 * One invoice line. Exclusive: net = qty × unit, tax = round(net × rate), gross = net + tax.
 * Inclusive: gross = qty × unit (what the customer sees), net = round(gross ÷ (1 + rate)), tax = gross − net.
 */
export function lineTotals({ qtyMilli, unitCents, rateBp, inclusive }) {
  const base = roundHalfUp((Number(qtyMilli) * Number(unitCents)) / 1000);
  const rate = Number(rateBp) / 10000;
  if (inclusive) { const net = roundHalfUp(base / (1 + rate)); return { net, tax: base - net, gross: base }; }
  const tax = roundHalfUp(base * rate);
  return { net: base, tax, gross: base + tax };
}
export function sumTotals(lines) {
  return lines.reduce((a, l) => ({ subtotal: a.subtotal + l.net, tax: a.tax + l.tax, total: a.total + l.gross }), { subtotal: 0, tax: 0, total: 0 });
}

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export function todayIn(tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  const ymd = `${get('year')}-${get('month')}-${get('day')}`;
  if (!isDate(ymd)) throw new Error(`todayIn produced "${ymd}"`);
  return ymd;
}
export function addDays(ymd, n) { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const fmtDate = (ymd) => ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
export const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '').slice(0, 10));
