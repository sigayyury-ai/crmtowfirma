const WfirmaClient = require('../wfirma');
const logger = require('../../utils/logger');
const axios = require('axios');
const supabase = require('../supabaseClient');

const CRM_DEAL_BASE_URL = 'https://comoon.pipedrive.com/deal/';

class WfirmaLookup {
  constructor() {
    this.wfirmaClient = new WfirmaClient();
    this.companyId = '885512';
    this.baseURL = process.env.WFIRMA_BASE_URL || 'https://api2.wfirma.pl';
    
    // Настройки для работы с XML API wFirma
    this.xmlClient = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/xml',
        'Accept': 'application/xml',
        'accessKey': process.env.WFIRMA_ACCESS_KEY?.trim(),
        'secretKey': process.env.WFIRMA_SECRET_KEY?.trim(),
        'appKey': process.env.WFIRMA_APP_KEY?.trim()
      },
      timeout: 30000
    });
  }

  normalizeWhitespace(value) {
    return String(value).replace(/\s+/g, ' ').trim();
  }

  normalizeProductName(name) {
    if (!name) return null;
    const trimmed = this.normalizeWhitespace(name);
    if (!trimmed) return null;

    return trimmed
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s\.\-_/]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  extractTagValue(xml, tag) {
    if (!xml) return null;
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = xml.match(regex);
    if (!match) return null;
    return match[1].trim();
  }

  /**
   * Получить проформы за текущий месяц, сгруппированные по продуктам
   * @param {Object} options - Опции фильтрации
   * @param {Date} options.dateFrom - Дата начала периода (по умолчанию - начало текущего месяца)
   * @param {Date} options.dateTo - Дата окончания периода (по умолчанию - конец текущего месяца)
   * @returns {Promise<Array>} - Массив объектов с группировкой по продуктам
   */
  async getMonthlyProformasByProduct(options = {}) {
    try {
      const { dateFrom, dateTo } = this.resolveDateRange(options);

      logger.info('Fetching proforma data for frontend', {
        dateFrom: dateFrom.toISOString().split('T')[0],
        dateTo: dateTo.toISOString().split('T')[0]
      });

      const supabaseRows = await this.getProductRowsFromSupabase(dateFrom, dateTo);

      if (supabaseRows && supabaseRows.length > 0) {
        logger.info(`Supabase returned ${supabaseRows.length} product rows, using them for response`);
        return supabaseRows;
      }

      logger.warn('Supabase returned no product rows for requested range, falling back to wFirma API');

      const proformas = await this.getProformasByDateRange(dateFrom, dateTo);
      const productTable = this.createProductTable(proformas);

      logger.info(`Prepared ${productTable.length} product rows based on ${proformas.length} proformas from wFirma`);

      return productTable;
    } catch (error) {
      logger.error('Error getting monthly proformas by product:', error);
      throw error;
    }
  }

  resolveDateRange(options = {}) {
    const normalizeDate = (value) => {
      if (value instanceof Date) return value;
      if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }
      return null;
    };

    if (options.dateFrom && options.dateTo) {
      const dateFrom = normalizeDate(options.dateFrom);
      const dateTo = normalizeDate(options.dateTo);

      if (dateFrom && dateTo) {
        return { dateFrom, dateTo };
      }
    }

    if (typeof options.dateFrom === 'string' && typeof options.dateTo === 'string') {
      const dateFrom = normalizeDate(options.dateFrom);
      const dateTo = normalizeDate(options.dateTo);
      if (dateFrom && dateTo) {
        return { dateFrom, dateTo };
      }
    }

    if (typeof options.month === 'string') {
      const parsedMonth = parseInt(options.month, 10);
      if (!isNaN(parsedMonth)) {
        options.month = parsedMonth;
      }
    }

    if (typeof options.year === 'string') {
      const parsedYear = parseInt(options.year, 10);
      if (!isNaN(parsedYear)) {
        options.year = parsedYear;
      }
    }

    if (typeof options.month === 'number' && typeof options.year === 'number') {
      const month = options.month - 1; // JS months start at 0
      const year = options.year;
      const dateFrom = new Date(Date.UTC(year, month, 1));
      const dateTo = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
      return { dateFrom, dateTo };
    }

    if (options.dateFrom || options.dateTo) {
      const maybeFrom = normalizeDate(options.dateFrom) || new Date(0);
      const maybeTo = normalizeDate(options.dateTo) || new Date();
      return {
        dateFrom: maybeFrom,
        dateTo: maybeTo
      };
    }

    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
    return { dateFrom: start, dateTo: end };
  }

  async getProductRowsFromSupabase(dateFrom, dateTo) {
    if (!supabase) {
      logger.warn('Supabase client is not configured. Skipping Supabase fetch.');
      return [];
    }

    const dateFromStr = dateFrom.toISOString().split('T')[0];
    const dateToStr = dateTo.toISOString().split('T')[0];

    logger.info('Querying Supabase for proforma product rows', { dateFrom: dateFromStr, dateTo: dateToStr });

    const { data, error } = await supabase
      .from('proforma_products')
      .select(`
        proforma_id,
        quantity,
        unit_price,
        name,
        proformas (
          id,
          fullnumber,
          issued_at,
          currency,
          total,
          currency_exchange,
          payments_total,
          payments_total_pln,
          payments_currency_exchange,
          pipedrive_deal_id,
          buyer_name,
          buyer_alt_name,
          buyer_email,
          buyer_phone,
          buyer_street,
          buyer_zip,
          buyer_city,
          buyer_country,
          status
        ),
        products ( id, name, normalized_name )
      `)
      .gte('proformas.issued_at', dateFromStr)
      .lte('proformas.issued_at', dateToStr)
      .eq('proformas.status', 'active')
      .order('proforma_id', { ascending: true });

    if (error) {
      logger.error('Supabase error while fetching product rows:', error);
      return [];
    }

    if (!data || data.length === 0) {
      logger.info('Supabase returned no product rows for the requested range');
      return [];
    }

    const rows = [];
    let missingDealIdCount = 0;

    for (const row of data) {
      const proforma = row.proformas;
      if (!proforma) {
        logger.warn(`proforma_products row ${row.proforma_id} has no linked proforma, skipping`);
        continue;
      }

      const productName = row.products?.name || row.name || 'Без названия';
      const normalizedKey = row.products?.normalized_name
        || this.normalizeProductName(productName)
        || 'без названия';
      const productId = row.products?.id || null;
      const quantity = typeof row.quantity === 'number' ? row.quantity : parseFloat(row.quantity);
      const unitPrice = typeof row.unit_price === 'number' ? row.unit_price : parseFloat(row.unit_price);

      const lineQuantity = Number.isFinite(quantity) ? quantity : 1;
      const pricePerUnit = Number.isFinite(unitPrice) ? unitPrice : 0;
      const lineTotal = pricePerUnit * lineQuantity;

      const paymentsTotalPln = this.parseNumber(proforma.payments_total_pln);
      const paymentsTotal = this.parseNumber(proforma.payments_total);
      const currencyExchange = this.parseNumber(proforma.currency_exchange);
      const paymentsExchange = this.parseNumber(proforma.payments_currency_exchange) || currencyExchange || null;

      const proformaTotal = this.parseNumber(proforma.total) || 0;
      const dealIdRaw = proforma.pipedrive_deal_id;
      const dealId = dealIdRaw !== null && dealIdRaw !== undefined
        ? String(dealIdRaw).trim()
        : null;
      const dealUrl = dealId && dealId.length > 0
        ? `${CRM_DEAL_BASE_URL}${encodeURIComponent(dealId)}`
        : null;

      if (!dealId) {
        missingDealIdCount += 1;
      }

      rows.push({
        proforma_id: proforma.id,
        product_id: productId,
        product_key: normalizedKey,
        name: productName,
        fullnumber: proforma.fullnumber,
        date: proforma.issued_at,
        currency: proforma.currency || 'PLN',
        total: proformaTotal,
        proforma_total: proformaTotal,
        line_total: lineTotal || null,
        currency_exchange: currencyExchange,
        quantity: lineQuantity,
        unit_price: pricePerUnit,
        payments_total_pln: Number.isFinite(paymentsTotalPln)
          ? paymentsTotalPln
          : Number.isFinite(paymentsTotal) && Number.isFinite(paymentsExchange)
            ? paymentsTotal * paymentsExchange
            : paymentsTotal || 0,
        payments_total: Number.isFinite(paymentsTotal) ? paymentsTotal : 0,
        payments_currency_exchange: paymentsExchange,
        pipedrive_deal_id: dealId || null,
        pipedrive_deal_url: dealUrl,
        buyer_name: proforma.buyer_name || proforma.buyer_alt_name || null,
        buyer_alt_name: proforma.buyer_alt_name || null,
        buyer_email: proforma.buyer_email || null,
        buyer_phone: proforma.buyer_phone || null,
        buyer_street: proforma.buyer_street || null,
        buyer_zip: proforma.buyer_zip || null,
        buyer_city: proforma.buyer_city || null,
        buyer_country: proforma.buyer_country || null
      });
    }

    if (rows.length > 0) {
      logger.info('Supabase proforma rows fetched', {
        totalRows: rows.length,
        missingDealIdCount
      });
    }

    return rows;
  }

  parseNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  /**
   * Получить проформы из wFirma за указанный период
   * @param {Date} dateFrom - Дата начала
   * @param {Date} dateTo - Дата окончания
   * @returns {Promise<Array>} - Массив проформ
   */
  async getProformasByDateRange(dateFrom, dateTo) {
    try {
      // Форматируем даты для wFirma API (YYYY-MM-DD)
      const dateFromStr = dateFrom.toISOString().split('T')[0];
      const dateToStr = dateTo.toISOString().split('T')[0];

      logger.info('Fetching proformas from wFirma:', { 
        dateFrom: dateFromStr, 
        dateTo: dateToStr,
        dateFromObj: dateFrom.toISOString(),
        dateToObj: dateTo.toISOString()
      });

      let allInvoices = [];
      let page = 1;
      const requestedLimit = 20; // wFirma стабильно возвращает 20 записей на страницу
      let hasMore = true;

      // Делаем пагинацию для получения всех записей
      while (hasMore) {
      // Строим XML запрос для получения проформ
      // Пробуем без фильтра по типу, так как wFirma может не возвращать результаты с фильтром
      // Будем фильтровать по номеру CO-PROF при парсинге
      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <invoices>
        <parameters>
            <order>
                <asc>Invoice.id</asc>
            </order>
            <conditions>
                <condition>
                    <field>type</field>
                    <operator>eq</operator>
                    <value>proforma</value>
                </condition>
            </conditions>
            <fields>
                <field>Invoice.id</field>
                <field>Invoice.fullnumber</field>
                <field>Invoice.number</field>
                <field>Invoice.date</field>
                <field>Invoice.currency</field>
                <field>Invoice.currency_exchange</field>
                <field>Invoice.total</field>
                <field>Invoice.total_composed</field>
                <field>InvoiceContent.name</field>
                <field>InvoiceContent.count</field>
                <field>InvoiceContent.price</field>
                <field>InvoiceContent.good.id</field>
            </fields>
            <limit>${requestedLimit}</limit>
            <page>${page}</page>
        </parameters>
    </invoices>
</api>`;

        const endpoint = `/invoices/find?outputFormat=xml&inputFormat=xml&company_id=${this.companyId}`;

        logger.info(`Making request to wFirma API: ${endpoint}`, {
          page,
          requestedLimit,
          dateFrom: dateFromStr,
          dateTo: dateToStr
        });

        const response = await this.xmlClient.post(endpoint, xmlPayload);

        if (!response.data) {
          logger.warn(`Empty response from wFirma API for page ${page}`);
          hasMore = false;
          break;
        }

        // Парсим XML ответ вручную - не логируем весь ответ
        logger.debug(`Parsing XML response from wFirma, page ${page}`, {
          responseType: typeof response.data,
          responseLength: typeof response.data === 'string' ? response.data.length : 'N/A'
        });

        // Проверяем наличие ошибок в ответе
        if (typeof response.data === 'string' && (response.data.includes('<code>ERROR</code>') || response.data.includes('<error>'))) {
          const errorMatch = response.data.match(/<message>(.*?)<\/message>/);
          const errorMessage = errorMatch ? errorMatch[1] : 'Unknown error';
          logger.error('wFirma API returned an error in XML response', {
            error: errorMessage,
            page
          });
        }
        
        // Проверяем, есть ли invoice теги в ответе
        const hasInvoices = typeof response.data === 'string' && response.data.includes('<invoice>');
        logger.info(`Response contains invoice tags: ${hasInvoices}`);
        
        const invoices = await this.parseInvoicesFromXmlString(response.data, dateFrom, dateTo);
        
        logger.info(`Page ${page}: parsed ${invoices.length} proformas (CO-PROF only)`);
        
        // Добавляем найденные проформы
        if (invoices.length > 0) {
          allInvoices = allInvoices.concat(invoices);
        }
        
        // Проверяем, есть ли invoice теги в ответе
        const hasInvoiceTags = typeof response.data === 'string' && response.data.includes('<invoice>');
        
        // Если нет invoice тегов, прекращаем пагинацию
        if (!hasInvoiceTags) {
          logger.info('No invoice tags found in response, stopping pagination');
          hasMore = false;
          break;
        }
        
        // Проверяем, есть ли еще страницы
        // Если на странице меньше записей, чем лимит, значит это последняя страница
        // Но нужно проверить, сколько invoice тегов в ответе (не только CO-PROF)
        const invoiceTagsCount = (response.data.match(/<invoice>/g) || []).length;
        logger.debug(`Page ${page}: found ${invoiceTagsCount} invoice tags in XML, ${invoices.length} are CO-PROF proformas`);
        
        let actualLimit = requestedLimit;
        let totalCount = null;
        let actualPage = page;
        let totalPages = null;

        if (typeof response.data === 'string') {
          const parametersMatches = response.data.match(/<parameters>[\s\S]*?<\/parameters>/g);
          const metaBlock = parametersMatches ? parametersMatches[parametersMatches.length - 1] : null;

          if (metaBlock) {
            const limitMatch = metaBlock.match(/<limit>(\d+)<\/limit>/);
            const totalMatch = metaBlock.match(/<total>(\d+)<\/total>/);
            const pageMatch = metaBlock.match(/<page>(\d+)<\/page>/);

            if (limitMatch) {
              actualLimit = parseInt(limitMatch[1], 10);
            }
            if (totalMatch) {
              totalCount = parseInt(totalMatch[1], 10);
            }
            if (pageMatch) {
              actualPage = parseInt(pageMatch[1], 10);
            }

            if (totalCount !== null && actualLimit > 0) {
              totalPages = Math.max(1, Math.ceil(totalCount / actualLimit));
            }

            logger.info(`Pagination metadata: totalCount=${totalCount}, actualLimit=${actualLimit}, actualPage=${actualPage}, totalPages=${totalPages}, invoiceTagsCount=${invoiceTagsCount}`);
          } else {
            logger.warn('No pagination metadata found in response. Falling back to tag count logic.');
          }
        }

        if (totalPages !== null) {
          if (allInvoices.length >= totalCount) {
            logger.info(`Collected ${allInvoices.length} invoices which matches totalCount ${totalCount}. Stopping pagination.`);
            hasMore = false;
            continue;
          }

          if (actualPage >= totalPages) {
            logger.info(`Reached last page (${actualPage}/${totalPages}), stopping pagination. Collected ${allInvoices.length} proformas total.`);
            hasMore = false;
          } else {
            page = actualPage + 1;
            logger.info(`Moving to next page: ${page} of ${totalPages} (have ${allInvoices.length} proformas so far)`);
          }
        } else {
          if (invoiceTagsCount === 0) {
            hasMore = false;
          } else {
            page++;
            logger.info(`Moving to next page: ${page} (found ${invoiceTagsCount} invoices on page ${page - 1}, ${allInvoices.length} proformas total so far)`);
          }
        }

        if (page > 200) {
          logger.warn('Reached maximum page limit (200), stopping pagination');
          hasMore = false;
        }
      }

      logger.info(`Fetched ${allInvoices.length} total proformas from ${page} page(s)`);
      
      // Проверяем, есть ли проформы без продуктов
      // Если в /invoices/find invoicecontents пустые, получаем полные данные через /invoices/get
      const proformasWithoutProducts = allInvoices.filter(inv => !inv.products || inv.products.length === 0);
      
      if (proformasWithoutProducts.length > 0) {
        logger.info(`Found ${proformasWithoutProducts.length} proformas without products, fetching full data via /invoices/get`);
        
        // Получаем полные данные для проформ без продуктов
        for (const proforma of proformasWithoutProducts) {
          try {
            logger.info(`Fetching full proforma ${proforma.fullnumber || proforma.number} (ID: ${proforma.id})`);
            const fullProforma = await this.getFullProformaById(proforma.id);
            
            if (fullProforma) {
              logger.info(`Full proforma ${proforma.fullnumber || proforma.number}: products count = ${fullProforma.products ? fullProforma.products.length : 0}`);
              
              if (fullProforma.products && fullProforma.products.length > 0) {
                // Обновляем проформу с полными данными
                const index = allInvoices.findIndex(inv => inv.id === proforma.id);
                if (index >= 0) {
                  allInvoices[index] = fullProforma;
                  logger.info(`✓ Updated proforma ${proforma.fullnumber || proforma.number} with ${fullProforma.products.length} products`);
                } else {
                  logger.warn(`Proforma ${proforma.fullnumber || proforma.number} not found in allInvoices array`);
                }
              } else {
                logger.warn(`Full proforma ${proforma.fullnumber || proforma.number} has no products after fetching`);
              }
            } else {
              logger.warn(`Failed to get full proforma ${proforma.id}: returned null`);
            }
          } catch (error) {
            logger.warn(`Failed to get full proforma ${proforma.id}: ${error.message}`);
            logger.error(`Error details:`, error);
          }
        }
      }
      
      // Фильтруем проформы без продуктов (они не нужны)
      const proformasWithProducts = allInvoices.filter(inv => inv.products && inv.products.length > 0);
      logger.info(`After filtering: ${proformasWithProducts.length} proformas with products out of ${allInvoices.length} total`);
      
      return proformasWithProducts;
    } catch (error) {
      logger.error('Error fetching proformas from wFirma:', error);
      
      // Если XML парсинг не работает, пробуем парсить вручную
      if (error.response && error.response.data) {
        return this.parseInvoicesFromXmlString(error.response.data, dateFrom, dateTo);
      }
      
      throw error;
    }
  }

  /**
   * Парсинг проформ из XML строки (fallback метод)
   */
  async parseInvoicesFromXmlString(xmlString, dateFrom, dateTo) {
    try {
      const invoices = [];
      
      // Проверяем, что это строка
      if (typeof xmlString !== 'string') {
        logger.warn('XML response is not a string:', typeof xmlString);
        return [];
      }
      
      // Логируем первые 500 символов ответа для отладки
      logger.debug('XML response preview:', xmlString.substring(0, 500));
      
      const sanitizedXml = this.sanitizeNestedInvoiceReferences(xmlString);

      // Ищем все теги <invoice> в XML
      const invoiceMatches = sanitizedXml.match(/<invoice>[\s\S]*?<\/invoice>/g);
      
      if (!invoiceMatches) {
        logger.debug('No invoice tags found in XML response', {
          responseLength: xmlString.length,
          preview: xmlString.substring(0, 200)
        });
        return [];
      }

      logger.debug(`Found ${invoiceMatches.length} invoice tags in XML`);

      let parsedCount = 0;
      let filteredCount = 0;
      let proformaCount = 0;

      for (const invoiceXml of invoiceMatches) {
        try {
          const invoice = await this.parseInvoiceFromXml(invoiceXml);
          parsedCount++;
          
          if (invoice) {
            proformaCount++;
            
            // Фильтруем по дате, если указаны
            if (dateFrom && dateTo) {
              const invoiceDate = new Date(invoice.date);
              
              // Сравниваем только даты (без времени) - используем UTC для корректного сравнения
              const invoiceDateOnly = new Date(Date.UTC(invoiceDate.getFullYear(), invoiceDate.getMonth(), invoiceDate.getDate()));
              const dateFromOnly = new Date(Date.UTC(dateFrom.getFullYear(), dateFrom.getMonth(), dateFrom.getDate()));
              const dateToOnly = new Date(Date.UTC(dateTo.getFullYear(), dateTo.getMonth(), dateTo.getDate()));
              
              logger.debug(`Checking invoice ${invoice.number || invoice.fullnumber}: date=${invoice.date}, invoiceDateOnly=${invoiceDateOnly.toISOString()}, range=${dateFromOnly.toISOString()} to ${dateToOnly.toISOString()}`);
              
              if (invoiceDateOnly >= dateFromOnly && invoiceDateOnly <= dateToOnly) {
                logger.info(`✓ Adding invoice ${invoice.number || invoice.fullnumber} (date: ${invoice.date})`);
                invoices.push(invoice);
                filteredCount++;
              } else {
                logger.debug(`✗ Invoice ${invoice.number || invoice.fullnumber} date ${invoice.date} (${invoiceDateOnly.toISOString().split('T')[0]}) is outside range ${dateFromOnly.toISOString().split('T')[0]} - ${dateToOnly.toISOString().split('T')[0]}`);
              }
            } else {
              invoices.push(invoice);
              filteredCount++;
            }
          } else {
            logger.debug('Invoice parsed as null (not a proforma), skipping');
          }
        } catch (parseError) {
          logger.warn('Error parsing invoice from XML:', parseError.message);
        }
      }
      
      logger.info(`Parsed ${parsedCount} invoices, found ${proformaCount} proformas, ${filteredCount} passed date filter, ${invoices.length} total returned`);

      return invoices;
    } catch (error) {
      logger.error('Error parsing invoices from XML string:', error);
      return [];
    }
  }

  /**
   * Получить название продукта по good.id через /goods/get
   * @param {string} goodId - ID товара
   * @returns {Promise<string|null>} - Название продукта или null
   */
  async getProductNameByGoodId(goodId) {
    try {
      const endpoint = `/goods/get/${goodId}?outputFormat=xml&inputFormat=xml&company_id=${this.companyId}`;
      
      logger.debug(`Fetching product name via good.id=${goodId}`);
      
      const response = await this.xmlClient.get(endpoint);
      
      if (!response.data || typeof response.data !== 'string') {
        logger.warn(`Empty or invalid response for good.id ${goodId}`);
        return null;
      }
      
      // Ищем название продукта в XML
      const nameMatch = response.data.match(/<name>([^<]+)<\/name>/);
      if (nameMatch) {
        const productName = nameMatch[1].trim();
        logger.debug(`Got product name for good.id ${goodId}: ${productName}`);
        return productName;
      }
      
      logger.warn(`No name found in response for good.id ${goodId}`);
      return null;
    } catch (error) {
      logger.error(`Error fetching product name for good.id ${goodId}:`, error);
      return null;
    }
  }

  /**
   * Получить полную проформу по ID через /invoices/get
   * @param {string} invoiceId - ID проформы
   * @returns {Promise<Object|null>} - Полная проформа или null
   */
  sanitizeNestedInvoiceReferences(xmlString) {
    if (!xmlString || typeof xmlString !== 'string') {
      return xmlString;
    }

    return xmlString.replace(/<invoice>\s*<id>\d+<\/id>\s*<\/invoice>/g, '');
  }

  async getFullProformaById(invoiceId) {
    try {
      const endpoint = `/invoices/get/${invoiceId}?outputFormat=xml&inputFormat=xml&company_id=${this.companyId}`;
      
      logger.debug(`Fetching full proforma ${invoiceId} via /invoices/get`);
      
      const response = await this.xmlClient.get(endpoint);
      
      if (!response.data || typeof response.data !== 'string') {
        logger.warn(`Empty or invalid response for proforma ${invoiceId}`);
        return null;
      }
      
      const sanitizedXml = this.sanitizeNestedInvoiceReferences(response.data);

      // Парсим XML ответ
      const invoiceMatches = sanitizedXml.match(/<invoice>[\s\S]*?<\/invoice>/g);
      
      if (!invoiceMatches || invoiceMatches.length === 0) {
        logger.warn(`No invoice found in response for proforma ${invoiceId}`);
        return null;
      }
      
      // Проверяем наличие invoicecontents в ответе
      const invoiceXml = invoiceMatches[0];
      const hasInvoicecontents = invoiceXml.includes('<invoicecontents>');
      logger.debug(`Full proforma ${invoiceId}: invoicecontents present = ${hasInvoicecontents}`);
      
      if (hasInvoicecontents) {
        const invoicecontentsMatch = invoiceXml.match(/<invoicecontents>[\s\S]*?<\/invoicecontents>/);
        if (invoicecontentsMatch) {
          const contents = invoicecontentsMatch[0];
          const hasInvoicecontent = contents.includes('<invoicecontent>');
          logger.debug(`Full proforma ${invoiceId}: invoicecontent present = ${hasInvoicecontent}, length = ${contents.length}`);
          
          if (hasInvoicecontent) {
            const contentMatches = contents.match(/<invoicecontent>[\s\S]*?<\/invoicecontent>/g);
            logger.debug(`Full proforma ${invoiceId}: invoicecontent elements count = ${contentMatches ? contentMatches.length : 0}`);
            
            if (contentMatches) {
              contentMatches.forEach((content, i) => {
                const nameMatch = content.match(/<name>([^<]+)<\/name>/);
                logger.debug(`Full proforma ${invoiceId}: invoicecontent[${i}] name = ${nameMatch ? nameMatch[1].trim() : 'NOT FOUND'}`);
              });
            }
          } else {
            logger.warn(`Full proforma ${invoiceId}: invoicecontents found but no invoicecontent inside`);
            logger.debug(`invoicecontents content (first 500 chars): ${contents.substring(0, 500)}`);
          }
        }
      } else {
        logger.warn(`Full proforma ${invoiceId}: no invoicecontents in response`);
      }
      
      // Парсим первую проформу (должна быть одна)
      const invoice = await this.parseInvoiceFromXml(invoiceMatches[0]);
      
      return invoice;
    } catch (error) {
      logger.error(`Error fetching full proforma ${invoiceId}:`, error);
      return null;
    }
  }

  /**
   * Парсинг одной проформы из XML
   * @param {string} xmlString - XML строка с данными проформы
   * @returns {Promise<Object|null>} - Проформа или null
   */
  async parseInvoiceFromXml(xmlString) {
    try {
      // Извлекаем основные поля из XML
      const idMatch = xmlString.match(/<id>(\d+)<\/id>/);
      const numberMatch = xmlString.match(/<number>([^<]+)<\/number>/);
      const fullnumberMatch = xmlString.match(/<fullnumber>([^<]+)<\/fullnumber>/);
      const dateMatch = xmlString.match(/<date>([^<]+)<\/date>/);
      const totalMatch = xmlString.match(/<total>([^<]+)<\/total>/);
      const totalComposedMatch = xmlString.match(/<total_composed>([^<]+)<\/total_composed>/);
      const currencyMatch = xmlString.match(/<currency>([^<]+)<\/currency>/);
      const descriptionMatch = xmlString.match(/<description>([^<]*)<\/description>/);
      
      // Проверяем, что это проформа (по описанию или типу)
      const description = descriptionMatch ? descriptionMatch[1] : '';
      
      // Проверяем по номеру проформы - только CO-PROF (не CO-FV инвойсы)
      const number = numberMatch ? numberMatch[1].trim() : '';
      const fullnumber = fullnumberMatch ? fullnumberMatch[1].trim() : '';
      
      // Исключаем инвойсы CO-FV - если это CO-FV, пропускаем
      if ((number && number.startsWith('CO-FV')) || (fullnumber && fullnumber.startsWith('CO-FV'))) {
        logger.debug(`Skipping invoice: CO-FV invoice (number: ${number}, fullnumber: ${fullnumber})`);
        return null;
      }
      
      // Проверяем, что это проформа с префиксом CO-PROF
      const isProforma = (number && number.startsWith('CO-PROF')) || 
                         (fullnumber && fullnumber.startsWith('CO-PROF')) ||
                         description.includes('VAT marża') || 
                         description.includes('marża');

      // Если это не проформа CO-PROF, пропускаем
      if (!isProforma) {
        logger.debug(`Skipping invoice: not a CO-PROF proforma (number: ${number}, fullnumber: ${fullnumber})`);
        return null;
      }

      // Извлекаем продукты из invoicecontents
          const products = [];
      
      // Ищем все блоки <invoicecontents>
      const invoicecontentsMatches = xmlString.match(/<invoicecontents>[\s\S]*?<\/invoicecontents>/g);
      
      logger.debug(`Parsing products for ${fullnumber || number}: found ${invoicecontentsMatches ? invoicecontentsMatches.length : 0} invoicecontents blocks`);
      
      if (invoicecontentsMatches) {
        for (const contentsXml of invoicecontentsMatches) {
          // Проверяем, не пустой ли блок
          const trimmedContents = contentsXml.replace(/<invoicecontents>|<\/invoicecontents>/g, '').trim();
          if (!trimmedContents) {
            logger.debug(`Empty invoicecontents block for ${fullnumber || number}`);
            continue;
          }
          
          // Ищем элементы <invoicecontent> внутри <invoicecontents>
          const contentMatches = contentsXml.match(/<invoicecontent>[\s\S]*?<\/invoicecontent>/g);
          
          logger.debug(`Found ${contentMatches ? contentMatches.length : 0} invoicecontent elements in invoicecontents`);
          
          if (contentMatches) {
            for (const contentXml of contentMatches) {
              const productIdMatch = contentXml.match(/<invoicecontent>\s*<id>(\d+)<\/id>/);
              const invoiceProductId = productIdMatch ? productIdMatch[1] : null;
              const nameMatch = contentXml.match(/<name>([^<]+)<\/name>/);
              const priceMatch = contentXml.match(/<price>([^<]+)<\/price>/);
              const countMatch = contentXml.match(/<count>([^<]+)<\/count>/);
              
              // Если нет name, пробуем получить через good.id
              let productName = nameMatch ? nameMatch[1].trim() : null;
              const goodIdMatch = contentXml.match(/<good>[\s\S]*?<id>(\d+)<\/id>[\s\S]*?<\/good>/);
              const goodId = goodIdMatch ? goodIdMatch[1] : null;
              
              if (!productName && goodId) {
                logger.debug(`No name found in invoicecontent, trying to get product name via good.id=${goodId} for ${fullnumber || number}`);
                
                try {
                  productName = await this.getProductNameByGoodId(goodId);
                  logger.debug(`Got product name via good.id: ${productName}`);
                } catch (error) {
                  logger.warn(`Failed to get product name via good.id ${goodId}: ${error.message}`);
                }
              }
              
              if (productName) {
                const productPrice = priceMatch ? parseFloat(priceMatch[1]) : 0;
                const productCount = countMatch ? parseFloat(countMatch[1]) : 1;
                
                products.push({
                  id: invoiceProductId,
                  productId: invoiceProductId,
                  goodId,
                  name: productName,
                  price: productPrice,
                  count: productCount
                });
                
                logger.debug(`Found product: ${productName} (price: ${productPrice}, count: ${productCount})`);
              } else {
                logger.warn(`invoicecontent found but no <name> tag and no good.id in ${fullnumber || number}`);
                logger.debug(`Content XML: ${contentXml.substring(0, 200)}`);
              }
            }
          } else {
            logger.debug(`No invoicecontent elements found in invoicecontents for ${fullnumber || number}`);
            logger.debug(`invoicecontents content: ${contentsXml.substring(0, 300)}`);
          }
        }
      }
      
      // Если не нашли через invoicecontents, пробуем прямой поиск <invoicecontent>
      if (products.length === 0) {
        logger.debug(`No products found in invoicecontents, trying direct invoicecontent search for ${fullnumber || number}`);
        const directContentMatches = xmlString.match(/<invoicecontent>[\s\S]*?<\/invoicecontent>/g);
        if (directContentMatches) {
          logger.debug(`Found ${directContentMatches.length} direct invoicecontent elements`);
          for (const contentXml of directContentMatches) {
            const productIdMatch = contentXml.match(/<invoicecontent>\s*<id>(\d+)<\/id>/);
            const invoiceProductId = productIdMatch ? productIdMatch[1] : null;
            const nameMatch = contentXml.match(/<name>([^<]+)<\/name>/);
            const priceMatch = contentXml.match(/<price>([^<]+)<\/price>/);
            const countMatch = contentXml.match(/<count>([^<]+)<\/count>/);
            
            // Если нет name, пробуем получить через good.id
            let productName = nameMatch ? nameMatch[1].trim() : null;
            const goodIdMatch = contentXml.match(/<good>[\s\S]*?<id>(\d+)<\/id>[\s\S]*?<\/good>/);
            const goodId = goodIdMatch ? goodIdMatch[1] : null;
            
            if (!productName && goodId) {
              logger.debug(`No name found, trying to get product name via good.id=${goodId} for ${fullnumber || number}`);
              
              try {
                productName = await this.getProductNameByGoodId(goodId);
                logger.debug(`Got product name via good.id: ${productName}`);
              } catch (error) {
                logger.warn(`Failed to get product name via good.id ${goodId}: ${error.message}`);
              }
            }
            
            if (productName) {
              const productPrice = priceMatch ? parseFloat(priceMatch[1]) : 0;
              const productCount = countMatch ? parseFloat(countMatch[1]) : 1;
              
              products.push({
                id: invoiceProductId,
                productId: invoiceProductId,
                goodId,
                name: productName,
                price: productPrice,
                count: productCount
              });
              
              logger.debug(`Found product (direct): ${productName} (price: ${productPrice}, count: ${productCount})`);
            }
          }
        } else {
          logger.debug(`No direct invoicecontent elements found for ${fullnumber || number}`);
        }
      }
      
      // Если все еще нет продуктов, пробуем найти good.id в invoicecontent и получить названия
      if (products.length === 0) {
        logger.debug(`Still no products, trying to find good.id in invoicecontent for ${fullnumber || number}`);
        const goodIdMatches = xmlString.match(/<good>[\s\S]*?<id>(\d+)<\/id>[\s\S]*?<\/good>/g);
        if (goodIdMatches) {
          logger.debug(`Found ${goodIdMatches.length} good.id references`);
          for (const goodXml of goodIdMatches) {
            const goodIdMatch = goodXml.match(/<id>(\d+)<\/id>/);
            if (goodIdMatch) {
              const goodId = goodIdMatch[1];
              try {
                const productName = await this.getProductNameByGoodId(goodId);
                const priceMatch = xmlString.match(/<price>([^<]+)<\/price>/);
                const countMatch = xmlString.match(/<count>([^<]+)<\/count>/);
                
                products.push({
                  id: null,
                  productId: null,
                  goodId,
                  name: productName,
                  price: priceMatch ? parseFloat(priceMatch[1]) : 0,
                  count: countMatch ? parseFloat(countMatch[1]) : 1
                });
                
                logger.debug(`Found product via good.id: ${productName}`);
              } catch (error) {
                logger.warn(`Failed to get product name via good.id ${goodId}: ${error.message}`);
              }
            }
          }
        }
      }

      // Если нет продуктов, возвращаем проформу с пустым массивом продуктов
      // Это позволит потом получить полные данные через /invoices/get
      if (products.length === 0) {
        logger.warn(`No products found in invoicecontents for ${fullnumber || number}, will fetch full data later`);
        // Не возвращаем null, а возвращаем проформу с пустым массивом продуктов
        // Это позволит нам потом получить полные данные
      }
      
      logger.debug(`Found ${products.length} products in invoice ${fullnumber || number}`);

      // Извлекаем currency_exchange если есть
      const currencyExchangeMatch = xmlString.match(/<currency_exchange>([^<]+)<\/currency_exchange>/);
      const currencyExchange = currencyExchangeMatch ? parseFloat(currencyExchangeMatch[1]) : null;
      
      return {
        id: idMatch ? idMatch[1] : null,
        number: numberMatch ? numberMatch[1].trim() : null,
        fullnumber: fullnumberMatch ? fullnumberMatch[1].trim() : null,
        date: dateMatch ? dateMatch[1] : null,
        total: totalMatch ? parseFloat(totalMatch[1]) : 0,
        totalComposed: totalComposedMatch ? parseFloat(totalComposedMatch[1]) : 0,
        currency: currencyMatch ? currencyMatch[1].trim() : 'PLN',
        currencyExchange: currencyExchange,
        description: description,
        products: products,
        buyer: this.extractBuyerFromInvoiceXml(xmlString)
      };
    } catch (error) {
      logger.error('Error parsing invoice from XML:', error);
      return null;
    }
  }

  extractBuyerFromInvoiceXml(xmlString) {
    if (!xmlString) {
      return null;
    }

    const contractorMatch = xmlString.match(/<contractor>[\s\S]*?<\/contractor>/);
    const contractorDetailMatch = xmlString.match(/<contractor_detail>[\s\S]*?<\/contractor_detail>/);

    const contractorXml = contractorMatch ? contractorMatch[0] : null;
    const contractorDetailXml = contractorDetailMatch ? contractorDetailMatch[0] : null;

    const buyerName = this.extractTagValue(contractorDetailXml, 'name')
      || this.extractTagValue(contractorXml, 'altname')
      || this.extractTagValue(contractorXml, 'name');

    return {
      id: this.extractTagValue(contractorXml, 'id') || null,
      detailId: this.extractTagValue(contractorDetailXml, 'id') || null,
      name: buyerName || null,
      altName: this.extractTagValue(contractorXml, 'altname') || null,
      email: this.extractTagValue(contractorDetailXml, 'email') || this.extractTagValue(contractorXml, 'email') || null,
      phone: this.extractTagValue(contractorDetailXml, 'phone') || this.extractTagValue(contractorXml, 'phone') || null,
      street: this.extractTagValue(contractorDetailXml, 'street') || null,
      zip: this.extractTagValue(contractorDetailXml, 'zip') || null,
      city: this.extractTagValue(contractorDetailXml, 'city') || null,
      country: this.extractTagValue(contractorDetailXml, 'country') || null,
      taxId: this.extractTagValue(contractorDetailXml, 'nip') || null
    };
  }


  /**
   * Группировка проформ по продуктам
   * @param {Array} proformas - Массив проформ
   * @returns {Array} - Массив объектов с группировкой по продуктам
   */
  groupProformasByProduct(proformas) {
    const productMap = new Map();

    for (const proforma of proformas) {
      // Для каждой проформы обрабатываем все её продукты
      for (const product of proforma.products || []) {
        const productName = product.name || 'Без названия';
        const currency = proforma.currency || 'PLN';
        const key = `${productName}::${currency}`;

        if (!productMap.has(key)) {
          productMap.set(key, {
            productName: productName,
            currency: currency,
            count: 0,
            totalAmount: 0,
            invoices: []
          });
        }

        const group = productMap.get(key);
        group.count += 1;
        
        // Используем цену продукта * количество, или общую сумму проформы
        const productAmount = (product.price || 0) * (product.count || 1);
        group.totalAmount += productAmount;

        // Добавляем информацию о проформе
        group.invoices.push({
          id: proforma.id,
          number: proforma.number || proforma.fullnumber,
          fullnumber: proforma.fullnumber,
          date: proforma.date,
          amount: productAmount,
          currency: currency
        });
      }

      // Если у проформы нет продуктов, пропускаем её (не должно происходить после фильтрации)
      if (!proforma.products || proforma.products.length === 0) {
        logger.warn(`Proforma ${proforma.number || proforma.fullnumber} has no products, skipping`);
        continue;
      }
    }

    // Преобразуем Map в массив и сортируем по названию продукта
    return Array.from(productMap.values()).sort((a, b) => 
      a.productName.localeCompare(b.productName)
    );
  }

  /**
   * Создание плоской таблицы продуктов из проформ
   * Каждая строка - это один продукт из invoicecontent с информацией о проформе
   * @param {Array} proformas - Массив проформ
   * @returns {Array} - Массив объектов с полями: name, fullnumber, date, currency, total, currency_exchange
   */
  createProductTable(proformas) {
    const productRows = [];

    for (const proforma of proformas) {
      // Для каждой проформы обрабатываем все её продукты
      for (const product of proforma.products || []) {
        const productName = product.name || 'Без названия';
        const productKey = this.normalizeProductName(productName) || 'без названия';
        const dealIdRaw = proforma.pipedriveDealId || proforma.dealId || proforma.pipedrive_deal_id || null;
        const dealId = dealIdRaw !== null && dealIdRaw !== undefined
          ? String(dealIdRaw).trim()
          : null;
        const dealUrl = dealId && dealId.length > 0
          ? `${CRM_DEAL_BASE_URL}${encodeURIComponent(dealId)}`
          : null;

        productRows.push({
          product_id: product.productId || product.id || null,
          product_key: productKey,
          name: productName,
          fullnumber: proforma.fullnumber || '',
          date: proforma.date || '',
          currency: proforma.currency || 'PLN',
          total: this.parseNumber(product.price) && this.parseNumber(product.count)
            ? this.parseNumber(product.price) * this.parseNumber(product.count)
            : this.parseNumber(proforma.total) || 0,
          proforma_total: this.parseNumber(proforma.total) || 0,
          quantity: this.parseNumber(product.count) || 0,
          unit_price: this.parseNumber(product.price) || 0,
          currency_exchange: proforma.currencyExchange !== null && proforma.currencyExchange !== undefined ? this.parseNumber(proforma.currencyExchange) : null,
          payments_total_pln: this.parseNumber(proforma.paymentsTotalPln) || this.parseNumber(proforma.paymentsTotal) || 0,
          payments_total: this.parseNumber(proforma.paymentsTotal) || 0,
          line_total: this.parseNumber(product.price) && this.parseNumber(product.count)
            ? this.parseNumber(product.price) * this.parseNumber(product.count)
            : null,
          payments_currency_exchange: this.parseNumber(proforma.paymentsCurrencyExchange) || this.parseNumber(proforma.currencyExchange) || null,
          pipedrive_deal_id: dealId || null,
          pipedrive_deal_url: dealUrl
        });
      }
    }

    // Сортируем по дате (от новых к старым), затем по названию продукта
    return productRows.sort((a, b) => {
      if (a.date > b.date) return -1;
      if (a.date < b.date) return 1;
      return a.name.localeCompare(b.name);
    });
  }
}

// Экспортируем функцию для обратной совместимости с тестом
async function getMonthlyProformasByProduct(options = {}) {
  const lookup = new WfirmaLookup();
  return await lookup.getMonthlyProformasByProduct(options);
}

module.exports = {
  WfirmaLookup,
  getMonthlyProformasByProduct
};

