const Booking = require('../models/Booking');
const Member = require('../models/Member');
const Workspace = require('../models/Workspace');
const LedgerEntry = require('../models/LedgerEntry');
const creditService = require('./creditService');
const memberService = require('./memberService');
const notifyService = require('./notifyService');
const triggerService = require('./triggerService');
const ghlService = require('./ghlService');
const logger = require('../utils/logger');

const { TRIGGERS } = triggerService;
const HOUR = 60 * 60 * 1000;

function isDuplicateKey(err) { return err && (err.code === 11000 || err.code === 11001); }

function normalizeAppointment(raw = {}) {
  const a = raw.appointment || raw;
  return {
    id: a.id || a._id || a.appointmentId,
    calendarId: a.calendarId,
    contactId: a.contactId,
    title: a.title || '',
    startTime: a.startTime ? new Date(a.startTime) : null,
    endTime: a.endTime ? new Date(a.endTime) : null,
    status: String(a.appointmentStatus || a.status || 'confirmed').toLowerCase()
  };
}

function classVars(ws, cal, booking, member, balance) {
  return {
    first_name: member?.firstName || '',
    class_name: cal?.name || booking.title || 'class',
    class_time: notifyService.formatWhen(booking.startTime, ws.timezone),
    credits: balance
  };
}

/**
 * Entry point for GHL appointment webhooks (AppointmentCreate / AppointmentUpdate / AppointmentDelete).
 * Only appointments on calendars the studio switched to "uses credits" are touched.
 */
async function handleAppointmentEvent(locationId, type, payload) {
  const ws = await Workspace.findOne({ locationId, active: true });
  if (!ws) return { ignored: 'no_workspace' };
  const appt = normalizeAppointment(payload);
  if (!appt.id || !appt.calendarId) return { ignored: 'not_an_appointment' };
  const cal = ws.calendarConfig(appt.calendarId);
  if (!cal || !cal.usesCredits) return { ignored: 'calendar_not_on_credits' };
  if (!appt.contactId) return { ignored: 'no_contact' };

  const status = type === 'AppointmentDelete' ? 'cancelled' : appt.status;
  const existing = await Booking.findOne({ appointmentId: appt.id });

  if (!existing) {
    if (status === 'cancelled' || status === 'invalid') return { ignored: 'cancelled_before_seen' };
    const res = await book(ws, cal, appt, { source: 'ghl' });
    if (res.booking?.status === 'booked' && status === 'showed') return checkIn(res.booking, ws, { actor: 'ghl' });
    if (res.booking?.status === 'booked' && status === 'noshow') return markNoShow(res.booking, ws, { actor: 'ghl' });
    return res;
  }

  switch (status) {
    case 'cancelled':
    case 'invalid':
      return cancel(existing, ws, { actor: 'member' });
    case 'showed':
      return checkIn(existing, ws, { actor: 'ghl' });
    case 'noshow':
      return markNoShow(existing, ws, { actor: 'ghl' });
    default:
      // confirmed / booked / new
      if (existing.status === 'cancelled') return rebook(existing, ws, cal, appt);
      if (existing.status === 'booked' && appt.startTime && +appt.startTime !== +existing.startTime) {
        return reschedule(existing, ws, appt);
      }
      return { ignored: 'no_change', booking: existing };
  }
}

/**
 * Take a seat: spend credits or, with none, either block (cancel + text a buy link) or let it stand
 * as owing. Inserting the Booking first is the idempotency claim — duplicate webhooks stop here.
 */
