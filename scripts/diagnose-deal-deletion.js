#!/usr/bin/env node

/**
 * Диагностика проблемы с удалением проформы для сделки
 * 
 * Использование:
 *   node scripts/diagnose-deal-deletion.js <dealId>
 * 
 * Пример:
 *   node scripts/diagnose-deal-deletion.js 2083
 */

require('dotenv').config();
const PipedriveClient = require('../src/services/pipedrive');
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function diagnoseDealDeletion(dealId) {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    console.log(`\n🔍 Диагностика удаления проформ для Deal #${dealId}\n`);

    // 1. Получаем данные сделки из Pipedrive
    const pipedriveClient = new PipedriveClient();
    const dealResult = await pipedriveClient.getDeal(dealId);
    
    if (!dealResult.success) {
      console.error('❌ Ошибка получения сделки:', dealResult.error);
      return;
    }

    const deal = dealResult.deal;
    
    console.log('📋 Данные сделки:');
    console.log(`   ID: ${deal.id}`);
    console.log(`   Название: ${deal.title || 'N/A'}`);
    console.log(`   Статус: ${deal.status || 'N/A'}`);
    console.log(`   Invoice Type: ${deal.invoice_type || 'не установлено'}`);
    console.log(`   Invoice Number: ${deal['0598d1168fe79005061aa3710ec45c3e03dbe8a3'] || 'не установлено'}`);
    
    // Проверяем триггер удаления
    const DELETE_TRIGGER_VALUES = new Set(['delete', '74']);
    const invoiceTypeValue = String(deal.invoice_type || '').trim().toLowerCase();
    const isDeleteTrigger = DELETE_TRIGGER_VALUES.has(invoiceTypeValue);
    
    console.log(`\n   Триггер удаления:`);
    console.log(`   - Значение invoice_type: '${invoiceTypeValue}'`);
    console.log(`   - Является триггером: ${isDeleteTrigger ? '✅ ДА' : '❌ НЕТ'}`);
    
    if (!isDeleteTrigger) {
      console.log(`\n⚠️  Поле invoice_type не установлено в значение 'delete' или '74'`);
      console.log(`   Для удаления проформы нужно установить invoice_type = '74' (Delete)`);
    }

    // 2. Ищем проформы в базе данных
    console.log(`\n📋 Поиск проформ в базе данных:`);
    
    const { data: proformas, error: proformaError } = await supabase
      .from('proformas')
      .select('id, fullnumber, pipedrive_deal_id, buyer_name, status, deleted_at, created_at')
      .eq('pipedrive_deal_id', String(dealId));
    
    if (proformaError) {
      console.error('❌ Ошибка поиска проформ:', proformaError);
      return;
    }
    
    if (!proformas || proformas.length === 0) {
      console.log('   ⚠️  Проформы не найдены по pipedrive_deal_id');
      
      // Пробуем найти по номеру проформы из поля Invoice Number
      const invoiceNumber = deal['0598d1168fe79005061aa3710ec45c3e03dbe8a3'];
      if (invoiceNumber) {
        console.log(`\n   Ищем по номеру проформы: ${invoiceNumber}`);
        const { data: proformasByNumber } = await supabase
          .from('proformas')
          .select('id, fullnumber, pipedrive_deal_id, buyer_name, status, deleted_at')
          .ilike('fullnumber', `%${invoiceNumber}%`);
        
        if (proformasByNumber && proformasByNumber.length > 0) {
          console.log(`   ✅ Найдено ${proformasByNumber.length} проформ по номеру:`);
          proformasByNumber.forEach(p => {
            console.log(`      - ${p.fullnumber} | Deal: ${p.pipedrive_deal_id || 'не связана'} | Статус: ${p.status || 'active'}`);
          });
        } else {
          console.log(`   ❌ Проформы с номером '${invoiceNumber}' не найдены`);
        }
      }
    } else {
      console.log(`   ✅ Найдено ${proformas.length} проформ:`);
      proformas.forEach(p => {
        console.log(`\n   Проформа:`);
        console.log(`      ID: ${p.id}`);
        console.log(`      Номер: ${p.fullnumber}`);
        console.log(`      Статус: ${p.status || 'active'}`);
        console.log(`      deleted_at: ${p.deleted_at || 'null (не удалена)'}`);
        console.log(`      Плательщик: ${p.buyer_name || 'N/A'}`);
        console.log(`      Создана: ${p.created_at}`);
      });
    }

    // 3. Проверяем логи удаления
    console.log(`\n📋 Логи удаления:`);
    
    const { data: deletionLogs, error: logError } = await supabase
      .from('proforma_deletion_logs')
      .select('*')
      .eq('deal_id', String(dealId))
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (logError) {
      console.error('❌ Ошибка получения логов:', logError);
    } else if (!deletionLogs || deletionLogs.length === 0) {
      console.log('   ⚠️  Логов удаления не найдено');
      console.log('   Это означает, что процесс удаления не был запущен');
    } else {
      console.log(`   ✅ Найдено ${deletionLogs.length} записей:`);
      deletionLogs.forEach(log => {
        console.log(`\n   Лог удаления:`);
        console.log(`      Статус: ${log.status}`);
        console.log(`      Proforma ID: ${log.proforma_id || 'N/A'}`);
        console.log(`      wFirma Status: ${log.wfirma_status || 'N/A'}`);
        console.log(`      Supabase Status: ${log.supabase_status || 'N/A'}`);
        console.log(`      Сообщение: ${log.message || 'N/A'}`);
        console.log(`      Создано: ${log.created_at}`);
      });
    }

    // 4. Рекомендации
    console.log(`\n💡 Рекомендации:`);
    
    if (!isDeleteTrigger) {
      console.log(`   1. Установите invoice_type = '74' (Delete) в сделке Pipedrive`);
      console.log(`   2. После установки webhook автоматически обработает удаление`);
    } else if (!proformas || proformas.length === 0) {
      console.log(`   1. Проформы не найдены в базе данных`);
      console.log(`   2. Проверьте, что проформа была создана и связана со сделкой`);
      console.log(`   3. Проверьте поле Invoice Number в сделке - там должен быть номер проформы`);
    } else {
      const activeProformas = proformas.filter(p => !p.deleted_at);
      if (activeProformas.length > 0) {
        console.log(`   1. Найдено ${activeProformas.length} активных проформ`);
        console.log(`   2. Установите invoice_type = '74' для запуска удаления`);
        console.log(`   3. Или запустите удаление вручную через API`);
      } else {
        console.log(`   1. Все проформы уже удалены (deleted_at установлен)`);
        console.log(`   2. Проверьте отчет "Удаленные проформы" для подтверждения`);
      }
    }

  } catch (error) {
    logger.error('Неожиданная ошибка:', error);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Использование: node scripts/diagnose-deal-deletion.js <dealId>');
  console.error('Пример: node scripts/diagnose-deal-deletion.js 2083');
  process.exit(1);
}

const dealId = parseInt(args[0], 10);
if (isNaN(dealId)) {
  console.error('Deal ID должен быть числом');
  process.exit(1);
}

diagnoseDealDeletion(dealId);
