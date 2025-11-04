require('dotenv').config();
const PipedriveClient = require('./src/services/pipedrive');
const SendPulseClient = require('./src/services/sendpulse');

async function testSendPulseTelegram() {
  try {
    console.log('=== Тест отправки Telegram уведомления через SendPulse ===\n');
    
    // 1. Получаем данные персоны 863 из Pipedrive
    console.log('1. Получаем данные персоны 863 из Pipedrive...');
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
    
    // 2. Извлекаем SendPulse ID из персоны
    console.log('2. Извлекаем SendPulse ID из персоны...');
    // Ключ поля "Sendpulse ID" в Pipedrive (статический, одинаковый для всех пользователей)
    const sendpulseIdFieldKey = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';
    const sendpulseId = person[sendpulseIdFieldKey];
    
    if (!sendpulseId || String(sendpulseId).trim() === '') {
      console.error('   ❌ SendPulse ID не найден в персоне');
      console.log('   Поле ключ:', sendpulseIdFieldKey);
      console.log('   Все поля персоны:', Object.keys(person).filter(k => k.length > 20).join(', '));
      process.exit(1);
    }
    
    console.log('   ✅ SendPulse ID найден:', String(sendpulseId).trim());
    console.log('');
    
    // 3. Инициализируем SendPulse клиент
    console.log('3. Инициализируем SendPulse клиент...');
    let sendpulseClient;
    try {
      sendpulseClient = new SendPulseClient();
      console.log('   ✅ SendPulse клиент инициализирован');
    } catch (error) {
      console.error('   ❌ Ошибка инициализации SendPulse клиента:', error.message);
      console.log('   Проверьте переменные окружения: SENDPULSE_ID, SENDPULSE_SECRET');
      process.exit(1);
    }
    console.log('');
    
    // 4. Тестируем подключение к SendPulse API
    console.log('4. Тестируем подключение к SendPulse API...');
    const connectionTest = await sendpulseClient.testConnection();
    if (!connectionTest.success) {
      console.error('   ❌ Ошибка подключения к SendPulse API:', connectionTest.error);
      process.exit(1);
    }
    console.log('   ✅ Подключение успешно');
    console.log('');
    
    // 5. Отправляем тестовое сообщение
    console.log('5. Отправляем тестовое сообщение в Telegram...');
    const message = `Привет! Тебе была отправлена проформа по email.\n\n` +
                   `Пожалуйста, проверь почту и внимательно посмотри сроки оплаты и график платежей.`;
    
    console.log('   Сообщение:', message);
    console.log('   SendPulse ID:', String(sendpulseId).trim());
    console.log('');
    
    const result = await sendpulseClient.sendTelegramMessage(String(sendpulseId).trim(), message);
    
    if (result.success) {
      console.log('   ✅ Сообщение успешно отправлено!');
      console.log('   Message ID:', result.messageId);
    } else {
      console.error('   ❌ Ошибка отправки сообщения:', result.error);
      console.log('   Проверьте:');
      console.log('   - Правильность SendPulse ID в персоне');
      console.log('   - Настройки мессенджера в SendPulse');
      process.exit(1);
    }
    
    console.log('\n=== Тест завершен успешно! ===');
    
  } catch (error) {
    console.error('\n❌ Критическая ошибка:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testSendPulseTelegram();

