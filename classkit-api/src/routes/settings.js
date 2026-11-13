const express = require('express');
const router = express.Router();
const Workspace = require('../models/Workspace');
const ghlService = require('../services/ghlService');
const { requireAdmin, wrap } = require('../middleware/auth');
const currencyService = require('../services/currencyService');
const logger = require('../utils/logger');

const POLICY_KEYS = ['cancelWindowHours', 'blockWithoutCredits', 'autoNoShowMinutes', 'lowCreditThreshold', 'expiryReminderDays',
  'defaultValidityDays', 'waitlistEnabled', 'smsEnabled', 'checkInOpensMins', 'checkInClosesMins'];

function publicLinks(ws) {
  const base = (process.env.UI_BASE_URL || '').replace(/\/$/, '');
  return { kioskUrl: `${base}/kiosk/${ws.kioskToken}`, scheduleUrl: `${base}/s/${ws.publicSlug}` };
}

function view(ws) {
  return {
    locationId: ws.locationId, locationName: ws.locationName, timezone: ws.timezone, setupComplete: ws.setupComplete,
    currency: currencyService.effective(ws), currencyLocked: ws.currencyLocked,
    calendars: ws.calendars, policy: ws.policy, templates: { ...Workspace.DEFAULT_TEMPLATES, ...(ws.templates || {}) },
    buyUrl: ws.buyUrl, brand: ws.brand, customFieldIds: ws.customFieldIds, ...publicLinks(ws)
  };
}

router.get('/', wrap(async (req, res) => res.json({ success: true, settings: view(req.ws) })));

/** GHL calendars merged with this studio's credit config. */
router.get('/calendars', wrap(async (req, res) => {
  const ghl = await ghlService.listCalendars(req.ws.locationId);
  const merged = ghl.map((c) => {
    const cfg = req.ws.calendarConfig(c.calendarId);
    return {
      calendarId: c.calendarId, name: c.name, calendarType: c.calendarType,
      enabled: !!cfg?.usesCredits, creditCost: cfg?.creditCost ?? 1,
      capacity: cfg?.capacity ?? c.capacity ?? 10, durationMins: cfg?.durationMins ?? c.durationMins ?? 60
    };
  });
  res.json({ success: true, calendars: merged });
}));

router.get('/products', wrap(async (req, res) => {
  res.json({ success: true, products: await ghlService.listProducts(req.ws.locationId) });
}));

router.put('/', requireAdmin, wrap(async (req, res) => {
  const ws = req.ws;
  const b = req.body || {};
  if (Array.isArray(b.calendars)) {
    ws.calendars = b.calendars.filter((c) => c.calendarId).map((c) => ({
      calendarId: String(c.calendarId), name: String(c.name || ''), usesCredits: c.enabled ?? c.usesCredits ?? true,
      creditCost: Math.max(0, Number(c.creditCost ?? 1)), capacity: Math.max(1, Number(c.capacity || 10)), durationMins: Math.max(5, Number(c.durationMins || 60))
    }));
  }
  if (b.policy) for (const k of POLICY_KEYS) if (k in b.policy) ws.policy[k] = b.policy[k];
  if (b.templates) {
    const t = { ...(ws.templates || {}) };
    for (const k of Object.keys(Workspace.DEFAULT_TEMPLATES)) if (k in b.templates) t[k] = String(b.templates[k] ?? '').slice(0, 480);
    ws.templates = t;
    ws.markModified('templates');
  }
  if ('buyUrl' in b) ws.buyUrl = String(b.buyUrl || '').trim();
  if (b.brand) {
    const cur = ws.brand.toObject?.() ?? ws.brand;
    const next = { ...cur };
    if ('name' in b.brand) next.name = String(b.brand.name || '').trim().slice(0, 60);
    if ('color' in b.brand) {
      if (!/^#[0-9a-f]{6}$/i.test(b.brand.color || '')) return res.status(400).json({ success: false, error: 'Brand colour must look like #5B4BDB' });
      next.color = b.brand.color;
    }
    if ('logoUrl' in b.brand) {
      const logo = String(b.brand.logoUrl || '').trim();
      const okUrl = /^https:\/\/[^\s"'<>]{4,1000}$/i.test(logo);
      const okData = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(logo) && logo.length <= 400000;
      if (logo && !okUrl && !okData) return res.status(400).json({ success: false, error: 'Logo must be an uploaded image (under 300 KB) or an https:// link' });
      next.logoUrl = logo;
    }
    ws.brand = next;
  }
  if ('timezone' in b && b.timezone && String(b.timezone) !== ws.timezone) {
    const tz = String(b.timezone).trim();
    if (!require('../services/locationService').validTz(tz)) return res.status(400).json({ success: false, error: 'Unknown time zone. Use a name like America/New_York.' });
    ws.timezone = tz;
    ws.timezoneLocked = true;
  }
  if ('currency' in b) {
    const c = currencyService.normalize(b.currency);
    if (b.currency && !c) return res.status(400).json({ success: false, error: 'Unknown currency code.' });
    if (c && c !== currencyService.effective(ws)) { ws.currency = c; ws.currencyLocked = true; }
  }
  await ws.save();
  res.json({ success: true, settings: view(ws) });
}));

/** Finish the wizard: create the GHL custom fields we mirror balances into, then go live. */
router.post('/complete-setup', requireAdmin, wrap(async (req, res) => {
  const ws = req.ws;
  if (!ws.calendars.some((c) => c.usesCredits)) return res.status(400).json({ success: false, error: 'Pick at least one class calendar.' });
  try {
    ws.customFieldIds = await ghlService.ensureCustomFields(ws.locationId);
  } catch (e) {
    logger.warn('custom field setup failed (continuing without balance fields)', { message: e.response?.data?.message || e.message });
  }
  ws.setupComplete = true;
  await ws.save();
  res.json({ success: true, settings: view(ws) });
}));

router.post('/rotate-kiosk', requireAdmin, wrap(async (req, res) => {
  req.ws.kioskToken = require('crypto').randomBytes(16).toString('hex');
  await req.ws.save();
  res.json({ success: true, ...publicLinks(req.ws) });
}));

module.exports = router;
