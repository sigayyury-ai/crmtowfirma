const logger = require('./logger');

/**
 * Маппинг названий стран к ISO кодам
 * Поддерживаются английские и польские названия
 */
const COUNTRY_NAME_TO_CODE = {
  // Английские названия
  'poland': 'PL',
  'germany': 'DE',
  'france': 'FR',
  'united kingdom': 'GB',
  'uk': 'GB',
  'great britain': 'GB',
  'italy': 'IT',
  'spain': 'ES',
  'netherlands': 'NL',
  'belgium': 'BE',
  'austria': 'AT',
  'switzerland': 'CH',
  'czech republic': 'CZ',
  'czechia': 'CZ',
  'slovakia': 'SK',
  'lithuania': 'LT',
  'latvia': 'LV',
  'estonia': 'EE',
  'ukraine': 'UA',
  'belarus': 'BY',
  'russia': 'RU',
  'sweden': 'SE',
  'norway': 'NO',
  'denmark': 'DK',
  'finland': 'FI',
  'united states': 'US',
  'usa': 'US',
  'canada': 'CA',
  'india': 'IN',
  'china': 'CN',
  'japan': 'JP',
  'south korea': 'KR',
  'korea': 'KR',
  'australia': 'AU',
  'israel': 'IL',
  'brazil': 'BR',
  
  // Польские названия
  'polska': 'PL',
  'niemcy': 'DE',
  'francja': 'FR',
  'wielka brytania': 'GB',
  'włochy': 'IT',
  'hiszpania': 'ES',
  'holandia': 'NL',
  'belgia': 'BE',
  'austria': 'AT',
  'szwajcaria': 'CH',
  'czechy': 'CZ',
  'słowacja': 'SK',
  'litwa': 'LT',
  'łotwa': 'LV',
  'estonia': 'EE',
  'ukraina': 'UA',
  'białoruś': 'BY',
  'rosja': 'RU',
  'szwecja': 'SE',
  'norwegia': 'NO',
  'dania': 'DK',
  'finlandia': 'FI',
  'stany zjednoczone': 'US',
  'kanada': 'CA',
  'indie': 'IN',
  'chiny': 'CN',
  'japonia': 'JP',
  'korea południowa': 'KR',
  'australia': 'AU',
  'izrael': 'IL',
  'brazylia': 'BR'
};

/**
 * Маппинг ISO кодов стран к телефонным кодам
 * Основные страны для COMOON клиентов
 */
const COUNTRY_PHONE_CODES = {
  // Европа
  'PL': '+48',  // Польша
  'DE': '+49',  // Германия
  'FR': '+33',  // Франция
  'GB': '+44',  // Великобритания
  'IT': '+39',  // Италия
  'ES': '+34',  // Испания
  'NL': '+31',  // Нидерланды
  'BE': '+32',  // Бельгия
  'AT': '+43',  // Австрия
  'CH': '+41',  // Швейцария
  'CZ': '+420', // Чехия
  'SK': '+421', // Словакия
  'LT': '+370', // Литва
  'LV': '+371', // Латвия
  'EE': '+372', // Эстония
  'UA': '+380', // Украина
  'BY': '+375', // Беларусь
  'RU': '+7',   // Россия
  'SE': '+46',  // Швеция
  'NO': '+47',  // Норвегия
  'DK': '+45',  // Дания
  'FI': '+358', // Финляндия
  
  // Северная Америка
  'US': '+1',   // США
  'CA': '+1',   // Канада
  
  // Азия
  'IN': '+91',  // Индия
  'CN': '+86',  // Китай
  'JP': '+81',  // Япония
  'KR': '+82',  // Южная Корея
  
  // Другие
  'AU': '+61',  // Австралия
  'IL': '+972', // Израиль
  'BR': '+55',  // Бразилия
};

/**
 * Извлечь код страны из номера телефона
 * @param {string} phoneNumber - Номер телефона
 * @returns {string|null} - ISO код страны или null
 */
