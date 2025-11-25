#!/usr/bin/env node

/**
 * Test script to verify ROI calculation logic
 * ROI = ((Revenue - Expenses) / Expenses) × 100% = (Profit/Loss / Expenses) × 100%
 */

console.log('🧪 Testing ROI calculation logic...\n');

// Test cases
const testCases = [
  {
    name: 'Test 1: Profit with expenses',
    revenue: 10000,
    expenses: 5000,
    expectedROI: 100.0 // (10000 - 5000) / 5000 * 100 = 100%
  },
  {
    name: 'Test 2: Loss with expenses',
    revenue: 3000,
    expenses: 5000,
    expectedROI: -40.0 // (3000 - 5000) / 5000 * 100 = -40%
  },
  {
    name: 'Test 3: Break even',
    revenue: 5000,
    expenses: 5000,
    expectedROI: 0.0 // (5000 - 5000) / 5000 * 100 = 0%
  },
  {
    name: 'Test 4: High profit',
    revenue: 15000,
    expenses: 5000,
    expectedROI: 200.0 // (15000 - 5000) / 5000 * 100 = 200%
  },
  {
    name: 'Test 5: No expenses (cannot calculate)',
    revenue: 10000,
    expenses: 0,
    expectedROI: null // Cannot divide by zero
  },
  {
    name: 'Test 6: Small profit',
    revenue: 5500,
    expenses: 5000,
    expectedROI: 10.0 // (5500 - 5000) / 5000 * 100 = 10%
  },
  {
    name: 'Test 7: Small loss',
    revenue: 4500,
    expenses: 5000,
    expectedROI: -10.0 // (4500 - 5000) / 5000 * 100 = -10%
  }
];

function calculateROI(revenue, expenses) {
  if (expenses === 0 || expenses === null || expenses === undefined) {
    return null; // Cannot calculate ROI if expenses = 0
  }
  
  const profitLoss = revenue - expenses;
  const roi = (profitLoss / expenses) * 100;
  return Math.round(roi * 100) / 100; // Round to 2 decimal places
}

let allPassed = true;

testCases.forEach((testCase, index) => {
  console.log(`${index + 1}. ${testCase.name}`);
  console.log(`   Revenue: ${testCase.revenue}, Expenses: ${testCase.expenses}`);
  
  const calculatedROI = calculateROI(testCase.revenue, testCase.expenses);
  console.log(`   Calculated ROI: ${calculatedROI !== null ? calculatedROI.toFixed(2) + '%' : 'null (cannot calculate)'}`);
  console.log(`   Expected ROI: ${testCase.expectedROI !== null ? testCase.expectedROI.toFixed(2) + '%' : 'null'}`);
  
  let matches = false;
  if (calculatedROI === null && testCase.expectedROI === null) {
    matches = true;
  } else if (calculatedROI !== null && testCase.expectedROI !== null) {
    matches = Math.abs(calculatedROI - testCase.expectedROI) < 0.01;
  }
  
  if (matches) {
    console.log(`   ✅ PASSED`);
  } else {
    console.log(`   ❌ FAILED`);
    allPassed = false;
  }
  console.log('');
});

console.log('='.repeat(50));
if (allPassed) {
  console.log('✅ All tests passed! ROI calculation works correctly.');
  console.log('\nFormula: ROI = ((Revenue - Expenses) / Expenses) × 100%');
  console.log('Examples:');
  console.log('  - Revenue: 10000, Expenses: 5000 → ROI = (5000 / 5000) × 100% = 100%');
  console.log('  - Revenue: 3000, Expenses: 5000 → ROI = (-2000 / 5000) × 100% = -40%');
  console.log('  - Revenue: 10000, Expenses: 0 → ROI = null (cannot divide by zero)');
  process.exit(0);
} else {
  console.log('❌ Some tests failed!');
  process.exit(1);
}




