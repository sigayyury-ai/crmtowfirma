# Tasks: Google Meet Reminders via SendPulse

**Input**: Design documents from `/specs/015-google-meet-reminders/`  
**Prerequisites**: plan.md, spec.md, research.md

**Tests**: Manual integration testing with test calendar events. Smoke scripts for calendar API connectivity.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and Google Calendar API setup.

- [ ] T001 Install googleapis npm package in `/Users/urok/Comoon/pipedrive-wfirma-integration/package.json`
- [ ] T002 Verify Google Calendar environment variables are documented in `/Users/urok/Comoon/pipedrive-wfirma-integration/env.example` (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_CALENDAR_ID, GOOGLE_TIMEZONE)
- [ ] T003 [P] Create directory structure for Google Calendar services in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Create GoogleCalendarService class with OAuth token management in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleCalendarService.js`
- [ ] T005 [P] Implement token refresh logic using GOOGLE_REFRESH_TOKEN in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleCalendarService.js`
- [ ] T006 [P] Create helper functions for timezone conversion in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/utils/timezone.js`
- [ ] T007 Create GoogleMeetReminderService class structure in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T008 Setup logging structure for calendar operations with correlation IDs in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleCalendarService.js`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Daily Calendar Scan and Reminder Task Creation (Priority: P1) 🎯 MVP

**Goal**: System automatically scans Google Calendar each morning, identifies Google Meet events with client emails, and creates reminder tasks for 30-minute and 5-minute reminders.

**Independent Test**: Run daily calendar scan manually, verify that reminder tasks are created for Google Meet events found in calendar with client email addresses.

### Implementation

- [ ] T009 [US1] Implement listCalendarEvents method to fetch events from Google Calendar API in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleCalendarService.js`
- [ ] T010 [US1] Implement filterGoogleMeetEvents method to identify events with Google Meet links (check conferenceData.entryPoints[0].uri and hangoutLink) in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleCalendarService.js`
- [ ] T011 [US1] Implement extractClientEmails method to extract non-organizer attendee emails from events in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleCalendarService.js`
- [ ] T012 [US1] Implement extractGoogleMeetLink method to get Meet link from conferenceData or hangoutLink in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleCalendarService.js`
- [ ] T013 [US1] Implement filterValidEvents method to skip past events, all-day events, and events without required data in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleCalendarService.js`
- [ ] T014 [US1] Implement createReminderTasks method to create two reminder tasks (30-min and 5-min) for each valid event in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T015 [US1] Implement dailyCalendarScan method that orchestrates the full scan process in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T016 [US1] Add cron job registration for daily calendar scan in morning (8:00-10:00 AM) in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/scheduler.js`
- [ ] T017 [US1] Add logging for calendar scan activities, event filtering, and task creation in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`

**Checkpoint**: At this point, User Story 1 should be fully functional - calendar scan runs and creates reminder tasks for Google Meet events.

---

## Phase 4: User Story 2 - Client Person Matching and SendPulse ID Retrieval (Priority: P1)

**Goal**: For each client email found in Google Meet events, system looks up person in Pipedrive CRM and retrieves SendPulse ID.

**Independent Test**: Provide test email address that exists in Pipedrive with SendPulse ID, verify system successfully retrieves person data and SendPulse ID.

### Implementation

- [ ] T018 [US2] Implement findPersonByEmail method using existing Pipedrive client in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T019 [US2] Implement getSendpulseIdFromPerson method to extract SendPulse ID from person custom field (ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c) in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T020 [US2] Integrate person matching into reminder task creation flow in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T021 [US2] Add error handling and logging for cases where person not found or SendPulse ID missing in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T022 [US2] Skip creating reminder tasks for emails without Pipedrive match or SendPulse ID in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`

**Checkpoint**: At this point, User Story 2 should be complete - system matches client emails to Pipedrive persons and retrieves SendPulse IDs.

---

## Phase 5: User Story 3 - Timezone-Aware Reminder Scheduling (Priority: P2)

**Goal**: System calculates reminder send times based on each client's timezone, ensuring reminders arrive at correct local time.

**Independent Test**: Create test Google Meet event, verify reminder tasks are scheduled at correct times when converted to client's timezone.

### Implementation

- [ ] T023 [US3] Implement getClientTimezone method to retrieve timezone from Pipedrive person record in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T024 [US3] Implement convertToClientTimezone method to convert meeting time to client timezone in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/utils/timezone.js`
- [ ] T025 [US3] Implement calculateReminderTimes method to calculate 30-min and 5-min reminder times in client timezone in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T026 [US3] Add fallback to calendar timezone (GOOGLE_TIMEZONE) when client timezone unavailable in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T027 [US3] Update reminder task creation to use timezone-aware scheduling in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T028 [US3] Add logging for timezone conversions and fallback usage in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`

