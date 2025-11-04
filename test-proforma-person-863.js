require('dotenv').config();
const InvoiceProcessingService = require('./src/services/invoiceProcessing');
const PipedriveClient = require('./src/services/pipedrive');

async function testProformaForPerson863() {
  try {
    console.log('🧪 Тестирование создания проформы для персоны 863...\n');
    
    const pipedriveClient = new PipedriveClient();
    const invoiceProcessing = new InvoiceProcessingService();
    
    // 1. Получаем данные персоны 863
    console.log('1️⃣ Получаем данные персоны 863...');
    const personResult = await pipedriveClient.getPerson(863);
    
    if (!personResult.success) {
      console.error('❌ Ошибка получения персоны:', personResult.error);
      process.exit(1);
    }
    
    const person = personResult.person;
    console.log('✅ Персона получена:', {
      id: person.id,
      name: person.name,
      email: person.email?.[0]?.value || 'No email',
      address: person.postal_address || 'No address'
    });
    
    // 2. Создаем тестовую сделку (в памяти, не в Pipedrive)
    console.log('\n2️⃣ Создаем тестовые данные сделки...');
    const testDeal = {
      id: 999999, // Тестовый ID
      title: 'Test Proforma - Yury Sihai',
      value: 1000,
      currency: 'PLN',
      status: 'open',
      person_id: {
        value: 863,
        name: person.name
      },
      // Добавляем invoice_type = 70 (Proforma) для теста
      ad67729ecfe0345287b71a3b00910e8ba5b3b496: '70'
    };
    
    console.log('✅ Тестовая сделка создана:', {
      id: testDeal.id,
      title: testDeal.title,
      value: testDeal.value,
      currency: testDeal.currency
    });
    
    // 3. Создаем проформу напрямую через внутренние методы
    console.log('\n3️⃣ Создаем проформу в wFirma...');
    
    // Валидация данных
    const validationResult = await invoiceProcessing.validateDealForInvoice(testDeal, person, null);
    if (!validationResult.success) {
      console.error('❌ Ошибка валидации:', validationResult.error);
      process.exit(1);
    }
    
    // Определяем тип счета
    const invoiceType = invoiceProcessing.getInvoiceTypeFromDeal(testDeal);
    if (!invoiceType) {
      console.error('❌ Ошибка: invoice_type не найден');
      process.exit(1);
    }
    
    // Получаем email клиента
    const email = invoiceProcessing.getCustomerEmail(person, null);
    if (!email) {
      console.error('❌ Ошибка: email клиента не найден');
      process.exit(1);
    }
    
    console.log('✅ Email клиента:', email);
    
    // Подготавливаем данные контрагента
    const contractorData = invoiceProcessing.prepareContractorData(person, null, email);
    console.log('✅ Данные контрагента подготовлены:', {
      name: contractorData.name,
      email: contractorData.email,
      address: contractorData.address,
      city: contractorData.city,
      country: contractorData.country
    });
    
    // Ищем или создаем контрагента в wFirma
    console.log('\n4️⃣ Ищем или создаем контрагента в wFirma...');
    const contractorResult = await invoiceProcessing.userManagement.findOrCreateContractor(contractorData);
    if (!contractorResult.success) {
      console.error('❌ Ошибка создания контрагента:', contractorResult.error);
      process.exit(1);
    }
    
    const contractor = contractorResult.contractor;
    console.log('✅ Контрагент готов:', {
      id: contractor.id,
      name: contractor.name
    });
    
    // Создаем тестовый продукт
    const product = {
      id: null,
      name: 'Test Proforma - Yury Sihai',
      price: 1000,
      unit: 'szt.',
      type: 'service',
      quantity: 1
    };
    
    console.log('\n5️⃣ Создаем проформу в wFirma...');
    const invoiceResult = await invoiceProcessing.createInvoiceInWfirma(
      testDeal,
      contractor,
      product,
      invoiceType
    );
    
    if (!invoiceResult.success) {
      console.error('❌ Ошибка создания проформы:', invoiceResult.error);
      if (invoiceResult.details) {
        console.error('Детали:', invoiceResult.details);
      }
      process.exit(1);
    }
    
    if (!invoiceResult.invoiceId) {
      console.error('❌ Ошибка: invoiceId отсутствует');
      process.exit(1);
    }
    
    console.log('✅ Проформа создана! Invoice ID:', invoiceResult.invoiceId);
    
    // Отправляем проформу по email
    console.log('\n6️⃣ Отправляем проформу по email...');
    
    // Используем номер проформы (PRO-...) вместо ID, если он доступен
    const invoiceNumberForEmail = invoiceResult.invoiceNumber || invoiceResult.invoiceId;
    console.log('📄 Invoice Number:', invoiceNumberForEmail);
    
    const emailResult = await invoiceProcessing.sendInvoiceByEmail(
      invoiceResult.invoiceId,
      email,
      {
        subject: 'COMOON /  INVOICE  / Комьюнити для удаленщиков',
        body: `Привет. Внимательно посмотри, пожалуйста, сроки оплаты и график платежей. А также обязательно в назначении платежа укажи номер инвойса - ${invoiceNumberForEmail}.`
      }
    );
    
    if (!emailResult.success) {
      console.warn('⚠️ Ошибка отправки email:', emailResult.error);
    } else {
      console.log('✅ Проформа отправлена по email:', email);
    }
    
    const result = {
      success: true,
      invoiceId: invoiceResult.invoiceId,
      contractorName: contractorData.name,
      emailSent: emailResult.success
    };
    
    if (result.success) {
      console.log('\n✅ Проформа успешно создана!');
      console.log('📄 Invoice ID:', result.invoiceId);
      console.log('👤 Contractor:', result.contractorName);
      console.log('📧 Email:', person.email?.[0]?.value || 'No email');
      console.log('\n🎉 Тест завершен успешно!');
    } else {
      console.error('\n❌ Ошибка создания проформы:', result.error);
      if (result.details) {
        console.error('Детали:', result.details);
      }
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Критическая ошибка:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testProformaForPerson863();