async function book(ws, cal, appt, { source = 'ghl', actor = 'system' } = {}) {
  let booking;
  try {
    booking = await Booking.create({
      locationId: ws.locationId,
      appointmentId: appt.id,
      contactId: appt.contactId,
      calendarId: appt.calendarId,
      title: appt.title || cal.name,
      startTime: appt.startTime || new Date(),
      endTime: appt.endTime || new Date((appt.startTime || new Date()).getTime() + (cal.durationMins || 60) * 60000),
      status: 'booked',
      source
    });
  } catch (err) {
    if (isDuplicateKey(err)) return { duplicate: true, booking: await Booking.findOne({ appointmentId: appt.id }) };
    throw err;
  }

  const member = await memberService.ensure(ws.locationId, appt.contactId);
  const spend = await creditService.consume({
    locationId: ws.locationId,
    contactId: appt.contactId,
    calendarId: appt.calendarId,
    cost: cal.creditCost ?? 1,
    at: booking.startTime,
    refId: appt.id,
    idempotencyKey: `book:${appt.id}:${booking.chargeSeq}`,
    actor,
    note: `${cal.name || 'Class'} · ${notifyService.formatWhen(booking.startTime, ws.timezone)}`
  });

  if (spend.ok) {
    booking.lotId = spend.lotId || null;
    booking.creditsCharged = spend.charged || 0;
    booking.unlimited = !!spend.unlimited;
    await booking.save();
    const m = await memberService.refresh(ws.locationId, appt.contactId, { workspace: ws });
    const vars = classVars(ws, cal, booking, m, m.unlimitedUntil ? 'unlimited' : m.balance);
    notifyService.send(ws, source === 'waitlist' ? 'waitlistPromoted' : 'booked', appt.contactId, vars);
    return { booked: true, booking, charged: booking.creditsCharged, unlimited: booking.unlimited };
  }

  // No credits.
  const vars = classVars(ws, cal, booking, member, 0);
  if (ws.policy.blockWithoutCredits) {
    booking.status = 'rejected';
    await booking.save();
    try {
      await ghlService.updateAppointmentStatus(ws.locationId, appt.id, 'cancelled');
    } catch (err) {
      logger.warn('could not cancel no-credit appointment in GHL', { appointmentId: appt.id, message: err.message });
    }
    notifyService.send(ws, 'noCredits', appt.contactId, vars);
    triggerService.fire(TRIGGERS.BOOKING_REJECTED, ws.locationId, {
      contactId: appt.contactId, appointmentId: appt.id, calendarId: appt.calendarId,
      className: vars.class_name, startTime: booking.startTime.toISOString()
    });
    logger.info('🚫 Booking blocked — no credits', { locationId: ws.locationId, contactId: appt.contactId, appointmentId: appt.id });
    return { booked: false, rejected: true, booking };
  }

  booking.owesCredit = true;
  await booking.save();
  return { booked: true, owesCredit: true, booking };
}

/** A previously cancelled appointment was re-confirmed in GHL — charge again. */
async function rebook(existing, ws, cal, appt) {
  const updated = await Booking.findOneAndUpdate(
    { _id: existing._id, status: 'cancelled' },
    { $set: { status: 'booked', refunded: false, lateCancel: false, cancelledAt: null, startTime: appt.startTime || existing.startTime }, $inc: { chargeSeq: 1 } },
    { new: true }
  );
  if (!updated) return { ignored: 'race' };
  const spend = await creditService.consume({
    locationId: ws.locationId, contactId: updated.contactId, calendarId: updated.calendarId,
    cost: cal.creditCost ?? 1, at: updated.startTime, refId: updated.appointmentId,
    idempotencyKey: `book:${updated.appointmentId}:${updated.chargeSeq}`,
    note: `${cal.name || 'Class'} · ${notifyService.formatWhen(updated.startTime, ws.timezone)} (rebooked)`
  });
  if (spend.ok) {
    await Booking.updateOne({ _id: updated._id }, { $set: { lotId: spend.lotId || null, creditsCharged: spend.charged || 0, unlimited: !!spend.unlimited, owesCredit: false } });
  } else {
    await Booking.updateOne({ _id: updated._id }, { $set: { creditsCharged: 0, lotId: null, owesCredit: true } });
  }
  await memberService.refresh(ws.locationId, updated.contactId, { workspace: ws });
  return { rebooked: true, charged: spend.ok ? spend.charged : 0 };
}

/** Moved to another time: the credit moves with it; the old session may now have a free seat. */
async function reschedule(existing, ws, appt) {
  const oldStart = existing.startTime;
  existing.startTime = appt.startTime;
  if (appt.endTime) existing.endTime = appt.endTime;
  await existing.save();
  const waitlistService = require('./waitlistService');
  if (oldStart > new Date()) {
    await waitlistService.promoteNext(ws, existing.calendarId, oldStart).catch((e) => logger.warn('waitlist promote failed', { message: e.message }));
  }
  return { rescheduled: true, booking: existing };
}

/**
 * Cancel a seat. Outside the cancel window → credit back. Inside it → the studio keeps the credit
 * (late cancel) unless staff force a refund. A freed seat in a future class goes to the waitlist.
 */
