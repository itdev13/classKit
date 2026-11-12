const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

let sessionToken = null;
export function setToken(t) { if (t && typeof t === 'string') sessionToken = t; }

// Same conservative 401 recovery as HelmDesk: re-run the SSO handshake once, never escalate.
let refreshHandler = null;
let inFlight = null;
export function setRefreshHandler(fn) { refreshHandler = fn; }
function refreshSession() {
  if (!refreshHandler) return Promise.resolve(false);
  if (!inFlight) inFlight = Promise.resolve().then(refreshHandler).then((ok) => ok === true).catch(() => false).finally(() => { inFlight = null; });
  return inFlight;
}

async function request(path, { method = 'GET', body, params, auth = true, _retried = false } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => v != null && v !== '' && url.searchParams.set(k, v));
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  const res = await fetch(url.toString(), { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && auth && sessionToken && !_retried && path !== '/api/auth/verify') {
    if (await refreshSession()) return request(path, { method, body, params, auth, _retried: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

export const api = {
  verify: (payload) => request('/api/auth/verify', { method: 'POST', body: payload, auth: false }),
  authorizeUrl: () => `${BASE}/oauth/authorize`,

  settings: () => request('/api/settings'),
  saveSettings: (body) => request('/api/settings', { method: 'PUT', body }),
  completeSetup: () => request('/api/settings/complete-setup', { method: 'POST' }),
  calendars: () => request('/api/settings/calendars'),
  products: () => request('/api/settings/products'),
  rotateKiosk: () => request('/api/settings/rotate-kiosk', { method: 'POST' }),

  packages: () => request('/api/packages'),
  createPackage: (body) => request('/api/packages', { method: 'POST', body }),
  updatePackage: (id, body) => request(`/api/packages/${id}`, { method: 'PUT', body }),
  deletePackage: (id) => request(`/api/packages/${id}`, { method: 'DELETE' }),

  members: (params) => request('/api/members', { params }),
  createMember: (body) => request('/api/members', { method: 'POST', body }),
  member: (contactId) => request(`/api/members/${contactId}`),
  adjust: (contactId, body) => request(`/api/members/${contactId}/adjust`, { method: 'POST', body: { ...body, requestId: rid() } }),
  grant: (contactId, body) => request(`/api/members/${contactId}/grant`, { method: 'POST', body: { ...body, requestId: rid() } }),
  revokeLot: (contactId, lotId) => request(`/api/members/${contactId}/lots/${lotId}/revoke`, { method: 'POST' }),

  classes: (from, to) => request('/api/classes', { params: { from: from.toISOString(), to: to.toISOString() } }),
  checkIn: (id) => request(`/api/classes/bookings/${id}/checkin`, { method: 'POST' }),
  noShow: (id) => request(`/api/classes/bookings/${id}/noshow`, { method: 'POST' }),
  cancelBooking: (id, refund) => request(`/api/classes/bookings/${id}/cancel`, { method: 'POST', body: { refund } }),
  staffBook: (body) => request('/api/classes/book', { method: 'POST', body }),
  addToWaitlist: (body) => request('/api/classes/waitlist', { method: 'POST', body }),
  removeFromWaitlist: (id) => request(`/api/classes/waitlist/${id}`, { method: 'DELETE' }),

  report: (days) => request('/api/reports', { params: { days } }),

  // Public (no session)
  schedule: (slug) => request(`/api/public/schedule/${slug}`, { auth: false }),
  joinWaitlist: (slug, body) => request(`/api/public/schedule/${slug}/waitlist`, { method: 'POST', body, auth: false }),
  kiosk: (token) => request(`/api/public/kiosk/${token}`, { auth: false }),
  kioskCheckIn: (token, phone) => request(`/api/public/kiosk/${token}/checkin`, { method: 'POST', body: { phone }, auth: false })
};
