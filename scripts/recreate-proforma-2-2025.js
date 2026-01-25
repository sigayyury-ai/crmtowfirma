#!/usr/bin/env node

/**
 * Попытка восстановить проформу CO-PROF 2/2025 с оригинальным номером и датой
 * ВАЖНО: wFirma обычно не позволяет указать номер вручную, но попробуем
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const InvoiceProcessingService = require('../src/services/invoiceProcessing');
const PipedriveClient = require('../src/services/pipedrive');
const WfirmaClient = require('../src/services/wfirma');
const logger = require('../src/utils/logger');
const axios = require('axios');

async function recreateProforma() {
  try {
    console.log('\n🔄 Попытка восстановить проформу CO-PROF 2/2025\n');

    const proformaId = '383528200';
    const dealId = 2059;

    // 1. Получаем данные проформы
    const { data: proforma, error: fetchError } = await supabase
      .from('proformas')
      .select('*')
      .eq('id', proformaId)
      .single();

    if (fetchError || !proforma) {
      console.error('❌ Ошибка получения проформы:', fetchError);
      return;
    }

    console.log('📋 Данные оригинальной проформы:');
    console.log(`   Номер: ${proforma.fullnumber}`);
    console.log(`   Дата выдачи: ${proforma.issued_at}`);
    console.log(`   Сумма: ${proforma.total} ${proforma.currency}`);
    console.log(`   Плательщик: ${proforma.buyer_name}`);

    // 2. Получаем продукты
    const { data: products } = await supabase
      .from('proforma_products')
      .select('*, products(name)')
      .eq('proforma_id', proformaId);

    console.log(`\n📦 Продукты: ${products?.length || 0}`);
    if (products && products.length > 0) {
      products.forEach(p => {
        console.log(`   - ${p.products?.name || 'N/A'} | Цена: ${p.unit_price || 'N/A'}`);
      });
    }

    // 3. Получаем данные сделки
    const pipedriveClient = new PipedriveClient();
    const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
    
    if (!dealResult.success) {
      console.error('❌ Ошибка получения сделки:', dealResult.error);
      return;
    }

    const deal = dealResult.deal;
    const person = dealResult.person;
    const organization = dealResult.organization;

    console.log(`\n📋 Данные сделки #${dealId}:`);
    console.log(`   Название: ${deal.title}`);
    console.log(`   Сумма: ${deal.value} ${deal.currency}`);

    // 4. Подготавливаем данные для создания проформы
    const invoiceProcessing = new InvoiceProcessingService();
    const wfirmaClient = new WfirmaClient();

    // Получаем контрагента
    const email = person?.email?.[0]?.value || person?.email;
    if (!email) {
      console.error('❌ Email клиента не найден');
      return;
    }

    const contractorData = invoiceProcessing.prepareContractorData(person, organization, email);
    const contractorResult = await invoiceProcessing.userManagement.findOrCreateContractor(contractorData);
    
    if (!contractorResult.success) {
      console.error('❌ Ошибка получения контрагента:', contractorResult.error);
      return;
    }

    const contractor = contractorResult.contractor;
    console.log(`\n✅ Контрагент: ${contractor.name} (ID: ${contractor.id})`);

    // 5. Подготавливаем продукт
    const product = {
      id: null,
      name: products && products.length > 0 ? products[0].products?.name || 'Ski France' : 'Ski France',
      price: proforma.total,
      unit: 'szt.',
      type: 'service',
      quantity: 1
    };

    // 6. Пробуем создать проформу с оригинальной датой и номером
    const originalDate = proforma.issued_at ? new Date(proforma.issued_at) : new Date('2025-08-06');
    const issueDateStr = originalDate.toISOString().split('T')[0];
    
    // Рассчитываем payment_date (оригинальная дата + 3 дня)
    const paymentDate = new Date(originalDate);
    paymentDate.setDate(paymentDate.getDate() + 3);
    const paymentDateStr = paymentDate.toISOString().split('T')[0];

    console.log(`\n📅 Даты для создания:`);
    console.log(`   Дата выдачи: ${issueDateStr}`);
    console.log(`   Дата оплаты: ${paymentDateStr}`);

    // 7. Создаем XML payload с попыткой указать номер
    const invoiceDescription = 'VAT marża';
    const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <invoices>
        <invoice>
            <type>proforma</type>
            <issue_date>${issueDateStr}</issue_date>
            <payment_date>${paymentDateStr}</payment_date>
            <payment_type>transfer</payment_type>
            <language>en</language>
            <currency>${proforma.currency}</currency>
            <description>${invoiceDescription}</description>
            <vat_exemption_reason>nie podl.</vat_exemption_reason>
            <contractor>
                <id>${contractor.id}</id>
            </contractor>
            <invoicecontents>
                <invoicecontent>
                    <name>${product.name}</name>
                    <count>1</count>
                    <unit_count>1</unit_count>
                    <price>${proforma.total}</price>
                    <is_net>false</is_net>
                    <brutto>${proforma.total}</brutto>
                    <unit>szt.</unit>
                    <vat_code_id>230</vat_code_id>
                    <vat_rate>0</vat_rate>
                </invoicecontent>
            </invoicecontents>
        </invoice>
    </invoices>
</api>`;

    console.log(`\n📡 Отправка запроса в wFirma API...`);
    console.log(`   Endpoint: /invoices/add`);
    console.log(`   Попытка указать дату: ${issueDateStr}`);
    console.log(`   ⚠️  Номер проформы будет сгенерирован автоматически wFirma`);

    const xmlClient = axios.create({
      baseURL: wfirmaClient.baseURL,
      headers: {
        'Content-Type': 'application/xml',
        'Accept': 'application/xml',
        'accessKey': wfirmaClient.accessKey,
        'secretKey': wfirmaClient.secretKey,
        'appKey': wfirmaClient.appKey
      },
      timeout: 15000
    });

    const endpoint = `/invoices/add?outputFormat=xml&inputFormat=xml&company_id=${wfirmaClient.companyId}`;
    const response = await xmlClient.post(endpoint, xmlPayload);

    // Обрабатываем ответ
    if (response.data) {
      if (typeof response.data === 'string' && response.data.includes('<?xml')) {
        if (response.data.includes('<code>OK</code>') || response.data.includes('<id>')) {
          const idMatch = response.data.match(/<id>(\d+)<\/id>/);
          const newInvoiceId = idMatch ? idMatch[1] : null;
          
          const numberMatch = response.data.match(/<number>(.*?)<\/number>/);
          const fullnumberMatch = response.data.match(/<fullnumber>(.*?)<\/fullnumber>/);
          const newNumber = fullnumberMatch ? fullnumberMatch[1] : (numberMatch ? numberMatch[1] : null);

          console.log(`\n✅ Проформа создана в wFirma:`);
          console.log(`   Новый ID: ${newInvoiceId}`);
          console.log(`   Новый номер: ${newNumber || 'N/A'}`);
          console.log(`   ⚠️  Номер отличается от оригинала (CO-PROF 2/2025)`);
          console.log(`   ✅ Дата выдачи: ${issueDateStr} (как в оригинале)`);

          // Обновляем запись в базе с новым ID
          if (newInvoiceId) {
            console.log(`\n💾 Обновление записи в базе данных...`);
            
            const { error: updateError } = await supabase
              .from('proformas')
              .update({
                id: newInvoiceId,
                fullnumber: newNumber || proforma.fullnumber,
                status: 'active',
                deleted_at: null,
                updated_at: new Date().toISOString()
              })
              .eq('id', proformaId);

            if (updateError) {
              console.error('❌ Ошибка обновления:', updateError);
              console.log(`\n💡 Создайте новую запись вручную или используйте ID: ${newInvoiceId}`);
            } else {
              console.log(`✅ Запись обновлена с новым ID wFirma`);
            }
          }

        } else if (response.data.includes('<code>ERROR</code>')) {
          const errorMatch = response.data.match(/<message>(.*?)<\/message>/);
          const errorMessage = errorMatch ? errorMatch[1] : 'Unknown error';
          console.error(`\n❌ Ошибка wFirma API: ${errorMessage}`);
        } else {
          console.error(`\n❌ Неожиданный ответ от wFirma`);
          console.log(response.data.substring(0, 500));
        }
      } else {
        console.error(`\n❌ Неожиданный формат ответа`);
      }
    }

  } catch (error) {
    logger.error('Ошибка:', error);
    console.error('\n❌ Критическая ошибка:', error.message);
    if (error.response?.data) {
      console.error('Ответ wFirma:', error.response.data.substring(0, 500));
    }
  }
}

recreateProforma();
