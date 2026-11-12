const Package = require('../models/Package');
const Workspace = require('../models/Workspace');
const creditService = require('./creditService');
const memberService = require('./memberService');
const notifyService = require('./notifyService');
const triggerService = require('./triggerService');
const logger = require('../utils/logger');

const PAID = ['completed', 'paid', 'succeeded', 'success', 'fulfilled'];

/** Pull the bits we need out of OrderCreate / OrderStatusUpdate / InvoicePaid payload variants. */
function parse(type, p = {}) {
  const isInvoice = type === 'InvoicePaid';
  const orderId = p._id || p.id || p.orderId || p.invoiceId || null;
  const contactId = p.contactId || p.contactSnapshot?.id || p.contactSnapshot?._id || p.contactDetails?.id || p.contact?.id || null;
  const status = String(p.paymentStatus || p.status || '').toLowerCase();
  const paid = isInvoice || PAID.includes(status);
  const rawItems = p.items || p.invoiceItems || p.lineItems || [];
  const items = rawItems.map((it, idx) => ({
    idx,
    productId: it.product?._id || it.product?.id || it.productId || (typeof it.product === 'string' ? it.product : null),
    priceId: it.price?._id || it.price?.id || it.priceId || (typeof it.price === 'string' ? it.price : null),
    qty: Math.max(1, Math.min(20, Number(it.qty || it.quantity || 1))),
    amount: Number(it.price?.amount ?? it.amount ?? 0)
  }));
  return { orderId, contactId, paid, items, source: isInvoice ? 'invoice' : 'order' };
}

/** Grant packages for every line item that maps to a ClassKit package. Idempotent per order line. */
async function handlePaid(locationId, type, payload) {
  const ws = await Workspace.findOne({ locationId, active: true });
  if (!ws) return { ignored: 'no_workspace' };
  const o = parse(type, payload);
  if (!o.paid) return { ignored: 'not_paid' };
  if (!o.orderId || !o.contactId) return { ignored: 'missing_order_or_contact' };

  const granted = [];
  for (const it of o.items) {
    const or = [];
    if (it.productId) or.push({ ghlProductIds: it.productId });
    if (it.priceId) or.push({ ghlPriceIds: it.priceId });
    if (!or.length) continue;
    const pkg = await Package.findOne({ locationId, active: true, $or: or });
    if (!pkg) continue;
    for (let q = 0; q < it.qty; q++) {
      const { lot, duplicate } = await creditService.grant({
        locationId, contactId: o.contactId, pkg,
        valueUsd: it.amount || pkg.priceUsd,
        source: { type: o.source, refId: o.orderId },
        idempotencyKey: `${o.source}:${o.orderId}:${it.idx}:${q}`
      });
      if (!duplicate && lot) granted.push({ pkg, lot });
    }
  }
  if (!granted.length) return { ignored: 'no_matching_packages' };

  const m = await memberService.refresh(locationId, o.contactId, { workspace: ws, silent: true });
  for (const { pkg, lot } of granted) {
    notifyService.send(ws, 'purchased', o.contactId, {
      first_name: m.firstName, package_name: pkg.name,
      credits: pkg.kind === 'unlimited' ? 'unlimited' : m.balance,
      expiry_date: notifyService.formatDate(lot.expiresAt, ws.timezone)
    });
    triggerService.fire(triggerService.TRIGGERS.PACK_PURCHASED, locationId, {
      contactId: o.contactId, packageName: pkg.name, packageKind: pkg.kind, credits: lot.creditsTotal,
      expiresAt: lot.expiresAt.toISOString(), orderId: o.orderId, balance: m.balance
    });
  }
  logger.info('🎟️ Packages granted from payment', { locationId, contactId: o.contactId, orderId: o.orderId, count: granted.length });
  return { granted: granted.length };
}

module.exports = { handlePaid, parse };
