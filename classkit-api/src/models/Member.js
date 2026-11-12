const mongoose = require('mongoose');

/**
 * Read-model of a studio member (a GHL contact who has ever held credits or booked a credit class).
 * Balance fields are recomputed from CreditLots by memberService.refresh — never edited directly.
 */
const memberSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    contactId: { type: String, required: true },
    name: { type: String, default: '' },
    firstName: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    phoneDigits: { type: String, default: '', index: true }, // last 10 digits, for kiosk lookup
    balance: { type: Number, default: 0 },
    unlimitedUntil: { type: Date, default: null },
    nextExpiry: { type: Date, default: null },
    lastVisitAt: { type: Date, default: null },
    visits: { type: Number, default: 0 },
    noShows: { type: Number, default: 0 },
    lowNotifiedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

memberSchema.index({ locationId: 1, contactId: 1 }, { unique: true });
memberSchema.index({ locationId: 1, name: 1 });

module.exports = mongoose.model('Member', memberSchema);
