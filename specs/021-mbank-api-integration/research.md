# Research: mBank API Integration

## Цель исследования

Исследовать возможности API польского банка mBank для:
1. Выставления онлайн платежей (инвойсов)
2. Получения информации об операциях по картам и истории платежей

## Обзор доступных API

mBank предоставляет два основных типа API:

### 1. Paynow API (для онлайн платежей)

**Описание:** Paynow - это платежный шлюз mBank Group, который позволяет принимать платежи через онлайн переводы, кредитные карты или BLIK.

**Документация:** https://docs.paynow.pl/

**Основные возможности:**
- Создание платежей (инвойсов)
- Обработка платежей через различные методы (онлайн перевод, карта, BLIK)
- Получение статусов платежей
- Обработка возвратов (refunds)
- Массовые платежи для корпоративных клиентов

**Окружения:**
- **Sandbox:** `https://api.sandbox.paynow.pl` (для тестирования)
- **Production:** `https://api.paynow.pl` (требует активации сервиса)

**Аутентификация:**
- **Api-Key:** Уникальный идентификатор аккаунта
- **Signature-Key:** Используется для подписи запросов
- Все POST запросы (и GET в v3 API) требуют заголовок **Signature** для обеспечения целостности сообщения

**Тестовые credentials (Sandbox):**
- Api-Key: `97a55694-5478-43b5-b406-fb49ebfdd2b5`
- Signature-Key: `b305b996-bca5-4404-a0b7-2ccea3d2b64b`

**Статусы платежей:**
- `NEW` - новый платеж
- `PENDING` - ожидает обработки
- `CONFIRMED` - подтвержден
- `REJECTED` - отклонен
- `ERROR` - ошибка
- `EXPIRED` - истек
- `ABANDONED` - отменен

**Структура запроса на создание платежа:**
```json
{
  "amount": 10000,  // в грошах для PLN
  "externalId": "unique-external-id",
  "description": "Payment description",
  "buyer": {
    "email": "buyer@example.com"
  }
}
```

**Ресурсы:**
- Полная документация: https://docs.paynow.pl/
- Postman workspace с примерами API
- Поддержка: support@paynow.pl

**Интеграция:**
1. Создать Sandbox аккаунт
2. Найти API credentials в Settings > Shops and Poses > Authentication
3. Интегрировать с API напрямую или использовать SDK/плагины для популярных платформ
4. Настроить адрес уведомлений
5. Протестировать платежи (положительные и отрицательные сценарии)
6. Обработать возвраты

---

### 2. PSD2 API (для истории транзакций и операций)

**Описание:** mBank предоставляет PSD2-совместимые API для банковских интеграций через developer portal.

**Developer Portal:** https://developer.api.mbank.pl/

**Доступные сервисы:**

#### AISP (Account Information Service Provider)
- **Назначение:** Получение информации о счетах и истории транзакций
- **Возможности:**
  - Получение списка счетов
  - Получение деталей конкретного счета
  - Получение балансов
  - Получение истории транзакций

#### PISP (Payment Initiation Service Provider)
- **Назначение:** Инициация платежей
- **Возможности:**
  - Создание платежей
  - Получение URI авторизации
  - Получение статуса платежа
  - Поддержка внутренних, налоговых, EEA и non-EEA платежей

#### PIISP (Confirmation of Funds Service)
- **Назначение:** Подтверждение наличия средств

**Sandbox окружение:**
- **mBank Corporate:** `https://sandbox.api.mbank.pl/bank-simulator-pl-corpo/`
- **mBank Retail:** `https://sandbox.api.mbank.pl/bank-simulator-pl-retail/`

**Требования для доступа:**
- Статус TPP (Third Party Provider) или pending статус
- JWS сертификат (QSealC) с приватным ключом (для создания JWS-Signature заголовков)
- TLS сертификат (QWAC) с приватным ключом
- Client-ID в формате UUID
- TPP-Request-ID (уникальный, UUID v1 формат, не старше 5 минут)
- Consent-ID (уникальный для каждого запроса)

