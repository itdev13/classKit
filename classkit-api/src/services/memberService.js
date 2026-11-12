const Member = require('../models/Member');
const Workspace = require('../models/Workspace');
const creditService = require('./creditService');
const ghlService = require('./ghlService');
const notifyService = require('./notifyService');
const triggerService = require('./triggerService');
const logger = require('../utils/logger');

const TAGS = { active: 'classkit-active', empty: 'classkit-no-credits', unlimited: 'classkit-unlimited', low: 'classkit-low-credits' };

function digits(phone) { return String(phone || '').replace(/\D/g, '').slice(-10); }

/** Ensure a Member row exists, hydrating name/phone from GHL the first time we see a contact. */
async function ensure(locationId, contactId, hint = {}) {
  let m = await Member.findOne({ locationId, contactId });
  if (m && m.name && !hint.force) return m;
  const c = hint.contact || (await ghlService.getContact(locationId, contactId)) || {};
  const fields = {
    name: hint.name || c.name || m?.name || 'Member',
    firstName: hint.firstName || c.firstName || (hint.name || c.name || '').split(' ')[0] || '',
    email: hint.email || c.email || m?.email || '',
    phone: hint.phone || c.phone || m?.phone || ''
  };
  fields.phoneDigits = digits(fields.phone);
  m = await Member.findOneAndUpdate({ locationId, contactId }, { $set: fields, $setOnInsert: { locationId, contactId } }, { upsert: true, new: true });
  return m;
}

/**
 * Recompute the member's balance from their lots, mirror it onto the GHL contact (custom fields +
 * tags) and fire the low-credit trigger/SMS once each time they cross below the threshold.
 */
async function refresh(locationId, contactId, { workspace, silent = false } = {}) {
  const ws = workspace || (await Workspace.findOne({ locationId }));
  const member = await ensure(locationId, contactId);
  const prevBalance = member.balance;
  const { balance, unlimitedUntil, nextExpiry } = await creditService.getBalance(locationId, contactId);
  member.balance = balance;
  member.unlimitedUntil = unlimitedUntil;
  member.nextExpiry = nextExpiry;

  const threshold = ws?.policy?.lowCreditThreshold ?? 2;
  const isLow = !unlimitedUntil && balance <= threshold;
  let crossedLow = false;
  if (isLow && balance < prevBalance && !member.lowNotifiedAt) {
    member.lowNotifiedAt = new Date();
    crossedLow = true;
  } else if (!isLow) {
    member.lowNotifiedAt = null; // re-arm after they top up
  }
  await member.save();

  if (ws) syncToGhl(ws, member).catch(() => {});

  if (crossedLow && !silent && ws) {
    notifyService.send(ws, 'lowCredits', contactId, { first_name: member.firstName, credits: balance });
    triggerService.fire(triggerService.TRIGGERS.CREDITS_LOW, locationId, {
      contactId, credits: balance, threshold, nextExpiry: nextExpiry ? nextExpiry.toISOString() : null
    });
  }
  return member;
}

async function syncToGhl(ws, member) {
  const { locationId } = ws;
  const { contactId, balance, unlimitedUntil, nextExpiry } = member;
  try {
    const cf = [];
    if (ws.customFieldIds?.credits) cf.push({ id: ws.customFieldIds.credits, value: balance });
    if (ws.customFieldIds?.expiry) cf.push({ id: ws.customFieldIds.expiry, value: (unlimitedUntil || nextExpiry) ? new Date(unlimitedUntil || nextExpiry).toISOString().slice(0, 10) : '' });
    if (cf.length) await ghlService.updateContactCustomFields(locationId, contactId, cf);

    const add = [];
    const remove = [];
    const hasAny = balance > 0 || !!unlimitedUntil;
    (hasAny ? add : remove).push(TAGS.active);
    (hasAny ? remove : add).push(TAGS.empty);
    (unlimitedUntil ? add : remove).push(TAGS.unlimited);
    const low = !unlimitedUntil && balance <= (ws.policy?.lowCreditThreshold ?? 2) && balance > 0;
    (low ? add : remove).push(TAGS.low);
    await ghlService.addTags(locationId, contactId, add);
    await ghlService.removeTags(locationId, contactId, remove);
  } catch (err) {
    logger.warn('member GHL sync failed (non-blocking)', { contactId, message: err.response?.data?.message || err.message });
  }
}

module.exports = { ensure, refresh, digits, TAGS };
