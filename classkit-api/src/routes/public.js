const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Workspace = require('../models/Workspace');
const Booking = require('../models/Booking');
const Member = require('../models/Member');
const bookingService = require('../services/bookingService');
const waitlistService = require('../services/waitlistService');
const memberService = require('../services/memberService');
const ghlService = require('../services/ghlService');
const { wrap } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * Unauthenticated, token-scoped endpoints:
 *   /api/public/schedule/:slug   — the studio's public class schedule (book or join waitlist)
 *   /api/public/kiosk/:token     — front-desk tablet check-in by phone number
 * Only first names / counts leave this router; never full member data.
 */
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

function brandOf(ws) {
  return { name: ws.brand?.name || ws.locationName || 'Our studio', color: ws.brand?.color || '#5B4BDB', logoUrl: ws.brand?.logoUrl || '', timezone: ws.timezone };
}
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';

async function bySlug(slug) {
  const ws = await Workspace.findOne({ publicSlug: String(slug), active: true, setupComplete: true });
  if (!ws) throw Object.assign(new Error('Schedule not found'), { status: 404 });
  return ws;
}
async function byKiosk(token) {
  const ws = await Workspace.findOne({ kioskToken: String(token), active: true });
  if (!ws) throw Object.assign(new Error('Kiosk link is invalid. Ask the studio for a new one.'), { status: 404 });
  return ws;
}

/** Upcoming sessions: open seats from GHL free-slots + full sessions we know from our bookings. */
router.get('/schedule/:slug', wrap(async (req, res) => {
  const ws = await bySlug(req.params.slug);
  const days = Math.min(14, Math.max(1, Number(req.query.days) || 7));
  const from = new Date();
  const to = new Date(from.getTime() + days * 864e5);
  const counts = await Booking.aggregate([
    { $match: { locationId: ws.locationId, startTime: { $gte: from, $lt: to }, status: { $in: ['booked', 'attended'] } } },
    { $group: { _id: { c: '$calendarId', s: '$startTime' }, n: { $sum: 1 } } }
  ]);
  const seatMap = new Map(counts.map((c) => [`${c._id.c}|${new Date(c._id.s).toISOString()}`, c.n]));

  const sessions = new Map();
  for (const cal of ws.calendars.filter((c) => c.usesCredits)) {
    let slots = [];
    try { slots = await ghlService.getFreeSlots(ws.locationId, cal.calendarId, from, to, ws.timezone); } catch (e) {
      logger.warn('free-slots failed', { calendarId: cal.calendarId, message: e.message });
    }
    for (const s of slots) sessions.set(`${cal.calendarId}|${s.startTime}`, { cal, startTime: s.startTime });
  }
  for (const c of counts) {
    const cal = ws.calendarConfig(c._id.c);
    const k = `${c._id.c}|${new Date(c._id.s).toISOString()}`;
    if (cal?.usesCredits && !sessions.has(k)) sessions.set(k, { cal, startTime: new Date(c._id.s).toISOString() });
  }
  const list = [...sessions.entries()].filter(([, v]) => new Date(v.startTime) > from).map(([k, { cal, startTime }]) => {
    const booked = seatMap.get(k) || 0;
    return {
      calendarId: cal.calendarId, name: cal.name, startTime, durationMins: cal.durationMins, creditCost: cal.creditCost,
      spotsLeft: Math.max(0, cal.capacity - booked), capacity: cal.capacity, full: booked >= cal.capacity,
      bookUrl: `https://api.leadconnectorhq.com/widget/booking/${cal.calendarId}`
    };
  }).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

  res.json({ success: true, studio: brandOf(ws), waitlistEnabled: ws.policy.waitlistEnabled, buyUrl: ws.buyUrl, sessions: list });
}));

router.post('/schedule/:slug/waitlist', writeLimiter, wrap(async (req, res) => {
  const ws = await bySlug(req.params.slug);
  const { calendarId, startTime, name, phone, email } = req.body || {};
  if (!String(name || '').trim() || !String(phone || '').replace(/\D/g, '')) return res.status(400).json({ success: false, error: 'Enter your name and mobile number' });
  const c = await ghlService.upsertContact(ws.locationId, { name, phone, email });
  const contactId = c.id || c._id;
  await memberService.ensure(ws.locationId, contactId, { name, phone, email, force: true });
  const r = await waitlistService.join(ws, { calendarId, startTime, contactId, name, phone });
  res.json({ success: true, position: r.position, firstName: firstName(name) });
}));

/** Kiosk boot: studio brand + the sessions currently open for check-in. */
router.get('/kiosk/:token', wrap(async (req, res) => {
  const ws = await byKiosk(req.params.token);
  const now = Date.now();
  const from = new Date(now - (ws.policy.checkInClosesMins ?? 30) * 60000);
  const to = new Date(now + (ws.policy.checkInOpensMins ?? 60) * 60000);
  const sessions = await bookingService.sessions(ws, from, to);
  res.json({
    success: true, studio: brandOf(ws),
    sessions: sessions.map((s) => ({ name: s.name, startTime: s.startTime, booked: s.booked, attended: s.attended, capacity: s.capacity }))
  });
}));

/** Kiosk check-in: { phone } → finds their booking in the open window and checks them in. */
router.post('/kiosk/:token/checkin', writeLimiter, wrap(async (req, res) => {
  const ws = await byKiosk(req.params.token);
  const d = memberService.digits(req.body?.phone);
  if (d.length < 7) return res.status(400).json({ success: false, error: 'Enter the mobile number you booked with' });

  let contactIds = (await Member.find({ locationId: ws.locationId, phoneDigits: d }).select('contactId').lean()).map((m) => m.contactId);
  if (!contactIds.length) {
    try {
      const found = await ghlService.searchContactsByPhone(ws.locationId, d);
      contactIds = found.filter((c) => memberService.digits(c.phone) === d).map((c) => c.id);
    } catch (_) { /* fall through */ }
  }
  if (!contactIds.length) return res.status(404).json({ success: false, code: 'NOT_FOUND', error: "We couldn't find that number. Please see the front desk." });

  const now = Date.now();
  const from = new Date(now - (ws.policy.checkInClosesMins ?? 30) * 60000);
  const to = new Date(now + (ws.policy.checkInOpensMins ?? 60) * 60000);
  const booking = await Booking.findOne({ locationId: ws.locationId, contactId: { $in: contactIds }, startTime: { $gte: from, $lte: to }, status: { $in: ['booked', 'attended'] } }).sort({ startTime: 1 });
  if (!booking) return res.status(404).json({ success: false, code: 'NO_BOOKING', error: "You're not booked into a class right now. Please see the front desk." });

  const cal = ws.calendarConfig(booking.calendarId);
  const already = booking.status === 'attended';
  if (!already) await bookingService.checkIn(booking, ws, { actor: 'kiosk', syncGhl: true });
  const m = await Member.findOne({ locationId: ws.locationId, contactId: booking.contactId }).lean();
  res.json({
    success: true, alreadyCheckedIn: already, firstName: firstName(m?.name), className: cal?.name || booking.title,
    startTime: booking.startTime, credits: m?.unlimitedUntil && new Date(m.unlimitedUntil) > new Date() ? 'unlimited' : m?.balance ?? null,
    visits: m?.visits || 0
  });
}));

module.exports = router;
