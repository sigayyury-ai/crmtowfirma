# Quick Start: Manual Cash Expenses for PNL Report

**Feature**: 019-manual-cash-expenses  
**Date**: 2025-01-27

## Overview

This guide provides a quick start for implementing multiple manual cash expense entries per category/month in the PNL report. Users can add expenses by clicking a plus icon, view/edit/delete entries in a list, and all entries are automatically summed in the report.

## Prerequisites

- Existing PNL report infrastructure (`pnl_expense_categories`, `pnl_manual_entries` table)
- Node.js 18+ with Express.js backend
- Supabase/PostgreSQL database access
- Frontend PNL report page (`frontend/pnl-report.html`)

## Implementation Steps

### 1. Database Migration

**File**: `scripts/migrations/019_allow_multiple_expense_entries.sql`

```sql
-- Remove unique constraint for expense entries (allows multiple entries per category/month)
DROP INDEX IF EXISTS pnl_manual_entries_expense_unique;

-- Add non-unique index for query performance
CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_expense_category_year_month 
    ON pnl_manual_entries(expense_category_id, year, month) 
    WHERE entry_type = 'expense';

-- Add index for year-level queries
CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_expense_category_year 
    ON pnl_manual_entries(expense_category_id, year) 
    WHERE entry_type = 'expense';
```

**Run**: Execute migration script against database

### 2. Backend Service Updates

**File**: `src/services/pnl/manualEntryService.js`

**Add Methods**:

```javascript
// Create new entry (always inserts, no upsert for expenses)
async createEntry(entryData) {
  // Validate inputs
  // Check category exists and is manual type
  // Insert new row (no check for existing)
  // Return created entry
}

// Get all entries for category/month
async getEntriesByCategoryMonth(expenseCategoryId, year, month, entryType = 'expense') {
  // Query all entries matching criteria
  // Return array of entries
}

// Get entry by ID
async getEntryById(id) {
  // Query by ID
  // Return entry or null
}

// Update entry by ID
async updateEntryById(id, updateData) {
  // Validate inputs
  // Update row by ID
  // Return updated entry
}

// Delete entry by ID
async deleteEntryById(id) {
  // Delete row by ID
  // Return success
}
```

**Update Existing Method**:

- Modify `upsertEntry()` to check `entryType` - if 'expense', call `createEntry()` instead of upsert logic

### 3. Backend API Routes

**File**: `src/routes/api.js`

**Add Endpoints**:

```javascript
// POST /api/pnl/manual-entries - Create new entry
router.post('/pnl/manual-entries', async (req, res) => {
  // Validate request body
  // Call manualEntryService.createEntry()
  // Return created entry
});

// GET /api/pnl/manual-entries?expenseCategoryId=X&year=Y&month=Z&entryType=expense
router.get('/pnl/manual-entries', async (req, res) => {
  // Validate query params
  // Call manualEntryService.getEntriesByCategoryMonth()
  // Return array of entries
});

// GET /api/pnl/manual-entries/:id
router.get('/pnl/manual-entries/:id', async (req, res) => {
  // Validate ID
  // Call manualEntryService.getEntryById()
  // Return entry or 404
});

// PUT /api/pnl/manual-entries/:id
router.put('/pnl/manual-entries/:id', async (req, res) => {
  // Validate request body
  // Call manualEntryService.updateEntryById()
  // Return updated entry
});

// DELETE /api/pnl/manual-entries/:id
router.delete('/pnl/manual-entries/:id', async (req, res) => {
  // Validate ID
  // Call manualEntryService.deleteEntryById()
  // Return success
});
```

### 4. Frontend: Plus Icon

**File**: `frontend/pnl-report-script.js`

**In `renderReport()` function, modify expense category row rendering**:

```javascript
// For each month cell in expense category row:
const isManual = expenseCategoryMap.get(category.id)?.management_type === 'manual';
if (isManual) {
  // Add plus icon to cell
  cellHtml += `
    <button class="add-expense-btn" 
            data-expense-category-id="${category.id}" 
            data-year="${year}" 
            data-month="${entry.month}"
            title="Добавить расход">
      +
    </button>
  `;
}
```

