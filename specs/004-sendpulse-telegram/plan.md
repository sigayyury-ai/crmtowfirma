# Implementation Plan: SendPulse Telegram Notification for Proforma Invoices

## Overview

Этот план описывает реализацию функционала отправки Telegram уведомлений через SendPulse API после успешного создания проформы в wFirma.

## Implementation Strategy

### Phase 1: SendPulse API Client Service

**Цель**: Создать сервис для работы с SendPulse API

**Задачи**:
1. Создать `src/services/sendpulse.js` - клиент для SendPulse API
2. Реализовать аутентификацию через OAuth 2.0 (ID + Secret)
3. Реализовать метод получения access token
4. Реализовать метод отправки сообщения в Telegram
5. Реализовать метод прикрепления файла к сообщению (опционально)
6. Добавить обработку ошибок и retry логику
7. Добавить логирование всех операций

**Ключевые компоненты**:
- Класс `SendPulseClient` аналогично `WfirmaClient` и `PipedriveClient`
- Методы: `authenticate()`, `getAccessToken()`, `sendTelegramMessage()`, `attachFile()`
- Использование переменных окружения: `SENDPULSE_ID`, `SENDPULSE_SECRET`, `SENDPULSE_MESSENGER_ID`

### Phase 2: Integration with Invoice Processing

**Цель**: Интегрировать SendPulse уведомления в процесс создания проформы

**Задачи**:
1. Модифицировать `src/services/invoiceProcessing.js`:
   - Добавить метод `sendTelegramNotification()` 
   - Интегрировать вызов SendPulse после успешного создания проформы
   - Добавить проверку наличия SendPulse ID в Person
   - Обработать случаи отсутствия SendPulse ID (без ошибок)
2. Модифицировать `processDealInvoice()`:
   - После успешного создания проформы (получения invoiceId)
   - Перед отправкой email или параллельно
   - Проверить наличие SendPulse ID в Person
   - Отправить Telegram уведомление, если ID найден
3. Добавить логирование:
   - Успешная отправка Telegram
   - Пропуск отправки при отсутствии SendPulse ID
   - Ошибки отправки (не критичные)

**Точка интеграции**:
- В методе `processDealInvoice()` после строки 470 (после успешного создания проформы)
- До или параллельно с отправкой email (строка 430)

### Phase 3: Get SendPulse ID from Person

**Цель**: Получить значение SendPulse ID из персоны по известному ключу поля

**Задачи**:
1. Добавить константу `SENDPULSE_ID_FIELD_KEY` в `InvoiceProcessingService`:
   - Значение из переменной окружения `PIPEDRIVE_SENDPULSE_ID_FIELD_KEY`
   - Fallback на известный ключ: `ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c`
2. Создать метод `getSendpulseId(person)`:
   - Использовать константу ключа поля
   - Извлечь значение из объекта Person по ключу
   - Обработать случаи отсутствия или пустого значения
   - Вернуть null, если значение не найдено
3. Интегрировать в `processDealInvoice()`:
   - Получить SendPulse ID из Person перед отправкой Telegram
   - Использовать значение для отправки уведомления

### Phase 4: File Attachment (Optional)

**Цель**: Прикрепить файл проформы к Telegram сообщению

**Задачи**:
1. Создать метод `getProformaPdf(invoiceId)` в `WfirmaClient`:
   - Запрос к wFirma API для получения PDF проформы
   - Сохранение файла во временное хранилище
   - Возврат файла в формате для SendPulse API
2. Интегрировать в `sendTelegramNotification()`:
   - Получить PDF проформы из wFirma
   - Прикрепить к сообщению SendPulse
   - Обработать ошибки получения файла (отправить только текст)

**Примечание**: Если прикрепление файла не поддерживается SendPulse API, отправлять только текстовое сообщение.

### Phase 5: Error Handling and Logging

**Цель**: Обеспечить надежную обработку ошибок и логирование

**Задачи**:
1. Обработка ошибок SendPulse:
   - Не критичные ошибки (не блокируют процесс создания проформы)
   - Логирование всех ошибок с деталями
   - Retry логика для временных ошибок (опционально)
2. Обработка отсутствия SendPulse ID:
   - Не считается ошибкой
   - Логирование пропуска отправки
   - Продолжение процесса создания проформы
3. Логирование:
   - Успешная отправка Telegram
   - Пропуск отправки при отсутствии SendPulse ID
   - Ошибки API с деталями
   - Использование существующего логгера (`logger`)

## Technical Implementation Details

### SendPulse API Client Structure

```javascript
class SendPulseClient {
  constructor() {
    this.clientId = process.env.SENDPULSE_ID;
    this.clientSecret = process.env.SENDPULSE_SECRET;
    this.messengerId = process.env.SENDPULSE_MESSENGER_ID;
    this.accessToken = null;
    this.tokenExpiry = null;
  }
  
  async authenticate() { }
  async getAccessToken() { }
  async sendTelegramMessage(sendpulseId, message, file) { }
}
```

### Integration Point in Invoice Processing

```javascript
// После успешного создания проформы (строка ~470)
if (invoiceResult.invoiceId) {
  // ... существующий код ...
  
  // Отправка Telegram уведомления (новый код)
  try {
    const sendpulseId = await this.getSendpulseId(fullPerson);
    if (sendpulseId) {
      await this.sendTelegramNotification(
        sendpulseId,
        invoiceResult.invoiceId,
        invoiceResult.invoiceNumber
      );
    } else {
      logger.info('SendPulse ID not found, skipping Telegram notification');
    }
  } catch (error) {
    logger.warn('Failed to send Telegram notification', { error: error.message });
    // Не критичная ошибка - продолжаем процесс
  }
}
```

## Dependencies

### New Dependencies
- `axios` (уже используется в проекте)
- Возможно, `form-data` для прикрепления файлов (если требуется)

### Environment Variables
- `SENDPULSE_ID` - уже добавлен в `env.example`
- `SENDPULSE_SECRET` - уже добавлен в `env.example`
- `SENDPULSE_MESSENGER_ID` - уже добавлен в `env.example`

## Testing Strategy

1. **Unit Tests**:
   - Тесты для `SendPulseClient` (моки API)
   - Тесты для `getSendpulseId()` (различные сценарии)
   - Тесты для обработки ошибок

2. **Integration Tests**:
   - Тест полного потока: создание проформы → отправка Telegram
   - Тест с отсутствующим SendPulse ID
   - Тест с ошибкой SendPulse API

3. **Manual Testing**:
   - Создать тестовую проформу с Person, у которого есть SendPulse ID
   - Проверить получение Telegram уведомления
   - Проверить отсутствие ошибок при отсутствии SendPulse ID

## Success Criteria

1. ✅ Telegram уведомление отправляется после успешного создания проформы
2. ✅ Отсутствие SendPulse ID не блокирует процесс создания проформы
3. ✅ Ошибки SendPulse API не блокируют процесс создания проформы
4. ✅ Все операции логируются с достаточной детализацией
5. ✅ Ключ поля "Sendpulse ID" определяется динамически из Pipedrive

## Out of Scope

- Управление мессенджерами в SendPulse
- Автоматическое создание SendPulse ID
- Обработка ответов от пользователей в Telegram
- Настройка текста сообщений через UI

