const fs = require('fs');
const path = require('path');
const { parseCSV } = require('../../../src/services/vatMargin/csvParser');

describe('CSV Parser', () => {
  it('parses CSV and extracts proforma numbers', () => {
    const csvPath = path.resolve(__dirname, '../../../specs/003-vat-margin-tracker/test.csv');
    const content = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCSV(content);
    expect(rows.length).toBeGreaterThan(0);
    const proformaRow = rows.find((row) => row.proforma);
    expect(proformaRow).toBeDefined();
    expect(proformaRow.proforma).toMatch(/CO-PROF/);
  });
});