**Add Event Listener**:

```javascript
// Attach click handlers for plus icons
document.querySelectorAll('.add-expense-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent cell click
    const categoryId = btn.dataset.expenseCategoryId;
    const year = btn.dataset.year;
    const month = btn.dataset.month;
    showAddExpenseModal(categoryId, year, month);
  });
});
```

### 5. Frontend: Add Expense Modal

**File**: `frontend/pnl-report.html`

**Add Modal HTML**:

```html
<div id="add-expense-modal" class="modal" style="display: none;">
  <div class="modal-content">
    <div class="modal-header">
      <h3>Добавить расход</h3>
      <button class="modal-close" onclick="closeAddExpenseModal()">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label for="expense-amount">Сумма (PLN) *</label>
        <input type="number" id="expense-amount" step="0.01" min="0.01" required>
      </div>
      <div class="form-group">
        <label for="expense-comment">Комментарий</label>
        <textarea id="expense-comment" rows="3" maxlength="5000"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="saveExpenseEntry()">Сохранить</button>
      <button class="btn btn-secondary" onclick="closeAddExpenseModal()">Отмена</button>
    </div>
  </div>
</div>
```

**File**: `frontend/pnl-report-script.js`

**Add Functions**:

```javascript
let currentExpenseContext = null; // { categoryId, year, month }

function showAddExpenseModal(categoryId, year, month) {
  currentExpenseContext = { categoryId, year, month };
  document.getElementById('add-expense-modal').style.display = 'block';
  document.getElementById('expense-amount').focus();
}

function closeAddExpenseModal() {
  document.getElementById('add-expense-modal').style.display = 'none';
  document.getElementById('expense-amount').value = '';
  document.getElementById('expense-comment').value = '';
  currentExpenseContext = null;
}

async function saveExpenseEntry() {
  const amount = parseFloat(document.getElementById('expense-amount').value);
  const comment = document.getElementById('expense-comment').value.trim();
  
  if (!amount || amount <= 0) {
    alert('Введите корректную сумму');
    return;
  }
  
  try {
    const response = await fetch('/api/pnl/manual-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expenseCategoryId: currentExpenseContext.categoryId,
        entryType: 'expense',
        year: currentExpenseContext.year,
        month: currentExpenseContext.month,
        amountPln: amount,
        notes: comment || null
      })
    });
    
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Ошибка сохранения');
    }
    
    closeAddExpenseModal();
    loadPnlReport(); // Refresh report to show updated total
  } catch (error) {
    alert('Ошибка: ' + error.message);
  }
}
```

### 6. Frontend: List View Modal

**File**: `frontend/pnl-report.html`

**Add List Modal HTML**:

```html
<div id="expense-list-modal" class="modal" style="display: none;">
  <div class="modal-content">
    <div class="modal-header">
      <h3>Расходы за месяц</h3>
      <button class="modal-close" onclick="closeExpenseListModal()">&times;</button>
    </div>
    <div class="modal-body">
      <div id="expense-list-container">
        <!-- Entries will be loaded here -->
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="showAddExpenseModalFromList()">Добавить расход</button>
      <button class="btn btn-secondary" onclick="closeExpenseListModal()">Закрыть</button>
    </div>
  </div>
</div>
```

**File**: `frontend/pnl-report-script.js`

**Add Functions**:

