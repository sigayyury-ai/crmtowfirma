require('dotenv').config();

const PipedriveClient = require('../src/services/pipedrive');
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

/**
 * Анализ сделки 1680 и связанных Stripe платежей
 * Проверяет:
 * - Информацию о сделке
 * - Все Stripe сессии и платежи
 * - Напоминания (reminders)
 * - Логи отправки уведомлений
 */

async function analyzeDeal1680() {
  const dealId = 1680;

  console.log('='.repeat(80));
  console.log(`🔍 АНАЛИЗ СДЕЛКИ ${dealId}`);
  console.log('='.repeat(80));

  try {
    // 1. Получаем информацию о сделке
    console.log('\n📋 1. ИНФОРМАЦИЯ О СДЕЛКЕ');
    console.log('-'.repeat(80));
    const pipedriveClient = new PipedriveClient();
    const dealResult = await pipedriveClient.getDeal(dealId);
    
    if (!dealResult.success || !dealResult.deal) {
      console.log(`❌ Сделка ${dealId} не найдена`);
      return;
    }

    const deal = dealResult.deal;
    console.log(`ID: ${deal.id}`);
    console.log(`Название: ${deal.title}`);
    console.log(`Статус: ${deal.status}`);
    console.log(`Сумма: ${deal.value} ${deal.currency}`);
    console.log(`Создана: ${deal.add_time}`);
    console.log(`Обновлена: ${deal.update_time}`);
    console.log(`Person ID: ${deal.person_id || 'N/A'}`);
    console.log(`Organization ID: ${deal.org_id || 'N/A'}`);

    // Получаем заметки
    const notesResult = await pipedriveClient.getDealNotes(dealId);
    if (notesResult.success && notesResult.notes) {
      console.log(`\n📝 Заметок: ${notesResult.notes.length}`);
      notesResult.notes.slice(0, 5).forEach((note, i) => {
        console.log(`  ${i + 1}. [${note.add_time}] ${note.content?.substring(0, 100)}...`);
      });
    }

    // 2. Ищем все Stripe сессии и платежи для этой сделки
    console.log('\n💳 2. STRIPE СЕССИИ И ПЛАТЕЖИ');
    console.log('-'.repeat(80));
    
    if (!supabase) {
      console.log('❌ Supabase не инициализирован');
      return;
    }

    // Ищем Stripe платежи напрямую через Supabase
    console.log('Поиск Stripe платежей...');
    const { data: stripePayments, error: paymentsError } = await supabase
      .from('stripe_payments')
      .select('*')
      .eq('deal_id', String(dealId))
      .order('created_at', { ascending: false });
    
    if (paymentsError && paymentsError.code !== 'PGRST116') {
      console.log(`❌ Ошибка при поиске платежей: ${paymentsError.message}`);
    } else {
      console.log(`\nНайдено Stripe платежей: ${stripePayments?.length || 0}`);
      
      if (stripePayments && stripePayments.length > 0) {
      let totalPaid = 0;
      let totalPaidPln = 0;
      
      stripePayments.forEach((payment, i) => {
        console.log(`\n  Платеж ${i + 1}:`);
        console.log(`    ID: ${payment.id}`);
        console.log(`    Session ID: ${payment.session_id}`);
        console.log(`    Payment Intent: ${payment.payment_intent_id || 'N/A'}`);
        console.log(`    Статус: ${payment.status}`);
        console.log(`    Сумма: ${payment.amount} ${payment.currency}`);
        console.log(`    Сумма в PLN: ${payment.amount_pln || 'N/A'}`);
        console.log(`    Создан: ${payment.created_at}`);
        console.log(`    Обновлен: ${payment.updated_at}`);
        console.log(`    Тип: ${payment.payment_type || 'N/A'}`);
        console.log(`    График: ${payment.payment_schedule || 'N/A'}`);
        
        if (payment.status === 'paid' || payment.status === 'succeeded') {
          totalPaid += parseFloat(payment.amount || 0);
          totalPaidPln += parseFloat(payment.amount_pln || 0);
        }
      });
      
      console.log(`\n💰 ИТОГО ОПЛАЧЕНО:`);
      console.log(`    ${totalPaid.toFixed(2)} EUR`);
      console.log(`    ${totalPaidPln.toFixed(2)} PLN`);
      console.log(`    Ожидаемая сумма: ${deal.value} ${deal.currency}`);
      
      const expectedAmount = parseFloat(deal.value || 0);
      const paidPercent = expectedAmount > 0 ? (totalPaid / expectedAmount * 100).toFixed(1) : 0;
      console.log(`    Оплачено: ${paidPercent}%`);
      
      if (totalPaid === 0) {
        console.log(`\n⚠️  ВНИМАНИЕ: Нет оплаченных платежей!`);
      }
      } else {
        console.log(`\n⚠️  ВНИМАНИЕ: Stripe платежи не найдены!`);
      }
    }

    // Ищем Stripe сессии напрямую через Supabase
    console.log('\nПоиск Stripe сессий...');
    const { data: stripeSessions, error: sessionsError } = await supabase
      .from('stripe_sessions')
      .select('*')
      .eq('deal_id', String(dealId))
      .order('created_at', { ascending: false });
    
    if (sessionsError && sessionsError.code !== 'PGRST116') {
      console.log(`❌ Ошибка при поиске сессий: ${sessionsError.message}`);
    } else {
      console.log(`Найдено Stripe сессий: ${stripeSessions?.length || 0}`);
      
      if (stripeSessions && stripeSessions.length > 0) {
        stripeSessions.forEach((session, i) => {
          console.log(`\n  Сессия ${i + 1}:`);
          console.log(`    ID: ${session.id}`);
          console.log(`    Session ID: ${session.session_id}`);
          console.log(`    Статус: ${session.status}`);
          console.log(`    Сумма: ${session.amount} ${session.currency}`);
          console.log(`    Создана: ${session.created_at}`);
          console.log(`    Обновлена: ${session.updated_at}`);
          console.log(`    Payment Intent: ${session.payment_intent_id || 'N/A'}`);
          console.log(`    Тип: ${session.payment_type || 'N/A'}`);
          console.log(`    График: ${session.payment_schedule || 'N/A'}`);
        });
      }
    }

    // 3. Ищем напоминания о вторых платежах по проформам
    console.log('\n🔔 3. НАПОМИНАНИЯ О ВТОРЫХ ПЛАТЕЖАХ (PROFORMA REMINDERS)');
    console.log('-'.repeat(80));

    const { data: proformaReminders, error: proformaRemindersError } = await supabase
      .from('proforma_reminder_logs')
      .select('*')
      .eq('deal_id', dealId)
      .order('sent_at', { ascending: false });

    if (proformaRemindersError) {
      console.log(`❌ Ошибка при поиске напоминаний: ${proformaRemindersError.message}`);
    } else {
      console.log(`Найдено напоминаний о вторых платежах: ${proformaReminders?.length || 0}`);
      
      if (proformaReminders && proformaReminders.length > 0) {
        // Группируем по дате отправки
        const remindersByDate = {};
        proformaReminders.forEach(reminder => {
          const date = reminder.sent_date || reminder.sent_at?.split('T')[0] || 'unknown';
          if (!remindersByDate[date]) {
            remindersByDate[date] = [];
          }
          remindersByDate[date].push(reminder);
        });

        console.log('\n📅 Напоминания по датам отправки:');
        Object.entries(remindersByDate).sort().reverse().forEach(([date, dateReminders]) => {
          console.log(`\n  ${date}: ${dateReminders.length} напоминаний`);
          dateReminders.forEach((reminder, i) => {
            console.log(`    ${i + 1}. [${reminder.sent_at}] Дата платежа: ${reminder.second_payment_date}`);
            console.log(`       Источник: ${reminder.trigger_source || 'N/A'}, Run ID: ${reminder.run_id || 'N/A'}`);
            console.log(`       SendPulse ID: ${reminder.sendpulse_id || 'N/A'}`);
            console.log(`       Проформа: ${reminder.proforma_number || 'N/A'}`);
          });
        });

        // Проверяем дубликаты на одну дату
        Object.entries(remindersByDate).forEach(([date, dateReminders]) => {
          if (dateReminders.length > 1) {
            console.log(`\n⚠️  ВНИМАНИЕ: На дату ${date} найдено ${dateReminders.length} напоминаний!`);
            dateReminders.forEach((r, i) => {
              console.log(`    ${i + 1}. ID: ${r.id}, Отправлено: ${r.sent_at}, Источник: ${r.trigger_source}`);
            });
          }
        });
      }
    }

    // 5. Ищем задачи (tasks) связанные с напоминаниями
    console.log('\n📋 4. ЗАДАЧИ (TASKS)');
    console.log('-'.repeat(80));

    const tasksResult = await pipedriveClient.getDealActivities(dealId, 'task');
    if (tasksResult.success && tasksResult.activities) {
      const reminderTasks = tasksResult.activities.filter(t => 
        t.subject?.toLowerCase().includes('reminder') || 
        t.subject?.toLowerCase().includes('напоминание') ||
        t.note?.toLowerCase().includes('reminder') ||
        t.note?.toLowerCase().includes('напоминание')
      );
      
      console.log(`Всего задач: ${tasksResult.activities.length}`);
      console.log(`Задач с напоминаниями: ${reminderTasks.length}`);
      
      if (reminderTasks.length > 0) {
        reminderTasks.forEach((task, i) => {
          console.log(`\n  Задача ${i + 1}:`);
          console.log(`    Тема: ${task.subject}`);
          console.log(`    Статус: ${task.done ? 'Выполнена' : 'Активна'}`);
          console.log(`    Дата: ${task.due_date || 'N/A'}`);
          console.log(`    Создана: ${task.add_time}`);
        });
      }
    }

    // 6. Проверяем логи отправки уведомлений (если есть таблица)
    console.log('\n📨 5. ЛОГИ ОТПРАВКИ УВЕДОМЛЕНИЙ');
    console.log('-'.repeat(80));

    // Проверяем таблицу notifications если она есть
    const { data: notifications, error: notificationsError } = await supabase
      .from('notifications')
      .select('*')
      .eq('deal_id', dealId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (notificationsError && notificationsError.code !== 'PGRST116') {
      console.log(`⚠️  Таблица notifications не найдена или ошибка: ${notificationsError.message}`);
    } else if (notifications && notifications.length > 0) {
      console.log(`Найдено уведомлений: ${notifications.length}`);
      notifications.forEach((notif, i) => {
        console.log(`\n  Уведомление ${i + 1}:`);
        console.log(`    Тип: ${notif.type || 'N/A'}`);
        console.log(`    Статус: ${notif.status || 'N/A'}`);
        console.log(`    Создано: ${notif.created_at}`);
        if (notif.sent_at) {
          console.log(`    Отправлено: ${notif.sent_at}`);
        }
      });
    } else {
      console.log('Уведомления не найдены в базе');
    }

    // 7. Ищем в логах SendPulse (если есть)
    console.log('\n📧 6. ПРОВЕРКА SENDPLUSE');
    console.log('-'.repeat(80));
    console.log('Для проверки SendPulse логов нужно смотреть логи приложения');
    console.log('Искать по deal_id: 1680 или session_id из Stripe сессий');

    // 8. Резюме
    console.log('\n' + '='.repeat(80));
    console.log('📊 РЕЗЮМЕ');
    console.log('='.repeat(80));
    console.log(`Сделка: ${deal.title} (${deal.status})`);
    console.log(`Stripe сессий: ${stripeSessions?.length || 0}`);
    console.log(`Stripe платежей: ${stripePayments?.length || 0}`);
    console.log(`Напоминаний о вторых платежах: ${proformaReminders?.length || 0}`);
    
    if (proformaReminders && proformaReminders.length > 0) {
      const duplicates = Object.entries(
        proformaReminders.reduce((acc, r) => {
          const date = r.sent_date || r.sent_at?.split('T')[0] || 'unknown';
          acc[date] = (acc[date] || 0) + 1;
          return acc;
        }, {})
      ).filter(([_, count]) => count > 1);
      
      if (duplicates.length > 0) {
        console.log(`\n⚠️  НАЙДЕНЫ ДУБЛИКАТЫ НАПОМИНАНИЙ:`);
        duplicates.forEach(([date, count]) => {
          console.log(`    ${date}: ${count} напоминаний`);
        });
        console.log(`\n💡 ВОЗМОЖНЫЕ ПРИЧИНЫ:`);
        console.log(`    1. Cron запускается несколько раз в день`);
        console.log(`    2. Нарушение уникального индекса (uq_proforma_reminder_logs_unique_per_day)`);
        console.log(`    3. Разные trigger_source (cron_proforma_reminder, manual, retry)`);
        console.log(`    4. Проблема с часовым поясом (sent_date вычисляется неправильно)`);
      }
    }

  } catch (error) {
    console.error('❌ Ошибка при анализе:', error);
    logger.error('Error analyzing deal 1680', { error: error.message, stack: error.stack });
  }
}

analyzeDeal1680()
  .then(() => {
    console.log('\n✅ Анализ завершен');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  });
