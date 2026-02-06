/**
 * VAT flow classification helper (018-accounting-foundation-vat-flows).
 *
 * Rule: effective VAT flow = override ?? product_link ?? category ?? default.
 * - margin_scheme: VAT-marża (Art. 119), tourism product margin; not deductible as ordinary VAT.
 * - general: ordinary VAT, deductible (wydatki ogólne).
 *
 * @see specs/018-accounting-foundation-vat-flows/data-model.md
 */

const VALID_FLOWS = Object.freeze(['margin_scheme', 'general']);
const DEFAULT_FLOW = 'general';

/**
 * Get effective VAT flow for an expense (payment or manual entry).
 *
 * @param {Object} options
 * @param {string|null|undefined} [options.vatFlowOverride] - payment.vat_flow_override (only for payments)
 * @param {boolean} [options.hasProductLink] - true if payment has at least one payment_product_links row (only for payments)
 * @param {string|null|undefined} [options.categoryVatFlow] - pnl_expense_categories.vat_flow for the expense category
 * @returns {'margin_scheme'|'general'}
 */
function getEffectiveVatFlow({ vatFlowOverride, hasProductLink, categoryVatFlow }) {
  // 1. Override wins
  if (vatFlowOverride != null && VALID_FLOWS.includes(vatFlowOverride)) {
    return vatFlowOverride;
  }
  // 2. Product-linked → margin_scheme
  if (hasProductLink === true) {
    return 'margin_scheme';
  }
  // 3. Category
  if (categoryVatFlow != null && VALID_FLOWS.includes(categoryVatFlow)) {
    return categoryVatFlow;
  }
  // 4. Default
  return DEFAULT_FLOW;
}

/**
 * Normalize raw vat_flow from DB to valid value or null.
 * @param {*} value
 * @returns {string|null}
 */
function normalizeVatFlow(value) {
  if (value == null) return null;
  const s = String(value).toLowerCase().trim();
  return VALID_FLOWS.includes(s) ? s : null;
}

module.exports = {
  getEffectiveVatFlow,
  normalizeVatFlow,
  VALID_FLOWS,
  DEFAULT_FLOW
};
