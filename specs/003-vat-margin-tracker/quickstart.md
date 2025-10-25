# Quickstart: VAT маржа — сопоставление платежей

## Требования
- Node.js 18+
- Настроенные переменные окружения (`PIPEDRIVE_API_TOKEN`, `WFIRMA_*`, `WFIRMA_COMPANY_ID`, параметры авторизации страницы)
- Тестовый CSV: `specs/003-vat-margin-tracker/test.csv`

## Шаги разработки
1. Установить зависимости: `npm install`
2. Запустить сервер разработки: `npm run dev`
3. Открыть страницу прототипа: `frontend/vat-margin/index.html` (локально через Live Server или `npm run serve:vat` — добавить в tasks)
4. Загрузить `test.csv` через UI или CURL:
   ```bash
   curl -F "file=@specs/003-vat-margin-tracker/test.csv" http://localhost:3000/api/vat-margin/upload
   ```
5. Получить отчёт:
   ```bash
   curl http://localhost:3000/api/vat-margin/report?jobId=<ID>
   ```
6. Проверить очередь ручной обработки:
   ```bash
   curl http://localhost:3000/api/vat-margin/manual?jobId=<ID>
   ```

## Тестовые сценарии
- Файл `test.csv` — содержит пример с различными типами транзакций.
- Ожидаемые результаты: большинство строк сопоставляется по `CO-PROF nn/2025`, некоторые попадают в ручную очередь.
- Проверить, что отчёт по продуктам показывает суммы по данным проформ и фактические платежи.

## Очистка
- Пока результаты хранятся в памяти; для повторного теста можно перезапустить сервер или добавить endpoint для сброса jobId.

## Авторизация (предварительно)
- Для доступа к /api/vat-margin/ добавить middleware, проверяющее Google OAuth токен.
- В dev-режиме можно включить bypass с заголовком `X-Debug-Bypass`, но обязательно отключить в production.