function extractCountryFromPhone(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return null;
  }
  
  // Убираем все нецифровые символы кроме +
  const cleaned = phoneNumber.replace(/[^\d+]/g, '');
  
  if (!cleaned.startsWith('+')) {
    return null;
  }
  
  // Проверяем известные коды стран (от самых длинных к самым коротким)
  const sortedCodes = Object.entries(COUNTRY_PHONE_CODES)
    .sort((a, b) => b[1].length - a[1].length);
  
  for (const [countryCode, phoneCode] of sortedCodes) {
    if (cleaned.startsWith(phoneCode)) {
      return countryCode;
    }
  }
  
  return null;
}

/**
 * Нормализовать номер телефона в формат E.164
 * @param {string} phoneNumber - Номер телефона в любом формате
 * @param {string} countryCode - ISO код страны (опционально, для автоматического добавления кода)
 * @returns {string|null} - Нормализованный номер в формате E.164 или null
 */
function normalizePhoneNumber(phoneNumber, countryCode = null) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return null;
  }
  
  // Убираем все пробелы, дефисы, скобки и другие символы
  let cleaned = phoneNumber.replace(/[\s\-\(\)\.]/g, '');
  
  // Если номер уже в формате E.164 (начинается с +)
  if (cleaned.startsWith('+')) {
    // Проверяем что после + только цифры
    const digits = cleaned.substring(1);
    if (/^\d{7,15}$/.test(digits)) {
      return cleaned;
    }
    // Если формат неправильный, пытаемся исправить
    const fixed = '+' + digits.replace(/\D/g, '');
    if (/^\+\d{7,15}$/.test(fixed)) {
      logger.warn('Phone number format corrected', {
        original: phoneNumber,
        fixed: fixed
      });
      return fixed;
    }
  }
  
  // Если номер без +, но начинается с цифр
  if (/^\d/.test(cleaned)) {
    // Убираем все нецифровые символы
    const digits = cleaned.replace(/\D/g, '');
    
    // Если номер слишком короткий или длинный, вероятно неправильный формат
    if (digits.length < 7 || digits.length > 15) {
      logger.warn('Phone number length invalid', {
        phoneNumber: phoneNumber,
        digitsLength: digits.length
      });
      return null;
    }
    
    // Если есть код страны, добавляем его
    if (countryCode && COUNTRY_PHONE_CODES[countryCode]) {
      const countryPhoneCode = COUNTRY_PHONE_CODES[countryCode];
      // Убираем код страны из номера если он уже есть
      const phoneCodeDigits = countryPhoneCode.substring(1); // убираем +
      if (digits.startsWith(phoneCodeDigits)) {
        // Код страны уже есть, просто добавляем +
        return '+' + digits;
      } else {
        // Добавляем код страны
        return countryPhoneCode + digits;
      }
    }
    
    // Пытаемся определить страну по коду
    const detectedCountry = extractCountryFromPhone('+' + digits);
    if (detectedCountry) {
      return '+' + digits;
    }
    
    // Если не удалось определить, но номер валидный, добавляем +
    // Это рискованно, но лучше чем ничего
    logger.warn('Phone number country code unknown, adding +', {
      phoneNumber: phoneNumber,
      normalized: '+' + digits
    });
    return '+' + digits;
  }
  
  // Если формат непонятный, возвращаем null
  logger.warn('Phone number format unrecognized', {
    phoneNumber: phoneNumber
  });
  return null;
}

/**
 * Валидировать номер телефона в формате E.164
 * @param {string} phoneNumber - Номер телефона
 * @returns {boolean} - true если номер валидный
 */
function isValidE164(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return false;
  }
  
  // E.164 формат: +[код страны][номер]
  // Длина: от 7 до 15 цифр после +
  const e164Regex = /^\+[1-9]\d{6,14}$/;
  return e164Regex.test(phoneNumber);
}

/**
 * Нормализовать название страны в ISO код
 * @param {string} countryName - Название страны (любой формат)
 * @returns {string|null} - ISO код страны или null
 */
