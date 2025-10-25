const {
  sanitizeString,
  sanitizeObject,
  sanitizeInfo,
  resetIncidentStats,
  getIncidentStats
} = require('../../src/utils/logSanitizer');

const ORIGINAL_VERBOSE = process.env.LOG_SANITIZER_DEV_VERBOSE;

describe('logSanitizer', () => {
  beforeEach(() => {
    resetIncidentStats();
  });

  afterEach(() => {
    process.env.LOG_SANITIZER_DEV_VERBOSE = ORIGINAL_VERBOSE;
  });

  test('masks email addresses', () => {
    const { sanitized, maskedFields } = sanitizeString('Contact me at test@example.com');
    expect(sanitized).not.toContain('test@example.com');
    expect(maskedFields.some((m) => m.type === 'EMAIL')).toBe(true);
  });

  test('masks proforma numbers', () => {
    const { sanitized } = sanitizeString('Invoice CO-PROF 123/2025 ready');
    expect(sanitized).toBe('Invoice CO-PROF ***/2025 ready');
  });

  test('sanitizes nested objects', () => {
    const input = {
      meta: {
        email: 'user@mail.com',
        child: {
          token: 'abcdefghijklmnopqrstuv'
        }
      }
    };

    const { sanitized, maskedFields } = sanitizeObject(input);
    expect(sanitized.meta.email).toBe('***masked-email***');
    expect(maskedFields.length).toBe(2);
  });

  test('sanitizes info payload', () => {
    const info = {
      level: 'info',
      message: 'Send to john@doe.com',
      metadata: {
        amount: '500 PLN'
      }
    };

    const sanitized = sanitizeInfo(info);
    expect(sanitized.message).not.toContain('john@doe.com');
    expect(sanitized.metadata.amount).toBe('~[amount-masked]');
    expect(sanitized.maskedFields).toBeUndefined();
  });

  test('tracks incident stats', () => {
    sanitizeString('Email admin@example.com');
    const stats = getIncidentStats();
    expect(stats.totalMasked).toBe(1);
    expect(stats.maskedByType.EMAIL).toBe(1);
  });

  test('DEV verbose flag exposes masked fields', () => {
    process.env.LOG_SANITIZER_DEV_VERBOSE = 'true';
    const info = {
      level: 'info',
      message: 'Email jane@doe.com',
      metadata: { amount: '1200 PLN' }
    };

    const sanitized = sanitizeInfo(info);
    expect(Array.isArray(sanitized.maskedFields)).toBe(true);
    expect(sanitized.maskedFields.length).toBeGreaterThan(0);
  });

  test('default mode hides masked fields summary', () => {
    delete process.env.LOG_SANITIZER_DEV_VERBOSE;
    const info = {
      level: 'info',
      message: 'Email jane@doe.com',
      metadata: { amount: '1200 PLN' }
    };

    const sanitized = sanitizeInfo(info);
    expect(sanitized.maskedFields).toBeUndefined();
    expect(Array.isArray(sanitized.maskedSummary)).toBe(true);
    expect(sanitized.maskedSummary[0]).toContain('masked fields');
  });
});

