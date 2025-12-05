# Research: Google Calendar API Event Fields for Meet Reminders

**Date**: 2025-01-27  
**Feature**: Google Meet Reminders via SendPulse  
**Purpose**: Research Google Calendar API event structure to understand how to extract Google Meet links, attendee emails, and timezone information

## Research Questions

1. What fields are available in Google Calendar API v3 event objects?
2. How are Google Meet links stored in calendar events?
3. How to extract attendee email addresses from events?
4. How to handle timezones in calendar events?
5. What is the structure of conferenceData for Google Meet?

## Findings

### 1. Google Calendar API v3 Event Object Structure

Based on Google Calendar API v3 documentation and existing codebase analysis:

**Core Event Fields:**
- `id` - Unique event identifier
- `summary` - Event title/name
- `description` - Event description
- `location` - Physical or virtual location
- `start` - Object with `dateTime` (ISO 8601) and `timeZone`
- `end` - Object with `dateTime` (ISO 8601) and `timeZone`
- `attendees` - Array of attendee objects
- `conferenceData` - Object containing video conference information
- `hangoutLink` - Legacy field for Google Meet links (deprecated but may still exist)
- `recurrence` - Array for recurring events
- `status` - Event status (confirmed, tentative, cancelled)

### 2. Google Meet Link Extraction

**Primary Method: `conferenceData.entryPoints`**

Modern Google Calendar events store Google Meet information in `conferenceData`:

```json
{
  "conferenceData": {
    "createRequest": {
      "requestId": "...",
      "conferenceSolutionKey": {
        "type": "hangoutsMeet"
      }
    },
    "entryPoints": [
      {
        "entryPointType": "video",
        "uri": "https://meet.google.com/xxx-xxxx-xxx",
        "label": "meet.google.com/xxx-xxxx-xxx"
      }
    ],
    "conferenceSolution": {
      "key": {
        "type": "hangoutsMeet"
      },
      "name": "Google Meet",
      "iconUri": "..."
    }
  }
}
```

**Legacy Method: `hangoutLink`**

Older events may have `hangoutLink` field directly:
```json
{
  "hangoutLink": "https://meet.google.com/xxx-xxxx-xxx"
}
```

**Decision**: Check both `conferenceData.entryPoints[0].uri` (primary) and `hangoutLink` (fallback) for maximum compatibility.

**Rationale**: 
- `conferenceData` is the modern, recommended approach
- `hangoutLink` may exist in older events or events created differently
- Checking both ensures we don't miss any Google Meet links

**Alternatives Considered**:
- Only checking `conferenceData`: Rejected because older events might not have this field
- Only checking `hangoutLink`: Rejected because it's deprecated and may not exist in new events

### 3. Attendee Email Extraction

**Structure:**
```json
{
  "attendees": [
    {
      "email": "client@example.com",
      "displayName": "Client Name",
      "responseStatus": "accepted|declined|tentative|needsAction",
      "organizer": false
    }
  ]
}
```

**Key Fields:**
- `email` - Email address (required for matching with Pipedrive)
- `displayName` - Display name (optional)
- `responseStatus` - Response status
- `organizer` - Boolean indicating if attendee is the organizer

**Decision**: Extract all `attendees[].email` values, excluding the organizer's email (typically the sales manager's email).

**Rationale**:
- Multiple clients may be in the same meeting
- We need to send reminders to all client attendees
- Organizer is typically a sales manager, not a client

**Filtering Logic**:
1. Extract all attendees
2. Filter out attendees where `organizer === true`
3. Filter out attendees with `email` matching known internal email patterns (e.g., `@comoon.io`)
4. Remaining emails are considered client emails

**Alternatives Considered**:
- Include organizer: Rejected because organizer is typically internal staff
- Only first attendee: Rejected because meetings may have multiple clients

### 4. Timezone Handling

**Event Time Structure:**
```json
{
  "start": {
    "dateTime": "2025-01-27T14:00:00+01:00",
    "timeZone": "Europe/Warsaw"
  },
  "end": {
    "dateTime": "2025-01-27T15:00:00+01:00",
    "timeZone": "Europe/Warsaw"
  }
}
```

**Key Points:**
- `dateTime` may include timezone offset (`+01:00`) or be in UTC
- `timeZone` field specifies the IANA timezone (e.g., `Europe/Warsaw`)
- Both fields should be used for accurate timezone conversion

**Decision**: 
1. Use `start.timeZone` if available (preferred)
2. Parse timezone from `dateTime` offset if `timeZone` is missing
3. Fallback to calendar timezone (`GOOGLE_TIMEZONE` env var) if neither is available
4. Convert meeting time to client's timezone from Pipedrive for reminder scheduling

**Rationale**:
- `timeZone` field is most reliable
- `dateTime` offset provides fallback
- Calendar timezone is safe default
- Client timezone from Pipedrive ensures reminders arrive at correct local time

