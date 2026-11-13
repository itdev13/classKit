const ghlService = require('./ghlService');
const logger = require('../utils/logger');

const validTz = (tz) => {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
};

/**
 * Agency installs and early installs could leave a workspace without the sub-account's name and with the
 * UTC default time zone. Read them from HighLevel (at most once a day) and fill in what's missing.
 */
async function syncDetails(ws) {
  const needsTz = !ws.timezoneLocked && (!ws.timezone || ws.timezone === 'UTC');
  const needsName = !ws.locationName;
  if (!needsTz && !needsName) return ws;
  if (ws.locationSyncedAt && Date.now() - ws.locationSyncedAt < 864e5) return ws;
  try {
    const d = await ghlService.getLocationDetails(ws.locationId);
    if (needsTz && d.locationTimezone && validTz(d.locationTimezone)) ws.timezone = d.locationTimezone;
    if (needsName && d.locationName) ws.locationName = d.locationName;
  } catch (e) {
    logger.warn('location sync failed', { locationId: ws.locationId, message: e.message });
  }
  ws.locationSyncedAt = new Date();
  await ws.save();
  return ws;
}

/** Don't make sign-in wait more than `ms` for HighLevel. */
function syncQuick(ws, ms = 2500) {
  return Promise.race([syncDetails(ws), new Promise((r) => setTimeout(() => r(ws), ms))]).catch(() => ws);
}

module.exports = { syncDetails, syncQuick, validTz };
