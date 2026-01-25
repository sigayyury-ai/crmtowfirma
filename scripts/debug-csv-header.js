const fs = require('fs');
const path = require('path');

// Copy parseCsvLine function
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

const csvFile = path.join(__dirname, '../tmp/Расходы-для-выгрузки.csv');
const csvContent = fs.readFileSync(csvFile, 'utf-8');
const lines = csvContent.split(/\r?\n/).filter(l => l.trim());

const headerLine = lines[0];
console.log('Header line (raw):', JSON.stringify(headerLine));
console.log('Header line (visible):', headerLine);

const columns = parseCsvLine(headerLine);
console.log('\nParsed columns:');
columns.forEach((col, idx) => {
  console.log(`  ${idx}: "${col}" (length: ${col.length})`);
  console.log(`     BOM: ${col.charCodeAt(0) === 0xFEFF ? 'YES' : 'NO'}`);
  console.log(`     Lower: "${col.toLowerCase()}"`);
  console.log(`     Includes "название": ${col.toLowerCase().includes('название')}`);
  console.log(`     After removing quotes: "${col.replace(/^["']|["']$/g, '')}"`);
  console.log(`     After removing BOM: "${col.replace(/^\uFEFF/, '')}"`);
  console.log(`     After all: "${col.replace(/^\uFEFF/, '').replace(/^["']|["']$/g, '').toLowerCase()}"`);
  console.log('');
});





