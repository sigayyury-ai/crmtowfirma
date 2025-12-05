/**
 * Скрипт для сравнения списка ID сделок со списком крон-задач
 * Показывает, каких ID нет в крон-задачах
 */

require('dotenv').config();
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const ProformaSecondPaymentReminderService = require('../src/services/proformaSecondPaymentReminderService');
const logger = require('../src/utils/logger');

// ID сделок из изображения
const providedDealIds = [
  1241, 1301, 1585, 1586, 1593, 1598, 1606, 1615, 1616, 1623, 1638
];

async function getAllCronTaskDealIds() {
  const dealIds = new Set();
  
  try {
    const secondPaymentScheduler = new SecondPaymentSchedulerService();
    const proformaReminderService = new ProformaSecondPaymentReminderService();
    
    // Получаем все задачи для Stripe платежей (создание сессии)
    console.log('Получаю задачи для создания вторых платежей Stripe...');
    const stripeDeals = await secondPaymentScheduler.findAllUpcomingTasks();
    stripeDeals.forEach(({ deal }) => {
      if (deal && deal.id) {
        dealIds.add(Number(deal.id));
      }
    });
    console.log(`Найдено ${stripeDeals.length} задач для создания вторых платежей Stripe`);
    
    // Получаем задачи-напоминания для Stripe платежей
    console.log('Получаю задачи-напоминания для Stripe платежей...');
    const stripeReminderTasks = await secondPaymentScheduler.findReminderTasks();
    stripeReminderTasks.forEach(task => {
      if (task.dealId) {
        dealIds.add(Number(task.dealId));
      }
    });
    console.log(`Найдено ${stripeReminderTasks.length} задач-напоминаний для Stripe`);
    
    // Получаем задачи для просроченных сессий
    console.log('Получаю задачи для просроченных сессий...');
    const expiredSessionTasks = await secondPaymentScheduler.findExpiredSessionTasks();
    expiredSessionTasks.forEach(task => {
      if (task.dealId) {
        dealIds.add(Number(task.dealId));
      }
    });
    console.log(`Найдено ${expiredSessionTasks.length} задач для просроченных сессий`);
    
    // Получаем задачи для Proforma платежей
    console.log('Получаю задачи для Proforma платежей...');
    const proformaTasks = await proformaReminderService.findAllUpcomingTasks({ hideProcessed: false });
    proformaTasks.forEach(task => {
      if (task.dealId) {
        dealIds.add(Number(task.dealId));
      }
    });
    console.log(`Найдено ${proformaTasks.length} задач для Proforma платежей`);
    
  } catch (error) {
    logger.error('Ошибка при получении крон-задач:', error);
    throw error;
  }
  
  return dealIds;
}

async function compareDeals() {
  try {
    console.log('=== Сравнение ID сделок с крон-задачами ===\n');
    
    console.log(`Предоставлено ID сделок: ${providedDealIds.length}`);
    console.log('ID:', providedDealIds.join(', '));
    console.log();
    
    // Получаем все ID сделок из крон-задач
    const cronTaskDealIds = await getAllCronTaskDealIds();
    
    console.log(`\nНайдено уникальных ID сделок в крон-задачах: ${cronTaskDealIds.size}`);
    console.log('ID в крон-задачах:', Array.from(cronTaskDealIds).sort((a, b) => a - b).join(', '));
    console.log();
    
    // Находим ID, которых нет в крон-задачах
    const missingDealIds = providedDealIds.filter(id => !cronTaskDealIds.has(id));
    
    // Находим ID, которые есть в крон-задачах, но не в предоставленном списке
    const extraDealIds = Array.from(cronTaskDealIds).filter(id => !providedDealIds.includes(id));
    
    console.log('=== РЕЗУЛЬТАТЫ ===\n');
    
    if (missingDealIds.length === 0) {
      console.log('✅ Все предоставленные ID сделок найдены в крон-задачах!');
    } else {
      console.log(`❌ ID сделок, которых НЕТ в крон-задачах (${missingDealIds.length}):`);
      missingDealIds.forEach(id => {
        console.log(`   - ${id}`);
      });
    }
    
    console.log();
    
    if (extraDealIds.length > 0) {
      console.log(`ℹ️  ID сделок в крон-задачах, которых нет в предоставленном списке (${extraDealIds.length}):`);
      extraDealIds.slice(0, 20).forEach(id => {
        console.log(`   - ${id}`);
      });
      if (extraDealIds.length > 20) {
        console.log(`   ... и еще ${extraDealIds.length - 20} ID`);
      }
    }
    
    console.log('\n=== СВОДКА ===');
    console.log(`Всего предоставлено ID: ${providedDealIds.length}`);
    console.log(`Найдено в крон-задачах: ${providedDealIds.length - missingDealIds.length}`);
    console.log(`Отсутствует в крон-задачах: ${missingDealIds.length}`);
    console.log(`Всего уникальных ID в крон-задачах: ${cronTaskDealIds.size}`);
    
    return {
      provided: providedDealIds,
      inCronTasks: Array.from(cronTaskDealIds),
      missing: missingDealIds,
      extra: extraDealIds
    };
    
  } catch (error) {
    logger.error('Ошибка при сравнении:', error);
    process.exit(1);
  }
}

// Запускаем сравнение
if (require.main === module) {
  compareDeals()
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error('Критическая ошибка:', error);
      process.exit(1);
    });
}

module.exports = { compareDeals, getAllCronTaskDealIds };

