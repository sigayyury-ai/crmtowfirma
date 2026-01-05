// Mock dependencies before requiring the service
jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../../src/services/stripe/repository', () => {
  return jest.fn().mockImplementation(() => ({
    listPayments: jest.fn()
  }));
});

jest.mock('../../../src/services/stripe/client', () => ({
  getStripeClient: jest.fn(() => ({
    checkout: {
      sessions: {
        list: jest.fn()
      }
    }
  }))
}));

const PaymentStateAnalyzer = require('../../../src/services/stripe/paymentStateAnalyzer');
const PaymentScheduleService = require('../../../src/services/stripe/paymentScheduleService');

describe('PaymentStateAnalyzer', () => {
  let analyzer;
  let mockRepository;
  let mockStripe;

  beforeEach(() => {
    mockRepository = {
      listPayments: jest.fn()
    };
    mockStripe = {
      checkout: {
        sessions: {
          list: jest.fn()
        }
      }
    };
    
    analyzer = new PaymentStateAnalyzer({
      repository: mockRepository,
      stripe: mockStripe
    });
  });

  describe('analyzePaymentState', () => {
    test('should identify needsDeposit for 50/50 schedule when no deposit exists', async () => {
      const schedule = { schedule: '50/50', secondPaymentDate: new Date('2025-03-01'), daysDiff: 60 };
      mockRepository.listPayments.mockResolvedValue([]);

      const result = await analyzer.analyzePaymentState('123', schedule);

      expect(result.needsDeposit).toBe(true);
      expect(result.needsRest).toBe(false);
      expect(result.needsSingle).toBe(false);
    });

    test('should identify needsRest for 50/50 schedule when deposit is paid', async () => {
      const schedule = { 
        schedule: '50/50', 
        secondPaymentDate: new Date('2025-01-01'), // Past date
        daysDiff: 60 
      };
      const pastDate = new Date('2024-12-01');
      mockRepository.listPayments.mockResolvedValue([
        {
          payment_type: 'deposit',
          payment_status: 'paid',
          session_id: 'sess_123',
          original_amount: '500'
        }
      ]);

      const result = await analyzer.analyzePaymentState('123', schedule);

      expect(result.needsDeposit).toBe(false);
      expect(result.needsRest).toBe(true); // Deposit paid and date reached
      expect(result.deposit.paid).toBe(true);
    });

    test('should not need rest if deposit is not paid', async () => {
      const schedule = { 
        schedule: '50/50', 
        secondPaymentDate: new Date('2025-01-01'),
        daysDiff: 60 
      };
      mockRepository.listPayments.mockResolvedValue([
        {
          payment_type: 'deposit',
          payment_status: 'unpaid',
          session_id: 'sess_123'
        }
      ]);

      const result = await analyzer.analyzePaymentState('123', schedule);

      expect(result.deposit.exists).toBe(true);
      expect(result.deposit.paid).toBe(false);
      expect(result.needsRest).toBe(false); // Deposit not paid yet, so rest not needed
    });

    test('should identify needsSingle for 100% schedule when no single payment exists', async () => {
      const schedule = { schedule: '100%', secondPaymentDate: null, daysDiff: 20 };
      mockRepository.listPayments.mockResolvedValue([]);

      const result = await analyzer.analyzePaymentState('123', schedule);

      expect(result.needsDeposit).toBe(false);
      expect(result.needsRest).toBe(false);
      expect(result.needsSingle).toBe(true);
    });

    test('should not need single if single payment exists and is paid', async () => {
      const schedule = { schedule: '100%', secondPaymentDate: null, daysDiff: 20 };
      mockRepository.listPayments.mockResolvedValue([
        {
          payment_type: 'single',
          payment_status: 'paid',
          session_id: 'sess_123'
        }
      ]);

      const result = await analyzer.analyzePaymentState('123', schedule);

      expect(result.needsSingle).toBe(false);
      expect(result.single.paid).toBe(true);
    });

    test('should handle deposit exists but schedule changed to 100%', async () => {
      const schedule = { schedule: '100%', secondPaymentDate: null, daysDiff: 20 };
      mockRepository.listPayments.mockResolvedValue([
        {
          payment_type: 'deposit',
          payment_status: 'paid',
          session_id: 'sess_123',
          original_amount: '500'
        }
      ]);

      const result = await analyzer.analyzePaymentState('123', schedule);

      // For 100% schedule, needsRest is false (only needsSingle)
      // But deposit exists, so needsSingle might be true if single doesn't exist
      expect(result.deposit.exists).toBe(true);
      expect(result.deposit.paid).toBe(true);
      // needsSingle should be true because no single payment exists
      expect(result.needsSingle).toBe(true);
    });
  });

  describe('getDepositPayments', () => {
    test('should return only paid deposit payments', async () => {
      mockRepository.listPayments.mockResolvedValue([
        {
          payment_type: 'deposit',
          payment_status: 'paid',
          session_id: 'sess_123',
          original_amount: '500'
        },
        {
          payment_type: 'deposit',
          payment_status: 'unpaid',
          session_id: 'sess_456'
        },
        {
          payment_type: 'rest',
          payment_status: 'paid',
          session_id: 'sess_789'
        }
      ]);

      const result = await analyzer.getDepositPayments('123');

      expect(result).toHaveLength(1);
      expect(result[0].payment_status).toBe('paid');
      expect(result[0].payment_type).toBe('deposit');
    });
  });

  describe('getRestPayments', () => {
    test('should return only paid rest payments', async () => {
      mockRepository.listPayments.mockResolvedValue([
        {
          payment_type: 'rest',
          payment_status: 'paid',
          session_id: 'sess_123'
        },
        {
          payment_type: 'rest',
          payment_status: 'unpaid',
          session_id: 'sess_456'
        }
      ]);

      const result = await analyzer.getRestPayments('123');

      expect(result).toHaveLength(1);
      expect(result[0].payment_status).toBe('paid');
    });
  });

  describe('isDealFullyPaid', () => {
    test('should return true for 50/50 when both payments are paid', async () => {
      const schedule = { schedule: '50/50' };
      mockRepository.listPayments.mockResolvedValue([
        {
          payment_type: 'deposit',
          payment_status: 'paid'
        },
        {
          payment_type: 'rest',
          payment_status: 'paid'
        }
      ]);

      const result = await analyzer.isDealFullyPaid('123', schedule);

      expect(result).toBe(true);
    });

    test('should return false for 50/50 when only deposit is paid', async () => {
      const schedule = { schedule: '50/50' };
      mockRepository.listPayments.mockResolvedValue([
        {
          payment_type: 'deposit',
          payment_status: 'paid'
        }
      ]);

      const result = await analyzer.isDealFullyPaid('123', schedule);

      expect(result).toBe(false);
    });

    test('should return true for 100% when single payment is paid', async () => {
      const schedule = { schedule: '100%' };
      mockRepository.listPayments.mockResolvedValue([
        {
          payment_type: 'single',
          payment_status: 'paid'
        }
      ]);

      const result = await analyzer.isDealFullyPaid('123', schedule);

      expect(result).toBe(true);
    });
  });
});

