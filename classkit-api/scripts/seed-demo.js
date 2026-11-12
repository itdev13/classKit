/**
 * Seed a demo studio into a running API started with GHL_MOCK=true + ALLOW_DEV_LOGIN=true.
 *   node scripts/seed-demo.js [http://localhost:3030] [locationId]
 * Then open the UI at  http://localhost:5175/?locationId=demo_studio
 */
const BASE = process.argv[2] || 'http://localhost:3030';
const LOC = process.argv[3] || 'demo_studio';
let token;

async function call(method, path, body, auth = true) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok || j.success === false) throw new Error(`${method} ${path}: ${j.error || r.status}`);
  return j;
}
const hook = (b) => call('POST', '/api/webhooks/ghl', { locationId: LOC, ...b }, false);
const at = (dayOffset, hour, min = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(hour, min, 0, 0); return d.toISOString(); };

const PEOPLE = [
  ['Priya Shah', '+15550101001'], ['Marcus Lee', '+15550101002'], ['Sofia Alvarez', '+15550101003'], ['Jordan Kim', '+15550101004'],
  ['Aisha Bello', '+15550101005'], ['Tom Becker', '+15550101006'], ['Lena Novak', '+15550101007'], ['Diego Ramos', '+15550101008'],
  ['Hana Sato', '+15550101009'], ['Chris Doyle', '+15550101010']
];

(async () => {
  token = (await call('POST', '/api/auth/verify', { locationId: LOC }, false)).token;
  await call('PUT', '/api/settings', {
    calendars: [
      { calendarId: 'cal_yoga', name: 'Vinyasa Yoga', enabled: true, capacity: 6, creditCost: 1, durationMins: 60 },
      { calendarId: 'cal_hiit', name: 'HIIT Bootcamp', enabled: true, capacity: 12, creditCost: 1, durationMins: 45 }
    ],
    buyUrl: 'https://demo-studio.example/class-packs',
    brand: { name: 'Flow & Fire Studio', color: '#5B4BDB' },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  });
  const existing = (await call('GET', '/api/packages')).packages;
  if (!existing.length) {
    await call('POST', '/api/packages', { name: '10-Class Pack', kind: 'pack', credits: 10, validityDays: 90, priceUsd: 150, ghlProductIds: ['prod_10pack'] });
    await call('POST', '/api/packages', { name: 'Unlimited Monthly', kind: 'unlimited', validityDays: 31, priceUsd: 129, ghlProductIds: ['prod_unlimited'] });
    await call('POST', '/api/packages', { name: 'Drop-in', kind: 'dropin', credits: 1, validityDays: 30, priceUsd: 22 });
  }
  await call('POST', '/api/settings/complete-setup');

  const ids = [];
  for (const [name, phone] of PEOPLE) ids.push((await call('POST', '/api/members', { name, phone })).member.contactId);

  // Purchases (Diego + Chris have none → shows "no credits" path).
  for (let i = 0; i < 8; i++) await hook({ type: 'OrderCreate', _id: `demo_ord_${LOC}_${i}`, contactId: ids[i], status: 'completed', items: [{ product: { _id: i === 2 ? 'prod_unlimited' : 'prod_10pack' }, price: { amount: i === 2 ? 129 : 150 }, qty: 1 }] });

  // Past classes: attended + one no-show → history and reports.
  let n = 0;
  const book = (cid, cal, start) => hook({ type: 'AppointmentCreate', appointment: { id: `demo_${LOC}_${n++}`, calendarId: cal, contactId: cid, startTime: start, endTime: new Date(new Date(start).getTime() + 3600e3).toISOString(), appointmentStatus: 'confirmed' } });
  for (const d of [-6, -4, -2]) {
    for (let i = 0; i < 5; i++) {
      const r = await book(ids[i], 'cal_yoga', at(d, 7));
      void r;
    }
  }
  // Mark the past ones attended (except a couple of no-shows) through the staff API.
  const past = await call('GET', `/api/classes?from=${encodeURIComponent(at(-7, 0))}&to=${encodeURIComponent(at(-1, 23))}`);
  let k = 0;
  for (const s of past.sessions) for (const r of s.roster) {
    if (k++ % 7 === 3) await call('POST', `/api/classes/bookings/${r.bookingId}/noshow`);
    else await call('POST', `/api/classes/bookings/${r.bookingId}/checkin`);
  }

  // Today: a nearly-now yoga class (kiosk demo) that is full, plus an evening HIIT class.
  const now = new Date();
  const soon = new Date(now.getTime() + 20 * 60000); soon.setSeconds(0, 0);
  for (let i = 0; i < 6; i++) await book(ids[i], 'cal_yoga', soon.toISOString());
  for (const i of [1, 3, 5, 6, 7]) await book(ids[i], 'cal_hiit', at(0, 18));
  await book(ids[8], 'cal_hiit', at(0, 18)); // Diego — no credits → blocked
  // Waitlist for the full class.
  await call('POST', '/api/classes/waitlist', { calendarId: 'cal_yoga', startTime: soon.toISOString(), contactId: ids[6] });
  await call('POST', '/api/classes/waitlist', { calendarId: 'cal_yoga', startTime: soon.toISOString(), contactId: ids[7] });
  // Tomorrow.
  for (const i of [0, 4, 6]) await book(ids[i], 'cal_yoga', at(1, 7));

  console.log(`Seeded demo studio "${LOC}".`);
  console.log(`Admin UI:  http://localhost:5175/?locationId=${LOC}`);
  const s = (await call('GET', '/api/settings')).settings;
  console.log(`Kiosk:     ${s.kioskUrl}   (try 555-010-1001)`);
  console.log(`Schedule:  ${s.scheduleUrl}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
