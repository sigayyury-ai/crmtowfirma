const { getStageIdForPipeline } = require('./pipelineConfig');

// Старые ID для обратной совместимости (Camps пайплайн)
const STAGE_IDS = {
  FIRST_PAYMENT: 18,
  SECOND_PAYMENT: 32,
  CAMP_WAITER: 27
};

const SCHEDULE_PROFILES = {
  '100%': {
    key: '100%',
    paymentsExpected: 1,
    depositRatio: 1,
    description: 'Single payment'
  },
  '50/50': {
    key: '50/50',
    paymentsExpected: 2,
    depositRatio: 0.5,
    description: 'Two payments with equal parts'
  },
  '70/30': {
    key: '70/30',
    paymentsExpected: 2,
    depositRatio: 0.7,
    description: 'Two payments with 70% / 30% split'
  }
};

const DEFAULT_PROFILE = SCHEDULE_PROFILES['100%'];
const FINAL_THRESHOLD = 0.95; // consider fully paid when >=95% (currency conversions tolerance)
const DEPOSIT_TOLERANCE = 0.05; // allow +-5% deviation for first milestone

/**
 * Normalize human input into one of the supported schedule keys.
 * @param {string|null|undefined} value
 * @returns {string}
 */
function normalizeSchedule(value) {
  if (!value || typeof value !== 'string') {
    return DEFAULT_PROFILE.key;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized.includes('50')) {
    return SCHEDULE_PROFILES['50/50'].key;
  }
  if (normalized.includes('70')) {
    return SCHEDULE_PROFILES['70/30'].key;
  }
  if (normalized.includes('30/70')) {
    return SCHEDULE_PROFILES['70/30'].key;
  }
  if (normalized === '1' || normalized === 'ONE' || normalized === 'SINGLE') {
    return DEFAULT_PROFILE.key;
  }
  if (Object.prototype.hasOwnProperty.call(SCHEDULE_PROFILES, normalized)) {
    return normalized;
  }
  return DEFAULT_PROFILE.key;
}

/**
 * Calculate paid ratio (0..1) based on totals.
 * @param {number} paidAmount
 * @param {number} expectedAmount
 * @returns {number}
 */
function calculatePaidRatio(paidAmount, expectedAmount) {
  if (!Number.isFinite(paidAmount) || !Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    return 0;
  }
  const ratio = paidAmount / expectedAmount;
  if (!Number.isFinite(ratio)) {
    return 0;
  }
  if (ratio < 0) {
    return 0;
  }
  return Math.min(ratio, 1.5); // clamp to avoid runaway values, keep refunds >100% visible
}

/**
 * Determine target stage id based on schedule and paid ratio.
 * @param {object} options
 * @param {string} options.scheduleType
 * @param {number} options.paidRatio
 * @param {number} [options.manualPaymentsCount]
 * @param {number|string} [options.pipelineId] - ID пайплайна для определения правильных ID статусов
 * @param {string} [options.pipelineName] - Название пайплайна (опционально)
 * @returns {{stageId: number, stageName: string, reason: string}}
 */
function determineStage({ scheduleType, paidRatio, manualPaymentsCount = 0, pipelineId = null, pipelineName = null }) {
  const profile = SCHEDULE_PROFILES[scheduleType] || DEFAULT_PROFILE;
  const ratio = paidRatio || 0;

  // Получаем ID статусов для пайплайна (или используем дефолтные для Camps)
  const firstPaymentId = pipelineId 
    ? getStageIdForPipeline(pipelineId, 'FIRST_PAYMENT', pipelineName) || STAGE_IDS.FIRST_PAYMENT
    : STAGE_IDS.FIRST_PAYMENT;
  const secondPaymentId = pipelineId 
    ? getStageIdForPipeline(pipelineId, 'SECOND_PAYMENT', pipelineName) || STAGE_IDS.SECOND_PAYMENT
    : STAGE_IDS.SECOND_PAYMENT;
  const campWaiterId = pipelineId 
    ? getStageIdForPipeline(pipelineId, 'CAMP_WAITER', pipelineName) || STAGE_IDS.CAMP_WAITER
    : STAGE_IDS.CAMP_WAITER;

  // Fully paid → Camp Waiter
  if (ratio >= FINAL_THRESHOLD || manualPaymentsCount >= profile.paymentsExpected) {
    return {
      stageId: campWaiterId,
      stageName: 'Camp Waiter',
      reason: `Оплачено ${Math.round(ratio * 100)}% (>=${Math.round(FINAL_THRESHOLD * 100)}%)`
    };
  }

  // For multi-step schedules move to "Second Payment" once deposit threshold reached
  if (profile.paymentsExpected > 1) {
    const threshold = Math.max(0, profile.depositRatio - DEPOSIT_TOLERANCE);
    if (ratio >= threshold) {
      return {
        stageId: secondPaymentId,
        stageName: 'Second Payment',
        reason: `Достигнут порог первой оплаты (${Math.round(ratio * 100)}% >= ${Math.round(threshold * 100)}%)`
      };
    }
  }

  return {
    stageId: firstPaymentId,
    stageName: 'First Payment',
    reason: `Ожидаем первоначальный платеж (${Math.round(ratio * 100)}% оплачено)`
  };
}

/**
 * Evaluate payment status for CRM automation.
 * @param {object} payload
 * @param {number} payload.expectedAmountPln - total amount to collect (converted to PLN)
 * @param {number} payload.paidAmountPln - total confirmed amount (PLN)
 * @param {string} [payload.scheduleType='100%']
 * @param {number} [payload.manualPaymentsCount=0]
 * @returns {{
 *   scheduleType: string,
 *   paidAmountPln: number,
 *   expectedAmountPln: number,
 *   paidRatio: number,
 *   targetStageId: number,
 *   targetStageName: string,
 *   reason: string
 * }}
 */
function evaluatePaymentStatus({
  expectedAmountPln,
  paidAmountPln,
  scheduleType = DEFAULT_PROFILE.key,
  manualPaymentsCount = 0,
  pipelineId = null,
  pipelineName = null
}) {
  if (!Number.isFinite(expectedAmountPln) || expectedAmountPln <= 0) {
    throw new Error('evaluatePaymentStatus requires a positive expectedAmountPln');
  }

  const normalizedSchedule = normalizeSchedule(scheduleType);
  const paidRatio = calculatePaidRatio(paidAmountPln || 0, expectedAmountPln);
  const stage = determineStage({
    scheduleType: normalizedSchedule,
    paidRatio,
    manualPaymentsCount,
    pipelineId,
    pipelineName
  });

  return {
    scheduleType: normalizedSchedule,
    paidAmountPln: Number.isFinite(paidAmountPln) ? paidAmountPln : 0,
    expectedAmountPln,
    paidRatio,
    targetStageId: stage.stageId,
    targetStageName: stage.stageName,
    reason: stage.reason,
    paymentsExpected: (SCHEDULE_PROFILES[normalizedSchedule] || DEFAULT_PROFILE).paymentsExpected,
    manualPaymentsCount
  };
}

module.exports = {
  STAGE_IDS,
  SCHEDULE_PROFILES,
  normalizeSchedule,
  evaluatePaymentStatus,
  determineStage,
  calculatePaidRatio
};
