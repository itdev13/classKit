const axios = require('axios');
const WorkflowSubscription = require('../models/WorkflowSubscription');
const ghlService = require('./ghlService');
const logger = require('../utils/logger');

/**
 * ClassKit custom workflow TRIGGERS (pattern ported from HelmDesk / Telegram).
 * Register each key in Marketplace → app → Workflow Triggers with subscription URL
 * {BASE_URL}/api/workflows/triggers/subscriptions.
 */
const TRIGGERS = {
  PACK_PURCHASED: 'classkit_pack_purchased',
  CREDITS_LOW: 'classkit_credits_low',
  PACK_EXPIRING: 'classkit_pack_expiring',
  CHECKED_IN: 'classkit_checked_in',
  NO_SHOW: 'classkit_no_show',
  BOOKING_REJECTED: 'classkit_booking_rejected',
  LATE_CANCEL: 'classkit_late_cancel',
  WAITLIST_PROMOTED: 'classkit_waitlist_promoted'
};

async function handleSubscription(body = {}) {
  const { triggerData = {}, extras = {}, meta = {} } = body;
  const { eventType, targetUrl, filters } = triggerData;
  const { locationId, workflowId, companyId } = extras;
  const triggerKey = meta.key;
  if (!workflowId || !triggerKey) throw new Error('Missing workflowId or trigger key in subscription payload');

  if (eventType === 'DELETED') {
    await WorkflowSubscription.findOneAndUpdate({ workflowId, triggerKey }, { status: 'deleted' });
    return { success: true };
  }
  if (!targetUrl) throw new Error('Missing targetUrl');
  await WorkflowSubscription.findOneAndUpdate(
    { workflowId, triggerKey },
    { locationId, companyId: companyId || null, workflowId, triggerKey, targetUrl, filters: filters || {}, extras, meta, status: 'active' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  logger.info('🔗 Workflow trigger subscribed', { triggerKey, workflowId, locationId });
  return { success: true };
}

function isTriggerDead(status, bodyText) {
  const t = String(bodyText || '').toLowerCase();
  return status === 404 || t.includes('trigger is deleted') || t.includes('is inactive') || t.includes('skipping execution');
}

/** Fire-and-forget: never throws into the booking flow. */
async function fire(triggerKey, locationId, eventData) {
  try {
    const subs = await WorkflowSubscription.find({ locationId, triggerKey, status: 'active' });
    if (!subs.length) return 0;
    if (ghlService.isMock()) {
      logger.info(`[ghl-mock] fire trigger ${triggerKey}`, { subs: subs.length, contactId: eventData.contactId });
      return subs.length;
    }
    let token = null;
    try { token = await ghlService.getValidToken(locationId); } catch (_) { /* fire without auth */ }
    const headers = { 'Content-Type': 'application/json', Version: '2021-07-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    await Promise.allSettled(subs.map(async (sub) => {
      try {
        const r = await axios.post(sub.targetUrl, eventData, { headers, timeout: 10000 });
        if (isTriggerDead(r.status, JSON.stringify(r.data || ''))) await WorkflowSubscription.updateOne({ _id: sub._id }, { status: 'deleted' });
      } catch (err) {
        const st = err.response?.status;
        if (isTriggerDead(st, JSON.stringify(err.response?.data || err.message))) await WorkflowSubscription.updateOne({ _id: sub._id }, { status: 'deleted' });
        else logger.warn('trigger fire failed', { triggerKey, workflowId: sub.workflowId, status: st, message: err.message });
      }
    }));
    return subs.length;
  } catch (err) {
    logger.warn('trigger fire errored', { triggerKey, message: err.message });
    return 0;
  }
}

module.exports = { TRIGGERS, handleSubscription, fire };
