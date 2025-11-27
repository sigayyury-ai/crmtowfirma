require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function resolveCoprof137Conflict() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Разрешаю конфликт с CO-PROF 137/2025...');

    // Найдем обе проформы с CO-PROF 137/2025
    const { data: proformas137, error: findError } = await supabase
      .from('proformas')
      .select('*')
      .eq('fullnumber', 'CO-PROF 137/2025')
      .order('id');

    if (findError) {
      logger.error('Ошибка при поиске CO-PROF 137/2025:', findError);
      return;
    }

    logger.info(`Найдено проформ CO-PROF 137/2025: ${proformas137.length}`);

    proformas137.forEach((proforma, index) => {
      logger.info(`\nПроформа ${index + 1}:`);
      logger.info(`  ID: ${proforma.id}`);
      logger.info(`  deal_id: ${proforma.pipedrive_deal_id}`);
      logger.info(`  buyer_name: ${proforma.buyer_name}`);
      logger.info(`  status: ${proforma.status}`);
    });

    // Найдем deal 1598 (текущий владелец CO-PROF 137/2025)
    const deal1598Proforma = proformas137.find(p => p.pipedrive_deal_id === 1598);
    // Найдем deal 1600 (куда нужно перенести)
    const deal1600Proforma = proformas137.find(p => p.pipedrive_deal_id === 1600);

    if (deal1598Proforma && deal1600Proforma) {
      logger.info('\nКОНФЛИКТ: CO-PROF 137/2025 существует для обоих deal');
      logger.info('Deal 1598 (Volha Korziuk):', deal1598Proforma.buyer_name);
      logger.info('Deal 1600 (Siergiej Żarkiewicz):', deal1600Proforma.buyer_name);

      // Предложение: изменить номер для deal 1598
      const newNumberFor1598 = 'CO-PROF 138/2025';

      logger.info(`\nПредлагаю изменить номер для deal 1598 на ${newNumberFor1598}`);

      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question(`Изменить CO-PROF 137/2025 для deal 1598 на ${newNumberFor1598}? (yes/no): `, async (answer) => {
        if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
          // Изменим номер для deal 1598
          const { error: updateError } = await supabase
            .from('proformas')
            .update({
              fullnumber: newNumberFor1598,
              updated_at: new Date().toISOString()
            })
            .eq('id', deal1598Proforma.id);

          if (updateError) {
            logger.error('Ошибка при изменении номера:', updateError);
          } else {
            logger.info(`✅ Номер изменен для deal 1598: CO-PROF 137/2025 → ${newNumberFor1598}`);

            // Теперь изменим плательщика для deal 1600
            const { error: update1600Error } = await supabase
              .from('proformas')
              .update({
                buyer_name: 'Mariia Pankova',
                buyer_alt_name: 'Mariia Pankova',
                updated_at: new Date().toISOString()
              })
              .eq('id', deal1600Proforma.id);

            if (update1600Error) {
              logger.error('Ошибка при изменении плательщика:', update1600Error);
            } else {
              logger.info('✅ Плательщик изменен для deal 1600: Siergiej Żarkiewicz → Mariia Pankova');
              logger.info('✅ CO-PROF 137/2025 теперь принадлежит Mariia Pankova (deal 1600)');
            }
          }
        } else {
          logger.info('Операция отменена');
        }
        rl.close();
      });

    } else {
      logger.info('Конфликта нет - CO-PROF 137/2025 принадлежит только одному deal');

      // Найдем единственную проформу
      const singleProforma = proformas137[0];

      if (singleProforma.pipedrive_deal_id === 1600) {
        // Уже принадлежит правильному deal, изменим только плательщика
        logger.info('CO-PROF 137/2025 уже принадлежит deal 1600, меняю плательщика...');

        const { error: updateError } = await supabase
          .from('proformas')
          .update({
            buyer_name: 'Mariia Pankova',
            buyer_alt_name: 'Mariia Pankova',
            updated_at: new Date().toISOString()
          })
          .eq('id', singleProforma.id);

        if (updateError) {
          logger.error('Ошибка при изменении плательщика:', updateError);
        } else {
          logger.info('✅ Плательщик изменен: Siergiej Żarkiewicz → Mariia Pankova');
        }

      } else {
        logger.info(`CO-PROF 137/2025 принадлежит deal ${singleProforma.pipedrive_deal_id}, а не 1600`);
      }
    }

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

resolveCoprof137Conflict();
