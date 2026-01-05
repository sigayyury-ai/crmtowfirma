// Mock logger and dependencies before requiring the service
jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../../src/services/cash/cashFieldParser', () => ({
  extractCashFields: jest.fn(() => null)
}));

const DealAmountCalculator = require('../../../src/services/stripe/dealAmountCalculator');

describe('DealAmountCalculator', () => {
  describe('getDealAmount', () => {
    test('should use product.sum when available', () => {
      const deal = { id: '123', value: '1000' };
      const products = [
        {
          sum: '500',
          item_price: '600',
          quantity: 1
        }
      ];
      
      const amount = DealAmountCalculator.getDealAmount(deal, products);
      
      expect(amount).toBe(500);
    });

    test('should use item_price * quantity when sum is not available', () => {
      const deal = { id: '123', value: '1000' };
      const products = [
        {
          item_price: '300',
          quantity: 2
        }
      ];
      
      const amount = DealAmountCalculator.getDealAmount(deal, products);
      
      expect(amount).toBe(600);
    });

    test('should use deal.value when products are not available', () => {
      const deal = { id: '123', value: '1000' };
      const products = [];
      
      const amount = DealAmountCalculator.getDealAmount(deal, products);
      
      expect(amount).toBe(1000);
    });

    test('should apply product discount (percent)', () => {
      const deal = { id: '123' };
      const products = [
        {
          item_price: '1000',
          quantity: 1,
          discount: 10,
          discount_type: 'percent'
        }
      ];
      
      const amount = DealAmountCalculator.getDealAmount(deal, products, { includeDiscounts: true });
      
      expect(amount).toBe(900); // 1000 * 0.9
    });

    test('should apply product discount (amount)', () => {
      const deal = { id: '123' };
      const products = [
        {
          item_price: '1000',
          quantity: 1,
          discount: 100,
          discount_type: 'amount'
        }
      ];
      
      const amount = DealAmountCalculator.getDealAmount(deal, products, { includeDiscounts: true });
      
      expect(amount).toBe(900); // 1000 - 100
    });

    test('should throw error when no valid price found', () => {
      const deal = { id: '123' };
      const products = [
        {
          item_price: null,
          quantity: 1
        }
      ];
      
      expect(() => {
        DealAmountCalculator.getDealAmount(deal, products);
      }).toThrow('Cannot determine deal amount');
    });
  });

  describe('calculateRemainderAfterDeposit', () => {
    test('should calculate remainder correctly', () => {
      const deal = { id: '123', value: '1000' };
      const products = [{ sum: '1000', item_price: '1000', quantity: 1 }];
      const payments = [
        {
          payment_type: 'deposit',
          payment_status: 'paid',
          original_amount: '500',
          currency: 'PLN'
        }
      ];
      
      const remainder = DealAmountCalculator.calculateRemainderAfterDeposit(
        '123',
        deal,
        products,
        payments,
        'PLN'
      );
      
      expect(remainder).toBe(500);
    });

    test('should return 0 when remainder is negative', () => {
      const deal = { id: '123', value: '1000' };
      const products = [{ sum: '1000', item_price: '1000', quantity: 1 }];
      const payments = [
        {
          payment_type: 'deposit',
          payment_status: 'paid',
          original_amount: '1500', // More than deal amount
          currency: 'PLN'
        }
      ];
      
      const remainder = DealAmountCalculator.calculateRemainderAfterDeposit(
        '123',
        deal,
        products,
        payments,
        'PLN'
      );
      
      expect(remainder).toBe(0);
    });

    test('should return full amount when no deposit payments', () => {
      const deal = { id: '123', value: '1000' };
      const products = [{ sum: '1000', item_price: '1000', quantity: 1 }];
      const payments = [];
      
      const remainder = DealAmountCalculator.calculateRemainderAfterDeposit(
        '123',
        deal,
        products,
        payments,
        'PLN'
      );
      
      expect(remainder).toBe(1000);
    });
  });

  describe('calculatePaymentAmount', () => {
    test('should use customAmount when provided', () => {
      const deal = { id: '123', value: '1000' };
      const products = [{ sum: '1000', item_price: '1000', quantity: 1 }];
      
      const amount = DealAmountCalculator.calculatePaymentAmount(
        deal,
        products,
        '50/50',
        'rest',
        300
      );
      
      expect(amount).toBe(300);
    });

    test('should split amount for 50/50 schedule', () => {
      const deal = { id: '123', value: '1000' };
      const products = [{ sum: '1000', item_price: '1000', quantity: 1 }];
      
      const amount = DealAmountCalculator.calculatePaymentAmount(
        deal,
        products,
        '50/50',
        'deposit'
      );
      
      expect(amount).toBe(500);
    });

    test('should return full amount for 100% schedule', () => {
      const deal = { id: '123', value: '1000' };
      const products = [{ sum: '1000', item_price: '1000', quantity: 1 }];
      
      const amount = DealAmountCalculator.calculatePaymentAmount(
        deal,
        products,
        '100%',
        'single'
      );
      
      expect(amount).toBe(1000);
    });
  });
});

