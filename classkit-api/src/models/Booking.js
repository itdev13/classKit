const mongoose = require('mongoose');

/**
 * One member's seat in one class session (= one GHL appointment on a credit calendar).
 * appointmentId is unique: inserting the Booking is how we "claim" a webhook so duplicate deliveries
 * are ignored.
 */
const bookingSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    appointmentId: { type: String, required: true, unique: true },
    contactId: { type: String, required: true, index: true },
    calendarId: { type: String, required: true },
    title: { type: String, default: '' },
    startTime: { type: Date, required: true },
    endTime: { type: Date, default: null },
    status: {
      type: String,
      enum: ['booked', 'cancelled', 'attended', 'noshow', 'rejected'],
      default: 'booked',
      index: true
    },
    lotId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditLot', default: null },
    creditsCharged: { type: Number, default: 0 },
    unlimited: { type: Boolean, default: false },
    // Booking allowed without a credit (policy.blockWithoutCredits=false) — staff should collect.
    owesCredit: { type: Boolean, default: false },
    chargeSeq: { type: Number, default: 0 }, // bumps if a cancelled booking is re-confirmed
    refunded: { type: Boolean, default: false },
    lateCancel: { type: Boolean, default: false },
    checkedInAt: { type: Date, default: null },
    checkedInBy: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    source: { type: String, default: 'ghl' } // ghl | waitlist | staff
  },
  { timestamps: true }
);

bookingSchema.index({ locationId: 1, calendarId: 1, startTime: 1, status: 1 });
bookingSchema.index({ locationId: 1, startTime: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
