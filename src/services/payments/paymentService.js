const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const { parseBankStatement } = require('./bankStatementParser');
const ProformaRepository = require('../proformaRepository');
const { normalizeName, normalizeWhitespace } = require('../../utils/normalize');

const AMOUNT_TOLERANCE = 5; // PLN/EUR tolerance
const MANUAL_STATUS_APPROVED = 'approved';
const MANUAL_STATUS_REJECTED = 'rejected';
const PAYMENT_SOURCE_BANK = 'bank_statement';

class PaymentService {
  constructor() {
    this.proformaRepository = new ProformaRepository();
  }

  async updateProformaPaymentAggregates(proformaId) {
    if (!supabase || !proformaId) {
      return;
    }

    const targetId = String(proformaId);

    const { data: paymentRows, error: paymentsError } = await supabase
      .from('payments')
      .select('amount, currency')
      .eq('manual_status', MANUAL_STATUS_APPROVED)
      .eq('manual_proforma_id', targetId);

    if (paymentsError) {
      logger.error('Supabase error while aggregating proforma payments:', paymentsError);
      return;
    }

    const totalsByCurrency = {};
    let paymentsCount = 0;

    (paymentRows || []).forEach((row) => {
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) {
        return;
      }
      const currency = row.currency || 'PLN';
      totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + amount;
      paymentsCount += 1;
    });

    const { data: proforma, error: proformaError } = await supabase
      .from('proformas')
      .select('id, currency, currency_exchange')
      .eq('id', targetId)
      .single();

    if (proformaError) {
      logger.error('Supabase error while fetching proforma for payment aggregate:', proformaError);
      return;
    }

    if (!proforma) {
      return;
    }

    const proformaCurrency = proforma.currency || 'PLN';
    const exchangeRate = Number(proforma.currency_exchange);

    let paymentsTotal = totalsByCurrency[proformaCurrency] || 0;
    let paymentsTotalPln = null;

    if (proformaCurrency === 'PLN') {
      paymentsTotalPln = paymentsTotal;
    } else if (Number.isFinite(exchangeRate) && exchangeRate > 0) {
      paymentsTotalPln = paymentsTotal * exchangeRate;
    }

    if (paymentsTotal === 0 && Number.isFinite(exchangeRate) && exchangeRate > 0 && totalsByCurrency.PLN) {
      paymentsTotal = totalsByCurrency.PLN / exchangeRate;
      if (!Number.isFinite(paymentsTotalPln)) {
        paymentsTotalPln = totalsByCurrency.PLN;
      }
    }

    if (paymentsTotalPln === null && totalsByCurrency.PLN) {
      paymentsTotalPln = totalsByCurrency.PLN;
    }

    const updatePayload = {
      payments_total: Number.isFinite(paymentsTotal) ? paymentsTotal : 0,
      payments_total_pln: Number.isFinite(paymentsTotalPln) ? paymentsTotalPln : null,
      payments_count: paymentsCount
    };

    const { error: updateError } = await supabase
      .from('proformas')
      .update(updatePayload)
      .eq('id', targetId);

