# Implementation Plan: Google Meet Reminders via SendPulse

**Branch**: `015-google-meet-reminders` | **Date**: 2025-01-27 | **Spec**: [`/specs/015-google-meet-reminders/spec.md`](spec.md)

## Summary

Реализовать систему автоматических напоминаний клиентам о предстоящих Google Meet звонках через SendPulse. Система ежедневно сканирует общий Google Calendar, находит события с Google Meet ссылками, извлекает email адреса клиентов, сопоставляет их с персонами в Pipedrive для получения SendPulse ID, и создает задачи в cron для отправки напоминаний за 30 минут и 5 минут до встречи с учетом часовых поясов клиентов.

## Technical Context

**Language/Version**: Node.js 18+ (Render prod)  
**Primary Dependencies**: Express.js, googleapis (Google Calendar API client), node-cron, axios, Winston logger, existing SendPulse and Pipedrive services  
**Storage**: In-memory task storage (similar to existing cron tasks pattern), Supabase for optional logging  
**Testing**: Manual integration testing with test calendar events, smoke scripts for calendar API connectivity  
**Target Platform**: Render Linux container (same as existing services)  
**Project Type**: Backend service integration  
**Performance Goals**: Process calendar scan within 5 minutes, handle up to 100 events per day, reminder delivery within 2 minutes of scheduled time  
**Constraints**: Must integrate with existing cron scheduler pattern, respect Google Calendar API rate limits (1000 requests/day), handle timezone conversions accurately, prevent duplicate reminders  
**Scale/Scope**: Daily calendar scans, up to 50-100 Google Meet events per day, 2 reminders per event (30-min and 5-min)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Invoice Data Fidelity** — N/A (feature doesn't modify invoice data) ✅  
2. **Reliable Automation Flow** — Follows existing cron scheduler pattern, includes idempotency keys and duplicate detection for reminder tasks ✅  
3. **Transparent Observability** — All Google Calendar API calls, Pipedrive lookups, and SendPulse notifications logged via shared logger with correlation IDs ✅  
4. **Secure Credential Stewardship** — Google Calendar credentials stored in environment variables (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_CALENDAR_ID, GOOGLE_TIMEZONE), no secrets in code ✅  
5. **Spec-Driven Delivery Discipline** — Specification approved, plan follows standard path `spec → plan → tasks → implement` ✅  
6. **Operational Constraints** — Integrates with existing cron infrastructure, follows same patterns as proforma reminders and second payment scheduler ✅

## Project Structure

### Documentation (this feature)

```text
specs/015-google-meet-reminders/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output - Google Calendar API field research
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── scheduler.js                    # Existing cron scheduler (add new cron job)
│   ├── sendpulse.js                    # Existing SendPulse client (reuse)
│   ├── pipedrive.js                    # Existing Pipedrive client (reuse)
│   └── googleCalendar/                 # NEW: Google Calendar service
│       ├── googleCalendarService.js    # Main service for calendar operations
│       └── googleMeetReminderService.js # Service for reminder task management
├── routes/
│   └── api.js                          # Existing routes (add new endpoints if needed)
└── utils/
    └── logger.js                       # Existing logger (reuse)

scripts/
└── test-google-calendar-reminders.js   # NEW: Test script for manual testing
```

**Structure Decision**: Follows existing service pattern. New Google Calendar service in `src/services/googleCalendar/`, integrates with existing scheduler.js for cron job registration. Reuses existing SendPulse and Pipedrive services.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations identified.

## Phase 0 — Research Summary

**Research Document**: [`research.md`](research.md)

**Key Findings:**

1. **Google Meet Link Extraction**: 
   - Primary: `conferenceData.entryPoints[0].uri` (modern events)
   - Fallback: `hangoutLink` (legacy events)
   - Decision: Check both for maximum compatibility

2. **Attendee Email Extraction**:
   - Extract from `attendees[]` array
   - Filter out organizer (`organizer === true`)
   - Filter out internal emails (e.g., `@comoon.io`)
   - Remaining emails are client emails

3. **Timezone Handling**:
   - Use `start.timeZone` if available (preferred)
   - Parse from `dateTime` offset if `timeZone` missing
   - Fallback to `GOOGLE_TIMEZONE` env var
   - Convert to client timezone from Pipedrive for reminder scheduling

4. **Event Filtering**:
   - Must have `start.dateTime` (skip all-day events)
   - Must have Google Meet link (`conferenceData` OR `hangoutLink`)
   - Must have non-organizer attendees with emails
   - Skip past events and events <30 minutes away

5. **Library Choice**: 
   - Use `googleapis` npm package (official Google API client)
   - Handles OAuth token refresh automatically
   - Well-maintained and documented

6. **API Request Parameters**:
   - `timeMin`: today 00:00:00
   - `timeMax`: 30 days from now
   - `singleEvents: true` (expand recurring events)
   - `orderBy: startTime`
   - `timeZone`: from `GOOGLE_TIMEZONE` env var

**All research questions resolved. Ready for Phase 1 design.**

## Phase 1 — Design Outputs

*To be generated:*
- `data-model.md`: Reminder task entities, calendar event structure
- `contracts/`: API endpoints for manual testing/triggering
- `quickstart.md`: Setup and testing guide
