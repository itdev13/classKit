const Booking = require('../models/Booking');
const LedgerEntry = require('../models/LedgerEntry');
const CreditLot = require('../models/CreditLot');
const Member = require('../models/Member');

const DAY = 864e5;

/** Studio KPIs over the last `days`. All numbers come from our own ledger + bookings. */
async function summary(ws, days = 30) {
  const locationId = ws.locationId;
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY);

  const ledger = await LedgerEntry.aggregate([
    { $match: { locationId, createdAt: { $gte: since } } },
    { $group: { _id: '$reason', total: { $sum: '$delta' }, count: { $sum: 1 } } }
  ]);
  const L = Object.fromEntries(ledger.map((r) => [r._id, r]));

  const bookings = await Booking.aggregate([
    { $match: { locationId, startTime: { $gte: since, $lte: now } } },
    { $group: { _id: '$status', n: { $sum: 1 } } }
  ]);
  const B = Object.fromEntries(bookings.map((r) => [r._id, r.n]));
  const attended = B.attended || 0;
  const noShows = B.noshow || 0;
  const finished = attended + noShows;

  // Fill rate over past sessions.
  const sessions = await Booking.aggregate([
    { $match: { locationId, startTime: { $gte: since, $lte: now }, status: { $in: ['booked', 'attended', 'noshow'] } } },
    { $group: { _id: { c: '$calendarId', s: '$startTime' }, seats: { $sum: 1 } } }
  ]);
  let cap = 0;
  let seats = 0;
  const perClass = {};
  for (const s of sessions) {
    const cfg = ws.calendarConfig(s._id.c);
    if (cfg?.capacity) { cap += cfg.capacity; seats += Math.min(s.seats, cfg.capacity); }
    const name = cfg?.name || 'Class';
    perClass[name] = perClass[name] || { name, sessions: 0, seats: 0, capacity: 0 };
    perClass[name].sessions += 1;
    perClass[name].seats += s.seats;
    perClass[name].capacity += cfg?.capacity || 0;
  }

  const revenueAgg = await CreditLot.aggregate([
    { $match: { locationId, createdAt: { $gte: since }, 'source.type': { $in: ['order', 'invoice'] } } },
    { $group: { _id: null, usd: { $sum: '$valueUsd' }, packs: { $sum: 1 } } }
  ]);

  // Liability: value of unused credits still live (pro-rated by lot price).
  const live = await CreditLot.find({ locationId, status: 'active', kind: { $ne: 'unlimited' }, remaining: { $gt: 0 }, expiresAt: { $gt: now } }).lean();
  const outstandingCredits = live.reduce((a, l) => a + l.remaining, 0);
  const liabilityUsd = live.reduce((a, l) => a + (l.creditsTotal ? (l.valueUsd * l.remaining) / l.creditsTotal : 0), 0);
  const expiringSoon = live.filter((l) => l.expiresAt < new Date(now.getTime() + 14 * DAY)).reduce((a, l) => a + l.remaining, 0);

  const activeMembers = await Member.countDocuments({ locationId, $or: [{ balance: { $gt: 0 } }, { unlimitedUntil: { $gt: now } }] });
  const atRisk = await Member.find({
    locationId, $or: [{ balance: { $gt: 0 } }, { unlimitedUntil: { $gt: now } }],
    createdAt: { $lt: new Date(now.getTime() - 14 * DAY) },
    $and: [{ $or: [{ lastVisitAt: null }, { lastVisitAt: { $lt: new Date(now.getTime() - 14 * DAY) } }] }]
  }).sort({ lastVisitAt: 1 }).limit(10).lean();

  return {
    days,
    creditsSold: L.purchase?.total || 0,
    packsSold: revenueAgg[0]?.packs || 0,
    revenueUsd: Math.round((revenueAgg[0]?.usd || 0) * 100) / 100,
    creditsUsed: -(L.booking?.total || 0),
    creditsRefunded: L.refund?.total || 0,
    creditsExpired: -(L.expire?.total || 0),
    lateCancels: L.late_cancel?.count || 0,
    attended,
    noShows,
    noShowRate: finished ? Math.round((noShows / finished) * 1000) / 10 : 0,
    fillRate: cap ? Math.round((seats / cap) * 1000) / 10 : null,
    sessions: sessions.length,
    activeMembers,
    outstandingCredits,
    liabilityUsd: Math.round(liabilityUsd * 100) / 100,
    expiringSoon,
    perClass: Object.values(perClass).map((c) => ({ ...c, fillRate: c.capacity ? Math.round((c.seats / c.capacity) * 1000) / 10 : null })).sort((a, b) => b.seats - a.seats),
    atRisk: atRisk.map((m) => ({ contactId: m.contactId, name: m.name, balance: m.balance, unlimited: !!(m.unlimitedUntil && m.unlimitedUntil > now), lastVisitAt: m.lastVisitAt }))
  };
}

module.exports = { summary };
