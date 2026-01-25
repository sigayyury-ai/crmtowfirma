# Feature Specification: Manual Cash Expenses for PNL Report

**Feature Branch**: `019-manual-cash-expenses`  
**Created**: 2025-01-27  
**Status**: Draft  
**Input**: User description: "хочу чтобы туда можно было добавить расход п нажати на плюсик в каждом  месяце и у тебя вызывается модалка с суммой и комментарием и так туда можно добавлять много расходов каждый раз нажима  на плюс и все расходы там суммируются и учавствуют потом эта категория в общем флоу для расходов"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add Manual Cash Expense Entry (Priority: P1)

As a business owner or financial manager, I want to add manual cash expenses to expense categories in the PNL report by clicking a plus icon in each month cell, so that I can track cash expenses that don't have receipts or bank records.

**Why this priority**: This is the core functionality - adding manual cash expenses is the primary purpose of this feature. Without this, the feature has no value.

**Independent Test**: Can be fully tested by navigating to the PNL report, finding an expense category with manual management type, clicking the plus icon in a month cell, entering amount and comment in the modal, and verifying the expense is saved and displayed.

**Acceptance Scenarios**:

1. **Given** I am viewing the PNL report for a selected year, **When** I locate an expense category row with manual management type, **Then** I see a plus icon (+) in each month cell
2. **Given** I am viewing a month cell with a plus icon, **When** I click the plus icon, **Then** a modal dialog appears with fields for amount and comment
3. **Given** the expense entry modal is open, **When** I enter a valid amount and optional comment, **Then** I can save the expense entry
4. **Given** I have saved an expense entry, **When** I view the same month cell, **Then** the total amount of all expenses for that category/month is displayed
5. **Given** I have added multiple expense entries for the same category/month, **When** I view the month cell, **Then** all entries are summed and displayed as a single total amount
6. **Given** I have accidentally added an expense entry with incorrect amount or comment, **When** I realize the mistake, **Then** I can immediately delete the incorrect entry to correct the error
7. **Given** I have just created an expense entry, **When** I notice it was entered incorrectly, **Then** I can delete it from the list of entries without affecting other entries

---

### User Story 2 - View and Manage Multiple Expense Entries (Priority: P2)

As a user, I want to view all individual expense entries for a category/month and optionally edit or delete them, so that I can maintain accurate records and correct mistakes.

**Why this priority**: While less critical than adding entries, viewing and managing existing entries is essential for practical use and data accuracy.

**Independent Test**: Can be tested independently by adding multiple expense entries, clicking on the month cell (or a view details button), and verifying that all entries are listed with their amounts and comments, and that editing/deleting works correctly.

**Acceptance Scenarios**:

1. **Given** I have added multiple expense entries for a category/month, **When** I click on the month cell (or a details button), **Then** I see a list of all individual expense entries with their amounts and comments
2. **Given** I am viewing the list of expense entries, **When** I click edit on an entry, **Then** I can modify the amount and comment
3. **Given** I am viewing the list of expense entries, **When** I click delete on an entry, **Then** the entry is removed and the total is recalculated immediately
4. **Given** I have edited an expense entry, **When** I save the changes, **Then** the updated amount and comment are reflected in the list and the total is recalculated
5. **Given** I have added an expense entry by mistake (wrong amount, wrong category, or duplicate), **When** I view the list of entries, **Then** I can identify and delete the incorrect entry to fix the error
6. **Given** I am deleting an expense entry, **When** I confirm the deletion, **Then** the entry is permanently removed from the database and all totals are updated
7. **Given** I have deleted an expense entry, **When** I view the category/month cell, **Then** the total reflects the deletion and shows the correct sum of remaining entries

---

### User Story 3 - Expense Totals Participate in PNL Calculations (Priority: P1)

As a user, I want manual cash expenses to be included in the overall expense totals and PNL calculations, so that the report accurately reflects all business expenses.

**Why this priority**: This is critical for the feature's value - expenses must participate in the general flow to be useful for financial reporting.

**Independent Test**: Can be tested independently by adding manual cash expenses, verifying they appear in category totals, expense section totals, and affect profit/loss calculations correctly.

**Acceptance Scenarios**:

1. **Given** I have added manual cash expenses to a category, **When** I view the category row total, **Then** the manual expenses are included in the total
2. **Given** I have added manual cash expenses, **When** I view the "Расходы" (Expenses) header row, **Then** the manual expenses are included in the total expenses for each month
3. **Given** I have added manual cash expenses, **When** I view the profit/loss calculations, **Then** the manual expenses are correctly subtracted from revenue to calculate profit/loss
4. **Given** I have expenses across multiple categories (some manual, some auto), **When** I view the report, **Then** all expenses are aggregated correctly regardless of their source

---

### Edge Cases

