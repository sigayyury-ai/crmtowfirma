/**
 * Скрипт для проверки гибридных платежей на сделке 2052
 * Проверяет:
 * 1. Наличие cash_amount в CRM
 * 2. Создание cash_payments записи
 * 3. Попадание в PNL отчет
 * 4. Учет в расчетах остатков
 */

const Pipedrive = require('pipedrive');
const supabase = require('../src/supabaseClient');
const logger = require('../src/utils/logger');
const { PIPEDRIVE_CASH_FIELDS } = require('../config/customFields');

const DEAL_ID = 2052;

async function main() {
  try {
    console.log(`\n🔍 Проверка гибридных платежей для сделки ${DEAL_ID}...\n`);

    // 1. Проверка cash_amount в CRM
    console.log('📋 Шаг 1: Проверка cash_amount в Pipedrive...');
    const pipedrive = new Pipedrive.Client(process.env.PIPEDRIVE_API_TOKEN);
    const deal = await pipedrive.Deals.get(DEAL_ID);
    
    if (!deal) {
      throw new Error(`Сделка ${DEAL_ID} не найдена`);
    }

    const cashAmountField = deal[PIPEDRIVE_CASH_FIELDS.cashAmount.key] || 
                           deal[`${PIPEDRIVE_CASH_FIELDS.cashAmount.key}`] ||
                           deal.cash_amount;
    
    const cashAmount = parseFloat(cashAmountField) || 0;
    console.log(`   ✅ Cash amount в CRM: ${cashAmount} ${deal.currency || 'PLN'}`);
    
    if (cashAmount <= 0) {
      console.log('   ⚠️  ВНИМАНИЕ: cash_amount отсутствует или равен 0!');
    }

    // 2. Проверка cash_payments в базе
    console.log('\n📋 Шаг 2: Проверка cash_payments в базе данных...');
    const { data: cashPayments, error: cashError } = await supabase
      .from('cash_payments')
      .select('*')
      .eq('deal_id', DEAL_ID)
      .order('created_at', { ascending: false });

    if (cashError) {
      console.error('   ❌ Ошибка при получении cash_payments:', cashError.message);
    } else {
      console.log(`   ✅ Найдено cash_payments записей: ${cashPayments?.length || 0}`);
      
      if (cashPayments && cashPayments.length > 0) {
        cashPayments.forEach((cp, idx) => {
          console.log(`\n   Запись ${idx + 1}:`);
          console.log(`     - ID: ${cp.id}`);
          console.log(`     - Статус: ${cp.status}`);
          console.log(`     - Ожидаемая сумма: ${cp.cash_expected_amount} ${cp.currency}`);
          console.log(`     - Полученная сумма: ${cp.cash_received_amount || 'не указана'} ${cp.currency}`);
          console.log(`     - Сумма в PLN: ${cp.amount_pln || 'не указана'}`);
          console.log(`     - Источник: ${cp.source}`);
          console.log(`     - Создано: ${cp.created_at}`);
          console.log(`     - Подтверждено: ${cp.confirmed_at || 'не подтверждено'}`);
        });
      } else {
        console.log('   ⚠️  ВНИМАНИЕ: cash_payments записи не найдены!');
      }
    }

    // 3. Проверка Stripe платежей
    console.log('\n📋 Шаг 3: Проверка Stripe платежей...');
    const { data: stripePayments, error: stripeError } = await supabase
      .from('stripe_payments')
      .select('*')
      .eq('deal_id', String(DEAL_ID))
      .order('created_at', { ascending: false });

    if (stripeError) {
      console.error('   ❌ Ошибка при получении stripe_payments:', stripeError.message);
    } else {
      console.log(`   ✅ Найдено Stripe платежей: ${stripePayments?.length || 0}`);
      
      if (stripePayments && stripePayments.length > 0) {
        let totalStripe = 0;
        stripePayments.forEach((sp, idx) => {
          const amount = parseFloat(sp.amount) || 0;
          totalStripe += amount;
          console.log(`\n   Платеж ${idx + 1}:`);
          console.log(`     - Session ID: ${sp.session_id}`);
          console.log(`     - Сумма: ${amount} ${sp.currency}`);
          console.log(`     - Сумма в PLN: ${sp.amount_pln || 'не указана'}`);
          console.log(`     - Статус: ${sp.payment_status || 'unknown'}`);
          console.log(`     - Metadata cash_amount_expected: ${sp.metadata?.cash_amount_expected || 'не указано'}`);
        });
        console.log(`\n   💰 Общая сумма Stripe: ${totalStripe.toFixed(2)} ${deal.currency || 'PLN'}`);
      }
    }

    // 4. Проверка PNL записей
    console.log('\n📋 Шаг 4: Проверка записей в PNL отчете...');
    const { data: pnlEntries, error: pnlError } = await supabase
      .from('pnl_revenue_entries')
      .select('*')
      .eq('deal_id', String(DEAL_ID))
      .order('created_at', { ascending: false });

    if (pnlError) {
      console.error('   ❌ Ошибка при получении pnl_revenue_entries:', pnlError.message);
    } else {
      console.log(`   ✅ Найдено PNL записей: ${pnlEntries?.length || 0}`);
      
      if (pnlEntries && pnlEntries.length > 0) {
        const cashEntries = pnlEntries.filter(e => e.cash_payment_id);
        const stripeEntries = pnlEntries.filter(e => !e.cash_payment_id);
        
        console.log(`   - Cash entries: ${cashEntries.length}`);
        console.log(`   - Stripe/Bank entries: ${stripeEntries.length}`);
        
        if (cashEntries.length > 0) {
          console.log('\n   Cash PNL записи:');
          cashEntries.forEach((entry, idx) => {
            console.log(`     ${idx + 1}. Cash amount: ${entry.cash_amount || 0} ${entry.currency || 'PLN'}`);
            console.log(`        Amount PLN: ${entry.amount_pln || 0}`);
            console.log(`        Category: ${entry.category_id}`);
            console.log(`        Cash payment ID: ${entry.cash_payment_id}`);
          });
        } else if (cashAmount > 0) {
          console.log('   ⚠️  ВНИМАНИЕ: cash_amount > 0, но нет cash записей в PNL!');
        }
      } else if (cashAmount > 0) {
        console.log('   ⚠️  ВНИМАНИЕ: cash_amount > 0, но нет записей в PNL!');
      }
    }

    // 5. Проверка расчетов остатков
    console.log('\n📋 Шаг 5: Проверка расчетов остатков...');
    const dealValue = parseFloat(deal.value) || 0;
    const dealCurrency = deal.currency || 'PLN';
    
    // Сумма Stripe платежей
    const totalStripePaid = (stripePayments || [])
      .filter(sp => sp.payment_status === 'paid')
      .reduce((sum, sp) => sum + (parseFloat(sp.amount_pln) || 0), 0);
    
    // Сумма cash платежей (только confirmed)
    const totalCashPaid = (cashPayments || [])
      .filter(cp => cp.status === 'received')
      .reduce((sum, cp) => sum + (parseFloat(cp.amount_pln) || parseFloat(cp.cash_received_amount) || 0), 0);
    
    const totalPaid = totalStripePaid + totalCashPaid;
    const remaining = dealValue - totalPaid;
    
    console.log(`   💰 Сумма сделки: ${dealValue} ${dealCurrency}`);
    console.log(`   💳 Оплачено Stripe: ${totalStripePaid.toFixed(2)} PLN`);
    console.log(`   💵 Оплачено Cash: ${totalCashPaid.toFixed(2)} PLN`);
    console.log(`   ✅ Всего оплачено: ${totalPaid.toFixed(2)} PLN`);
    console.log(`   📊 Остаток: ${remaining.toFixed(2)} PLN`);
    
    if (cashAmount > 0 && totalCashPaid === 0) {
      console.log('   ⚠️  ВНИМАНИЕ: cash_amount > 0, но cash платежи не подтверждены!');
    }

    // 6. Итоговый отчет
    console.log('\n' + '='.repeat(60));
    console.log('📊 ИТОГОВЫЙ ОТЧЕТ');
    console.log('='.repeat(60));
    
    const issues = [];
    
    if (cashAmount > 0 && (!cashPayments || cashPayments.length === 0)) {
      issues.push('❌ cash_amount > 0, но нет записей в cash_payments');
    }
    
    if (cashAmount > 0 && cashPayments && cashPayments.length > 0) {
      const hasReceived = cashPayments.some(cp => cp.status === 'received');
      if (!hasReceived) {
        issues.push('⚠️  cash_amount > 0, но нет подтвержденных cash платежей (status != received)');
      }
    }
    
    if (cashAmount > 0) {
      const hasCashPnl = pnlEntries && pnlEntries.some(e => e.cash_payment_id);
      if (!hasCashPnl) {
        issues.push('⚠️  cash_amount > 0, но нет записей в PNL с cash_payment_id');
      }
    }
    
    if (issues.length === 0) {
      console.log('✅ Все проверки пройдены успешно!');
    } else {
      console.log('⚠️  Обнаружены проблемы:');
      issues.forEach(issue => console.log(`   ${issue}`));
    }
    
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
