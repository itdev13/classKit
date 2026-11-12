const express = require('express');
const router = express.Router();
const Installation = require('../models/Installation');
const OAuthToken = require('../models/OAuthToken');
const Workspace = require('../models/Workspace');
const CompanyLocation = require('../models/CompanyLocation');
const bookingService = require('../services/bookingService');
const orderService = require('../services/orderService');
const database = require('../config/database');
const logger = require('../utils/logger');
const { webhookSignatureGuard } = require('../utils/webhookSignature');

/**
 * Single webhook URL for everything GHL sends ClassKit: POST /api/webhooks/ghl
 *   App lifecycle: INSTALL / UNINSTALL / UPDATE
 *   Appointments:  AppointmentCreate / AppointmentUpdate / AppointmentDelete
 *   Payments:      OrderCreate / OrderStatusUpdate / InvoicePaid
 * Always answers 200 for event errors so GHL doesn't retry-storm; idempotency makes retries safe anyway.
 */
router.use(webhookSignatureGuard);

const APPOINTMENT = ['AppointmentCreate', 'AppointmentUpdate', 'AppointmentDelete'];
const PAYMENT = ['OrderCreate', 'OrderStatusUpdate', 'InvoicePaid'];

router.post('/ghl', async (req, res) => {
  const data = req.body || {};
  const type = data.type;
  const companyId = (data.companyId || '').trim() || null;
  const locationId = (data.locationId || '').trim() || null;
  logger.info('📥 Webhook', { type, locationId });
  if (String(process.env.LOG_WEBHOOK_PAYLOADS || '').toLowerCase() === 'true') {
    logger.info('📦 Webhook payload', { type, payload: JSON.stringify(data).slice(0, 4000) });
  }
  if (!type) return res.status(400).json({ success: false, error: 'Missing type' });
  if (!database.isConnected()) return res.status(200).json({ success: true, persisted: false });

  try {
    if (APPOINTMENT.includes(type)) {
      if (!locationId) return res.json({ success: true, ignored: 'no_location' });
      const result = await bookingService.handleAppointmentEvent(locationId, type, data);
      return res.json({ success: true, type, ...summarize(result) });
    }
    if (PAYMENT.includes(type)) {
      if (!locationId) return res.json({ success: true, ignored: 'no_location' });
      const result = await orderService.handlePaid(locationId, type, data);
      return res.json({ success: true, type, ...result });
    }

    switch (type) {
      case 'INSTALL': {
        await Installation.findOneAndUpdate(
          locationId ? { appId: data.appId, locationId } : { appId: data.appId, companyId, locationId: null },
          { appId: data.appId, companyId, locationId, userId: data.userId, companyName: data.companyName, planId: data.planId, versionId: data.versionId || null, status: 'active', installedAt: new Date(), rawWebhookData: data },
          { upsert: true, new: true }
        );
        if (locationId) {
          await Workspace.findOneAndUpdate(
            { locationId },
            { $setOnInsert: { locationId, installerUserId: data.userId || null }, $set: { companyId, active: true } },
            { upsert: true, setDefaultsOnInsert: true }
          );
          // Agency installs: GHL sends one INSTALL per sub-account the agency enables (now or later).
          // Record the link so this sub-account can mint its token from the agency's company token.
          if (companyId) {
            await CompanyLocation.updateOne({ companyId }, { $addToSet: { locationIds: locationId } }, { upsert: true });
          }
        }
        break;
      }
      case 'UNINSTALL': {
        await Installation.findOneAndUpdate(
          locationId ? { appId: data.appId, locationId } : { appId: data.appId, companyId, locationId: null },
          { status: 'uninstalled', uninstalledAt: new Date(), uninstallReason: data.reason || null }
        );
        await OAuthToken.deleteMany(locationId ? { locationId } : { companyId });
        // Keep members' credits — they paid for them. Just stop processing events until reinstall.
        await Workspace.updateMany(locationId ? { locationId } : { companyId }, { $set: { active: false } });
        break;
      }
      case 'UPDATE':
      case 'APP_UPDATE':
        await Installation.updateMany(
          locationId ? { locationId, status: 'active' } : { companyId, status: 'active' },
          { $set: { versionId: data.versionId || data.version || null } }
        );
        break;
      default:
        return res.json({ success: true, ignored: type });
    }
    return res.json({ success: true, type });
  } catch (err) {
    logger.error('Webhook processing error', { type, message: err.message, stack: err.stack });
    return res.status(200).json({ success: false, error: err.message });
  }
});

function summarize(r = {}) {
  const { booking, member, ...rest } = r;
  return { ...rest, bookingStatus: booking?.status };
}

module.exports = router;
