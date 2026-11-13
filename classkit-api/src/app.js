const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');
const database = require('./config/database');
const { requireAuth, loadWorkspace } = require('./middleware/auth');

/**
 * Express app factory (separate from server.js so tests can mount it without listening).
 * Same middleware posture as HelmDesk: iframe-embeddable inside GHL, strict CORS for the admin
 * API, open CORS for the public kiosk/schedule endpoints.
 */
function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'frame-ancestors': ["'self'", 'https://*.gohighlevel.com', 'https://*.leadconnectorhq.com']
      }
    }
  }));

  const OPEN = ['/api/public', '/api/webhooks', '/api/workflows'];
  const openCors = cors({ origin: true, credentials: false });
  const strictCors = cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      let host;
      try { host = new URL(origin).hostname.toLowerCase(); } catch { return cb(new Error('Bad origin')); }
      const bases = ['gohighlevel.com', 'leadconnectorhq.com', 'vercel.app', 'vaultsuite.store', 'trycloudflare.com'];
      const extra = String(process.env.CORS_EXTRA_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean);
      const ok = ['localhost', '127.0.0.1'].includes(host) || host.endsWith('.ngrok-free.app') || host.endsWith('.ngrok.io') ||
        [...bases, ...extra].some((b) => host === b || host.endsWith('.' + b));
      return ok ? cb(null, true) : cb(new Error('Not allowed by CORS'));
    },
    credentials: true
  });
  app.use((req, res, next) => (OPEN.some((p) => req.path.startsWith(p)) ? openCors : strictCors)(req, res, next));

  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => { if (req.path !== '/health') logger.info(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - t}ms)`); });
    next();
  });

  app.get('/health', (req, res) => res.json({ status: 'healthy', app: 'ClassKit', db: database.isConnected() ? 'connected' : 'down', mock: String(process.env.GHL_MOCK) === 'true' }));

  const gate = [requireAuth, loadWorkspace];
  app.use('/oauth', require('./routes/oauth'));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/webhooks', require('./routes/webhooks'));
  app.use('/api/workflows', require('./routes/workflows'));
  app.use('/api/public', require('./routes/public'));
  app.use('/api/settings', gate, require('./routes/settings'));
  app.use('/api/packages', gate, require('./routes/packages'));
  app.use('/api/members', gate, require('./routes/members'));
  app.use('/api/classes', gate, require('./routes/classes'));
  app.use('/api/reports', gate, require('./routes/reports'));

  // Serve the built UI at / when it sits next to the API (single-origin deploy). Split deploys skip this.
  const uiDist = path.resolve(__dirname, '../../classkit-ui/dist');
  if (fs.existsSync(uiDist)) {
    app.use(express.static(uiDist));
    app.get(/^\/(app|kiosk|s)(\/.*)?$/, (req, res) => res.sendFile(path.join(uiDist, 'index.html')));
  }

  app.use((req, res) => res.status(404).json({ success: false, error: 'Not Found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // A HighLevel API call failed: pass HighLevel's own reason through so staff can act on it.
    if (err.isAxiosError && err.response) {
      const body = err.response.data || {};
      const msg = [].concat(body.message || body.error || body.msg || `status ${err.response.status}`).join('; ');
      logger.warn('HighLevel API error', { path: req.path, status: err.response.status, url: err.config?.url, body: JSON.stringify(body).slice(0, 1000) });
      return res.status(err.response.status >= 500 ? 502 : 422).json({ success: false, error: `HighLevel: ${msg}`, code: 'GHL_ERROR' });
    }
    const status = err.status || (err.name === 'CastError' ? 400 : 500);
    if (status >= 500) logger.error('Unhandled error', { message: err.message, stack: err.stack });
    res.status(status).json({ success: false, error: status >= 500 && process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message, code: err.code });
  });
  return app;
}

module.exports = { createApp };