function normalizeCountryNameToCode(countryName) {
  if (!countryName || typeof countryName !== 'string') {
    return null;
  }
  
  const trimmed = countryName.trim();
  
  // Если уже ISO код (2 символа, любой регистр)
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  
  const normalized = trimmed.toLowerCase();
  
  // Ищем в маппинге названий
  if (COUNTRY_NAME_TO_CODE[normalized]) {
    return COUNTRY_NAME_TO_CODE[normalized];
  }
  
  // Пробуем найти частичное совпадение (для составных названий)
  for (const [name, code] of Object.entries(COUNTRY_NAME_TO_CODE)) {
    if (normalized.includes(name) || name.includes(normalized)) {
      return code;
    }
  }
  
  return null;
}

/**
 * Получить код страны из Pipedrive person
 * Приоритет: 1) person.country, 2) person.address.country_code, 3) person.address.country
 * Названия стран нормализуются в ISO коды
 * @param {Object} person - Pipedrive person object
 * @returns {string|null} - ISO код страны или null
 */
function getCountryFromPerson(person) {
  if (!person) {
    return null;
  }
  
  // Приоритет 1: Поле Country (первичное)
  if (person.country) {
    const country = typeof person.country === 'string' 
      ? person.country.trim() 
      : String(person.country).trim();
    
    if (country) {
      // Нормализуем название в код если нужно
      const countryCode = normalizeCountryNameToCode(country) || country.toUpperCase();
      logger.debug('Country found in person.country', {
        original: country,
        normalized: countryCode,
        personId: person.id
      });
      return countryCode;
    }
  }
  
  // Приоритет 2: person.address.country_code (если нет первичного поля)
  if (person.address?.country_code) {
    const countryCode = typeof person.address.country_code === 'string'
      ? person.address.country_code.trim()
      : String(person.address.country_code).trim();
    
    if (countryCode) {
      // Нормализуем если нужно
      const normalized = normalizeCountryNameToCode(countryCode) || countryCode.toUpperCase();
      logger.debug('Country found in person.address.country_code', {
        original: countryCode,
        normalized: normalized,
        personId: person.id
      });
      return normalized;
    }
  }
  
  // Приоритет 3: person.address.country (если нет первых двух)
  if (person.address?.country) {
    const country = typeof person.address.country === 'string'
      ? person.address.country.trim()
      : String(person.address.country).trim();
    
    if (country) {
      // Нормализуем название в код
      const countryCode = normalizeCountryNameToCode(country);
      if (countryCode) {
        logger.debug('Country found in person.address.country', {
          original: country,
          normalized: countryCode,
          personId: person.id
        });
        return countryCode;
      } else {
        logger.warn('Country name not recognized, using as-is', {
          country: country,
          personId: person.id
        });
        return country.toUpperCase();
      }
    }
  }
  
  logger.debug('No country found in person', {
    personId: person.id,
    hasCountry: !!person.country,
    hasAddress: !!person.address,
    hasAddressCountry: !!person.address?.country,
    hasAddressCountryCode: !!person.address?.country_code
  });
  
  return null;
}

/**
 * Нормализовать и валидировать номер телефона с учетом страны из Pipedrive
 * @param {string} phoneNumber - Номер телефона
 * @param {Object} person - Pipedrive person object (опционально, для определения страны)
 * @returns {string|null} - Нормализованный номер в формате E.164 или null
 */
function normalizePhoneNumberWithCountry(phoneNumber, person = null) {
  if (!phoneNumber) {
    return null;
  }
  
  // Пытаемся получить код страны из person
  let countryCode = null;
  if (person) {
    countryCode = getCountryFromPerson(person);
  }
  
  // Нормализуем номер
  const normalized = normalizePhoneNumber(phoneNumber, countryCode);
  
  if (!normalized) {
    return null;
  }
  
  // Проверяем валидность
  if (!isValidE164(normalized)) {
    logger.warn('Normalized phone number is not valid E.164', {
      original: phoneNumber,
      normalized: normalized,
      countryCode: countryCode
    });
    return null;
  }
  
  return normalized;
}

module.exports = {
  normalizePhoneNumber,
  normalizePhoneNumberWithCountry,
  isValidE164,
  extractCountryFromPhone,
  getCountryFromPerson,
  normalizeCountryNameToCode,
  COUNTRY_PHONE_CODES,
  COUNTRY_NAME_TO_CODE
};

