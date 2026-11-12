const express = require('express');
const router = express.Router();
const Package = require('../models/Package');
const CreditLot = require('../models/CreditLot');
const { requireAdmin, wrap } = require('../middleware/auth');

function clean(b = {}) {
  const out = {};
  if ('name' in b) out.name = String(b.name || '').trim().slice(0, 80);
  if ('kind' in b) out.kind = ['pack', 'unlimited', 'dropin'].includes(b.kind) ? b.kind : 'pack';
  if ('credits' in b) out.credits = Math.max(0, Math.trunc(Number(b.credits) || 0));
  if ('validityDays' in b) out.validityDays = Math.max(1, Math.trunc(Number(b.validityDays) || 30));
  if ('priceUsd' in b) out.priceUsd = Math.max(0, Number(b.priceUsd) || 0);
  for (const k of ['ghlProductIds', 'ghlPriceIds', 'calendarIds']) if (Array.isArray(b[k])) out[k] = b[k].map(String).filter(Boolean);
  if ('active' in b) out.active = !!b.active;
  if ('sortOrder' in b) out.sortOrder = Number(b.sortOrder) || 0;
  if (out.kind === 'dropin') out.credits = out.credits || 1;
  return out;
}

router.get('/', wrap(async (req, res) => {
  const pkgs = await Package.find({ locationId: req.ws.locationId }).sort({ active: -1, sortOrder: 1, createdAt: 1 }).lean();
  const sold = await CreditLot.aggregate([
    { $match: { locationId: req.ws.locationId, packageId: { $ne: null } } },
    { $group: { _id: '$packageId', n: { $sum: 1 } } }
  ]);
  const soldMap = Object.fromEntries(sold.map((s) => [String(s._id), s.n]));
  res.json({ success: true, packages: pkgs.map((p) => ({ ...p, sold: soldMap[String(p._id)] || 0 })) });
}));

router.post('/', requireAdmin, wrap(async (req, res) => {
  const data = clean(req.body);
  if (!data.name) return res.status(400).json({ success: false, error: 'Name is required' });
  if (data.kind !== 'unlimited' && !data.credits) return res.status(400).json({ success: false, error: 'Credits must be at least 1' });
  const pkg = await Package.create({ ...data, locationId: req.ws.locationId });
  res.json({ success: true, package: pkg });
}));

router.put('/:id', requireAdmin, wrap(async (req, res) => {
  const pkg = await Package.findOneAndUpdate({ _id: req.params.id, locationId: req.ws.locationId }, { $set: clean(req.body) }, { new: true, runValidators: true });
  if (!pkg) return res.status(404).json({ success: false, error: 'Package not found' });
  res.json({ success: true, package: pkg });
}));

// Packages with sales are archived (active=false) rather than deleted so history keeps its name.
router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  const used = await CreditLot.exists({ packageId: req.params.id });
  if (used) {
    await Package.updateOne({ _id: req.params.id, locationId: req.ws.locationId }, { $set: { active: false } });
    return res.json({ success: true, archived: true });
  }
  await Package.deleteOne({ _id: req.params.id, locationId: req.ws.locationId });
  res.json({ success: true, deleted: true });
}));

module.exports = router;
