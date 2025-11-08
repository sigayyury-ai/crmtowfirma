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

    const normalizedNumber = this.normalizeProformaNumber(payment.proforma_fullnumber);
    if (normalizedNumber) {
      const candidate = context.proformasByNumber.get(normalizedNumber);
      if (candidate) {
        const remaining = this.calculateRemaining(candidate);
        const amountDiff = Math.abs((Number(payment.amount) || 0) - remaining);
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
      }
    }

    if (!candidates.length && payment.payer_normalized_name) {
      const list = context.proformasByBuyer.get(payment.payer_normalized_name) || [];
      for (const proforma of list) {
        const remaining = this.calculateRemaining(proforma);
        const paymentAmount = Number(payment.amount) || 0;
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
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  normalizeProformaNumber(value) {
    if (!value) return null;
    return normalizeWhitespace(String(value)).toUpperCase();
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
      const { id, ...changes } = update;
      const { error: updateError } = await supabase
        .from('payments')
        .update(changes)
        .eq('id', id);

      if (updateError) {
        logger.error('Supabase error while approving payment match:', updateError);
        failedUpdates.push({ id, error: updateError });
      } else {
        processed += 1;
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

    return this.getPaymentDetails(paymentId);
  }

  async clearManualMatch(paymentId, { user = null, comment = null } = {}) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    await this.fetchPaymentRaw(paymentId);

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

    return this.getPaymentDetails(paymentId);
  }

  async deletePayment(paymentId) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    await this.fetchPaymentRaw(paymentId);

    const { error } = await supabase
      .from('payments')
      .delete()
      .eq('id', paymentId);

    if (error) {
      logger.error('Supabase error while deleting payment:', error);
      throw error;
    }
  }

  async buildMatchingContext(payments) {
    const context = {
      proformasByNumber: new Map(),
      proformasByBuyer: new Map()
    };

    if (!payments.length) {
      return context;
    }

    const numbers = Array.from(new Set(
      payments
        .map((item) => this.normalizeProformaNumber(item.proforma_fullnumber))
        .filter(Boolean)
    ));

    const buyerNames = Array.from(new Set(
      payments
        .map((item) => item.payer_normalized_name)
        .filter(Boolean)
    ));

    if (numbers.length > 0) {
      const proformas = await this.proformaRepository.findByFullnumbers(numbers);
      for (const proforma of proformas) {
        if (proforma.fullnumber) {
          context.proformasByNumber.set(this.normalizeProformaNumber(proforma.fullnumber), proforma);
        }
      }
    }

    if (buyerNames.length > 0) {
      const proformas = await this.proformaRepository.findByBuyerNames(buyerNames);
      for (const proforma of proformas) {
        const key = proforma.buyer_normalized_name;
        if (!key) continue;
        if (!context.proformasByBuyer.has(key)) {
          context.proformasByBuyer.set(key, []);
        }
        context.proformasByBuyer.get(key).push(proforma);
      }
    }

    return context;
  }
}

module.exports = PaymentService;