**Типичные эндпоинты AISP:**
- `GET /accounts` - получение списка счетов
- `GET /accounts/{AccountId}` - детали конкретного счета
- `GET /accounts/{AccountId}/balances` - балансы счета
- `GET /accounts/{AccountId}/transactions` - история транзакций

**Ресурсы:**
- Postman коллекция на GitHub: https://github.com/melements/mBank-PSD2-api-postman-collection
- OpenAPI/Swagger спецификации
- Бесплатный developer аккаунт
- Техническая поддержка для вопросов по интеграции

**PSD2 стандарт:**
PSD2 (Payment Services Directive 2) - это EU директива, устанавливающая единый платежный рынок в Европе с новыми правилами безопасности платежей и защиты, предназначенная для облегчения международных платежей в рамках EU.

---

## Сертификаты QWAC и QSealC - Подробное объяснение

### Что это такое?

**QWAC (Qualified Website Authentication Certificate)** и **QSealC (Qualified Electronic Seal Certificate)** - это два типа квалифицированных цифровых сертификатов, требуемых по PSD2 для безопасной финансовой коммуникации в EU.

### Разница между QWAC и QSealC

#### QWAC (Qualified Website Authentication Certificate)
- **Назначение:** Аутентификация и защита TLS/SSL соединений
- **Использование:** Защита данных в процессе передачи (in transit)
- **Что делает:**
  - Идентифицирует конечные точки соединения
  - Обеспечивает конфиденциальность, аутентификацию и целостность данных
  - Защищает данные только во время активной передачи
  - Используется для peer-to-peer коммуникации между банком и вашим сервером
- **Не предоставляет:** Юридическую доказательную ценность

#### QSealC (Qualified Electronic Seal Certificate)
- **Назначение:** Создание электронных печатей для защиты данных и документов
- **Использование:** Защита данных как в процессе передачи, так и в хранении
- **Что делает:**
  - Идентифицирует источник данных
  - Делает данные защищенными от подделки (tamperproof)
  - Используется для создания JWS-Signature заголовков в API запросах
  - Обеспечивает аутентификацию и целостность данных
  - Предоставляет юридическую доказательную ценность согласно eIDAS
- **Стандарты:** PAdES, CAdES, или XAdES

### Зачем нужны оба?

**Европейский банковский орган рекомендует использовать оба сертификата параллельно** для полного соответствия требованиям PSD2:
- **QWAC** - для защиты соединения (TLS)
- **QSealC** - для подписи запросов (JWS-Signature)

### Требования

Оба сертификата должны быть:
- ✅ Выданы **Qualified Trust Service Provider (QTSP)** - квалифицированным поставщиком доверительных услуг
- ✅ Признаны согласно **eIDAS Regulation (EU 910/2014)**
- ✅ Действительны во всех странах EU и EEA
- ✅ Соответствовать стандартам **ETSI TS 119 495**

---

## Как получить сертификаты QWAC и QSealC

### Шаг 1: Выбор QTSP провайдера

**QTSP (Qualified Trust Service Provider)** - это организации, уполномоченные выдавать квалифицированные сертификаты согласно eIDAS.

#### Популярные QTSP провайдеры (работают в Польше):

1. **GlobalSign**
   - Признан во всех странах EU и EEA
   - Портал: https://www.globalsign.com/
   - Поддержка: https://support.globalsign.com/
   - Документация по PSD2: https://globalsign.com/en/qualified-certificates-and-seals-for-psd2

2. **Entrust**
   - Признан во всех странах EU и EEA
   - Портал: https://www.entrust.com/
   - Продукты: https://www.entrust.com/products/digital-certificates/qualified

