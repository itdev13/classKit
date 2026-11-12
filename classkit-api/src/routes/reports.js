const express = require('express');
const router = express.Router();
const reportService = require('../services/reportService');
const { wrap } = require('../middleware/auth');

router.get('/', wrap(async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  res.json({ success: true, report: await reportService.summary(req.ws, days) });
}));

module.exports = router;
