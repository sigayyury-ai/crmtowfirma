const WfirmaClient = require('../wfirma');
const vatLogger = require('../../utils/vatLogger');

const client = new WfirmaClient();
const cache = new Map();

async function findProformaByNumber(number) {
  if (!number) return null;
  if (cache.has(number)) return cache.get(number);

  try {
    const response = await client.client.get('/invoices/find', {
      params: {
        number,
        invoice_type: 'proforma',
        outputFormat: 'json',
        inputFormat: 'json',
      },
    });

    const invoices = response.data?.invoices?.invoice;
    if (!invoices || invoices.length === 0) {
      cache.set(number, null);
      return null;
    }

    const invoice = Array.isArray(invoices) ? invoices[0] : invoices;
    const result = {
      id: invoice.id,
      number: invoice.number,
      product: invoice.description,
      expectedAmount: parseFloat(invoice.total_brutto),
      currency: invoice.currency,
    };
    cache.set(number, result);
    return result;
  } catch (error) {
    vatLogger.error('Error fetching proforma', error);
    return null;
  }
}

module.exports = { findProformaByNumber };


