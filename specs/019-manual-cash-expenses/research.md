# Research: Manual Cash Expenses for PNL Report

**Feature**: 019-manual-cash-expenses  
**Date**: 2025-01-27  
**Purpose**: Document technical decisions and research findings for implementing multiple manual expense entries

## Database Schema Changes

### Decision: Remove Unique Constraint for Expense Entries

**Rationale**: 
- Current implementation has unique indexes that prevent multiple entries per category/month:
  - `pnl_manual_entries_revenue_unique` on `(category_id, year, month)` WHERE `entry_type = 'revenue'`
  - `pnl_manual_entries_expense_unique` on `(expense_category_id, year, month)` WHERE `entry_type = 'expense'`
- Feature requirement: Allow multiple expense entries per category/month
- Revenue entries should maintain uniqueness (one entry per category/month) to preserve existing behavior

**Alternatives Considered**:
1. **Keep unique constraint, use JSON array in notes field**: Rejected - violates normalization, harder to query/filter
2. **Create separate table for multiple entries**: Rejected - unnecessary complexity, same table structure works
3. **Remove constraint for both revenue and expense**: Rejected - would break existing revenue entry behavior

**Implementation**: 
- Drop `pnl_manual_entries_expense_unique` index
- Keep `pnl_manual_entries_revenue_unique` index unchanged
- Add non-unique index on `(expense_category_id, year, month)` for query performance

## Backend Service Changes

### Decision: Extend ManualEntryService with New Methods

**Rationale**:
- Current `upsertEntry()` method checks for existing entry and updates it, preventing multiple entries
- Need methods to:
  - Create new entry without checking for existing (always insert)
  - Get all entries for category/month (not just one)
  - Delete entry by ID (not just by category/year/month)

**Alternatives Considered**:
1. **Create separate service**: Rejected - would duplicate code, ManualEntryService already handles expense entries
2. **Modify upsertEntry to always insert**: Rejected - would break revenue entry behavior
3. **Add new methods alongside existing**: Accepted - preserves backward compatibility

**Implementation**:
- Add `createEntry()` - always inserts new entry (no upsert logic)
- Add `getEntriesByCategoryMonth()` - returns array of all entries for category/month
- Add `deleteEntryById()` - deletes by entry ID
- Keep existing `upsertEntry()` for revenue entries (backward compatibility)

## API Design

### Decision: RESTful Endpoints with Entry ID Support

**Rationale**:
- Current API uses category/year/month for identification (works for single entry)
- Need entry ID for individual entry operations (delete, edit)
- RESTful design: `/api/pnl/manual-entries/:id` for individual entry operations

**Alternatives Considered**:
1. **Query parameters only**: Rejected - awkward for DELETE operations, less RESTful
2. **Separate endpoint for multiple entries**: Rejected - adds complexity, same resource
3. **ID-based endpoints with category/year/month fallback**: Accepted - supports both use cases

**Implementation**:
- `POST /api/pnl/manual-entries` - Create new entry (always creates, no upsert for expenses)
- `GET /api/pnl/manual-entries?expenseCategoryId=X&year=Y&month=Z&entryType=expense` - Get all entries for category/month
- `GET /api/pnl/manual-entries/:id` - Get single entry by ID
- `PUT /api/pnl/manual-entries/:id` - Update entry by ID
- `DELETE /api/pnl/manual-entries/:id` - Delete entry by ID
- Keep existing query-param-based DELETE for backward compatibility

## Frontend UI/UX

### Decision: Plus Icon + Modal Dialog Pattern

**Rationale**:
- Current implementation: Click cell → inline edit → save (single value)
- New requirement: Multiple entries per cell → need list view + add action
- Plus icon is standard pattern for "add new item"
- Modal dialog provides focused input experience

**Alternatives Considered**:
1. **Inline form in cell**: Rejected - too cramped, poor UX for multiple entries
2. **Separate page**: Rejected - breaks workflow, too much navigation
3. **Modal dialog**: Accepted - focused, non-disruptive, standard pattern
4. **Dropdown menu**: Rejected - less discoverable, more clicks

**Implementation**:
- Plus icon (+) in top-right corner of month cell (for manual expense categories only)
- Click plus → modal opens with amount and comment fields
- After save → modal closes, cell shows updated total
- Click cell (not plus) → list view modal showing all entries with edit/delete actions

### Decision: List View in Modal

**Rationale**:
- Need to show all entries for category/month
- Need edit/delete actions per entry
- Modal provides consistent UI pattern

**Alternatives Considered**:
1. **Separate page**: Rejected - breaks workflow
2. **Expandable cell**: Rejected - table layout constraints, poor mobile UX
3. **Modal with list**: Accepted - consistent with add modal, good UX

**Implementation**:
- Click month cell → modal opens showing list of entries
- Each entry shows: amount, comment, created date
- Actions: Edit (opens edit modal), Delete (with confirmation)
- "Add New" button in list modal

## Data Aggregation

### Decision: Sum All Entries for Display

**Rationale**:
- Feature requirement: "all expenses there summed and displayed"
- Current aggregation logic already handles manual entries
- Need to sum multiple entries instead of single entry

**Alternatives Considered**:
1. **Show count badge**: Rejected - doesn't meet requirement, need sum
2. **Show individual entries in cell**: Rejected - too much information, breaks table layout
3. **Sum all entries**: Accepted - meets requirement, clean display

**Implementation**:
- Update `pnlReportService.js` aggregation logic
- Query all entries for category/month (not just one)
- Sum `amount_pln` values
- Display sum in month cell

## Error Handling

### Decision: Client-Side Validation + Server-Side Validation

**Rationale**:
- Fast feedback for user (client-side)
- Security and data integrity (server-side)
- Consistent error messages

**Implementation**:
- Client: Validate amount > 0, year/month ranges before API call
- Server: Re-validate all inputs, check category exists and is manual type
- Return user-friendly error messages
- Log errors for debugging

## Performance Considerations

### Decision: Lazy Load Entry Lists

**Rationale**:
- Success criteria: Support 100+ entries per category/month
- Don't load all entries until user clicks cell
- Load entries on-demand when modal opens

**Alternatives Considered**:
1. **Load all entries on page load**: Rejected - unnecessary data transfer, slower initial load
2. **Lazy load on cell click**: Accepted - only load when needed

**Implementation**:
- Load entry list when user clicks month cell
- Cache loaded entries for current session
- Refresh cache after create/update/delete operations

## Migration Strategy

### Decision: Safe Migration with Backward Compatibility

**Rationale**:
- Existing revenue entries must continue working
- Existing expense entries (if any) should be preserved
- Migration should be reversible

**Implementation**:
- Drop unique index for expenses only
- Keep unique index for revenue entries
- Migration script checks for existing data
- No data loss - only constraint removal

## Testing Strategy

### Decision: Integration Tests + Manual Testing

**Rationale**:
- Test database operations (create, read, update, delete)
- Test API endpoints
- Test frontend interactions
- Manual testing for UX validation

**Implementation**:
- Unit tests for ManualEntryService methods
- Integration tests for API endpoints
- Manual testing checklist for UI flows
- Test with 100+ entries for performance validation


