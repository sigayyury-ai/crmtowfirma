# Feature Specification: Google Meet Reminders via SendPulse

**Feature Branch**: `015-google-meet-reminders`  
**Created**: 2025-01-27  
**Status**: Draft  
**Input**: User description: "хочу добавть в крон задачи для напоминания клиентам через sendpulse о том что у них звонок с нами чрезе google meet за пол часа до звонка. Надо взять наш шушл календарь и трекать там только гугл миты в них добавлены почты наши клиентов, по ним можно найти персоны в Pipdrive и взянть от туда sendpulse id для создания сообщения напоминания. Задача. Чтобы клиенты не пропускали наши звонки. А за 5 минут просто еще один маленький короткий ремайндер. Я предоставлю тебе доступы для нашего клендаря создай в env записи для этого. Остальные реквизиты для доступов у етбя уже есть. Хочу чтобы задачи автоматом попадли в крон. Можнопросто раз в день дергать календарь утром и на основе этого запроса сформироватьзадачи в крон для таких напоминаний . Из календаря забрать ссылку на гугл мит и дату и на основе даты сделать расчет уведомлений для наших клиентво учитывая их тайм зоны . задача сделать так что бы клиенты точно пришли на звонок и не пропустили его, чтобы сменеджер по продажам не тратил свое время впустую и мог подготовится"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Daily Calendar Scan and Reminder Task Creation (Priority: P1)

Sales managers schedule Google Meet calls with clients in the shared calendar. The system automatically scans the calendar each morning, identifies upcoming Google Meet events with client email addresses, and creates reminder tasks that will send notifications to clients 30 minutes and 5 minutes before their scheduled calls.

**Why this priority**: This is the core functionality that enables the entire reminder system. Without this, no reminders can be sent.

**Independent Test**: Can be fully tested by running the daily calendar scan manually and verifying that reminder tasks are created for Google Meet events found in the calendar. The test delivers value by confirming the system can identify relevant events and prepare reminder notifications.

**Acceptance Scenarios**:

1. **Given** a Google Meet event exists in the shared calendar with a client email address, **When** the daily calendar scan runs in the morning, **Then** the system identifies the event, extracts the meeting date/time, Google Meet link, and client email, and creates two reminder tasks (30 minutes and 5 minutes before the meeting)
2. **Given** a Google Meet event exists with multiple client email addresses, **When** the daily calendar scan runs, **Then** the system creates separate reminder tasks for each client email found in the event
3. **Given** a calendar event exists without a Google Meet link, **When** the daily calendar scan runs, **Then** the system skips the event and does not create reminder tasks
4. **Given** the daily calendar scan runs, **When** it encounters a Google Meet event scheduled for today or in the past, **Then** the system skips creating reminder tasks for events that have already occurred or are too soon to send reminders

---

### User Story 2 - Client Person Matching and SendPulse ID Retrieval (Priority: P1)

For each client email address found in Google Meet events, the system looks up the corresponding person in Pipedrive CRM, retrieves their SendPulse ID, and uses this information to prepare reminder notifications.

**Why this priority**: This is essential for sending reminders - without matching clients to their SendPulse IDs, reminders cannot be delivered.

**Independent Test**: Can be fully tested by providing a test email address that exists in Pipedrive with a SendPulse ID, and verifying the system successfully retrieves the person data and SendPulse ID. The test delivers value by confirming the integration with Pipedrive works correctly.

**Acceptance Scenarios**:

1. **Given** a client email address is found in a Google Meet event, **When** the system searches for the person in Pipedrive, **Then** it finds the matching person record and retrieves the SendPulse ID from the person's custom field
2. **Given** a client email address is found but no matching person exists in Pipedrive, **When** the system searches for the person, **Then** it logs a warning and skips creating reminder tasks for that email address
3. **Given** a matching person exists in Pipedrive but has no SendPulse ID, **When** the system retrieves the person data, **Then** it logs a warning and skips creating reminder tasks for that person
4. **Given** multiple email addresses are found in a single Google Meet event, **When** the system processes each email, **Then** it attempts to match each email independently and creates reminder tasks only for emails with valid Pipedrive matches and SendPulse IDs

---

### User Story 3 - Timezone-Aware Reminder Scheduling (Priority: P2)

