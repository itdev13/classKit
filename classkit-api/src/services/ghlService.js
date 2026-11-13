const axios = require('axios');
const logger = require('../utils/logger');
const OAuthToken = require('../models/OAuthToken');
const CompanyLocation = require('../models/CompanyLocation');
const mock = require('./ghlMock');

const isMock = () => String(process.env.GHL_MOCK || '').toLowerCase() === 'true';

/**
 * GoHighLevel API service for ClassKit.
 * (Token lifecycle ported verbatim from HelmDesk — location + company tokens, refresh, mint, 429 backoff.)
 *
 * Handles the full OAuth token lifecycle (location + company tokens, refresh, mint-from-company)
 * and the Conversations / Contacts endpoints ClassKit needs to RECEIVE inbound (via webhook,
 * elsewhere) and SEND replies back out on the customer's original channel.
 *
 * Token machinery is battle-tested (ported from the Vaultsuite marketplace apps): it survives
 * 401 races between concurrent requests and backs off on 429 rate limits.
 */
class GHLService {
  constructor() {
    this.baseURL = process.env.GHL_API_URL || 'https://services.leadconnectorhq.com';
    this.oauthURL = process.env.GHL_OAUTH_URL || 'https://services.leadconnectorhq.com/oauth';
    this.version = '2021-07-28';
  }

  /** Exchange an OAuth authorization code for tokens. */
  async getAccessToken(code) {
    const params = new URLSearchParams();
    params.append('client_id', process.env.GHL_CLIENT_ID);
    params.append('client_secret', process.env.GHL_CLIENT_SECRET);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);

