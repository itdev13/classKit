require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const logger = require('./utils/logger');
const database = require('./config/database');
const scheduler = require('./jobs/scheduler');
const { createApp } = require('./app');

async function start() {
  const on = (k) => String(process.env[k] || '').toLowerCase() === 'true';
  const problems = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) problems.push('JWT_SECRET must be set (32+ random chars)');
  if (process.env.NODE_ENV === 'production') {
    if (on('GHL_MOCK')) problems.push('GHL_MOCK must be false in production');
    if (on('ALLOW_DEV_LOGIN')) problems.push('ALLOW_DEV_LOGIN must be false in production');
  }
  if (!on('GHL_MOCK')) {
    for (const k of ['GHL_CLIENT_ID', 'GHL_CLIENT_SECRET', 'GHL_REDIRECT_URI', 'GHL_SSO_KEY']) if (!process.env[k]) problems.push(`${k} is not set`);
  }
  if (problems.length) {
    problems.forEach((p) => logger.error(`Config: ${p}`));
    process.exit(1);
  }
  if (!process.env.GHL_WEBHOOK_ED25519_PUBLIC_KEY) logger.warn('GHL_WEBHOOK_ED25519_PUBLIC_KEY not set — webhook signatures are not verified');
  await database.connect();
  if (String(process.env.SCHEDULER_ENABLED ?? 'true').toLowerCase() !== 'false') scheduler.start();
  const port = process.env.PORT || 3030;
  createApp().listen(port, () => {
    logger.info('='.repeat(44));
    logger.info(`🎟️  ClassKit API on :${port}${String(process.env.GHL_MOCK) === 'true' ? '  (GHL_MOCK on)' : ''}`);
    logger.info('='.repeat(44));
  });
}

start().catch((e) => { logger.error('Startup failed', { message: e.message }); process.exit(1); });
