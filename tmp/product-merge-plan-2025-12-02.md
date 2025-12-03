# Product merge plan — 2025‑12‑02

Предложения согласованы: оставляем базовые названия без дат, остальные записи считаем дублями.

## Coliving Portugal ✅
- **Канон**: `Coliving Portugal` (id=1, переименован).
- **Дубль**: `Сoliving Portugal 01.11.2025` (id=9).
- **Статус**: `node scripts/mergeProducts.js "Coliving Portugal" "Сoliving Portugal 01.11.2025"` выполнен; все строки `proforma_products` перепривязаны, запись id=9 удалена.

## Single Lankowa ✅
- **Канон**: `Single Lankowa` (id=23, переименован).
- **Дубль**: `Single lankowa 14.12.2025` (id=18).
- **Статус**: `node scripts/mergeProducts.js "Single Lankowa" "Single lankowa 14.12.2025"` выполнен; id=18 удалён.

## Ski France ✅
- **Канон**: `Ski France` (id=21, переименован).
- **Дубль**: `SKI FRANCE 24.01.2026` (id=4).
- **Статус**: `node scripts/mergeProducts.js "Ski France" "SKI FRANCE 24.01.2026"` выполнен; id=4 удалён.

## SKI Poland
- **Канон**: `SKI Poland 01` (id=20).
- **Дубль**: `SKI POLAND 03.01.2026` (id=5) — идентичный запуск, слит в канон.
- **Независимый продукт**: `SKI Poland 02` (id=15) **не** трогаем.
- **Статус**: `node scripts/mergeProducts.js "SKI Poland 01" "SKI POLAND 03.01.2026"` выполнен; id=5 удалён.

### После выполнения команд
1. Запусти `node scripts/exportProductNames.js` — убедимся, что дублей больше нет.
2. Проверь новые нормализованные названия в `tmp/product-names-*.md` и скорректируй при необходимости.
3. Если обнаружатся дополнительные пары (например, `Sreda*` или разные варианты `Ski Poland`), повтори процедуру с нужными канонами.


