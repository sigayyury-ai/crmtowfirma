#!/usr/bin/env node

/**
 * Скрипт для обработки существующих сделок с оплаченными платежами,
 * для которых webhook уже был обработан, но автоматизация не сработала
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const CrmStatusAutomationService = require('../src/services/crm/statusAutomationService');
const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const DRY_RUN = process.argv.includes('--dry-run');
const DEAL_ID = process.argv.find(arg => arg.startsWith('--deal='))?.split('=')[1];

async function processDeals() {
  const repository = new StripeRepository();
  const pipedriveClient = new PipedriveClient();
  const automationService = new CrmStatusAutomationService();

  console.log('\n🔍 Поиск сделок с оплаченными платежами...\n');
  console.log('='.repeat(80));

  try {
    let dealsToProcess = [];

    if (DEAL_ID) {
      // Обрабатываем конкретную сделку
      console.log(`Обработка сделки #${DEAL_ID}...`);
      const payments = await repository.listPayments({
        dealId: DEAL_ID,
        limit: 100
      });
      
      const paidPayments = payments.filter(p => 
        p.payment_status === 'paid' || p.status === 'processed'
      );
      
      if (paidPayments.length > 0) {
        dealsToProcess.push({
          dealId: DEAL_ID,
          payments: paidPayments
        });
      } else {
        console.log(`❌ Сделка #${DEAL_ID} не имеет оплаченных платежей`);
        return;
      }
    } else {
      // Находим все сделки с оплаченными платежами
      const allPayments = await repository.listPayments({
        limit: 10000
      });

      const paidPayments = allPayments.filter(p => 
        p.payment_status === 'paid' || p.status === 'processed'
      );

      // Группируем по deal_id
      const dealsMap = new Map();
      for (const payment of paidPayments) {
        if (!payment.deal_id) continue;
        const dealId = String(payment.deal_id);
        if (!dealsMap.has(dealId)) {
          dealsMap.set(dealId, []);
        }
        dealsMap.get(dealId).push(payment);
      }

      dealsToProcess = Array.from(dealsMap.entries()).map(([dealId, payments]) => ({
        dealId,
        payments
      }));

      console.log(`Найдено ${dealsToProcess.length} сделок с оплаченными платежами`);
    }

    if (dealsToProcess.length === 0) {
      console.log('❌ Не найдено сделок для обработки');
      return;
    }

    console.log(`\n📊 Обработка ${dealsToProcess.length} сделок...\n`);
    console.log('='.repeat(80));

    let processed = 0;
    let updated = 0;
    let errors = 0;

    for (const { dealId, payments } of dealsToProcess) {
      try {
        console.log(`\n🔍 Сделка #${dealId}:`);
        console.log(`   Оплаченных платежей: ${payments.length}`);
        
        // Получаем текущий статус сделки
        const dealResult = await pipedriveClient.getDeal(dealId);
        if (!dealResult.success || !dealResult.deal) {
          console.log(`   ⚠️  Сделка не найдена в Pipedrive`);
          errors++;
          continue;
        }

        const currentStage = dealResult.deal.stage_id;
        console.log(`   Текущий статус: ${currentStage}`);

        if (DRY_RUN) {
          console.log(`   🔍 [DRY-RUN] Вызов автоматизации для сделки #${dealId}`);
          // В dry-run режиме просто проверяем, что автоматизация сработает
          const snapshot = await automationService.buildDealSnapshot(dealId, dealResult.deal);
          console.log(`   📊 Snapshot:`, {
            expectedAmountPln: snapshot.totals.expectedAmountPln,
            totalPaidPln: snapshot.totals.totalPaidPln,
            stripePaidPln: snapshot.totals.stripePaidPln,
            scheduleType: snapshot.scheduleType
          });
        } else {
          // Вызываем автоматизацию
          console.log(`   🔄 Вызов автоматизации...`);
          const result = await automationService.syncDealStage(dealId, {
            reason: 'manual:process-existing-paid-deals',
            force: true
          });

          if (result.updated) {
            console.log(`   ✅ Статус обновлен: ${result.from} → ${result.to}`);
            console.log(`   📝 Причина: ${result.reason}`);
            updated++;
          } else {
            console.log(`   ℹ️  Статус не требует обновления: ${result.reason}`);
          }
        }

        processed++;
      } catch (error) {
        console.error(`   ❌ Ошибка обработки сделки #${dealId}:`, error.message);
        logger.error('Failed to process deal', { dealId, error: error.message, stack: error.stack });
        errors++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n📊 ИТОГИ:');
    console.log(`   Обработано: ${processed}`);
    console.log(`   Обновлено: ${updated}`);
    console.log(`   Ошибок: ${errors}`);
    if (DRY_RUN) {
      console.log(`\n⚠️  DRY-RUN режим - изменения не применены`);
    }
    console.log('');

  } catch (error) {
    console.error('\n❌ Критическая ошибка:', error.message);
    logger.error('Failed to process existing paid deals', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

if (DRY_RUN) {
  console.log('⚠️  DRY-RUN режим - изменения не будут применены\n');
}

processDeals()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Необработанная ошибка:', error);
    process.exit(1);
  });

