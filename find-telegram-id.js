require('dotenv').config();
const PipedriveClient = require('./src/services/pipedrive');

async function findTelegramId() {
  try {
    console.log('=== Поиск Telegram Message ID в персоне ===\n');
    
    // Получаем персону 863
    console.log('1. Получаем персону 863 из Pipedrive...');
    const pipedriveClient = new PipedriveClient();
    const personResult = await pipedriveClient.getPerson(863);
    
    if (!personResult.success) {
      console.error('Ошибка при получении данных персоны:', personResult.error);
      process.exit(1);
    }
    
    const person = personResult.person;
    console.log('   ✅ Персона получена:', person.name);
    console.log('   Email:', person.primary_email);
    console.log('');
    
    // Ищем поле с Telegram Message ID
    console.log('2. Ищем поле с Telegram Message ID...');
    
    // Вариант 1: ищем по значению 124699982
    console.log('   Ищем поле со значением 124699982...');
    const fieldsWithValue = Object.keys(person).filter(key => {
      const value = person[key];
      if (value && String(value).includes('124699982')) {
        return true;
      }
      return false;
    });
    
    if (fieldsWithValue.length > 0) {
      console.log('   ✅ Найдены поля со значением 124699982:');
      fieldsWithValue.forEach(key => {
        console.log(`      - ${key}: ${person[key]}`);
      });
    } else {
      console.log('   ❌ Не найдено поле со значением 124699982');
    }
    console.log('');
    
    // Выводим все поля персоны для анализа
    console.log('3. Все поля персоны (для анализа):');
    console.log('   Поля с длинными ключами (возможно, кастомные поля):');
    Object.keys(person)
      .filter(key => key.length > 20)
      .forEach(key => {
        const value = person[key];
        if (value !== null && value !== undefined && value !== '') {
          console.log(`      - ${key}: ${value}`);
        }
      });
    console.log('');
    
    // Выводим все числовые значения
    console.log('   Числовые значения (возможно, ID):');
    Object.keys(person)
      .forEach(key => {
        const value = person[key];
        if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
          console.log(`      - ${key}: ${value}`);
        }
      });
    
    console.log('\n=== Поиск завершен ===');
    
  } catch (error) {
    console.error('\n❌ Критическая ошибка:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

findTelegramId();

