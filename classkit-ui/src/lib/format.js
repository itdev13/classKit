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
export const money = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n) || 0);
export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}
export function isUnlimited(m) { return !!(m?.unlimitedUntil && new Date(m.unlimitedUntil) > new Date()); }
export function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
