const CHANNEL_MAP = {
  'paid social': 'Paid social',
  'paid search': 'Paid search',
  'organic social': 'Organic social',
  'organic search': 'Organic search',
  direct: 'Direct',
  referral: 'Referral',
  partners: 'Partners',
  none: 'None'
};

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  return email.trim().toLowerCase();
}

function getMonthKey(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function resolveChannelBucket(rawValue) {
  if (!rawValue) return null;
  const normalized = rawValue.toLowerCase();
  return CHANNEL_MAP[normalized] || 'None';
}

module.exports = {
  normalizeEmail,
  getMonthKey,
  resolveChannelBucket
};


