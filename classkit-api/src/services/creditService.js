const CreditLot = require('../models/CreditLot');
const LedgerEntry = require('../models/LedgerEntry');
const logger = require('../utils/logger');

/**
 * The credit ledger.
 *
 * Invariants:
 *   - A lot's `remaining` only changes through conditional atomic updates ({ remaining: { $gte: n } }),
 *     so concurrent bookings can never overspend a lot.
 *   - Every movement writes exactly one LedgerEntry. Callers pass an idempotencyKey; we insert the
 *     ledger row FIRST (unique index) to claim the operation, then mutate the lot. A duplicate key
 *     means "already done" and returns the original result. If the lot mutation fails we delete the
 *     claim so the operation can be retried.
 *   - Credits are spent soonest-expiring first, so members lose as few as possible to expiry.
 *   - Unlimited lots (kind='unlimited', remaining=null) cover any booking inside their date range at
 *     zero cost.
 */

const DAY = 24 * 60 * 60 * 1000;

function isDuplicateKey(err) {
  return err && (err.code === 11000 || err.code === 11001);
}

/** Claim an idempotency key. Returns { claimed: true, entry } or { claimed: false, existing }. */
async function claim(entry) {
  if (!entry.idempotencyKey) {
    return { claimed: true, entry: await LedgerEntry.create(entry) };
  }
  try {
    return { claimed: true, entry: await LedgerEntry.create(entry) };
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const existing = await LedgerEntry.findOne({ idempotencyKey: entry.idempotencyKey }).lean();
    return { claimed: false, existing };
  }
}

function lotCoversCalendar(lot, calendarId) {
  return !calendarId || !lot.calendarIds?.length || lot.calendarIds.includes(calendarId);
}

/** Current balance summary for a member. */
async function getBalance(locationId, contactId, at = new Date()) {
  const lots = await CreditLot.find({ locationId, contactId, status: 'active', expiresAt: { $gt: at } }).lean();
  let balance = 0;
  let unlimitedUntil = null;
  let nextExpiry = null;
  for (const lot of lots) {
    if (lot.kind === 'unlimited') {
      if (lot.startsAt <= at && (!unlimitedUntil || lot.expiresAt > unlimitedUntil)) unlimitedUntil = lot.expiresAt;
      continue;
    }
    if (lot.remaining > 0) {
      balance += lot.remaining;
      if (!nextExpiry || lot.expiresAt < nextExpiry) nextExpiry = lot.expiresAt;
    }
  }
  return { balance, unlimitedUntil, nextExpiry, lots };
}

/**
 * Grant credits from a package (or an ad-hoc amount). Returns { lot, duplicate }.
 * opts: { locationId, contactId, pkg?, credits?, validityDays?, kind?, name?, valueUsd?, source, idempotencyKey, actor, note, startsAt? }
 */
async function grant(opts) {
  const { locationId, contactId, pkg, idempotencyKey, actor = 'system', note = '' } = opts;
  const kind = opts.kind || pkg?.kind || 'manual';
  const credits = kind === 'unlimited' ? 0 : Number(opts.credits ?? pkg?.credits ?? 0);
  const validityDays = Number(opts.validityDays ?? pkg?.validityDays ?? 90);
  const startsAt = opts.startsAt ? new Date(opts.startsAt) : new Date();
  const expiresAt = new Date(startsAt.getTime() + validityDays * DAY);

  if (kind !== 'unlimited' && (!Number.isFinite(credits) || credits <= 0)) {
    throw Object.assign(new Error('Credits must be a positive number'), { status: 400 });
  }

  const reason = opts.source?.type === 'adjust' || kind === 'manual' ? 'adjust' : 'purchase';
  const c = await claim({ locationId, contactId, delta: credits, reason, refId: opts.source?.refId || null, idempotencyKey, actor, note });
  if (!c.claimed) {
    const lot = c.existing?.lotId ? await CreditLot.findById(c.existing.lotId) : null;
    return { lot, duplicate: true };
  }

  try {
    const lot = await CreditLot.create({
      locationId,
      contactId,
      packageId: pkg?._id || null,
      packageName: opts.name || pkg?.name || (reason === 'adjust' ? 'Manual credits' : 'Credits'),
      kind,
      creditsTotal: credits,
      remaining: kind === 'unlimited' ? null : credits,
      calendarIds: pkg?.calendarIds || [],
      valueUsd: Number(opts.valueUsd ?? pkg?.priceUsd ?? 0),
      startsAt,
      expiresAt,
      source: opts.source || { type: 'manual', refId: null }
    });
    const { balance } = await getBalance(locationId, contactId);
    await LedgerEntry.updateOne({ _id: c.entry._id }, { $set: { lotId: lot._id, balanceAfter: balance } });
    return { lot, duplicate: false };
  } catch (err) {
    await LedgerEntry.deleteOne({ _id: c.entry._id });
    throw err;
  }
}

