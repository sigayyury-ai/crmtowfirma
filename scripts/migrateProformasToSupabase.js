require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const { WfirmaLookup } = require('../src/services/vatMargin/wfirmaLookup');
const logger = require('../src/utils/logger');

if (!supabase) {
  logger.error('Supabase client is not initialized. Check environment variables.');
  process.exit(1);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function migrate() {
  const lookup = new WfirmaLookup();

  logger.info('Starting proforma migration from wFirma to Supabase...');

  let proformas;
  const now = new Date();
  const dateFrom = new Date(now.getFullYear() - 10, 0, 1);
  const dateTo = new Date(now.getFullYear() + 2, 11, 31, 23, 59, 59);
  try {
    proformas = await lookup.getProformasByDateRange(dateFrom, dateTo);
    logger.info(`Fetched ${proformas.length} proformas from wFirma.`);
  } catch (error) {
    logger.error('Failed to fetch proformas from wFirma:', error);
    process.exit(1);
  }

  if (!proformas || proformas.length === 0) {
    logger.warn('No proformas received from wFirma. Nothing to migrate.');
    process.exit(0);
  }

  // Нормализуем проформы, чтобы гарантировать оригинальные fullnumber из wFirma
  const proformaMap = new Map();
  for (const proforma of proformas) {
    const normalizedFullnumber = typeof proforma.fullnumber === 'string'
      ? proforma.fullnumber.trim()
      : null;

    proformaMap.set(proforma.id, {
      ...proforma,
      fullnumber: normalizedFullnumber && normalizedFullnumber.length > 0 ? normalizedFullnumber : null
    });
  }

  const proformasMissingFullnumber = Array.from(proformaMap.values()).filter(p => !p.fullnumber);

  if (proformasMissingFullnumber.length > 0) {
    logger.warn(`Detected ${proformasMissingFullnumber.length} proformas without fullnumber. Fetching individual records from wFirma...`);

    for (const proforma of proformasMissingFullnumber) {
      try {
        const fullProforma = await lookup.getFullProformaById(proforma.id);

        const fetchedFullnumber = fullProforma?.fullnumber && typeof fullProforma.fullnumber === 'string'
          ? fullProforma.fullnumber.trim()
          : null;

        if (!fetchedFullnumber) {
          logger.error(`Unable to recover fullnumber for proforma ID ${proforma.id}. Skipping update for this proforma.`);
          continue;
        }

        proformaMap.set(proforma.id, {
          ...proforma,
          ...fullProforma,
          fullnumber: fetchedFullnumber,
          date: fullProforma?.date || proforma.date,
          currency: fullProforma?.currency || proforma.currency || 'PLN',
          currencyExchange: fullProforma?.currencyExchange ?? proforma.currencyExchange ?? null,
          products: Array.isArray(fullProforma?.products) && fullProforma.products.length > 0
            ? fullProforma.products
            : proforma.products
        });

        // Небольшая пауза, чтобы не перегружать API wFirma
        await sleep(150);
      } catch (error) {
        logger.error(`Failed to fetch full proforma ${proforma.id}:`, error);
      }
    }
  }

  const normalizedProformas = Array.from(proformaMap.values());

  const proformaRecords = normalizedProformas.map(p => {
    const issuedAt = p.date ? new Date(p.date).toISOString().slice(0, 10) : null;
    const fullnumber = typeof p.fullnumber === 'string' ? p.fullnumber.trim() : null;

    if (!p.id || !fullnumber || !issuedAt) {
      logger.warn(`Skipping proforma ${p.id} due to missing required fields (fullnumber=${fullnumber}, issued_at=${issuedAt}).`);
      return null;
    }

    return {
      id: p.id,
      fullnumber,
      issued_at: issuedAt,
      currency: p.currency || 'PLN',
      total: typeof p.total === 'number' ? p.total : (p.total ? parseFloat(p.total) : 0),
      currency_exchange: typeof p.currencyExchange === 'number' ? p.currencyExchange : (p.currencyExchange ? parseFloat(p.currencyExchange) : null),
      payments_total: 0,
      payments_count: 0
    };
  }).filter(Boolean);

  logger.info(`Prepared ${proformaRecords.length} proforma records for Supabase after normalizing fullnumbers.`);

  const proformaChunks = chunkArray(proformaRecords, 50);
  for (const [index, chunk] of proformaChunks.entries()) {
    logger.info(`Upserting proforma chunk ${index + 1}/${proformaChunks.length} (${chunk.length} items)...`);
    const { error } = await supabase
      .from('proformas')
      .upsert(chunk, { onConflict: 'id' });

    if (error) {
      logger.error('Error upserting proformas:', error);
      process.exit(1);
    }

    // Добавляем небольшую паузу, чтобы не перегружать Supabase и wFirma fetch
    await sleep(200);
  }

  logger.info('Finished upserting proforma records. Now migrating product rows...');

  const productRows = [];
  for (const proforma of normalizedProformas) {
    if (!proforma.id || !Array.isArray(proforma.products)) {
      continue;
    }

    proforma.products.forEach(product => {
      const productId = product.productId || product.id || null;

      if (!productId) {
        logger.warn(`Skipping product without productId for proforma ${proforma.fullnumber || proforma.id}`);
        return;
      }

      productRows.push({
        proforma_id: proforma.id,
        product_id: productId,
        name: product.name || 'Без названия',
        good_id: product.goodId || null,
        quantity: typeof product.count === 'number' ? product.count : parseFloat(product.count) || 1,
        unit_price: typeof product.price === 'number' ? product.price : (product.price ? parseFloat(product.price) : null)
      });
    });
  }

  logger.info(`Prepared ${productRows.length} product rows for Supabase.`);

  const proformaIds = [...new Set(productRows.map(row => row.proforma_id))];

  if (proformaIds.length > 0) {
    const idChunks = chunkArray(proformaIds, 100);
    for (const [index, idChunk] of idChunks.entries()) {
      logger.info(`Clearing existing products chunk ${index + 1}/${idChunks.length} (${idChunk.length} proformas)...`);
      const { error } = await supabase
        .from('proforma_products')
        .delete()
        .in('proforma_id', idChunk);

      if (error) {
        logger.error('Error clearing proforma_products:', error);
        process.exit(1);
      }

      await sleep(200);
    }
  }

  if (productRows.length > 0) {
    const productChunks = chunkArray(productRows, 100);
    for (const [index, chunk] of productChunks.entries()) {
      logger.info(`Inserting product chunk ${index + 1}/${productChunks.length} (${chunk.length} rows)...`);
      const { error } = await supabase
        .from('proforma_products')
        .insert(chunk);

      if (error) {
        logger.error('Error inserting proforma_products:', error);
        process.exit(1);
      }

      await sleep(200);
    }
  }

  logger.info('Migration completed successfully.');
  process.exit(0);
}

migrate();

