/* End-to-end tests against a real MongoDB (MONGODB_TEST_URI, default local) with GHL mocked.
 * Run: npm test   (needs a local mongod) */
process.env.GHL_MOCK = 'true';
process.env.ALLOW_DEV_LOGIN = 'true';
process.env.JWT_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'error';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const database = require('../src/config/database');
const { createApp } = require('../src/app');
const mock = require('../src/services/ghlMock');
const creditService = require('../src/services/creditService');
const scheduler = require('../src/jobs/scheduler');
const Workspace = require('../src/models/Workspace');
const CreditLot = require('../src/models/CreditLot');
const Booking = require('../src/models/Booking');
const WaitlistEntry = require('../src/models/WaitlistEntry');
const Member = require('../src/models/Member');

const LOC = 'loc_test';
const HOUR = 3600e3;
let server;
let base;
let token;

async function call(method, path, body, { auth = true } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}
const hook = (body) => call('POST', '/api/webhooks/ghl', { locationId: LOC, ...body }, { auth: false });
const balance = async (contactId) => (await creditService.getBalance(LOC, contactId)).balance;
const inHours = (h) => new Date(Date.now() + h * HOUR).toISOString();
const appt = (id, contactId, startTime, extra = {}) => ({
  type: 'AppointmentCreate', appointment: { id, calendarId: 'cal_yoga', contactId, startTime, endTime: new Date(new Date(startTime).getTime() + HOUR).toISOString(), appointmentStatus: 'confirmed', ...extra }
});
const order = (id, contactId, productId = 'prod_10pack') => ({
  type: 'OrderCreate', _id: id, contactId, status: 'completed', items: [{ product: { _id: productId }, price: { _id: 'p', amount: 150 }, qty: 1 }]
});

