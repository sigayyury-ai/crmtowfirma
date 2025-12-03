# Phase 0 Research – Marketing Analytics: MQL Data Sources

## Objective
Validate how to pull MQL-tagged leads from SendPulse Instagram bots before planning implementation tasks. Capture real payload structure for later data modeling and dedup logic.

## Findings

### 1. Authentication & Bot Enumeration
- Reused existing `.env` creds (`SENDPULSE_ID`, `SENDPULSE_SECRET`) via `SendPulseClient` (OAuth2 client_credentials).
- Listing bots works with `GET https://api.sendpulse.com/chatbots/bots` and confirms Instagram bot `id = 65ec7b3f08090e12cd01a7ca`.

### 2. Audience Retrieval by Tag
- Correct endpoint for Instagram bot audience filtered by tag:  
  `GET https://api.sendpulse.com/instagram/contacts/getByTag?tag=<TAG>&bot_id=<BOT_ID>`
- Requires Bearer token from OAuth step. `%20` in example indicates space; actual tag is `Mql` (case-sensitive, first letter uppercase in current data).  
- Returns JSON array of contacts; observed fields per entry:
  - `bot_id`, `status`, `type`, `tags[]`, `is_chat_opened`, `last_activity_at`, `automation_paused_until`, `created_at`, `id`
  - `channel_data`: nested object with Instagram identifiers (numeric `id`, `user_name`, `name`, `first_name`, `last_name`, `profile_pic`, `follower_count`, follow relationships flags)
  - `variables`: key/value bag (currently empty for sampled contacts)
  - `operator`, `referral_source`, `referral_data`
- Sample response stored at `agent-tools/9027ea34-8b59-4d89-9183-d6f90071ebd4.txt` (~34 KB) for offline reference.

### 3. Tag Semantics
- Contacts often contain multiple tags (`Mql`, `Customer`, `Norway`, etc.).  
- `created_at` aligns with first subscription date; will use as proxy for "month of MQL tag" unless SendPulse exposes explicit tag timestamp (not yet observed—needs confirmation or alternative field).

### 4. Prototype Scripts (Phase 1)
- `node scripts/prototypes/mql/fetchSendpulseMqls.js` hits `/instagram/contacts/getByTag` with pagination and saves raw payload to `tmp/sendpulse-mql-sample.json` (count + contact array).
- `node scripts/prototypes/mql/fetchPipedriveMqlDeals.js` retrieves Pipedrive deals, filters `label === 'MQL'`, and stores summarized data to `tmp/pipedrive-mql-sample.json`.
- Discovery log maintained in `docs/analytics/mql-discovery.md` with field mappings and observations for both sources.

### Outstanding Questions / Next Steps
1. **Tag Timestamp**: Need to confirm if SendPulse exposes when a tag was added; otherwise we must persist first-seen month ourselves after ingestion.
2. **Pagination**: Endpoint likely paginated (current response shows ~50 records); need to inspect headers or query params (`offset`, `limit`).
3. **Pipedrive Cross-Link**: Determine if `channel_data.user_name` or other identifiers map to Pipedrive persons (email missing). Might require manual enrichment workflow.
4. **Prototype Task**: Build quick script or spreadsheet to bucket `created_at` by month and count `Mql` entries to validate volumes before coding final pipeline.

## Decisions
- Use `/instagram/contacts/getByTag` for initial MQL feed; store raw response for dedup pipeline.
- Documented field schema ensures future data model includes `channel_data` sub-structure and multiple tags per contact.
