require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const openAIService = require('../src/services/ai/openAIService');
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');
const logger = require('../src/utils/logger');

async function autoCategorizeAllExpenses() {
  const autoMatchThreshold = parseInt(process.argv[2]) || 80; // Default 80% confidence threshold
  
  console.log('🚀 Starting automatic categorization for all uncategorized expenses...');
  console.log(`Confidence threshold: ${autoMatchThreshold}%`);
  console.log('');

  // Load categories
  const expenseCategoryService = new ExpenseCategoryService();
  const categories = await expenseCategoryService.listCategories();
  
  console.log(`📂 Loaded ${categories.length} expense categories`);
  console.log('');

  // Load all uncategorized expenses
  const { data: expenses, error: fetchError } = await supabase
    .from('payments')
    .select('id, description, payer_name, amount, currency, operation_date, expense_category_id')
    .eq('direction', 'out')
    .is('expense_category_id', null)
    .order('operation_date', { ascending: false });

  if (fetchError) {
    console.error('❌ Error loading expenses:', fetchError);
    process.exit(1);
  }

  if (!expenses || expenses.length === 0) {
    console.log('✅ No uncategorized expenses found!');
    return;
  }

  console.log(`📋 Found ${expenses.length} uncategorized expenses`);
  console.log('');

  let processed = 0;
  let categorized = 0;
  let skipped = 0;
  let errors = 0;
  const results = [];

  // Process expenses in batches with delay to avoid rate limiting
  const batchSize = 5;
  const delayMs = 2000; // 2 seconds between batches

  for (let i = 0; i < expenses.length; i += batchSize) {
    const batch = expenses.slice(i, i + batchSize);
    
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(expenses.length / batchSize)} (expenses ${i + 1}-${Math.min(i + batchSize, expenses.length)})...`);

    const batchPromises = batch.map(async (expense) => {
      try {
        // Get OpenAI suggestion
        const aiResult = await openAIService.categorizeExpense(
          {
            id: expense.id,
            description: expense.description,
            payer_name: expense.payer_name,
            amount: expense.amount,
            currency: expense.currency || 'PLN',
            category: null
          },
          categories
        );

        processed++;

        if (aiResult.categoryId && aiResult.confidence >= autoMatchThreshold) {
          // Update payment with category
          const { error: updateError } = await supabase
            .from('payments')
            .update({ expense_category_id: aiResult.categoryId })
            .eq('id', expense.id);

          if (updateError) {
            console.error(`  ❌ Failed to update payment ${expense.id}:`, updateError.message);
            errors++;
            return { expense, aiResult, status: 'error', error: updateError.message };
          }

          categorized++;
          const category = categories.find(c => c.id === aiResult.categoryId);
          console.log(`  ✅ Payment ${expense.id}: "${expense.description?.substring(0, 40)}..." → ${category?.name || 'Unknown'} (${aiResult.confidence}%)`);
          
          return { expense, aiResult, status: 'categorized' };
        } else {
          skipped++;
          if (aiResult.categoryId) {
            const category = categories.find(c => c.id === aiResult.categoryId);
            console.log(`  ⏭️  Payment ${expense.id}: "${expense.description?.substring(0, 40)}..." → ${category?.name || 'Unknown'} (${aiResult.confidence}% < ${autoMatchThreshold}%)`);
          } else {
            console.log(`  ⏭️  Payment ${expense.id}: "${expense.description?.substring(0, 40)}..." → No suggestion`);
          }
          
          return { expense, aiResult, status: 'skipped', reason: aiResult.confidence < autoMatchThreshold ? 'low_confidence' : 'no_suggestion' };
        }
      } catch (error) {
        processed++;
        errors++;
        console.error(`  ❌ Error processing payment ${expense.id}:`, error.message);
        return { expense, status: 'error', error: error.message };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Rate limiting: wait between batches (except for the last batch)
    if (i + batchSize < expenses.length) {
      console.log(`  ⏳ Waiting ${delayMs / 1000}s before next batch...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log('');
  console.log('📊 Summary:');
  console.log(`  Total expenses: ${expenses.length}`);
  console.log(`  Processed: ${processed}`);
  console.log(`  ✅ Categorized: ${categorized} (confidence >= ${autoMatchThreshold}%)`);
  console.log(`  ⏭️  Skipped: ${skipped} (low confidence or no suggestion)`);
  console.log(`  ❌ Errors: ${errors}`);

  // Show category distribution
  const categoryStats = {};
  results
    .filter(r => r.status === 'categorized' && r.aiResult?.categoryId)
    .forEach(r => {
      const catId = r.aiResult.categoryId;
      categoryStats[catId] = (categoryStats[catId] || 0) + 1;
    });

  if (Object.keys(categoryStats).length > 0) {
    console.log('');
    console.log('📈 Category distribution:');
    Object.entries(categoryStats)
      .sort((a, b) => b[1] - a[1])
      .forEach(([catId, count]) => {
        const category = categories.find(c => c.id === parseInt(catId));
        console.log(`  ${category?.name || 'Unknown'} (ID ${catId}): ${count} expenses`);
      });
  }

  console.log('');
  console.log('✅ Done!');
}

autoCategorizeAllExpenses().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});







