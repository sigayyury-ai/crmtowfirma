const logger = require('./logger');

function redactTransaction(tx) {
  return {
    id: tx.id,
    bookingDate: tx.bookingDate,
    proforma: tx.proforma,
    amount: tx.amount,
    status: tx.status,
  };
}

module.exports = {
  info(message, meta = {}) {
    logger.info(message, { vat: true, ...meta });
  },

  error(message, error) {
    logger.error(message, { vat: true, error: error?.message });
  },

  summary(jobId, transactions) {
    const summary = {
      jobId,
      total: transactions.length,
      matched: transactions.filter((tx) => tx.status === 'matched').length,
      manual: transactions.filter((tx) => tx.status === 'manual').length,
    };
    logger.info('VAT job summary', { vat: true, summary });
  },

  sample(transactions, limit = 5) {
    logger.debug('VAT sample', {
      vat: true,
      transactions: transactions.slice(0, limit).map(redactTransaction),
    });
  },
};


