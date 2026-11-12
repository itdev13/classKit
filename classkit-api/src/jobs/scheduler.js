const CreditLot = require('../models/CreditLot');
const Workspace = require('../models/Workspace');
const creditService = require('../services/creditService');
const memberService = require('../services/memberService');
const bookingService = require('../services/bookingService');
const waitlistService = require('../services/waitlistService');
const notifyService = require('../services/notifyService');
const triggerService = require('../services/triggerService');
const logger = require('../utils/logger');

/**
 * One loop for every time-based rule:
 *   1. expire lots past their date (and resync each member)
 *   2. "your credits expire in N days" reminder, once per lot
 *   3. auto no-show for seats nobody checked into
 *   4. close waitlists for classes that already started
 */
async function expiringReminders(now = new Date()) {
  const workspaces = await Workspace.find({ active: true }).lean(false);
  let sent = 0;
  for (const ws of workspaces) {
    const days = ws.policy.expiryReminderDays || 0;
    if (!days) continue;
    const horizon = new Date(now.getTime() + days * creditService.DAY);
    const lots = await CreditLot.find({
      locationId: ws.locationId, status: 'active', kind: { $ne: 'unlimited' }, remaining: { $gt: 0 },
      expiresAt: { $gt: now, $lte: horizon }, expiringNotifiedAt: null
    }).limit(500);
    for (const lot of lots) {
      const claimed = await CreditLot.updateOne({ _id: lot._id, expiringNotifiedAt: null }, { $set: { expiringNotifiedAt: now } });
      if (!claimed.modifiedCount) continue;
      const m = await memberService.ensure(ws.locationId, lot.contactId);
      notifyService.send(ws, 'expiring', lot.contactId, {
        first_name: m.firstName, credits: lot.remaining, package_name: lot.packageName,
        expiry_date: notifyService.formatDate(lot.expiresAt, ws.timezone)
      });
      triggerService.fire(triggerService.TRIGGERS.PACK_EXPIRING, ws.locationId, {
        contactId: lot.contactId, packageName: lot.packageName, creditsRemaining: lot.remaining, expiresAt: lot.expiresAt.toISOString()
      });
      sent++;
    }
  }
  return sent;
}

async function tick(now = new Date()) {
  const out = { expired: 0, reminders: 0, noShows: 0, waitlistsClosed: 0 };
  try {
    const touched = await creditService.expireDue(now);
    out.expired = touched.length;
    const seen = new Set();
    for (const t of touched) {
      const k = `${t.locationId}|${t.contactId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      await memberService.refresh(t.locationId, t.contactId, { silent: true }).catch(() => {});
    }
  } catch (e) { logger.error('scheduler: expire failed', { message: e.message }); }
  try { out.reminders = await expiringReminders(now); } catch (e) { logger.error('scheduler: reminders failed', { message: e.message }); }
  try { out.noShows = await bookingService.autoNoShow(now); } catch (e) { logger.error('scheduler: no-show failed', { message: e.message }); }
  try { out.waitlistsClosed = await waitlistService.expirePast(now); } catch (e) { logger.error('scheduler: waitlist failed', { message: e.message }); }
  return out;
}

let timer = null;
function start() {
  const every = Number(process.env.SCHEDULER_INTERVAL_MS || 300000);
  const run = () => tick().catch((e) => logger.error('scheduler tick failed', { message: e.message }));
  setTimeout(run, 5000);
  timer = setInterval(run, every);
  logger.info(`⏱️  Scheduler running every ${Math.round(every / 1000)}s`);
}
function stop() { if (timer) clearInterval(timer); }

module.exports = { start, stop, tick, expiringReminders };
