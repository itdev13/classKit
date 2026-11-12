const WaitlistEntry = require('../models/WaitlistEntry');
const Booking = require('../models/Booking');
const creditService = require('./creditService');
const memberService = require('./memberService');
const notifyService = require('./notifyService');
const triggerService = require('./triggerService');
const ghlService = require('./ghlService');
const logger = require('../utils/logger');

const SEATED = ['booked', 'attended'];

function err(message, status = 400, code) { return Object.assign(new Error(message), { status, code }); }

/** Join the waitlist for a full session. Returns { entry, position }. */
async function join(ws, { calendarId, startTime, endTime, contactId, name = '', phone = '' }) {
  if (!ws.policy.waitlistEnabled) throw err('Waitlist is turned off for this studio', 400, 'WAITLIST_OFF');
  const cal = ws.calendarConfig(calendarId);
  if (!cal || !cal.usesCredits) throw err('This class does not use ClassKit', 400, 'UNKNOWN_CLASS');
  const start = new Date(startTime);
  if (!(start > new Date())) throw err('This class has already started', 400, 'PAST_CLASS');

  const seated = await Booking.findOne({ locationId: ws.locationId, calendarId, startTime: start, contactId, status: { $in: SEATED } });
  if (seated) throw err("You're already booked into this class", 409, 'ALREADY_BOOKED');

  let entry = await WaitlistEntry.findOne({ locationId: ws.locationId, calendarId, startTime: start, contactId, status: 'waiting' });
  if (!entry) {
    entry = await WaitlistEntry.create({
      locationId: ws.locationId, calendarId, startTime: start,
      endTime: endTime ? new Date(endTime) : new Date(start.getTime() + (cal.durationMins || 60) * 60000),
      contactId, name, phone
    });
  }
  const position = await WaitlistEntry.countDocuments({
    locationId: ws.locationId, calendarId, startTime: start, status: 'waiting', createdAt: { $lte: entry.createdAt }
  });
  const m = await memberService.ensure(ws.locationId, contactId, { name, phone });
  notifyService.send(ws, 'waitlistJoined', contactId, {
    first_name: m.firstName, position, class_name: cal.name, class_time: notifyService.formatWhen(start, ws.timezone)
  });

  // If a seat is actually free right now (e.g. a cancellation we promoted nobody into), fill it.
  const filled = await promoteNext(ws, calendarId, start).catch(() => null);
  if (filled && String(filled._id) === String(entry._id)) return { entry: filled, position: 0, promoted: true };
  return { entry, position };
}

async function leave(ws, entryId) {
  const res = await WaitlistEntry.findOneAndUpdate({ _id: entryId, locationId: ws.locationId, status: 'waiting' }, { $set: { status: 'left' } }, { new: true });
  if (!res) throw err('Waitlist entry not found', 404);
  return res;
}

/**
 * A seat may have opened in (calendarId, startTime). Book the first waiting member who has a
 * usable credit; members without one are skipped (and told). Returns the promoted entry or null.
 */
async function promoteNext(ws, calendarId, startTime) {
  if (!ws.policy.waitlistEnabled) return null;
  const start = new Date(startTime);
  if (!(start > new Date())) return null;
  const cal = ws.calendarConfig(calendarId);
  if (!cal) return null;

  for (let guard = 0; guard < 50; guard++) {
    const seated = await Booking.countDocuments({ locationId: ws.locationId, calendarId, startTime: start, status: { $in: SEATED } });
    if (cal.capacity && seated >= cal.capacity) return null;

    const entry = await WaitlistEntry.findOneAndUpdate(
      { locationId: ws.locationId, calendarId, startTime: start, status: 'waiting' },
      { $set: { status: 'promoted', promotedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );
    if (!entry) return null;

    const { balance, unlimitedUntil } = await creditService.getBalance(ws.locationId, entry.contactId, start);
    if (!(unlimitedUntil && unlimitedUntil > start) && balance < (cal.creditCost ?? 1)) {
      await WaitlistEntry.updateOne({ _id: entry._id }, { $set: { status: 'skipped', skipReason: 'no_credits' } });
      const m = await memberService.ensure(ws.locationId, entry.contactId);
      notifyService.send(ws, 'noCredits', entry.contactId, {
        first_name: m.firstName, class_name: cal.name, class_time: notifyService.formatWhen(start, ws.timezone)
      });
      continue;
    }

    let appointmentId;
    try {
      const appt = await ghlService.createAppointment(ws.locationId, {
        calendarId, contactId: entry.contactId, startTime: start, endTime: entry.endTime, title: cal.name
      });
      appointmentId = appt.id || appt._id;
    } catch (e) {
      logger.warn('waitlist: could not create appointment — returning entry to the queue', { message: e.response?.data?.message || e.message });
      await WaitlistEntry.updateOne({ _id: entry._id }, { $set: { status: 'waiting', promotedAt: null } });
      return null;
    }

    // Book directly (GHL's AppointmentCreate webhook for the same id will then be a no-op duplicate).
    const bookingService = require('./bookingService');
    const res = await bookingService.book(ws, cal, {
      id: appointmentId, calendarId, contactId: entry.contactId, startTime: start, endTime: entry.endTime, title: cal.name
    }, { source: 'waitlist' });
    if (!res.booked) {
      await WaitlistEntry.updateOne({ _id: entry._id }, { $set: { status: 'skipped', skipReason: 'booking_failed', promotedAppointmentId: appointmentId } });
      continue;
    }
    await WaitlistEntry.updateOne({ _id: entry._id }, { $set: { promotedAppointmentId: appointmentId } });
    triggerService.fire(triggerService.TRIGGERS.WAITLIST_PROMOTED, ws.locationId, {
      contactId: entry.contactId, appointmentId, calendarId, className: cal.name, startTime: start.toISOString()
    });
    logger.info('⬆️ Waitlist promoted', { locationId: ws.locationId, contactId: entry.contactId, calendarId });
    return entry;
  }
  return null;
}

/** Background: close out waitlists for classes that already started. */
async function expirePast(now = new Date()) {
  const r = await WaitlistEntry.updateMany({ status: 'waiting', startTime: { $lte: now } }, { $set: { status: 'expired' } });
  return r.modifiedCount || 0;
}

module.exports = { join, leave, promoteNext, expirePast };