3. **LuxTrust**
   - eIDAS квалифицированный QTSP в EU Trusted List
   - Портал: https://www.luxtrust.com/
   - PSD2 сертификаты: https://www.luxtrust.com/en/professionals/our-digital-solutions/meet-psd2-requirements

4. **Disig**
   - Работает в регионе Словакии, может работать в Польше
   - Портал: https://eidas.disig.sk/

#### Проверка QTSP:
- Все QTSP можно проверить в **EU Trusted List (EUTL)**: https://ec.europa.eu/digital-building-blocks/wikis/display/EID/Trusted+Lists
- Польский национальный список: https://www.nccert.pl/uslugi.htm (National Certification Center)

### Шаг 2: Процесс получения QWAC

#### Для GlobalSign (пример):

1. **Регистрация:**
   - Зарегистрируйтесь в GlobalSign Certificate Center (GCC)
   - Войдите в систему

2. **Заказ сертификата:**
   - Выберите продукт: **ExtendedSSL**
   - Выберите "Yes" для запроса QWAC
   - Выберите срок действия: **1 год** (обязательно)
   - Выберите "I want a PSD2 QWAC"

3. **Заполнение информации:**
   - **VAT номер** или **National Trade Registry (NTR)** номер с кодом страны
   - **Доменное имя** вашего сервера
   - **National Competent Authority (NCA)** - для Польши это KNF (Polish Financial Supervision Authority)
   - **PSP Identifier** - ваш идентификатор Payment Service Provider (от NCA)
   - **PSP Role** - выберите: AISP, PISP, или оба

4. **Верификация:**
   - **Domain control validation:**
     - Установка случайного значения на сервере, или
     - Email challenge
   - **Верификация авторизованного представителя:**
     - Подписанное личное заявление
     - Удостоверение личности с фото (паспорт/ID)
     - Копии дополнительных документов
     - Нотариальное заверение заявки третьей стороной

5. **Получение сертификата:**
   - После завершения верификации сертификат будет выдан
   - Включает приватный ключ (храните в безопасности!)

### Шаг 3: Процесс получения QSealC

#### Для GlobalSign (пример):

1. **Заказ сертификата:**
   - Войдите в GCC
   - Перейдите в "Document, Code & Email Signing"
   - Выберите "Qualified Certificate for Electronic Seal PSD2"

2. **Заполнение информации:**
   - **NCA** (National Competent Authority) - KNF для Польши
   - **PSP Identifier** - от NCA
   - **PSP Role** - AISP, PISP, или оба
   - **Email адрес подписчика** - для получения уведомлений

3. **Верификация:**
   - Та же процедура верификации авторизованного представителя:
     - Подписанное личное заявление
     - Удостоверение личности
     - Дополнительные документы
     - Нотариальное заверение

4. **Получение сертификата:**
   - После верификации сертификат будет выдан
   - Включает приватный ключ

### Шаг 4: Необходимая информация для заказа

#### Обязательные данные:

1. **Организационная информация:**
   - Название компании (юридическое)
   - VAT номер или NTR номер
   - Страна регистрации

2. **PSD2 информация:**
   - **National Competent Authority (NCA):**
     - Для Польши: **KNF (Komisja Nadzoru Finansowego)** / **Polish Financial Supervision Authority**
   - **PSP Identifier (Payment Service Provider Identifier):**
     - Формат: `PSD` + код страны + идентификатор компетентного органа + номер авторизации
     - Пример: `PSDPL-KNF-0123456789`
     - Получается от KNF при получении TPP статуса
   - **PSP Role:**
     - AISP (Account Information Service Provider)
     - PISP (Payment Initiation Service Provider)
     - Или оба

3. **Техническая информация:**
   - Доменное имя сервера (для QWAC)
   - Email для уведомлений (для QSealC)

### Шаг 5: Стоимость

**Приблизительная стоимость:**
- **QWAC:** от €1/год (базовая цена, может варьироваться)
- **QSealC:** от €2/год (базовая цена, может варьироваться)