test.before(async () => {
  await database.connect(process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/classkit_test');
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server?.close();
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

test('setup: dev login, calendars, packages, go live', async () => {
  const v = await call('POST', '/api/auth/verify', { locationId: LOC }, { auth: false });
  assert.equal(v.status, 200);
  token = v.body.token;
  assert.equal(v.body.user.role, 'admin');

  const cals = await call('GET', '/api/settings/calendars');
  assert.equal(cals.body.calendars.length, 3);

  const put = await call('PUT', '/api/settings', {
    calendars: [{ calendarId: 'cal_yoga', name: 'Vinyasa Yoga', enabled: true, capacity: 3, creditCost: 1, durationMins: 60 }],
    policy: { cancelWindowHours: 12, lowCreditThreshold: 2 },
    buyUrl: 'https://studio.example/buy'
  });
  assert.equal(put.status, 200);

  const p1 = await call('POST', '/api/packages', { name: '10-Class Pack', kind: 'pack', credits: 10, validityDays: 90, priceUsd: 150, ghlProductIds: ['prod_10pack'] });
  const p2 = await call('POST', '/api/packages', { name: 'Unlimited Monthly', kind: 'unlimited', validityDays: 30, priceUsd: 129, ghlProductIds: ['prod_unlimited'] });
  assert.equal(p1.status, 200);
  assert.equal(p2.status, 200);

  const done = await call('POST', '/api/settings/complete-setup');
  assert.equal(done.body.settings.setupComplete, true);
  assert.ok(done.body.settings.customFieldIds.credits, 'credits custom field created');
});

test('paid order grants credits once, even if GHL delivers it twice', async () => {
  await hook(order('ord_1', 'c_priya'));
  await hook(order('ord_1', 'c_priya'));
  assert.equal(await balance('c_priya'), 10);
  const unpaid = await hook({ ...order('ord_2', 'c_priya'), status: 'pending' });
  assert.equal(unpaid.body.ignored, 'not_paid');
  assert.equal(await balance('c_priya'), 10);
  assert.ok(mock.calls.some((c) => c.endpoint === '/conversations/messages' && /10 classes/.test(c.data.message)), 'purchase SMS sent');
});

test('booking spends a credit; duplicate webhook does not spend twice', async () => {
  await hook(appt('a_1', 'c_priya', inHours(48)));
  await hook(appt('a_1', 'c_priya', inHours(48)));
  assert.equal(await balance('c_priya'), 9);
});

test('calendars not on credits are ignored', async () => {
  const r = await hook({ ...appt('a_x', 'c_priya', inHours(48)), appointment: { id: 'a_x', calendarId: 'cal_consult', contactId: 'c_priya', startTime: inHours(48) } });
  assert.equal(r.body.ignored, 'calendar_not_on_credits');
  assert.equal(await balance('c_priya'), 9);
});

test('cancel outside the window refunds; inside the window keeps the credit', async () => {
  await hook({ type: 'AppointmentUpdate', appointment: { id: 'a_1', calendarId: 'cal_yoga', contactId: 'c_priya', startTime: inHours(48), appointmentStatus: 'cancelled' } });
  assert.equal(await balance('c_priya'), 10);

  await hook(appt('a_2', 'c_priya', inHours(3)));
  assert.equal(await balance('c_priya'), 9);
  const late = await hook({ type: 'AppointmentUpdate', appointment: { id: 'a_2', calendarId: 'cal_yoga', contactId: 'c_priya', startTime: inHours(3), appointmentStatus: 'cancelled' } });
  assert.equal(late.body.lateCancel, true);
  assert.equal(await balance('c_priya'), 9);

  // Staff override refunds even inside the window.
  await hook(appt('a_3', 'c_priya', inHours(2)));
  const b = await Booking.findOne({ appointmentId: 'a_3' });
  const r = await call('POST', `/api/classes/bookings/${b._id}/cancel`, { refund: true });
  assert.equal(r.body.refunded, true);
  assert.equal(await balance('c_priya'), 9);
});

test('no credits: booking is blocked and the appointment cancelled in GHL', async () => {
  mock.reset();
  const r = await hook(appt('a_broke', 'c_broke', inHours(24)));
  assert.equal(r.body.rejected, true);
  assert.ok(mock.calls.some((c) => c.method === 'PUT' && c.endpoint.endsWith('/a_broke') && c.data.appointmentStatus === 'cancelled'));
  // Our own cancellation echoing back as a webhook must not refund anything.
  const echo = await hook({ type: 'AppointmentUpdate', appointment: { id: 'a_broke', calendarId: 'cal_yoga', contactId: 'c_broke', startTime: inHours(24), appointmentStatus: 'cancelled' } });
  assert.equal(echo.body.ignored, 'not_booked');
  assert.equal(await balance('c_broke'), 0);
});

test('concurrent bookings never overspend', async () => {
  await creditService.grant({ locationId: LOC, contactId: 'c_race', credits: 3, validityDays: 30, kind: 'manual', idempotencyKey: 'race-grant' });
  const results = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => hook(appt(`race_${i}`, 'c_race', inHours(30 + i)))));
  const booked = results.filter((r) => r.body.booked).length;
  assert.equal(booked, 3);
  assert.equal(await balance('c_race'), 0);
  const lots = await CreditLot.find({ contactId: 'c_race' });
  assert.ok(lots.every((l) => l.remaining >= 0));
});

test('credits are spent soonest-expiring first', async () => {
  await creditService.grant({ locationId: LOC, contactId: 'c_fifo', credits: 2, validityDays: 60, kind: 'manual', idempotencyKey: 'fifo-a' });
  const { lot: soon } = await creditService.grant({ locationId: LOC, contactId: 'c_fifo', credits: 2, validityDays: 10, kind: 'manual', idempotencyKey: 'fifo-b' });
  await hook(appt('fifo_1', 'c_fifo', inHours(24)));
  const after = await CreditLot.findById(soon._id);
  assert.equal(after.remaining, 1);
});

test('unlimited membership covers classes at zero cost', async () => {
  await hook(order('ord_unl', 'c_unl', 'prod_unlimited'));
  const r = await hook(appt('unl_1', 'c_unl', inHours(24)));
  assert.equal(r.body.unlimited, true);
  const m = await call('GET', '/api/members/c_unl');
  assert.ok(m.body.member.unlimitedUntil);
});

test('waitlist: a cancellation promotes the next member with credits', async () => {
  const start = inHours(72);
  for (const c of ['c_w1', 'c_w2', 'c_w3', 'c_w4', 'c_w5']) {
    await creditService.grant({ locationId: LOC, contactId: c, credits: 5, validityDays: 30, kind: 'manual', idempotencyKey: `wl-${c}` });
  }
  await hook(appt('wl_1', 'c_w1', start));
  await hook(appt('wl_2', 'c_w2', start));
  await hook(appt('wl_3', 'c_w3', start));

  const ws = await Workspace.findOne({ locationId: LOC });
  const slug = ws.publicSlug;
  // Public waitlist join (creates the contact in GHL), then a staff-side join for c_w4.
  const pub = await call('POST', `/api/public/schedule/${slug}/waitlist`, { calendarId: 'cal_yoga', startTime: start, name: 'Pat Public', phone: '+1 555 010 9999' }, { auth: false });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.position, 1);
  const staff = await call('POST', '/api/classes/waitlist', { calendarId: 'cal_yoga', startTime: start, contactId: 'c_w4' });
  assert.equal(staff.body.position, 2);

  // Pat has no credits → skipped; c_w4 gets the seat.
  await hook({ type: 'AppointmentUpdate', appointment: { id: 'wl_2', calendarId: 'cal_yoga', contactId: 'c_w2', startTime: start, appointmentStatus: 'cancelled' } });
  const promoted = await WaitlistEntry.findOne({ contactId: 'c_w4' });
  assert.equal(promoted.status, 'promoted');
  const skipped = await WaitlistEntry.findOne({ name: 'Pat Public' });
  assert.equal(skipped.status, 'skipped');
  assert.equal(await balance('c_w4'), 4);
  const seated = await Booking.countDocuments({ calendarId: 'cal_yoga', startTime: new Date(start), status: 'booked' });
  assert.equal(seated, 3);

  // The class is full again: the public schedule reports it.
  const sched = await call('GET', `/api/public/schedule/${slug}`, null, { auth: false });
  const s = sched.body.sessions.find((x) => x.startTime === new Date(start).toISOString());
  assert.equal(s.full, true);
});

