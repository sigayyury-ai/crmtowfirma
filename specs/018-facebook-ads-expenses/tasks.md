# Development Tasks: Facebook Ads Expenses Integration

**Feature**: `018-facebook-ads-expenses` | **Date**: 2025-01-XX  
**Priority Order**: P1 (Database & Import) → P2 (Mapping & UI) → P3 (Integration & Polish)

---

## Phase 1: Database Schema & Core Models (Foundation)

### Task 1.1: Database Migration - Facebook Ads Tables
**Priority**: P1 | **Estimate**: 3 hours | **Dependencies**: None

**Description**: Create database tables for Facebook Ads expenses, campaign mappings, and import batches.

**Requirements**:
- Create migration script `scripts/migrations/020_create_facebook_ads_tables.sql`
- Tables to create:
  - `facebook_ads_campaign_mappings` - маппинг кампаний на продукты
  - `facebook_ads_expenses` - накопительные расходы по кампаниям
  - `facebook_ads_import_batches` - история импортов
- Foreign key constraints to `products` table
- Indexes for performance (campaign_name_normalized, product_id, dates)
- Unique constraints to prevent duplicates

**Acceptance Criteria**:
- Migration can be applied without errors
- All tables exist with correct schema
- Foreign keys work correctly
- Indexes are created

**Files**:
- `scripts/migrations/020_create_facebook_ads_tables.sql`

---

### Task 1.2: Core Service Structure
**Priority**: P1 | **Estimate**: 2 hours | **Dependencies**: Task 1.1

**Description**: Create basic service structure for Facebook Ads functionality.

**Requirements**:
- Create directory `src/services/facebookAds/`
- Create base service files:
  - `facebookAdsMappingService.js` - управление маппингами
  - `facebookAdsExpenseService.js` - работа с расходами
  - `facebookAdsImportService.js` - импорт CSV (структура)
- Basic Supabase client integration
- Error handling structure

**Acceptance Criteria**:
- Services can be imported without errors
- Basic structure ready for implementation

**Files**:
- `src/services/facebookAds/facebookAdsMappingService.js`
- `src/services/facebookAds/facebookAdsExpenseService.js`
- `src/services/facebookAds/facebookAdsImportService.js`

---

## Phase 2: CSV Parser

### Task 2.1: CSV Parser Implementation
**Priority**: P1 | **Estimate**: 6 hours | **Dependencies**: None

**Description**: Create parser for Facebook Ads CSV reports with format validation.

**Requirements**:
- Create `src/services/facebookAds/facebookAdsCsvParser.js`
- Parse CSV with columns:
  - "Название кампании" (может быть в кавычках)
  - Валюта
  - "Сумма затрат (PLN)"
  - "Дата начала отчетности" (YYYY-MM-DD)
  - "Дата окончания отчетности" (YYYY-MM-DD)
- Handle quoted fields and empty values
- Normalize campaign names (lowercase, trim, remove special chars)
- Validate dates format
- Validate amounts (positive numbers)
- Return structured data array

**Acceptance Criteria**:
- Parser correctly extracts all required fields
- Handles edge cases (quotes, empty values, duplicates)
- Returns normalized data structure
- Unit tests pass

**Files**:
- `src/services/facebookAds/facebookAdsCsvParser.js`
- `tests/unit/facebookAdsCsvParser.test.js`

---

### Task 2.2: CSV Parser Error Handling
**Priority**: P1 | **Estimate**: 2 hours | **Dependencies**: Task 2.1

**Description**: Add comprehensive error handling and validation to CSV parser.

**Requirements**:
- Validate CSV format (check header row)
- Validate required columns presence
- Validate data types (dates, numbers)
- Collect and return errors per row
- Continue parsing on non-critical errors
- Return detailed error messages

**Acceptance Criteria**:
- Errors are collected and reported clearly
- Parser continues on recoverable errors
- Error messages are user-friendly

**Files**:
- `src/services/facebookAds/facebookAdsCsvParser.js`

