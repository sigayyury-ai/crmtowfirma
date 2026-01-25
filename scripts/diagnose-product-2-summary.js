#!/usr/bin/env node

/**
 * Диагностика изменений в сводном отчете для product id=2
 * Проверяет источники данных и суммы
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');
const ProductReportService = require('../src/services/vatMargin/productReportService');

if (!supabase) {
  console.error('❌ Supabase client is not configured.');
  process.exit(1);
}

async function diagnoseProduct2Summary() {
  console.log('🔍 Диагностика сводного отчета для product id=2\n');
  console.log('='.repeat(80));

  try {
    const PRODUCT_ID = 2;

    // 1. Получаем информацию о продукте
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, normalized_name, calculation_status, calculation_due_month')
      .eq('id', PRODUCT_ID)
      .single();

    if (productError || !product) {
      console.error('❌ Продукт id=2 не найден');
      return;
    }

    console.log(`✅ Продукт: ${product.name} (id=${product.id})`);
    console.log(`   Normalized name: ${product.normalized_name || 'N/A'}`);
    console.log(`   Status: ${product.calculation_status || 'N/A'}`);
    console.log('');

    // 2. Находим product_link для продукта 2
    const { data: productLinks, error: plError } = await supabase
      .from('product_links')
      .select('*')
      .or(`crm_product_id.eq.${PRODUCT_ID},camp_product_id.eq.${PRODUCT_ID}`)
      .limit(10);

    if (plError) {
      console.error('❌ Ошибка загрузки product_links:', plError);
      return;
    }

    console.log(`📋 Product links для продукта ${PRODUCT_ID}: ${productLinks?.length || 0}`);
    if (productLinks && productLinks.length > 0) {
      productLinks.forEach((pl, idx) => {
        console.log(`   ${idx + 1}. ID: ${pl.id}`);
        console.log(`      CRM Product ID: ${pl.crm_product_id || 'N/A'}`);
        console.log(`      Camp Product ID: ${pl.camp_product_id || 'N/A'}`);
        console.log(`      CRM Product Name: ${pl.crm_product_name || 'N/A'}`);
      });
    }
    console.log('');

    // 3. Проверяем Stripe платежи
    const productLinkIds = productLinks?.map(pl => pl.id) || [];
    let stripePayments = [];
    let stripeTotalPln = 0;
    let stripeCount = 0;

    if (productLinkIds.length > 0) {
      const { data: spData, error: spError } = await supabase
        .from('stripe_payments')
        .select('id, session_id, deal_id, product_id, amount_pln, currency, created_at, processed_at, payment_status')
        .in('product_id', productLinkIds)
        .eq('payment_status', 'paid')
        .order('processed_at', { ascending: false });

      if (spError) {
        console.error('⚠️  Ошибка загрузки Stripe платежей:', spError.message);
      } else {
        stripePayments = spData || [];
        stripeCount = stripePayments.length;
        stripeTotalPln = stripePayments.reduce((sum, p) => sum + (Number(p.amount_pln) || 0), 0);
      }
    }

    console.log(`💳 Stripe платежи:`);
    console.log(`   Количество: ${stripeCount}`);
    console.log(`   Сумма (PLN): ${stripeTotalPln.toFixed(2)}`);
    if (stripePayments.length > 0) {
      const recentPayments = stripePayments.slice(0, 5);
      console.log(`   Последние платежи:`);
      recentPayments.forEach((p, idx) => {
        const date = p.processed_at ? new Date(p.processed_at).toISOString().split('T')[0] : 'N/A';
        console.log(`      ${idx + 1}. ${p.amount_pln} PLN, ${date}, Deal: ${p.deal_id || 'N/A'}`);
      });
    }
    console.log('');

    // 4. Проверяем проформы
    const { data: proformaProducts, error: ppError } = await supabase
      .from('proforma_products')
      .select(`
        proforma_id,
        product_id,
        quantity,
        unit_price,
        line_total,
        proformas (
          id,
          fullnumber,
          issued_at,
          currency,
          total,
          currency_exchange,
          payments_total_pln,
          pipedrive_deal_id,
          status
        )
      `)
      .eq('product_id', PRODUCT_ID)
      .eq('proformas.status', 'active');

    if (ppError) {
      console.error('⚠️  Ошибка загрузки проформ:', ppError.message);
    }

    const proformas = (proformaProducts || [])
      .filter(pp => pp.proformas && pp.proformas.id)
      .map(pp => pp.proformas);

    const uniqueProformas = Array.from(new Map(proformas.map(p => [p.id, p])).values());

    let proformaTotalPln = 0;
    let proformaPaidPln = 0;
    let proformaCount = uniqueProformas.length;

    uniqueProformas.forEach(proforma => {
      const currency = (proforma.currency || 'PLN').toUpperCase();
      const total = Number(proforma.total) || 0;
      const exchangeRate = Number(proforma.currency_exchange) || (currency === 'PLN' ? 1 : 0);
      const totalPln = total * exchangeRate;
      const paidPln = Number(proforma.payments_total_pln) || 0;

      proformaTotalPln += totalPln;
      proformaPaidPln += Math.min(paidPln, totalPln);
    });

    console.log(`📄 Проформы:`);
    console.log(`   Количество: ${proformaCount}`);
    console.log(`   Сумма (PLN): ${proformaTotalPln.toFixed(2)}`);
    console.log(`   Оплачено (PLN): ${proformaPaidPln.toFixed(2)}`);
    if (uniqueProformas.length > 0) {
      const recentProformas = uniqueProformas
        .sort((a, b) => (b.issued_at || '').localeCompare(a.issued_at || ''))
        .slice(0, 5);
      console.log(`   Последние проформы:`);
      recentProformas.forEach((p, idx) => {
        const date = p.issued_at ? new Date(p.issued_at).toISOString().split('T')[0] : 'N/A';
        const total = Number(p.total) || 0;
        const exchangeRate = Number(p.currency_exchange) || 1;
        const totalPln = total * exchangeRate;
        console.log(`      ${idx + 1}. ${p.fullnumber || 'N/A'}, ${totalPln.toFixed(2)} PLN, ${date}, Deal: ${p.pipedrive_deal_id || 'N/A'}`);
      });
    }
    console.log('');

    // 5. Получаем сводку через ProductReportService
    console.log('📊 Сводка через ProductReportService:');
    const productReportService = new ProductReportService();
    const summary = await productReportService.getProductSummary({ includeStripeData: true });
    
    const productSummary = summary.find(p => p.productId === PRODUCT_ID);
    
    if (productSummary) {
      console.log(`   Product ID: ${productSummary.productId}`);
      console.log(`   Product Name: ${productSummary.productName}`);
      console.log(`   Proforma Count: ${productSummary.proformaCount}`);
      console.log(`   Totals:`);
      console.log(`      Gross PLN: ${productSummary.totals.grossPln.toFixed(2)}`);
      console.log(`      Paid PLN: ${productSummary.totals.paidPln.toFixed(2)}`);
      console.log(`      Net PLN: ${productSummary.totals.netPln.toFixed(2)}`);
      console.log(`      Margin PLN: ${productSummary.totals.marginPln.toFixed(2)}`);
      if (productSummary.stripeTotals) {
        console.log(`   Stripe Totals:`);
        console.log(`      Payments Count: ${productSummary.stripeTotals.paymentsCount}`);
        console.log(`      Gross PLN: ${productSummary.stripeTotals.grossPln.toFixed(2)}`);
        console.log(`      Tax PLN: ${productSummary.stripeTotals.taxPln.toFixed(2)}`);
      }
      if (productSummary.combinedTotals) {
        console.log(`   Combined Totals:`);
        console.log(`      Gross PLN: ${productSummary.combinedTotals.grossPln.toFixed(2)}`);
      }
    } else {
      console.log('   ⚠️  Продукт не найден в сводке');
    }
    console.log('');

    // 6. Сравнение
    console.log('🔍 Сравнение источников:');
    console.log(`   Проформы (gross): ${proformaTotalPln.toFixed(2)} PLN`);
    console.log(`   Проформы (paid): ${proformaPaidPln.toFixed(2)} PLN`);
    console.log(`   Stripe платежи: ${stripeTotalPln.toFixed(2)} PLN`);
    if (productSummary) {
      console.log(`   Сводка (gross): ${productSummary.totals.grossPln.toFixed(2)} PLN`);
      console.log(`   Сводка (paid): ${productSummary.totals.paidPln.toFixed(2)} PLN`);
      if (productSummary.combinedTotals) {
        console.log(`   Сводка (combined): ${productSummary.combinedTotals.grossPln.toFixed(2)} PLN`);
      }
      
      const expectedGross = proformaTotalPln + stripeTotalPln;
      const diffGross = Math.abs(productSummary.totals.grossPln - expectedGross);
      console.log(`   Ожидаемая gross (проформы + Stripe): ${expectedGross.toFixed(2)} PLN`);
      console.log(`   Разница: ${diffGross.toFixed(2)} PLN`);
      
      if (diffGross > 0.01) {
        console.log(`   ⚠️  ВНИМАНИЕ: Есть расхождение в суммах!`);
      }
    }

    // 7. Проверяем возможные дубликаты (Stripe платежи, которые могут быть учтены и в проформах)
    console.log('');
    console.log('🔍 Проверка возможных дубликатов:');
    if (stripePayments.length > 0 && uniqueProformas.length > 0) {
      const dealIdsFromStripe = new Set(stripePayments.map(sp => sp.deal_id).filter(Boolean));
      const dealIdsFromProformas = new Set(uniqueProformas.map(p => p.pipedrive_deal_id).filter(Boolean));
      
      const commonDealIds = Array.from(dealIdsFromStripe).filter(did => dealIdsFromProformas.has(did));
      
      if (commonDealIds.length > 0) {
        console.log(`   ⚠️  Найдено ${commonDealIds.length} общих deal_id между Stripe платежами и проформами:`);
        commonDealIds.slice(0, 10).forEach(dealId => {
          const stripeForDeal = stripePayments.filter(sp => sp.deal_id === dealId);
          const proformasForDeal = uniqueProformas.filter(p => p.pipedrive_deal_id === dealId);
          const stripeSum = stripeForDeal.reduce((s, p) => s + (Number(p.amount_pln) || 0), 0);
          const proformaSum = proformasForDeal.reduce((s, p) => {
            const total = Number(p.total) || 0;
            const exchangeRate = Number(p.currency_exchange) || 1;
            return s + (total * exchangeRate);
          }, 0);
          console.log(`      Deal ${dealId}: Stripe=${stripeSum.toFixed(2)} PLN, Proformas=${proformaSum.toFixed(2)} PLN`);
        });
        console.log(`   💡 Это может означать, что одни и те же платежи учитываются дважды!`);
      } else {
        console.log(`   ✅ Общих deal_id не найдено - дубликатов нет`);
      }
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ Диагностика завершена');

  } catch (error) {
    console.error('❌ Ошибка выполнения:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  diagnoseProduct2Summary();
}
