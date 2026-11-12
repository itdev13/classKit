const express = require('express');
const router = express.Router();
const ghlService = require('../services/ghlService');
const OAuthToken = require('../models/OAuthToken');
const CompanyLocation = require('../models/CompanyLocation');
const Workspace = require('../models/Workspace');
const logger = require('../utils/logger');

/**
 * ClassKit OAuth. Scopes: calendars (read seats, create waitlist bookings, set showed/no-show),
 * contacts (balance fields + tags), SMS out, products/orders (link packs to what the studio sells).
 */
const SCOPES = [
  'calendars.readonly',
  'calendars.write',
  'calendars/events.readonly',
  'calendars/events.write',
  'contacts.readonly',
  'contacts.write',
  'conversations.write',
  'conversations/message.write',
  'locations.readonly',
  'locations/customFields.readonly',
  'locations/customFields.write',
  'products.readonly',
  'products/prices.readonly',
  'payments/orders.readonly',
  'invoices.readonly',
  'users.readonly',
  'oauth.readonly'
].join(' ');

router.get('/authorize', (req, res) => {
  const base = (process.env.GHL_MARKETPLACE_URL || 'https://marketplace.gohighlevel.com').replace(/\/$/, '');
  const url = `${base}/v2/oauth/chooselocation?response_type=code` +
    `&client_id=${process.env.GHL_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.GHL_REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}`;
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Authorization code not provided');
  try {
    const t = await ghlService.getAccessToken(code);
    if (t.locationId) {
      await OAuthToken.findOneAndUpdate(
        { locationId: t.locationId },
        { locationId: t.locationId, companyId: t.companyId, tokenType: 'location', accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: new Date(Date.now() + t.expiresIn * 1000), isActive: true },
        { upsert: true, new: true }
      );
      const details = await ghlService.getLocationDetails(t.locationId);
      await OAuthToken.updateOne({ locationId: t.locationId }, { ...details });
      await Workspace.findOneAndUpdate(
        { locationId: t.locationId },
        {
          $setOnInsert: { locationId: t.locationId, installerUserId: t.userId || null },
          $set: { companyId: t.companyId, locationName: details.locationName, timezone: details.locationTimezone || 'UTC', active: true }
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
      logger.info('✅ ClassKit connected (location)', { locationId: t.locationId });
    } else {
      await OAuthToken.findOneAndUpdate(
        { companyId: t.companyId, tokenType: 'company' },
        { companyId: t.companyId, tokenType: 'company', accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: new Date(Date.now() + t.expiresIn * 1000), isActive: true },
        { upsert: true, new: true }
      );
      const locations = await ghlService.getCompanyLocations(t.companyId, t.accessToken);
      await CompanyLocation.updateOne(
        { companyId: t.companyId },
        { $addToSet: { locationIds: { $each: locations.map((l) => l.locationId) } } },
        { upsert: true }
      );
      // Same reason as HelmDesk: drop stale location tokens so they re-mint with the new scope set.
      await OAuthToken.deleteMany({ companyId: t.companyId, tokenType: 'location' });
      logger.info('✅ ClassKit connected (company)', { companyId: t.companyId, locations: locations.length });
    }
    res.send(page('ClassKit connected', 'Open your sub-account and find <b>ClassKit</b> in the left menu to finish setup.'));
  } catch (error) {
    if (error.response?.data?.error === 'invalid_grant') return res.send(page('ClassKit already connected', 'You can close this window.'));
    logger.error('OAuth callback error', { message: error.message, data: error.response?.data });
    res.status(500).send(page('Connection failed', `We couldn't connect ClassKit: ${String(error.message).replace(/[<>]/g, '')}`, true));
  }
});

function page(title, body, isError = false) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#F6F5FB;color:#1C1838}
  .c{background:#fff;border:1px solid #E4E1F2;border-top:4px solid ${isError ? '#D64545' : '#5B4BDB'};padding:44px;border-radius:16px;max-width:440px;text-align:center}
  .m{width:56px;height:56px;border-radius:14px;background:#5B4BDB;color:#fff;font:800 28px/56px sans-serif;margin:0 auto 18px}
  h1{font-size:22px;margin:0 0 8px}p{color:#5C5878;line-height:1.6}</style></head>
  <body><div class="c"><div class="m">C</div><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

module.exports = router;
module.exports.SCOPES = SCOPES;
