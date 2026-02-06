/**
 * Expenses report split by VAT flow (018): margin_scheme vs general.
 * Used for PNL breakdown and export "wydatki ogólne" for wFirma/JPK.
 */

const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const { getEffectiveVatFlow } = require('./vatFlowHelper');
const exchangeRateService = require('../stripe/exchangeRateService');

function toNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Map payment source to export źródło label */
function sourceToZrodlo(source) {
  if (!source) return 'bank';
  const s = String(source).toLowerCase();
  if (s === 'bank_statement' || s === 'bank') return 'bank';
  if (s === 'manual' || s === 'ręczny') return 'ręczny';
  if (s === 'stripe') return 'stripe';
  return s;
}

/** Human-readable reason why expense is in this VAT flow (for control/detail view). */
function getVatFlowReason({ vatFlowOverride, hasProductLink, categoryVatFlow, categoryName, effective }) {
  const { VALID_FLOWS } = require('./vatFlowHelper');
  if (vatFlowOverride != null && VALID_FLOWS.includes(vatFlowOverride)) {
    return effective === 'margin_scheme' ? 'Задан вручную: VAT marża' : 'Задан вручную: zwykły VAT';
  }
  if (hasProductLink === true) return 'Связь с продуктом (VAT marża)';
  if (categoryVatFlow != null && VALID_FLOWS.includes(categoryVatFlow)) {
    return `Категория: ${categoryName || 'Без категории'}`;
  }
  return 'По умолчанию (zwykły VAT)';
}

/**
 * Get expenses in date range with effective VAT flow, grouped by margin_scheme / general.
 * Includes bank payments (direction=out) and manual expense entries.
 *
 * @param {string} fromDate - ISO date (inclusive)
 * @param {string} toDate - ISO date (inclusive)
 * @returns {Promise<{ margin_scheme: { totalPln, count, items }, general: { totalPln, count, items } }>}
 */
