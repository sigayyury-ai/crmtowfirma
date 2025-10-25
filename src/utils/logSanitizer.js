const fs = require('fs');
const path = require('path');

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_REGEX = /(?:\+?\d[\s-]?){6,15}/g;
const TOKEN_REGEX = /[A-Za-z0-9\-_]{20,}/g;
const PROFORMA_REGEX = /CO-PROF\s?\d{1,3}\/\d{4}/gi;
const AMOUNT_REGEX = /\b\d{1,3}(?:[\s\u00A0]?)?(?:\d{3}(?:[\s\u00A0]?))*([.,]\d{1,2})?\s?(PLN|USD|EUR)?\b/gi;

const INCIDENT_WARNING_THRESHOLD = Number.parseInt(process.env.LOG_SANITIZER_WARNING_THRESHOLD || '10', 10);
function isDevVerbose() {
  return /true/i.test(process.env.LOG_SANITIZER_DEV_VERBOSE || 'false');
}

const MaskTypes = {
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  TOKEN: 'TOKEN',
  PROFORMA: 'PROFORMA_NUMBER',
  AMOUNT: 'AMOUNT'
};

const patterns = () => [
  { type: MaskTypes.EMAIL, regex: EMAIL_REGEX, replacer: () => '***masked-email***' },
  { type: MaskTypes.PHONE, regex: PHONE_REGEX, replacer: () => '***masked-phone***' },
  {
    type: MaskTypes.TOKEN,
    regex: TOKEN_REGEX,
    replacer: () => '***masked-token***'
  },
  {
    type: MaskTypes.PROFORMA,
    regex: PROFORMA_REGEX,
    replacer: (match) => {
      const year = match.slice(-4);
      return `CO-PROF ***/${year}`;
    }
  },
  {
    type: MaskTypes.AMOUNT,
    regex: AMOUNT_REGEX,
    replacer: () => '~[amount-masked]'
  }
];

const incidents = {
  totalMasked: 0,
  maskedByType: {},
  latest: []
};

function trackIncident(type, originalLength, context = {}) {
  incidents.totalMasked += 1;
  incidents.maskedByType[type] = (incidents.maskedByType[type] || 0) + 1;
  incidents.latest.push({
    timestamp: new Date().toISOString(),
    type,
    originalLength,
    context
  });

  if (incidents.latest.length > 50) {
    incidents.latest.shift();
  }
}

function sanitizeString(value, context = {}) {
  if (typeof value !== 'string') {
    return { sanitized: value, maskedFields: [] };
  }

  let sanitized = value;
  const maskedFields = [];

  patterns().forEach(({ type, regex, replacer }) => {
    regex.lastIndex = 0;
    const matches = sanitized.match(regex);
    if (!matches) return;

    matches.forEach((match) => {
      const replacement = typeof replacer === 'function' ? replacer(match) : replacer;
      sanitized = sanitized.replace(match, replacement);
      maskedFields.push({ type, originalLength: match.length, replacement });
      trackIncident(type, match.length, context);
    });
  });

  return { sanitized, maskedFields };
}

function sanitizeObject(obj, context = {}) {
  if (!obj || typeof obj !== 'object') return { sanitized: obj, maskedFields: [] };

  const clone = Array.isArray(obj) ? [] : {};
  const maskedFields = [];

  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (typeof value === 'string') {
      const result = sanitizeString(value, { ...context, field: key });
      clone[key] = result.sanitized;
      maskedFields.push(...result.maskedFields);
    } else if (value && typeof value === 'object') {
      const result = sanitizeObject(value, { ...context, field: key });
      clone[key] = result.sanitized;
      maskedFields.push(...result.maskedFields);
    } else {
      clone[key] = value;
    }
  });

  return { sanitized: clone, maskedFields };
}

function sanitizeInfo(info) {
  const context = { level: info.level, correlationId: info.correlationId };
  const maskedSummary = [];

  const { sanitized: message, maskedFields: messageMasked } = sanitizeString(info.message, {
    ...context,
    field: 'message'
  });

  const { sanitized: metadata, maskedFields: metaMasked } = sanitizeObject(info.metadata || {}, {
    ...context,
    field: 'metadata'
  });

  const totalMasked = [...messageMasked, ...metaMasked];

  if (!isDevVerbose() && totalMasked.length > 0) {
    maskedSummary.push(`${totalMasked.length} masked fields`);
  }

  return {
    ...info,
    message,
    metadata,
    maskedFields: isDevVerbose() ? totalMasked : undefined,
    maskedSummary: isDevVerbose() ? undefined : maskedSummary
  };
}

function getIncidentStats() {
  return {
    totalMasked: incidents.totalMasked,
    maskedByType: { ...incidents.maskedByType },
    latest: [...incidents.latest]
  };
}

function resetIncidentStats() {
  incidents.totalMasked = 0;
  incidents.maskedByType = {};
  incidents.latest = [];
}

function exportIncidents({ format = 'json', output } = {}) {
  const stats = getIncidentStats();
  const outPath = output ? path.resolve(output) : path.resolve(process.cwd(), `reports/incidents.${format}`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (format === 'csv') {
    const header = 'timestamp,type,originalLength,context\n';
    const rows = stats.latest
      .map((item) => {
        const context = JSON.stringify(item.context || {});
        return `${item.timestamp},${item.type},${item.originalLength},"${context.replace(/"/g, '""')}"`;
      })
      .join('\n');
    fs.writeFileSync(outPath, `${header}${rows}\n`, 'utf8');
  } else {
    fs.writeFileSync(outPath, JSON.stringify(stats, null, 2), 'utf8');
  }

  return outPath;
}

function hasWarningLevel() {
  return incidents.totalMasked >= INCIDENT_WARNING_THRESHOLD;
}

module.exports = {
  sanitizeInfo,
  sanitizeString,
  sanitizeObject,
  getIncidentStats,
  resetIncidentStats,
  exportIncidents,
  hasWarningLevel,
  MaskTypes
};

