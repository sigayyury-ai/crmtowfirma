#!/usr/bin/env node

/**
 * Анализ структуры данных проформ и платежей для понимания логики
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function analyzeStructure() {
  try {
    const pipedriveClient = new PipedriveClient();
    
    console.log('🔍 Анализ структуры данных проформ и платежей...\n');

    // Получаем проформы с платежами
    const { data: proformas, error: proformasError } = await supabase
      .from('proformas')
      .select('*')
      .is('deleted_at', null)
      .limit(50)
      .order('created_at', { ascending: false });

    if (proformasError) {
      console.error('❌ Ошибка при получении проформ:', proformasError);
      return;
    }

    console.log(`📋 Найдено проформ: ${proformas.length}\n`);

    if (proformas.length === 0) {
      console.log('⚠️  Нет проформ в базе данных');
      return;
    }

    // Анализируем все проформы
    let dealsWith5050 = 0;
    let dealsWithPayments = 0;
    let dealsWithFirstPaid = 0;
    const eligibleDeals = [];

    for (let i = 0; i < proformas.length; i++) {
      const proforma = proformas[i];
      
      if (!proforma.pipedrive_deal_id) {
        continue;
      }

      console.log(`\n${'='.repeat(80)}`);
      console.log(`Проформа: ${proforma.fullnumber || proforma.id}`);
      console.log(`Deal ID: ${proforma.pipedrive_deal_id}`);
      console.log(`Сумма проформы: ${proforma.total_amount || proforma.amount || 'N/A'}`);

      try {
        // Получаем данные сделки
        const dealResult = await pipedriveClient.getDealWithRelatedData(proforma.pipedrive_deal_id);
        if (!dealResult || !dealResult.success) {
          console.log(`⚠️  Сделка не найдена или удалена`);
          continue;
        }

        const deal = dealResult.deal;
        const closeDate = deal.expected_close_date || deal.close_date;
        
        if (!closeDate) {
          console.log(`⚠️  Нет даты начала лагеря`);
          continue;
        }

        const expectedCloseDate = new Date(closeDate);
        const today = new Date();
        const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));

        console.log(`Сделка: ${deal.title}`);
        console.log(`Сумма сделки: ${deal.value} ${deal.currency || 'PLN'}`);
        console.log(`Начало лагеря: ${closeDate}`);
        console.log(`Дней до начала лагеря: ${daysDiff}`);

        if (daysDiff >= 30) {
          dealsWith5050++;
          const secondPaymentDate = new Date(expectedCloseDate);
          secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
          
          console.log(`✅ График: 50/50`);
          console.log(`Дата второго платежа: ${secondPaymentDate.toISOString().split('T')[0]}`);

          // Получаем платежи
          const { data: payments, error: paymentsError } = await supabase
            .from('payments')
            .select('*')
            .eq('proforma_id', proforma.id)
            .neq('manual_status', 'rejected')
            .order('payment_date', { ascending: true });

          if (paymentsError) {
            console.log(`⚠️  Ошибка при получении платежей: ${paymentsError.message}`);
            continue;
          }

          if (payments && payments.length > 0) {
            dealsWithPayments++;
            
            const totalPaid = payments.reduce((sum, p) => {
              const amount = parseFloat(p.amount || 0);
              return sum + amount;
            }, 0);

            const dealValue = parseFloat(deal.value) || 0;
            const expectedFirstPayment = dealValue / 2;
            const expectedSecondPayment = dealValue / 2;

            console.log(`\nПлатежей: ${payments.length}`);
            console.log(`Общая сумма платежей: ${totalPaid.toFixed(2)} ${proforma.currency || deal.currency || 'PLN'}`);
            console.log(`Ожидаемый первый платеж: ${expectedFirstPayment.toFixed(2)}`);
            console.log(`Ожидаемый второй платеж: ${expectedSecondPayment.toFixed(2)}`);

            payments.forEach((p, idx) => {
              const paymentDate = p.payment_date ? new Date(p.payment_date).toISOString().split('T')[0] : 'N/A';
              console.log(`  ${idx + 1}. ${paymentDate}: ${p.amount} ${p.currency || proforma.currency || 'PLN'} (${p.payer_name || 'N/A'})`);
            });

            // Определяем статус платежей
            const firstPaymentPaid = totalPaid >= expectedFirstPayment * 0.9;
            const secondPaymentPaid = totalPaid >= dealValue * 0.9;

            console.log(`\nСтатус:`);
            console.log(`  Первый платеж оплачен: ${firstPaymentPaid ? '✅' : '❌'} (${totalPaid.toFixed(2)} из ${expectedFirstPayment.toFixed(2)})`);
            console.log(`  Второй платеж оплачен: ${secondPaymentPaid ? '✅' : '❌'} (${totalPaid.toFixed(2)} из ${dealValue.toFixed(2)})`);

            if (firstPaymentPaid && !secondPaymentPaid) {
              dealsWithFirstPaid++;
              const daysUntil = Math.ceil((secondPaymentDate - today) / (1000 * 60 * 60 * 24));
              console.log(`\n🔔 ТРЕБУЕТСЯ ВТОРОЙ ПЛАТЕЖ!`);
              console.log(`   Дата второго платежа: ${secondPaymentDate.toISOString().split('T')[0]}`);
              console.log(`   Дней до платежа: ${daysUntil}`);
              
              eligibleDeals.push({
                dealId: deal.id,
                dealTitle: deal.title,
                proformaNumber: proforma.fullnumber,
                secondPaymentDate: secondPaymentDate.toISOString().split('T')[0],
                daysUntil,
                totalPaid,
                expectedSecondPayment: expectedSecondPayment,
                currency: deal.currency || 'PLN'
              });
            }
          } else {
            console.log(`\n⚠️  Нет платежей по проформе`);
          }
        } else {
          console.log(`График: 100% (менее 30 дней)`);
        }
      } catch (error) {
        logger.warn(`Ошибка при обработке Deal #${proforma.pipedrive_deal_id}`, { error: error.message });
        console.log(`⚠️  Ошибка: ${error.message}`);
      }
    }

    console.log(`\n\n${'='.repeat(80)}`);
    console.log('📊 СТАТИСТИКА ПО ВСЕМ ПРОФОРМАМ:');
    console.log('='.repeat(80));
    console.log(`Всего проформ проверено: ${proformas.length}`);
    console.log(`С графиком 50/50: ${dealsWith5050}`);
    console.log(`С платежами: ${dealsWithPayments}`);
    console.log(`С оплаченным первым платежом (требуют второй): ${dealsWithFirstPaid}`);

    if (eligibleDeals.length > 0) {
      console.log(`\n\n${'='.repeat(80)}`);
      console.log('🔔 СДЕЛКИ, ТРЕБУЮЩИЕ ВТОРОГО ПЛАТЕЖА:');
      console.log('='.repeat(80));
      
      eligibleDeals.sort((a, b) => a.daysUntil - b.daysUntil);
      
      eligibleDeals.forEach((deal, idx) => {
        console.log(`\n${idx + 1}. Deal #${deal.dealId}: ${deal.dealTitle}`);
        console.log(`   Проформа: ${deal.proformaNumber}`);
        console.log(`   Дата второго платежа: ${deal.secondPaymentDate}`);
        console.log(`   Дней до платежа: ${deal.daysUntil}`);
        console.log(`   Остаток: ${deal.expectedSecondPayment.toFixed(2)} ${deal.currency}`);
        console.log(`   Оплачено: ${deal.totalPaid.toFixed(2)} ${deal.currency}`);
        console.log(`   🔗 Сделка: https://comoon.pipedrive.com/deal/${deal.dealId}`);
      });
    }

  } catch (error) {
    logger.error('Ошибка при анализе:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

analyzeStructure();
