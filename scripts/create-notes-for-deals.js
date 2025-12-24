#!/usr/bin/env node

/**
 * Скрипт для создания заметок в Pipedrive для сделок со Stripe платежами
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeProcessorService = require('../src/services/stripe/processor');
const StripeRepository = require('../src/services/stripe/repository');
const { getStripeClient } = require('../src/services/stripe/client');
const logger = require('../src/utils/logger');

function buildStripeSearchUrl(query) {
  const stripeMode = (process.env.STRIPE_MODE || 'test').toLowerCase();
  const baseUrl = stripeMode === 'live'
    ? 'https://dashboard.stripe.com'
    : 'https://dashboard.stripe.com/test';
  const accountSegment = process.env.STRIPE_DASHBOARD_ACCOUNT_PATH ? `/${process.env.STRIPE_DASHBOARD_ACCOUNT_PATH}` : '';
  const workspaceSegment = process.env.STRIPE_DASHBOARD_WORKSPACE_ID
    ? `&search_context_id=${encodeURIComponent(process.env.STRIPE_DASHBOARD_WORKSPACE_ID)}`
    : '';
  return `${baseUrl}${accountSegment}/search?query=${encodeURIComponent(query)}${workspaceSegment}`;
}

async function createNotesForDeals(dealIds) {
  try {
    const processor = new StripeProcessorService();
    const repository = new StripeRepository();
    const stripe = getStripeClient();

    for (const dealId of dealIds) {
      try {
        console.log(`\n🔍 Обработка Deal #${dealId}...\n`);

        // Получаем данные сделки
        const dealResult = await processor.pipedriveClient.getDealWithRelatedData(dealId);
        if (!dealResult || !dealResult.success) {
          console.log(`   ❌ Не удалось получить данные сделки: ${dealResult?.error || 'unknown'}`);
          continue;
        }

        const deal = dealResult.deal;
        const currency = deal.currency || 'PLN';
        const totalAmount = parseFloat(deal.value) || 0;

        console.log(`   Название: ${deal.title}`);
        console.log(`   Сумма: ${totalAmount} ${currency}`);

        // Получаем все платежи для сделки
        let allPayments = [];
        if (repository.isEnabled()) {
          allPayments = await repository.listPayments({
            dealId: String(dealId),
            limit: 100
          });
        }

        // Если платежей нет в базе, ищем сессии напрямую в Stripe
        let stripeSessions = [];
        if (allPayments.length === 0) {
          console.log('   🔍 Поиск сессий напрямую в Stripe...');
          
          const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
          
          let hasMore = true;
          let startingAfter = null;
          
          while (hasMore) {
            const params = {
              limit: 100,
              created: { gte: thirtyDaysAgo }
            };
            
            if (startingAfter) {
              params.starting_after = startingAfter;
            }
            
            const sessionsList = await stripe.checkout.sessions.list(params);
            
            for (const session of sessionsList.data) {
              const sessionDealId = session.metadata?.deal_id || session.metadata?.dealId;
              if (sessionDealId === String(dealId) && session.status === 'open') {
                const amount = session.amount_total ? (session.amount_total / 100) : 0;
                const sessionCurrency = session.currency?.toUpperCase() || 'PLN';
                
                stripeSessions.push({
                  id: session.id,
                  url: session.url,
                  amount: amount,
                  currency: sessionCurrency,
                  type: session.metadata?.payment_type || 'single'
                });
              }
            }
            
            hasMore = sessionsList.has_more;
            if (sessionsList.data.length > 0) {
              startingAfter = sessionsList.data[sessionsList.data.length - 1].id;
            } else {
              hasMore = false;
            }
          }
        }

        // Определяем график платежей
        const closeDate = deal.expected_close_date || deal.close_date;
        let paymentSchedule = '100%';
        
        if (closeDate) {
          const expectedCloseDate = new Date(closeDate);
          const today = new Date();
          const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
          
          if (daysDiff >= 30) {
            paymentSchedule = '50/50';
          }
        }

        console.log(`   График платежей: ${paymentSchedule}`);
        console.log(`   Найдено сессий: ${allPayments.length + stripeSessions.length}`);

        // Формируем заметку
        const formatAmount = (amount) => parseFloat(amount).toFixed(2);
        const stripeMode = process.env.STRIPE_MODE || 'test';
        const stripeBaseUrl = stripeMode === 'live' 
          ? 'https://dashboard.stripe.com' 
          : 'https://dashboard.stripe.com/test';
        
        let noteContent = `💳 *График платежей: ${paymentSchedule}*\n\n`;
        
        // Используем сессии из базы или из Stripe
        const sessions = allPayments.length > 0 
          ? allPayments.map(p => ({
              id: p.session_id,
              type: p.payment_type,
              amount: p.original_amount || p.amount
            }))
          : stripeSessions;

        if (paymentSchedule === '50/50' && sessions.length === 1) {
          // Только первый платеж (deposit) создан
          const firstSession = sessions[0];
          noteContent += `1️⃣ *Предоплата 50%:* ${formatAmount(firstSession.amount)} ${currency}\n`;
          noteContent += `   [Мониторинг статуса](${stripeBaseUrl}/checkout_sessions/${firstSession.id})\n\n`;
          noteContent += `2️⃣ *Остаток 50%:* будет создан позже\n\n`;
        } else if (paymentSchedule === '50/50' && sessions.length >= 2) {
          // Оба платежа созданы
          const depositSession = sessions.find(s => s.type === 'deposit');
          const restSession = sessions.find(s => s.type === 'rest');
          
          if (depositSession) {
            noteContent += `1️⃣ *Предоплата 50%:* ${formatAmount(depositSession.amount)} ${currency}\n`;
            noteContent += `   [Мониторинг статуса](${stripeBaseUrl}/checkout_sessions/${depositSession.id})\n\n`;
          }
          
          if (restSession) {
            noteContent += `2️⃣ *Остаток 50%:* ${formatAmount(restSession.amount)} ${currency}\n`;
            noteContent += `   [Мониторинг статуса](${stripeBaseUrl}/checkout_sessions/${restSession.id})\n\n`;
          }
        } else if (paymentSchedule === '100%' && sessions.length >= 1) {
          const singleSession = sessions[0];
          noteContent += `💳 *Полная оплата:* ${formatAmount(singleSession.amount)} ${currency}\n`;
          noteContent += `   [Мониторинг статуса](${stripeBaseUrl}/checkout_sessions/${singleSession.id})\n\n`;
        }
        
        noteContent += `*Итого:* ${formatAmount(totalAmount)} ${currency}\n\n`;
        const searchLink = buildStripeSearchUrl(String(dealId));
        noteContent += `📊 [Мониторинг всех платежей по сделке](${searchLink})\n`;

        // Создаем заметку
        const noteResult = await processor.pipedriveClient.addNoteToDeal(dealId, noteContent);
        
        if (noteResult.success) {
          console.log(`   ✅ Заметка создана в Pipedrive`);
        } else {
          console.log(`   ❌ Ошибка создания заметки: ${noteResult.error}`);
        }

      } catch (error) {
        logger.error('Error creating note for deal', { dealId, error: error.message });
        console.log(`   ❌ Ошибка: ${error.message}`);
      }
    }

    console.log(`\n✅ Обработка завершена\n`);

  } catch (error) {
    logger.error('Error creating notes', { error: error.message });
    console.error(`❌ Критическая ошибка: ${error.message}`);
    process.exit(1);
  }
}

// Получаем dealIds из аргументов командной строки
const dealIds = process.argv.slice(2);
if (dealIds.length === 0) {
  console.error('❌ Укажите dealIds: node scripts/create-notes-for-deals.js <dealId1> <dealId2> ...');
  process.exit(1);
}

createNotesForDeals(dealIds);

