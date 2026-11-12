require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const logger = require('./utils/logger');
const database = require('./config/database');
const scheduler = require('./jobs/scheduler');
const { createApp } = require('./app');

async function start() {
  if (!process.env.JWT_SECRET) {
    logger.error('JWT_SECRET is not set.');
    process.exit(1);
  }
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
