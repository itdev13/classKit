const mongoose = require('mongoose');

/**
 * Append-only history of every credit movement. `idempotencyKey` is unique, so a webhook that GHL
 * delivers twice (or a double-clicked button) can only ever produce one entry.
 */
const ledgerEntrySchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    contactId: { type: String, required: true, index: true },
    lotId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditLot', default: null },
    delta: { type: Number, required: true },
    reason: {
      type: String,
      enum: ['purchase', 'booking', 'refund', 'late_cancel', 'expire', 'adjust', 'revoke'],
      required: true
    },
    refId: { type: String, default: null },
    idempotencyKey: { type: String, default: undefined },
    note: { type: String, default: '' },
    actor: { type: String, default: 'system' },
    balanceAfter: { type: Number, default: null }
  },
  { timestamps: true }
);

ledgerEntrySchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
ledgerEntrySchema.index({ locationId: 1, createdAt: -1 });

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