    const { data } = await axios.post(`${this.oauthURL}/token`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    logger.info('Token exchange successful', { locationId: data.locationId, companyId: data.companyId });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      locationId: data.locationId,
      companyId: data.companyId,
      userId: data.userId || null
    };
  }

  /** Refresh an access token using a refresh token. */
  async refreshAccessToken(refreshToken) {
    const params = new URLSearchParams();
    params.append('client_id', process.env.GHL_CLIENT_ID);
    params.append('client_secret', process.env.GHL_CLIENT_SECRET);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);

    const { data } = await axios.post(`${this.oauthURL}/token`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  }

  /** Fetch a single GHL user (the installer / an agent) by id. Never throws — returns null on error. */
  async getUserWithToken(userId, accessToken) {
    if (!userId || !accessToken) return null;
    try {
      const { data } = await axios.get(`${this.baseURL}/users/${userId}`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Version: this.version }
      });
      const u = data?.user || data || {};
      return {
        id: u.id || userId,
        email: u.email || null,
        name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || null
      };
    } catch (err) {
      logger.warn('getUserWithToken failed (non-blocking):', { userId, error: err.response?.data || err.message });
      return null;
    }
  }

  /**
   * Mint a location-scoped token from a company token. Required for agency-level installs,
   * where only a company token exists until a location is first accessed.
   */
  async getLocationTokenFromCompany(companyId, locationId, retryCount = 0) {
    let companyToken = await OAuthToken.findOne({ companyId, tokenType: 'company', isActive: true });
    if (!companyToken) throw new Error('No company token found');

    if (companyToken.needsRefresh()) {
      try {
        const refreshed = await this.refreshAccessToken(companyToken.refreshToken);
        companyToken.accessToken = refreshed.accessToken;
        companyToken.refreshToken = refreshed.refreshToken;
        companyToken.expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
        await companyToken.save();
      } catch (refreshErr) {
        // Another process may have already rotated the refresh token.
        if (refreshErr.response?.data?.error === 'invalid_grant') {
          const latest = await OAuthToken.findOne({ companyId, tokenType: 'company', isActive: true });
          if (latest && latest.accessToken !== companyToken.accessToken) {
            companyToken = latest;
          } else {
            throw new Error('Company token expired. Please reconnect ClassKit.');
          }
        } else {
          throw refreshErr;
        }
      }
    }

    try {
      const { data } = await axios.post(
        `${this.oauthURL}/locationToken`,
        { companyId, locationId },
        { headers: { Authorization: `Bearer ${companyToken.accessToken}`, 'Content-Type': 'application/json', Version: this.version } }
      );
      return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
    } catch (error) {
      if (error.response?.status === 401 && retryCount === 0) {
        // Force a refresh and retry once.
        const tok = await OAuthToken.findOne({ companyId, tokenType: 'company', isActive: true });
        if (tok?.refreshToken) {
          try {
            const refreshed = await this.refreshAccessToken(tok.refreshToken);
            tok.accessToken = refreshed.accessToken;
            tok.refreshToken = refreshed.refreshToken;
            tok.expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
            await tok.save();
          } catch (e) {
            if (e.response?.data?.error !== 'invalid_grant') throw e;
          }
          return this.getLocationTokenFromCompany(companyId, locationId, retryCount + 1);
        }
      }
      logger.error('Failed to generate location token:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Resolve a valid access token for a location, refreshing or minting-from-company as needed.
   * This is the single entry point every API call funnels through.
   */
  async getValidToken(locationId) {
    let tokenDoc = await OAuthToken.findOne({ locationId, tokenType: 'location', isActive: true });

    if (!tokenDoc) {
      const companyLoc = await CompanyLocation.findCompanyByLocation(locationId);
      if (!companyLoc) {
        const err = new Error('Location not connected. Please reconnect ClassKit.');
        err.status = 404;
        err.isClientError = true;
        throw err;
      }
      const companyToken = await OAuthToken.findOne({ companyId: companyLoc.companyId, tokenType: 'company', isActive: true });
      if (!companyToken) {
        const err = new Error('Company token expired. Please reconnect ClassKit.');
        err.status = 401;
        err.isClientError = true;
        throw err;
      }
      const minted = await this.getLocationTokenFromCompany(companyLoc.companyId, locationId);
      tokenDoc = await OAuthToken.findOneAndUpdate(
        { locationId, tokenType: 'location' },
        {
          locationId,
          companyId: companyLoc.companyId,
          tokenType: 'location',
          accessToken: minted.accessToken,
          refreshToken: minted.refreshToken,
          expiresAt: new Date(Date.now() + minted.expiresIn * 1000),
          isActive: true
        },
        { upsert: true, new: true }
      );
    }

    if (tokenDoc.needsRefresh()) {
      try {
        const fresh = await this.refreshAccessToken(tokenDoc.refreshToken);
        tokenDoc.accessToken = fresh.accessToken;
        tokenDoc.refreshToken = fresh.refreshToken;
        tokenDoc.expiresAt = new Date(Date.now() + fresh.expiresIn * 1000);
        await tokenDoc.save();
      } catch (refreshErr) {
        if (refreshErr.response?.data?.error === 'invalid_grant') {
          const latest = await OAuthToken.findActiveToken(locationId);
          if (latest && latest.accessToken !== tokenDoc.accessToken) return latest.accessToken;
        }
        throw refreshErr;
      }
    }

    return tokenDoc.accessToken;
  }

  /**
   * Authenticated GHL API request with auto-refresh on 401 and exponential backoff on 429.
   */
  async apiRequest(method, endpoint, locationId, data = null, params = null, retryCount = 0) {
    if (isMock()) return mock.respond(method, endpoint, data, params);
    try {
      const accessToken = await this.getValidToken(locationId);
      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Version: this.version }
      };
      if (data) config.data = data;
      if (params) config.params = params;
      const response = await axios(config);
      return response.data;
    } catch (error) {
      // 401 → refresh once and retry (re-fetch latest token to dodge concurrent-refresh races).
      if (error.response?.status === 401 && retryCount === 0) {
        const tokenDoc = await OAuthToken.findActiveToken(locationId);
        if (!tokenDoc?.refreshToken) throw new Error('Authentication failed. Please reconnect ClassKit.');

        const expiresIn = tokenDoc.expiresAt - Date.now();
        if (expiresIn > 23 * 60 * 60 * 1000) {
          return this.apiRequest(method, endpoint, locationId, data, params, retryCount + 1);
        }
        try {
          const fresh = await this.refreshAccessToken(tokenDoc.refreshToken);
          tokenDoc.accessToken = fresh.accessToken;
          tokenDoc.refreshToken = fresh.refreshToken;
          tokenDoc.expiresAt = new Date(Date.now() + fresh.expiresIn * 1000);
          await tokenDoc.save();
        } catch (refreshErr) {
          if (refreshErr.response?.data?.error === 'invalid_grant') {
            const latest = await OAuthToken.findActiveToken(locationId);
            if (!latest || latest.accessToken === tokenDoc.accessToken) throw refreshErr;
          } else {
            throw refreshErr;
          }
        }
        return this.apiRequest(method, endpoint, locationId, data, params, retryCount + 1);
      }

      // 429 → exponential backoff, up to 3 retries.
      if (error.response?.status === 429 && retryCount < 3) {
        const retryAfter = error.response?.headers?.['retry-after'];
        const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : backoffMs;
        logger.warn(`Rate limited (429), retrying in ${waitMs}ms`, { endpoint });
        await new Promise((r) => setTimeout(r, waitMs));
        return this.apiRequest(method, endpoint, locationId, data, params, retryCount + 1);
      }

      logger.error(`API request failed: ${method} ${endpoint}`, {
        status: error.response?.status,
        message: error.response?.data?.message || error.message
      });
      throw error;
    }
  }

  // ── Locations ──────────────────────────────────────────────────────────────
  async getLocationDetails(locationId) {
    try {
      const response = await this.apiRequest('GET', `/locations/${locationId}`, locationId);
      const loc = response.location || response;
      return {
        locationName: loc.name || null,
        locationEmail: loc.email || null,
        locationPhone: loc.phone || null,
        locationTimezone: loc.timezone || null,
        currency: loc.currency || loc.defaultCurrency || loc.business?.currency || loc.settings?.currency || null
      };
    } catch (error) {
      logger.warn('getLocationDetails failed (non-critical):', error.message);
      return { locationName: null, locationEmail: null, locationPhone: null, locationTimezone: null, currency: null };
    }
  }

  /** Every sub-account under an agency (paginated — agencies can have hundreds). */
  async getCompanyLocations(companyId, companyAccessToken) {
    if (isMock()) return [];
    const all = [];
    const PAGE = 100;
    try {
      for (let skip = 0, guard = 0; guard < 100; guard++, skip += PAGE) {
        const { data } = await axios.get(`${this.baseURL}/locations/search`, {
          headers: { Authorization: `Bearer ${companyAccessToken}`, 'Content-Type': 'application/json', Version: this.version },
          params: { companyId, limit: PAGE, skip }
        });
        const page = data.locations || [];
        all.push(...page.map((loc) => ({ locationId: loc.id, locationName: loc.name })));
        if (page.length < PAGE) break;
      }
    } catch (error) {
      logger.error('getCompanyLocations failed:', { message: error.message, status: error.response?.status, fetched: all.length });
    }
    return all;
  }

  /** Make sure the location has the two custom fields we mirror the balance into. Returns their ids. */
  async ensureCustomFields(locationId) {
    const wanted = { credits: { name: 'ClassKit Credits', dataType: 'NUMERICAL' }, expiry: { name: 'ClassKit Credits Expire', dataType: 'DATE' } };
    const out = { credits: null, expiry: null };
    const list = await this.apiRequest('GET', `/locations/${locationId}/customFields`, locationId, null, { model: 'contact' });
    const existing = list.customFields || [];
    for (const [key, def] of Object.entries(wanted)) {
      const found = existing.find((f) => f.name === def.name);
      if (found) { out[key] = found.id; continue; }
      const created = await this.apiRequest('POST', `/locations/${locationId}/customFields`, locationId, { ...def, model: 'contact' });
      out[key] = created.customField?.id || created.id || null;
    }
    return out;
  }

  // ── Calendars / appointments ───────────────────────────────────────────────
  async listCalendars(locationId) {
    const res = await this.apiRequest('GET', '/calendars/', locationId, null, { locationId });
    return (res.calendars || []).map((c) => ({
      calendarId: c.id,
      name: c.name,
      calendarType: c.calendarType || null,
      // Class booking calendars expose seats per slot; field names have varied across API versions.
      capacity: c.appoinmentPerSlot || c.appointmentPerSlot || c.seatsPerSlot || null,
      durationMins: c.slotDuration || null,
      widgetSlug: c.widgetSlug || null
    }));
  }

  /** Free slots in [start, end). Returns [{ startTime: ISO }] flattened across days. */
  async getFreeSlots(locationId, calendarId, start, end, timezone) {
    const res = await this.apiRequest('GET', `/calendars/${calendarId}/free-slots`, locationId, null, {
      startDate: new Date(start).getTime(),
      endDate: new Date(end).getTime(),
      timezone: timezone || undefined
    });
    const slots = [];
    for (const [k, v] of Object.entries(res || {})) {
      if (k === 'traceId' || !v || !Array.isArray(v.slots)) continue;
      v.slots.forEach((s) => slots.push({ startTime: new Date(s).toISOString() }));
    }
    return slots;
  }

  async createAppointment(locationId, { calendarId, contactId, startTime, endTime, title }) {
    const res = await this.apiRequest('POST', '/calendars/events/appointments', locationId, {
      calendarId, locationId, contactId,
      startTime: new Date(startTime).toISOString(),
      endTime: endTime ? new Date(endTime).toISOString() : undefined,
      title: title || undefined,
      appointmentStatus: 'confirmed',
      ignoreFreeSlotValidation: true,
      toNotify: true
    });
    return res.appointment || res;
  }

  async updateAppointmentStatus(locationId, appointmentId, appointmentStatus) {
    return this.apiRequest('PUT', `/calendars/events/appointments/${appointmentId}`, locationId, { appointmentStatus });
  }

  // ── Contacts ───────────────────────────────────────────────────────────────
  async getContact(locationId, contactId) {
    try {
      const res = await this.apiRequest('GET', `/contacts/${contactId}`, locationId);
      const c = res.contact || res;
      return {
        id: c.id || contactId,
        firstName: c.firstName || '',
        name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || 'Member',
        email: c.email || '',
        phone: c.phone || ''
      };
    } catch (error) {
      logger.warn('getContact failed (non-blocking)', { contactId, error: error.message });
      return null;
    }
  }

  async upsertContact(locationId, { name, firstName, lastName, email, phone, tags }) {
    const [fn, ...rest] = String(name || '').trim().split(/\s+/);
    const body = { locationId, firstName: firstName || fn || undefined, lastName: lastName || rest.join(' ') || undefined, email: email || undefined, phone: phone || undefined, tags, source: 'ClassKit' };
    const res = await this.apiRequest('POST', '/contacts/upsert', locationId, body);
    return res.contact || res;
  }

  async searchContactsByPhone(locationId, phone) {
    const res = await this.apiRequest('GET', '/contacts/', locationId, null, { locationId, query: phone, limit: 5 });
    return res.contacts || [];
  }

  async updateContactCustomFields(locationId, contactId, customFields) {
    return this.apiRequest('PUT', `/contacts/${contactId}`, locationId, { customFields });
  }

  async addTags(locationId, contactId, tags) {
    if (!tags?.length) return null;
    return this.apiRequest('POST', `/contacts/${contactId}/tags`, locationId, { tags });
  }

  async removeTags(locationId, contactId, tags) {
    if (!tags?.length) return null;
    return this.apiRequest('DELETE', `/contacts/${contactId}/tags`, locationId, { tags });
  }

  // ── Messaging ──────────────────────────────────────────────────────────────
  async sendSms(locationId, contactId, message) {
    return this.apiRequest('POST', '/conversations/messages', locationId, { type: 'SMS', contactId, message });
  }

  // ── Products (to link packages to what the studio already sells) ───────────
  async listProducts(locationId) {
    const res = await this.apiRequest('GET', '/products/', locationId, null, { locationId, limit: 100 });
    const products = res.products || [];
    return products.map((p) => ({ productId: p._id || p.id, name: p.name, prices: (p.prices || []).map((pr) => ({ priceId: pr._id || pr.id, name: pr.name, amount: pr.amount, currency: pr.currency || null })) }));
  }
}

module.exports = new GHLService();
module.exports.isMock = isMock;
