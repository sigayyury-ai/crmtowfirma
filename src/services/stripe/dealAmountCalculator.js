const logger = require('../../utils/logger');
const { roundBankers } = require('../../utils/currency');
const { extractCashFields } = require('../cash/cashFieldParser');

/**
 * DealAmountCalculator
 * 
 * Унифицированный сервис для расчета суммы сделки из продуктов.
 * Заменяет разрозненную логику получения суммы в разных местах кода.
 * 
 * Приоритет расчета:
 * 1. product.sum (уже включает скидки)
 * 2. product.item_price * quantity
 * 3. deal.value
 * 
 * Также учитывает:
 * - Скидки на продукт (product.discount)
 * - Скидки на сделку (deal-level discount)
 * - Наличные платежи (cash deduction)
 * 
 * @see docs/stripe-payment-logic-code-review.md - раздел "Проблемы с определением суммы из продуктов"
 */
class DealAmountCalculator {
  /**
   * Получить актуальную сумму сделки из продуктов
   * 
   * @param {Object} deal - Объект сделки из Pipedrive
   * @param {Array} products - Массив продуктов сделки (из Pipedrive API)
   * @param {Object} options - Дополнительные опции
   * @param {boolean} options.includeCashDeduction - Учитывать наличные платежи (default: true)
   * @param {boolean} options.includeDiscounts - Учитывать скидки (default: true)
   * @returns {number} - Сумма сделки в валюте сделки
   */
  static getDealAmount(deal, products = [], options = {}) {
    const {
      includeCashDeduction = true,
      includeDiscounts = true
    } = options;

    let amount = 0;

    // Приоритет 1: product.sum (уже включает скидки)
    if (products && products.length > 0) {
      const firstProduct = products[0];
      const sumPrice = parseFloat(firstProduct.sum);
      
      if (sumPrice > 0 && !isNaN(sumPrice)) {
        amount = sumPrice;
        logger.debug('Using product.sum for deal amount', {
          dealId: deal?.id,
          sumPrice,
          productId: firstProduct.product_id
        });
        return this._applyCashDeduction(amount, deal, includeCashDeduction);
      }

      // Приоритет 2: item_price * quantity
      const itemPrice = parseFloat(firstProduct.item_price);
      const quantity = parseFloat(firstProduct.quantity) || 1;
      
      if (itemPrice > 0 && !isNaN(itemPrice)) {
        amount = itemPrice * quantity;
        
        // Учитываем скидку на продукт, если есть
        if (includeDiscounts && firstProduct.discount !== null && firstProduct.discount !== undefined) {
          const discountValue = typeof firstProduct.discount === 'number' 
            ? firstProduct.discount 
            : parseFloat(firstProduct.discount);
          
          if (!isNaN(discountValue) && discountValue > 0) {
            const discountType = firstProduct.discount_type === 'percent' ? 'percent' : 'amount';
            
            if (discountType === 'percent') {
              amount = amount * (1 - discountValue / 100);
            } else {
              amount = Math.max(0, amount - discountValue);
            }
            
            logger.debug('Applied product discount', {
              dealId: deal?.id,
              discountValue,
              discountType,
              amountAfterDiscount: amount
            });
          }
        }
        
        logger.debug('Using item_price * quantity for deal amount', {
          dealId: deal?.id,
          itemPrice,
          quantity,
          calculatedAmount: amount
        });
        
        return this._applyCashDeduction(amount, deal, includeCashDeduction);
      }
    }

    // Приоритет 3: deal.value
    const dealValue = parseFloat(deal?.value);
    if (dealValue > 0 && !isNaN(dealValue)) {
      amount = dealValue;
      logger.debug('Using deal.value for deal amount', {
        dealId: deal?.id,
        dealValue
      });
      return this._applyCashDeduction(amount, deal, includeCashDeduction);
    }

    // Если ничего не найдено
    logger.warn('Cannot determine deal amount from products or deal.value', {
      dealId: deal?.id,
      hasProducts: products && products.length > 0,
      dealValue: deal?.value,
      products: products?.map(p => ({
        sum: p.sum,
        item_price: p.item_price,
        quantity: p.quantity
      }))
    });

    throw new Error('Cannot determine deal amount: no valid price found in products or deal.value');
  }

