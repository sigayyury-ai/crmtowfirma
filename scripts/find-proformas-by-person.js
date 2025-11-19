#!/usr/bin/env node

/**
 * Скрипт для поиска проформ по Person ID
 * Сначала получает данные персоны из Pipedrive, затем ищет проформы по email
 * 
 * Использование:
 *   node scripts/find-proformas-by-person.js 863
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const ProformaRepository = require('../src/services/proformaRepository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const PERSON_ID = process.argv[2] || 863;

async function findProformasByPerson() {
  try {
    const repository = new ProformaRepository();
    const pipedriveClient = new PipedriveClient();
    
    if (!repository.isEnabled()) {
      console.error('❌ Supabase не настроен (SUPABASE_URL или SUPABASE_KEY отсутствуют)');
      process.exit(1);
    }

    console.log(`🔍 Поиск проформ для Person ID: ${PERSON_ID}\n`);

    // Получаем данные персоны из Pipedrive
    console.log('📡 Получение данных персоны из Pipedrive...');
    const personResult = await pipedriveClient.client.get(`/persons/${PERSON_ID}`, {
      params: {
        api_token: pipedriveClient.apiToken
      }
    });

    if (!personResult.data?.success || !personResult.data?.data) {
      console.error('❌ Персона не найдена в Pipedrive');
      process.exit(1);
    }

    const person = personResult.data.data;
    const personEmails = person.email || [];
    const primaryEmail = personEmails.find(e => e.primary)?.value || personEmails[0]?.value || null;

    console.log(`✅ Персона: ${person.name || 'не указано'}`);
    console.log(`   Email: ${primaryEmail || 'не указан'}`);
    console.log(`   Всего email: ${personEmails.length}\n`);

    if (!primaryEmail) {
      console.log('⚠️  У персоны нет email, поиск проформ невозможен');
      return;
    }

    // Ищем проформы по email
    console.log(`🔍 Поиск проформ по email: ${primaryEmail}\n`);
    
    const { data: proformas, error } = await repository.supabase
      .from('proformas')
      .select(`
        id,
        fullnumber,
        currency,
        total,
        payments_total,
        payments_total_pln,
        payments_count,
        buyer_name,
        buyer_email,
        buyer_phone,
        buyer_city,
        buyer_country,
        pipedrive_deal_id,
        issued_at,
        status,
        deleted_at
      `)
      .eq('buyer_email', primaryEmail)
      .order('issued_at', { ascending: false });

    if (error) {
      throw error;
    }

    if (!proformas || proformas.length === 0) {
      console.log('❌ Проформы не найдены');
      
      // Проверяем другие email персоны
      if (personEmails.length > 1) {
        console.log('\n🔍 Проверка других email персоны...');
        for (const emailObj of personEmails) {
          if (emailObj.value === primaryEmail) continue;
          
          const { data: otherProformas } = await repository.supabase
            .from('proformas')
            .select('id, fullnumber, buyer_email, pipedrive_deal_id')
            .eq('buyer_email', emailObj.value);
          
          if (otherProformas && otherProformas.length > 0) {
            console.log(`\n✅ Найдено проформ по email ${emailObj.value}: ${otherProformas.length}`);
            otherProformas.forEach(p => {
              console.log(`   - ${p.fullnumber || p.id} (Deal: ${p.pipedrive_deal_id || 'не указан'})`);
            });
          }
        }
      }
      
      return;
    }

    console.log(`✅ Найдено проформ: ${proformas.length}\n`);
    console.log('📋 Список проформ:');
    console.log('─'.repeat(80));

    proformas.forEach((proforma, index) => {
      console.log(`\n${index + 1}. ID: ${proforma.id}`);
      console.log(`   Номер: ${proforma.fullnumber || 'не указан'}`);
      console.log(`   Deal ID: ${proforma.pipedrive_deal_id || 'не указан'}`);
      console.log(`   Валюта: ${proforma.currency || 'не указана'}`);
      console.log(`   Сумма: ${proforma.total || 0}`);
      console.log(`   Оплачено: ${proforma.payments_total || 0}`);
      console.log(`   Покупатель: ${proforma.buyer_name || 'не указан'}`);
      console.log(`   Email: ${proforma.buyer_email || 'не указан'}`);
      if (proforma.issued_at) {
        console.log(`   Создана: ${new Date(proforma.issued_at).toLocaleString('ru-RU')}`);
      }
      if (proforma.deleted_at) {
        console.log(`   ⚠️  Удалена: ${new Date(proforma.deleted_at).toLocaleString('ru-RU')}`);
      }
    });

    console.log('\n' + '─'.repeat(80));
  } catch (error) {
    logger.error('Ошибка при поиске проформ:', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

findProformasByPerson();

