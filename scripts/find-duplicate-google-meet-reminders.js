/**
 * Скрипт для поиска и удаления дублей Google Meet reminders в базе
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findAndRemoveDuplicates() {
  console.log('🔍 Поиск дублей Google Meet reminders...\n');

  if (!supabase) {
    console.error('❌ Supabase клиент не настроен');
    process.exit(1);
  }

  try {
    // 1. Найти все задачи
    const { data: allTasks, error: fetchError } = await supabase
      .from('google_meet_reminders')
      .select('*')
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('❌ Ошибка при загрузке задач:', fetchError.message);
      process.exit(1);
    }

    if (!allTasks || allTasks.length === 0) {
      console.log('✅ Задач не найдено');
      return;
    }

    console.log(`📊 Всего задач в базе: ${allTasks.length}\n`);

    // 2. Найти дубли по task_id (должен быть уникальным)
    const taskIdMap = new Map();
    const duplicatesByTaskId = [];

    for (const task of allTasks) {
      if (taskIdMap.has(task.task_id)) {
        duplicatesByTaskId.push(task);
      } else {
        taskIdMap.set(task.task_id, task);
      }
    }

    // 3. Найти дубли по комбинации event_id + client_email + reminder_type
    // (одинаковые задачи для одного события, клиента и типа напоминания)
    const duplicateKeys = new Map();
    const duplicatesByKey = [];

    for (const task of allTasks) {
      // Проверяем дубли по event_id + client_email + reminder_type (без учета времени)
      const key = `${task.event_id}:${task.client_email}:${task.reminder_type}`;
      if (duplicateKeys.has(key)) {
        duplicatesByKey.push(task);
      } else {
        duplicateKeys.set(key, task);
      }
    }
    
    // 4. Найти дубли по названию события (event_summary) + client_email + reminder_type
    // (одинаковые задачи для одного названия, клиента и типа напоминания)
    const duplicateBySummary = new Map();
    const duplicatesBySummary = [];

    for (const task of allTasks) {
      if (!task.event_summary) continue;
      
      // Нормализуем название (убираем пробелы, приводим к нижнему регистру)
      const normalizedSummary = task.event_summary.trim().toLowerCase();
      const key = `${normalizedSummary}:${task.client_email}:${task.reminder_type}`;
      
      if (duplicateBySummary.has(key)) {
        duplicatesBySummary.push(task);
      } else {
        duplicateBySummary.set(key, task);
      }
    }
    
    // Также проверяем дубли по event_id + client_email (если есть несколько типов напоминаний)
    const eventEmailMap = new Map();
    const duplicatesByEventEmail = [];
    
    for (const task of allTasks) {
      const key = `${task.event_id}:${task.client_email}`;
      if (eventEmailMap.has(key)) {
        const existing = eventEmailMap.get(key);
        // Проверяем, не является ли это просто разными типами напоминаний (30min и 5min)
        if (existing.reminder_type === task.reminder_type) {
          duplicatesByEventEmail.push(task);
        }
      } else {
        eventEmailMap.set(key, task);
      }
    }

    console.log('📋 Результаты поиска дублей:\n');
    console.log(`   - Дубли по task_id: ${duplicatesByTaskId.length}`);
    console.log(`   - Дубли по комбинации (event_id + email + type): ${duplicatesByKey.length}`);
    console.log(`   - Дубли по названию (event_summary + email + type): ${duplicatesBySummary.length}`);
    console.log(`   - Дубли по event_id + email (одинаковый тип): ${duplicatesByEventEmail.length}\n`);

    // 4. Объединяем все дубли (уникальные по ID)
    const allDuplicates = new Map();
    
    // Добавляем дубли по task_id
    for (const dup of duplicatesByTaskId) {
      allDuplicates.set(dup.id, dup);
    }
    
    // Добавляем дубли по ключу (если еще не добавлены)
    for (const dup of duplicatesByKey) {
      if (!allDuplicates.has(dup.id)) {
        // Проверяем, есть ли уже задача с таким же ключом
        const key = `${dup.event_id}:${dup.client_email}:${dup.reminder_type}`;
        const firstTask = duplicateKeys.get(key);
        if (firstTask && firstTask.id !== dup.id) {
          // Оставляем первую задачу, помечаем остальные как дубли
          allDuplicates.set(dup.id, dup);
        }
      }
    }
    
    // Добавляем дубли по названию (если еще не добавлены)
    for (const dup of duplicatesBySummary) {
      if (!allDuplicates.has(dup.id)) {
        const normalizedSummary = dup.event_summary.trim().toLowerCase();
        const key = `${normalizedSummary}:${dup.client_email}:${dup.reminder_type}`;
        const firstTask = duplicateBySummary.get(key);
        if (firstTask && firstTask.id !== dup.id) {
          // Оставляем первую задачу, помечаем остальные как дубли
          allDuplicates.set(dup.id, dup);
        }
      }
    }
    
    // Добавляем дубли по event_id + email
    for (const dup of duplicatesByEventEmail) {
      if (!allDuplicates.has(dup.id)) {
        allDuplicates.set(dup.id, dup);
      }
    }

    const duplicatesArray = Array.from(allDuplicates.values());
    
    if (duplicatesArray.length === 0) {
      console.log('✅ Дублей не найдено!\n');
      return;
    }

    console.log(`🗑️  Найдено дублей для удаления: ${duplicatesArray.length}\n`);

    // 5. Показываем примеры дублей
    console.log('📝 Примеры дублей (первые 5):\n');
    duplicatesArray.slice(0, 5).forEach((dup, index) => {
      console.log(`   ${index + 1}. Task ID: ${dup.task_id}`);
      console.log(`      Event: ${dup.event_summary || 'N/A'}`);
      console.log(`      Client: ${dup.client_email}`);
      console.log(`      Type: ${dup.reminder_type}`);
      console.log(`      Scheduled: ${dup.scheduled_time}`);
      console.log(`      Created: ${dup.created_at}`);
      console.log(`      Sent: ${dup.sent}`);
      console.log('');
    });

    // 6. Удаляем дубли (оставляем самую старую задачу, если не отправлена, иначе самую новую)
    console.log('🗑️  Удаление дублей...\n');

    let deleted = 0;
    let errors = 0;

    // Группируем дубли по ключу (используем event_id или event_summary)
    const duplicatesByGroup = new Map();
    for (const dup of duplicatesArray) {
      // Используем event_id если есть, иначе event_summary
      const key = dup.event_id 
        ? `${dup.event_id}:${dup.client_email}:${dup.reminder_type}`
        : `${dup.event_summary?.trim().toLowerCase() || 'unknown'}:${dup.client_email}:${dup.reminder_type}`;
      
      if (!duplicatesByGroup.has(key)) {
        duplicatesByGroup.set(key, []);
      }
      duplicatesByGroup.get(key).push(dup);
    }

    // Для каждой группы оставляем одну задачу, остальные удаляем
    for (const [key, group] of duplicatesByGroup.entries()) {
      // Сортируем: сначала неотправленные, потом по дате создания (старые сначала)
      group.sort((a, b) => {
        if (a.sent !== b.sent) {
          return a.sent ? 1 : -1; // Неотправленные первыми
        }
        return new Date(a.created_at) - new Date(b.created_at); // Старые первыми
      });

      // Оставляем первую задачу, удаляем остальные
      const toKeep = group[0];
      const toDelete = group.slice(1);
      
      console.log(`   Группа: ${key}`);
      console.log(`      Оставляем: ${toKeep.task_id} (created: ${toKeep.created_at}, sent: ${toKeep.sent})`);
      console.log(`      Удаляем: ${toDelete.length} дублей\n`);

      for (const task of toDelete) {
        const { error: deleteError } = await supabase
          .from('google_meet_reminders')
          .delete()
          .eq('id', task.id);

        if (deleteError) {
          console.error(`   ❌ Ошибка удаления задачи ${task.id}:`, deleteError.message);
          errors++;
        } else {
          deleted++;
          console.log(`   ✅ Удален дубль: ${task.task_id} (${task.event_summary || 'N/A'})`);
        }
      }
    }

    console.log(`\n✅ Удаление завершено:`);
    console.log(`   - Удалено: ${deleted}`);
    console.log(`   - Ошибок: ${errors}\n`);

    // 7. Проверяем результат
    const { count: finalCount } = await supabase
      .from('google_meet_reminders')
      .select('*', { count: 'exact', head: true });

    console.log(`📊 Итоговое количество задач в базе: ${finalCount}\n`);

  } catch (error) {
    console.error('❌ Критическая ошибка:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

// Запуск
findAndRemoveDuplicates().catch((error) => {
  console.error('❌ Неожиданная ошибка:', error);
  process.exit(1);
});