---

## Phase 3: Mapping Service

### Task 3.1: Campaign Mapping Service - CRUD Operations
**Priority**: P1 | **Estimate**: 4 hours | **Dependencies**: Task 1.1

**Description**: Create service for managing campaign-to-product mappings.

**Requirements**:
- Implement `FacebookAdsMappingService` with methods:
  - `createMapping(campaignName, productId, userId)` - создать маппинг
  - `updateMapping(mappingId, productId)` - обновить маппинг
  - `deleteMapping(mappingId)` - удалить маппинг
  - `getMappingByCampaign(campaignName)` - найти маппинг по названию
  - `getMappingsByProduct(productId)` - получить все маппинги продукта
  - `getAllMappings()` - получить все маппинги
- Normalize campaign names before lookup
- Validate product exists and is active
- Prevent duplicate mappings (same campaign + product)

**Acceptance Criteria**:
- All CRUD operations work correctly
- Normalization works consistently
- Validation prevents invalid operations
- Unit tests pass

**Files**:
- `src/services/facebookAds/facebookAdsMappingService.js`

---

### Task 3.2: Auto-Mapping Suggestions
**Priority**: P2 | **Estimate**: 3 hours | **Dependencies**: Task 3.1

**Description**: Implement automatic mapping suggestions based on normalized campaign names.

**Requirements**:
- Compare normalized campaign name with normalized product names
- Find products with matching substrings
- Suggest products based on similarity
- Return suggestions sorted by relevance
- Handle prefixes ("Camp /", "Event /", "Coliving /")

**Acceptance Criteria**:
- Suggestions are relevant and helpful
- Handles common naming patterns
- Performance is acceptable (< 100ms)

**Files**:
- `src/services/facebookAds/facebookAdsMappingService.js`

---

### Task 3.3: Mapping API Endpoints
**Priority**: P1 | **Estimate**: 3 hours | **Dependencies**: Task 3.1

**Description**: Create REST API endpoints for mapping operations.

**Requirements**:
- `GET /api/facebook-ads/mappings` - список всех маппингов
- `GET /api/facebook-ads/mappings/unmapped` - неразмеченные кампании
- `POST /api/facebook-ads/mappings` - создать маппинг
  - Body: `{ campaign_name: string, product_id: number }`
- `PUT /api/facebook-ads/mappings/:id` - обновить маппинг
- `DELETE /api/facebook-ads/mappings/:id` - удалить маппинг
- Input validation
- Error handling

**Acceptance Criteria**:
- Endpoints respond correctly to valid requests
- Proper HTTP status codes
- Error responses are clear
- API documentation updated

**Files**:
- `src/routes/api.js` - добавить эндпоинты

---

## Phase 4: Import Service

### Task 4.1: Import Service - Core Logic
**Priority**: P1 | **Estimate**: 6 hours | **Dependencies**: Task 2.1, Task 3.1

**Description**: Create service for importing CSV files and processing expenses.

**Requirements**:
- Implement `FacebookAdsImportService` with method `importCsv(csvContent, userId)`
- Parse CSV using parser from Phase 2
- For each row:
  - Normalize campaign name
  - Find existing mapping
  - Check for existing expense record (campaign + period)
  - Create or update expense record
  - Link to product if mapping exists
- Create import batch record
- Return import statistics

**Acceptance Criteria**:
- CSV is parsed correctly
- Expenses are created/updated
- Mappings are applied
- Statistics are accurate

**Files**:
- `src/services/facebookAds/facebookAdsImportService.js`

---

### Task 4.2: Duplicate Prevention & Update Logic
**Priority**: P1 | **Estimate**: 3 hours | **Dependencies**: Task 4.1

**Description**: Implement logic to prevent duplicates and update existing records.

**Requirements**:
- Check for existing expense by: `campaign_name_normalized + report_start_date + report_end_date`
- If exists: update `amount_pln` and `updated_at`
- If not exists: create new record
- Use file hash to prevent re-importing identical files
- Track import batch for audit

