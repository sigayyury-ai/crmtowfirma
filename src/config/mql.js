function parseStageIds(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => !Number.isNaN(item) && item > 0);
}

function stringOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function parseNumberList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((num) => Number.isFinite(num) && num > 0);
}

module.exports = {
  sendpulseTag: process.env.MQL_SENDPULSE_TAG || 'Mql',
  sendpulseBotId: process.env.SENDPULSE_INSTAGRAM_BOT_ID || '65ec7b3f08090e12cd01a7ca',
  syncLookbackMonths: Number(process.env.MQL_SYNC_LOOKBACK_MONTHS || 24),
  pipedriveLabelId: (process.env.PIPEDRIVE_MQL_LABEL_ID || '25').trim(),
  pipedriveSqlLabelIds: (() => {
    const raw = process.env.PIPEDRIVE_SQL_LABEL_IDS;
    if (!raw) return ['26'];
    const entries = raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length);
    return entries.length ? entries : ['26'];
  })(),
  pipedriveConversationStageIds: parseStageIds(process.env.PIPEDRIVE_CONVERSATION_STAGE_IDS || '3,35'),
  pipedriveMaxPages: Number(process.env.MQL_PIPEDRIVE_MAX_PAGES || 25),
  pipedrivePageSize: Number(process.env.MQL_PIPEDRIVE_PAGE_SIZE || 100),
  pipedriveUtmSourceField: stringOrNull(process.env.MQL_PIPEDRIVE_UTM_SOURCE_FIELD),
  pipedriveUtmMediumField: stringOrNull(process.env.MQL_PIPEDRIVE_UTM_MEDIUM_FIELD),
  pipedriveUtmCampaignField: stringOrNull(process.env.MQL_PIPEDRIVE_UTM_CAMPAIGN_FIELD),
  marketingExpenseCategoryIds: (() => {
    const ids = parseNumberList(process.env.MQL_MARKETING_EXPENSE_CATEGORY_IDS);
    return ids.length ? ids : [20];
  })()
};

