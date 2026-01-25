# Проверка годовых селекторов в отчетах

## Где должны быть годовые селекторы:

### 1. PNL Отчет (`/pnl-report.html`)
- ✅ **HTML**: Селектор есть в строке 34-43
- ✅ **JavaScript**: Инициализация в `pnl-report-script.js` строки 90-127
- ✅ **Опции**: 2024-2028 в HTML, текущий год добавляется динамически
- ✅ **Обработчик**: Событие `change` на строке 138

### 2. MQL Отчет (`/analytics/mql-report.html`)
- ✅ **HTML**: Селектор есть в строке 137-144
- ✅ **JavaScript**: Инициализация в `mql-report.js` строки 376-409
- ✅ **Опции**: 2024-2026 в HTML, текущий год добавляется динамически
- ✅ **Обработчик**: Событие `change` на строке 340

### 3. VAT Margin Отчет (`/vat-margin.html`)
- ✅ **HTML**: Селектор есть в строке 105-114
- ✅ **JavaScript**: Инициализация в `vat-margin-script.js` строки 841-858
- ✅ **Опции**: 2025-2030 в HTML, текущий год добавляется динамически

## Возможные проблемы на проде:

### 1. Старая версия файлов
- Проверить, что все изменения задеплоены на прод
- Проверить версию файлов на проде

### 2. Кеширование браузера
- Очистить кеш браузера
- Использовать Ctrl+F5 для жесткой перезагрузки

### 3. CSS скрывает селектор
- Проверить в DevTools, не скрыт ли элемент (`display: none`, `visibility: hidden`)
- Проверить медиа-запросы для мобильных устройств

### 4. JavaScript ошибки
- Проверить консоль браузера на наличие ошибок
- Проверить, что `yearSelect` не `null` в консоли: `document.getElementById('year-select')`

### 5. Селектор не инициализируется
- Проверить, что `DOMContentLoaded` срабатывает
- Проверить, что `cacheDom()` вызывается

## Как проверить на проде:

1. Открыть DevTools (F12)
2. Проверить консоль на ошибки
3. Выполнить в консоли:
   ```javascript
   // Проверить наличие селектора
   const yearSelect = document.getElementById('year-select');
   console.log('Year select:', yearSelect);
   
   // Проверить опции
   if (yearSelect) {
     console.log('Options:', Array.from(yearSelect.options).map(o => o.value));
     console.log('Current value:', yearSelect.value);
   }
   
   // Проверить стили
   if (yearSelect) {
     const styles = window.getComputedStyle(yearSelect);
     console.log('Display:', styles.display);
     console.log('Visibility:', styles.visibility);
   }
   ```

4. Проверить, что обработчик событий привязан:
   ```javascript
   const yearSelect = document.getElementById('year-select');
   if (yearSelect) {
     yearSelect.addEventListener('change', (e) => {
       console.log('Year changed to:', e.target.value);
     });
   }
   ```

## Рекомендации:

1. **Убедиться, что все файлы задеплоены** - проверить даты модификации файлов на проде
2. **Проверить кеширование** - добавить версионирование к скриптам или очистить кеш
3. **Проверить логи сервера** - нет ли ошибок при загрузке страниц
4. **Проверить сетевые запросы** - загружаются ли все JS файлы

## Файлы для проверки:

- `frontend/pnl-report.html` - должен содержать селектор года
- `frontend/pnl-report-script.js` - должен инициализировать селектор
- `frontend/analytics/mql-report.html` - должен содержать селектор года
- `frontend/analytics/mql-report.js` - должен инициализировать селектор
- `frontend/vat-margin.html` - должен содержать селектор года
- `frontend/vat-margin-script.js` - должен инициализировать селектор
- `frontend/style.css` - должен содержать стили для `.year-selector-group` и `.year-select`
