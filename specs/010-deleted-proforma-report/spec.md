# Deleted Proforma Report

## Overview
- Finance and accounting teams need visibility into all proformas that were deleted from CRM/wFirma to ensure tax filings and revenue reports remain accurate.
- Currently, once a proforma is removed, there is no consolidated place to review what was deleted, for which client, and for what amount.
- Provide a dedicated reporting section that lists deleted proformas with key financial attributes so the team can validate adjustments and keep an audit trail.

## User Scenarios & Testing
1. **Finance analyst reviews recent deletions**
   - The analyst opens the new "Удалённые проформы" section for the current month.
   - The system shows a table with each deleted proforma: number, buyer name, total amount with currency, original issue month, deletion date, and deletion status/reason.
   - The analyst exports or notes the entries to reconcile tax adjustments.
2. **Accountant filters by date range**
   - Accountant selects a custom date range (e.g., previous quarter).
   - Report updates to show only proformas deleted within that period.
   - Totals (count and sum) update accordingly for review.
3. **Auditor drills into a single entry**
   - Auditor clicks a proforma row to view detailed metadata (deal id, who deleted, optional comment if captured).
   - Auditor confirms the deletion was intentional and cross-checks with source documents.
4. **Finance lead monitors monthly impact**
   - Lead views a summary panel showing number of deleted proformas and aggregate deleted revenue per month.
   - Uses this information to plan corrective journal entries.

## Functional Requirements
1. **Data source integration**
   - Pull deleted proforma records from `proforma_deletion_logs`, joined with historical proforma metadata (number, buyer, totals, currency, issue date/month).
   - Ensure the log captures buyer name, amount, currency, original issue date, deletion timestamp, deal id, and status codes; backfill missing fields where necessary.
2. **Reporting UI / section**
   - Add a new navigation item (e.g., in the VAT margin/finance area) labeled "Удалённые проформы".
   - Display tabular list with the following columns: proforma number, buyer name, amount + currency, original issue month, deletion date/time, deletion status (success, wFirma error, etc.).
   - Provide default sort by deletion date descending.
   - Show aggregated payments received for each proforma (amount + currency) to highlight potential refunds.
3. **Filtering and date controls**
   - Include controls to filter by deletion date range (shortcuts: current month, last month, custom start/end).
   - Include optional filter by buyer name (search string) and by deletion status.
4. **Summary metrics**
   - Show totals above the table: total deleted proformas in the selected range, aggregate amount by currency, aggregate payments received (per currency) and count of deletion failures (if any).
5. **Detail view**
   - Allow users to expand/click a row to see extended metadata: deal id/link, expected invoice numbers, deletion message, audit metadata (user if tracked).
6. **Data retention and accuracy**
   - Ensure deletion logs are retained indefinitely (or at least 7 years) for audit.
   - When a deletion attempt fails (e.g., wFirma error), the entry remains but is marked with status and does not affect revenue totals.
7. **Export support**
   - Provide export to CSV for the currently filtered dataset, preserving key columns for offline analysis.
8. **Authorization**
   - Restrict access to finance/operations roles (reuse existing auth model for reports).
9. **Performance**
   - Report must load within 3 seconds for typical dataset (up to 5k deletions); implement paging (e.g., 50 rows per page) with ability to navigate.

## Success Criteria
- Users can list deleted proformas for any month within 3 seconds (dataset ≤5k rows).
- Report displays required columns (number, buyer, amount, currency, issue month, deletion date, status) with ≥99% completeness for new deletions.
- Finance team can export filtered results to CSV and reconcile with accounting adjustments (validated via pilot feedback).
- Summary metrics accurately reflect counts and totals with <1% discrepancy compared to raw deletion log queries.

## Assumptions
- `proforma_deletion_logs` table exists and will be enhanced to capture buyer, amount, issue date if missing.
- Buyer name and amount can be derived from historical proforma records at deletion time; if unavailable, show "Неизвестно" but still list entry.
- Only finance/operations personnel require access; existing auth roles cover these users.
- UI will reuse existing design system components for tables, filters, and exports.

## Key Entities
- **ProformaDeletionLog**: { id, proforma_id, deal_id, status, deletion_timestamp, metadata (numbers, buyer, amounts) }
- **Proforma (historical snapshot)**: { id, fullnumber, buyer_name, currency, total, issued_at }
- **User (Finance/Operations)**: consumes the report.

## Out of Scope
- Restoring deleted proformas or undo capability.
- Automated notifications or alerts about deletions (future enhancement).
- Changes to deletion workflow itself (only reporting/audit is covered).
