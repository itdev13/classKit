const ghlService = require('./ghlService');
const logger = require('../utils/logger');

/**
 * Member-facing SMS, sent through the studio's own GHL number via Conversations.
 * Templates live on the workspace (editable in Settings); an empty template = don't send.
 */
function formatWhen(date, timezone) {
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(date));
  } catch (_) {
    return new Date(date).toISOString();
  }
}

function formatDate(date, timezone) {
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date));
  } catch (_) {
    return new Date(date).toISOString().slice(0, 10);
  }
}

function render(template, vars) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k]))).replace(/\s{2,}/g, ' ').trim();
}

/** Send a templated SMS. Never throws — messaging failures must not break bookings. */
async function send(workspace, key, contactId, vars = {}) {
  try {
    if (!workspace?.policy?.smsEnabled || !contactId) return false;
    const template = workspace.template(key);
    if (!template) return false;
    const msg = render(template, {
      buy_link: workspace.buyUrl || '',
      cancel_window: workspace.policy.cancelWindowHours,
      studio_name: workspace.brand?.name || workspace.locationName || '',
      ...vars
    });
    if (!msg) return false;
    await ghlService.sendSms(workspace.locationId, contactId, msg);
    return true;
  } catch (err) {
    logger.warn('SMS send failed (non-blocking)', { key, contactId, message: err.response?.data?.message || err.message });
    return false;
  }
}

module.exports = { send, render, formatWhen, formatDate };
