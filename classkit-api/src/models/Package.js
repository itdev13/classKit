const mongoose = require('mongoose');

/**
 * Something a studio sells: a class pack (N credits), an unlimited membership (time-boxed), or a
 * drop-in (1 credit). Linked to GHL products/prices so a paid order grants it automatically.
 */
const packageSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['pack', 'unlimited', 'dropin'], default: 'pack' },
    credits: { type: Number, default: 10, min: 0 },
    validityDays: { type: Number, default: 90, min: 1 },
    priceUsd: { type: Number, default: 0, min: 0 },
    ghlProductIds: { type: [String], default: [] },
    ghlPriceIds: { type: [String], default: [] },
    // Restrict to these calendars. Empty = valid for every credit calendar.
    calendarIds: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 }
  },
  { timestamps: true }
);

packageSchema.index({ locationId: 1, ghlProductIds: 1 });
packageSchema.index({ locationId: 1, ghlPriceIds: 1 });

module.exports = mongoose.model('Package', packageSchema);
