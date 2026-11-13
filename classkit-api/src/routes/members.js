const express = require('express');
const router = express.Router();
const Member = require('../models/Member');
const CreditLot = require('../models/CreditLot');
const LedgerEntry = require('../models/LedgerEntry');
const Booking = require('../models/Booking');
const Package = require('../models/Package');
const creditService = require('../services/creditService');
const memberService = require('../services/memberService');
const notifyService = require('../services/notifyService');
const ghlService = require('../services/ghlService');
const { wrap } = require('../middleware/auth');

const DAY = 864e5;
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** GET /api/members?q=&filter=all|low|expiring|inactive|unlimited&page= */
router.get('/', wrap(async (req, res) => {
  const { locationId } = req.ws;
  const now = new Date();
  const q = String(req.query.q || '').trim();
  const filter = String(req.query.filter || 'all');
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 50;
  const match = { locationId };
  if (q) {
    const d = q.replace(/\D/g, '');
    match.$or = [{ name: new RegExp(escapeRx(q), 'i') }, { email: new RegExp(escapeRx(q), 'i') }];
    if (d.length >= 3) match.$or.push({ phoneDigits: new RegExp(escapeRx(d)) });
  }
  const threshold = req.ws.policy.lowCreditThreshold ?? 2;
  if (filter === 'low') Object.assign(match, { balance: { $lte: threshold }, $and: [{ $or: [{ unlimitedUntil: null }, { unlimitedUntil: { $lte: now } }] }] });
  if (filter === 'expiring') match.nextExpiry = { $gt: now, $lte: new Date(now.getTime() + 14 * DAY) };
  if (filter === 'inactive') Object.assign(match, { $and: [{ $or: [{ lastVisitAt: null }, { lastVisitAt: { $lt: new Date(now.getTime() - 14 * DAY) } }] }, { $or: [{ balance: { $gt: 0 } }, { unlimitedUntil: { $gt: now } }] }] });
  if (filter === 'unlimited') match.unlimitedUntil = { $gt: now };

  const [members, total] = await Promise.all([
    Member.find(match).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Member.countDocuments(match)
  ]);
  res.json({ success: true, members, total, page, pages: Math.ceil(total / limit) });
}));

/** GET /api/members/contacts?q= — HighLevel contacts matching q that aren't ClassKit members yet. */
router.get('/contacts', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ success: true, contacts: [] });
  let contacts = [];
  try {
    contacts = await ghlService.searchContacts(req.ws.locationId, q, 8);
  } catch (e) {
    return res.json({ success: true, contacts: [], warning: 'Could not search HighLevel contacts' });
  }
  const known = new Set((await Member.find({ locationId: req.ws.locationId, contactId: { $in: contacts.map((c) => c.contactId) } }, 'contactId').lean()).map((m) => m.contactId));
  res.json({ success: true, contacts: contacts.filter((c) => !known.has(c.contactId)) });
}));

/** POST /api/members — add a walk-in (creates/merges the GHL contact), or { contactId } to use an existing contact. */
router.post('/', wrap(async (req, res) => {
  if (req.body?.contactId) {
    const contactId = String(req.body.contactId);
    await memberService.ensure(req.ws.locationId, contactId, { force: true });
    const m = await memberService.refresh(req.ws.locationId, contactId, { workspace: req.ws, silent: true });
    return res.json({ success: true, member: m });
  }
  const { name, email, phone } = req.body || {};
  if (!name || (!email && !phone)) return res.status(400).json({ success: false, error: 'Name plus a phone or email is required' });
  const c = await ghlService.upsertContact(req.ws.locationId, { name, email, phone });
  const contactId = c.id || c._id;
  const m = await memberService.ensure(req.ws.locationId, contactId, { name, email, phone, force: true });
  res.json({ success: true, member: m });
}));

router.get('/:contactId', wrap(async (req, res) => {
  const { locationId } = req.ws;
  const { contactId } = req.params;
  const member = await memberService.refresh(locationId, contactId, { workspace: req.ws, silent: true });
  const [lots, ledger, bookings] = await Promise.all([
    CreditLot.find({ locationId, contactId }).sort({ createdAt: -1 }).limit(50).lean(),
    LedgerEntry.find({ locationId, contactId }).sort({ createdAt: -1 }).limit(100).lean(),
    Booking.find({ locationId, contactId }).sort({ startTime: -1 }).limit(50).lean()
  ]);
  const names = Object.fromEntries(req.ws.calendars.map((c) => [c.calendarId, c.name]));
  res.json({ success: true, member, lots, ledger, bookings: bookings.map((b) => ({ ...b, className: names[b.calendarId] || b.title })) });
}));

/** POST /api/members/:contactId/adjust { delta, note, validityDays } */
router.post('/:contactId/adjust', wrap(async (req, res) => {
  const { delta, note, validityDays, requestId } = req.body || {};
  if (!String(note || '').trim()) return res.status(400).json({ success: false, error: 'Add a short reason for the adjustment' });
  const r = await creditService.adjust({
    locationId: req.ws.locationId, contactId: req.params.contactId, delta, note: String(note).slice(0, 200),
    validityDays: Number(validityDays) || req.ws.policy.defaultValidityDays, actor: req.auth.name || req.auth.userId || 'staff',
    idempotencyKey: requestId ? `adjust:${req.ws.locationId}:${requestId}` : undefined
  });
  const member = await memberService.refresh(req.ws.locationId, req.params.contactId, { workspace: req.ws });
  res.json({ success: true, result: r, member });
}));

/** POST /api/members/:contactId/grant { packageId, note, requestId } — sold at the front desk / comp. */
router.post('/:contactId/grant', wrap(async (req, res) => {
  const { packageId, note, requestId, notify = true } = req.body || {};
  const pkg = await Package.findOne({ _id: packageId, locationId: req.ws.locationId });
  if (!pkg) return res.status(404).json({ success: false, error: 'Package not found' });
  const { lot, duplicate } = await creditService.grant({
    locationId: req.ws.locationId, contactId: req.params.contactId, pkg,
    source: { type: 'manual', refId: null }, actor: req.auth.name || 'staff', note: note || 'Front desk',
    idempotencyKey: requestId ? `grant:${req.ws.locationId}:${requestId}` : undefined
  });
  const member = await memberService.refresh(req.ws.locationId, req.params.contactId, { workspace: req.ws, silent: true });
  if (!duplicate && notify) {
    notifyService.send(req.ws, 'purchased', req.params.contactId, {
      first_name: member.firstName, package_name: pkg.name, credits: pkg.kind === 'unlimited' ? 'unlimited' : member.balance,
      expiry_date: notifyService.formatDate(lot.expiresAt, req.ws.timezone)
    });
  }
  res.json({ success: true, lot, duplicate, member });
}));

router.post('/:contactId/lots/:lotId/revoke', wrap(async (req, res) => {
  await creditService.revokeLot({ locationId: req.ws.locationId, lotId: req.params.lotId, actor: req.auth.name || 'staff', note: req.body?.note || '' });
  const member = await memberService.refresh(req.ws.locationId, req.params.contactId, { workspace: req.ws, silent: true });
  res.json({ success: true, member });
}));

module.exports = router;