async function cancel(booking, ws, { actor = 'member', forceRefund = false, now = new Date() } = {}) {
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'booked' },
    { $set: { status: 'cancelled', cancelledAt: now } },
    { new: true }
  );
  if (!updated) return { ignored: 'not_booked', booking };

  const cal = ws.calendarConfig(updated.calendarId);
  const hoursBefore = (updated.startTime - now) / HOUR;
  const inWindow = hoursBefore >= (ws.policy.cancelWindowHours ?? 12);
  let refunded = false;
  let lateCancel = false;

  if (updated.creditsCharged > 0 && updated.lotId) {
    if (inWindow || forceRefund) {
      const r = await creditService.refund({
        locationId: ws.locationId, contactId: updated.contactId, lotId: updated.lotId, credits: updated.creditsCharged,
        refId: updated.appointmentId, idempotencyKey: `refund:${updated.appointmentId}:${updated.chargeSeq}`, actor,
        note: forceRefund && !inWindow ? 'Staff override refund' : 'Cancelled in time'
      });
      refunded = r.ok;
    } else {
      lateCancel = true;
      await LedgerEntry.create({
        locationId: ws.locationId, contactId: updated.contactId, lotId: updated.lotId, delta: 0, reason: 'late_cancel',
        refId: updated.appointmentId, idempotencyKey: `late:${updated.appointmentId}:${updated.chargeSeq}`, actor,
        note: `Cancelled ${Math.max(0, hoursBefore).toFixed(1)}h before class — credit kept`
      }).catch((e) => { if (!isDuplicateKey(e)) throw e; });
    }
  }
  await Booking.updateOne({ _id: updated._id }, { $set: { refunded, lateCancel } });

  const m = await memberService.refresh(ws.locationId, updated.contactId, { workspace: ws, silent: true });
  const vars = classVars(ws, cal, updated, m, m.unlimitedUntil ? 'unlimited' : m.balance);
  if (refunded) notifyService.send(ws, 'refunded', updated.contactId, vars);
  if (lateCancel) {
    notifyService.send(ws, 'lateCancel', updated.contactId, vars);
    triggerService.fire(TRIGGERS.LATE_CANCEL, ws.locationId, {
      contactId: updated.contactId, appointmentId: updated.appointmentId, className: vars.class_name,
      startTime: updated.startTime.toISOString(), hoursBefore: Number(hoursBefore.toFixed(1))
    });
  }

  let promoted = null;
  if (updated.startTime > now) {
    const waitlistService = require('./waitlistService');
    try {
      promoted = await waitlistService.promoteNext(ws, updated.calendarId, updated.startTime);
    } catch (e) {
      logger.warn('waitlist promote failed', { message: e.message });
    }
  }
  return { cancelled: true, refunded, lateCancel, waitlistPromoted: promoted?.contactId || null, booking: updated };
}

async function checkIn(booking, ws, { actor = 'staff', syncGhl = false } = {}) {
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, status: { $in: ['booked', 'noshow'] } },
    { $set: { status: 'attended', checkedInAt: new Date(), checkedInBy: actor } },
    { new: true }
  );
  if (!updated) {
    const cur = await Booking.findById(booking._id);
    return { ignored: cur?.status === 'attended' ? 'already_checked_in' : 'not_booked', booking: cur };
  }
  const wasNoShow = booking.status === 'noshow';
  await Member.updateOne(
    { locationId: ws.locationId, contactId: updated.contactId },
    { $inc: { visits: 1, ...(wasNoShow ? { noShows: -1 } : {}) }, $max: { lastVisitAt: new Date(Math.min(Date.now(), +updated.startTime)) } }
  );
  if (syncGhl) {
    ghlService.updateAppointmentStatus(ws.locationId, updated.appointmentId, 'showed')
      .catch((e) => logger.warn('GHL showed sync failed', { message: e.message }));
  }
  const m = await Member.findOne({ locationId: ws.locationId, contactId: updated.contactId });
  const cal = ws.calendarConfig(updated.calendarId);
  notifyService.send(ws, 'checkedIn', updated.contactId, classVars(ws, cal, updated, m, m?.balance));
  triggerService.fire(TRIGGERS.CHECKED_IN, ws.locationId, {
    contactId: updated.contactId, appointmentId: updated.appointmentId, calendarId: updated.calendarId,
    className: cal?.name || updated.title, startTime: updated.startTime.toISOString(), totalVisits: m?.visits || 0
  });
  return { checkedIn: true, booking: updated, member: m };
}

