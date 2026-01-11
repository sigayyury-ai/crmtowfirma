# Feature Specification: Защита от дубликатов напоминаний для Stripe платежей

**Feature Branch**: `001-stripe-reminder-duplicates`  
**Created**: 2026-01-11  
**Status**: Draft  
**Input**: User description: "Добавить защиту от дубликатов напоминаний для Stripe платежей"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Предотвращение дубликатов напоминаний (Priority: P1)

Система должна предотвращать отправку повторных напоминаний о втором платеже для одной и той же сделки и даты второго платежа, если напоминание уже было отправлено ранее, независимо от того, когда это произошло. Поскольку cron работает раз в день, защита только на один день не имеет смысла - система должна отслеживать всю историю отправок и не отправлять повторные напоминания, если платеж уже оплачен или напоминание уже было отправлено.

**Why this priority**: Критически важно для предотвращения спама клиентам и поддержания профессионального имиджа компании. Повторные напоминания раздражают клиентов и могут привести к потере доверия. Если платеж уже оплачен, напоминания вообще не должны отправляться, независимо от дня.

**Independent Test**: Можно протестировать, отправив напоминание для Deal #1234 с датой второго платежа 2026-01-15, а затем попытавшись отправить напоминание для той же сделки и даты на следующий день или позже. Система должна пропустить отправку, так как напоминание уже было отправлено ранее для этой комбинации сделки и даты второго платежа.

**Acceptance Scenarios**:

1. **Given** напоминание о втором платеже уже было отправлено для Deal #1234 с датой второго платежа 2026-01-15 в любой предыдущий день, **When** система пытается отправить напоминание для той же сделки и той же даты второго платежа, **Then** система пропускает отправку и логирует причину пропуска (напоминание уже отправлено)

2. **Given** cron-задача запускается ежедневно, **When** система обрабатывает задачи напоминаний, **Then** для каждой комбинации сделки и даты второго платежа отправляется максимум одно напоминание за все время

3. **Given** второй платеж для Deal #1234 уже оплачен (>=90% от ожидаемой суммы), **When** система проверяет необходимость отправки напоминания, **Then** система не отправляет напоминание, независимо от того, отправлялось ли оно ранее или нет

4. **Given** дата второго платежа для Deal #1234 изменилась с 2026-01-15 на 2026-01-20, **When** система проверяет необходимость отправки напоминания, **Then** система может отправить новое напоминание для новой даты (2026-01-20), так как это другая дата второго платежа

---

### User Story 2 - Логирование отправленных напоминаний (Priority: P1)

Система должна сохранять информацию о каждом отправленном напоминании в базу данных для аудита и предотвращения дубликатов между запусками cron.

**Why this priority**: Необходимо для отслеживания истории отправок и обеспечения защиты от дубликатов даже после перезапуска сервера или между разными экземплярами приложения.

**Independent Test**: Можно протестировать, отправив напоминание и проверив, что запись появилась в базе данных с правильными данными (deal_id, дата второго платежа, дата отправки).

**Acceptance Scenarios**:

1. **Given** напоминание успешно отправлено через SendPulse, **When** система завершает обработку, **Then** в базе данных создается запись с информацией о сделке, дате второго платежа, дате отправки и идентификаторе SendPulse

2. **Given** отправка напоминания завершилась с ошибкой, **When** система обрабатывает ошибку, **Then** запись в базе данных не создается (напоминание не считается отправленным)

3. **Given** система пытается создать запись о напоминании, которое уже существует для той же сделки, даты второго платежа и даты отправки, **When** происходит попытка вставки, **Then** система обрабатывает конфликт уникальности корректно (не падает с ошибкой)

---

### User Story 3 - Проверка истории перед отправкой (Priority: P1)

Перед отправкой каждого напоминания система должна проверять полную историю отправок и текущий статус оплаты. Система не должна отправлять напоминание, если: (1) напоминание уже было отправлено ранее для этой комбинации сделки и даты второго платежа, или (2) второй платеж уже оплачен (>=90% от ожидаемой суммы).

**Why this priority**: Критически важно для предотвращения дубликатов на этапе планирования отправки, до фактической отправки сообщения. Поскольку cron работает раз в день, проверка должна учитывать всю историю, а не только текущий день.

**Independent Test**: Можно протестировать, создав запись о ранее отправленном напоминании в базе данных (в любой предыдущий день) и убедившись, что система пропускает отправку при проверке. Также можно протестировать, оплатив второй платеж и убедившись, что система не отправляет напоминание.

**Acceptance Scenarios**:

1. **Given** в базе данных есть запись о напоминании для Deal #1234 с датой второго платежа 2026-01-15, отправленном в любой предыдущий день, **When** система проверяет необходимость отправки напоминания для этой сделки и той же даты второго платежа, **Then** система определяет, что напоминание уже отправлено и пропускает задачу