The system calculates reminder send times based on each client's timezone, ensuring reminders are sent at the correct local time (30 minutes and 5 minutes before the meeting) regardless of where the client is located.

**Why this priority**: This ensures clients receive reminders at appropriate times in their local timezone, improving the likelihood they will see and act on the reminder.

**Independent Test**: Can be fully tested by creating a test Google Meet event and verifying that reminder tasks are scheduled at the correct times when converted to the client's timezone. The test delivers value by confirming timezone calculations work correctly.

**Acceptance Scenarios**:

1. **Given** a Google Meet event is scheduled for 2:00 PM in the calendar's timezone, **When** the client's timezone is UTC+2 and the calendar timezone is UTC+1, **Then** the system calculates that the meeting is at 3:00 PM client time and schedules reminders for 2:30 PM and 2:55 PM client time
2. **Given** a client's timezone cannot be determined from Pipedrive, **When** the system schedules reminders, **Then** it uses a default timezone (calendar timezone or system default) and logs a warning
3. **Given** a reminder task is scheduled for a time that has already passed (e.g., meeting is in 10 minutes), **When** the system creates the task, **Then** it either skips creating the task or marks it for immediate processing, depending on how much time remains

---

### User Story 4 - Send Reminder Notifications via SendPulse (Priority: P1)

When a reminder task's scheduled time arrives, the system sends a notification to the client via SendPulse containing the meeting details and Google Meet link.

**Why this priority**: This is the final step that delivers value to clients - without sending the actual reminders, the entire system has no purpose.

**Independent Test**: Can be fully tested by manually triggering a reminder task and verifying that a SendPulse message is sent to the client with the correct meeting information and Google Meet link. The test delivers value by confirming the end-to-end reminder delivery works.

**Acceptance Scenarios**:

1. **Given** a reminder task is scheduled for 30 minutes before a meeting, **When** the scheduled time arrives and the cron job runs, **Then** the system sends a SendPulse message to the client containing the meeting time, date, and Google Meet link
2. **Given** a reminder task is scheduled for 5 minutes before a meeting, **When** the scheduled time arrives, **Then** the system sends a shorter, more urgent reminder message via SendPulse
3. **Given** a reminder task's time has arrived, **When** the system attempts to send the reminder, **Then** it successfully sends the message and logs the result, or logs an error if sending fails
4. **Given** a reminder has already been sent for a meeting, **When** the cron job runs again, **Then** the system does not send duplicate reminders for the same meeting and reminder type

---

### Edge Cases

- What happens when a Google Meet event is cancelled or rescheduled after reminder tasks are created?
- How does the system handle calendar events with no email addresses or invalid email formats?
- What happens when multiple Google Meet events exist for the same client on the same day?
- How does the system handle calendar API rate limits or authentication failures?
- What happens when a client's timezone changes between task creation and reminder sending?
- How does the system handle Google Meet events that are recurring (series events)?
- What happens when the daily calendar scan fails or is interrupted?
- How does the system prevent sending reminders for meetings that have already occurred?
- What happens when a SendPulse ID is valid but the SendPulse API returns an error when sending?
- How does the system handle calendar events with very short notice (less than 30 minutes until meeting)?
- **What happens when a person is found in Pipedrive but has no SendPulse ID?** The system logs a warning with person details (ID, name, email), skips creating reminder tasks for that person, increments the `clientsSkipped` counter in the scan summary, and continues processing other clients. This allows the scan to complete successfully while highlighting which clients need SendPulse ID configuration. The summary report includes the count of skipped clients for monitoring purposes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST scan the shared Google Calendar once per day in the morning to identify upcoming Google Meet events
- **FR-002**: System MUST filter calendar events to only process those containing Google Meet links or video conference information
- **FR-003**: System MUST extract client email addresses from Google Meet event attendees or description fields
- **FR-004**: System MUST search for matching person records in Pipedrive CRM using extracted email addresses
- **FR-005**: System MUST retrieve SendPulse ID from matched Pipedrive person records using the standard SendPulse ID custom field
- **FR-006**: System MUST create two reminder tasks for each valid Google Meet event: one scheduled 30 minutes before the meeting, and one scheduled 5 minutes before the meeting
- **FR-007**: System MUST extract the Google Meet link from calendar events and include it in reminder messages
- **FR-008**: System MUST calculate reminder send times based on each client's timezone to ensure reminders arrive at appropriate local times
- **FR-009**: System MUST use client timezone information from Pipedrive person records when available
- **FR-010**: System MUST use a default timezone (calendar timezone or system default) when client timezone cannot be determined
- **FR-011**: System MUST send reminder notifications via SendPulse when reminder task scheduled times arrive
- **FR-012**: System MUST include meeting date, time, and Google Meet link in 30-minute reminder messages
- **FR-013**: System MUST send shorter, more urgent reminder messages for 5-minute reminders
- **FR-014**: System MUST skip creating reminder tasks for Google Meet events that have already occurred or are scheduled too soon (less than 30 minutes away)
- **FR-015**: System MUST skip creating reminder tasks for email addresses that do not match any Pipedrive person records
- **FR-016**: System MUST skip creating reminder tasks for persons without SendPulse IDs
- **FR-017**: System MUST log detailed warnings when persons are found in Pipedrive but lack SendPulse IDs, including person ID, name, email, and event details for troubleshooting
- **FR-018**: System MUST include statistics about skipped clients (persons without SendPulse IDs) in the daily calendar scan summary report
- **FR-017**: System MUST prevent duplicate reminder sending for the same meeting and reminder type
- **FR-018**: System MUST log all calendar scan activities, person matching results, task creation, and reminder sending outcomes
- **FR-019**: System MUST handle calendar API errors gracefully and continue processing other events when individual events fail
- **FR-020**: System MUST store Google Calendar API credentials in environment variables as specified in env.example