```javascript
async function showExpenseListModal(categoryId, year, month) {
  try {
    const response = await fetch(
      `/api/pnl/manual-entries?expenseCategoryId=${categoryId}&year=${year}&month=${month}&entryType=expense`
    );
    const result = await response.json();
    
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Ошибка загрузки');
    }
    
    const entries = result.data || [];
    renderExpenseList(entries, categoryId, year, month);
    document.getElementById('expense-list-modal').style.display = 'block';
  } catch (error) {
    alert('Ошибка: ' + error.message);
  }
}

function renderExpenseList(entries, categoryId, year, month) {
  const container = document.getElementById('expense-list-container');
  
  if (entries.length === 0) {
    container.innerHTML = '<p>Нет расходов за этот месяц</p>';
    return;
  }
  
  const total = entries.reduce((sum, e) => sum + (e.amount_pln || 0), 0);
  
  container.innerHTML = `
    <div class="expense-list-total">
      <strong>Итого: ${formatCurrency(total)} PLN</strong>
    </div>
    <div class="expense-list">
      ${entries.map(entry => `
        <div class="expense-entry-item">
          <div class="expense-entry-info">
            <div class="expense-entry-amount">${formatCurrency(entry.amount_pln)} PLN</div>
            <div class="expense-entry-comment">${entry.notes || '(без комментария)'}</div>
            <div class="expense-entry-date">${new Date(entry.created_at).toLocaleDateString('ru-RU')}</div>
          </div>
          <div class="expense-entry-actions">
            <button class="btn btn-sm btn-secondary" onclick="editExpenseEntry(${entry.id})">Редактировать</button>
            <button class="btn btn-sm btn-danger" onclick="deleteExpenseEntry(${entry.id})">Удалить</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function deleteExpenseEntry(entryId) {
  if (!confirm('Удалить этот расход?')) return;
  
  try {
    const response = await fetch(`/api/pnl/manual-entries/${entryId}`, {
      method: 'DELETE'
    });
    
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Ошибка удаления');
    }
    
    // Refresh list and report
    const context = currentExpenseListContext;
    showExpenseListModal(context.categoryId, context.year, context.month);
    loadPnlReport();
  } catch (error) {
    alert('Ошибка: ' + error.message);
  }
}
```

**Update Cell Click Handler**:

```javascript
// Modify existing cell click handler to show list instead of inline edit for expenses
function handleExpenseCellClick(cell, categoryId, year, month) {
  // Don't trigger if clicking plus icon
  if (event.target.classList.contains('add-expense-btn')) return;
  
  showExpenseListModal(categoryId, year, month);
}
```

### 7. Update Aggregation Logic

**File**: `src/services/pnl/pnlReportService.js`

**Update expense aggregation**:

```javascript
// In getExpenseCategories() or similar method:
// Instead of getting single entry per category/month:
const manualEntries = await manualEntryService.getEntriesByCategoryMonth(
  categoryId, year, month, 'expense'
);

// Sum all entries:
const totalAmount = manualEntries.reduce((sum, entry) => sum + (entry.amount_pln || 0), 0);
```

### 8. Styling

**File**: `frontend/style.css` (or `pnl-report.html` style section)

**Add Styles**:

```css
.add-expense-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #007bff;
  color: white;
  border: none;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}

.expense-entry-item {
  display: flex;
  justify-content: space-between;
  padding: 10px;
  border-bottom: 1px solid #ddd;
}

.expense-entry-amount {
  font-weight: bold;
  font-size: 16px;
}

.expense-entry-comment {
  color: #666;
  margin-top: 4px;
}

.expense-entry-date {
  color: #999;
  font-size: 12px;
  margin-top: 4px;
}
```

## Testing Checklist

- [ ] Migration runs successfully
- [ ] Can create multiple entries for same category/month
- [ ] Plus icon appears in manual expense category cells
- [ ] Modal opens on plus icon click
- [ ] Entry saves successfully
- [ ] Cell total updates after save
- [ ] List modal shows all entries
- [ ] Can edit entry from list
- [ ] Can delete entry from list
- [ ] Totals sum correctly in report
- [ ] Entries persist after page refresh
- [ ] Validation works (amount > 0, etc.)

## Next Steps

After implementation:
1. Test with 100+ entries per category/month (performance validation)
2. Add loading indicators for async operations
3. Add error handling and user feedback
4. Consider pagination for lists with many entries
5. Add keyboard shortcuts (Enter to save, Escape to close)