/**
 * Spend `cost` credits for a booking. Returns
 *   { ok: true, unlimited: true, lotId }            — covered by an unlimited membership
 *   { ok: true, unlimited: false, lotId, charged }  — credits spent
 *   { ok: false, reason: 'no_credits' }
 *   { ok: true, duplicate: true, ... }              — this key was already processed
 */
async function consume({ locationId, contactId, calendarId, cost = 1, at = new Date(), refId, idempotencyKey, actor = 'system', note = '' }) {
  const when = new Date(at);

  // 1. Unlimited membership valid on the class date covers it for free.
  const unlimited = await CreditLot.findOne({
    locationId, contactId, kind: 'unlimited', status: 'active',
    startsAt: { $lte: when }, expiresAt: { $gt: when }
  }).sort({ expiresAt: 1 }).lean();
  const unlimitedOk = unlimited && lotCoversCalendar(unlimited, calendarId);

  if (unlimitedOk || cost <= 0) {
    const c = await claim({ locationId, contactId, lotId: unlimited?._id || null, delta: 0, reason: 'booking', refId, idempotencyKey, actor, note: [note, unlimitedOk ? 'unlimited membership' : 'free class'].filter(Boolean).join(' — ') });
    if (!c.claimed) return { ok: true, duplicate: true, unlimited: !!unlimitedOk, lotId: c.existing?.lotId || null, charged: 0 };
    return { ok: true, unlimited: !!unlimitedOk, lotId: unlimited?._id || null, charged: 0 };
  }

  // 2. Claim the key before touching any lot.
  const c = await claim({ locationId, contactId, delta: -cost, reason: 'booking', refId, idempotencyKey, actor, note });
  if (!c.claimed) {
    return { ok: true, duplicate: true, unlimited: false, lotId: c.existing?.lotId || null, charged: -(c.existing?.delta || 0) };
  }

  // 3. Spend from the soonest-expiring lot that has enough and hasn't expired by the class date.
  //    (Packs have no start restriction — only unlimited memberships cover a fixed date range — so
  //    staff can record a class that already happened against a pack bought afterwards.)
  const candidates = await CreditLot.find({
    locationId, contactId, status: 'active', kind: { $ne: 'unlimited' },
    remaining: { $gte: cost }, expiresAt: { $gt: when }
  }).sort({ expiresAt: 1, createdAt: 1 }).lean();

  for (const lot of candidates) {
    if (!lotCoversCalendar(lot, calendarId)) continue;
    const updated = await CreditLot.findOneAndUpdate(
      { _id: lot._id, status: 'active', remaining: { $gte: cost } },
      { $inc: { remaining: -cost } },
      { new: true }
    );
    if (!updated) continue; // lost a race on this lot — try the next one
    if (updated.remaining === 0) await CreditLot.updateOne({ _id: updated._id, remaining: 0 }, { $set: { status: 'exhausted' } });
    const { balance } = await getBalance(locationId, contactId);
    await LedgerEntry.updateOne({ _id: c.entry._id }, { $set: { lotId: updated._id, balanceAfter: balance } });
    return { ok: true, unlimited: false, lotId: updated._id, charged: cost };
  }

  // 4. Nothing to spend — release the claim so a later retry (after a purchase) can succeed.
  await LedgerEntry.deleteOne({ _id: c.entry._id });
  return { ok: false, reason: 'no_credits' };
}

/** Return credits to the lot they came from (cancellation inside the window, staff override). */
async function refund({ locationId, contactId, lotId, credits, refId, idempotencyKey, actor = 'system', note = '' }) {
  if (!lotId || !credits) return { ok: false, reason: 'nothing_to_refund' };
  const c = await claim({ locationId, contactId, lotId, delta: credits, reason: 'refund', refId, idempotencyKey, actor, note });
  if (!c.claimed) return { ok: true, duplicate: true };

  const now = new Date();
  const lot = await CreditLot.findOneAndUpdate(
    { _id: lotId, kind: { $ne: 'unlimited' } },
    { $inc: { remaining: credits } },
    { new: true }
  );
  if (!lot) {
    await LedgerEntry.deleteOne({ _id: c.entry._id });
    return { ok: false, reason: 'lot_not_found' };
  }
  // An exhausted lot comes back to life; an expired one stays expired (the refunded credit expires with it).
  if (lot.status === 'exhausted' && lot.expiresAt > now) {
    await CreditLot.updateOne({ _id: lot._id }, { $set: { status: 'active' } });
  } else if (lot.status === 'expired') {
    await CreditLot.updateOne({ _id: lot._id }, { $inc: { remaining: -credits } });
    await LedgerEntry.updateOne({ _id: c.entry._id }, { $set: { delta: 0, note: `${note} (lot already expired)`.trim() } });
    return { ok: false, reason: 'lot_expired' };
  }
  const { balance } = await getBalance(locationId, contactId);
  await LedgerEntry.updateOne({ _id: c.entry._id }, { $set: { balanceAfter: balance } });
  return { ok: true };
}

