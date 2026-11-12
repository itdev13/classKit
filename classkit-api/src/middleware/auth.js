const jwt = require('jsonwebtoken');
const Workspace = require('../models/Workspace');
const logger = require('../utils/logger');

/**
 * Session auth for the embedded UI (same model as HelmDesk). The JWT's locationId is the tenant
 * boundary: routes read req.auth.locationId and never trust one from the body/query.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, error: 'Missing session token' });
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = { locationId: d.locationId, companyId: d.companyId || null, userId: d.userId || null, name: d.name || null, role: d.role || 'staff' };
    if (!req.auth.locationId) return res.status(401).json({ success: false, error: 'Invalid session' });
    return next();
  } catch (err) {
    logger.warn('JWT verification failed', { message: err.message });
    return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  }
}

function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required', code: 'ADMIN_ONLY' });
  return next();
}

/** Load the caller's workspace onto req.ws. */
async function loadWorkspace(req, res, next) {
  try {
    const ws = await Workspace.findOne({ locationId: req.auth.locationId });
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found. Reinstall ClassKit.' });
    req.ws = ws;
    return next();
  } catch (e) { return next(e); }
}

function signSession({ locationId, companyId, userId, name, role }) {
  return jwt.sign({ locationId, companyId, userId, name, role: role || 'staff' }, process.env.JWT_SECRET, { expiresIn: process.env.SESSION_TTL || '12h' });
}

/** Wrap async route handlers so thrown errors (with .status) become JSON responses. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { requireAuth, requireAdmin, loadWorkspace, signSession, wrap };
