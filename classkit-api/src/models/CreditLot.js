const mongoose = require('mongoose');

/**
 * A batch of credits a member owns, from one purchase/grant. Credits are spent from the lot that
 * expires soonest first. Unlimited memberships are lots with kind='unlimited' and remaining=null —
 * any booking inside [startsAt, expiresAt) is covered at zero cost.
 *
 * `remaining` is only ever changed with conditional atomic $inc, so two webhooks racing can never
 * spend the same credit twice.
 */
const creditLotSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    contactId: { type: String, required: true, index: true },
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Package', default: null },
    packageName: { type: String, default: 'Credits' },
    kind: { type: String, enum: ['pack', 'unlimited', 'dropin', 'manual'], default: 'pack' },
    creditsTotal: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 }, // null for unlimited
    calendarIds: { type: [String], default: [] },
    valueUsd: { type: Number, default: 0 }, // what the member paid for this lot (for liability reports)
    startsAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ['active', 'expired', 'exhausted', 'revoked'], default: 'active', index: true },
    source: {
      type: { type: String, enum: ['order', 'invoice', 'manual', 'workflow', 'adjust'], default: 'manual' },
      refId: { type: String, default: null }
    },
    expiringNotifiedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

creditLotSchema.index({ locationId: 1, contactId: 1, status: 1, expiresAt: 1 });

module.exports = mongoose.model('CreditLot', creditLotSchema);
