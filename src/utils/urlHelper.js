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

module.exports = {
  getBaseUrl,
  getFullUrl
};

