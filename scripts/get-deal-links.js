#!/usr/bin/env node

/**
 * Получение ссылок на диалоги (сделки и персоны) в Pipedrive
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const DEAL_IDS = [1648, 1660, 1661];
const PIPEDRIVE_DOMAIN = 'comoon.pipedrive.com';

async function getDealLinks() {
  try {
    const pipedriveClient = new PipedriveClient();

    console.log('🔗 Получение ссылок на диалоги в Pipedrive...\n');

    const links = [];

    for (const dealId of DEAL_IDS) {
      try {
        // Получаем данные сделки
        const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
        if (!dealResult || !dealResult.success) {
          console.log(`❌ Deal #${dealId}: Не удалось получить данные`);
          continue;
        }

        const deal = dealResult.deal;
        const person = dealResult.person;
        const organization = dealResult.organization;

        const dealTitle = deal.title || 'Без названия';
        const customerEmail = person?.email?.[0]?.value || person?.email || 'N/A';
        const personName = person?.name || 'N/A';
        const personId = person?.id || null;
        const orgName = organization?.name || null;
        const orgId = organization?.id || null;

        // Формируем ссылки
        const dealLink = `https://${PIPEDRIVE_DOMAIN}/deal/${dealId}`;
        const personLink = personId ? `https://${PIPEDRIVE_DOMAIN}/person/${personId}` : null;
        const orgLink = orgId ? `https://${PIPEDRIVE_DOMAIN}/organization/${orgId}` : null;

        links.push({
          dealId,
          dealTitle,
          customerEmail,
          personName,
          personId,
          orgName,
          orgId,
          dealLink,
          personLink,
          orgLink
        });

      } catch (error) {
        logger.error(`Ошибка при получении данных для Deal #${dealId}`, { error: error.message });
        console.log(`❌ Deal #${dealId}: ${error.message}`);
      }
    }

    // Выводим результаты
    console.log('\n' + '='.repeat(100));
    console.log('📋 ССЫЛКИ НА ДИАЛОГИ В PIPEDRIVE');
    console.log('='.repeat(100) + '\n');

    links.forEach((item, index) => {
      console.log(`${index + 1}. Deal #${item.dealId}: ${item.dealTitle}`);
      console.log(`   📧 Email: ${item.customerEmail}`);
      console.log(`   👤 Персона: ${item.personName}`);
      console.log(`   🏢 Организация: ${item.orgName || 'N/A'}`);
      console.log(`\n   🔗 Ссылки:`);
      console.log(`      Сделка: ${item.dealLink}`);
      if (item.personLink) {
        console.log(`      Персона (диалог): ${item.personLink}`);
      }
      if (item.orgLink) {
        console.log(`      Организация: ${item.orgLink}`);
      }
      console.log('');
    });

    console.log('='.repeat(100));
    console.log('\n📋 КОПИРУЕМЫЕ ССЫЛКИ:\n');

    links.forEach((item, index) => {
      console.log(`${index + 1}. Deal #${item.dealId} - ${item.dealTitle}`);
      console.log(`   Сделка: ${item.dealLink}`);
      if (item.personLink) {
        console.log(`   Диалог: ${item.personLink}`);
      }
      console.log('');
    });

  } catch (error) {
    logger.error('Ошибка при получении ссылок:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

getDealLinks();
