#!/usr/bin/env node

/**
 * Отладка: проверка структуры данных проформ и платежей
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function debugProformaPayments() {
  try {
    const pipedriveClient = new PipedriveClient();

    console.log('🔍 Отладка структуры данных проформ и платежей...\n');

    // Получаем несколько сделок с проформами
    const { data: proformas, error: proformasError } = await supabase
      .from('proformas')
      .select('*')
      .is('deleted_at', null)
      .limit(10)
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

    // Проверяем первые 5 проформ
    for (let i = 0; i < Math.min(5, proformas.length); i++) {
      const proforma = proformas[i];
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Проформа: ${proforma.fullnumber || proforma.id}`);
      console.log('='.repeat(80));
      console.log(`Deal ID: ${proforma.pipedrive_deal_id}`);
      console.log(`Сумма: ${proforma.total_amount || proforma.amount || 'N/A'}`);
      console.log(`Валюта: ${proforma.currency || 'N/A'}`);
      console.log(`Статус: ${proforma.status || 'N/A'}`);
      console.log(`Создана: ${proforma.created_at || 'N/A'}`);

      if (proforma.pipedrive_deal_id) {
        // Получаем данные сделки
        const dealResult = await pipedriveClient.getDealWithRelatedData(proforma.pipedrive_deal_id);
        if (dealResult && dealResult.success) {
          const deal = dealResult.deal;
          console.log(`\nСделка: ${deal.title}`);
          console.log(`Сумма сделки: ${deal.value} ${deal.currency || 'PLN'}`);
          console.log(`Начало лагеря: ${deal.expected_close_date || deal.close_date || 'N/A'}`);

          // Определяем график платежей
          const closeDate = deal.expected_close_date || deal.close_date;
          if (closeDate) {
            const expectedCloseDate = new Date(closeDate);
            const today = new Date();
            const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
            
            console.log(`Дней до начала лагеря: ${daysDiff}`);
            
            if (daysDiff >= 30) {
              const secondPaymentDate = new Date(expectedCloseDate);
              secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
              console.log(`График: 50/50`);
              console.log(`Дата второго платежа: ${secondPaymentDate.toISOString().split('T')[0]}`);
            } else {
              console.log(`График: 100%`);
            }
          }
        }

        // Получаем платежи для этой проформы
        const { data: payments, error: paymentsError } = await supabase
          .from('payments')
          .select('*')
          .eq('proforma_id', proforma.id)
          .neq('manual_status', 'rejected')
          .order('payment_date', { ascending: false });

        if (paymentsError) {
          console.log(`\n⚠️  Ошибка при получении платежей: ${paymentsError.message}`);
        } else {
          console.log(`\nПлатежей по проформе: ${payments ? payments.length : 0}`);
          
          if (payments && payments.length > 0) {
            const totalPaid = payments.reduce((sum, p) => {
              const amount = parseFloat(p.amount || 0);
              return sum + amount;
            }, 0);
            
            console.log(`Общая сумма платежей: ${totalPaid.toFixed(2)} ${proforma.currency || 'PLN'}`);
            
            payments.forEach((p, idx) => {
              console.log(`  ${idx + 1}. ${p.payment_date || 'N/A'}: ${p.amount} ${p.currency || proforma.currency || 'PLN'} (${p.payer_name || 'N/A'})`);
            });
          }
        }
      }
    }

  } catch (error) {
    logger.error('Ошибка при отладке:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

debugProformaPayments();
