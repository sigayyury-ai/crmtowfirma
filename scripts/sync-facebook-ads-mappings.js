/**
 * Скрипт для синхронизации Facebook Ads маппингов с расходами
 * Обновляет product_id в facebook_ads_expenses для всех существующих маппингов
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function syncMappingsToExpenses() {
  if (!supabase) {
    console.error('❌ Supabase недоступен. Проверьте переменные окружения.');
    process.exit(1);
  }

  console.log('🔄 Начинаю синхронизацию маппингов с расходами...\n');

  try {
    // Получаем все маппинги
    const { data: mappings, error: mappingsError } = await supabase
      .from('facebook_ads_campaign_mappings')
      .select('*');

    if (mappingsError) {
      throw new Error(`Ошибка при загрузке маппингов: ${mappingsError.message}`);
    }

    if (!mappings || mappings.length === 0) {
      console.log('ℹ️  Маппинги не найдены.');
      return;
    }

    console.log(`📋 Найдено маппингов: ${mappings.length}\n`);

    let totalUpdated = 0;

    for (const mapping of mappings) {
      console.log(`🔍 Обрабатываю маппинг: "${mapping.campaign_name}" → Product ID ${mapping.product_id}`);

      // Обновляем все расходы с этим campaign_name_normalized
      const { data: updatedExpenses, error: updateError } = await supabase
        .from('facebook_ads_expenses')
        .update({ product_id: mapping.product_id })
        .eq('campaign_name_normalized', mapping.campaign_name_normalized)
        .select('id');

      if (updateError) {
        console.error(`  ❌ Ошибка при обновлении расходов: ${updateError.message}`);
        continue;
      }

      const updatedCount = updatedExpenses?.length || 0;
      totalUpdated += updatedCount;

      if (updatedCount > 0) {
        console.log(`  ✅ Обновлено расходов: ${updatedCount}`);
      } else {
        console.log(`  ℹ️  Расходы не найдены для этой кампании`);
      }
    }

    console.log(`\n✅ Синхронизация завершена. Всего обновлено расходов: ${totalUpdated}`);
  } catch (error) {
    console.error('❌ Ошибка при синхронизации:', error.message);
    logger.error('Facebook Ads sync error', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Запускаем синхронизацию
syncMappingsToExpenses()
  .then(() => {
    console.log('\n✨ Готово!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  });