**Важно:**
- Точная стоимость зависит от провайдера и региона
- Для получения точных цен нужно связаться с QTSP напрямую
- Оплата обычно происходит после завершения верификации и готовности сертификата
- Могут быть дополнительные сборы за верификацию

### Шаг 6: Время получения

**Типичный процесс:**
1. Подача заявки: 1-2 дня
2. Верификация домена: 1-2 дня
3. Верификация представителя: 3-7 дней (зависит от скорости предоставления документов)
4. Выдача сертификата: 1-2 дня после завершения верификации

**Общее время:** 1-2 недели (при оперативном предоставлении всех документов)

### Шаг 7: Использование сертификатов

#### QWAC:
- Используется для TLS соединения с API mBank
- Настраивается на вашем сервере как SSL/TLS сертификат
- Обеспечивает безопасное HTTPS соединение

#### QSealC:
- Используется для создания JWS-Signature заголовков
- Приватный ключ используется для подписи запросов
- Заголовок `JWS-Signature` добавляется к каждому API запросу

---

## Полезные ссылки

### QTSP провайдеры:
- **GlobalSign:** https://www.globalsign.com/en/qualified-certificates-and-seals-for-psd2
- **Entrust:** https://www.entrust.com/products/digital-certificates/qualified
- **LuxTrust:** https://www.luxtrust.com/en/professionals/our-digital-solutions/meet-psd2-requirements

### Проверка QTSP:
- **EU Trusted List:** https://ec.europa.eu/digital-building-blocks/wikis/display/EID/Trusted+Lists
- **Польский National Certification Center:** https://www.nccert.pl/uslugi.htm

### Документация:
- **GlobalSign QWAC Onboarding:** https://support.globalsign.com/qualified-certificates/onboarding/qualified-website-authentication-certificate-qwac-onboarding-guide
- **GlobalSign QSealC Onboarding:** https://support.globalsign.com/qualified-certificates/onboarding/psd2-qualified-electronic-seal-certificate-qsealc-onboarding-guide
- **European Payments Council FAQ:** https://www.europeanpaymentscouncil.eu/

### Регуляторы:
- **KNF (Poland):** https://www.knf.gov.pl/ (Polish Financial Supervision Authority)

---

## Сравнение API

| Характеристика | Paynow API | PSD2 API |
|----------------|------------|----------|
| **Назначение** | Прием платежей от клиентов | Получение банковской информации и инициация платежей |
| **Тип интеграции** | E-commerce платежный шлюз | Open Banking API |
| **Сложность настройки** | Средняя (API ключи) | Высокая (сертификаты, TPP статус) |
| **Для истории транзакций** | ⚠️ Только платежи через Paynow (от клиентов магазину) | ✅ Да (AISP) - полная история по счету |
| **Для создания инвойсов** | ✅ Да | ✅ Да (PISP, но сложнее) |
| **Стоимость** | Коммерческая (комиссии за транзакции) | Зависит от типа аккаунта |
| **Документация** | Отличная | Хорошая |

---

## Рекомендации

### Для выставления онлайн платежей (инвойсов):
**Рекомендуется использовать Paynow API**, так как:
- Специализирован для e-commerce платежей
- Проще в интеграции (только API ключи)
- Хорошая документация и примеры
- Поддержка различных методов оплаты (перевод, карта, BLIK)
- Готовые SDK и плагины для популярных платформ

### Для получения истории транзакций:
**Рекомендуется использовать PSD2 API (AISP)**, так как:
- Это единственный способ получить доступ к банковским транзакциям
- Соответствует EU стандартам
- Позволяет получать данные о всех операциях по счетам

> ⚠️ **ВАЖНО:** Для получения истории транзакций через PSD2 API **обязательно требуются сертификаты QWAC и QSealC**. Без них доступ к API невозможен.

