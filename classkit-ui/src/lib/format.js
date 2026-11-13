export function fmtTime(d, tz) {
  if (!d) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined }).format(new Date(d));
}
export function fmtDay(d, tz) {
  if (!d) return '';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz || undefined }).format(new Date(d));
}
export function fmtDate(d, tz) {
  if (!d) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz || undefined }).format(new Date(d));
}
export function fmtDateTime(d, tz) {
  if (!d) return '—';
  return `${fmtDay(d, tz)}, ${fmtTime(d, tz)}`;
}
export function fromNow(d) {
  if (!d) return 'never';
  const days = Math.round((Date.now() - new Date(d)) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const m = Math.round(days / 30);
  return `${m} month${m > 1 ? 's' : ''} ago`;
}
// The studio's business currency (from HighLevel or Settings). Set once at sign-in.
let currentCurrency = 'USD';
export function setCurrency(code) { if (code) currentCurrency = String(code).toUpperCase(); }
export const getCurrency = () => currentCurrency;
export function money(n, currency = currentCurrency) {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v);
  } catch {
    return `${currency} ${v.toLocaleString()}`;
  }
}
export function currencySymbol(code) {
  try {
    const part = new Intl.NumberFormat(undefined, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((x) => x.type === 'currency');
    return part ? part.value : code;
  } catch { return code; }
}
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'INR', 'AED', 'SGD', 'ZAR', 'BRL', 'MXN', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'PHP', 'MYR', 'NGN'];
export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}
export function isUnlimited(m) { return !!(m?.unlimitedUntil && new Date(m.unlimitedUntil) > new Date()); }
export function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// ── Studio time zone helpers (the studio's day, not the viewer's computer's day) ──
function tzParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return p;
}
/** Milliseconds the zone is ahead of UTC at `date`. */
function tzOffset(date, tz) {
  const p = tzParts(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}
/** The instant that is wall-clock y-m-d h:m in `tz`. */
export function zonedTime(y, m, d, h = 0, min = 0, tz) {
  let t = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) t = Date.UTC(y, m - 1, d, h, min) - tzOffset(new Date(t), tz);
  return new Date(t);
}
export function startOfDayTz(date = new Date(), tz) {
  const p = tzParts(date, tz);
  return zonedTime(p.year, p.month, p.day, 0, 0, tz);
}
export function addDaysTz(day, n, tz) {
  return startOfDayTz(new Date(day.getTime() + n * 864e5 + 12 * 3600e3), tz);
}
/** 'YYYY-MM-DDTHH:mm' for a datetime-local input, in the studio's zone. */
export function toZonedInput(date, tz) {
  const p = tzParts(date, tz);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
export function fromZonedInput(value, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!m) return null;
  return zonedTime(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}
