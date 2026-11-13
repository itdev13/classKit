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
