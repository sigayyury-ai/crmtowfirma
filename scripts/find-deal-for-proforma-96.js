require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const PROFORMA_NUMBER = 'CO-PROF 96/2025';
const BUYER_NAME = 'Hanna Chakhouskaya';

async function findDealForProforma96() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info(`=== ПОИСК СДЕЛКИ ДЛЯ ПРОФОРМЫ ${PROFORMA_NUMBER} ===\n`);

    // 1. Получаем данные проформы
    logger.info(`🔍 Получение данных проформы...`);
    const { data: proformas, error: proformaError } = await supabase
      .from('proformas')
      .select('*')
      .or(`fullnumber.ilike.%96/2025%,fullnumber.ilike.%CO-PROF 96/2025%`)
      .limit(1);

    if (proformaError) {
      logger.error('Ошибка при поиске проформы:', proformaError);
      process.exit(1);
    }

    if (!proformas || proformas.length === 0) {
      logger.error(`Проформа ${PROFORMA_NUMBER} не найдена`);
      process.exit(1);
    }

    const proforma = proformas[0];
    logger.info(`Проформа найдена:`);
    logger.info(`  ID: ${proforma.id}`);
    logger.info(`  Номер: ${proforma.fullnumber}`);
    logger.info(`  Покупатель: ${proforma.buyer_name || 'неизвестно'}`);
    logger.info(`  Email: ${proforma.buyer_email || 'нет'}`);
    logger.info(`  Телефон: ${proforma.buyer_phone || 'нет'}`);
    logger.info(`  Deal ID: ${proforma.pipedrive_deal_id || 'НЕТ ❌'}`);
    logger.info(`  Дата: ${proforma.issued_at || 'нет'}`);
    logger.info(`  Сумма: ${proforma.total || 0} ${proforma.currency || 'PLN'}\n`);

    if (proforma.pipedrive_deal_id) {
      logger.info(`✅ У проформы уже есть Deal ID: ${proforma.pipedrive_deal_id}`);
      logger.info(`   Дополнительный поиск не требуется.`);
      return;
    }

    // 2. Инициализируем Pipedrive клиент
    const pipedriveClient = new PipedriveClient();

    // 3. Поиск по email
    if (proforma.buyer_email) {
      logger.info(`🔍 Поиск персоны по email: ${proforma.buyer_email}...`);
      
      try {
        const personsResult = await pipedriveClient.searchPersons(proforma.buyer_email);
        
        if (personsResult.success && personsResult.persons && personsResult.persons.length > 0) {
          logger.info(`✅ Найдено персон: ${personsResult.persons.length}\n`);
          
          for (const person of personsResult.persons) {
            logger.info(`Персона ID: ${person.id}`);
            logger.info(`  Имя: ${person.name || 'нет'}`);
            logger.info(`  Email: ${person.email?.[0]?.value || person.email || 'нет'}`);
            logger.info(`  Телефон: ${person.phone?.[0]?.value || person.phone || 'нет'}\n`);

            // Ищем сделки для этой персоны
            logger.info(`  🔍 Поиск сделок для персоны ${person.id}...`);
            
            try {
              const dealsResult = await pipedriveClient.getPersonDeals(person.id);
              
              if (dealsResult.success && dealsResult.deals) {
                logger.info(`  Найдено сделок: ${dealsResult.deals.length}`);
                
                if (dealsResult.deals.length > 0) {
                  logger.info(`  Список сделок:`);
                  dealsResult.deals.forEach((deal, idx) => {
                    logger.info(`    ${idx + 1}. Deal ID: ${deal.id}`);
                    logger.info(`       Название: ${deal.title || 'нет'}`);
                    logger.info(`       Статус: ${deal.status || 'N/A'}`);
                    logger.info(`       Stage ID: ${deal.stage_id || 'N/A'}`);
                    logger.info(`       Сумма: ${deal.value || 0} ${deal.currency || 'PLN'}`);
                    logger.info(`       Дата создания: ${deal.add_time || 'нет'}`);
                    logger.info(`       Ссылка: https://comoon.pipedrive.com/deal/${deal.id}`);
                    logger.info(``);
                  });

                  // Проверяем продукты в сделках
                  logger.info(`  🔍 Проверка продуктов в сделках...\n`);
                  for (const deal of dealsResult.deals) {
                    const productsResult = await pipedriveClient.getDealProducts(deal.id);
                    if (productsResult.success && productsResult.products) {
                      logger.info(`  Deal ${deal.id} - Продукты:`);
                      productsResult.products.forEach(p => {
                        const productName = p.name || p.product?.name || 'Без названия';
                        logger.info(`    - ${productName}`);
                      });
                      logger.info(``);
                    }
                  }
                } else {
                  logger.info(`  Сделок не найдено`);
                }
              } else {
                logger.warn(`  Ошибка при получении сделок: ${dealsResult.error || 'unknown'}`);
              }
            } catch (error) {
              logger.error(`  Ошибка при поиске сделок:`, error.message);
            }
          }
        } else {
          logger.info(`❌ Персоны по email не найдены`);
        }
      } catch (error) {
        logger.error(`Ошибка при поиске персоны:`, error.message);
      }
    } else {
      logger.info(`⚠️  Email покупателя отсутствует, поиск по email невозможен`);
    }

    // 4. Поиск по имени
    if (proforma.buyer_name) {
      logger.info(`\n🔍 Поиск персоны по имени: ${proforma.buyer_name}...`);
      
      try {
        const personsResult = await pipedriveClient.searchPersons(proforma.buyer_name);
        
        if (personsResult.success && personsResult.persons && personsResult.persons.length > 0) {
          logger.info(`✅ Найдено персон: ${personsResult.persons.length}\n`);
          
          // Фильтруем по точному совпадению имени
          const matchingPersons = personsResult.persons.filter(p => {
            const personName = (p.name || '').toLowerCase();
            const buyerName = (proforma.buyer_name || '').toLowerCase();
            return personName.includes(buyerName) || buyerName.includes(personName);
          });

          if (matchingPersons.length > 0) {
            logger.info(`Найдено персон с похожим именем: ${matchingPersons.length}\n`);
            
            for (const person of matchingPersons) {
              logger.info(`Персона ID: ${person.id}`);
              logger.info(`  Имя: ${person.name || 'нет'}`);
              logger.info(`  Email: ${person.email?.[0]?.value || person.email || 'нет'}`);
              logger.info(`  Телефон: ${person.phone?.[0]?.value || person.phone || 'нет'}\n`);

              // Ищем сделки
              logger.info(`  🔍 Поиск сделок для персоны ${person.id}...`);
              
              try {
                const dealsResult = await pipedriveClient.getPersonDeals(person.id);
                
                if (dealsResult.success && dealsResult.deals) {
                  logger.info(`  Найдено сделок: ${dealsResult.deals.length}`);
                  
                  if (dealsResult.deals.length > 0) {
                    dealsResult.deals.forEach((deal, idx) => {
                      logger.info(`    ${idx + 1}. Deal ID: ${deal.id} | ${deal.title || 'нет'} | ${deal.value || 0} ${deal.currency || 'PLN'}`);
                      logger.info(`       Ссылка: https://comoon.pipedrive.com/deal/${deal.id}`);
                    });
                    logger.info(``);
                  }
                }
              } catch (error) {
                logger.error(`  Ошибка:`, error.message);
              }
            }
          } else {
            logger.info(`Персон с похожим именем не найдено`);
          }
        } else {
          logger.info(`❌ Персоны по имени не найдены`);
        }
      } catch (error) {
        logger.error(`Ошибка при поиске персоны:`, error.message);
      }
    }

    // 5. Поиск сделок по названию (если есть информация о продукте)
    logger.info(`\n🔍 Поиск сделок по ключевым словам...`);
    
    const searchTerms = [
      'Hanna Chakhouskaya',
      'Chakhouskaya',
      'Single Lankowa',
      'Lankowa'
    ];

    for (const term of searchTerms) {
      try {
        logger.info(`  Поиск по термину: "${term}"...`);
        // Здесь можно добавить поиск сделок по названию, если есть такой метод в PipedriveClient
        // Пока пропускаем, так как не уверен в наличии такого метода
      } catch (error) {
        // Игнорируем ошибки поиска
      }
    }

    logger.info(`\n=== РЕКОМЕНДАЦИИ ===\n`);
    logger.info(`1. Проверьте найденные сделки вручную в Pipedrive`);
    logger.info(`2. Если сделка найдена, можно связать проформу командой:`);
    logger.info(`   UPDATE proformas SET pipedrive_deal_id = <DEAL_ID> WHERE id = '${proforma.id}';`);
    logger.info(`3. Если сделка не найдена, возможно:`);
    logger.info(`   - Сделка была удалена`);
    logger.info(`   - Проформа была создана вручную вне CRM`);
    logger.info(`   - Email или имя покупателя изменились в CRM\n`);

    logger.info(`=== ПОИСК ЗАВЕРШЕН ===\n`);

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findDealForProforma96();



