#!/usr/bin/env node

/**
 * Скрипт для исправления проблемы со сделкой 1651
 * 
 * Проблема: Сделка переведена в статус "lost" и добавлен статус "delete",
 * но Stripe платежи все равно выставляются и не отменяются
 * 
 * Действия:
 * 1. Проверяет статус сделки в Pipedrive
 * 2. Находит все активные Stripe сессии для этой сделки
 * 3. Отменяет все активные сессии
 * 4. Удаляет записи из базы данных
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeProcessorService = require('../src/services/stripe/processor');
const StripeRepository = require('../src/services/stripe/repository');
const logger = require('../src/utils/logger');

const DEAL_ID = '1651';
const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('-d');

async function fixDeal1651() {
  try {
    const processor = new StripeProcessorService();
    const repository = new StripeRepository();

    if (!repository.isEnabled()) {
      console.error('❌ Supabase не настроен');
      process.exit(1);
    }

    if (DRY_RUN) {
      console.log(`🔍 DRY-RUN РЕЖИМ - изменения не будут применены\n`);
    }
    console.log(`🔍 Проверка сделки ${DEAL_ID}...\n`);

    // 1. Проверяем статус сделки в Pipedrive
    const dealResult = await processor.pipedriveClient.getDealWithRelatedData(DEAL_ID);
    if (!dealResult.success || !dealResult.deal) {
      console.error(`❌ Сделка не найдена: ${dealResult?.error || 'unknown'}`);
      process.exit(1);
    }

    const deal = dealResult.deal;
    const dealStatus = deal.status;
    const invoiceTypeFieldKey = processor.invoiceTypeFieldKey;
    const invoiceType = invoiceTypeFieldKey ? deal[invoiceTypeFieldKey] : null;

    console.log(`📋 Информация о сделке:`);
    console.log(`   ID: ${deal.id}`);
    console.log(`   Название: ${deal.title}`);
    console.log(`   Статус: ${dealStatus}`);
    console.log(`   invoice_type: ${invoiceType || 'не установлен'}`);
    console.log(`   Удалена: ${deal.deleted || false}\n`);

    // 2. Находим все платежи для этой сделки
    console.log(`🔍 Поиск Stripe платежей...\n`);
    const payments = await repository.listPayments({
      dealId: DEAL_ID,
      limit: 100
    });

    console.log(`📋 Найдено платежей в БД: ${payments.length}`);

    if (payments.length > 0) {
      console.log(`\n📋 Детали платежей:`);
      payments.forEach((p, index) => {
        console.log(`\n   ${index + 1}. Payment ID: ${p.id}`);
        console.log(`      Session ID: ${p.session_id || 'N/A'}`);
        console.log(`      Status: ${p.status || 'N/A'}`);
        console.log(`      Payment Status: ${p.payment_status || 'N/A'}`);
        console.log(`      Amount: ${p.original_amount || 0} ${p.currency || 'PLN'}`);
      });
    }

    // 3. Отменяем все активные сессии
    if (DRY_RUN) {
      console.log(`\n🗑️  [DRY-RUN] Отмена активных Stripe сессий...\n`);
      console.log(`   ⚠️  В DRY-RUN режиме сессии НЕ будут отменены\n`);
      
      // Находим сессии, которые будут отменены
      const paymentsToCancel = payments.filter(p => 
        p.session_id && 
        p.payment_status !== 'paid' && 
        p.status !== 'expired' && 
        p.status !== 'canceled'
      );
      
      if (paymentsToCancel.length > 0) {
        console.log(`   📋 Сессии, которые будут отменены (${paymentsToCancel.length}):`);
        paymentsToCancel.forEach((p, index) => {
          console.log(`      ${index + 1}. Session ID: ${p.session_id}`);
          console.log(`         Status: ${p.status}`);
          console.log(`         Payment Status: ${p.payment_status}`);
          console.log(`         Amount: ${p.original_amount || 0} ${p.currency || 'PLN'}`);
        });
      } else {
        console.log(`   ✅ Нет активных сессий для отмены`);
      }
      
      console.log(`\n   📋 Записи, которые будут удалены из БД: ${payments.length}`);
    } else {
      console.log(`\n🗑️  Отмена активных Stripe сессий...\n`);
      const cancelResult = await processor.cancelDealCheckoutSessions(DEAL_ID);
      
      console.log(`✅ Результат отмены:`);
      console.log(`   Отменено сессий: ${cancelResult.cancelled}`);
      console.log(`   Удалено записей из БД: ${cancelResult.removed}`);
    }

    // 4. Проверяем, что все сессии отменены (только если не DRY_RUN)
    if (!DRY_RUN) {
      console.log(`\n🔍 Проверка оставшихся активных сессий...\n`);
      const remainingPayments = await repository.listPayments({
        dealId: DEAL_ID,
        limit: 100
      });

      const activeSessions = remainingPayments.filter(p => 
        p.session_id && 
        p.payment_status !== 'paid' && 
        p.status !== 'expired' && 
        p.status !== 'canceled'
      );

      if (activeSessions.length > 0) {
        console.log(`⚠️  Найдено ${activeSessions.length} активных сессий, которые не были отменены:`);
        activeSessions.forEach((p, index) => {
          console.log(`   ${index + 1}. Session ID: ${p.session_id}, Status: ${p.status}`);
        });
      } else {
        console.log(`✅ Все активные сессии отменены`);
      }
    }

    // 5. Проверяем статус сделки и предупреждаем, если нужно
    if (dealStatus !== 'lost' && invoiceType !== '74' && !deal.deleted) {
      console.log(`\n⚠️  ВНИМАНИЕ: Сделка не имеет статуса "lost" или invoice_type "Delete"`);
      console.log(`   Рекомендуется установить статус "lost" или invoice_type = "74" в Pipedrive`);
    } else {
      console.log(`\n✅ Сделка правильно помечена как потерянная/удаленная`);
    }

    if (DRY_RUN) {
      console.log(`\n✅ [DRY-RUN] Обработка завершена (изменения не применены)`);
      console.log(`\n💡 Для применения изменений запустите скрипт без флага --dry-run`);
    } else {
      console.log(`\n✅ Обработка завершена`);
    }
  } catch (error) {
    logger.error('Ошибка при исправлении сделки 1651:', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

fixDeal1651();