**Checkpoint**: At this point, User Story 3 should be complete - reminders are scheduled with correct timezone calculations.

---

## Phase 6: User Story 4 - Send Reminder Notifications via SendPulse (Priority: P1)

**Goal**: When reminder task scheduled time arrives, system sends notification to client via SendPulse with meeting details and Google Meet link.

**Independent Test**: Manually trigger reminder task, verify SendPulse message is sent to client with correct meeting information and Google Meet link.

### Implementation

- [ ] T029 [US4] Implement sendReminderNotification method using existing SendPulse client in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T030 [US4] Create message template for 30-minute reminder with meeting date, time, and Google Meet link in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T031 [US4] Create shorter message template for 5-minute reminder (more urgent) in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T032 [US4] Implement processScheduledReminders method to check and send reminders when time arrives in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T033 [US4] Add cron job for processing scheduled reminders (run every 5 minutes) in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/scheduler.js`
- [ ] T034 [US4] Implement duplicate prevention mechanism to avoid sending same reminder twice in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T035 [US4] Add logging for reminder sending success/failure in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T036 [US4] Handle SendPulse API errors gracefully with retry logic in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`

**Checkpoint**: At this point, User Story 4 should be complete - reminders are sent via SendPulse when scheduled times arrive.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final improvements, error handling, and documentation.

- [ ] T037 [P] Add comprehensive error handling for Google Calendar API rate limits and authentication failures in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleCalendarService.js`
- [ ] T038 [P] Create test script for manual calendar scan testing in `/Users/urok/Comoon/pipedrive-wfirma-integration/scripts/test-google-calendar-reminders.js`
- [ ] T039 [P] Add API endpoint for manual calendar scan trigger (if needed for testing) in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/routes/api.js`
- [ ] T040 Handle edge cases: recurring events, cancelled events, events with multiple clients in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleCalendarService.js`
- [ ] T041 Add monitoring and alerting hooks for calendar scan failures in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleMeetReminderService.js`
- [ ] T042 Update documentation with setup instructions and troubleshooting guide in `/Users/urok/Comoon/pipedrive-wfirma-integration/docs/google-meet-reminders-setup.md`
- [ ] T043 Verify all environment variables are properly loaded and validated on service startup in `/Users/urok/Comoon/pipedrive-wfirma-integration/src/services/googleCalendar/googleCalendarService.js`

---

## Dependencies & Execution Order

- Setup (Phase 1) → Foundational (Phase 2) → User Stories (Phase 3–6) → Polish (Phase 7)
- User Story phases can be executed in parallel after Phase 2, but recommended order: US1 → US2 → US4 → US3
- US1 must complete before US2 (need events before matching)
- US2 must complete before US4 (need SendPulse IDs before sending)
- US3 can be implemented in parallel with US4 (timezone calculations independent of sending)
- Parallel opportunities marked with `[P]`

---

## Parallel Execution Examples

- **Foundational**: T005 (token refresh) and T006 (timezone utils) can run in parallel as they touch different files
- **US1**: T010 (filter events) and T011 (extract emails) can be developed in parallel
- **US2**: T018 (find person) and T019 (get SendPulse ID) are sequential but can be tested independently
- **US3**: T023 (get timezone) and T024 (convert timezone) can be developed together
- **US4**: T030 (30-min template) and T031 (5-min template) can be created in parallel
- **Polish**: T037 (error handling) and T038 (test script) can be done simultaneously

---

## Implementation Strategy

- **MVP**: Complete Phases 1–3 (US1) to get calendar scan working and creating reminder tasks
- **Incremental Delivery**: After MVP, add person matching (US2), then reminder sending (US4), then timezone support (US3)
- **Testing**: After each phase, test manually with test calendar events and verify logs
- **Production Readiness**: Complete all phases including Polish for robust error handling

---

## Task Statistics

- Total tasks: 43
- User Story 1 tasks: 9
- User Story 2 tasks: 5
- User Story 3 tasks: 6
- User Story 4 tasks: 8
- Setup tasks: 3
- Foundational tasks: 5
- Polish tasks: 7
- Parallel opportunities: T003, T005, T006, T037, T038, T039, T042
- Independent test criteria: Defined for each user story (see phase descriptions)
- Suggested MVP: Phase 3 (User Story 1) - Daily Calendar Scan

