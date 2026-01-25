#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const supabase = require('../src/services/supabaseClient');
const Stripe = require('stripe');

const DEAL_ID = process.argv[2] || '1819';

async function findPaymentByEmail() {
  console.log(`\n🔍 Поиск платежей для сделки #${DEAL_ID} по email клиента\n`);
  console.log('='.repeat(80));
  
  try {
    // 1. Получаем данные сделки и email клиента
    const pipedriveClient = new PipedriveClient();
    const dealResult = await pipedriveClient.getDealWithRelatedData(DEAL_ID);
    
    if (!dealResult.success || !dealResult.deal) {
      console.error(`❌ Сделка #${DEAL_ID} не найдена`);
      process.exit(1);
    }
    
    const deal = dealResult.deal;
    const person = dealResult.person;
    const customerEmail = person?.email?.[0]?.value || person?.email || null;
    const customerName = person?.name || 'N/A';
    
    console.log(`\n📋 Информация о клиенте:`);
    console.log(`   Имя: ${customerName}`);
    console.log(`   Email: ${customerEmail || 'не указан'}`);
    console.log(`   Сумма сделки: ${deal.value} ${deal.currency}`);
    
    if (!customerEmail) {
      console.error(`\n❌ Email клиента не найден. Невозможно искать платежи по email.`);
      process.exit(1);
    }
    
    // 2. Поиск в базе данных по deal_id
    console.log(`\n1️⃣ Поиск в базе данных по deal_id=${DEAL_ID}:`);
    console.log('-'.repeat(50));
    
    const repository = new StripeRepository();
    const dbPayments = await repository.listPayments({
      dealId: String(DEAL_ID),
      limit: 100
    });
    
    if (dbPayments.length > 0) {
      console.log(`✅ Найдено ${dbPayments.length} платежей в базе данных:`);
      dbPayments.forEach((p, i) => {
        console.log(`  ${i + 1}. ID: ${p.id}`);
        console.log(`     Session ID: ${p.session_id || 'N/A'}`);
        console.log(`     Тип: ${p.payment_type || 'N/A'}`);
        console.log(`     Статус: ${p.payment_status || 'N/A'}`);
        console.log(`     Сумма: ${p.amount || 0} ${p.currency || 'N/A'}`);
        console.log(`     Создан: ${p.created_at || 'N/A'}`);
        console.log(`     Обработан: ${p.processed_at || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log(`❌ Платежи в базе данных не найдены`);
    }
    
    // 3. Поиск в Stripe по email
    console.log(`\n2️⃣ Поиск в Stripe по email=${customerEmail}:`);
    console.log('-'.repeat(50));
    
    const stripe = new Stripe(process.env.STRIPE_API_KEY);
    
    // Ищем клиентов по email
    const customers = await stripe.customers.list({
      email: customerEmail,
      limit: 10
    });
    
    if (customers.data.length > 0) {
      console.log(`✅ Найдено ${customers.data.length} клиентов в Stripe:`);
      
      for (const customer of customers.data) {
        console.log(`\n   Клиент ID: ${customer.id}`);
        console.log(`   Email: ${customer.email}`);
        console.log(`   Имя: ${customer.name || 'N/A'}`);
        console.log(`   Создан: ${new Date(customer.created * 1000).toISOString()}`);
        
        // Ищем платежи для этого клиента
        const paymentIntents = await stripe.paymentIntents.list({
          customer: customer.id,
          limit: 20
        });
        
        if (paymentIntents.data.length > 0) {
          console.log(`   Найдено ${paymentIntents.data.length} Payment Intents:`);
          paymentIntents.data.forEach((pi, i) => {
            console.log(`     ${i + 1}. ID: ${pi.id}`);
            console.log(`        Сумма: ${pi.amount / 100} ${pi.currency.toUpperCase()}`);
            console.log(`        Статус: ${pi.status}`);
            console.log(`        Создан: ${new Date(pi.created * 1000).toISOString()}`);
            if (pi.metadata && pi.metadata.deal_id) {
              console.log(`        Deal ID в metadata: ${pi.metadata.deal_id}`);
            }
            console.log('');
          });
        }
        
        // Ищем Checkout Sessions
        const sessions = await stripe.checkout.sessions.list({
          customer: customer.id,
          limit: 20
        });
        
        if (sessions.data.length > 0) {
          console.log(`   Найдено ${sessions.data.length} Checkout Sessions:`);
          sessions.data.forEach((session, i) => {
            console.log(`     ${i + 1}. Session ID: ${session.id}`);
            console.log(`        Сумма: ${session.amount_total ? session.amount_total / 100 : 'N/A'} ${session.currency ? session.currency.toUpperCase() : 'N/A'}`);
            console.log(`        Статус: ${session.payment_status || 'N/A'}`);
            console.log(`        Создан: ${new Date(session.created * 1000).toISOString()}`);
            if (session.metadata && session.metadata.deal_id) {
              console.log(`        Deal ID в metadata: ${session.metadata.deal_id}`);
            }
            if (session.payment_status === 'paid') {
              console.log(`        ✅ ОПЛАЧЕНО`);
            }
            console.log('');
          });
        }
      }
    } else {
      console.log(`❌ Клиенты в Stripe не найдены по email ${customerEmail}`);
    }
    
    // 4. Поиск Checkout Sessions по deal_id в metadata
    console.log(`\n3️⃣ Поиск Checkout Sessions по deal_id=${DEAL_ID} в metadata:`);
    console.log('-'.repeat(50));
    
    const allSessions = await stripe.checkout.sessions.list({
      limit: 100
    });
    
    const dealSessions = allSessions.data.filter(s => {
      if (!s.metadata) return false;
      return s.metadata.deal_id === String(DEAL_ID) || s.metadata.dealId === String(DEAL_ID);
    });
    
    if (dealSessions.length > 0) {
      console.log(`✅ Найдено ${dealSessions.length} сессий с deal_id=${DEAL_ID}:`);
      dealSessions.forEach((session, i) => {
        console.log(`  ${i + 1}. Session ID: ${session.id}`);
        console.log(`     Сумма: ${session.amount_total ? session.amount_total / 100 : 'N/A'} ${session.currency ? session.currency.toUpperCase() : 'N/A'}`);
        console.log(`     Статус: ${session.payment_status || 'N/A'}`);
        console.log(`     Создан: ${new Date(session.created * 1000).toISOString()}`);
        console.log(`     URL: https://dashboard.stripe.com/checkout_sessions/${session.id}`);
        if (session.payment_status === 'paid') {
          console.log(`     ✅ ОПЛАЧЕНО`);
        }
        console.log('');
      });
    } else {
      console.log(`❌ Сессии с deal_id=${DEAL_ID} не найдены`);
    }
    
    // 5. Проверка проформ
    console.log(`\n4️⃣ Поиск проформ для сделки #${DEAL_ID}:`);
    console.log('-'.repeat(50));
    
    const { data: proformas, error: proformaError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', DEAL_ID)
      .order('issued_at', { ascending: false });
    
    if (proformaError) {
      console.error(`❌ Ошибка поиска проформ:`, proformaError);
    } else if (proformas && proformas.length > 0) {
      console.log(`✅ Найдено ${proformas.length} проформ:`);
      proformas.forEach((p, i) => {
        console.log(`  ${i + 1}. Номер: ${p.fullnumber || p.id}`);
        console.log(`     Сумма: ${p.total} ${p.currency || 'PLN'}`);
        console.log(`     Выдана: ${p.issued_at || 'N/A'}`);
        console.log(`     Статус: ${p.status || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log(`❌ Проформы не найдены`);
    }
    
    // 6. Проверка платежей по проформам
    if (proformas && proformas.length > 0) {
      console.log(`\n5️⃣ Поиск платежей по проформам:`);
      console.log('-'.repeat(50));
      
      const proformaIds = proformas.map(p => p.id);
      const { data: proformaPayments, error: paymentError } = await supabase
        .from('payments')
        .select('*')
        .in('proforma_id', proformaIds)
        .order('operation_date', { ascending: false });
      
      if (paymentError) {
        console.error(`❌ Ошибка поиска платежей:`, paymentError);
      } else if (proformaPayments && proformaPayments.length > 0) {
        console.log(`✅ Найдено ${proformaPayments.length} платежей по проформам:`);
        proformaPayments.forEach((p, i) => {
          console.log(`  ${i + 1}. ID: ${p.id}`);
          console.log(`     Сумма: ${p.amount} ${p.currency || 'PLN'}`);
          console.log(`     Дата: ${p.operation_date || 'N/A'}`);
          console.log(`     Источник: ${p.source || 'N/A'}`);
          console.log(`     Статус: ${p.manual_status || 'N/A'}`);
          console.log('');
        });
      } else {
        console.log(`❌ Платежи по проформам не найдены`);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

findPaymentByEmail()
  .then(() => {
    console.log('\n' + '='.repeat(80));
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Необработанная ошибка:', error);
    process.exit(1);
  });





