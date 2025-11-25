#!/usr/bin/env node

/**
 * Test script to verify refund direction logic
 */

const { parseBankStatement } = require('../../src/services/payments/bankStatementParser');

const testCases = [
  {
    name: 'Возврат клиенту с проформой (расход)',
    csv: `#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;
2025-10-30;VETRAVA VOLHA UL KAROLKOWA 28M206 01-207 WARSZAWA, ZWROT CO-PROF 31/2025 PRZELEW ZEWNĘTRZNY WYCHODZĄCY;Account;Category;425,00 PLN`,
    expectedDirection: 'out',
    expectedReason: 'description_refund_to_client'
  },
  {
    name: 'Возврат клиенту без проформы (расход)',
    csv: `#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;
2025-10-06;SERGEI LALOV UL. LIRSOPARKOWAIA 5 M.14 000000 ZIELENOGRADSK, ZWROT 1400 ZL OPLACONE PRZEZ POMYLKE PRZELEW ZEWNĘTRZNY WYCHODZĄCY;Account;Category;1400,00 PLN`,
    expectedDirection: 'out',
    expectedReason: 'description_refund_to_client'
  },
  {
    name: 'Возврат от сервиса аренды (доход)',
    csv: `#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;
2025-10-21;rentalcars.com ZWROT ZAKUPU;Account;Category;424,38 PLN`,
    expectedDirection: 'in',
    expectedReason: 'description_refund_from_service'
  },
  {
    name: 'Возврат от booking.com (доход)',
    csv: `#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;
2025-10-21;booking.com ZWROT ZAKUPU;Account;Category;100,00 PLN`,
    expectedDirection: 'in',
    expectedReason: 'description_refund_from_service'
  },
  {
    name: 'Обычный приходной платеж (доход)',
    csv: `#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;
2025-10-15;JOHN DOE UL. EXAMPLE 123 WARSZAWA, PAYMENT FOR SERVICE;Account;Category;1000,00 PLN`,
    expectedDirection: 'in',
    expectedReason: 'amount'
  },
  {
    name: 'Обычный расходной платеж (расход)',
    csv: `#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;
2025-10-15;PAYMENT FOR SUPPLIER SERVICE;Account;WYCHODZĄCY;-500,00 PLN`,
    expectedDirection: 'out',
    expectedReason: 'amount'
  }
];

console.log('🧪 Testing refund direction logic...\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const records = parseBankStatement(testCase.csv);
  
  if (records.length === 0) {
    console.log(`❌ ${testCase.name}: No records parsed`);
    failed++;
    continue;
  }
  
  const record = records[0];
  const directionMatch = record.direction === testCase.expectedDirection;
  
  // Note: directionSource is not exposed in the record, so we can't test it directly
  // But we can verify the direction is correct
  
  if (directionMatch) {
    console.log(`✅ ${testCase.name}`);
    console.log(`   Direction: ${record.direction} (expected: ${testCase.expectedDirection})`);
    console.log(`   Description: ${record.description?.substring(0, 60)}...`);
    passed++;
  } else {
    console.log(`❌ ${testCase.name}`);
    console.log(`   Direction: ${record.direction} (expected: ${testCase.expectedDirection})`);
    console.log(`   Description: ${record.description?.substring(0, 60)}...`);
    failed++;
  }
  console.log('');
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('✅ All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed');
  process.exit(1);
}

