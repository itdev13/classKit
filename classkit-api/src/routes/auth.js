const express = require('express');
const router = express.Router();
const CryptoJS = require('crypto-js');
const OAuthToken = require('../models/OAuthToken');
const CompanyLocation = require('../models/CompanyLocation');
const Workspace = require('../models/Workspace');
const { signSession, wrap } = require('../middleware/auth');
const logger = require('../utils/logger');

/** Decrypt the GHL Custom Page SSO payload → { userId, companyId, activeLocation, role, type, ... }. */
function decryptSSO(encrypted) {
  const bytes = CryptoJS.AES.decrypt(encrypted, process.env.GHL_SSO_KEY);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}

/**
 * POST /api/auth/verify — { encryptedData } from the GHL iframe (or { locationId } when ALLOW_DEV_LOGIN).
 * Returns a session JWT + workspace state. Admins: the installer, promoted users, GHL admins, and
 * anyone before setup is complete.
 */
router.post('/verify', wrap(async (req, res) => {
  let ctx = null;
  if (req.body.encryptedData && process.env.GHL_SSO_KEY) {
    try { ctx = decryptSSO(req.body.encryptedData); } catch (e) { logger.warn('SSO decrypt failed', { message: e.message }); }
  }
  let locationId = ctx?.activeLocation || ctx?.locationId || null;
  let companyId = ctx?.companyId || null;
  const userId = ctx?.userId || null;
  const name = ctx?.userName || [ctx?.firstName, ctx?.lastName].filter(Boolean).join(' ') || null;

  if (!locationId && req.body.locationId) {
    if (String(process.env.ALLOW_DEV_LOGIN || '').toLowerCase() !== 'true') return res.status(401).json({ success: false, error: 'SSO required.' });
    locationId = String(req.body.locationId);
    logger.warn('⚠️ DEV LOGIN used (ALLOW_DEV_LOGIN=true) — must be off in production', { locationId });
  }
  if (!locationId) return res.status(400).json({ success: false, error: 'Open ClassKit from inside a sub-account.' });

  const token = await OAuthToken.findActiveToken(locationId);
  if (!token) {
    const cl = await CompanyLocation.findCompanyByLocation(locationId);
    const devOk = String(process.env.ALLOW_DEV_LOGIN || '').toLowerCase() === 'true';
    if (!cl && !devOk) return res.status(403).json({ success: false, connected: false, error: 'ClassKit is not installed on this sub-account.' });
    companyId = companyId || cl?.companyId || null;
  } else {
    companyId = companyId || token.companyId;
  }

  const ws = await Workspace.findOneAndUpdate(
    { locationId },
    { $setOnInsert: { locationId, companyId, installerUserId: userId, locationName: token?.locationName || null, timezone: token?.locationTimezone || 'UTC' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (!ws.installerUserId && userId) { ws.installerUserId = userId; await ws.save(); }

  const isAdmin = !ws.setupComplete || (userId && (ws.installerUserId === userId || ws.adminUserIds.includes(userId))) ||
    String(ctx?.role || '').toLowerCase() === 'admin' || String(ctx?.type || '').toLowerCase() === 'agency' || !ctx;
  const role = isAdmin ? 'admin' : 'staff';

  res.json({
    success: true,
    token: signSession({ locationId, companyId, userId, name, role }),
    workspace: { locationId, locationName: ws.brand?.name || ws.locationName, setupComplete: ws.setupComplete, brand: ws.brand, timezone: ws.timezone },
    user: { userId, name, role }
  });
}));

module.exports = router;
