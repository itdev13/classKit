const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * GHL_MOCK=true backend. Returns plausible responses for every endpoint ClassKit calls so the full
 * product (bookings, waitlist, SMS, kiosk) can be exercised locally. Every call is logged and kept in
 * `calls` so tests can assert on side effects (e.g. "an SMS was sent", "the appointment was cancelled").
 */
const calls = [];
const contacts = new Map();

function id(prefix) { return `${prefix}_${crypto.randomBytes(6).toString('hex')}`; }

function respond(method, endpoint, data, params) {
  calls.push({ method, endpoint, data, params, at: new Date() });
  logger.info(`[ghl-mock] ${method} ${endpoint}`, data ? { data: JSON.stringify(data).slice(0, 300) } : undefined);

  if (method === 'GET' && /^\/locations\/[^/]+$/.test(endpoint)) {
    return { location: { name: 'Demo Studio', timezone: 'America/New_York' } };
  }
  if (/\/customFields$/.test(endpoint)) {
    if (method === 'GET') return { customFields: [] };
    return { customField: { id: id('cf'), name: data?.name } };
  }
  if (method === 'GET' && endpoint === '/calendars/') {
    return {
      calendars: [
        { id: 'cal_yoga', name: 'Vinyasa Yoga', calendarType: 'class_booking', appoinmentPerSlot: 3, slotDuration: 60 },
        { id: 'cal_hiit', name: 'HIIT Bootcamp', calendarType: 'class_booking', appoinmentPerSlot: 12, slotDuration: 45 },
        { id: 'cal_consult', name: 'Free Consultation', calendarType: 'round_robin', slotDuration: 30 }
      ]
    };
  }
  if (method === 'GET' && /\/calendars\/[^/]+\/free-slots$/.test(endpoint)) {
    // Two classes a day (7am, 6pm) for the requested range.
    const out = {};
    const start = new Date(Number(params?.startDate) || Date.now());
    const end = new Date(Number(params?.endDate) || Date.now() + 7 * 864e5);
    for (let d = new Date(start); d < end; d = new Date(d.getTime() + 864e5)) {
      const day = d.toISOString().slice(0, 10);
      out[day] = { slots: [`${day}T11:00:00.000Z`, `${day}T22:00:00.000Z`] };
    }
    return out;
  }
  if (method === 'POST' && endpoint === '/calendars/events/appointments') {
    return { id: id('appt'), ...data };
  }
  if (method === 'PUT' && endpoint.startsWith('/calendars/events/appointments/')) {
    return { id: endpoint.split('/').pop(), ...data };
  }
  if (method === 'POST' && endpoint === '/contacts/upsert') {
    const existing = [...contacts.values()].find((c) => (data.phone && c.phone === data.phone) || (data.email && c.email === data.email));
    const c = existing || { id: id('contact'), ...data };
    contacts.set(c.id, c);
    return { contact: c, new: !existing };
  }
  if (method === 'GET' && endpoint === '/contacts/') {
    const q = String(params?.query || '').replace(/\D/g, '').slice(-10);
    return { contacts: [...contacts.values()].filter((c) => q && String(c.phone || '').replace(/\D/g, '').endsWith(q)) };
  }
  if (method === 'GET' && endpoint.startsWith('/contacts/')) {
    const cid = endpoint.split('/')[2];
    return { contact: contacts.get(cid) || { id: cid, firstName: 'Demo', lastName: cid.slice(-4), phone: '', email: '' } };
  }
  if (endpoint === '/products/') {
    return { products: [
      { _id: 'prod_10pack', name: '10-Class Pack', prices: [{ _id: 'price_10pack', name: 'One-time', amount: 150 }] },
      { _id: 'prod_unlimited', name: 'Unlimited Monthly', prices: [{ _id: 'price_unl', name: 'Monthly', amount: 129 }] }
    ] };
  }
  return { success: true };
}

module.exports = { respond, calls, contacts, reset() { calls.length = 0; contacts.clear(); } };
