const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const bookingService = require('../services/bookingService');
const waitlistService = require('../services/waitlistService');
const memberService = require('../services/memberService');
const ghlService = require('../services/ghlService');
const { wrap } = require('../middleware/auth');

function range(req) {
  const from = req.query.from ? new Date(req.query.from) : new Date(new Date().setHours(0, 0, 0, 0));
  const to = req.query.to ? new Date(req.query.to) : new Date(from.getTime() + 864e5);
  if (isNaN(from) || isNaN(to) || to <= from || to - from > 31 * 864e5) {
    throw Object.assign(new Error('Invalid date range'), { status: 400 });
  }
  return { from, to };
}

async function ownBooking(req) {
  const b = await Booking.findOne({ _id: req.params.id, locationId: req.ws.locationId });
  if (!b) throw Object.assign(new Error('Booking not found'), { status: 404 });
  return b;
}

const actor = (req) => req.auth.name || req.auth.userId || 'staff';

/** GET /api/classes?from=&to= — sessions with rosters + waitlists. */
router.get('/', wrap(async (req, res) => {
  const { from, to } = range(req);
  res.json({ success: true, sessions: await bookingService.sessions(req.ws, from, to) });
}));

router.post('/bookings/:id/checkin', wrap(async (req, res) => {
  const r = await bookingService.checkIn(await ownBooking(req), req.ws, { actor: actor(req), syncGhl: true });
  res.json({ success: true, ...r });
}));

router.post('/bookings/:id/noshow', wrap(async (req, res) => {
  const r = await bookingService.markNoShow(await ownBooking(req), req.ws, { actor: actor(req), syncGhl: true });
  res.json({ success: true, ...r });
}));

/** Staff cancel. { refund: true } forces the credit back even inside the late-cancel window. */
router.post('/bookings/:id/cancel', wrap(async (req, res) => {
  const b = await ownBooking(req);
  const r = await bookingService.cancel(b, req.ws, { actor: actor(req), forceRefund: !!req.body?.refund });
  if (r.cancelled) ghlService.updateAppointmentStatus(req.ws.locationId, b.appointmentId, 'cancelled').catch(() => {});
  res.json({ success: true, ...r });
}));

/** Staff books a member into a session (front desk / phone booking). */
router.post('/book', wrap(async (req, res) => {
  const { calendarId, startTime, contactId, allowOverCapacity = false } = req.body || {};
  const cal = req.ws.calendarConfig(calendarId);
  if (!cal || !cal.usesCredits) return res.status(400).json({ success: false, error: 'Pick a class calendar' });
  const start = new Date(startTime);
  if (isNaN(start)) return res.status(400).json({ success: false, error: 'Invalid start time' });
  const seated = await Booking.countDocuments({ locationId: req.ws.locationId, calendarId, startTime: start, status: { $in: ['booked', 'attended'] } });
  if (seated >= cal.capacity && !allowOverCapacity) return res.status(409).json({ success: false, code: 'FULL', error: 'Class is full — add them to the waitlist instead' });
  const dup = await Booking.findOne({ locationId: req.ws.locationId, calendarId, startTime: start, contactId, status: { $in: ['booked', 'attended'] } });
  if (dup) return res.status(409).json({ success: false, error: 'Already booked into this class' });

  const end = new Date(start.getTime() + (cal.durationMins || 60) * 60000);
  const appt = await ghlService.createAppointment(req.ws.locationId, { calendarId, contactId, startTime: start, endTime: end, title: cal.name });
  const r = await bookingService.book(req.ws, cal, { id: appt.id || appt._id, calendarId, contactId, startTime: start, endTime: end, title: cal.name }, { source: 'staff', actor: actor(req) });
  res.json({ success: true, booked: !!r.booked, rejected: !!r.rejected, owesCredit: !!r.owesCredit });
}));

router.post('/waitlist', wrap(async (req, res) => {
  const { calendarId, startTime, contactId } = req.body || {};
  const m = await memberService.ensure(req.ws.locationId, contactId);
  const r = await waitlistService.join(req.ws, { calendarId, startTime, contactId, name: m.name, phone: m.phone });
  res.json({ success: true, position: r.position });
}));

router.delete('/waitlist/:id', wrap(async (req, res) => {
  await waitlistService.leave(req.ws, req.params.id);
  res.json({ success: true });
}));

module.exports = router;