- What happens when a user tries to add an expense with a negative amount or zero amount?
- How does the system handle very large expense amounts (e.g., millions)?
- What happens if a user tries to add an expense entry while another user is simultaneously adding an entry for the same category/month?
- How are expense entries displayed if there are many entries (e.g., 50+ entries) for a single category/month?
- What happens when a user deletes the last expense entry for a category/month - does the cell show zero or "—"?
- How does the system handle expense entries when switching between years in the report?
- What happens if a user adds an expense entry but then changes the category's management type from manual to auto?
- What happens if a user tries to delete an expense entry that was just created seconds ago (immediate error correction)?
- How does the system handle deletion if a user accidentally clicks delete but meant to click edit?
- What happens if a user deletes an expense entry while another user is viewing the same report?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a plus icon (+) in each month cell for expense categories with `management_type = 'manual'`
- **FR-002**: System MUST open a modal dialog when the plus icon is clicked, containing fields for amount (required) and comment (optional)
- **FR-003**: System MUST allow users to add multiple expense entries for the same expense category and month combination
- **FR-004**: System MUST save each expense entry as a separate record in the database with amount, comment, category, year, and month
- **FR-005**: System MUST display the sum of all expense entries for a category/month as the total amount in the month cell
- **FR-006**: System MUST include manual cash expenses in the category total calculation
- **FR-007**: System MUST include manual cash expenses in the overall "Расходы" (Expenses) section total
- **FR-008**: System MUST include manual cash expenses in profit/loss calculations (revenue minus expenses)
- **FR-009**: System MUST validate that expense amounts are positive numbers (greater than zero)
- **FR-010**: System MUST allow users to view a list of all individual expense entries for a category/month
- **FR-011**: System MUST allow users to edit existing expense entries (amount and comment)
- **FR-012**: System MUST allow users to delete individual expense entries at any time, including immediately after creation if an error was made
- **FR-013**: System MUST provide a clear and accessible delete action for each expense entry in the list view
- **FR-014**: System MUST require user confirmation before permanently deleting an expense entry to prevent accidental deletions
- **FR-015**: System MUST recalculate totals immediately after adding, editing, or deleting an expense entry
- **FR-016**: System MUST persist expense entries in the database with proper relationships to expense categories
- **FR-017**: System MUST display expense entries only for the currently selected year in the report
- **FR-018**: System MUST handle the case where a category/month has no expense entries (display zero or "—")
- **FR-019**: System MUST allow deletion of expense entries even if they were just created (to correct input errors)
- **FR-020**: System MUST permanently remove deleted expense entries from the database (no soft delete or archive)

### Key Entities *(include if feature involves data)*

- **Manual Cash Expense Entry**: Represents a single manual cash expense record containing:
  - Unique identifier
  - Expense category reference (links to `pnl_expense_categories`)
  - Year (2020-2030)
  - Month (1-12)
  - Amount in PLN (positive number)
  - Comment/notes (optional text description)
  - Timestamps (created_at, updated_at)
- **Expense Category**: Existing entity from `pnl_expense_categories` table with `management_type` field that determines if manual entries are allowed
- **Monthly Expense Total**: Aggregated sum of all expense entries (both manual and automatic) for a specific category and month
- **Category Expense Total**: Aggregated sum of all expense entries for a category across all months in the selected year

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can add a manual cash expense entry in under 30 seconds from clicking the plus icon to seeing the entry saved and total updated
- **SC-002**: System correctly sums multiple expense entries for the same category/month with 100% accuracy (verified by manual calculation)
- **SC-003**: Manual cash expenses are included in all expense totals and PNL calculations with 100% accuracy
- **SC-004**: Users can add at least 100 expense entries per category/month without performance degradation (page remains responsive)
- **SC-005**: Expense entry modal opens and closes within 200 milliseconds of user interaction
- **SC-006**: Total amounts update immediately (within 1 second) after adding, editing, or deleting an expense entry
- **SC-007**: All expense entries persist correctly when switching between years and returning to the original year
- **SC-008**: System handles concurrent expense entry additions without data loss or corruption
- **SC-009**: Users can delete an expense entry within 5 seconds of identifying it as incorrect (from viewing list to confirmation)
- **SC-010**: Deleted expense entries are permanently removed and do not appear in any reports or calculations

## Assumptions

- Expense categories with `management_type = 'manual'` are the only categories that support manual cash expense entries
- Manual cash expenses are always entered in PLN (no currency conversion needed)
- Users understand that manual cash expenses are for expenses without receipts or bank records
- The plus icon will be clearly visible and intuitive to users
- Expense entries can be added at any time, not just during the month they occurred (allowing retroactive entry)
- The comment field is optional but recommended for tracking purposes
- Multiple expense entries for the same category/month are common and expected usage pattern
- Expense entries are not linked to payments or bank transactions (they are separate manual records)
- The existing `pnl_manual_entries` table structure can be extended or a new table created to support multiple entries per category/month
- The UI will need to distinguish between viewing/editing a single total (current behavior) and viewing multiple entries (new behavior)

## Dependencies

- Existing PNL report system and expense categories infrastructure
- Existing `pnl_expense_categories` table with `management_type` field
- Existing `pnl_manual_entries` table (may need modification to support multiple entries)
- Frontend PNL report page and JavaScript functionality
- Backend API endpoints for expense category management
- Database migration capability to modify table constraints if needed

## Out of Scope

- Automatic categorization of manual cash expenses
- Import/export of expense entries (CSV, Excel)
- Receipt attachment or image upload for expense entries
- Approval workflow for expense entries
- Integration with accounting systems or external expense tracking tools
- Currency conversion for manual cash expenses (all entries are in PLN)
- Recurring expense templates or scheduled expenses
- Expense entry history/audit trail beyond basic timestamps
- Mobile app support (web interface only)
- Bulk operations (adding multiple entries at once via CSV upload)
