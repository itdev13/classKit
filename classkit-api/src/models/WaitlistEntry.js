const mongoose = require('mongoose');

/** A member waiting for a seat in a full class session. First in, first promoted. */
const waitlistEntrySchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    calendarId: { type: String, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, default: null },
    contactId: { type: String, required: true },
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    status: { type: String, enum: ['waiting', 'promoted', 'left', 'expired', 'skipped'], default: 'waiting', index: true },
    skipReason: { type: String, default: null },
    promotedAppointmentId: { type: String, default: null },
    promotedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

waitlistEntrySchema.index({ locationId: 1, calendarId: 1, startTime: 1, status: 1, createdAt: 1 });

module.exports = mongoose.model('WaitlistEntry', waitlistEntrySchema);