### Key Entities *(include if feature involves data)*

- **Calendar Event**: Represents a Google Meet event from the shared calendar, containing event date/time, Google Meet link, and attendee email addresses
- **Reminder Task**: Represents a scheduled reminder notification, containing meeting details, client SendPulse ID, scheduled send time, and reminder type (30-minute or 5-minute)
- **Client Person**: Represents a person record from Pipedrive CRM, containing email address, timezone, and SendPulse ID for reminder delivery

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: System successfully identifies and processes Google Meet events from the shared calendar within 5 minutes of the daily morning scan
- **SC-002**: System creates reminder tasks for at least 95% of valid Google Meet events (events with client emails that match Pipedrive persons with SendPulse IDs)
- **SC-003**: Reminder notifications are delivered to clients via SendPulse with at least 98% success rate (excluding cases where SendPulse ID is invalid or client has opted out)
- **SC-004**: Reminders are sent at the correct times (within 2 minutes of scheduled time) for at least 99% of reminder tasks
- **SC-005**: Sales managers report a reduction in missed client calls by at least 40% within 3 months of implementation
- **SC-006**: System processes calendar scans without manual intervention for at least 30 consecutive days
- **SC-007**: Clients receive both reminder types (30-minute and 5-minute) for at least 90% of scheduled meetings where both reminders are applicable

## Assumptions

- Google Calendar API credentials are stored in environment variables:
  - `GOOGLE_CLIENT_ID` - OAuth 2.0 Client ID from Google Cloud Console
  - `GOOGLE_CLIENT_SECRET` - OAuth 2.0 Client Secret from Google Cloud Console
  - `GOOGLE_REFRESH_TOKEN` - Refresh token for accessing Google Calendar API
  - `GOOGLE_CALENDAR_ID` - ID of the shared calendar to scan (e.g., "primary" or calendar email like "hello@comoon.io")
  - `GOOGLE_TIMEZONE` - Timezone of the calendar (e.g., "Europe/Warsaw")
- The shared calendar contains Google Meet events with client email addresses in attendees or event description
- Pipedrive person records contain email addresses that match email addresses found in calendar events
- SendPulse ID custom field key in Pipedrive is consistent and accessible (`ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c`)
- Client timezone information is available in Pipedrive person records or can be inferred from person location data
- The daily calendar scan runs in the morning (exact time to be determined during planning, but typically between 8:00-10:00 AM)
- Google Meet links in calendar events are valid and accessible at the time reminders are sent
- SendPulse API is available and responsive when reminder tasks execute
- The system has sufficient permissions to read the shared Google Calendar via the provided refresh token
- Reminder tasks are integrated into the existing cron task system and follow the same patterns as other scheduled tasks
