require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function main() {
  console.log('🔍 Проверка платежей FACEBK...\n');

  try {
    // Find all FACEBK payments
    const { data: payments, error } = await supabase
      .from('payments')
      .select('id, payer_name, description, expense_category_id, operation_date, amount, currency')
      .ilike('payer_name', '%FACEBK%')
      .is('deleted_at', null)
      .order('operation_date', { ascending: false });

    if (error) {
      console.error('❌ Ошибка при получении платежей:', error);
      return;
    }

    console.log(`📊 Найдено платежей FACEBK: ${payments.length}\n`);

    if (payments.length === 0) {
      console.log('✅ Платежей FACEBK не найдено');
      return;
    }

    // Category IDs
    const MARKETING_CATEGORY_ID = 20; // Marketing & Advertising
    const TOOLS_CATEGORY_ID = 33; // Tools

    let inTools = 0;
    let inMarketing = 0;
    let uncategorized = 0;
    let other = 0;

    const toUpdate = [];

    payments.forEach(payment => {
      const catId = payment.expense_category_id;
      if (catId === TOOLS_CATEGORY_ID) {
        inTools++;
        toUpdate.push(payment);
      } else if (catId === MARKETING_CATEGORY_ID) {
        inMarketing++;
      } else if (catId === null || catId === undefined) {
        uncategorized++;
      } else {
        other++;
      }
    });

    console.log(`📈 Статистика категоризации:`);
    console.log(`   В Tools (ID ${TOOLS_CATEGORY_ID}): ${inTools}`);
    console.log(`   В Marketing & Advertising (ID ${MARKETING_CATEGORY_ID}): ${inMarketing}`);
    console.log(`   Без категории: ${uncategorized}`);
    console.log(`   В других категориях: ${other}\n`);

    if (toUpdate.length > 0) {
      console.log(`🔄 Найдено ${toUpdate.length} платежей в категории Tools, которые нужно переместить в Marketing & Advertising\n`);
      
      console.log('Платежи для обновления:');
      toUpdate.forEach((p, i) => {
        console.log(`  ${i + 1}. ID: ${p.id}, Дата: ${p.operation_date}, Сумма: ${p.amount} ${p.currency || 'PLN'}, Плательщик: ${p.payer_name}`);
      });

      console.log('\n⏳ Обновление категорий...\n');

      let updated = 0;
      let errors = 0;

      for (const payment of toUpdate) {
        try {
          const { error: updateError } = await supabase
            .from('payments')
            .update({ expense_category_id: MARKETING_CATEGORY_ID })
            .eq('id', payment.id);

          if (updateError) {
            console.error(`❌ Ошибка при обновлении платежа ID ${payment.id}:`, updateError);
            errors++;
          } else {
            updated++;
            console.log(`✅ Обновлен платеж ID ${payment.id}`);
          }
        } catch (err) {
          console.error(`❌ Ошибка при обновлении платежа ID ${payment.id}:`, err.message);
          errors++;
        }
      }

      console.log(`\n✅ Обновлено: ${updated}`);
      if (errors > 0) {
        console.log(`❌ Ошибок: ${errors}`);
      }
    } else {
      console.log('✅ Все платежи FACEBK уже в правильной категории или без категории');
    }

  } catch (error) {
    logger.error('❌ Критическая ошибка:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Необработанная ошибка:', error);
  process.exit(1);
});

