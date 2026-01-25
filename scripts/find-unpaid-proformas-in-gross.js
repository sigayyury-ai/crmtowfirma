#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const PRODUCT_ID = process.argv[2]; // Опционально: ID продукта для фильтрации

async function findUnpaidProformasInGross() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('\n🔍 Поиск проформ, которые в выручке, но не оплачены\n');
    logger.info('='.repeat(80));

    // Строим запрос для поиска проформ
    let query = supabase
      .from('proforma_products')
      .select(`
        id,
        proforma_id,
        product_id,
        quantity,
        unit_price,
        line_total,
        name,
        proformas!inner(
          id,
          fullnumber,
          total,
          currency,
          currency_exchange,
          payments_total_pln,
          payments_total,
          payments_currency_exchange,
          payments_count,
          issued_at,
          pipedrive_deal_id,
          buyer_name,
          buyer_alt_name
        ),
        products(
          id,
          name
        )
      `)
      .limit(10000); // Увеличиваем лимит

    // Если указан продукт, сначала проверим, есть ли вообще данные
    if (PRODUCT_ID) {
      const { count } = await supabase
        .from('proforma_products')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', PRODUCT_ID);
      logger.info(`Всего строк проформ для продукта ${PRODUCT_ID}: ${count || 0}`);
    }

    // Если указан продукт, фильтруем по нему
    if (PRODUCT_ID) {
      query = query.eq('product_id', PRODUCT_ID);
      logger.info(`Фильтр по продукту: ID ${PRODUCT_ID}`);
    }

    const { data: proformaProducts, error } = await query;

    if (error) {
      logger.error('Ошибка при поиске проформ:', error);
      process.exit(1);
    }

    if (!proformaProducts || proformaProducts.length === 0) {
      logger.info('Проформы не найдены');
      return;
    }

    logger.info(`Найдено строк проформ: ${proformaProducts.length}`);
    
    // Проверяем, сколько уникальных проформ
    const uniqueProformas = new Set(proformaProducts.map(p => p.proforma_id));
    logger.info(`Уникальных проформ: ${uniqueProformas.size}`);
    
    // Показываем примеры для отладки
    if (proformaProducts.length > 0 && proformaProducts.length <= 5) {
      logger.info('\nПримеры найденных строк:');
      proformaProducts.slice(0, 3).forEach((row, i) => {
        const p = row.proformas;
        logger.info(`  ${i + 1}. Проформа: ${p?.fullnumber || row.proforma_id}, line_total: ${row.line_total}, payments_total_pln: ${p?.payments_total_pln || 0}`);
      });
    }
    logger.info('');

    // Фильтруем проформы, которые не оплачены
    const unpaidProformas = [];
    const processedProformaIds = new Set();

    for (const row of proformaProducts) {
      const proforma = row.proformas;
      if (!proforma || processedProformaIds.has(proforma.id)) {
        continue; // Пропускаем уже обработанные проформы
      }
      processedProformaIds.add(proforma.id);

      // Вычисляем сумму строки в PLN
      const lineTotal = parseFloat(row.line_total) || 0;
      const currency = (proforma.currency || 'PLN').toUpperCase();
      const exchangeRate = parseFloat(proforma.currency_exchange) || (currency === 'PLN' ? 1 : null);
      
      let plnValue = 0;
      if (exchangeRate && currency !== 'PLN') {
        plnValue = lineTotal * exchangeRate;
      } else if (currency === 'PLN') {
        plnValue = lineTotal;
      }

      // Проверяем, оплачена ли проформа
      const paymentsTotalPln = parseFloat(proforma.payments_total_pln) || 0;
      const paymentsTotal = parseFloat(proforma.payments_total) || 0;
      const paymentsCount = parseInt(proforma.payments_count) || 0;

      // Вычисляем оплаченную сумму для этой строки (пропорционально)
      // Если у проформы несколько строк, распределяем оплату пропорционально
      const proformaTotal = parseFloat(proforma.total) || 0;
      let paidForThisLine = 0;
      
      if (proformaTotal > 0 && plnValue > 0) {
        // Пропорциональная доля оплаты для этой строки
        const lineShare = plnValue / (proformaTotal * (exchangeRate || 1));
        paidForThisLine = paymentsTotalPln * lineShare;
      } else if (proformaTotal === 0) {
        // Если total = 0, считаем что оплата распределена равномерно
        paidForThisLine = paymentsTotalPln;
      }

      // Проформа считается неоплаченной/недоплаченной, если:
      // 1. payments_total_pln = 0 или null (полностью не оплачена)
      // 2. Оплачено меньше суммы строки (частично оплачена)
      // 3. Или оплачено меньше total проформы (для проверки на уровне всей проформы)
      const proformaTotalPln = proformaTotal * (exchangeRate || 1);
      const isUnpaid = paymentsTotalPln === 0 
        || paidForThisLine < plnValue * 0.95 
        || paymentsTotalPln < proformaTotalPln * 0.95; // 95% порог

      if (isUnpaid) {
        unpaidProformas.push({
          proformaId: proforma.id,
          fullnumber: proforma.fullnumber,
          productName: row.products?.name || row.name || 'Без названия',
          productId: row.product_id,
          issuedAt: proforma.issued_at,
          dealId: proforma.pipedrive_deal_id,
          buyerName: proforma.buyer_name || proforma.buyer_alt_name || 'N/A',
          currency,
          lineTotal,
          plnValue,
          paidForThisLine,
          unpaidAmount: plnValue - paidForThisLine,
          proformaTotal,
          proformaTotalPln: proformaTotal * (exchangeRate || 1),
          paymentsTotalPln,
          paymentsTotal,
          paymentsCount,
          isFullyUnpaid: paymentsTotalPln === 0,
          unpaidAtProformaLevel: paymentsTotalPln < (proformaTotal * (exchangeRate || 1)) * 0.95
        });
      }
    }

    if (unpaidProformas.length === 0) {
      logger.info('✅ Все проформы оплачены или не имеют суммы в выручке');
      return;
    }

    logger.info(`\n⚠️  Найдено ${unpaidProformas.length} неоплаченных проформ, которые попадают в выручку:\n`);
    logger.info('-'.repeat(80));

    // Группируем по продуктам
    const byProduct = {};
    unpaidProformas.forEach(p => {
      const key = `${p.productId || 'no-id'}_${p.productName}`;
      if (!byProduct[key]) {
        byProduct[key] = {
          productId: p.productId,
          productName: p.productName,
          proformas: [],
          totalPln: 0
        };
      }
      byProduct[key].proformas.push(p);
      byProduct[key].totalPln += p.plnValue;
    });

    // Выводим результаты
    Object.values(byProduct).forEach((product, index) => {
      logger.info(`\n${index + 1}. Продукт: ${product.productName} (ID: ${product.productId || 'N/A'})`);
      logger.info(`   Всего неоплаченных проформ: ${product.proformas.length}`);
      logger.info(`   Сумма в выручке: ${product.totalPln.toFixed(2)} PLN`);
      logger.info(`\n   Детали:`);
      
      product.proformas.forEach((p, i) => {
        const status = p.isFullyUnpaid ? '❌ НЕ ОПЛАЧЕНА' : '⚠️  ЧАСТИЧНО ОПЛАЧЕНА';
        logger.info(`   ${i + 1}. Проформа: ${p.fullnumber || p.proformaId} [${status}]`);
        logger.info(`      Покупатель: ${p.buyerName}`);
        logger.info(`      Deal ID: ${p.dealId || 'N/A'}`);
        logger.info(`      Дата: ${p.issuedAt || 'N/A'}`);
        logger.info(`      Сумма строки в выручке: ${p.lineTotal.toFixed(2)} ${p.currency} (${p.plnValue.toFixed(2)} PLN)`);
        logger.info(`      Сумма всей проформы: ${p.proformaTotal.toFixed(2)} ${p.currency} (${p.proformaTotalPln.toFixed(2)} PLN)`);
        logger.info(`      Оплачено (всего по проформе): ${p.paymentsTotalPln.toFixed(2)} PLN (${p.paymentsCount} платежей)`);
        logger.info(`      Оплачено (за эту строку, оценка): ${p.paidForThisLine.toFixed(2)} PLN`);
        logger.info(`      Недоплачено (по строке): ${p.unpaidAmount.toFixed(2)} PLN`);
        if (p.unpaidAtProformaLevel) {
          logger.info(`      ⚠️  Недоплата на уровне проформы: ${(p.proformaTotalPln - p.paymentsTotalPln).toFixed(2)} PLN`);
        }
        logger.info('');
      });
    });

    // Итоговая статистика
    const totalUnpaidPln = unpaidProformas.reduce((sum, p) => sum + p.plnValue, 0);
    logger.info('\n' + '='.repeat(80));
    logger.info(`ИТОГО:`);
    logger.info(`  Неоплаченных проформ: ${unpaidProformas.length}`);
    logger.info(`  Сумма в выручке: ${totalUnpaidPln.toFixed(2)} PLN`);
    logger.info(`  Продуктов затронуто: ${Object.keys(byProduct).length}`);
    logger.info('='.repeat(80));

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findUnpaidProformasInGross()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Необработанная ошибка:', error);
    process.exit(1);
  });
