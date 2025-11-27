require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findFreeCoprofNumber() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Ищу свободный номер для CO-PROF...');

    // Получим все существующие номера CO-PROF 1xx/2025
    const { data: existing, error } = await supabase
      .from('proformas')
      .select('fullnumber')
      .ilike('fullnumber', 'CO-PROF 1%/2025')
      .order('fullnumber');

    if (error) {
      logger.error('Ошибка при получении существующих номеров:', error);
      return;
    }

    // Извлечем номера
    const usedNumbers = new Set();
    existing.forEach(p => {
      const match = p.fullnumber.match(/CO-PROF (\d+)\/2025/);
      if (match) {
        usedNumbers.add(parseInt(match[1]));
      }
    });

    logger.info(`Найдено занятых номеров: ${usedNumbers.size}`);
    logger.info('Занятые номера:', Array.from(usedNumbers).sort((a,b) => a-b).join(', '));

    // Найдем свободный номер начиная с 130
    let freeNumber = 130;
    while (usedNumbers.has(freeNumber)) {
      freeNumber++;
    }

    logger.info(`Первый свободный номер: ${freeNumber}`);
    logger.info(`Предлагаемый fullnumber: CO-PROF ${freeNumber}/2025`);

    return `CO-PROF ${freeNumber}/2025`;

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

// Экспортируем функцию для использования в других скриптах
module.exports = { findFreeCoprofNumber };

// Если запускаем напрямую
if (require.main === module) {
  findFreeCoprofNumber();
}
