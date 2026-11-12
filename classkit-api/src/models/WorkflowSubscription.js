const mongoose = require('mongoose');

/** A GHL workflow that uses one of ClassKit's custom triggers (registered via the subscription hook). */
const workflowSubscriptionSchema = new mongoose.Schema(
  {
    locationId: { type: String, index: true },
    companyId: { type: String, default: null },
    workflowId: { type: String, required: true },
    triggerKey: { type: String, required: true },
    targetUrl: { type: String, required: true },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
    extras: { type: mongoose.Schema.Types.Mixed, default: {} },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['active', 'deleted'], default: 'active', index: true }
  },
  { timestamps: true }
);

workflowSubscriptionSchema.index({ workflowId: 1, triggerKey: 1 }, { unique: true });
workflowSubscriptionSchema.index({ locationId: 1, triggerKey: 1, status: 1 });

module.exports = mongoose.model('WorkflowSubscription', workflowSubscriptionSchema);
