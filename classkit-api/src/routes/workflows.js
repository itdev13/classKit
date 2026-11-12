const express = require('express');
const router = express.Router();
const Workspace = require('../models/Workspace');
const Package = require('../models/Package');
const creditService = require('../services/creditService');
const memberService = require('../services/memberService');
const triggerService = require('../services/triggerService');
const logger = require('../utils/logger');

/**
 * GHL calls these. Register in Marketplace → app:
 *   Triggers  → subscription URL  {BASE_URL}/api/workflows/triggers/subscriptions  (keys in triggerService.TRIGGERS)
 *   Actions   → {BASE_URL}/api/workflows/actions/add-credits      inputs: credits, validityDays, note
 *               {BASE_URL}/api/workflows/actions/remove-credits   inputs: credits, note
 *               {BASE_URL}/api/workflows/actions/grant-package    inputs: packageName
 * 200 {success:true} on success, 400 {success:false,message} on failure (shown in execution history).
 */
router.post('/triggers/subscriptions', async (req, res) => {
  try { res.json(await triggerService.handleSubscription(req.body)); } catch (e) { res.status(400).json({ success: false, message: e.message }); }
});

const str = (v) => (v == null ? '' : String(v).trim());

async function actionContext(body = {}) {
  const extras = body.extras || {};
  const data = body.data || body.inputData || {};
  const locationId = extras.locationId;
  const contactId = extras.contactId || data.contactId;
  if (!locationId || !contactId) throw new Error('This action needs a contact (run it from a contact-based trigger).');
  const ws = await Workspace.findOne({ locationId, active: true });
  if (!ws) throw new Error('ClassKit is not active on this sub-account.');
  // One execution of a workflow step = one key, so GHL retries don't double-grant.
  const execId = extras.executionId || extras.workflowExecutionId || body.executionId || body.meta?.executionId || null;
  return { ws, data, contactId, idem: execId ? `wf:${extras.workflowId}:${execId}` : undefined };
}

router.post('/actions/:action', async (req, res) => {
  const { action } = req.params;
  try {
    const { ws, data, contactId, idem } = await actionContext(req.body);
    let result;
    if (action === 'add-credits' || action === 'remove-credits') {
      const n = Math.trunc(Number(data.credits));
      if (!n || n < 0) throw new Error('Credits must be a positive whole number');
      result = await creditService.adjust({
        locationId: ws.locationId, contactId, delta: action === 'add-credits' ? n : -n,
        validityDays: Number(data.validityDays) || ws.policy.defaultValidityDays,
        note: str(data.note) || `Workflow ${action}`, actor: 'workflow', idempotencyKey: idem, sourceType: 'workflow'
      });
    } else if (action === 'grant-package') {
      const name = str(data.packageName || data.package);
      const pkg = await Package.findOne({ locationId: ws.locationId, active: true, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
      if (!pkg) throw new Error(`No active ClassKit package named "${name}"`);
      const g = await creditService.grant({ locationId: ws.locationId, contactId, pkg, source: { type: 'workflow', refId: null }, actor: 'workflow', idempotencyKey: idem });
      result = { granted: pkg.name, duplicate: g.duplicate };
    } else {
      return res.status(400).json({ success: false, message: `Unknown action ${action}` });
    }
    const m = await memberService.refresh(ws.locationId, contactId, { workspace: ws });
    res.json({ success: true, data: { ...result, balance: m.balance }, balance: m.balance });
  } catch (e) {
    logger.warn('workflow action failed', { action, message: e.message });
    res.status(400).json({ success: false, message: e.message });
  }
});

module.exports = router;
