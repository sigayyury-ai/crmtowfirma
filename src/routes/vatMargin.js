const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const { parseCSV } = require('../services/vatMargin/csvParser');
const { findProformaByNumber } = require('../services/vatMargin/wfirmaLookup');
const { enrichTransactions } = require('../services/vatMargin/matchProcessor');
const { createJob, getJob } = require('../services/vatMargin/jobStore');

const router = express.Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
});

router.use(auth, limiter);

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'File required' });
  }
  const content = req.file.buffer.toString('utf8');
  const transactions = parseCSV(content);
  const enriched = await enrichTransactions(transactions, { findProformaByNumber });
  const aggregates = [];
  const manual = enriched.filter((tx) => tx.status === 'manual');
  const jobId = createJob(enriched, aggregates, manual);
  return res.json({ success: true, jobId, summary: { total: enriched.length, manual: manual.length } });
});

router.get('/report', (req, res) => {
  const { jobId } = req.query;
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
  return res.json({ success: true, aggregates: job.aggregates });
});

router.get('/manual', (req, res) => {
  const { jobId } = req.query;
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
  return res.json({ success: true, manual: job.manual });
});

module.exports = router;