**Acceptance Criteria**:
- Duplicates are prevented
- Existing records are updated correctly
- File hash prevents re-imports
- Import batch is tracked

**Files**:
- `src/services/facebookAds/facebookAdsImportService.js`

---

### Task 4.3: Campaign Status Detection
**Priority**: P2 | **Estimate**: 2 hours | **Dependencies**: Task 4.1

**Description**: Detect stopped campaigns (when expenses don't change between imports).

**Requirements**:
- Compare current amount with previous import amount
- If amount unchanged: set `is_campaign_active = false`
- If amount increased: set `is_campaign_active = true`
- Update status in expense records

**Acceptance Criteria**:
- Stopped campaigns are detected correctly
- Status is updated appropriately

**Files**:
- `src/services/facebookAds/facebookAdsImportService.js`

---

### Task 4.4: Import API Endpoint
**Priority**: P1 | **Estimate**: 2 hours | **Dependencies**: Task 4.1

**Description**: Create API endpoint for CSV import.

**Requirements**:
- `POST /api/facebook-ads/import` - импорт CSV файла
  - Body: FormData with file
  - Response: `{ success: boolean, data: { processed, mapped, unmapped, errors } }`
- File upload handling
- Progress tracking (optional)
- Error collection and reporting

**Acceptance Criteria**:
- File upload works correctly
- Import processes successfully
- Results are returned accurately
- Errors are reported clearly

**Files**:
- `src/routes/api.js` - добавить эндпоинт

---

## Phase 5: Integration with Product Reports

### Task 5.1: Load Facebook Ads Expenses in Product Report
**Priority**: P1 | **Estimate**: 3 hours | **Dependencies**: Task 4.1

**Description**: Integrate Facebook Ads expenses into product report service.

**Requirements**:
- Modify `ProductReportService.loadLinkedPayments()` or create new method
- Query `facebook_ads_expenses` by `product_id`
- Format expenses similar to bank payments
- Include campaign name, period, amount
- Add to `linkedPayments.outgoing` array

**Acceptance Criteria**:
- Expenses are loaded for products with mappings
- Format matches existing payment structure
- Appears in "Связанные платежи" section

**Files**:
- `src/services/vatMargin/productReportService.js`

---

### Task 5.2: Display Facebook Ads in Product Report UI
**Priority**: P1 | **Estimate**: 2 hours | **Dependencies**: Task 5.1

**Description**: Update frontend to display Facebook Ads expenses in product report.

**Requirements**:
- Expenses appear in "Связанные платежи" section
- Display campaign name, period, amount
- Mark source as "Facebook Ads" or similar
- Include in expense totals calculation

**Acceptance Criteria**:
- Expenses are displayed correctly
- Source is clearly indicated
- Totals include Facebook Ads expenses

**Files**:
- `frontend/vat-margin-product.js`

---

### Task 5.3: Exclude from PNL Report
**Priority**: P1 | **Estimate**: 2 hours | **Dependencies**: Task 4.1

**Description**: Ensure Facebook Ads expenses are excluded from PNL report.

**Requirements**:
- If expenses are created in `payments` table, set `source='facebook_ads'`
- Update PNL report service to filter: `WHERE source != 'facebook_ads'`
- Verify expenses don't appear in PNL calculations

**Acceptance Criteria**:
- Facebook Ads expenses don't appear in PNL
- Real bank expenses still appear in PNL
- Filter works correctly

**Files**:
- `src/services/pnl/pnlReportService.js` (если нужно)
- `src/services/facebookAds/facebookAdsImportService.js`

---

## Phase 6: Frontend - Import Interface

### Task 6.1: Add Facebook Ads Subtab to Payments Tab
**Priority**: P1 | **Estimate**: 2 hours | **Dependencies**: None

**Description**: Add new subtab "📊 Facebook Ads" to payments section in vat-margin.html.

**Requirements**:
- Add button in `payments-subnav`: `<button class="subtab-button" data-payments-tab="facebook-ads">📊 Facebook Ads</button>`
- Add section: `<section class="payments-section payments-subtab-content" id="payments-facebook-ads">`
- Update JavaScript to handle new subtab

**Acceptance Criteria**:
- Subtab appears in payments section
- Clicking subtab shows Facebook Ads content
- Navigation works correctly

**Files**:
- `frontend/vat-margin.html`
- `frontend/vat-margin-script.js`

---

### Task 6.2: Import CSV Interface
**Priority**: P1 | **Estimate**: 4 hours | **Dependencies**: Task 6.1, Task 4.4

**Description**: Create interface for CSV file upload and import.

**Requirements**:
- Drag & drop zone for CSV files
- File input button
- Display selected file name
- Import button (disabled until file selected)
- Progress bar during import
- Display import results:
  - Total processed rows
  - Mapped campaigns count
  - Unmapped campaigns count
  - Errors list
- Link to mapping interface for unmapped campaigns

**Acceptance Criteria**:
- File upload works
- Progress is shown
- Results are displayed clearly
- Errors are visible

**Files**:
- `frontend/vat-margin.html` - добавить контент в секцию `payments-facebook-ads`
- `frontend/facebook-ads-script.js` - логика импорта

---

### Task 6.3: Import History Display
**Priority**: P2 | **Estimate**: 2 hours | **Dependencies**: Task 6.2

**Description**: Display history of previous imports.

**Requirements**:
- List recent import batches
- Show: file name, date, statistics
- Click to view details
- Optional: ability to re-import or view errors

**Acceptance Criteria**:
- History is displayed
- Details are accessible
- UI is clear and organized

**Files**:
- `frontend/facebook-ads-script.js`

---

## Phase 7: Frontend - Mapping Management

### Task 7.1: Internal Tabs Structure
**Priority**: P1 | **Estimate**: 2 hours | **Dependencies**: Task 6.1

**Description**: Create internal tabs within Facebook Ads subtab.

**Requirements**:
- Three tabs: "Импорт CSV", "Маппинг кампаний", "Статистика"
- Tab navigation within `payments-facebook-ads` section
- Tab content switching

**Acceptance Criteria**:
- Tabs work correctly
- Navigation is smooth
- Active tab is highlighted

**Files**:
- `frontend/vat-margin.html`
- `frontend/facebook-ads-script.js`

---

### Task 7.2: Mapped Campaigns Table
**Priority**: P1 | **Estimate**: 4 hours | **Dependencies**: Task 7.1, Task 3.3

**Description**: Display table of all mapped campaigns.

**Requirements**:
- Table columns: Campaign Name, Product, Expenses, Actions
- Search/filter by campaign name or product
- Edit button (opens modal)
- Delete button (with confirmation)
- Pagination or "Show all" option
- Export to CSV option

**Acceptance Criteria**:
- Table displays all mappings
- Search works correctly
- Edit/delete operations work
- UI is responsive

**Files**:
- `frontend/vat-margin.html`
- `frontend/facebook-ads-script.js`

---

### Task 7.3: Unmapped Campaigns Table
**Priority**: P1 | **Estimate**: 4 hours | **Dependencies**: Task 7.1, Task 3.3

**Description**: Display table of campaigns without mappings.

**Requirements**:
- Table columns: Campaign Name, Expenses, Action
- Show total expenses for each unmapped campaign
- "Create Mapping" button for each row
- Bulk mapping option (optional)
- Search/filter functionality

**Acceptance Criteria**:
- Unmapped campaigns are listed
- Create mapping works
- UI is clear

**Files**:
- `frontend/vat-margin.html`
- `frontend/facebook-ads-script.js`

---

### Task 7.4: Create/Edit Mapping Modal
**Priority**: P1 | **Estimate**: 3 hours | **Dependencies**: Task 7.2, Task 7.3, Task 3.2

**Description**: Create modal dialog for creating or editing mappings.

**Requirements**:
- Display campaign name (read-only for edit)
- Product dropdown (with search)
- Show suggested products based on campaign name
- Save/Cancel buttons
- Validation (product must be selected)
- Success/error messages

**Acceptance Criteria**:
- Modal opens correctly
- Product selection works
- Suggestions are helpful
- Save operation works

**Files**:
- `frontend/vat-margin.html`
- `frontend/facebook-ads-script.js`

---

### Task 7.5: Statistics Tab
**Priority**: P2 | **Estimate**: 3 hours | **Dependencies**: Task 7.1

**Description**: Create statistics dashboard for Facebook Ads expenses.

**Requirements**:
- Summary cards:
  - Total campaigns count
  - Mapped campaigns count
  - Unmapped campaigns count
  - Total expenses amount
- Expenses by product table
- Optional: chart/graph of expenses over time
- Export statistics option

**Acceptance Criteria**:
- Statistics are accurate
- Display is clear
- Charts work (if implemented)

**Files**:
- `frontend/vat-margin.html`
- `frontend/facebook-ads-script.js`

---

## Phase 8: Testing & Documentation

### Task 8.1: Unit Tests - CSV Parser
**Priority**: P2 | **Estimate**: 3 hours | **Dependencies**: Task 2.1

**Description**: Write unit tests for CSV parser.

**Requirements**:
- Test valid CSV parsing
- Test edge cases (quotes, empty values, duplicates)
- Test normalization
- Test error handling
- Test date/amount validation

**Acceptance Criteria**:
- All tests pass
- Coverage > 80%

**Files**:
- `tests/unit/facebookAdsCsvParser.test.js`

---

### Task 8.2: Integration Tests - Import Flow
**Priority**: P2 | **Estimate**: 4 hours | **Dependencies**: Task 4.1

**Description**: Write integration tests for import flow.

**Requirements**:
- Test full import flow (CSV → parse → map → save)
- Test duplicate prevention
- Test mapping application
- Test error scenarios
- Test with real CSV format

**Acceptance Criteria**:
- Integration tests pass
- Real CSV files are processed correctly

**Files**:
- `tests/integration/facebookAdsImport.test.js`

---

### Task 8.3: Update API Documentation
**Priority**: P2 | **Estimate**: 2 hours | **Dependencies**: Task 3.3, Task 4.4

**Description**: Update API documentation with new endpoints.

**Requirements**:
- Document all Facebook Ads endpoints
- Include request/response examples
- Document error codes
- Update `docs/api-reference.md`

**Acceptance Criteria**:
- Documentation is complete
- Examples are clear
- All endpoints documented

**Files**:
- `docs/api-reference.md`

---

### Task 8.4: User Documentation
**Priority**: P3 | **Estimate**: 2 hours | **Dependencies**: All phases

**Description**: Create user guide for Facebook Ads expenses feature.

**Requirements**:
- How to export CSV from Facebook Ads
- How to import CSV
- How to create mappings
- How to view expenses in product reports
- Troubleshooting guide

**Acceptance Criteria**:
- Documentation is clear
- Covers all use cases
- Includes screenshots/examples

**Files**:
- `docs/facebook-ads-expenses-guide.md` (новый файл)

---

## Summary

**Total Tasks**: 28  
**Total Estimate**: 48-64 hours (6-8 рабочих дней)

**Priority Breakdown**:
- P1 (Critical): 18 tasks (~40 hours)
- P2 (Important): 8 tasks (~18 hours)
- P3 (Nice to have): 2 tasks (~4 hours)

**Dependencies**:
- Phase 1 must complete before Phase 2-5
- Phase 2 must complete before Phase 4
- Phase 3 must complete before Phase 4, 7
- Phase 4 must complete before Phase 5, 6
- Phase 5 must complete before Phase 8
- Phase 6, 7 can be done in parallel after Phase 4


