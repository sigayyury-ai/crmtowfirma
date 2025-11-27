const logger = require('../../utils/logger');
const { PIPEDRIVE_CASH_FIELDS, CASH_STATUS_OPTIONS } = require('../../../config/customFields');

function normalizeStatusValue(value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return value;
}

async function ensureCashStatus({ pipedriveClient, dealId, currentStatus, targetStatus = 'PENDING' }) {
  if (!pipedriveClient || !dealId) {
    return null;
  }

  const fieldKey = PIPEDRIVE_CASH_FIELDS?.cashStatus?.key;
  const statusId = CASH_STATUS_OPTIONS?.[targetStatus];

  if (!fieldKey || !statusId) {
    return null;
  }

  const normalizedCurrent = normalizeStatusValue(currentStatus);
  if (normalizedCurrent === statusId || normalizedCurrent === targetStatus) {
    return statusId;
  }

  try {
    await pipedriveClient.updateDeal(dealId, {
      [fieldKey]: statusId
    });
    logger.info('Updated Pipedrive cash status', {
      dealId,
      statusId,
      targetStatus
    });
    return statusId;
  } catch (error) {
    logger.warn('Failed to update Pipedrive cash status', {
      dealId,
      targetStatus,
      error: error.message
    });
    return null;
  }
}

module.exports = {
  ensureCashStatus
};
