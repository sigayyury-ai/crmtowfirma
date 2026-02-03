#!/usr/bin/env node

/**
 * Заполнение amount_pln для платежей, у которых это поле пустое
 * Использует currency_exchange из платежа или из связанной проформы
 */

require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function main() {
  console.log('🔍 Проверка и заполнение amount_pln для платежей\n');
  console.log('='.repeat(80));

  try {
    // 1. Находим платежи без amount_pln
    console.log('\n1️⃣ Поиск платежей без amount_pln:');
    console.log('-'.repeat(50));

    const { data: paymentsWithoutPln, error: findError } = await supabase
      .from('payments')
      .select('id, amount, currency, currency_exchange, proforma_id, operation_date')
      .is('amount_pln', null)
      .not('amount', 'is', null)
      .limit(1000);

    if (findError) {
      console.error('❌ Ошибка поиска платежей:', findError);
      process.exit(1);
    }

    if (!paymentsWithoutPln || paymentsWithoutPln.length === 0) {
      console.log('✅ Все платежи уже имеют amount_pln');
      return;
    }

    console.log(`⚠️  Найдено ${paymentsWithoutPln.length} платежей без amount_pln`);

    // 2. Загружаем проформы для получения курсов обмена
    const proformaIds = [...new Set(paymentsWithoutPln.map(p => p.proforma_id).filter(Boolean))];
    let proformasMap = new Map();

    if (proformaIds.length > 0) {
      const { data: proformas, error: proformasError } = await supabase
        .from('proformas')
        .select('id, currency_exchange, currency')
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

    console.log('\n2️⃣ Обработка платежей:');
    console.log('-'.repeat(50));

    for (const payment of paymentsWithoutPln) {
      try {
        const amount = Number(payment.amount);
        if (!Number.isFinite(amount) || amount === 0) {
          skipped++;
          continue;
        }

        const currency = (payment.currency || 'PLN').toUpperCase();
        let amountPln = null;

        // Если валюта PLN, используем amount как есть
        if (currency === 'PLN') {
          amountPln = amount;
        } else {
          // Пытаемся найти курс обмена
          let exchangeRate = null;

          // Сначала из самого платежа
          if (payment.currency_exchange) {
            exchangeRate = Number(payment.currency_exchange);
          }
          // Затем из проформы
          else if (payment.proforma_id) {
            const proforma = proformasMap.get(payment.proforma_id);
            if (proforma && proforma.currency_exchange) {
              exchangeRate = Number(proforma.currency_exchange);
            }
          }

          if (exchangeRate && Number.isFinite(exchangeRate) && exchangeRate > 0) {
            amountPln = Number((amount * exchangeRate).toFixed(2));
          } else {
            // Если курс не найден, пропускаем
            skipped++;
            console.log(`   ⏭️  Пропущен платеж ${payment.id}: нет курса обмена (валюта: ${currency})`);
            continue;
          }
        }

        // Обновляем платеж
        const { error: updateError } = await supabase
          .from('payments')
          .update({ amount_pln: amountPln })
          .eq('id', payment.id);

        if (updateError) {
          console.error(`   ❌ Ошибка обновления платежа ${payment.id}:`, updateError.message);
          errors++;
        } else {
          updated++;
          if (updated % 100 === 0) {
            console.log(`   ✅ Обновлено ${updated} платежей...`);
          }
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

    // 4. Проверяем результат
    if (updated > 0) {
      console.log('\n3️⃣ Проверка результата:');
      console.log('-'.repeat(50));

      const { data: remaining, error: checkError } = await supabase
        .from('payments')
        .select('id')
        .is('amount_pln', null)
        .not('amount', 'is', null)
        .limit(10);

      if (!checkError) {
        const remainingCount = remaining?.length || 0;
        if (remainingCount > 0) {
          console.log(`⚠️  Осталось ${remainingCount} платежей без amount_pln (возможно, нужны курсы обмена)`);
        } else {
          console.log('✅ Все платежи с суммой теперь имеют amount_pln');
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
