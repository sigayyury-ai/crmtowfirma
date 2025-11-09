const Papa = require('papaparse');

function parseCSV(content) {
  const rows = [];
  Papa.parse(content, {
    delimiter: ';',
    skipEmptyLines: true,
    step(result) {
      rows.push(result.data);
    },
  });

  const dataRows = rows.filter((cols) => cols[0]?.match(/\d{4}-\d{2}-\d{2}/));
  return dataRows.map((cols, index) => {
    const title = cols[3]?.replace(/"/g, '').trim();
    const proformaMatch = title?.match(/CO-PROF\s*(\d+[\/\-]?\d{4})/i);
    const proforma = proformaMatch
      ? `CO-PROF ${proformaMatch[1].replace('-', '/')}`
      : null;
    const amountRaw = cols[6] || '0';
    const amount = parseFloat(amountRaw.replace(/\s/g, '').replace(',', '.'));

    return {
      id: index + 1,
      bookingDate: cols[0],
      operationDate: cols[1],
      title,
      description: cols[2],
      counterparty: cols[4],
      accountNumber: cols[5],
      amount,
      amountRaw,
      proforma,
      status: proforma ? 'matched' : 'manual',
    };
  });
}

module.exports = { parseCSV };


