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
 * Ссылка на Stripe Dashboard.
 * Путь /checkout_sessions/ в Stripe не открывает сессию (редирект на логин/ошибка).
 * Используем /payments/{sessionId} — как в фронте (vat-margin); если не откроет сессию,
 * пользователь остаётся на Payments и может искать по metadata:deal_id=N или по Session ID.
 * @param {string} sessionId - ID сессии (cs_live_... или cs_test_...)
 * @returns {string} URL Dashboard (payments + session id)
 */
function getStripeCheckoutSessionUrl(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return '';
  const base = 'https://dashboard.stripe.com';
  const isTest = sessionId.startsWith('cs_test_');
  const prefix = isTest ? 'test/' : '';
  return `${base}/${prefix}payments/${encodeURIComponent(sessionId)}`;
}

module.exports = {
  getBaseUrl,
  getFullUrl,
  getStripeCheckoutSessionUrl
};