  /**
   * Применить вычет наличных платежей к сумме
   * 
   * @private
   */
  static _applyCashDeduction(amount, deal, includeCashDeduction) {
    if (!includeCashDeduction || !deal) {
      return roundBankers(amount);
    }

    try {
      const cashFields = extractCashFields(deal);
      if (cashFields && Number.isFinite(cashFields.amount) && cashFields.amount > 0) {
        const cashDeduction = roundBankers(cashFields.amount);
        const netAmount = Math.max(amount - cashDeduction, 0);
        
        if (netAmount !== amount) {
          logger.debug('Applied cash deduction to deal amount', {
            dealId: deal.id,
            originalAmount: amount,
            cashDeduction,
            netAmount
          });
        }
        
        return roundBankers(netAmount);
      }
    } catch (error) {
      logger.warn('Failed to apply cash deduction', {
        dealId: deal?.id,
        error: error.message
      });
    }

    return roundBankers(amount);
  }

  /**
   * Рассчитать сумму остатка после deposit платежей
   * 
   * Используется при изменении графика с 50/50 на 100% или для расчета rest платежа.
   * 
   * @param {string} dealId - ID сделки
   * @param {Object} deal - Объект сделки
   * @param {Array} products - Массив продуктов сделки
   * @param {Array} payments - Массив существующих платежей
   * @param {string} currency - Валюта сделки (для конвертации)
   * @returns {number} - Сумма остатка к оплате
   */
  static calculateRemainderAfterDeposit(dealId, deal, products, payments = [], currency = 'PLN') {
    // 1. Получить актуальную сумму сделки
    const actualAmount = this.getDealAmount(deal, products, {
      includeCashDeduction: true,
      includeDiscounts: true
    });

    // 2. Получить все оплаченные deposit платежи
    const depositPayments = payments.filter(p => 
      (p.payment_type === 'deposit' || p.payment_type === 'first') &&
      p.payment_status === 'paid'
    );

    // 3. Суммировать оплаченные deposit платежи в валюте сделки
    const depositTotal = depositPayments.reduce((sum, p) => {
      const paymentCurrency = p.currency || currency;
      const paymentAmount = parseFloat(p.original_amount || p.amount_pln || p.amount || 0);
      
      if (paymentCurrency === currency) {
        return sum + paymentAmount;
      } else {
        // TODO: Конвертировать в валюту сделки (если нужна конвертация)
        logger.warn('Currency mismatch in remainder calculation', {
          dealId,
          paymentCurrency,
          dealCurrency: currency,
          paymentAmount
        });
        return sum + paymentAmount; // Пока без конвертации
      }
    }, 0);

    // 4. Рассчитать остаток
    const remainder = Math.max(0, actualAmount - depositTotal);

    // 5. Валидация
    if (remainder < 0) {
      logger.warn('Negative remainder calculated', {
        dealId,
        actualAmount,
        depositTotal,
        remainder
      });
      return 0; // Возвращаем 0 вместо отрицательного значения
    }

    logger.debug('Calculated remainder after deposit', {
      dealId,
      actualAmount,
      depositTotal,
      remainder,
      depositPaymentsCount: depositPayments.length
    });

    return roundBankers(remainder);
  }

  /**
   * Рассчитать сумму для конкретного типа платежа
   * 
   * @param {Object} deal - Объект сделки
   * @param {Array} products - Массив продуктов
   * @param {string} paymentSchedule - График платежей ('50/50' или '100%')
   * @param {string} paymentType - Тип платежа ('deposit', 'rest', 'single')
   * @param {number} customAmount - Кастомная сумма (для rest платежа после deposit)
   * @returns {number} - Сумма для платежа
   */
  static calculatePaymentAmount(deal, products, paymentSchedule, paymentType, customAmount = null) {
    // Если указана кастомная сумма, используем её
    if (customAmount !== null && customAmount > 0) {
      logger.debug('Using custom amount for payment', {
        dealId: deal?.id,
        paymentType,
        customAmount
      });
      return roundBankers(customAmount);
    }

    // Получаем базовую сумму сделки
    const baseAmount = this.getDealAmount(deal, products, {
      includeCashDeduction: true,
      includeDiscounts: true
    });

    // Для графика 50/50 делим пополам
    if (paymentSchedule === '50/50') {
      const splitAmount = baseAmount / 2;
      logger.debug('Split amount for 50/50 schedule', {
        dealId: deal?.id,
        paymentType,
        baseAmount,
        splitAmount
      });
      return roundBankers(splitAmount);
    }

    // Для графика 100% возвращаем полную сумму
    return roundBankers(baseAmount);
  }
}

module.exports = DealAmountCalculator;

