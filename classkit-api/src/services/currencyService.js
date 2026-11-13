const ghlService = require('./ghlService');
const logger = require('../utils/logger');

const DEFAULT = 'USD';

/** Normalise to a valid ISO 4217 code, or null. */
function normalize(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return null;
  try { new Intl.NumberFormat('en', { style: 'currency', currency: c }); return c; } catch { return null; }
}

const effective = (ws) => normalize(ws?.currency) || DEFAULT;

/**
 * Work out the business currency from HighLevel: the location record first, then the currency of the
 * studio's product prices. Runs at most once a day per workspace and never overrides an owner's choice.
 */
async function detect(ws) {
  if (ws.currencyLocked || ws.currency) return effective(ws);
  if (ws.currencyCheckedAt && Date.now() - ws.currencyCheckedAt < 864e5) return effective(ws);
  let found = null;
  try {
    found = normalize((await ghlService.getLocationDetails(ws.locationId)).currency);
    if (!found) {
      const products = await ghlService.listProducts(ws.locationId);
      found = products.flatMap((p) => p.prices || []).map((pr) => normalize(pr.currency)).find(Boolean) || null;
    }
  } catch (e) {
    logger.warn('currency detect failed (using default)', { locationId: ws.locationId, message: e.message });
  }
  ws.currency = found;
  ws.currencyCheckedAt = new Date();
  await ws.save();
  return effective(ws);
}

/** A paid order/invoice is the most reliable signal: adopt its currency unless the owner picked one. */
async function learnFromPayment(ws, code) {
  const c = normalize(code);
  if (!c || ws.currencyLocked || ws.currency === c) return;
  ws.currency = c;
  await ws.save();
  logger.info('currency learned from payment', { locationId: ws.locationId, currency: c });
}

/** Detect, but don't make a sign-in wait more than `ms` for HighLevel. */
function detectQuick(ws, ms = 2500) {
  return Promise.race([detect(ws), new Promise((r) => setTimeout(() => r(effective(ws)), ms))]).catch(() => effective(ws));
}

module.exports = { DEFAULT, normalize, effective, detect, detectQuick, learnFromPayment };