    if (updateError) {
      logger.error('Supabase error while updating proforma payment totals:', updateError);
    }
  }

  resolvePaymentRecord(record) {
    const manualStatus = record.manual_status || null;
    let status = record.match_status || 'unmatched';
    let matchedProformaId = record.proforma_id || null;
    let matchedProformaFullnumber = record.proforma_fullnumber || null;
    let origin = 'auto';

    if (manualStatus === MANUAL_STATUS_APPROVED) {
      status = 'matched';
      matchedProformaId = record.manual_proforma_id || matchedProformaId;
      matchedProformaFullnumber = record.manual_proforma_fullnumber || matchedProformaFullnumber;
      origin = 'manual';
    } else if (manualStatus === MANUAL_STATUS_REJECTED) {
      status = 'unmatched';
      matchedProformaId = null;
      matchedProformaFullnumber = null;
      origin = 'manual';
    }

    return {
      id: record.id,
      date: record.operation_date,
      description: record.description,
      amount: record.amount,
      currency: record.currency,
      direction: record.direction,
      payer: record.payer_name,
      payer_normalized_name: record.payer_normalized_name,
      status,
      origin,
      confidence: record.match_confidence || 0,
      reason: record.match_reason || null,
      matched_proforma: matchedProformaFullnumber,
      matched_proforma_id: matchedProformaId,
      manual_status: manualStatus,
      manual_comment: record.manual_comment || null,
      manual_user: record.manual_user || null,
      manual_updated_at: record.manual_updated_at || null,
      match_metadata: record.match_metadata || null,
      source: record.source || null,
      auto_proforma_id: record.proforma_id || null,
      auto_proforma_fullnumber: record.proforma_fullnumber || null
    };
  }

  async listPayments() {
    if (!supabase) {
      logger.warn('Supabase client is not configured for listPayments');
      return { payments: [], history: [] };
    }

    const { data: paymentsData, error: paymentsError } = await supabase
      .from('payments')
      .select(`
        id,
        operation_date,
        description,
        amount,
        currency,
        direction,
        payer_name,
        payer_normalized_name,
        proforma_id,
        proforma_fullnumber,
        match_status,
        match_confidence,
        match_reason,
        match_metadata,
        manual_status,
        manual_proforma_id,
        manual_proforma_fullnumber,
        manual_comment,
        manual_user,
        manual_updated_at,
        source
      `)
      .order('operation_date', { ascending: false })
      .limit(500);

    if (paymentsError) {
      logger.error('Supabase error while fetching payments:', paymentsError);
      throw paymentsError;
    }

    const { data: historyData, error: historyError } = await supabase
      .from('payment_imports')
      .select('id, filename, uploaded_at, total_records, matched, needs_review, user_name')
      .order('uploaded_at', { ascending: false })
      .limit(10);

    if (historyError) {
      logger.error('Supabase error while fetching payment imports:', historyError);
      throw historyError;
    }

    const pendingPayments = (paymentsData || []).filter((item) => item.manual_status !== MANUAL_STATUS_APPROVED);

    const payments = pendingPayments.map((item) => this.resolvePaymentRecord(item));

    const history = (historyData || []).map((item) => ({
      id: item.id,
      filename: item.filename,
      uploaded_at: item.uploaded_at,
      matched: item.matched || 0,
      needs_review: item.needs_review || 0,
      user: item.user_name || null
    }));

    return { payments, history };
  }

  async ingestCsv(buffer, { filename = 'bank.csv', uploadedBy = null } = {}) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const content = buffer.toString('utf-8');
    const records = parseBankStatement(content);

    if (!records.length) {
      return {
        total: 0,
        matched: 0,
        needs_review: 0,
        unmatched: 0,
        ignored: 0
      };
    }

    const prepared = records.filter((item) => item.direction === 'in');
    const ignored = records.length - prepared.length;

    const insertImportResult = await supabase
      .from('payment_imports')
      .insert({
        filename,
        total_records: records.length,
        user_name: uploadedBy,
        matched: 0,
        needs_review: 0
      })
      .select('id')
      .single();

    if (insertImportResult.error) {
      logger.error('Supabase error while creating payment import:', insertImportResult.error);
      throw insertImportResult.error;
    }

    const importId = insertImportResult.data?.id || null;

    const matchingContext = await this.buildMatchingContext(prepared);
    const enriched = this.applyMatching(prepared, matchingContext).map((item) => ({
      ...item,
      source: PAYMENT_SOURCE_BANK,
      import_id: importId
    }));

    const { data: upserted, error } = await supabase
      .from('payments')
      .upsert(enriched, { onConflict: 'operation_hash' })
      .select('id, match_status');

    if (error) {
      logger.error('Supabase error while upserting payments:', error);
      throw error;
    }

    const statusCounts = upserted.reduce((acc, item) => {
      const status = item.match_status || 'needs_review';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    if (importId) {
      const { error: updateImportError } = await supabase
        .from('payment_imports')
        .update({
          matched: statusCounts.matched || 0,
          needs_review: statusCounts.needs_review || 0
        })
        .eq('id', importId);

      if (updateImportError) {
        logger.error('Supabase error while updating payment import stats:', updateImportError);
        throw updateImportError;
      }
    }

    return {
      total: records.length,
      matched: statusCounts.matched || 0,
      needs_review: statusCounts.needs_review || 0,
      unmatched: statusCounts.unmatched || 0,
      ignored
    };
  }

  async resetMatches() {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const { data: affected, error: listError } = await supabase
      .from('payments')
      .select('manual_proforma_id')
      .not('manual_status', 'is', null);

    if (listError) {
      logger.error('Supabase error while listing payments before reset:', listError);
    }

    const { error } = await supabase
      .from('payments')
      .update({
        match_status: 'unmatched',
        match_confidence: 0,
        match_reason: 'reset by user',
        match_metadata: null,
        proforma_id: null,
        proforma_fullnumber: null
      })
      .neq('match_status', 'unmatched');

    if (error) {
      logger.error('Supabase error while resetting payment matches:', error);
      throw error;
    }

    if (affected && affected.length > 0) {
      const uniqueIds = Array.from(new Set(
        affected
          .map((row) => row.manual_proforma_id)
          .filter(Boolean)
      ));

      for (const proformaId of uniqueIds) {
        // eslint-disable-next-line no-await-in-loop
        await this.updateProformaPaymentAggregates(proformaId);
      }
    }
  }

  async exportCsv() {
    const { payments } = await this.listPayments();

    const header = 'date,description,amount,currency,payer,proforma,status\n';
    const rows = payments.map((item) => [
      item.date || '',
      this.escapeCsv(item.description || ''),
      (item.amount || 0).toFixed(2),
      item.currency || '',
      this.escapeCsv(item.payer || ''),
      item.matched_proforma || '',
      item.status || ''
    ].join(','));

    return header + rows.join('\n');
  }

  escapeCsv(value) {
    const stringValue = String(value);
    if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  }

  applyMatching(payments, context) {
    return payments.map((payment) => {
      const enriched = { ...payment };
      const candidates = this.createMatchingCandidates(enriched, context);

      if (!candidates.length) {
        return {
          ...enriched,
          payment_date: enriched.operation_date || null,
          match_status: 'unmatched',
          match_confidence: 0,
          match_reason: 'Совпадения не найдены',
          match_metadata: null,
          proforma_id: null,
          proforma_fullnumber: null
        };
      }

      const best = candidates[0];
      const diffAcceptable = best.amountDiff <= AMOUNT_TOLERANCE;
      const matchStatus = diffAcceptable ? 'matched' : 'needs_review';

      return {
        ...enriched,
        payment_date: enriched.operation_date || null,
        match_status: matchStatus,
        match_confidence: best.score,
        match_reason: best.reason,
        match_metadata: {
          amount_diff: best.amountDiff,
          remaining: best.remaining,
          candidate_count: candidates.length,
          candidates: candidates.slice(0, 5).map((candidate) => ({
            proforma_id: candidate.proformaId,
            proforma_fullnumber: candidate.proformaFullnumber,
            score: candidate.score,
            reason: candidate.reason,
            amount_diff: candidate.amountDiff,
            remaining: candidate.remaining
          }))
        },
        proforma_id: best.proformaId,
        proforma_fullnumber: best.proformaFullnumber
      };
    });
  }

  calculateRemaining(proforma) {
    const total = Number(proforma.total) || 0;
    const paid = Number(proforma.payments_total) || 0;
    return Math.max(total - paid, 0);
  }

  createMatchingCandidates(payment, context) {
    const candidates = [];
    const paymentAmount = Number(payment.amount) || 0;
    const paymentCurrency = (payment.currency || 'PLN').toUpperCase();
    const usedProformaIds = new Set(); // Чтобы избежать дубликатов

    // 1. Поиск по номеру проформы
    // Сначала проверяем поле proforma_fullnumber (если было извлечено парсером)
    let normalizedNumber = this.normalizeProformaNumber(payment.proforma_fullnumber);
    
    // Если не было извлечено парсером, пытаемся извлечь из описания
    if (!normalizedNumber && payment.description) {
      const extracted = this.extractProformaNumberFromDescription(payment.description);
      if (extracted) {
        normalizedNumber = this.normalizeProformaNumber(extracted);
      }
    }
    
    if (normalizedNumber) {
      const candidate = context.proformasByNumber.get(normalizedNumber);
      if (candidate) {
        const remaining = this.calculateRemaining(candidate);
        const amountDiff = Math.abs(paymentAmount - remaining);
        const matched = amountDiff <= AMOUNT_TOLERANCE;

        candidates.push({
          proforma: candidate,
          proformaId: candidate.id,
          proformaFullnumber: candidate.fullnumber,
          proformaCurrency: candidate.currency,
          proformaTotal: Number(candidate.total) || 0,
          paymentsTotal: Number(candidate.payments_total) || 0,
          buyerName: candidate.buyer_name || null,
          score: matched ? 100 : 80,
          reason: matched ? 'По номеру проформы' : 'По номеру (разница в сумме)',
          amountDiff,
          remaining
        });
        usedProformaIds.add(String(candidate.id));
      } else {
        // Если номер проформы найден, но проформа не найдена в базе,
        // это может означать, что проформа удалена, еще не синхронизирована или номер неверный
        logger.debug('Proforma number found but proforma not in database', {
          paymentId: payment.id,
          proformaNumber: normalizedNumber,
          description: payment.description?.substring(0, 100)
        });
        
        // Добавляем кандидата с низким приоритетом, чтобы пользователь видел,
        // что номер проформы был найден, но проформа отсутствует в базе
        // Это поможет понять, что проформа была удалена или еще не синхронизирована
        candidates.push({
          proforma: null,
          proformaId: null,
          proformaFullnumber: normalizedNumber,
          proformaCurrency: paymentCurrency,
          proformaTotal: 0,
          paymentsTotal: 0,
          buyerName: null,
          score: 30,
          reason: `Проформа ${normalizedNumber} не найдена в базе (возможно, удалена)`,
          amountDiff: 0,
          remaining: 0
        });
      }
    }

    // 2. Поиск по имени клиента
    if (payment.payer_normalized_name) {
      const list = context.proformasByBuyer.get(payment.payer_normalized_name) || [];
      for (const proforma of list) {
        if (usedProformaIds.has(String(proforma.id))) continue;

        const remaining = this.calculateRemaining(proforma);
        const amountDiff = Math.abs(paymentAmount - remaining);
        let score = 50;
        let reason = 'По имени клиента';

        if (amountDiff <= AMOUNT_TOLERANCE) {
          score = 80;
          reason = 'По имени и сумме остатка';
        } else {
          const half = (Number(proforma.total) || 0) / 2;
          const halfDiff = Math.abs(paymentAmount - half);
          if (halfDiff <= AMOUNT_TOLERANCE) {
            score = 70;
            reason = 'Похоже на предоплату 50%';
          }
        }

        candidates.push({
          proforma,
          proformaId: proforma.id,
          proformaFullnumber: proforma.fullnumber,
          proformaCurrency: proforma.currency,
          proformaTotal: Number(proforma.total) || 0,
          paymentsTotal: Number(proforma.payments_total) || 0,
          buyerName: proforma.buyer_name || null,
          score,
          reason,
          amountDiff,
          remaining
        });
        usedProformaIds.add(String(proforma.id));
      }
    }

    // 3. Поиск по сумме (точное совпадение или половина для модели 50/50)
    // Это особенно важно, когда в описании платежа нет опознавательных знаков
    // Важно: сравниваем только проформы в той же валюте, что и платеж
    if (paymentAmount > 0 && Array.isArray(context.proformasByAmount)) {
      for (const proforma of context.proformasByAmount) {
        if (usedProformaIds.has(String(proforma.id))) continue;

        const proformaTotal = Number(proforma.total) || 0;
        const proformaPaymentsTotal = Number(proforma.payments_total) || 0;
        const remaining = this.calculateRemaining(proforma);
        
        // Пропускаем полностью оплаченные проформы
        if (remaining <= 0.01) continue;

        const proformaCurrency = (proforma.currency || 'PLN').toUpperCase();
        
        // Сравниваем только проформы в той же валюте, что и платеж
        if (proformaCurrency !== paymentCurrency) {
          continue;
        }

        // Проверяем точное совпадение суммы с остатком к оплате
        const exactDiff = Math.abs(paymentAmount - remaining);
        if (exactDiff <= AMOUNT_TOLERANCE) {
          candidates.push({
            proforma,
            proformaId: proforma.id,
            proformaFullnumber: proforma.fullnumber,
            proformaCurrency: proforma.currency,
            proformaTotal: proformaTotal,
            paymentsTotal: proformaPaymentsTotal,
            buyerName: proforma.buyer_name || null,
            score: 60,
            reason: 'По сумме (совпадение с остатком)',
            amountDiff: exactDiff,
            remaining
          });
          usedProformaIds.add(String(proforma.id));
          continue;
        }

        // Проверяем половину полной суммы проформы (модель 50/50, первый платеж)
        const halfTotal = proformaTotal / 2;
        const halfDiff = Math.abs(paymentAmount - halfTotal);
        if (halfDiff <= AMOUNT_TOLERANCE) {
          candidates.push({
            proforma,
            proformaId: proforma.id,
            proformaFullnumber: proforma.fullnumber,
            proformaCurrency: proforma.currency,
            proformaTotal: proformaTotal,
            paymentsTotal: proformaPaymentsTotal,
            buyerName: proforma.buyer_name || null,
            score: 55,
            reason: 'По сумме (половина проформы, модель 50/50)',
            amountDiff: halfDiff,
            remaining
          });
          usedProformaIds.add(String(proforma.id));
        }
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  normalizeProformaNumber(value) {
    if (!value) return null;
    let normalized = normalizeWhitespace(String(value)).toUpperCase();
    // Стандартизируем формат: CO PROF -> CO-PROF
    normalized = normalized.replace(/CO\s+PROF/g, 'CO-PROF');
    // Убираем лишние пробелы вокруг слэша
    normalized = normalized.replace(/\s*\/\s*/g, '/');
    return normalized;
  }

  extractProformaNumberFromDescription(description) {
    if (!description) return null;
    
    // Улучшенное регулярное выражение для поиска номеров проформ в описании
    // Поддерживает: CO-PROF 123/2025, CO PROF 123/2025, CO-PROF123/2025 и т.д.
    // Также ищем варианты с пробелами вокруг слэша
    const PROFORMA_REGEX = /(CO-?\s*PROF\s*\d+\s*\/\s*\d{4})/i;
    const match = description.match(PROFORMA_REGEX);
    
    if (match && match[1]) {
      // Нормализуем формат: убираем лишние пробелы, стандартизируем дефис
      let normalized = match[1]
        .replace(/\s+/g, ' ')
        .replace(/CO\s+PROF/gi, 'CO-PROF')
        .replace(/\s*\/\s*/g, '/')
        .trim()
        .toUpperCase();
      
      // Убеждаемся, что формат правильный: CO-PROF XXX/YYYY
      // Если между CO и PROF нет дефиса, добавляем его
      if (!normalized.includes('CO-PROF')) {
        normalized = normalized.replace(/CO\s*PROF/i, 'CO-PROF');
      }
      
      return normalized;
    }
    
    return null;
  }

  async fetchPaymentRaw(paymentId) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.message?.includes('no rows')) {
        const notFoundError = new Error(`Payment ${paymentId} not found`);
        notFoundError.statusCode = 404;
        throw notFoundError;
      }
      logger.error('Supabase error while fetching payment by id:', error);
      throw error;
    }

    if (!data) {
      const notFoundError = new Error(`Payment ${paymentId} not found`);
      notFoundError.statusCode = 404;
      throw notFoundError;
    }

    return data;
  }

  async getPaymentDetails(paymentId) {
    const paymentRaw = await this.fetchPaymentRaw(paymentId);
    
    // Если номер проформы не был извлечен парсером, пытаемся извлечь из описания
    if (!paymentRaw.proforma_fullnumber && paymentRaw.description) {
      const extracted = this.extractProformaNumberFromDescription(paymentRaw.description);
      if (extracted) {
        paymentRaw.proforma_fullnumber = extracted;
      }
    }
    
    const resolved = this.resolvePaymentRecord(paymentRaw);

    let candidates = [];

    try {
      const context = await this.buildMatchingContext([paymentRaw]);
      const computed = this.createMatchingCandidates(paymentRaw, context).map((item) => ({
        proforma_id: item.proformaId,
        proforma_fullnumber: item.proformaFullnumber,
        proforma_currency: item.proformaCurrency,
        proforma_total: item.proformaTotal,
        payments_total: item.paymentsTotal,
        buyer_name: item.buyerName,
        remaining: item.remaining,
        score: item.score,
        reason: item.reason,
        amount_diff: item.amountDiff
      }));

      const uniqueMap = new Map(computed.map((item) => [item.proforma_id, item]));
      candidates = Array.from(uniqueMap.values());
    } catch (error) {
      logger.error('Failed to compute payment candidates:', error);
    }

    if (resolved.manual_status === MANUAL_STATUS_APPROVED && resolved.matched_proforma) {
      try {
        const [manualProforma] = await this.proformaRepository.findByFullnumbers([resolved.matched_proforma]);
        if (manualProforma) {
          const remaining = this.calculateRemaining(manualProforma);
          const manualCandidate = {
            proforma_id: manualProforma.id,
            proforma_fullnumber: manualProforma.fullnumber,
            proforma_currency: manualProforma.currency,
            proforma_total: Number(manualProforma.total) || 0,
            payments_total: Number(manualProforma.payments_total) || 0,
            buyer_name: manualProforma.buyer_name || null,
            remaining,
            score: 100,
            reason: 'Подтверждено вручную',
            amount_diff: 0
          };

          candidates = [
            manualCandidate,
            ...candidates.filter((item) => item.proforma_id !== manualCandidate.proforma_id)
          ];
        }
      } catch (error) {
        logger.error('Failed to fetch manual proforma details:', error);
      }
    }

    return {
      payment: resolved,
      candidates
    };
  }

  async assignManualMatch(paymentId, fullnumber, { user = null, comment = null } = {}) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    await this.fetchPaymentRaw(paymentId);

    const normalizedNumber = this.normalizeProformaNumber(fullnumber);
    if (!normalizedNumber) {
      const validationError = new Error('Введите корректный номер проформы');
      validationError.statusCode = 400;
      throw validationError;
    }

    const [proforma] = await this.proformaRepository.findByFullnumbers([normalizedNumber]);
    if (!proforma) {
      const notFoundError = new Error(`Проформа ${normalizedNumber} не найдена`);
      notFoundError.statusCode = 404;
      throw notFoundError;
    }

    const now = new Date().toISOString();

    const { error } = await supabase
      .from('payments')
      .update({
        manual_status: MANUAL_STATUS_APPROVED,
        manual_proforma_id: proforma.id,
        manual_proforma_fullnumber: proforma.fullnumber,
        manual_comment: comment || null,
        manual_user: user || null,
        manual_updated_at: now
      })
      .eq('id', paymentId);

    if (error) {
      logger.error('Supabase error while assigning manual match:', error);
      throw error;
    }

    await this.updateProformaPaymentAggregates(proforma.id);

    return this.getPaymentDetails(paymentId);
  }

  async bulkApproveAutoMatches({ user = null, minConfidence = 80 } = {}) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const { data, error } = await supabase
      .from('payments')
      .select('id, proforma_id, proforma_fullnumber, match_confidence, match_status, match_reason')
      .is('manual_status', null)
      .in('match_status', ['matched', 'needs_review'])
      .gte('match_confidence', minConfidence)
      .order('match_confidence', { ascending: false })
      .limit(1000);

    if (error) {
      logger.error('Supabase error while loading auto-matched payments:', error);
      throw error;
    }

    const candidates = data || [];
    if (!candidates.length) {
      return { total: 0, processed: 0, skipped: 0 };
    }

    const now = new Date().toISOString();
    const updates = [];

    for (const payment of candidates) {
      if (!payment.proforma_id || !payment.proforma_fullnumber) {
        continue;
      }

      updates.push({
        id: payment.id,
        manual_status: MANUAL_STATUS_APPROVED,
        manual_proforma_id: payment.proforma_id,
        manual_proforma_fullnumber: payment.proforma_fullnumber,
        manual_user: user || 'bulk-auto',
        manual_comment: payment.match_reason || null,
        manual_updated_at: now
      });
    }

    if (!updates.length) {
      return { total: candidates.length, processed: 0, skipped: candidates.length };
    }

    let processed = 0;
    const failedUpdates = [];

    for (const update of updates) {
      const { id, manual_proforma_id: linkedProformaId, ...changes } = update;
      const { error: updateError } = await supabase
        .from('payments')
        .update(changes)
        .eq('id', id);

      if (updateError) {
        logger.error('Supabase error while approving payment match:', updateError);
        failedUpdates.push({ id, error: updateError });
      } else {
        processed += 1;
        // eslint-disable-next-line no-await-in-loop
        await this.updateProformaPaymentAggregates(linkedProformaId);
      }
    }

    const skipped = candidates.length - processed;

    return {
      total: candidates.length,
      processed,
      skipped,
      failed: failedUpdates
    };
  }

  async approveAutoMatch(paymentId, { user = null } = {}) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const raw = await this.fetchPaymentRaw(paymentId);

    if (!raw.proforma_id || !raw.proforma_fullnumber) {
      const validationError = new Error('Для этого платежа нет автоматического совпадения');
      validationError.statusCode = 400;
      throw validationError;
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from('payments')
      .update({
        manual_status: MANUAL_STATUS_APPROVED,
        manual_proforma_id: raw.proforma_id,
        manual_proforma_fullnumber: raw.proforma_fullnumber,
        manual_comment: raw.match_reason || null,
        manual_user: user || 'quick-auto',
        manual_updated_at: now
      })
      .eq('id', paymentId);

    if (error) {
      logger.error('Supabase error while approving payment match:', error);
      throw error;
    }

    await this.updateProformaPaymentAggregates(raw.proforma_id);

    return this.getPaymentDetails(paymentId);
  }

  async clearManualMatch(paymentId, { user = null, comment = null } = {}) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const raw = await this.fetchPaymentRaw(paymentId);
    const targetProformaId = raw.manual_proforma_id;

    const now = new Date().toISOString();

    const { error } = await supabase
      .from('payments')
      .update({
        manual_status: null,
        manual_proforma_id: null,
        manual_proforma_fullnumber: null,
        manual_comment: comment || null,
        manual_user: user || null,
        manual_updated_at: now
      })
      .eq('id', paymentId);

    if (error) {
      logger.error('Supabase error while clearing manual match:', error);
      throw error;
    }

    if (targetProformaId) {
      await this.updateProformaPaymentAggregates(targetProformaId);
    }

    if (raw.proforma_id && raw.proforma_id !== targetProformaId) {
      await this.updateProformaPaymentAggregates(raw.proforma_id);
    }

    return this.getPaymentDetails(paymentId);
  }

  async deletePayment(paymentId) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const raw = await this.fetchPaymentRaw(paymentId);
    const targetProformaId = raw.manual_proforma_id || raw.proforma_id;

    const { error } = await supabase
      .from('payments')
      .delete()
      .eq('id', paymentId);

    if (error) {
      logger.error('Supabase error while deleting payment:', error);
      throw error;
    }

    if (targetProformaId) {
      await this.updateProformaPaymentAggregates(targetProformaId);
    }

    if (raw.manual_proforma_id && raw.manual_proforma_id !== targetProformaId) {
      await this.updateProformaPaymentAggregates(raw.manual_proforma_id);
    }
  }

  async buildMatchingContext(payments) {
    const context = {
      proformasByNumber: new Map(),
      proformasByBuyer: new Map(),
      proformasByAmount: [] // Для поиска по сумме
    };

    if (!payments.length) {
      return context;
    }

    // Извлекаем номера проформ из поля proforma_fullnumber и из описания
    const numbers = new Set();
    for (const payment of payments) {
      // Из поля proforma_fullnumber (если было извлечено парсером)
      if (payment.proforma_fullnumber) {
        const normalized = this.normalizeProformaNumber(payment.proforma_fullnumber);
        if (normalized) {
          numbers.add(normalized);
        }
      }
      
      // Также пытаемся извлечь из описания, если не было извлечено парсером
      if (payment.description && !payment.proforma_fullnumber) {
        const extracted = this.extractProformaNumberFromDescription(payment.description);
        if (extracted) {
          const normalized = this.normalizeProformaNumber(extracted);
          if (normalized) {
            numbers.add(normalized);
          }
        }
      }
    }

    const buyerNames = Array.from(new Set(
      payments
        .map((item) => item.payer_normalized_name)
        .filter(Boolean)
    ));

    if (numbers.size > 0) {
      const numbersArray = Array.from(numbers);
      logger.debug('Searching proformas by numbers', {
        count: numbersArray.length,
        numbers: numbersArray.slice(0, 5)
      });
      
      const proformas = await this.proformaRepository.findByFullnumbers(numbersArray);
      logger.debug('Found proformas by numbers', {
        requested: numbersArray.length,
        found: proformas.length,
        foundNumbers: proformas.map(p => p.fullnumber).slice(0, 5)
      });
      
      for (const proforma of proformas) {
        if (proforma.fullnumber) {
          // Пропускаем полностью оплаченные проформы
          const remaining = this.calculateRemaining(proforma);
          if (remaining <= 0.01) continue;
          
          const normalized = this.normalizeProformaNumber(proforma.fullnumber);
          context.proformasByNumber.set(normalized, proforma);
        }
      }
    }

    if (buyerNames.length > 0) {
      const proformas = await this.proformaRepository.findByBuyerNames(buyerNames);
      for (const proforma of proformas) {
        // Пропускаем полностью оплаченные проформы
        const remaining = this.calculateRemaining(proforma);
        if (remaining <= 0.01) continue;
        
        const key = proforma.buyer_normalized_name;
        if (!key) continue;
        if (!context.proformasByBuyer.has(key)) {
          context.proformasByBuyer.set(key, []);
        }
        context.proformasByBuyer.get(key).push(proforma);
      }
    }

    // Загружаем активные проформы для поиска по сумме
    // Ограничиваем последними 6 месяцами для производительности
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      if (supabase) {
        const { data: activeProformas, error } = await supabase
          .from('proformas')
          .select('id, fullnumber, currency, total, payments_total, payments_total_pln, currency_exchange, buyer_name, buyer_normalized_name')
          .eq('status', 'active')
          .gte('issued_at', sixMonthsAgo.toISOString())
          .limit(1000); // Ограничиваем для производительности

        if (!error && activeProformas) {
          context.proformasByAmount = activeProformas;
        }
      }
    } catch (error) {
      logger.warn('Failed to load proformas for amount matching:', error);
    }

    return context;
  }
}

module.exports = PaymentService;

