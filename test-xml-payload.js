require('dotenv').config();
const InvoiceProcessingService = require('./src/services/invoiceProcessing');

// Устанавливаем переменные окружения для тестирования
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = 'b90c19c9d6926305725556800560268f';
process.env.WFIRMA_SECRET_KEY = 'b3351c5e051c801b54838aac4cad8098';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

async function testXMLPayload() {
  console.log('📄 Testing XML Payload for Proforma Creation...\n');
  
  try {
    const invoiceProcessing = new InvoiceProcessingService();

    console.log('📋 Configuration:');
    console.log(`   - Language: ${invoiceProcessing.DEFAULT_LANGUAGE}`);
    console.log(`   - Description: ${invoiceProcessing.DEFAULT_DESCRIPTION}`);
    console.log(`   - Payment Method: ${invoiceProcessing.PAYMENT_METHOD}`);
    console.log(`   - VAT Rate: ${invoiceProcessing.VAT_RATE}%`);
    console.log('');

    // Получаем данные сделки
    console.log('1. Fetching deal data...');
    const dealResult = await invoiceProcessing.pipedriveClient.getDealWithRelatedData(1516);
    if (!dealResult.success) {
      console.log(`❌ Failed to fetch deal: ${dealResult.error}`);
      return;
    }

    const { deal, person, organization } = dealResult;
    console.log(`✅ Deal fetched: ${deal.title} (${deal.currency})`);

    // Получаем банковский счет
    console.log('\n2. Getting bank account...');
    const bankAccountResult = await invoiceProcessing.getBankAccountByCurrency(deal.currency);
    if (!bankAccountResult.success) {
      console.log(`❌ Failed to get bank account: ${bankAccountResult.error}`);
      return;
    }

    const bankAccount = bankAccountResult.bankAccount;
    console.log(`✅ Bank account: ${bankAccount.name}`);

    // Подготавливаем данные контрагента
    console.log('\n3. Preparing contractor data...');
    const email = invoiceProcessing.getCustomerEmail(person, organization);
    const contractorData = invoiceProcessing.prepareContractorData(person, organization, email);
    console.log(`✅ Contractor: ${contractorData.name} (${contractorData.email})`);

    // Рассчитываем сумму
    console.log('\n4. Calculating amount...');
    const amountResult = await invoiceProcessing.calculateInvoiceAmount(deal.value, 'PROFORMA', deal);
    if (!amountResult.success) {
      console.log(`❌ Failed to calculate amount: ${amountResult.error}`);
      return;
    }

    console.log(`✅ Amount: ${amountResult.amount} ${deal.currency}`);

    // Создаем XML payload (без отправки)
    console.log('\n5. Generating XML payload...');
    const issueDate = new Date().toISOString().split('T')[0];
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + invoiceProcessing.PAYMENT_TERMS_DAYS);
    const dueDateStr = dueDate.toISOString().split('T')[0];

    const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <invoices>
        <invoice>
            <name>Proforma ${deal.title}</name>
            <date>${issueDate}</date>
            <paymentdate>${dueDateStr}</paymentdate>
            <paymentmethod>${invoiceProcessing.PAYMENT_METHOD}</paymentmethod>
            <language>${invoiceProcessing.DEFAULT_LANGUAGE}</language>
            <currency>${deal.currency}</currency>
            <bankaccount>${bankAccount.name}</bankaccount>
            <description>${invoiceProcessing.DEFAULT_DESCRIPTION}</description>
            <contractor>
                <name>${contractorData.name}</name>
                <email>${contractorData.email}</email>
                <zip>${contractorData.zip || '80-000'}</zip>
                <city>${contractorData.city || 'Gdańsk'}</city>
                <country>${contractorData.country || 'PL'}</country>
                ${contractorData.business_id ? `<nip>${contractorData.business_id}</nip>` : ''}
            </contractor>
            <type>normal</type>
            <type_of_sale>WSTO_EE</type_of_sale>
            <invoicecontents>
                <invoicecontent>
                    <name>${deal.title || 'Camp / Tourist service'}</name>
                    <count>1.0000</count>
                    <unit_count>1.0000</unit_count>
                    <price>${amountResult.amount}</price>
                    <unit>szt.</unit>
                </invoicecontent>
            </invoicecontents>
            <company_id>${invoiceProcessing.wfirmaClient.companyId}</company_id>
        </invoice>
    </invoices>
</api>`;

    console.log('✅ XML Payload generated successfully!');
    console.log('\n📄 XML Payload Preview:');
    console.log('─'.repeat(60));
    console.log(xmlPayload);
    console.log('─'.repeat(60));

    console.log('\n🌍 Language Settings in XML:');
    console.log(`   ✅ Language: ${invoiceProcessing.DEFAULT_LANGUAGE}`);
    console.log(`   ✅ Description: English text`);
    console.log(`   ✅ Payment Method: ${invoiceProcessing.PAYMENT_METHOD}`);
    console.log(`   ✅ Currency: ${deal.currency}`);
    console.log(`   ✅ Bank Account: ${bankAccount.name}`);

  } catch (error) {
    console.error('💥 Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    console.log('\n🏁 XML payload test completed');
  }
}

testXMLPayload();




