// Mock dependencies before requiring the service
jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../../src/services/stripe/repository', () => {
  return jest.fn().mockImplementation(() => ({
    findProductLinkByCrmId: jest.fn(),
    upsertProductLink: jest.fn(),
    createPayment: jest.fn()
  }));
});

jest.mock('../../../src/services/pipedrive', () => {
  return jest.fn().mockImplementation(() => ({
    getDealWithRelatedData: jest.fn(),
    getDealProducts: jest.fn()
  }));
});

jest.mock('../../../src/services/stripe/client', () => ({
  getStripeClient: jest.fn(() => ({
    products: {
      retrieve: jest.fn(),
      list: jest.fn(),
      create: jest.fn()
    },
    checkout: {
      sessions: {
        create: jest.fn()
      }
    }
  }))
}));

jest.mock('../../../src/services/stripe/paymentScheduleService', () => ({
  determineScheduleFromDeal: jest.fn(),
  determineSchedule: jest.fn()
}));

jest.mock('../../../src/services/stripe/dealAmountCalculator', () => ({
  calculatePaymentAmount: jest.fn()
}));

jest.mock('../../../src/utils/currency', () => ({
  normaliseCurrency: jest.fn((currency) => currency || 'PLN'),
  toMinorUnit: jest.fn((amount, currency) => Math.round(amount * 100)),
  roundBankers: jest.fn((amount) => Math.round(amount * 100) / 100)
}));

const PaymentSessionCreator = require('../../../src/services/stripe/paymentSessionCreator');
const PaymentScheduleService = require('../../../src/services/stripe/paymentScheduleService');
const DealAmountCalculator = require('../../../src/services/stripe/dealAmountCalculator');

