// Mock logger before requiring the service
jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const PaymentScheduleService = require('../../../src/services/stripe/paymentScheduleService');

describe('PaymentScheduleService', () => {
  describe('determineSchedule', () => {
    test('should return 50/50 schedule when daysDiff >= 30', () => {
      const today = new Date('2025-01-15');
      const closeDate = new Date('2025-03-15'); // 59 days later
      
      const result = PaymentScheduleService.determineSchedule(closeDate, today);
      
      expect(result.schedule).toBe('50/50');
      expect(result.daysDiff).toBe(59);
      expect(result.secondPaymentDate).toBeInstanceOf(Date);
    });

    test('should return 100% schedule when daysDiff < 30', () => {
      const today = new Date('2025-01-15');
      const closeDate = new Date('2025-02-10'); // 26 days later
      
      const result = PaymentScheduleService.determineSchedule(closeDate, today);
      
      expect(result.schedule).toBe('100%');
      expect(result.daysDiff).toBe(26);
      expect(result.secondPaymentDate).toBeNull();
    });

    test('should return 100% schedule when closeDate is null', () => {
      const result = PaymentScheduleService.determineSchedule(null);
      
      expect(result.schedule).toBe('100%');
      expect(result.daysDiff).toBeNull();
      expect(result.secondPaymentDate).toBeNull();
    });

    test('should return 100% schedule when closeDate is invalid', () => {
      const result = PaymentScheduleService.determineSchedule('invalid-date');
      
      expect(result.schedule).toBe('100%');
      expect(result.daysDiff).toBeNull();
      expect(result.secondPaymentDate).toBeNull();
    });

    test('should calculate secondPaymentDate correctly for 50/50 schedule', () => {
      const today = new Date('2025-01-15');
      const closeDate = new Date('2025-03-15'); // March 15
      
      const result = PaymentScheduleService.determineSchedule(closeDate, today);
      
      expect(result.schedule).toBe('50/50');
      expect(result.secondPaymentDate).toBeInstanceOf(Date);
      // Second payment should be 1 month before close date
      const expectedSecondPayment = new Date(closeDate);
      expectedSecondPayment.setMonth(expectedSecondPayment.getMonth() - 1);
      expect(result.secondPaymentDate.getTime()).toBe(expectedSecondPayment.getTime());
    });

    test('should handle exactly 30 days as 50/50', () => {
      const today = new Date('2025-01-15');
      const closeDate = new Date('2025-02-14'); // Exactly 30 days later
      
      const result = PaymentScheduleService.determineSchedule(closeDate, today);
      
      expect(result.schedule).toBe('50/50');
      expect(result.daysDiff).toBe(30);
    });
  });

  describe('determineScheduleFromDeal', () => {
    test('should use expected_close_date when available', () => {
      // Use a date that's definitely >= 30 days from now
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 60);
      const futureDateStr = futureDate.toISOString().split('T')[0];
      
      const deal = {
        id: '123',
        expected_close_date: futureDateStr,
        close_date: '2025-02-10'
      };
      
      const result = PaymentScheduleService.determineScheduleFromDeal(deal);
      
      expect(result.schedule).toBe('50/50');
    });

    test('should fallback to close_date when expected_close_date is missing', () => {
      const deal = {
        id: '123',
        close_date: '2025-02-10'
      };
      
      const result = PaymentScheduleService.determineScheduleFromDeal(deal);
      
      expect(result.schedule).toBe('100%'); // 26 days < 30
    });

    test('should return 100% when deal has no date fields', () => {
      const deal = {
        id: '123'
      };
      
      const result = PaymentScheduleService.determineScheduleFromDeal(deal);
      
      expect(result.schedule).toBe('100%');
      expect(result.daysDiff).toBeNull();
    });

    test('should handle null deal', () => {
      const result = PaymentScheduleService.determineScheduleFromDeal(null);
      
      expect(result.schedule).toBe('100%');
    });
  });

  describe('calculateSecondPaymentDate', () => {
    test('should calculate second payment date correctly', () => {
      const closeDate = new Date('2025-03-15');
      const result = PaymentScheduleService.calculateSecondPaymentDate(closeDate);
      
      expect(result).toBeInstanceOf(Date);
      const expected = new Date(closeDate);
      expected.setMonth(expected.getMonth() - 1);
      expect(result.getTime()).toBe(expected.getTime());
    });

    test('should return null for null input', () => {
      const result = PaymentScheduleService.calculateSecondPaymentDate(null);
      expect(result).toBeNull();
    });

    test('should return null for invalid date', () => {
      const result = PaymentScheduleService.calculateSecondPaymentDate('invalid');
      expect(result).toBeNull();
    });
  });

  describe('isSecondPaymentDateReached', () => {
    test('should return true when date is in the past', () => {
      const pastDate = new Date('2025-01-01');
      const today = new Date('2025-01-15');
      
      const result = PaymentScheduleService.isSecondPaymentDateReached(pastDate, today);
      expect(result).toBe(true);
    });

    test('should return false when date is in the future', () => {
      const futureDate = new Date('2025-02-15');
      const today = new Date('2025-01-15');
      
      const result = PaymentScheduleService.isSecondPaymentDateReached(futureDate, today);
      expect(result).toBe(false);
    });

    test('should return true when date is today', () => {
      const today = new Date('2025-01-15');
      
      const result = PaymentScheduleService.isSecondPaymentDateReached(today, today);
      expect(result).toBe(true);
    });

    test('should return false for null input', () => {
      const result = PaymentScheduleService.isSecondPaymentDateReached(null);
      expect(result).toBe(false);
    });
  });
});

