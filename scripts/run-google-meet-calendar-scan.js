/**
 * Скрипт для запуска ежедневного сканирования календаря Google Meet
 * Создает реальные задачи напоминаний из календаря на сегодня и следующие 30 дней
 */

// Загружаем переменные окружения
require('dotenv').config();

const { getScheduler } = require('../src/services/scheduler');
const logger = require('../src/utils/logger');

async function runCalendarScan() {
  console.log('🔄 Запуск сканирования календаря Google Meet...\n');

  try {
    const scheduler = getScheduler();
    
    if (!scheduler.googleMeetReminderService) {
      console.error('❌ Google Meet Reminder Service не доступен');
      console.error('   Проверьте настройки GOOGLE_CLIENT_ID, GOOGLE_REFRESH_TOKEN, GOOGLE_CALENDAR_ID');
      process.exit(1);
    }

    console.log('📅 Сканирование календаря...');
    const result = await scheduler.runGoogleMeetCalendarScan({ trigger: 'manual_script' });

    if (result.success) {
      console.log('\n✅ Сканирование завершено успешно!\n');
      console.log('📊 Результаты:');
      console.log(`   - Событий отсканировано: ${result.eventsScanned || 0}`);
      console.log(`   - Google Meet событий найдено: ${result.meetEventsFound || 0}`);
      console.log(`   - Задач создано: ${result.tasksCreated || 0}`);
      console.log(`   - Клиентов сопоставлено: ${result.clientsMatched || 0}`);
      console.log(`   - Клиентов пропущено: ${result.clientsSkipped || 0}`);
      
      if (result.queueStatus) {
        console.log(`\n📋 Статус очереди:`);
        console.log(`   - Всего задач: ${result.queueStatus.totalTasks || 0}`);
        console.log(`   - Ожидающих отправки: ${result.queueStatus.pendingTasks || 0}`);
        console.log(`   - Отправленных: ${result.queueStatus.sentTasks || 0}`);
      }

      console.log(`\n🆔 Run ID: ${result.runId}`);
      console.log('\n✅ Задачи сохранены в базу данных и готовы к обработке\n');
    } else {
      console.error('\n❌ Сканирование завершилось с ошибкой:');
      console.error(`   ${result.error || 'Неизвестная ошибка'}`);
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Критическая ошибка при сканировании:');
    console.error(`   ${error.message}`);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Запуск
runCalendarScan().catch((error) => {
  console.error('❌ Неожиданная ошибка:', error);
  process.exit(1);
});

