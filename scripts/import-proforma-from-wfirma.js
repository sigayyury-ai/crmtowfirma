const { WfirmaLookup } = require('../src/services/vatMargin/wfirmaLookup');
const InvoiceProcessingService = require('../src/services/invoiceProcessing');
const logger = require('../src/utils/logger');

/**
 * Скрипт для импорта конкретной проформы из wFirma в Supabase
 * Использование: node scripts/import-proforma-from-wfirma.js "CO-PROF 159/2025"
 */

async function importProforma(fullnumber) {
  if (!fullnumber) {
    logger.error('Укажите номер проформы: node scripts/import-proforma-from-wfirma.js "CO-PROF 159/2025"');
    process.exit(1);
  }

  try {
    logger.info(`🔍 Поиск проформы "${fullnumber}" в wFirma...`);

    const lookup = new WfirmaLookup();
    const invoiceService = new InvoiceProcessingService();

    // Извлекаем номер и год из fullnumber для более точного поиска
    const numberMatch = fullnumber.match(/(\d+)\/(\d{2,4})/);
    const proformaNumber = numberMatch ? numberMatch[1] : null;
    const proformaYear = numberMatch ? numberMatch[2] : null;

    // Получаем проформы за период, включающий год проформы
    const now = new Date();
    let dateFrom, dateTo;
    
    if (proformaYear) {
      let year;
      if (proformaYear.length === 4) {
        year = parseInt(proformaYear);
      } else if (proformaYear.length === 2) {
        // 2 цифры: пробуем текущий век (202 -> 2025) и предыдущий (202 -> 2024)
        const currentYear = now.getFullYear();
        const century = Math.floor(currentYear / 100) * 100;
        year = century + parseInt(proformaYear);
      } else if (proformaYear.length === 3) {
        // 3 цифры: пробуем как 2 последние цифры (202 -> 2025) или как 4-значный (202 -> 2202)
        const currentYear = now.getFullYear();
        const century = Math.floor(currentYear / 100) * 100;
        const shortYear = parseInt(proformaYear.slice(-2));
        year = century + shortYear; // Предполагаем текущий век
      } else {
        year = now.getFullYear();
      }
      
      // Ищем в диапазоне: год проформы и соседние годы (на случай ошибок)
      dateFrom = new Date(year - 1, 0, 1);
      dateTo = new Date(year + 1, 11, 31, 23, 59, 59);
    } else {
      // Если год не указан, ищем за последние 2 года
      dateFrom = new Date(now.getFullYear() - 2, 0, 1);
      dateTo = new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59);
    }

    logger.info(`Загрузка проформ из wFirma за период: ${dateFrom.toISOString().split('T')[0]} - ${dateTo.toISOString().split('T')[0]}...`);

    const proformas = await lookup.getProformasByDateRange(dateFrom, dateTo);
    logger.info(`Загружено проформ из wFirma: ${proformas.length}`);

    // Ищем проформу по номеру (с учетом возможных вариантов)
    const normalizedSearch = fullnumber.toUpperCase().trim();
    let foundProforma = proformas.find(p => {
      const pNumber = (p.fullnumber || '').toUpperCase().trim();
      // Точное совпадение
      if (pNumber === normalizedSearch) return true;
      // Частичное совпадение
      if (pNumber.includes(normalizedSearch) || normalizedSearch.includes(pNumber)) return true;
      // Поиск по номеру без года
      if (proformaNumber) {
        const pNumberOnly = pNumber.match(/(\d+)\//);
        if (pNumberOnly && pNumberOnly[1] === proformaNumber) return true;
      }
      return false;
    });

    // Если не нашли, пробуем расширенный поиск
    if (!foundProforma && proformas.length > 0) {
      logger.info('Проформа не найдена в текущем периоде, пробуем расширенный поиск...');
      
      // Пробуем поиск за больший период
      const extendedDateFrom = new Date(now.getFullYear() - 5, 0, 1);
      const extendedDateTo = new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59);
      
      try {
        const extendedProformas = await lookup.getProformasByDateRange(extendedDateFrom, extendedDateTo);
        logger.info(`Загружено проформ за расширенный период: ${extendedProformas.length}`);
        
        foundProforma = extendedProformas.find(p => {
          const pNumber = (p.fullnumber || '').toUpperCase().trim();
          return pNumber === normalizedSearch || 
                 pNumber.includes(normalizedSearch) || 
                 normalizedSearch.includes(pNumber) ||
                 (proformaNumber && pNumber.includes(`CO-PROF ${proformaNumber}/`)) ||
                 (proformaNumber && pNumber.includes(`CO PROF ${proformaNumber}/`));
        });
      } catch (extendedError) {
        logger.warn('Ошибка при расширенном поиске:', extendedError.message);
      }
    }

    if (!foundProforma) {
      logger.error(`❌ Проформа "${fullnumber}" не найдена в wFirma`);
      logger.info('Проверьте:');
      logger.info('  1. Правильность номера проформы');
      logger.info('  2. Существует ли проформа в wFirma');
      logger.info('  3. Попробуйте другой формат номера (например, "CO-PROF 159/2025" или "CO PROF 159/2025")');
      process.exit(1);
    }

    logger.info(`✅ Найдена проформа в wFirma:`);
    logger.info(`  ID: ${foundProforma.id}`);
    logger.info(`  Номер: ${foundProforma.fullnumber}`);
    logger.info(`  Дата: ${foundProforma.date}`);
    logger.info(`  Сумма: ${foundProforma.total} ${foundProforma.currency || 'PLN'}`);

    // Получаем полные данные проформы
    logger.info('\n📥 Загрузка полных данных проформы из wFirma...');
    const fullProforma = await lookup.getFullProformaById(foundProforma.id);

    if (!fullProforma) {
      logger.error('❌ Не удалось загрузить полные данные проформы');
      process.exit(1);
    }

    logger.info('✅ Полные данные загружены');

    // Сохраняем в Supabase через InvoiceProcessingService
    logger.info('\n💾 Сохранение проформы в Supabase...');
    
    const invoiceNumber = fullProforma.fullnumber || foundProforma.fullnumber;
    const invoiceId = foundProforma.id;
    
    try {
      await invoiceService.persistProformaToDatabase(invoiceId, {
        invoiceNumber: invoiceNumber,
        issueDate: fullProforma.date ? new Date(fullProforma.date) : (foundProforma.date ? new Date(foundProforma.date) : new Date()),
        currency: fullProforma.currency || foundProforma.currency || 'PLN',
        totalAmount: typeof fullProforma.total === 'number' ? fullProforma.total : (foundProforma.total ? parseFloat(foundProforma.total) : 0),
        fallbackProduct: (fullProforma.products && fullProforma.products.length > 0)
          ? fullProforma.products[0]
          : (foundProforma.products && foundProforma.products.length > 0 ? foundProforma.products[0] : null),
        fallbackBuyer: fullProforma.buyer || foundProforma.buyer || null
      });

      logger.info('✅ Проформа успешно импортирована в Supabase');
      logger.info(`  Номер: ${invoiceNumber}`);
      logger.info(`  ID в wFirma: ${invoiceId}`);
    } catch (persistError) {
      logger.error('Ошибка при сохранении проформы в Supabase:', persistError.message);
      throw persistError;
    }

  } catch (error) {
    logger.error('❌ Ошибка при импорте проформы:', error);
    logger.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Main execution
const fullnumber = process.argv[2];

if (!fullnumber) {
  logger.error('Использование: node scripts/import-proforma-from-wfirma.js "CO-PROF 159/2025"');
  process.exit(1);
}

importProforma(fullnumber)
  .then(() => {
    logger.info('\n✅ Импорт завершен');
    process.exit(0);
  })
  .catch(error => {
    logger.error('Критическая ошибка:', error);
    process.exit(1);
  });