**Timezone Conversion Flow:**
1. Extract meeting time from `start.dateTime` and `start.timeZone`
2. Get client timezone from Pipedrive person record
3. Convert meeting time to client timezone
4. Calculate reminder times (30 min and 5 min before) in client timezone
5. Store reminder tasks with UTC timestamps for cron scheduling

### 5. Event Filtering Criteria

**Required Fields for Processing:**
- `start.dateTime` - Must exist (all-day events with `start.date` only are skipped)
- `conferenceData` OR `hangoutLink` - Must have at least one Google Meet link
- `attendees` - Must have at least one non-organizer attendee with email

**Filtering Logic:**
1. Skip events without `start.dateTime` (all-day events)
2. Skip events without Google Meet link (`conferenceData.entryPoints[0].uri` OR `hangoutLink`)
3. Skip events without attendees or with only organizer attendees
4. Skip events in the past (before current time)
5. Skip events too soon (less than 30 minutes away - can't send 30-min reminder)

**Decision**: Implement strict filtering to ensure only valid, processable events create reminder tasks.

**Rationale**:
- Prevents errors from missing data
- Ensures reminders are only sent for actual Google Meet calls
- Avoids creating tasks for events that can't be processed

### 6. API Request Parameters

**List Events Endpoint:**
```
GET /calendar/v3/calendars/{calendarId}/events
```

**Required Parameters:**
- `timeMin` - ISO 8601 datetime, start of time range (e.g., today 00:00:00)
- `timeMax` - ISO 8601 datetime, end of time range (e.g., 30 days from now)
- `singleEvents` - `true` to expand recurring events
- `orderBy` - `startTime` to sort by start time
- `timeZone` - IANA timezone for timeMin/timeMax interpretation

**Optional Parameters:**
- `maxResults` - Limit number of results (default 250, max 2500)
- `showDeleted` - Include deleted events (default false)
- `q` - Free text search query

**Decision**: 
- Use `timeMin` = today 00:00:00
- Use `timeMax` = 30 days from now (sufficient for reminder planning)
- Use `singleEvents = true` to handle recurring events
- Use `orderBy = startTime` for chronological processing
- Use `timeZone` from `GOOGLE_TIMEZONE` env var

**Rationale**:
- 30-day window covers all upcoming meetings that need reminders
- Expanding recurring events ensures we process each occurrence
- Sorting by start time simplifies processing logic

### 7. Error Handling and Edge Cases

**API Errors:**
- `401 Unauthorized` - Token expired, refresh and retry
- `403 Forbidden` - Insufficient permissions, log error
- `404 Not Found` - Calendar doesn't exist, log error
- `429 Too Many Requests` - Rate limit, implement exponential backoff

**Event Edge Cases:**
- Recurring events - `singleEvents=true` expands them, process each occurrence
- Cancelled events - Check `status === 'cancelled'`, skip processing
- All-day events - Only have `start.date`, skip (no specific time)
- Events without attendees - Skip (no clients to notify)
- Events with only internal attendees - Filter out internal emails

**Decision**: Implement comprehensive error handling and edge case filtering.

**Rationale**: Ensures system reliability and prevents processing invalid events.

## Implementation Notes

### Library Choice

**Decision**: Use `googleapis` npm package (official Google API client library for Node.js)

**Rationale**:
- Official Google library with TypeScript support
- Handles OAuth token refresh automatically
- Well-maintained and documented
- Already used in similar projects

**Installation**:
```bash
npm install googleapis
```

**Alternatives Considered**:
- Direct REST API calls with axios: Rejected because requires manual token management
- `@google-cloud/calendar`: Rejected because it's for Google Cloud Calendar, not Google Calendar API

### Token Management

**Decision**: Use refresh token flow with automatic token refresh

**Rationale**:
- Access tokens expire after 1 hour
- Refresh tokens are long-lived
- Automatic refresh prevents authentication failures

**Implementation Pattern** (from existing codebase):
1. Store `GOOGLE_REFRESH_TOKEN` in environment variables
2. On API call, check if access token is expired
3. If expired, use refresh token to get new access token
4. Cache access token until expiration
5. Retry API call with new token

## Summary

**Key Decisions:**
1. Extract Google Meet links from `conferenceData.entryPoints[0].uri` (primary) and `hangoutLink` (fallback)
2. Extract client emails from `attendees[]` array, excluding organizer and internal emails
3. Use `start.timeZone` for timezone, with fallbacks to `dateTime` offset and calendar timezone
4. Filter events: must have `dateTime`, Google Meet link, and non-organizer attendees
5. Use `googleapis` npm package for API integration
6. Implement automatic token refresh using refresh token flow

**All research questions resolved. Ready for Phase 1 design.**

