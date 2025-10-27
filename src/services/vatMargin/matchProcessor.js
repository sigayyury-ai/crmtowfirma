const vatLogger = require('../../utils/vatLogger');

async function enrichTransactions(transactions, lookup) {
  const results = [];
  for (const tx of transactions) {
    if (tx.proforma) {
      const proforma = await lookup.findProformaByNumber(tx.proforma);
      if (proforma) {
        const difference = tx.amount - proforma.expectedAmount;
        results.push({
          ...tx,
          proformaId: proforma.id,
          productName: proforma.product,
          expectedAmount: proforma.expectedAmount,
          difference,
          status:
            difference === 0
              ? 'matched'
              : difference < 0
              ? 'partial'
              : 'overpaid',
        });
        continue;
      }
    }
    results.push(tx);
  }

  vatLogger.summary('prototype', results);
  return results;
}

module.exports = { enrichTransactions };