describe('PaymentSessionCreator', () => {
  let creator;
  let mockRepository;
  let mockPipedrive;
  let mockStripe;

  beforeEach(() => {
    mockRepository = {
      findProductLinkByCrmId: jest.fn(),
      upsertProductLink: jest.fn(),
      createPayment: jest.fn()
    };
    mockPipedrive = {
      getDealWithRelatedData: jest.fn(),
      getDealProducts: jest.fn()
    };
    mockStripe = {
      products: {
        retrieve: jest.fn(),
        list: jest.fn(),
        create: jest.fn()
      },
      checkout: {
        sessions: {
          create: jest.fn()
        }
      }
    };

    creator = new PaymentSessionCreator({
      repository: mockRepository,
      pipedriveClient: mockPipedrive,
      stripe: mockStripe
    });
  });

  describe('createSession', () => {
    const mockDeal = {
      id: '123',
      title: 'Test Deal',
      currency: 'PLN',
      value: '1000'
    };

    const mockFullDeal = {
      id: '123',
      title: 'Test Deal',
      currency: 'PLN',
      value: '1000',
      expected_close_date: '2025-03-15'
    };

    const mockPerson = {
      email: [{ value: 'test@example.com' }],
      name: 'Test Person'
    };

    const mockProducts = [
      {
        product_id: '456',
        name: 'Test Product',
        sum: '1000',
        item_price: '1000',
        quantity: 1
      }
    ];

    beforeEach(() => {
      PaymentScheduleService.determineScheduleFromDeal.mockReturnValue({
        schedule: '50/50',
        secondPaymentDate: new Date('2025-02-15'),
        daysDiff: 60
      });
      PaymentScheduleService.determineSchedule.mockReturnValue({
        schedule: '50/50',
        secondPaymentDate: new Date('2025-02-15'),
        daysDiff: 60
      });
      DealAmountCalculator.calculatePaymentAmount.mockReturnValue(500);
      mockPipedrive.getDealWithRelatedData.mockResolvedValue({
        success: true,
        deal: mockFullDeal,
        person: mockPerson,
        organization: null
      });
      mockPipedrive.getDealProducts.mockResolvedValue({
        success: true,
        products: mockProducts
      });
      mockRepository.findProductLinkByCrmId.mockResolvedValue(null);
      mockStripe.products.list.mockResolvedValue({ data: [] });
      mockStripe.products.create.mockResolvedValue({ id: 'prod_test123' });
      mockStripe.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test123',
        url: 'https://checkout.stripe.com/test',
        payment_status: 'unpaid'
      });
      mockRepository.createPayment.mockResolvedValue({ id: 'pay_123' });
    });

    test('should create session successfully for deposit payment', async () => {
      const result = await creator.createSession(mockDeal, {
        paymentType: 'deposit',
        paymentSchedule: '50/50',
        trigger: 'test'
      });

      if (!result.success) {
        console.log('Test failed with error:', result.error);
        console.log('Details:', result.details);
      }

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('cs_test123');
      expect(result.sessionUrl).toBe('https://checkout.stripe.com/test');
      expect(result.paymentType).toBe('deposit');
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalled();
      expect(mockRepository.createPayment).toHaveBeenCalled();
    });

    test('should use PaymentScheduleService to determine schedule', async () => {
      await creator.createSession(mockDeal, {
        paymentType: 'deposit',
        trigger: 'test'
      });

      expect(PaymentScheduleService.determineScheduleFromDeal).toHaveBeenCalled();
    });

    test('should use DealAmountCalculator to calculate amount', async () => {
      await creator.createSession(mockDeal, {
        paymentType: 'deposit',
        paymentSchedule: '50/50',
        trigger: 'test'
      });

      expect(DealAmountCalculator.calculatePaymentAmount).toHaveBeenCalledWith(
        mockFullDeal,
        mockProducts,
        '50/50',
        'deposit'
      );
    });

    test('should use customAmount when provided', async () => {
      // Reset mock to track calls
      DealAmountCalculator.calculatePaymentAmount.mockClear();
      
      const result = await creator.createSession(mockDeal, {
        paymentType: 'rest',
        paymentSchedule: '50/50',
        customAmount: 300,
        trigger: 'test'
      });

      // Should succeed
      expect(result.success).toBe(true);
      // customAmount should be used directly
      expect(result.amount).toBe(300);
      // Check that the session was created with correct amount
      const sessionCall = mockStripe.checkout.sessions.create.mock.calls[0][0];
      // Amount should be 300 PLN = 30000 groszy (minor units)
      expect(sessionCall.line_items[0].price_data.unit_amount).toBe(30000);
    });

    test('should return error when deal fetch fails', async () => {
      mockPipedrive.getDealWithRelatedData.mockResolvedValue({
        success: false,
        error: 'Deal not found'
      });

      const result = await creator.createSession(mockDeal, {
        paymentType: 'deposit',
        trigger: 'test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to fetch deal');
    });

    test('should return error when no products found', async () => {
      mockPipedrive.getDealProducts.mockResolvedValue({
        success: false,
        products: []
      });

      const result = await creator.createSession(mockDeal, {
        paymentType: 'deposit',
        trigger: 'test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No products found');
    });

    test('should return error when no customer email', async () => {
      mockPipedrive.getDealWithRelatedData.mockResolvedValue({
        success: true,
        deal: mockFullDeal,
        person: { email: null },
        organization: null
      });

      const result = await creator.createSession(mockDeal, {
        paymentType: 'deposit',
        trigger: 'test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No email found');
    });

    test('should create new Stripe product when not found', async () => {
      mockRepository.findProductLinkByCrmId.mockResolvedValue(null);
      mockStripe.products.list.mockResolvedValue({ data: [] });

      await creator.createSession(mockDeal, {
        paymentType: 'deposit',
        trigger: 'test'
      });

      expect(mockStripe.products.create).toHaveBeenCalled();
      expect(mockRepository.upsertProductLink).toHaveBeenCalled();
    });

    test('should use existing Stripe product when found', async () => {
      mockRepository.findProductLinkByCrmId.mockResolvedValue({
        stripe_product_id: 'prod_existing'
      });
      mockStripe.products.retrieve.mockResolvedValue({ id: 'prod_existing' });

      await creator.createSession(mockDeal, {
        paymentType: 'deposit',
        trigger: 'test'
      });

      expect(mockStripe.products.create).not.toHaveBeenCalled();
      const sessionCall = mockStripe.checkout.sessions.create.mock.calls[0][0];
      expect(sessionCall.line_items[0].price_data.product).toBe('prod_existing');
    });

    test('should handle errors gracefully', async () => {
      mockStripe.checkout.sessions.create.mockRejectedValue(new Error('Stripe API error'));

      const result = await creator.createSession(mockDeal, {
        paymentType: 'deposit',
        trigger: 'test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Stripe API error');
    });
  });
});