**Требования (обязательные):**
- ⚠️ **TPP статус** (лицензия от KNF) - обязателен
- ⚠️ **Сертификаты QWAC и QSealC** - обязательны (см. раздел "Сертификаты QWAC и QSealC")
- ⚠️ Более сложная настройка и интеграция
- ⚠️ Может потребоваться согласие клиента (consent)

---

## Как начать использовать API (для клиентов mBank)

### Paynow API - Пошаговая инструкция

#### Предварительные требования:
- ✅ У вас должен быть **зарегистрированный бизнес-счет в mBank**
- ✅ Сервис доступен только для зарегистрированных бизнесов (не для физических лиц)

#### Шаг 1: Активация сервиса Paynow в mBank

1. Войдите в свой аккаунт mBank
2. Перейдите в раздел **"Mój biznes"** (Мой бизнес)
3. Выберите **"Paynow"** → **"Ustawienia"** (Настройки)
4. Следуйте инструкциям mBank для активации сервиса Paynow

#### Шаг 2: Добавление магазина/точки приема платежей

1. В панели Paynow перейдите в **"Sklepy i punkty płatności"** (Магазины и точки платежей)
2. Нажмите **"Dodaj sklep"** (Добавить магазин)
3. Введите:
   - Адрес вашего сайта/домена
   - Категорию бизнеса
4. Отправьте на верификацию - mBank проверит вашу заявку

#### Шаг 3: Получение API credentials

После активации магазина:

1. В панели Paynow разверните ваш магазин
2. Перейдите в **Settings** → **Shops and poses** → **Authentication** (Настройки → Магазины и точки → Аутентификация)
3. Скопируйте:
   - **API access key** (Klucz dostępu do API) - это ваш `Api-Key`
   - **Signature calculation key** (Klucz obliczania podpisu) - это ваш `Signature-Key`

#### Шаг 4: Настройка адреса уведомлений

1. В панели Paynow найдите поле **"Adres powiadomień"** (Адрес уведомлений)
2. Введите URL вашего сервера, который будет принимать уведомления о статусах платежей
   - Например: `https://yourdomain.com/api/paynow/webhook`
3. Это критически важно для получения подтверждений платежей

#### Шаг 5: Тестирование в Sandbox

Перед переходом в production:

1. Используйте Sandbox окружение: `https://api.sandbox.paynow.pl`
2. Тестовые credentials (для Sandbox):
   - Api-Key: `97a55694-5478-43b5-b406-fb49ebfdd2b5`
   - Signature-Key: `b305b996-bca5-4404-a0b7-2ccea3d2b64b`
3. Протестируйте:
   - Создание платежей
   - Положительные сценарии
   - Отрицательные сценарии (ошибки, отмены)
   - Обработку возвратов

#### Шаг 6: Интеграция в вашу систему

1. Добавьте API credentials в конфигурацию вашей системы
2. Реализуйте создание платежей через API
3. Настройте обработку webhook уведомлений
4. Включите автоматическое перенаправление на страницу оплаты (если нужно)

#### Шаг 7: Активация карточных платежей (опционально)

Если нужно принимать платежи картами:
- Подайте отдельную заявку в **Blue Media** (партнер mBank по карточным платежам)
- Это отдельный процесс от базовой активации Paynow

---

### PSD2 API - Пошаговая инструкция

#### Предварительные требования:
- ✅ **TPP статус** (Third Party Provider) - лицензия от надзорного органа
- ✅ В Польше: лицензия от **Polish Financial Supervision Authority (KNF)**
- ✅ Сертификаты от квалифицированного поставщика доверительных услуг (QTSP)

#### Шаг 1: Получение TPP статуса

1. Подайте заявку в **Polish Financial Supervision Authority (KNF)**
2. Получите официальную PSD2 лицензию
3. Это необходимо для доступа к production API

#### Шаг 2: Получение сертификатов

Получите от квалифицированного поставщика (QTSP):

