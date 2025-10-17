require('dotenv').config();
const InvoiceProcessingService = require('./src/services/invoiceProcessing');

// Устанавливаем переменные окружения для тестирования
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = 'b90c19c9d6926305725556800560268f';
process.env.WFIRMA_SECRET_KEY = 'd096f54b74c3f4adeb2fd4ab362cd085';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';

async function debugProformaXML() {
  console.log('🔍 Debugging Proforma XML Structure...\n');

  const invoiceProcessingService = new InvoiceProcessingService();

  // Получаем данные сделки
  const PipedriveClient = require('./src/services/pipedrive');
  const pipedriveClient = new PipedriveClient();
  
  console.log('1. Fetching deal 1516 data...');
  const dealResult = await pipedriveClient.getDealWithRelatedData(1516);
  
  if (!dealResult.success) {
    console.log('❌ Failed to get deal data:', dealResult.error);
    return;
  }

  const { deal, person, organization } = dealResult;
  console.log('✅ Deal data fetched');
  console.log(`   Deal: ${deal.title} (${deal.currency} ${deal.value})`);
  console.log(`   Person: ${person?.name || 'N/A'}`);

  // Получаем банковский счет
  console.log('\n2. Getting bank account...');
  const bankAccountResult = await invoiceProcessingService.getBankAccountByCurrency(deal.currency);
  
  if (!bankAccountResult.success) {
    console.log('❌ Failed to get bank account:', bankAccountResult.error);
    return;
  }

  const bankAccount = bankAccountResult.bankAccount;
  console.log(`✅ Bank account: ${bankAccount.name}`);

  // Подготавливаем данные контрагента
  console.log('\n3. Preparing contractor data...');
  const email = invoiceProcessingService.getCustomerEmail(person, organization);
  const contractorData = invoiceProcessingService.prepareContractorData(person, organization, email);
  console.log(`✅ Contractor: ${contractorData.name} (${contractorData.email})`);

  // Создаем XML payload вручную для отладки
  console.log('\n4. Creating XML payload...');
  
  const issueDate = new Date().toISOString().split('T')[0];
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 7);
  const dueDateStr = dueDate.toISOString().split('T')[0];
  
  const amount = 100; // Тестовая сумма
  
  const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <invoices>
        <invoice>
            <name>Proforma ${deal.title}</name>
            <date>${issueDate}</date>
            <paymentdate>${dueDateStr}</paymentdate>
            <paymentmethod>transfer</paymentmethod>
            <language>en</language>
            <currency>${deal.currency}</currency>
            <bankaccount>${bankAccount.name}</bankaccount>
            <description>Camp / Tourist service</description>
            <contractor>
                <id>158055520</id>
            </contractor>
            <kind>proforma</kind>
            <type_of_sale>WSTO_EE</type_of_sale>
            <invoicecontents>
                <invoicecontent>
                    <name>${deal.title || 'Camp / Tourist service'}</name>
                    <count>1.0000</count>
                    <unit_count>1.0000</unit_count>
                    <price>${amount}</price>
                    <unit>szt.</unit>
                </invoicecontent>
            </invoicecontents>
            <company_id>885512</company_id>
        </invoice>
    </invoices>
</api>`;

  console.log('\n📄 Generated XML Payload:');
  console.log('='.repeat(80));
  console.log(xmlPayload);
  console.log('='.repeat(80));

  console.log('\n🔍 Key Parameters:');
  console.log(`   Endpoint: /invoices/add?outputFormat=xml&inputFormat=xml`);
  console.log(`   Kind: proforma`);
  console.log(`   Type of sale: WSTO_EE`);
  console.log(`   Currency: ${deal.currency}`);
  console.log(`   Bank account: ${bankAccount.name}`);
  console.log(`   Language: en`);
  console.log(`   Payment method: transfer`);

  console.log('\n🏁 Debug completed\n');
}

debugProformaXML();




