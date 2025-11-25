#!/usr/bin/env node

/**
 * Test script to verify balance calculation logic with profits and losses
 */

console.log('🧪 Testing balance calculation logic...\n');

// Test cases
const testCases = [
  {
    name: 'Test 1: Profit only',
    monthlyProfitLoss: [1000, 2000, 1500, 3000],
    expectedBalance: [1000, 3000, 4500, 7500]
  },
  {
    name: 'Test 2: Loss only',
    monthlyProfitLoss: [-500, -1000, -200, -300],
    expectedBalance: [-500, -1500, -1700, -2000]
  },
  {
    name: 'Test 3: Mixed profit and loss',
    monthlyProfitLoss: [1000, -500, 2000, -300, -200],
    expectedBalance: [1000, 500, 2500, 2200, 2000]
  },
  {
    name: 'Test 4: Starting with loss, then profit',
    monthlyProfitLoss: [-1000, -500, 2000, 1500],
    expectedBalance: [-1000, -1500, 500, 2000]
  },
  {
    name: 'Test 5: Starting with profit, then loss',
    monthlyProfitLoss: [2000, 1000, -1500, -500],
    expectedBalance: [2000, 3000, 1500, 1000]
  }
];

function calculateBalance(monthlyProfitLoss) {
  const balanceMonthly = [];
  let runningBalance = 0;

  for (let month = 0; month < monthlyProfitLoss.length; month++) {
    const profitLossAmount = monthlyProfitLoss[month] || 0;
    runningBalance += profitLossAmount;
    balanceMonthly.push(Math.round(runningBalance * 100) / 100);
  }

  return balanceMonthly;
}

let allPassed = true;

testCases.forEach((testCase, index) => {
  console.log(`\n${index + 1}. ${testCase.name}`);
  console.log(`   Monthly Profit/Loss: ${testCase.monthlyProfitLoss.join(', ')}`);
  
  const calculatedBalance = calculateBalance(testCase.monthlyProfitLoss);
  console.log(`   Calculated Balance:  ${calculatedBalance.join(', ')}`);
  console.log(`   Expected Balance:    ${testCase.expectedBalance.join(', ')}`);
  
  const matches = calculatedBalance.every((val, idx) => 
    Math.abs(val - testCase.expectedBalance[idx]) < 0.01
  );
  
  if (matches) {
    console.log(`   ✅ PASSED`);
  } else {
    console.log(`   ❌ FAILED`);
    allPassed = false;
    
    // Show differences
    calculatedBalance.forEach((val, idx) => {
      const expected = testCase.expectedBalance[idx];
      if (Math.abs(val - expected) >= 0.01) {
        console.log(`      Month ${idx + 1}: Expected ${expected}, got ${val}`);
      }
    });
  }
});

console.log('\n' + '='.repeat(50));
if (allPassed) {
  console.log('✅ All tests passed! Balance calculation works correctly.');
  console.log('\nFormula: runningBalance += profitLossAmount');
  console.log('This correctly handles:');
  console.log('  - Positive values (profit): adds to balance');
  console.log('  - Negative values (loss): subtracts from balance');
  console.log('  - Example: balance = 1000, loss = -500 → balance = 1000 + (-500) = 500');
  process.exit(0);
} else {
  console.log('❌ Some tests failed!');
  process.exit(1);
}




