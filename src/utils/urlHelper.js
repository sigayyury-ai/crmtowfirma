/**
 * URL Helper для правильного определения базового URL в разных окружениях
 * 
 * Используется для формирования абсолютных URL в production и development
 */

/**
 * Получить базовый URL приложения
 * @param {Object} req - Express request object (опционально)
 * @returns {string} Базовый URL
 */
function getBaseUrl(req = null) {
  // Приоритет 1: Переменная окружения BASE_URL
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  
  // Приоритет 2: В production используем кастомный домен
  if (process.env.NODE_ENV === 'production') {
    return 'https://invoices.comoon.io';
  }
  
  // Приоритет 3: Если есть request, используем его для определения URL
  if (req) {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || `localhost:${process.env.PORT || 3000}`;
    return `${protocol}://${host}`;
  }
  
  // Приоритет 4: Fallback для development
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}

/**
 * Получить полный URL для пути
 * @param {string} path - Путь (например, '/api/webhooks/stripe')
 * @param {Object} req - Express request object (опционально)
 * @returns {string} Полный URL
 */
function getFullUrl(path, req = null) {
  const baseUrl = getBaseUrl(req);
  // Убеждаемся, что path начинается с /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

/**
 * Ссылка на раздел Payments в Stripe Dashboard.
 * Прямые ссылки вида /payments/{sessionId} в дашборде Stripe не открывают сессию и не находят её.
 * Поэтому возвращаем только URL списка Payments; Session ID нужно искать в поиске дашборда
 * (по Session ID или metadata:deal_id=N).
 * @param {string} sessionId - ID сессии (cs_live_... или cs_test_...) — используется только для test/live
 * @returns {string} URL раздела Payments (без session id в пути)
 */
function getStripeCheckoutSessionUrl(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return '';
  const base = 'https://dashboard.stripe.com';
  const isTest = sessionId.startsWith('cs_test_');
  const prefix = isTest ? 'test/' : '';
  return `${base}/${prefix}payments`;
}

/**
 * URL раздела Payments в Stripe Dashboard (live или test).
 * @param {boolean} [testMode] - true для test-режима
 * @returns {string}
 */
function getStripePaymentsDashboardUrl(testMode = false) {
  const base = 'https://dashboard.stripe.com';
  return testMode ? `${base}/test/payments` : `${base}/payments`;
}

module.exports = {
  getBaseUrl,
  getFullUrl,
  getStripeCheckoutSessionUrl,
  getStripePaymentsDashboardUrl
};