test('kiosk check-in by phone', async () => {
  mock.contacts.set('c_kiosk', { id: 'c_kiosk', firstName: 'Kim', lastName: 'Lee', phone: '+1 (555) 222-3344' });
  await creditService.grant({ locationId: LOC, contactId: 'c_kiosk', credits: 4, validityDays: 30, kind: 'manual', idempotencyKey: 'kiosk-grant' });
  await hook(appt('kiosk_1', 'c_kiosk', inHours(0.5)));
  const ws = await Workspace.findOne({ locationId: LOC });

  const boot = await call('GET', `/api/public/kiosk/${ws.kioskToken}`, null, { auth: false });
  assert.ok(boot.body.sessions.length >= 1);

  const r = await call('POST', `/api/public/kiosk/${ws.kioskToken}/checkin`, { phone: '555-222-3344' }, { auth: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.firstName, 'Kim');
  assert.equal(r.body.credits, 3);
  const again = await call('POST', `/api/public/kiosk/${ws.kioskToken}/checkin`, { phone: '5552223344' }, { auth: false });
  assert.equal(again.body.alreadyCheckedIn, true);
  const m = await Member.findOne({ contactId: 'c_kiosk' });
  assert.equal(m.visits, 1);

  const bad = await call('POST', '/api/public/kiosk/not-a-token/checkin', { phone: '5552223344' }, { auth: false });
  assert.equal(bad.status, 404);
});

test('workflow action add-credits is idempotent per execution', async () => {
  const body = { data: { credits: 5, note: 'Referral bonus' }, extras: { locationId: LOC, contactId: 'c_wf', workflowId: 'wf1', executionId: 'ex1' } };
  await call('POST', '/api/workflows/actions/add-credits', body, { auth: false });
  const r = await call('POST', '/api/workflows/actions/add-credits', body, { auth: false });
  assert.equal(r.status, 200);
  assert.equal(await balance('c_wf'), 5);
  const bad = await call('POST', '/api/workflows/actions/remove-credits', { data: { credits: 50 }, extras: { locationId: LOC, contactId: 'c_wf', workflowId: 'wf1', executionId: 'ex2' } }, { auth: false });
  assert.equal(bad.status, 400);
});

test('manual adjust needs a reason and can remove across lots', async () => {
  const noReason = await call('POST', '/api/members/c_fifo/adjust', { delta: -1 });
  assert.equal(noReason.status, 400);
  const before = await balance('c_fifo');
  const r = await call('POST', '/api/members/c_fifo/adjust', { delta: -2, note: 'Correction' });
  assert.equal(r.status, 200);
  assert.equal(await balance('c_fifo'), before - 2);
});

test('scheduler expires lots, sends one reminder, and marks no-shows', async () => {
  // A lot expiring in 3 days → one reminder; an already-expired lot → expired.
  const { lot: soon } = await creditService.grant({ locationId: LOC, contactId: 'c_exp', credits: 3, validityDays: 3, kind: 'manual', idempotencyKey: 'exp-soon' });
  const { lot: old } = await creditService.grant({ locationId: LOC, contactId: 'c_exp', credits: 2, validityDays: 1, kind: 'manual', idempotencyKey: 'exp-old', startsAt: new Date(Date.now() - 2 * 864e5) });
  // A past class nobody checked in to.
  await creditService.grant({ locationId: LOC, contactId: 'c_ns', credits: 2, validityDays: 30, kind: 'manual', idempotencyKey: 'ns-grant', startsAt: new Date(Date.now() - 864e5) });
  await hook(appt('ns_1', 'c_ns', new Date(Date.now() - 3 * HOUR).toISOString()));

  const t1 = await scheduler.tick();
  assert.ok(t1.expired >= 1);
  assert.equal((await CreditLot.findById(old._id)).status, 'expired');
  assert.ok((await CreditLot.findById(soon._id)).expiringNotifiedAt);
  assert.equal(await balance('c_exp'), 3);
  assert.equal((await Booking.findOne({ appointmentId: 'ns_1' })).status, 'noshow');

  const t2 = await scheduler.tick();
  assert.equal(t2.reminders, 0, 'reminder is sent only once');
});

test('reports summarize the period', async () => {
  const r = await call('GET', '/api/reports?days=30');
  assert.equal(r.status, 200);
  assert.ok(r.body.report.creditsSold >= 10);
  assert.ok(r.body.report.attended >= 0);
  assert.ok(r.body.report.lateCancels >= 1);
});

test('tenant isolation: another location cannot read this one', async () => {
  const v = await call('POST', '/api/auth/verify', { locationId: 'loc_other' }, { auth: false });
  const saved = token;
  token = v.body.token;
  const m = await call('GET', '/api/members?q=Kim');
  assert.equal(m.body.total, 0);
  token = saved;
});

test('a class earlier than the purchase can still use the pack (back-dated staff record)', async () => {
  await hook(order('ord_back', 'c_back'));
  const r = await hook(appt('back_1', 'c_back', new Date(Date.now() - 5 * HOUR).toISOString()));
  assert.equal(r.body.booked, true);
  assert.equal(await balance('c_back'), 9);
});

test('check-in records the class time as the last visit and the ledger names the class', async () => {
  await creditService.grant({ locationId: LOC, contactId: 'c_visit', credits: 2, validityDays: 30, kind: 'manual', idempotencyKey: 'visit-grant' });
  const past = new Date(Date.now() - 3 * 864e5);
  await hook(appt('visit_1', 'c_visit', past.toISOString()));
  const b = await Booking.findOne({ appointmentId: 'visit_1' });
  await call('POST', `/api/classes/bookings/${b._id}/checkin`);
  const m = await Member.findOne({ contactId: 'c_visit' });
  assert.equal(+m.lastVisitAt, +past);
  const d = await call('GET', '/api/members/c_visit');
  assert.match(d.body.ledger.find((e) => e.reason === 'booking').note, /Vinyasa Yoga/);
});

test('agency install: each sub-account INSTALL is linked to the agency so its token can be minted', async () => {
  const CompanyLocation = require('../src/models/CompanyLocation');
  await CompanyLocation.create({ companyId: 'agency_1', locationIds: ['loc_a'] });
  await call('POST', '/api/webhooks/ghl', { type: 'INSTALL', appId: 'app1', companyId: 'agency_1', locationId: 'loc_b', userId: 'u1' }, { auth: false });
  await call('POST', '/api/webhooks/ghl', { type: 'INSTALL', appId: 'app1', companyId: 'agency_1', locationId: 'loc_b', userId: 'u1' }, { auth: false });
  const cl = await CompanyLocation.findOne({ companyId: 'agency_1' });
  assert.deepEqual([...cl.locationIds].sort(), ['loc_a', 'loc_b']);
  assert.ok(await Workspace.exists({ locationId: 'loc_b', companyId: 'agency_1', active: true }));
});

test('currency: learned from a paid order, owner choice in Settings wins', async () => {
  const cur = async () => (await call('GET', '/api/settings')).body.settings.currency;
  await Workspace.updateOne({ locationId: LOC }, { currency: null, currencyLocked: false });
  assert.equal(await cur(), 'USD');
  await hook({ ...order('cur_1', 'c_cur'), currency: 'inr' });
  assert.equal(await cur(), 'INR');
  assert.equal((await call('PUT', '/api/settings', { currency: 'XYZ1' })).status, 400);
  const saved = await call('PUT', '/api/settings', { currency: 'EUR' });
  assert.equal(saved.body.settings.currency, 'EUR');
  assert.equal(saved.body.settings.currencyLocked, true);
  await hook({ ...order('cur_2', 'c_cur'), currency: 'INR' });
  assert.equal(await cur(), 'EUR');
});

test('member search finds HighLevel contacts who are not members yet', async () => {
  mock.contacts.set('ghl_only', { id: 'ghl_only', firstName: 'Testdd', lastName: 'Rao', email: 'testdd@example.com', phone: '+15550109999' });
  const found = await call('GET', '/api/members/contacts?q=testdd@');
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.contacts.map((c) => c.contactId), ['ghl_only']);
  const picked = await call('POST', '/api/members', { contactId: 'ghl_only' });
  assert.equal(picked.body.member.contactId, 'ghl_only');
  assert.equal(picked.body.member.name, 'Testdd Rao');
  assert.equal(picked.body.member.balance, 0);
  // Now a member: no longer listed under HighLevel contacts, but found by the member search.
  assert.equal((await call('GET', '/api/members/contacts?q=testdd')).body.contacts.length, 0);
  assert.equal((await call('GET', '/api/members?q=testdd')).body.members.length, 1);
});

test('time zone and name are filled from HighLevel when missing; an owner-set zone is kept', async () => {
  await Workspace.updateOne({ locationId: LOC }, { timezone: 'UTC', timezoneLocked: false, locationName: null, locationSyncedAt: null });
  await call('POST', '/api/auth/verify', { locationId: LOC }, { auth: false });
  let ws = await Workspace.findOne({ locationId: LOC });
  assert.equal(ws.timezone, 'America/New_York');
  assert.equal(ws.locationName, 'Demo Studio');
  assert.equal((await call('PUT', '/api/settings', { timezone: 'Not/AZone' })).status, 400);
  await call('PUT', '/api/settings', { timezone: 'UTC' });
  await Workspace.updateOne({ locationId: LOC }, { locationSyncedAt: null });
  await call('POST', '/api/auth/verify', { locationId: LOC }, { auth: false });
  ws = await Workspace.findOne({ locationId: LOC });
  assert.equal(ws.timezone, 'UTC');
  assert.equal(ws.timezoneLocked, true);
});
