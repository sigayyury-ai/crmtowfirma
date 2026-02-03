#!/usr/bin/env node

/**
 * Заполнение amount_pln для платежей в EUR используя исторические курсы обмена
 */

require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

// Примерные курсы обмена EUR/PLN по датам (можно взять из API или проформ)
// Для точности лучше использовать реальные курсы из проформ или исторические данные
const EUR_RATES = {
  '2025-12': 4.35, // Примерный курс на декабрь 2025
  '2026-01': 4.32, // Примерный курс на январь 2026
};

function getExchangeRateForDate(dateString) {
  if (!dateString) return null;
  
  const date = new Date(dateString);
  const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  
  return EUR_RATES[yearMonth] || EUR_RATES['2026-01'] || 4.32; // Fallback к последнему известному курсу
}

async function main() {
  console.log('🔍 Заполнение amount_pln для платежей в EUR\n');
  console.log('='.repeat(80));

  try {
    // 1. Находим все платежи в EUR без amount_pln
    const { data: payments, error: findError } = await supabase
      .from('payments')
      .select('id, operation_date, amount, currency, currency_exchange, proforma_id, description')
      .eq('currency', 'EUR')
      .is('amount_pln', null)
      .not('amount', 'is', null)
      .limit(1000);

    if (findError) {
      console.error('❌ Ошибка поиска платежей:', findError);
      process.exit(1);
    }

    if (!payments || payments.length === 0) {
      console.log('✅ Все платежи в EUR уже имеют amount_pln');
      return;
    }

    console.log(`⚠️  Найдено ${payments.length} платежей в EUR без amount_pln\n`);

    // 2. Загружаем проформы для получения курсов обмена
    const proformaIds = [...new Set(payments.map(p => p.proforma_id).filter(Boolean))];
    let proformasMap = new Map();

    if (proformaIds.length > 0) {
      const { data: proformas, error: proformasError } = await supabase
        .from('proformas')
        .select('id, currency_exchange, currency, issued_at')
        .in('id', proformaIds);

      if (!proformasError && proformas) {
        proformas.forEach(p => {
          proformasMap.set(p.id, p);
        });
      }
    }

    // 3. Обрабатываем платежи
    let updated = 0;
    let errors = 0;
    let skipped = 0;

    console.log('2️⃣ Обработка платежей:');
    console.log('-'.repeat(80));

    for (const payment of payments) {
      try {
        const amount = Number(payment.amount);
        if (!Number.isFinite(amount) || amount === 0) {
          skipped++;
          continue;
        }

        let exchangeRate = null;

        // Сначала из самого платежа
        if (payment.currency_exchange) {
          exchangeRate = Number(payment.currency_exchange);
        }
        // Затем из проформы
        else if (payment.proforma_id && proformasMap.has(payment.proforma_id)) {
          const proforma = proformasMap.get(payment.proforma_id);
          if (proforma.currency_exchange) {
            exchangeRate = Number(proforma.currency_exchange);
          }
        }
        // Используем исторический курс по дате
        else if (payment.operation_date) {
          exchangeRate = getExchangeRateForDate(payment.operation_date);
          console.log(`   📅 Платеж ${payment.id}: используем исторический курс ${exchangeRate} для даты ${payment.operation_date}`);
        }

        if (!exchangeRate || !Number.isFinite(exchangeRate) || exchangeRate <= 0) {
          skipped++;
          console.log(`   ⏭️  Пропущен платеж ${payment.id}: нет курса обмена`);
          continue;
        }

        const amountPln = Number((amount * exchangeRate).toFixed(2));

        // Обновляем платеж
        const { error: updateError } = await supabase
          .from('payments')
          .update({ 
            amount_pln: amountPln,
            currency_exchange: exchangeRate // Сохраняем курс для будущего использования
          })
          .eq('id', payment.id);

        if (updateError) {
          console.error(`   ❌ Ошибка обновления платежа ${payment.id}:`, updateError.message);
          errors++;
        } else {
          updated++;
          console.log(`   ✅ Платеж ${payment.id}: ${amount} EUR → ${amountPln} PLN (курс: ${exchangeRate})`);
        }
      } catch (error) {
        console.error(`   ❌ Ошибка при обработке платежа ${payment.id}:`, error.message);
        errors++;
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Обработка завершена:`);
    console.log(`   Обновлено: ${updated}`);
    console.log(`   Пропущено: ${skipped}`);
    if (errors > 0) {
      console.log(`   Ошибок: ${errors}`);
    }

    // 4. Проверяем результат для продукта id-21
    if (updated > 0) {
      console.log(`\n3️⃣ Проверка результата для продукта id=21:`);
      console.log('-'.repeat(80));

      const { data: links21, error: linksError21 } = await supabase
        .from('payment_product_links')
        .select('payment_id')
        .eq('product_id', 21);

      if (!linksError21 && links21) {
        const paymentIds21 = links21.map(l => l.payment_id);
        const { data: payments21, error: paymentsError21 } = await supabase
          .from('payments')
          .select('id, amount, amount_pln, currency, direction')
          .in('id', paymentIds21)
          .eq('direction', 'out');

        if (!paymentsError21 && payments21) {
          const totalPln = payments21.reduce((sum, p) => {
            const amountPln = Number(p.amount_pln) || 0;
            return sum + amountPln;
          }, 0);

          const withPln = payments21.filter(p => p.amount_pln !== null).length;
          const withoutPln = payments21.filter(p => p.amount_pln === null).length;

          console.log(`   Всего исходящих платежей: ${payments21.length}`);
          console.log(`   С amount_pln: ${withPln}`);
          console.log(`   Без amount_pln: ${withoutPln}`);
          console.log(`   Сумма расходов: ${totalPln.toFixed(2)} PLN`);
        }
      }
    }

  } catch (error) {
    logger.error('❌ Ошибка выполнения:', error);
    console.error('❌ Ошибка выполнения:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