1. **QWAC (Qualified Website Certificate)** - для TLS соединения
2. **QSealC (Electronic Seal Qualified Certificate)** - для JWS подписи запросов
3. Оба сертификата должны быть с приватными ключами

#### Шаг 3: Регистрация в Developer Portal

1. Перейдите на: https://developer.api.mbank.pl/portal/login
2. Зарегистрируйтесь в developer portal
3. Создайте приложение (application) используя ваши production сертификаты

#### Шаг 4: Тестирование в Sandbox

Для тестирования (до получения TPP статуса):

1. Используйте Sandbox окружение:
   - **mBank Corporate:** `https://sandbox.api.mbank.pl/bank-simulator-pl-corpo/`
   - **mBank Retail:** `https://sandbox.api.mbank.pl/bank-simulator-pl-retail/`
2. Можно использовать production сертификаты для тестового окружения
3. Изучите Postman коллекцию: https://github.com/melements/mBank-PSD2-api-postman-collection

#### Шаг 5: Интеграция

1. Реализуйте аутентификацию с использованием сертификатов
2. Настройте заголовки:
   - `TPP-Request-ID` (UUID v1, уникальный, не старше 5 минут)
   - `Client-ID` (UUID формат)
   - `JWS-Signature` (подписанный заголовок)
3. Реализуйте endpoints для AISP (история транзакций) или PISP (инициация платежей)

---

## Контакты и поддержка

### Paynow API:
- **Email поддержки:** support@paynow.pl
- **Документация:** https://docs.paynow.pl/
- **Postman workspace:** доступен в документации

### PSD2 API:
- **Developer Portal:** https://developer.api.mbank.pl/
- **Техническая поддержка:** через developer portal
- **FAQ:** https://developer.api.mbank.cz/faq

### mBank Corporate Support:
- **Телефон:** 22 6 273 273 (международный/мобильный) или 801 273 273 (стационарный)
- **Часы работы:** Понедельник-Пятница, 8:00 - 18:00
- **Чат:** через mBank CompanyNet
- **Поддержка включает:** помощь с аккаунтами, вопросы по продуктам, руководство по электронному банкингу, жалобы

---

## Следующие шаги

1. **Для Paynow API:**
   - ✅ Убедитесь, что у вас есть бизнес-счет в mBank
   - ✅ Активируйте Paynow через "Mój biznes" → "Paynow" → "Ustawienia"
   - ✅ Добавьте магазин и получите API credentials
   - ✅ Настройте адрес уведомлений
   - ✅ Протестируйте в Sandbox
   - ✅ Изучите документацию: https://docs.paynow.pl/
   - ✅ Оцените стоимость комиссий для production

2. **Для PSD2 API:**
   - ⚠️ Оцените необходимость получения TPP статуса (может занять время)
   - ⚠️ Получите необходимые сертификаты от QTSP
   - ✅ Зарегистрируйтесь в developer portal: https://developer.api.mbank.pl/
   - ✅ Протестируйте AISP endpoints в Sandbox
   - ✅ Изучите Postman коллекцию для примеров

3. **Вопросы для уточнения:**
   - Нужна ли интеграция с реальными счетами или достаточно тестового окружения?
   - Какой тип клиентов (retail/corporate)?
   - Какие конкретно данные о транзакциях нужны?
   - Есть ли уже TPP статус или нужно его получать?

---

## Полезные ссылки

- Paynow API документация: https://docs.paynow.pl/
- mBank Developer Portal: https://developer.api.mbank.pl/
- mBank PSD2 Sandbox: https://developer.api.mbank.pl/documentation/sandbox-v2
- Postman коллекция PSD2: https://github.com/melements/mBank-PSD2-api-postman-collection
- Open Banking Tracker mBank: https://openbankingtracker.com/provider/mbank
- API Tracker mBank: https://apitracker.io/a/mbank

---

## Дата исследования

2025-01-15
