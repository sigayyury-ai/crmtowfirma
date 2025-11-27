const logger = require('../../utils/logger');

const SENDPULSE_ID_FIELD_KEY = process.env.PIPEDRIVE_SENDPULSE_ID_FIELD_KEY || 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';

function formatAmount(amount, currency) {
  if (!Number.isFinite(amount)) {
    return '—';
  }
  const normalizedCurrency = (currency || 'PLN').toUpperCase();
  return `${amount.toFixed(2)} ${normalizedCurrency}`;
}

function formatDateLabel(value) {
  if (!value) {
    return 'дата не указана';
  }
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleDateString('ru-RU');
  } catch (error) {
    return value;
  }
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function fetchSendpulseId(pipedriveClient, personId) {
  if (!pipedriveClient || !personId) {
    return null;
  }
  try {
    const result = await pipedriveClient.getPerson(personId);
    if (result?.success && result.person) {
      const rawValue = result.person[SENDPULSE_ID_FIELD_KEY];
      return rawValue ? String(rawValue).trim() : null;
    }
  } catch (error) {
    logger.warn('Failed to fetch SendPulse ID for person', { personId, error: error.message });
  }
  return null;
}

async function sendNotification({ sendpulseClient, sendpulseId, dealId, buyerName, formattedAmount, formattedDate }) {
  if (!sendpulseClient || !sendpulseId) {
    return;
  }

  const message = [
    '💵 *Получить наличные*',
    `Сумма: ${formattedAmount}`,
    `Клиент: ${buyerName || `Deal #${dealId}`}`,
    `Дедлайн: ${formattedDate}`
  ].join('\n');

  try {
    await sendpulseClient.sendTelegramMessage(sendpulseId, message);
    logger.info('Cash reminder notification sent via SendPulse', { dealId, sendpulseId });
  } catch (error) {
    logger.warn('Failed to send SendPulse notification', { dealId, error: error.message });
  }
}

async function createCashReminder(pipedriveClient, {
  dealId,
  amount,
  currency,
  expectedDate,
  closeDate,
  source,
  buyerName,
  personId,
  sendpulseClient
}) {
  if (!pipedriveClient || !dealId) {
    return;
  }

  const formattedAmount = formatAmount(amount, currency);
  const formattedDate = formatDateLabel(expectedDate);
  const sourceLabel = source ? `Источник: ${source}` : 'Источник: CRM';
  const titleParts = [
    'Забрать',
    formattedAmount,
    'у',
    buyerName || `Deal #${dealId}`
  ].filter(Boolean);

  const closeDateParsed = normalizeDate(closeDate);
  const expectedDateParsed = normalizeDate(expectedDate);
  let dueDate = expectedDateParsed || closeDateParsed || new Date();

  if (closeDateParsed) {
    const minDue = addDays(closeDateParsed, 3);
    if (dueDate < minDue) {
      dueDate = minDue;
    }
  }

  const taskData = {
    deal_id: dealId,
    subject: titleParts.join(' '),
    due_date: dueDate.toISOString().slice(0, 10),
    type: 'task',
    note: [
    '💵 *Получить наличные*',
      `Сумма: ${formattedAmount}`,
    `Ожидаемая дата: ${formattedDate}`,
    sourceLabel
    ].join('\n')
  };

  try {
    await pipedriveClient.createTask(taskData);
    logger.info('Cash reminder task created in Pipedrive', {
      dealId,
      amount: formattedAmount
    });
  } catch (error) {
    logger.warn('Failed to create cash reminder task', { dealId, error: error.message });
  }

  if (sendpulseClient) {
    const sendpulseId = await fetchSendpulseId(pipedriveClient, personId);
    await sendNotification({
      sendpulseClient,
      sendpulseId,
      dealId,
      buyerName,
      formattedAmount,
      formattedDate
    });
  }
}

module.exports = {
  createCashReminder
};
