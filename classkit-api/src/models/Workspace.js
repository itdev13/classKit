const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * One ClassKit workspace per GHL location (sub-account / studio).
 * Holds which calendars run on credits, the studio's booking policy, SMS templates, and the
 * public tokens for the kiosk + schedule pages.
 */
const calendarConfigSchema = new mongoose.Schema(
  {
    calendarId: { type: String, required: true },
    name: { type: String, default: '' },
    usesCredits: { type: Boolean, default: true },
    creditCost: { type: Number, default: 1, min: 0 },
    capacity: { type: Number, default: 10, min: 1 },
    durationMins: { type: Number, default: 60 }
  },
  { _id: false }
);

const DEFAULT_TEMPLATES = {
  purchased: 'Thanks {{first_name}}! {{package_name}} is active. You have {{credits}} classes, valid until {{expiry_date}}.',
  booked: "You're booked for {{class_name}} on {{class_time}}. {{credits}} classes left.",
  noCredits: "Hi {{first_name}}, you're out of class credits so we couldn't hold {{class_name}} on {{class_time}}. Grab a pack here: {{buy_link}}",
  lateCancel: 'Your {{class_name}} booking was cancelled inside the {{cancel_window}}h window, so the credit was used. {{credits}} classes left.',
  refunded: 'Cancelled {{class_name}} on {{class_time}}. Your credit is back: {{credits}} classes left.',
  waitlistJoined: "You're #{{position}} on the waitlist for {{class_name}} on {{class_time}}. We'll text you if a spot opens.",
  waitlistPromoted: 'Good news {{first_name}}! A spot opened and you are booked for {{class_name}} on {{class_time}}.',
  lowCredits: 'Heads up {{first_name}}: only {{credits}} classes left. Renew here: {{buy_link}}',
  expiring: 'Your {{credits}} remaining classes expire on {{expiry_date}}. Book one before then!',
  checkedIn: ''
};

const workspaceSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, unique: true, index: true },
    companyId: { type: String, default: null, index: true },
    locationName: { type: String, default: null },
    timezone: { type: String, default: 'UTC' },
    // ISO 4217 code of the business currency. Detected from HighLevel (location, product prices, paid orders)
    // until the owner picks one in Settings (currencyLocked).
    currency: { type: String, default: null },
    currencyLocked: { type: Boolean, default: false },
    currencyCheckedAt: { type: Date, default: null },
    installerUserId: { type: String, default: null },
    adminUserIds: { type: [String], default: [] },
    setupComplete: { type: Boolean, default: false },
    active: { type: Boolean, default: true, index: true },

    calendars: { type: [calendarConfigSchema], default: [] },

    policy: {
      // Cancel at least this many hours before class → credit refunded. Later = credit kept by studio.
      cancelWindowHours: { type: Number, default: 12 },
      // Bookings with no credit: cancel the appointment and text a buy link (true) or let it stand.
      blockWithoutCredits: { type: Boolean, default: true },
      // Mark booked-but-not-checked-in as no-show this many minutes after class ends (0 = off).
      autoNoShowMinutes: { type: Number, default: 30 },
      lowCreditThreshold: { type: Number, default: 2 },
      expiryReminderDays: { type: Number, default: 7 },
      defaultValidityDays: { type: Number, default: 90 },
      waitlistEnabled: { type: Boolean, default: true },
      smsEnabled: { type: Boolean, default: true },
      // Check-in window around class start for the kiosk (minutes before / after).
      checkInOpensMins: { type: Number, default: 60 },
      checkInClosesMins: { type: Number, default: 30 }
    },

    templates: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...DEFAULT_TEMPLATES }) },
    buyUrl: { type: String, default: '' },
    brand: {
      name: { type: String, default: '' },
      color: { type: String, default: '#5B4BDB' },
      logoUrl: { type: String, default: '' }
    },

    // GHL custom field ids we write the balance into (created during setup).
    customFieldIds: {
      credits: { type: String, default: null },
      expiry: { type: String, default: null }
    },

    kioskToken: { type: String, default: () => crypto.randomBytes(16).toString('hex'), index: true },
    publicSlug: { type: String, default: () => crypto.randomBytes(6).toString('hex'), index: true }
  },
  { timestamps: true, minimize: false }
);

workspaceSchema.methods.calendarConfig = function calendarConfig(calendarId) {
  return (this.calendars || []).find((c) => c.calendarId === calendarId) || null;
};

workspaceSchema.methods.template = function template(key) {
  const t = this.templates || {};
  return key in t ? t[key] : DEFAULT_TEMPLATES[key] || '';
};

workspaceSchema.statics.DEFAULT_TEMPLATES = DEFAULT_TEMPLATES;

module.exports = mongoose.model('Workspace', workspaceSchema);