async function markNoShow(booking, ws, { actor = 'staff', syncGhl = false } = {}) {
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'booked' },
    { $set: { status: 'noshow', checkedInBy: actor } },
    { new: true }
  );
  if (!updated) return { ignored: 'not_booked', booking };
  await Member.updateOne({ locationId: ws.locationId, contactId: updated.contactId }, { $inc: { noShows: 1 } });
  if (syncGhl) {
    ghlService.updateAppointmentStatus(ws.locationId, updated.appointmentId, 'noshow')
      .catch((e) => logger.warn('GHL noshow sync failed', { message: e.message }));
  }
  const cal = ws.calendarConfig(updated.calendarId);
  triggerService.fire(TRIGGERS.NO_SHOW, ws.locationId, {
    contactId: updated.contactId, appointmentId: updated.appointmentId, className: cal?.name || updated.title,
    startTime: updated.startTime.toISOString()
  });
  return { noShow: true, booking: updated };
}

/** Background: booked seats nobody checked in to, N minutes after class ended → no-show. */
async function autoNoShow(now = new Date()) {
  const workspaces = await Workspace.find({ active: true, 'policy.autoNoShowMinutes': { $gt: 0 } });
  let count = 0;
  for (const ws of workspaces) {
    const cutoff = new Date(now.getTime() - ws.policy.autoNoShowMinutes * 60000);
    const stale = await Booking.find({
      locationId: ws.locationId, status: 'booked',
      endTime: { $lte: cutoff, $gte: new Date(now.getTime() - 3 * 24 * HOUR) }
    }).limit(200);
    for (const b of stale) {
      const r = await markNoShow(b, ws, { actor: 'auto', syncGhl: true });
      if (r.noShow) count++;
    }
  }
  if (count) logger.info('🕒 Auto no-show', { count });
  return count;
}

/** Sessions (calendar + start time) in a range, with rosters. */
async function sessions(ws, from, to) {
  const bookings = await Booking.find({
    locationId: ws.locationId, startTime: { $gte: from, $lt: to }, status: { $in: ['booked', 'attended', 'noshow'] }
  }).sort({ startTime: 1 }).lean();
  const WaitlistEntry = require('../models/WaitlistEntry');
  const waiting = await WaitlistEntry.find({ locationId: ws.locationId, startTime: { $gte: from, $lt: to }, status: 'waiting' }).sort({ createdAt: 1 }).lean();

  const contactIds = [...new Set([...bookings.map((b) => b.contactId), ...waiting.map((w) => w.contactId)])];
  const members = await Member.find({ locationId: ws.locationId, contactId: { $in: contactIds } }).lean();
  const byContact = new Map(members.map((m) => [m.contactId, m]));

  const map = new Map();
  const key = (cal, start) => `${cal}|${new Date(start).toISOString()}`;
  const get = (calendarId, startTime, endTime, title) => {
    const k = key(calendarId, startTime);
    if (!map.has(k)) {
      const cal = ws.calendarConfig(calendarId);
      map.set(k, { calendarId, name: cal?.name || title || 'Class', startTime, endTime, capacity: cal?.capacity || null, roster: [], waitlist: [] });
    }
    return map.get(k);
  };
  for (const b of bookings) {
    const m = byContact.get(b.contactId);
    get(b.calendarId, b.startTime, b.endTime, b.title).roster.push({
      bookingId: b._id, appointmentId: b.appointmentId, contactId: b.contactId, status: b.status,
      name: m?.name || 'Member', phone: m?.phone || '', balance: m?.balance ?? null,
      unlimited: !!b.unlimited, owesCredit: !!b.owesCredit, checkedInAt: b.checkedInAt
    });
  }
  for (const w of waiting) {
    get(w.calendarId, w.startTime, w.endTime).waitlist.push({ id: w._id, contactId: w.contactId, name: w.name || byContact.get(w.contactId)?.name || 'Member', phone: w.phone, joinedAt: w.createdAt });
  }
  return [...map.values()].sort((a, b) => new Date(a.startTime) - new Date(b.startTime)).map((s) => ({
    ...s,
    booked: s.roster.length,
    attended: s.roster.filter((r) => r.status === 'attended').length,
    full: s.capacity ? s.roster.length >= s.capacity : false
  }));
}

module.exports = { handleAppointmentEvent, normalizeAppointment, book, cancel, checkIn, markNoShow, autoNoShow, sessions };
