/**
 * Конфигурация кастомных полей Pipedrive, которые используются
 * для гибридных наличных платежей. Поля хардкожены по просьбе
 * команды, чтобы избежать расхождений с переменными окружения.
 */

const PIPEDRIVE_CASH_FIELDS = {
  cashAmount: {
    id: 62,
    key: '605dd569d6c1ac2de87d9ce8da707ad108206855',
    name: 'Cash amount',
    description: 'Ожидаемая сумма наличными в валюте сделки'
  },
  cashReceivedAmount: {
    id: 63,
    key: 'f970d08a572c5ca8755fca651955e0d0e2000b83',
    name: 'Cash received amount',
    description: 'Фактически полученная сумма наличными'
  },
  cashStatus: {
    id: 64,
    key: 'f81d41512e7e4b334860d24ed17de6d9c0bb686e',
    name: 'Cash status',
    description: 'Статус наличного платежа'
  },
  cashExpectedDate: {
    id: 65,
    key: 'ac8a4f3cf03ef2a6bb39c445d0c5332314754921',
    name: 'Cash expected date',
    description: 'Дата, когда ожидаем внесения наличных'
  }
};

const CASH_STATUS_OPTIONS = {
  PENDING: 77,
  RECEIVED: 78,
  REFUNDED: 79
};

module.exports = {
  PIPEDRIVE_CASH_FIELDS,
  CASH_STATUS_OPTIONS
};
