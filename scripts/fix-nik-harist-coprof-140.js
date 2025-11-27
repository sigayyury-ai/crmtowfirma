require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function fixNikHaristCoprof140() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Исправляю CO-PROF 140/2025 для Nik Harist (Deal #1600)...');

    // Шаг 1: Проверим, существует ли уже CO-PROF 140/2025
    const { data: existing140, error: find140Error } = await supabase
      .from('proformas')
      .select('*')
      .eq('fullnumber', 'CO-PROF 140/2025');

    if (find140Error && find140Error.code !== 'PGRST116') {
      logger.error('Ошибка при поиске CO-PROF 140/2025:', find140Error);
      return;
    }

    if (existing140 && existing140.length > 0) {
      logger.info('CO-PROF 140/2025 уже существует:');
      existing140.forEach(p => {
        logger.info(`  ID: ${p.id}, deal: ${p.pipedrive_deal_id}, buyer: ${p.buyer_name}`);
      });

      // Если она уже принадлежит правильному deal 1600, просто изменим плательщика
      const forDeal1600 = existing140.find(p => p.pipedrive_deal_id === 1600);
      if (forDeal1600) {
        logger.info('CO-PROF 140/2025 уже принадлежит deal 1600, меняю плательщика...');

        const { error: updateError } = await supabase
          .from('proformas')
          .update({
            buyer_name: 'Nik Harist',
            buyer_alt_name: 'Nik Harist',
            updated_at: new Date().toISOString()
          })
          .eq('id', forDeal1600.id);

        if (updateError) {
          logger.error('Ошибка при обновлении плательщика:', updateError);
        } else {
          logger.info('✅ Плательщик изменен на Nik Harist');
        }
        return;
      }

      // Если принадлежит другому deal, нужно найти свободный номер для того deal
      logger.info('CO-PROF 140/2025 принадлежит другому deal, нужно переназначить...');

      const otherDealProforma = existing140[0];
      // Найдем свободный номер для текущего владельца
      let freeNumber = 141;
      while (true) {
        const { data: checkNumber } = await supabase
          .from('proformas')
          .select('id')
          .eq('fullnumber', `CO-PROF ${freeNumber}/2025`)
          .single();

        if (!checkNumber) break;
        freeNumber++;
      }

      logger.info(`Найден свободный номер для deal ${otherDealProforma.pipedrive_deal_id}: ${freeNumber}`);

      // Изменим номер для текущего владельца
      const { error: reassignError } = await supabase
        .from('proformas')
        .update({
          fullnumber: `CO-PROF ${freeNumber}/2025`,
          updated_at: new Date().toISOString()
        })
        .eq('id', otherDealProforma.id);

      if (reassignError) {
        logger.error('Ошибка при переназначении номера:', reassignError);
        return;
      }

      logger.info(`✅ Deal ${otherDealProforma.pipedrive_deal_id}: CO-PROF 140/2025 → CO-PROF ${freeNumber}/2025`);
    }

    // Шаг 2: Теперь изменим существующую проформу deal 1600
    const { data: deal1600Proforma, error: find1600Error } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', 1600)
      .eq('status', 'active')
      .single();

    if (find1600Error || !deal1600Proforma) {
      logger.error('Не найдена активная проформа для deal 1600');
      return;
    }

    logger.info(`Найдена проформа deal 1600: ${deal1600Proforma.fullnumber} (${deal1600Proforma.buyer_name})`);

    // Изменим на CO-PROF 140/2025 с Nik Harist
    const { error: update1600Error } = await supabase
      .from('proformas')
      .update({
        fullnumber: 'CO-PROF 140/2025',
        buyer_name: 'Nik Harist',
        buyer_alt_name: 'Nik Harist',
        updated_at: new Date().toISOString()
      })
      .eq('id', deal1600Proforma.id);

    if (update1600Error) {
      logger.error('Ошибка при обновлении deal 1600:', update1600Error);
      return;
    }

    logger.info('✅ Deal 1600 обновлен:');
    logger.info(`  fullnumber: ${deal1600Proforma.fullnumber} → CO-PROF 140/2025`);
    logger.info(`  buyer_name: ${deal1600Proforma.buyer_name} → Nik Harist`);

    logger.info('Исправление завершено успешно! 🎉');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

// Запросим подтверждение
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Исправить CO-PROF 140/2025 для Nik Harist (Deal #1600)? (yes/no): ', (answer) => {
  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    fixNikHaristCoprof140().then(() => {
      rl.close();
    });
  } else {
    logger.info('Операция отменена');
    rl.close();
  }
});