async function getExpensesByVatFlow(fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error('Invalid from or to date');
  }
  if (from > to) {
    throw new Error('from must be <= to');
  }

  const marginItems = [];
  const generalItems = [];
  let marginTotalPln = 0;
  let generalTotalPln = 0;

  const ExpenseCategoryService = require('./expenseCategoryService');
  const expenseCategoryService = new ExpenseCategoryService();
  const categories = await expenseCategoryService.listCategories();
  const categoryMap = new Map((categories || []).map(c => [c.id, c]));

  // 1) Bank payments (direction = out)
  const { data: payments, error: payErr } = await supabase
    .from('payments')
    .select('id, operation_date, amount, amount_pln, currency, currency_exchange, payer_name, expense_category_id, source, vat_flow_override')
    .eq('direction', 'out')
    .is('deleted_at', null)
    .gte('operation_date', from.toISOString())
    .lte('operation_date', to.toISOString())
    .order('operation_date', { ascending: false })
    .limit(10000);

  if (payErr) {
    logger.error('expensesByVatFlow: payments error', payErr);
    throw payErr;
  }

  const paymentIds = (payments || []).map(p => p.id);
  let productLinkPaymentIds = new Set();
  if (paymentIds.length > 0) {
    const { data: links } = await supabase
      .from('payment_product_links')
      .select('payment_id')
      .in('payment_id', paymentIds);
    productLinkPaymentIds = new Set((links || []).map(r => r.payment_id));
  }

  for (const p of payments || []) {
    let amountPln = toNumber(p.amount_pln);
    if (amountPln == null || amountPln <= 0) {
      const curr = (p.currency || 'PLN').toUpperCase();
      const amt = Math.abs(toNumber(p.amount) || 0);
      if (curr === 'PLN') amountPln = amt;
      else {
        try {
          const rate = await exchangeRateService.getRate(curr, 'PLN');
          amountPln = rate && rate > 0 ? amt * rate : null;
        } catch (_) {
          amountPln = null;
        }
      }
    } else {
      amountPln = Math.abs(amountPln);
    }
    if (amountPln == null || amountPln <= 0) continue;

    const category = p.expense_category_id ? categoryMap.get(p.expense_category_id) : null;
    if (category && category.exclude_from_vat) continue; // kasa / szara strefa — не для учёта и НДС
    const hasProductLink = productLinkPaymentIds.has(p.id);
    const effective = getEffectiveVatFlow({
      vatFlowOverride: p.vat_flow_override || null,
      hasProductLink,
      categoryVatFlow: category?.vat_flow || null
    });
    const vat_flow_reason = getVatFlowReason({
      vatFlowOverride: p.vat_flow_override,
      hasProductLink,
      categoryVatFlow: category?.vat_flow,
      categoryName: category?.name,
      effective
    });

    const item = {
      id: p.id,
      date: p.operation_date,
      amountPln: Math.round(amountPln * 100) / 100,
      payer_name: p.payer_name || '',
      categoryName: category?.name || 'Без категории',
      source: p.source || 'bank_statement',
      effective_vat_flow: effective,
      vat_flow_reason
    };

    if (effective === 'margin_scheme') {
      marginItems.push(item);
      marginTotalPln += item.amountPln;
    } else {
      generalItems.push(item);
      generalTotalPln += item.amountPln;
    }
  }

  // 2) Manual expense entries (entry_type = 'expense') in range
  const fromYear = from.getUTCFullYear();
  const fromMonth = from.getUTCMonth() + 1;
  const toYear = to.getUTCFullYear();
  const toMonth = to.getUTCMonth() + 1;

  const manualYears = [];
  for (let y = fromYear; y <= toYear; y++) manualYears.push(y);

  const { data: manualRows } = await supabase
    .from('pnl_manual_entries')
    .select('id, year, month, amount_pln, expense_category_id')
    .eq('entry_type', 'expense')
    .in('year', manualYears)
    .limit(5000);

  for (const row of manualRows || []) {
    const y = row.year;
    const m = row.month;
    const inRange = (y > fromYear || (y === fromYear && m >= fromMonth)) &&
      (y < toYear || (y === toYear && m <= toMonth));
    if (!inRange) continue;

    const amountPln = Math.abs(toNumber(row.amount_pln) || 0);
    if (amountPln <= 0) continue;

    const category = row.expense_category_id ? categoryMap.get(row.expense_category_id) : null;
    if (category && category.exclude_from_vat) continue; // kasa / szara strefa
    const effective = (category?.vat_flow === 'margin_scheme') ? 'margin_scheme' : 'general';
    const vat_flow_reason = (category?.vat_flow === 'margin_scheme')
      ? `Категория: ${category?.name || 'Без категории'} (VAT marża)`
      : (category?.vat_flow === 'general' ? `Категория: ${category?.name || 'Без категории'}` : 'По умолчанию (zwykły VAT)');
    const firstDay = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);

    const item = {
      id: `manual-${row.id}`,
      date: firstDay,
      amountPln: Math.round(amountPln * 100) / 100,
      payer_name: '',
      categoryName: category?.name || 'Без категории',
      source: 'manual',
      effective_vat_flow: effective,
      vat_flow_reason
    };

    if (effective === 'margin_scheme') {
      marginItems.push(item);
      marginTotalPln += item.amountPln;
    } else {
      generalItems.push(item);
      generalTotalPln += item.amountPln;
    }
  }

  return {
    margin_scheme: {
      totalPln: Math.round(marginTotalPln * 100) / 100,
      count: marginItems.length,
      items: marginItems
    },
    general: {
      totalPln: Math.round(generalTotalPln * 100) / 100,
      count: generalItems.length,
      items: generalItems
    }
  };
}

/**
 * Get list of "general" (ordinary VAT) expenses for export to wFirma/JPK.
 * Fields: data, kwota, kontrahent, kategoria, źródło.
 *
 * @param {string} fromDate - ISO date (inclusive)
 * @param {string} toDate - ISO date (inclusive)
 * @returns {Promise<Array<{ data: string, kwota: number, kontrahent: string, kategoria: string, źródło: string }>>}
 */
async function getGeneralExpensesForExport(fromDate, toDate) {
  const { general } = await getExpensesByVatFlow(fromDate, toDate);
  return general.items.map(it => ({
    data: it.date ? it.date.slice(0, 10) : '',
    kwota: it.amountPln,
    kontrahent: it.payer_name || '',
    kategoria: it.categoryName || '',
    źródło: sourceToZrodlo(it.source)
  }));
}

module.exports = {
  getExpensesByVatFlow,
  getGeneralExpensesForExport
};
