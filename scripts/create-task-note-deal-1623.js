#!/usr/bin/env node

/**
 * Скрипт для создания задачи и ноута в сделке 1623 после обновления проформы
 */

require('dotenv').config();
const PipedriveClient = require('../src/services/pipedrive');
const InvoiceProcessingService = require('../src/services/invoiceProcessing');
const ProformaRepository = require('../src/services/proformaRepository');
const PaymentService = require('../src/services/payments/paymentService');
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const dealId = 1623;

async function createTaskAndNote() {
  try {
    console.log(`\n🔧 Создание задачи и ноута для сделки ${dealId}...\n`);
    
    const pipedriveClient = new PipedriveClient();
    const invoiceProcessing = new InvoiceProcessingService();
    const proformaRepository = new ProformaRepository();
    const paymentService = new PaymentService();
    
    // Шаг 1: Получаем данные сделки
    console.log('📋 Шаг 1: Получение данных сделки...');
    const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
    if (!dealResult.success || !dealResult.deal) {
      throw new Error(`Сделка ${dealId} не найдена`);
    }
    const fullDeal = dealResult.deal;
    console.log(`   ✅ Сделка: "${fullDeal.title}" | Валюта: ${fullDeal.currency} | Сумма: ${fullDeal.value}`);
    
    // Шаг 2: Получаем проформу из базы
    console.log('\n📋 Шаг 2: Получение проформы из базы...');
    const { data: proformas, error: proformasError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', dealId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (proformasError) {
      throw new Error(`Ошибка получения проформы: ${proformasError.message}`);
    }
    
    if (!proformas || proformas.length === 0) {
      throw new Error(`Проформа не найдена для сделки ${dealId}`);
    }
    
    const existingProforma = proformas[0];
    console.log(`   ✅ Проформа: ${existingProforma.fullnumber || existingProforma.invoice_id} | ID: ${existingProforma.id}`);
    
    // Шаг 3: Получаем продукты проформы
    console.log('\n📋 Шаг 3: Получение продуктов проформы...');
    const { data: proformaProductData, error: proformaProductError } = await supabase
      .from('proforma_products')
      .select(`
        *,
        products ( id, name, normalized_name )
      `)
      .eq('proforma_id', existingProforma.id)
      .limit(1)
      .single();
    
    const currentProductName = proformaProductData?.products?.name || proformaProductData?.name || 'N/A';
    console.log(`   ✅ Текущий продукт: "${currentProductName}"`);
    
    // Шаг 4: Получаем платежи
    console.log('\n📋 Шаг 4: Получение платежей...');
    // Используем payments_total_pln из проформы, так как это уже оплаченная сумма
    let paidAmount = parseFloat(existingProforma.payments_total_pln) || 0;
    console.log(`   ✅ Оплачено (из payments_total_pln): ${paidAmount} PLN`);
    
    // Также получаем платежи из таблицы payments для проверки
    const { data: paymentRows, error: paymentsError } = await supabase
      .from('payments')
      .select('amount, currency')
      .eq('manual_status', 'approved')
      .eq('manual_proforma_id', existingProforma.invoice_id);
    
    if (!paymentsError && paymentRows && paymentRows.length > 0) {
      const paidFromTable = paymentRows.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
      console.log(`   ✅ Платежей в таблице: ${paymentRows.length} | Сумма: ${paidFromTable}`);
      // Используем сумму из таблицы, если она больше
      if (paidFromTable > paidAmount) {
        paidAmount = paidFromTable;
      }
    }
    
    // Шаг 5: Получаем старую сумму проформы
    console.log('\n📋 Шаг 5: Получение старой суммы проформы...');
    // Из проверки данных: payments_total_pln = 2019 PLN (оплачено по старой проформе)
    // Старая сумма проформы была 2019 PLN (это была полная оплата старого продукта)
    const oldProformaTotal = 2019; // Старая сумма проформы до изменения продукта
    console.log(`   ✅ Старая сумма проформы: ${oldProformaTotal} ${existingProforma.currency}`);
    
    // Шаг 6: Рассчитываем суммы
    console.log('\n📋 Шаг 6: Расчет сумм...');
    const totalAmountValue = parseFloat(fullDeal.value) || 0;
    const remainingAmount = Math.max(0, totalAmountValue - paidAmount);
    
    console.log(`   ✅ Новая сумма: ${totalAmountValue} ${fullDeal.currency}`);
    console.log(`   ✅ Старая сумма проформы: ${oldProformaTotal} ${fullDeal.currency}`);
    console.log(`   ✅ Оплачено: ${paidAmount} ${fullDeal.currency}`);
    console.log(`   ✅ Остаток к оплате: ${remainingAmount} ${fullDeal.currency}`);
    
    // Шаг 7: Получаем информацию о предыдущем продукте
    console.log('\n📋 Шаг 7: Получение информации о предыдущем продукте...');
    // Из истории чата: нужно найти предыдущий продукт
    // Пока используем значение из переменной окружения или пытаемся найти в истории
    // Если не указано, используем текущий продукт (но это неправильно, нужно указать)
    const previousProductName = process.env.PREVIOUS_PRODUCT_NAME || 'N/A';
    if (previousProductName === 'N/A') {
      console.log(`   ⚠️  ВНИМАНИЕ: Предыдущий продукт не указан!`);
      console.log(`   💡 Укажите через PREVIOUS_PRODUCT_NAME или обновите скрипт`);
    }
    console.log(`   ✅ Предыдущий продукт: "${previousProductName}"`);
    console.log(`   ✅ Текущий продукт: "${currentProductName}"`);
    
    // Шаг 8: Рассчитываем дату платежа
    console.log('\n📋 Шаг 7: Расчет даты платежа...');
    let finalDueDate = new Date().toISOString().split('T')[0];
    if (fullDeal.expected_close_date) {
      try {
        const expectedCloseDate = new Date(fullDeal.expected_close_date);
        const balanceDueDate = new Date(expectedCloseDate);
        balanceDueDate.setMonth(balanceDueDate.getMonth() - 1);
        finalDueDate = balanceDueDate.toISOString().split('T')[0];
      } catch (error) {
        console.log(`   ⚠️  Ошибка расчета даты: ${error.message}`);
      }
    }
    console.log(`   ✅ Дата платежа: ${finalDueDate}`);
    
    // Шаг 9: Создаем задачу
    console.log('\n📋 Шаг 9: Создание задачи в Pipedrive...');
    const formatAmount = (value) => value.toFixed(2);
    const taskDueDate = new Date();
    taskDueDate.setDate(taskDueDate.getDate() + 1); // Задача на завтра
    
    const taskResult = await pipedriveClient.createTask({
      deal_id: dealId,
      subject: `Проверить последний платеж по проформе ${existingProforma.fullnumber || existingProforma.invoice_id}`,
      type: 'task',
      due_date: taskDueDate.toISOString().split('T')[0],
      note: `Проформа обновлена после изменения продукта. Проверить корректность последнего платежа.`
    });
    
    if (taskResult.success) {
      console.log(`   ✅ Задача создана | Task ID: ${taskResult.task.id}`);
    } else {
      console.log(`   ❌ Ошибка создания задачи: ${taskResult.error}`);
    }
    
    // Шаг 10: Создаем ноут
    console.log('\n📋 Шаг 10: Создание ноута в Pipedrive...');
    const noteContent = `🔄 Обновление проформы после изменения продукта

📋 Проформа: ${existingProforma.fullnumber || existingProforma.invoice_id}

📦 Изменение продукта:
   Было: "${previousProductName}"
   Стало: "${currentProductName}"

💰 Изменение суммы:
   Было: ${formatAmount(oldProformaTotal)} ${fullDeal.currency}
   Стало: ${formatAmount(totalAmountValue)} ${fullDeal.currency}
   Разница: ${formatAmount(totalAmountValue - oldProformaTotal)} ${fullDeal.currency}

💳 Платежи:
   Уже оплачено: ${formatAmount(paidAmount)} ${fullDeal.currency}
   Остаток к оплате: ${formatAmount(remainingAmount)} ${fullDeal.currency}
   ${remainingAmount > 0 ? `Дата платежа: ${finalDueDate}` : 'Все оплачено'}

✅ Проформа успешно обновлена в wFirma.`;
    
    const noteResult = await pipedriveClient.addNoteToDeal(dealId, noteContent);
    
    if (noteResult.success) {
      console.log(`   ✅ Ноут создан | Note ID: ${noteResult.note.id}`);
    } else {
      console.log(`   ❌ Ошибка создания ноута: ${noteResult.error}`);
    }
    
    console.log('\n✅ Готово!\n');
    
  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

createTaskAndNote();

