/**
 * Скрипт для вывода всех Google Meet reminders из базы
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');

async function listAllTasks() {
  console.log('📋 Все задачи Google Meet reminders:\n');

  if (!supabase) {
    console.error('❌ Supabase клиент не настроен');
    process.exit(1);
  }

  try {
    const { data: allTasks, error } = await supabase
      .from('google_meet_reminders')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('❌ Ошибка:', error.message);
      process.exit(1);
    }

    if (!allTasks || allTasks.length === 0) {
      console.log('✅ Задач не найдено');
      return;
    }

    console.log(`Всего задач: ${allTasks.length}\n`);

    allTasks.forEach((task, index) => {
      console.log(`${index + 1}. Task ID: ${task.task_id}`);
      console.log(`   Event ID: ${task.event_id}`);
      console.log(`   Название: ${task.event_summary || 'N/A'}`);
      console.log(`   Клиент: ${task.client_email}`);
      console.log(`   Тип: ${task.reminder_type}`);
      console.log(`   Время напоминания: ${task.scheduled_time}`);
      console.log(`   Время встречи: ${task.meeting_time}`);
      console.log(`   Отправлено: ${task.sent ? 'Да' : 'Нет'}`);
      console.log(`   Создано: ${task.created_at}`);
      console.log('');
    });

    // Группируем по event_id + client_email + reminder_type для поиска дублей
    const byEventKey = new Map();
    allTasks.forEach(task => {
      const key = `${task.event_id}:${task.client_email}:${task.reminder_type}`;
      if (!byEventKey.has(key)) {
        byEventKey.set(key, []);
      }
      byEventKey.get(key).push(task);
    });

    console.log('\n🔍 Поиск дублей по event_id + email + type:\n');
    let foundDuplicates = false;
    for (const [key, tasks] of byEventKey.entries()) {
      if (tasks.length > 1) {
        foundDuplicates = true;
        console.log(`⚠️  ДУБЛИ найдены для ключа "${key}":`);
        tasks.forEach((task, idx) => {
          console.log(`   ${idx + 1}. Task ID: ${task.task_id}`);
          console.log(`      Создано: ${task.created_at}`);
          console.log(`      Время напоминания: ${task.scheduled_time}`);
          console.log(`      Отправлено: ${task.sent ? 'Да' : 'Нет'}`);
        });
        console.log('');
      }
    }
    
    if (!foundDuplicates) {
      console.log('✅ Дублей не найдено - все задачи уникальны\n');
    }

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

listAllTasks();

