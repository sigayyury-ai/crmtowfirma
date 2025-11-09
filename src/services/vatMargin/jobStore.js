const { v4: uuid } = require('uuid');

const store = new Map();

function createJob(transactions, aggregates, manual) {
  const jobId = uuid();
  store.set(jobId, {
    createdAt: new Date().toISOString(),
    transactions,
    aggregates,
    manual,
  });
  return jobId;
}

function getJob(jobId) {
  return store.get(jobId);
}

module.exports = { createJob, getJob };