2. **Given** в базе данных нет записей о напоминаниях для Deal #1234, **When** система проверяет необходимость отправки, **Then** система проверяет статус оплаты и отправляет напоминание только если платеж не оплачен

3. **Given** второй платеж для Deal #1234 уже оплачен (>=90% от ожидаемой суммы), **When** система проверяет необходимость отправки напоминания, **Then** система определяет, что платеж оплачен и не отправляет напоминание, независимо от наличия записей в истории

4. **Given** в базе данных есть запись о напоминании для Deal #1234 с датой второго платежа 2026-01-15, но дата второго платежа в сделке изменилась на 2026-01-20, **When** система проверяет необходимость отправки напоминания, **Then** система может отправить новое напоминание для новой даты (2026-01-20), так как это другая дата второго платежа

---

### Edge Cases

- Что происходит, если база данных недоступна во время проверки дубликатов? Система должна логировать ошибку и пропускать проверку (не блокировать отправку), но это должно быть исключительной ситуацией
- Как система обрабатывает ситуацию, когда два процесса одновременно пытаются отправить напоминание для одной сделки? Уникальный индекс в базе данных предотвращает создание дубликатов, один из процессов получит ошибку уникальности и пропустит отправку
- Что происходит, если отправка через SendPulse успешна, но сохранение в базу данных не удалось? Система должна повторять попытку сохранения или логировать критическую ошибку для ручной проверки
- Как система обрабатывает изменение даты второго платежа в сделке после отправки напоминания? Система использует дату второго платежа из задачи, которая была актуальна на момент создания задачи. Если дата изменилась, это будет новая задача с новой датой второго платежа

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST store a record of each successfully sent reminder notification in a persistent database table
- **FR-002**: System MUST check reminder history before sending each notification to prevent duplicates for the same deal and second payment date combination, regardless of when the previous reminder was sent
- **FR-003**: System MUST prevent sending multiple reminders for the same deal and second payment date combination, even if previous reminder was sent on a different calendar day
- **FR-004**: System MUST log reminder records with deal ID, second payment date, sent date, session ID, SendPulse ID, and trigger source
- **FR-005**: System MUST handle database uniqueness constraint violations gracefully when duplicate reminder records are attempted
- **FR-006**: System MUST check payment status before sending reminders and skip sending if second payment is already paid (>=90% of expected amount), regardless of reminder history
- **FR-007**: System MUST check reminder history both when creating reminder tasks and immediately before sending each notification
- **FR-008**: System MUST include run ID and trigger source in reminder log records for audit trail
- **FR-009**: System MUST only create reminder log records after successful message delivery through SendPulse
- **FR-010**: System MUST use reminder history as permanent record - once a reminder is sent for a deal and second payment date, it should not be sent again for that combination, unless the second payment date changes
- **FR-011**: System MUST allow sending new reminders if the second payment date for a deal changes (different date = new reminder opportunity)

### Key Entities *(include if feature involves data)*

- **Stripe Reminder Log**: Represents a record of a successfully sent reminder notification for a Stripe payment deal. Contains deal ID, second payment date, sent date, session ID, SendPulse contact ID, run ID, trigger source, and timestamp. Used to prevent duplicate reminders and provide audit trail.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero duplicate reminders are sent for the same deal and second payment date combination, regardless of calendar day (100% prevention rate across all time)
- **SC-002**: System successfully logs 100% of sent reminders to database within 5 seconds of successful SendPulse delivery
- **SC-003**: Reminder history check completes in under 500ms per deal to maintain cron job performance
- **SC-004**: System handles concurrent reminder processing attempts without sending duplicates (tested with 10 simultaneous processes)
- **SC-005**: Reminder log records are queryable for audit purposes, allowing identification of all reminders sent for a specific deal and second payment date combination
- **SC-006**: System prevents sending reminders for deals where second payment is already paid (>=90% of expected amount) with 100% accuracy

## Assumptions

- Database table will use the same structure pattern as `proforma_reminder_logs` for consistency, but unique constraint will be based on deal_id and second_payment_date (without sent_date) to prevent duplicates across all time
- Reminder log records are created only after successful SendPulse message delivery
- System will check reminder history at two points: when creating tasks and immediately before sending
- In-memory cache can be used for performance optimization within a single process, but database is the source of truth
- Once a reminder is sent for a specific deal and second payment date combination, it should never be sent again for that combination, even if cron runs on different days
- If the second payment date for a deal changes, this creates a new reminder opportunity (different second_payment_date = new reminder can be sent)
- System must check payment status before sending reminders - if payment is already paid (>=90% of expected amount), no reminder should be sent regardless of history
- Session ID is included in log records to track which Stripe checkout session the reminder was for