/**
 * Manual adjustment from staff or a workflow action. Positive = grant a new lot, negative = spend
 * from existing lots (soonest-expiring first), possibly across several lots.
 */
async function adjust({ locationId, contactId, delta, validityDays, note = '', actor = 'staff', idempotencyKey, sourceType = 'adjust' }) {
  const n = Math.trunc(Number(delta));
  if (!n) throw Object.assign(new Error('Adjustment must be a non-zero whole number'), { status: 400 });

  if (n > 0) {
    const { lot, duplicate } = await grant({
      locationId, contactId, credits: n, validityDays, kind: 'manual', name: 'Manual credits',
      source: { type: sourceType, refId: null }, idempotencyKey, actor, note
    });
    return { ok: true, delta: n, lotId: lot?._id, duplicate };
  }

  let toRemove = -n;
  const { balance } = await getBalance(locationId, contactId);
  if (balance < toRemove) throw Object.assign(new Error(`Member only has ${balance} credits`), { status: 400 });

  const lots = await CreditLot.find({ locationId, contactId, status: 'active', kind: { $ne: 'unlimited' }, remaining: { $gt: 0 }, expiresAt: { $gt: new Date() } })
    .sort({ expiresAt: 1 }).lean();
  let i = 0;
  const entryIds = [];
  for (const lot of lots) {
    if (toRemove <= 0) break;
    const take = Math.min(lot.remaining, toRemove);
    const key = idempotencyKey ? `${idempotencyKey}:${i++}` : undefined;
    const c = await claim({ locationId, contactId, lotId: lot._id, delta: -take, reason: 'adjust', idempotencyKey: key, actor, note });
    if (!c.claimed) { toRemove -= take; continue; }
    const updated = await CreditLot.findOneAndUpdate({ _id: lot._id, remaining: { $gte: take } }, { $inc: { remaining: -take } }, { new: true });
    if (!updated) { await LedgerEntry.deleteOne({ _id: c.entry._id }); continue; }
    if (updated.remaining === 0) await CreditLot.updateOne({ _id: updated._id, remaining: 0 }, { $set: { status: 'exhausted' } });
    entryIds.push(c.entry._id);
    toRemove -= take;
  }
  const after = await getBalance(locationId, contactId);
  if (entryIds.length) await LedgerEntry.updateMany({ _id: { $in: entryIds } }, { $set: { balanceAfter: after.balance } });
  return { ok: toRemove === 0, delta: n + toRemove };
}

/** Expire every lot past its date. Returns the affected { locationId, contactId } pairs. */
async function expireDue(now = new Date()) {
  const due = await CreditLot.find({ status: 'active', expiresAt: { $lte: now } }).limit(500);
  const touched = [];
  for (const lot of due) {
    const res = await CreditLot.updateOne({ _id: lot._id, status: 'active' }, { $set: { status: 'expired' } });
    if (!res.modifiedCount) continue;
    if (lot.kind !== 'unlimited' && lot.remaining > 0) {
      await claim({
        locationId: lot.locationId, contactId: lot.contactId, lotId: lot._id,
        delta: -lot.remaining, reason: 'expire', idempotencyKey: `expire:${lot._id}`, note: `${lot.packageName} expired`
      });
    }
    touched.push({ locationId: lot.locationId, contactId: lot.contactId, lot });
  }
  if (touched.length) logger.info('⏳ Expired credit lots', { count: touched.length });
  return touched;
}

/** Revoke a lot entirely (refunded purchase, mistake). */
async function revokeLot({ locationId, lotId, actor = 'staff', note = '' }) {
  const lot = await CreditLot.findOne({ _id: lotId, locationId });
  if (!lot) throw Object.assign(new Error('Lot not found'), { status: 404 });
  if (lot.status === 'revoked') return { ok: true, duplicate: true };
  const removed = lot.kind === 'unlimited' ? 0 : lot.remaining || 0;
  await CreditLot.updateOne({ _id: lot._id }, { $set: { status: 'revoked', remaining: lot.kind === 'unlimited' ? null : 0 } });
  await claim({ locationId, contactId: lot.contactId, lotId: lot._id, delta: -removed, reason: 'revoke', idempotencyKey: `revoke:${lot._id}`, actor, note });
  return { ok: true, contactId: lot.contactId };
}

module.exports = { getBalance, grant, consume, refund, adjust, expireDue, revokeLot, DAY };
