const API_BASE = '/api';

const monthNames = {
  1: 'Январь',
  2: 'Февраль',
  3: 'Март',
  4: 'Апрель',
  5: 'Май',
  6: 'Июнь',
  7: 'Июль',
  8: 'Август',
  9: 'Сентябрь',
  10: 'Октябрь',
  11: 'Ноябрь',
  12: 'Декабрь'
};

let elements = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  bindEvents();
  loadPnlReport();
  addLog('info', 'PNL отчет инициализирован');
});

function cacheDom() {
  elements = {
    refreshBtn: document.getElementById('refresh-pnl'),
    yearSelect: document.getElementById('year-select'),
    loadingIndicator: document.getElementById('pnl-loading'),
    errorMessage: document.getElementById('pnl-error'),
    reportContainer: document.getElementById('pnl-report-container'),
    logsContainer: document.getElementById('logs-container'),
    clearLogsBtn: document.getElementById('clear-logs'),
    // Categories elements
    tabs: document.querySelectorAll('.tab-button'),
    tabContents: document.querySelectorAll('.tab-content'),
    addCategoryBtn: document.getElementById('add-category-btn'),
    categoriesContainer: document.getElementById('categories-container'),
    categoriesLoading: document.getElementById('categories-loading'),
    categoriesError: document.getElementById('categories-error'),
    // Expense categories elements
    addExpenseCategoryBtn: document.getElementById('add-expense-category-btn'),
    expensesCsvInput: document.getElementById('expenses-csv-input'),
    expenseCategoriesContainer: document.getElementById('expense-categories-container'),
    expenseCategoriesLoading: document.getElementById('expense-categories-loading'),
    expenseCategoriesError: document.getElementById('expense-categories-error'),
    // Mappings elements
    addMappingBtn: document.getElementById('add-mapping-btn'),
    mappingsContainer: document.getElementById('mappings-container'),
    mappingsLoading: document.getElementById('mappings-loading'),
    mappingsError: document.getElementById('mappings-error')
  };
  
  // Set default year to current year
  if (elements.yearSelect) {
    const currentYear = new Date().getFullYear();
    elements.yearSelect.value = currentYear.toString();
  }
}

function bindEvents() {
  if (elements.refreshBtn) {
    elements.refreshBtn.addEventListener('click', () => {
      loadPnlReport();
    });
  }

  if (elements.yearSelect) {
    elements.yearSelect.addEventListener('change', () => {
      loadPnlReport();
    });
  }

  if (elements.clearLogsBtn) {
    elements.clearLogsBtn.addEventListener('click', () => {
      clearLogs();
    });
  }

  // Tab switching
  if (elements.tabs) {
    elements.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        switchTab(tabName);
      });
    });
  }

  // Categories
  if (elements.addCategoryBtn) {
    elements.addCategoryBtn.addEventListener('click', () => {
      showCategoryForm();
    });
  }

  // Expense categories
  if (elements.addExpenseCategoryBtn) {
    elements.addExpenseCategoryBtn.addEventListener('click', () => {
      showExpenseCategoryForm();
    });
  }

  // Expenses CSV upload
  if (elements.expensesCsvInput) {
    elements.expensesCsvInput.addEventListener('change', handleExpensesCsvUpload);
  }

  // Mappings
  if (elements.addMappingBtn) {
    elements.addMappingBtn.addEventListener('click', () => {
      showMappingForm();
    });
  }

  // Load categories when settings tab is opened
  if (elements.tabs) {
    elements.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        if (tabName === 'settings') {
          loadCategories();
          loadExpenseCategories();
          loadMappings();
        }
      });
    });
  }
}

async function loadPnlReport() {
  if (!elements.reportContainer) {
    addLog('error', 'Контейнер отчета не найден');
    return;
  }

  const selectedYear = elements.yearSelect ? elements.yearSelect.value : new Date().getFullYear().toString();
  
  if (!selectedYear) {
    showError('Пожалуйста, выберите год');
    return;
  }

  showLoading(true);
  hideError();

  try {
    const url = `${API_BASE}/pnl/report?year=${encodeURIComponent(selectedYear)}`;
    const response = await fetch(url);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Не удалось загрузить отчет');
    }

    renderReport(result.data);
    addLog('success', `Отчет за ${selectedYear} год успешно загружен`);
  } catch (error) {
    showError(error.message || 'Ошибка при загрузке отчета');
    addLog('error', `Ошибка загрузки: ${error.message}`);
  } finally {
    showLoading(false);
  }
}

function renderReport(data) {
  if (!data || !data.monthly || !Array.isArray(data.monthly)) {
    elements.reportContainer.innerHTML = '<div class="placeholder">Нет данных для отображения</div>';
    return;
  }

  const { monthly, total, year, categories, expenses, expensesTotal } = data;
  const hasCategories = categories && Array.isArray(categories) && categories.length > 0;
  const hasExpenses = expenses && Array.isArray(expenses) && expenses.length > 0;
  
  // Build category maps for quick lookup (including management_type)
  const categoryMap = new Map();
  if (hasCategories) {
    categories.forEach(cat => {
      categoryMap.set(cat.id, {
        id: cat.id,
        name: cat.name,
        management_type: cat.management_type || 'auto'
      });
    });
  }
  
  const expenseCategoryMap = new Map();
  if (hasExpenses) {
    expenses.forEach(cat => {
      expenseCategoryMap.set(cat.id, {
        id: cat.id,
        name: cat.name,
        management_type: cat.management_type || 'auto'
      });
    });
  }

  // Build currency breakdown display if available
  let currencyBreakdownHtml = '';
  if (total.currencyBreakdown && Object.keys(total.currencyBreakdown).length > 0) {
    const breakdownItems = Object.keys(total.currencyBreakdown)
      .map(curr => `${formatCurrency(total.currencyBreakdown[curr])} ${curr}`)
      .join(', ');
    currencyBreakdownHtml = `
      <div class="stat-item">
        <span class="stat-label">По валютам:</span>
        <span class="stat-value">${breakdownItems}</span>
      </div>
    `;
  }

  // Build expense rows if expenses are available (display above revenue)
  let expenseRowsHtml = '';
  if (hasExpenses) {
    // Header row: "Расходы" (sum of all expense categories)
    const expenseHeaderRowHtml = `
      <tr class="category-header-row expense-header-row">
        <td class="row-label"><strong>Расходы</strong></td>
        ${monthly.map(entry => {
          // Calculate expense total for this month
          const monthExpenseTotal = expenses.reduce((sum, cat) => {
            const monthEntry = cat.monthly?.find(m => m.month === entry.month);
            return sum + (monthEntry?.amountPln || 0);
          }, 0);
          const amountDisplay = monthExpenseTotal > 0 ? formatCurrency(monthExpenseTotal) : '—';
          
          return `<td class="amount-cell"><strong>${amountDisplay}</strong></td>`;
        }).join('')}
        <td class="amount-cell total-cell"><strong>${formatCurrency(expensesTotal?.amountPln || 0)}</strong></td>
      </tr>
    `;

    // Expense category rows
    const expenseCategoryRows = expenses.map(category => {
      const categoryMonthly = category.monthly || [];
      const categoryTotal = category.total?.amountPln || 0;
      const isManual = expenseCategoryMap.get(category.id)?.management_type === 'manual';
      
      return `
        <tr class="expense-row">
          <td class="row-label category-indent">${escapeHtml(category.name)}</td>
          ${monthly.map(entry => {
            const monthEntry = categoryMonthly.find(m => m.month === entry.month);
            const amount = monthEntry?.amountPln || 0;
            const amountDisplay = amount > 0 ? formatCurrency(amount) : '—';
            
            // Add currency breakdown for this month if available (in one line)
            let monthBreakdownHtml = '';
            if (monthEntry?.currencyBreakdown && Object.keys(monthEntry.currencyBreakdown).length > 0) {
              const breakdownItems = Object.keys(monthEntry.currencyBreakdown)
                .map(curr => `${formatCurrency(monthEntry.currencyBreakdown[curr])} ${curr}`)
                .join(', ');
              monthBreakdownHtml = ` <span class="currency-breakdown">(${breakdownItems})</span>`;
            }
            
            const editableClass = isManual ? ' editable' : '';
            const dataAttrs = isManual ? `data-expense-category-id="${category.id}" data-year="${year}" data-month="${entry.month}" data-entry-type="expense"` : '';
            return `<td class="amount-cell${editableClass}" ${dataAttrs}>${amountDisplay}${monthBreakdownHtml}</td>`;
          }).join('')}
          <td class="amount-cell total-cell"><strong>${formatCurrency(categoryTotal)}</strong></td>
        </tr>
      `;
    }).join('');

    expenseRowsHtml = expenseHeaderRowHtml + expenseCategoryRows;
  }

  // Build category rows if categories are available
  let categoryRowsHtml = '';
  if (hasCategories) {
    // Header row: "Приходы" (sum of all categories)
    const headerRowHtml = `
      <tr class="category-header-row">
        <td class="row-label"><strong>Приходы</strong></td>
        ${monthly.map(entry => {
          const amount = entry.amountPln || 0;
          const amountDisplay = amount > 0 ? formatCurrency(amount) : '—';
          
          // Add currency breakdown for this month if available (in one line)
          let monthBreakdownHtml = '';
          if (entry.currencyBreakdown && Object.keys(entry.currencyBreakdown).length > 0) {
            const breakdownItems = Object.keys(entry.currencyBreakdown)
              .map(curr => `${formatCurrency(entry.currencyBreakdown[curr])} ${curr}`)
              .join(', ');
            monthBreakdownHtml = ` <span class="currency-breakdown">(${breakdownItems})</span>`;
          }
          
          return `<td class="amount-cell"><strong>${amountDisplay}</strong>${monthBreakdownHtml}</td>`;
        }).join('')}
        <td class="amount-cell total-cell"><strong>${formatCurrency(total.amountPln)}</strong></td>
      </tr>
    `;

    // Category rows
    const categoryRows = categories.map(category => {
      const categoryMonthly = category.monthly || [];
      const categoryTotal = category.total?.amountPln || 0;
      const isManual = categoryMap.get(category.id)?.management_type === 'manual';
      
      return `
        <tr>
          <td class="row-label category-indent">${escapeHtml(category.name)}</td>
          ${monthly.map(entry => {
            const monthEntry = categoryMonthly.find(m => m.month === entry.month);
            const amount = monthEntry?.amountPln || 0;
            const amountDisplay = amount > 0 ? formatCurrency(amount) : '—';
            
            // Add currency breakdown for this month if available (in one line)
            let monthBreakdownHtml = '';
            if (monthEntry?.currencyBreakdown && Object.keys(monthEntry.currencyBreakdown).length > 0) {
              const breakdownItems = Object.keys(monthEntry.currencyBreakdown)
                .map(curr => `${formatCurrency(monthEntry.currencyBreakdown[curr])} ${curr}`)
                .join(', ');
              monthBreakdownHtml = ` <span class="currency-breakdown">(${breakdownItems})</span>`;
            }
            
            const editableClass = isManual ? ' editable' : '';
            const dataAttrs = isManual ? `data-category-id="${category.id}" data-year="${year}" data-month="${entry.month}" data-entry-type="revenue"` : '';
            return `<td class="amount-cell${editableClass}" ${dataAttrs}>${amountDisplay}${monthBreakdownHtml}</td>`;
          }).join('')}
          <td class="amount-cell total-cell"><strong>${formatCurrency(categoryTotal)}</strong></td>
        </tr>
      `;
    }).join('');

    categoryRowsHtml = headerRowHtml + categoryRows;
  } else {
    // Fallback to single "Приход" row if no categories
    categoryRowsHtml = `
      <tr>
        <td class="row-label"><strong>Приход (PLN)</strong></td>
        ${monthly.map(entry => {
          const amount = entry.amountPln || 0;
          const amountDisplay = amount > 0 ? formatCurrency(amount) : '—';
          
          // Add currency breakdown for this month if available (in one line)
          let monthBreakdownHtml = '';
          if (entry.currencyBreakdown && Object.keys(entry.currencyBreakdown).length > 0) {
            const breakdownItems = Object.keys(entry.currencyBreakdown)
              .map(curr => `${formatCurrency(entry.currencyBreakdown[curr])} ${curr}`)
              .join(', ');
            monthBreakdownHtml = ` <span class="currency-breakdown">(${breakdownItems})</span>`;
          }
          
          return `<td class="amount-cell">${amountDisplay}${monthBreakdownHtml}</td>`;
        }).join('')}
        <td class="amount-cell total-cell"><strong>${formatCurrency(total.amountPln)}</strong></td>
      </tr>
    `;
  }

  let html = `
    <div class="pnl-summary">
      <h3>Год: ${year}</h3>
      <div class="summary-stats">
        <div class="stat-item">
          <span class="stat-label">Всего приходов:</span>
          <span class="stat-value">${formatCurrency(total.amountPln)} PLN</span>
        </div>
        ${expensesTotal ? `
        <div class="stat-item">
          <span class="stat-label">Всего расходов:</span>
          <span class="stat-value">${formatCurrency(expensesTotal.amountPln || 0)} PLN</span>
        </div>
        ` : ''}
      </div>
    </div>

    <div class="pnl-table-wrapper">
      <table class="pnl-table">
        <thead>
          <tr>
            <th class="row-header"></th>
            ${monthly.map(entry => {
              const monthName = monthNames[entry.month] || `Месяц ${entry.month}`;
              return `<th>${monthName}</th>`;
            }).join('')}
            <th class="total-header">Итого</th>
          </tr>
        </thead>
        <tbody>
          ${expenseRowsHtml}
          ${categoryRowsHtml}
        </tbody>
      </table>
    </div>
  `;

  elements.reportContainer.innerHTML = html;
  
  // Attach event listeners for editable cells (both revenue and expenses)
  if (hasCategories || hasExpenses) {
    attachEditableCellListeners();
  }
}

function attachEditableCellListeners() {
  const editableCells = elements.reportContainer.querySelectorAll('.amount-cell.editable');
  
  editableCells.forEach(cell => {
    cell.addEventListener('click', handleCellClick);
  });
}

function handleCellClick(e) {
  const cell = e.currentTarget;
  if (cell.classList.contains('editing') || cell.classList.contains('saving')) {
    return;
  }
  
  const categoryId = parseInt(cell.getAttribute('data-category-id'), 10) || null;
  const expenseCategoryId = parseInt(cell.getAttribute('data-expense-category-id'), 10) || null;
  const year = parseInt(cell.getAttribute('data-year'), 10);
  const month = parseInt(cell.getAttribute('data-month'), 10);
  const entryType = cell.getAttribute('data-entry-type') || 'revenue';
  
  if ((!categoryId && !expenseCategoryId) || !year || !month) {
    return;
  }
  
  // Get current value
  const currentText = cell.textContent.trim();
  const currentValue = currentText === '—' ? '' : currentText.replace(/\s/g, '').replace(',', '.');
  
  // Create input
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentValue;
  input.className = 'editable-input';
  
  // Replace cell content with input
  cell.classList.add('editing');
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  input.select();
  
  // Handle save on blur
  const handleBlur = () => {
    saveCellValue(cell, categoryId, expenseCategoryId, entryType, year, month, input.value);
  };
  
  // Handle save on Enter
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit(cell, currentText);
    }
  };
  
  input.addEventListener('blur', handleBlur, { once: true });
  input.addEventListener('keydown', handleKeyDown);
}

function cancelEdit(cell, originalText) {
  cell.classList.remove('editing');
  cell.textContent = originalText;
}

async function saveCellValue(cell, categoryId, expenseCategoryId, entryType, year, month, value) {
  // Parse value
  const numValue = parseFloat(value.replace(/\s/g, '').replace(',', '.'));
  
  if (isNaN(numValue) || numValue < 0) {
    cell.classList.remove('editing');
    cell.classList.add('error');
    cell.textContent = value || '—';
    setTimeout(() => {
      cell.classList.remove('error');
    }, 2000);
    return;
  }
  
  cell.classList.remove('editing');
  cell.classList.add('saving');
  
  try {
    const requestBody = {
      entryType: entryType || 'revenue',
      year,
      month,
      amountPln: numValue
    };
    
    // Add appropriate category ID based on entry type
    if (entryType === 'expense' && expenseCategoryId) {
      requestBody.expenseCategoryId = expenseCategoryId;
    } else if (categoryId) {
      requestBody.categoryId = categoryId;
    } else {
      throw new Error('Category ID is required');
    }
    
    const response = await fetch(`${API_BASE}/pnl/manual-entries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    const result = await response.json();
    
    if (!response.ok || !result.success) {
      throw new Error(result.message || result.error || 'Failed to save');
    }
    
    // Update cell with new value
    cell.classList.remove('saving');
    const formattedValue = numValue > 0 ? formatCurrency(numValue) : '—';
    cell.textContent = formattedValue;
    
    // Reload report to update totals
    loadPnlReport();
  } catch (error) {
    cell.classList.remove('saving');
    cell.classList.add('error');
    cell.textContent = value || '—';
    addLog('error', `Ошибка сохранения: ${error.message}`);
    setTimeout(() => {
      cell.classList.remove('error');
    }, 3000);
  }
}

function formatCurrency(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return '0.00';
  }
  return amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function showLoading(show) {
  if (elements.loadingIndicator) {
    elements.loadingIndicator.style.display = show ? 'block' : 'none';
  }
}

function showError(message) {
  if (elements.errorMessage) {
    // Provide user-friendly error messages
    let friendlyMessage = message;
    
    if (message.includes('Year parameter is required')) {
      friendlyMessage = 'Пожалуйста, выберите год для отчета';
    } else if (message.includes('Year must be a number between')) {
      friendlyMessage = 'Некорректный год. Выберите год между 2020 и 2030';
    } else if (message.includes('Failed to get')) {
      friendlyMessage = 'Не удалось загрузить отчет. Проверьте подключение к серверу и попробуйте снова.';
    } else if (message.includes('network') || message.includes('fetch')) {
      friendlyMessage = 'Ошибка сети. Проверьте подключение к интернету и попробуйте снова.';
    }
    
    elements.errorMessage.textContent = friendlyMessage;
    elements.errorMessage.style.display = 'block';
  }
}

function hideError() {
  if (elements.errorMessage) {
    elements.errorMessage.style.display = 'none';
  }
}

function addLog(type, message) {
  if (!elements.logsContainer) return;

  const timestamp = new Date().toLocaleTimeString('ru-RU');
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry ${type}`;
  logEntry.textContent = `[${timestamp}] ${message}`;

  elements.logsContainer.appendChild(logEntry);
  elements.logsContainer.scrollTop = elements.logsContainer.scrollHeight;
}

function clearLogs() {
  if (elements.logsContainer) {
    elements.logsContainer.innerHTML = '';
    addLog('info', 'Логи очищены');
  }
}

// Tab management
function switchTab(tabName) {
  // Update tab buttons
  if (elements.tabs) {
    elements.tabs.forEach(tab => {
      if (tab.getAttribute('data-tab') === tabName) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
  }

  // Update tab contents
  if (elements.tabContents) {
    elements.tabContents.forEach(content => {
      if (content.id === `tab-${tabName}`) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  }
}

// Categories management
let categoriesEventDelegateAttached = false;

async function loadCategories() {
  if (!elements.categoriesContainer) return;

  showCategoriesLoading(true);
  hideCategoriesError();

  try {
    const response = await fetch(`${API_BASE}/pnl/categories`);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Не удалось загрузить категории');
    }

    renderCategories(result.data || []);
    addLog('success', 'Категории успешно загружены');
  } catch (error) {
    showCategoriesError(error.message || 'Ошибка при загрузке категорий');
    addLog('error', `Ошибка загрузки категорий: ${error.message}`);
  } finally {
    showCategoriesLoading(false);
  }
}

function renderCategories(categories) {
  if (!elements.categoriesContainer) return;

  if (!categories || categories.length === 0) {
    elements.categoriesContainer.innerHTML = '<div class="placeholder">Нет категорий. Добавьте первую категорию.</div>';
    return;
  }

  // Check if display_order is available (at least one category should have it)
  const hasDisplayOrder = categories.some(cat => cat.display_order !== undefined);

  const html = `
    <div class="categories-list">
      ${categories.map((category, index) => `
        <div class="category-item" data-category-id="${category.id}">
          ${hasDisplayOrder ? `
          <div class="category-order-controls">
            <button class="btn btn-link btn-sm" data-action="move-up" data-category-id="${category.id}" ${index === 0 ? 'disabled' : ''} title="Переместить вверх">↑</button>
            <button class="btn btn-link btn-sm" data-action="move-down" data-category-id="${category.id}" ${index === categories.length - 1 ? 'disabled' : ''} title="Переместить вниз">↓</button>
          </div>
          ` : ''}
          <div class="category-info">
            <div class="category-name">
              ${escapeHtml(category.name)}
              ${category.management_type === 'manual' ? '<span class="category-manual-badge" title="Ручное управление">✏️</span>' : ''}
            </div>
            ${category.description ? `<div class="category-description">${escapeHtml(category.description)}</div>` : ''}
          </div>
          <div class="category-actions">
            <button class="btn btn-secondary btn-sm" data-action="edit" data-category-id="${category.id}" data-category-name="${escapeHtml(category.name)}" data-category-description="${escapeHtml(category.description || '')}" data-category-management-type="${category.management_type || 'auto'}">Редактировать</button>
            <button class="btn btn-danger btn-sm" data-action="delete" data-category-id="${category.id}" data-category-name="${escapeHtml(category.name)}">Удалить</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  elements.categoriesContainer.innerHTML = html;

  // Attach event listeners using event delegation (only once)
  if (!categoriesEventDelegateAttached && elements.categoriesContainer) {
    elements.categoriesContainer.addEventListener('click', (e) => {
      const action = e.target.getAttribute('data-action');
      const categoryId = parseInt(e.target.getAttribute('data-category-id'), 10);
      
      if (!action || !categoryId) return;

      if (action === 'edit') {
        const name = e.target.getAttribute('data-category-name') || '';
        const description = e.target.getAttribute('data-category-description') || '';
        const managementType = e.target.getAttribute('data-category-management-type') || 'auto';
        editCategory(categoryId, name, description, managementType);
      } else if (action === 'delete') {
        const name = e.target.getAttribute('data-category-name') || '';
        deleteCategory(categoryId, name);
      } else if (action === 'move-up') {
        moveCategory(categoryId, 'up');
      } else if (action === 'move-down') {
        moveCategory(categoryId, 'down');
      }
    });
    categoriesEventDelegateAttached = true;
  }
}

function showCategoryForm(categoryId = null, name = '', description = '', managementType = 'auto') {
  if (!elements.categoriesContainer) return;

  // Close any existing forms first
  const existingForms = elements.categoriesContainer.querySelectorAll('.category-form');
  existingForms.forEach(form => form.remove());

  const isEdit = categoryId !== null && categoryId !== 'null';
  const formId = isEdit ? `category-form-${categoryId}` : 'category-form-new';
  const inputId = isEdit ? categoryId : 'new';
  
  const formHtml = `
    <div class="category-form" id="${formId}" data-category-id="${categoryId || ''}">
      <h3>${isEdit ? 'Редактировать категорию' : 'Новая категория'}</h3>
      <div class="form-group">
        <label for="category-name-${inputId}">Название *</label>
        <input type="text" id="category-name-${inputId}" value="${escapeHtml(name)}" required maxlength="255">
      </div>
      <div class="form-group">
        <label for="category-description-${inputId}">Описание</label>
        <textarea id="category-description-${inputId}" maxlength="5000">${escapeHtml(description)}</textarea>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="category-manual-${inputId}" ${managementType === 'manual' ? 'checked' : ''}>
          <span>Ручное управление</span>
        </label>
        <small class="form-hint">Если отмечено, значения вводятся вручную в таблице отчета</small>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="cancelCategoryForm('${formId}')">Отмена</button>
        <button class="btn btn-primary" onclick="saveCategoryFromForm('${formId}')">Сохранить</button>
      </div>
    </div>
  `;

  // Insert form at the beginning
  const formElement = document.createElement('div');
  formElement.innerHTML = formHtml;
  elements.categoriesContainer.insertBefore(formElement.firstElementChild, elements.categoriesContainer.firstChild);
}

function cancelCategoryForm(formId) {
  const form = document.getElementById(formId);
  if (form) {
    form.remove();
  }
}

function saveCategoryFromForm(formId) {
  const form = document.getElementById(formId);
  if (!form) {
    alert('Форма не найдена');
    return;
  }
  
  const categoryId = form.getAttribute('data-category-id');
  saveCategory(categoryId || null);
}

async function saveCategory(categoryId) {
  // Determine if this is edit or create
  const isEdit = categoryId !== null && categoryId !== 'null' && categoryId !== '';
  const inputId = isEdit ? categoryId : 'new';
  
  const nameInput = document.getElementById(`category-name-${inputId}`);
  const descriptionInput = document.getElementById(`category-description-${inputId}`);
  const manualCheckbox = document.getElementById(`category-manual-${inputId}`);

  if (!nameInput || !nameInput.value.trim()) {
    alert('Название категории обязательно');
    return;
  }

  const categoryData = {
    name: nameInput.value.trim(),
    description: descriptionInput ? descriptionInput.value.trim() : '',
    management_type: manualCheckbox && manualCheckbox.checked ? 'manual' : 'auto'
  };

  try {
    showCategoriesLoading(true);
    hideCategoriesError();

    const url = isEdit 
      ? `${API_BASE}/pnl/categories/${categoryId}`
      : `${API_BASE}/pnl/categories`;
    
    const method = isEdit ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(categoryData)
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Не удалось сохранить категорию');
    }

    cancelCategoryForm(categoryId);
    await loadCategories();
    addLog('success', `Категория ${isEdit ? 'обновлена' : 'создана'} успешно`);
  } catch (error) {
    showCategoriesError(error.message || 'Ошибка при сохранении категории');
    addLog('error', `Ошибка сохранения категории: ${error.message}`);
  } finally {
    showCategoriesLoading(false);
  }
}

async function editCategory(id, name, description, managementType = 'auto') {
  showCategoryForm(id, name, description, managementType);
}

async function deleteCategory(id, name) {
  if (!confirm(`Вы уверены, что хотите удалить категорию "${name}"?`)) {
    return;
  }

  try {
    showCategoriesLoading(true);
    hideCategoriesError();

    const response = await fetch(`${API_BASE}/pnl/categories/${id}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Не удалось удалить категорию');
    }

    await loadCategories();
    addLog('success', 'Категория удалена успешно');
  } catch (error) {
    showCategoriesError(error.message || 'Ошибка при удалении категории');
    addLog('error', `Ошибка удаления категории: ${error.message}`);
  } finally {
    showCategoriesLoading(false);
  }
}

function showCategoriesLoading(show) {
  if (elements.categoriesLoading) {
    elements.categoriesLoading.style.display = show ? 'block' : 'none';
  }
}

function showCategoriesError(message) {
  if (elements.categoriesError) {
    elements.categoriesError.textContent = message;
    elements.categoriesError.style.display = 'block';
  }
}

function hideCategoriesError() {
  if (elements.categoriesError) {
    elements.categoriesError.style.display = 'none';
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function moveCategory(id, direction) {
  try {
    showCategoriesLoading(true);
    hideCategoriesError();

    const response = await fetch(`${API_BASE}/pnl/categories/${id}/reorder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ direction })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      const errorMsg = result.message || result.error || 'Не удалось изменить порядок категории';
      
      // Show user-friendly message for missing display_order
      if (errorMsg.includes('display_order') || errorMsg.includes('ordering is not available')) {
        showCategoriesError('Изменение порядка недоступно. Выполните миграцию для добавления поля display_order в базу данных.');
        addLog('error', 'Для изменения порядка категорий необходимо выполнить миграцию 002_add_category_display_order.sql');
      } else {
        showCategoriesError(errorMsg);
        addLog('error', `Ошибка изменения порядка: ${errorMsg}`);
      }
      return;
    }

    await loadCategories();
    addLog('success', `Порядок категории изменен`);
  } catch (error) {
    const errorMsg = error.message || 'Ошибка при изменении порядка категории';
    showCategoriesError(errorMsg);
    addLog('error', `Ошибка изменения порядка: ${errorMsg}`);
  } finally {
    showCategoriesLoading(false);
  }
}

// Make functions globally available for onclick handlers
window.editCategory = editCategory;
window.deleteCategory = deleteCategory;
window.saveCategory = saveCategory;
window.saveCategoryFromForm = saveCategoryFromForm;
window.cancelCategoryForm = cancelCategoryForm;
window.moveCategory = moveCategory;

// Expense Categories management
let expenseCategoriesEventDelegateAttached = false;

async function loadExpenseCategories() {
  if (!elements.expenseCategoriesContainer) return;

  showExpenseCategoriesLoading(true);
  hideExpenseCategoriesError();

  try {
    const response = await fetch(`${API_BASE}/pnl/expense-categories`);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Не удалось загрузить категории расходов');
    }

    renderExpenseCategories(result.data || []);
    addLog('success', 'Категории расходов успешно загружены');
  } catch (error) {
    showExpenseCategoriesError(error.message || 'Ошибка при загрузке категорий расходов');
    addLog('error', `Ошибка загрузки категорий расходов: ${error.message}`);
  } finally {
    showExpenseCategoriesLoading(false);
  }
}

function renderExpenseCategories(categories) {
  if (!elements.expenseCategoriesContainer) return;

  if (!categories || categories.length === 0) {
    elements.expenseCategoriesContainer.innerHTML = '<div class="placeholder">Нет категорий. Добавьте первую категорию.</div>';
    return;
  }

  // Check if display_order is available
  const hasDisplayOrder = categories.some(cat => cat.display_order !== undefined);

  const html = `
    <div class="categories-list">
      ${categories.map((category, index) => `
        <div class="category-item" data-expense-category-id="${category.id}">
          ${hasDisplayOrder ? `
          <div class="category-order-controls">
            <button class="btn btn-link btn-sm" data-action="move-up" data-expense-category-id="${category.id}" ${index === 0 ? 'disabled' : ''} title="Переместить вверх">↑</button>
            <button class="btn btn-link btn-sm" data-action="move-down" data-expense-category-id="${category.id}" ${index === categories.length - 1 ? 'disabled' : ''} title="Переместить вниз">↓</button>
          </div>
          ` : ''}
          <div class="category-info">
            <div class="category-name">
              ${escapeHtml(category.name)}
              ${category.management_type === 'manual' ? '<span class="category-manual-badge" title="Ручное управление">✏️</span>' : ''}
            </div>
            ${category.description ? `<div class="category-description">${escapeHtml(category.description)}</div>` : ''}
          </div>
          <div class="category-actions">
            <button class="btn btn-secondary btn-sm" data-action="edit" data-expense-category-id="${category.id}" data-expense-category-name="${escapeHtml(category.name)}" data-expense-category-description="${escapeHtml(category.description || '')}" data-expense-category-management-type="${category.management_type || 'auto'}">Редактировать</button>
            <button class="btn btn-danger btn-sm" data-action="delete" data-expense-category-id="${category.id}" data-expense-category-name="${escapeHtml(category.name)}">Удалить</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  elements.expenseCategoriesContainer.innerHTML = html;

  // Attach event listeners using event delegation (only once)
  if (!expenseCategoriesEventDelegateAttached && elements.expenseCategoriesContainer) {
    elements.expenseCategoriesContainer.addEventListener('click', (e) => {
      // Find the button element (in case click was on child element like text)
      const button = e.target.closest('[data-action]');
      if (!button) return;
      
      const action = button.getAttribute('data-action');
      const expenseCategoryId = parseInt(button.getAttribute('data-expense-category-id'), 10);
      
      if (!action || !expenseCategoryId) return;

      if (action === 'edit') {
        const name = button.getAttribute('data-expense-category-name') || '';
        const description = button.getAttribute('data-expense-category-description') || '';
        const managementType = button.getAttribute('data-expense-category-management-type') || 'auto';
        editExpenseCategory(expenseCategoryId, name, description, managementType);
      } else if (action === 'delete') {
        const name = button.getAttribute('data-expense-category-name') || '';
        deleteExpenseCategory(expenseCategoryId, name);
      } else if (action === 'move-up') {
        moveExpenseCategory(expenseCategoryId, 'up');
      } else if (action === 'move-down') {
        moveExpenseCategory(expenseCategoryId, 'down');
      }
    });
    expenseCategoriesEventDelegateAttached = true;
  }
}

function showExpenseCategoryForm(expenseCategoryId = null, name = '', description = '', managementType = 'auto') {
  if (!elements.expenseCategoriesContainer) return;

  // Close any existing forms first
  const existingForms = elements.expenseCategoriesContainer.querySelectorAll('.category-form');
  existingForms.forEach(form => form.remove());

  const isEdit = expenseCategoryId !== null && expenseCategoryId !== 'null';
  const formId = isEdit ? `expense-category-form-${expenseCategoryId}` : 'expense-category-form-new';
  const inputId = isEdit ? expenseCategoryId : 'new';
  
  const formHtml = `
    <div class="category-form" id="${formId}" data-expense-category-id="${expenseCategoryId || ''}">
      <div class="form-group">
        <label for="expense-category-name-${inputId}">Название категории:</label>
        <input type="text" id="expense-category-name-${inputId}" class="form-control" value="${escapeHtml(name)}" required>
      </div>
      <div class="form-group">
        <label for="expense-category-description-${inputId}">Описание (необязательно):</label>
        <textarea id="expense-category-description-${inputId}" class="form-control" rows="2">${escapeHtml(description)}</textarea>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="expense-category-manual-${inputId}" ${managementType === 'manual' ? 'checked' : ''}>
          <span>Ручное управление</span>
        </label>
        <div class="form-hint">Если включено, значения вводятся вручную в таблице отчета</div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="saveExpenseCategoryFromForm('${formId}')">${isEdit ? 'Сохранить' : 'Создать'}</button>
        <button class="btn btn-secondary" onclick="cancelExpenseCategoryForm('${formId}')">Отмена</button>
      </div>
    </div>
  `;

  elements.expenseCategoriesContainer.insertAdjacentHTML('beforeend', formHtml);
  
  // Focus on name input
  const nameInput = document.getElementById(`expense-category-name-${inputId}`);
  if (nameInput) {
    nameInput.focus();
  }
}

function cancelExpenseCategoryForm(formId) {
  const form = document.getElementById(formId);
  if (form) {
    form.remove();
  }
}

async function saveExpenseCategoryFromForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return;

  const expenseCategoryId = form.getAttribute('data-expense-category-id');
  const isEdit = expenseCategoryId && expenseCategoryId !== '';
  
  const nameInput = document.getElementById(`expense-category-name-${isEdit ? expenseCategoryId : 'new'}`);
  const descriptionInput = document.getElementById(`expense-category-description-${isEdit ? expenseCategoryId : 'new'}`);
  const manualCheckbox = document.getElementById(`expense-category-manual-${isEdit ? expenseCategoryId : 'new'}`);

  if (!nameInput || !descriptionInput || !manualCheckbox) {
    addLog('error', 'Не найдены поля формы');
    return;
  }

  const name = nameInput.value.trim();
  const description = descriptionInput.value.trim();
  const managementType = manualCheckbox.checked ? 'manual' : 'auto';

  if (!name) {
    addLog('error', 'Название категории обязательно');
    return;
  }

  await saveExpenseCategory(isEdit ? parseInt(expenseCategoryId, 10) : null, name, description, managementType);
}

async function saveExpenseCategory(expenseCategoryId, name, description, managementType) {
  try {
    const url = expenseCategoryId 
      ? `${API_BASE}/pnl/expense-categories/${expenseCategoryId}`
      : `${API_BASE}/pnl/expense-categories`;
    
    const method = expenseCategoryId ? 'PUT' : 'POST';
    
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        description,
        management_type: managementType
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Не удалось сохранить категорию');
    }

    addLog('success', `Категория расходов "${name}" ${expenseCategoryId ? 'обновлена' : 'создана'}`);
    await loadExpenseCategories();
    // Reload report to update totals
    loadPnlReport();
  } catch (error) {
    addLog('error', `Ошибка сохранения категории расходов: ${error.message}`);
  }
}

function editExpenseCategory(expenseCategoryId, name, description, managementType) {
  showExpenseCategoryForm(expenseCategoryId, name, description, managementType);
}

async function deleteExpenseCategory(expenseCategoryId, name) {
  if (!confirm(`Вы уверены, что хотите удалить категорию расходов "${name}"?`)) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/pnl/expense-categories/${expenseCategoryId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Не удалось удалить категорию');
    }

    addLog('success', `Категория расходов "${name}" удалена`);
    await loadExpenseCategories();
    // Reload report to update totals
    loadPnlReport();
  } catch (error) {
    addLog('error', `Ошибка удаления категории расходов: ${error.message}`);
  }
}

async function moveExpenseCategory(expenseCategoryId, direction) {
  try {
    showExpenseCategoriesLoading(true);
    hideExpenseCategoriesError();

    const response = await fetch(`${API_BASE}/pnl/expense-categories/${expenseCategoryId}/reorder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ direction })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      const errorMsg = result.message || result.error || 'Не удалось изменить порядок категории расходов';
      
      // Show user-friendly message for missing display_order
      if (errorMsg.includes('display_order') || errorMsg.includes('ordering is not available')) {
        showExpenseCategoriesError('Изменение порядка недоступно. Выполните миграцию для добавления поля display_order в базу данных.');
        addLog('error', 'Для изменения порядка категорий расходов необходимо выполнить миграцию 004_add_expense_categories.sql');
      } else {
        showExpenseCategoriesError(errorMsg);
        addLog('error', `Ошибка изменения порядка категории расходов: ${errorMsg}`);
      }
      return;
    }

    await loadExpenseCategories();
    addLog('success', `Порядок категории расходов изменен`);
  } catch (error) {
    const errorMsg = error.message || 'Ошибка при изменении порядка категории расходов';
    showExpenseCategoriesError(errorMsg);
    addLog('error', `Ошибка изменения порядка категории расходов: ${errorMsg}`);
  } finally {
    showExpenseCategoriesLoading(false);
  }
}

function showExpenseCategoriesLoading(show) {
  if (elements.expenseCategoriesLoading) {
    elements.expenseCategoriesLoading.style.display = show ? 'block' : 'none';
  }
}

function showExpenseCategoriesError(message) {
  if (elements.expenseCategoriesError) {
    elements.expenseCategoriesError.textContent = message;
    elements.expenseCategoriesError.style.display = 'block';
  }
}

function hideExpenseCategoriesError() {
  if (elements.expenseCategoriesError) {
    elements.expenseCategoriesError.style.display = 'none';
  }
}

// Make expense category functions available globally for onclick handlers
window.saveExpenseCategoryFromForm = saveExpenseCategoryFromForm;
window.cancelExpenseCategoryForm = cancelExpenseCategoryForm;

// ==================== Expense Category Mappings ====================

let expenseCategoriesMap = {}; // For mapping category IDs to names

async function loadMappings() {
  if (!elements.mappingsContainer) return;

  showMappingsLoading();
  hideMappingsError();

  try {
    const response = await fetch(`${API_BASE}/pnl/expense-category-mappings`);
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || 'Не удалось загрузить правила');
    }

    // Load expense categories for display
    const categoriesResponse = await fetch(`${API_BASE}/pnl/expense-categories`);
    const categoriesPayload = await categoriesResponse.json();
    if (categoriesPayload.success && categoriesPayload.data) {
      expenseCategoriesMap = {};
      categoriesPayload.data.forEach(cat => {
        expenseCategoriesMap[cat.id] = cat.name;
      });
    }

    renderMappings(payload.data || []);
  } catch (error) {
    showMappingsError(`Ошибка загрузки правил: ${error.message}`);
    elements.mappingsContainer.innerHTML = '<div class="placeholder">Ошибка загрузки правил</div>';
  } finally {
    hideMappingsLoading();
  }
}

function renderMappings(mappings) {
  if (!elements.mappingsContainer) return;

  if (!mappings || mappings.length === 0) {
    elements.mappingsContainer.innerHTML = '<div class="placeholder">Нет правил категоризации. Добавьте первое правило.</div>';
    return;
  }

  const html = mappings.map(mapping => {
    const patternTypeLabel = {
      'category': 'Категория CSV',
      'description': 'Описание',
      'payer': 'Плательщик'
    }[mapping.pattern_type] || mapping.pattern_type;

    const categoryName = expenseCategoriesMap[mapping.expense_category_id] || `ID: ${mapping.expense_category_id}`;

    return `
      <div class="category-item" data-mapping-id="${mapping.id}">
        <div class="category-info">
          <div class="category-name">
            <strong>${patternTypeLabel}:</strong> "${mapping.pattern_value}"
            <span class="category-badge">→ ${categoryName}</span>
          </div>
          <div class="category-meta">
            Приоритет: ${mapping.priority || 0}
          </div>
        </div>
        <div class="category-actions">
          <button class="btn btn-sm btn-secondary" 
                  data-mapping-id="${mapping.id}"
                  data-pattern-type="${mapping.pattern_type}"
                  data-pattern-value="${escapeHtml(mapping.pattern_value)}"
                  data-expense-category-id="${mapping.expense_category_id}"
                  data-priority="${mapping.priority || 0}"
                  onclick="editMapping(this)">
            ✏️ Редактировать
          </button>
          <button class="btn btn-sm btn-danger" 
                  data-mapping-id="${mapping.id}"
                  onclick="deleteMapping(this)">
            🗑️ Удалить
          </button>
        </div>
      </div>
    `;
  }).join('');

  elements.mappingsContainer.innerHTML = html;
}

function showMappingForm(mapping = null) {
  const isEdit = !!mapping;
  const formHtml = `
    <div class="category-form" id="mapping-form">
      <h3>${isEdit ? 'Редактировать правило' : 'Добавить правило категоризации'}</h3>
      <form id="mapping-form-content">
        <div class="form-group">
          <label for="mapping-pattern-type">Тип совпадения:</label>
          <select id="mapping-pattern-type" required>
            <option value="category" ${mapping?.pattern_type === 'category' ? 'selected' : ''}>Категория CSV</option>
            <option value="description" ${mapping?.pattern_type === 'description' ? 'selected' : ''}>Описание платежа</option>
            <option value="payer" ${mapping?.pattern_type === 'payer' ? 'selected' : ''}>Плательщик</option>
          </select>
        </div>
        <div class="form-group">
          <label for="mapping-pattern-value">Значение для поиска:</label>
          <input type="text" id="mapping-pattern-value" 
                 value="${mapping?.pattern_value || ''}" 
                 placeholder="Например: 'Офис' или 'Аренда'" 
                 required>
          <small>Для типа "Описание" и "Плательщик" используется частичное совпадение (case-insensitive)</small>
        </div>
        <div class="form-group">
          <label for="mapping-expense-category-id">Категория расходов:</label>
          <select id="mapping-expense-category-id" required>
            <option value="">Выберите категорию...</option>
          </select>
        </div>
        <div class="form-group">
          <label for="mapping-priority">Приоритет:</label>
          <input type="number" id="mapping-priority" 
                 value="${mapping?.priority || 0}" 
                 min="0" 
                 placeholder="0">
          <small>Правила с большим приоритетом проверяются первыми</small>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" onclick="saveMappingFromForm(${mapping?.id || null})">
            ${isEdit ? 'Сохранить' : 'Создать'}
          </button>
          <button type="button" class="btn btn-secondary" onclick="cancelMappingForm()">Отмена</button>
        </div>
      </form>
    </div>
  `;

  // Insert form before mappings container
  const container = elements.mappingsContainer;
  const formDiv = document.createElement('div');
  formDiv.innerHTML = formHtml;
  container.parentNode.insertBefore(formDiv.firstElementChild, container);

  // Load expense categories for dropdown
  loadExpenseCategoriesForMapping(mapping?.expense_category_id || null);

  // Scroll to form
  document.getElementById('mapping-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadExpenseCategoriesForMapping(selectedId = null) {
  const select = document.getElementById('mapping-expense-category-id');
  if (!select) return;

  try {
    const response = await fetch(`${API_BASE}/pnl/expense-categories`);
    const payload = await response.json();

    if (payload.success && payload.data) {
      select.innerHTML = '<option value="">Выберите категорию...</option>';
      payload.data.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        if (selectedId && cat.id === selectedId) {
          option.selected = true;
        }
        select.appendChild(option);
      });
    }
  } catch (error) {
    addLog('error', `Ошибка загрузки категорий: ${error.message}`);
  }
}

function cancelMappingForm() {
  const form = document.getElementById('mapping-form');
  if (form) {
    form.remove();
  }
}

async function saveMappingFromForm(mappingId) {
  const patternType = document.getElementById('mapping-pattern-type')?.value;
  const patternValue = document.getElementById('mapping-pattern-value')?.value?.trim();
  const expenseCategoryId = parseInt(document.getElementById('mapping-expense-category-id')?.value, 10);
  const priority = parseInt(document.getElementById('mapping-priority')?.value || '0', 10);

  if (!patternType || !patternValue || !expenseCategoryId) {
    addLog('error', 'Заполните все обязательные поля');
    return;
  }

  try {
    const url = mappingId 
      ? `${API_BASE}/pnl/expense-category-mappings/${mappingId}`
      : `${API_BASE}/pnl/expense-category-mappings`;
    
    const method = mappingId ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pattern_type: patternType,
        pattern_value: patternValue,
        expense_category_id: expenseCategoryId,
        priority: priority || 0
      })
    });

    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || 'Не удалось сохранить правило');
    }

    addLog('success', `Правило ${mappingId ? 'обновлено' : 'создано'}`);
    cancelMappingForm();
    loadMappings();
  } catch (error) {
    addLog('error', `Ошибка сохранения правила: ${error.message}`);
  }
}

function editMapping(button) {
  const mappingId = parseInt(button.getAttribute('data-mapping-id'), 10);
  const patternType = button.getAttribute('data-pattern-type');
  const patternValue = button.getAttribute('data-pattern-value');
  const expenseCategoryId = parseInt(button.getAttribute('data-expense-category-id'), 10);
  const priority = parseInt(button.getAttribute('data-priority') || '0', 10);

  showMappingForm({
    id: mappingId,
    pattern_type: patternType,
    pattern_value: patternValue,
    expense_category_id: expenseCategoryId,
    priority: priority
  });
}

async function deleteMapping(button) {
  const mappingId = parseInt(button.getAttribute('data-mapping-id'), 10);
  
  if (!confirm('Удалить это правило категоризации?')) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/pnl/expense-category-mappings/${mappingId}`, {
      method: 'DELETE'
    });

    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || 'Не удалось удалить правило');
    }

    addLog('success', 'Правило удалено');
    loadMappings();
  } catch (error) {
    addLog('error', `Ошибка удаления правила: ${error.message}`);
  }
}

function showMappingsLoading() {
  if (elements.mappingsLoading) {
    elements.mappingsLoading.style.display = 'block';
  }
}

function hideMappingsLoading() {
  if (elements.mappingsLoading) {
    elements.mappingsLoading.style.display = 'none';
  }
}

function showMappingsError(message) {
  if (elements.mappingsError) {
    elements.mappingsError.textContent = message;
    elements.mappingsError.style.display = 'block';
  }
}

function hideMappingsError() {
  if (elements.mappingsError) {
    elements.mappingsError.style.display = 'none';
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make mapping functions available globally
window.saveMappingFromForm = saveMappingFromForm;
window.cancelMappingForm = cancelMappingForm;
window.editMapping = editMapping;
window.deleteMapping = deleteMapping;
window.escapeHtml = escapeHtml;

// Expenses CSV upload handler
async function handleExpensesCsvUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.name.endsWith('.csv')) {
    addLog('warning', 'Поддерживаются только CSV файлы');
    return;
  }

  addLog('info', `Загрузка файла расходов ${file.name}...`);
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch(`${API_BASE}/payments/import-expenses`, {
      method: 'POST',
      body: formData
    });

    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || payload.message || 'Не удалось загрузить файл расходов');
    }

    const stats = payload.data || {};
    const suggestions = payload.data?.suggestions || {};
    
    console.log('CSV import response:', { stats, suggestions, suggestionsKeys: Object.keys(suggestions) });
    
    addLog('success', `Файл расходов ${file.name} загружен. Обработано: ${stats.processed || 0}, категоризировано: ${stats.categorized || 0}, без категории: ${stats.uncategorized || 0}`);
    elements.expensesCsvInput.value = '';
    
    // Always show modal if there are uncategorized expenses (even without suggestions)
    if (stats.uncategorized > 0) {
      const suggestionsCount = Object.keys(suggestions).length;
      console.log(`Uncategorized: ${stats.uncategorized}, Suggestions: ${suggestionsCount}`);
      
      // Show modal with or without suggestions
      console.log('Showing modal for uncategorized expenses:', suggestions);
      addLog('info', `Найдено ${stats.uncategorized} расходов без категории. Открываю модальное окно для категоризации...`);
      await showExpenseSuggestionsModal(suggestions);
    } else {
      console.log('No uncategorized expenses, modal will not be shown');
      addLog('info', 'Все расходы уже категоризированы');
    }
    
    // Reload PNL report to show new expenses
    loadPnlReport();
  } catch (error) {
    addLog('error', `Ошибка загрузки CSV расходов: ${error.message}`);
  }
}

// Show expense suggestions modal
async function showExpenseSuggestionsModal(suggestionsMap) {
  console.log('showExpenseSuggestionsModal called with:', suggestionsMap);
  const modal = document.getElementById('expense-suggestions-modal');
  const summaryEl = document.getElementById('expense-suggestions-summary');
  const listEl = document.getElementById('expense-suggestions-list');
  
  console.log('Modal elements:', { modal: !!modal, summaryEl: !!summaryEl, listEl: !!listEl });
  
  if (!modal || !summaryEl || !listEl) {
    console.error('Modal elements not found!');
    addLog('error', 'Элементы модального окна не найдены');
    return;
  }

  // Always load all uncategorized expenses, not just those with suggestions
  // This ensures all expenses are shown, even if they don't have suggestions yet
  await loadUncategorizedExpenses(suggestionsMap);
}

function closeExpenseSuggestionsModal() {
  const modal = document.getElementById('expense-suggestions-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Load all uncategorized expenses when no suggestions available
async function loadUncategorizedExpenses(suggestionsMap) {
  console.log('loadUncategorizedExpenses called with suggestionsMap:', suggestionsMap);
  const modal = document.getElementById('expense-suggestions-modal');
  const summaryEl = document.getElementById('expense-suggestions-summary');
  const listEl = document.getElementById('expense-suggestions-list');
  
  console.log('Modal elements:', { modal: !!modal, summaryEl: !!summaryEl, listEl: !!listEl });
  
  if (!modal || !summaryEl || !listEl) {
    console.error('Modal elements not found in loadUncategorizedExpenses!');
    addLog('error', 'Элементы модального окна не найдены');
    return;
  }

  try {
    // Get all expenses without category (no limit, filtered on backend)
    console.log('Fetching uncategorized expenses...');
    const response = await fetch(`${API_BASE}/vat-margin/payments?direction=out&uncategorized=true&limit=1000`);
    const payload = await response.json();
    
    console.log('Payments response:', payload);
    console.log('Response keys:', Object.keys(payload));
    console.log('payload.data:', payload.data);
    console.log('payload.payments:', payload.payments);
    
    // Endpoint returns { success: true, data: payments, history }
    const uncategorizedPayments = payload.data || payload.payments || [];
    
    console.log(`Found ${uncategorizedPayments.length} uncategorized payments`);
    console.log('First 3 payments:', uncategorizedPayments.slice(0, 3));
    
    if (!payload.success) {
      addLog('error', `Ошибка загрузки расходов: ${payload.error || 'Неизвестная ошибка'}`);
      summaryEl.textContent = 'Ошибка загрузки расходов.';
      listEl.innerHTML = '<div class="placeholder">Не удалось загрузить расходы</div>';
      modal.style.display = 'block';
      return;
    }
    
    if (uncategorizedPayments.length === 0) {
      addLog('info', 'Нет расходов для отображения');
      summaryEl.textContent = 'Нет расходов без категории.';
      listEl.innerHTML = '<div class="placeholder">Все расходы уже обработаны</div>';
      modal.style.display = 'block';
      return;
    }
    
    addLog('success', `Загружено ${uncategorizedPayments.length} расходов для категоризации`);

    summaryEl.textContent = `Найдено ${uncategorizedPayments.length} расходов без категории. Выберите категорию для каждого расхода:`;

    // Load expense categories for display
    let expenseCategoriesMap = {};
    try {
      const categoriesResponse = await fetch(`${API_BASE}/pnl/expense-categories`);
      const categoriesPayload = await categoriesResponse.json();
      if (categoriesPayload.success && categoriesPayload.data) {
        categoriesPayload.data.forEach(cat => {
          expenseCategoriesMap[cat.id] = cat.name;
        });
      }
    } catch (error) {
      addLog('error', `Ошибка загрузки категорий: ${error.message}`);
    }

    // Render expenses
    const paymentsHtml = uncategorizedPayments.map(payment => {
      const suggestions = suggestionsMap[payment.id] || [];
      
      const suggestionsHtml = suggestions.length > 0
        ? suggestions.map(suggestion => {
            const categoryName = expenseCategoriesMap[suggestion.categoryId] || `ID: ${suggestion.categoryId}`;
            const isPerfectMatch = suggestion.confidence >= 100;
            const badgeStyle = isPerfectMatch ? 'background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85em;' : '';
            return `
              <div class="suggestion-item" style="padding: 10px; margin: 5px 0; border: 1px solid #ddd; border-radius: 4px; ${isPerfectMatch ? 'border-color: #10b981; background: #f0fdf4;' : ''}">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <strong>${categoryName}</strong>
                    <span style="color: #666; margin-left: 10px;">${suggestion.confidence}% уверенности</span>
                    ${isPerfectMatch ? '<span style="' + badgeStyle + ' margin-left: 8px;">100% - правило будет создано</span>' : ''}
                    <div style="font-size: 0.9em; color: #888; margin-top: 5px;">${suggestion.matchDetails || ''}</div>
                  </div>
                  <button class="btn btn-sm btn-primary" 
                          onclick="assignExpenseCategory(${payment.id}, ${suggestion.categoryId}, '${suggestion.patternType}', '${escapeHtml(suggestion.patternValue)}', ${suggestion.confidence})">
                    Выбрать
                  </button>
                </div>
              </div>
            `;
          }).join('')
        : '<div style="color: #888; padding: 10px;">Нет предложений</div>';

      return `
        <div class="expense-item" style="margin-bottom: 20px; padding: 15px; border: 1px solid #ccc; border-radius: 6px;">
          <div style="margin-bottom: 10px;">
            <strong>${payment.description || 'Без описания'}</strong>
            <span style="color: #666; margin-left: 10px;">
              ${payment.payer_name ? `Плательщик: ${payment.payer_name}` : ''}
            </span>
            <span style="color: #666; margin-left: 10px;">
              ${payment.amount ? `${payment.amount} ${payment.currency || 'PLN'}` : ''}
            </span>
          </div>
          <div style="margin-top: 10px;">
            <strong>Предложения:</strong>
            ${suggestionsHtml}
          </div>
          <div style="margin-top: 10px;">
            <button class="btn btn-sm btn-secondary" onclick="showManualCategorySelect(${payment.id})">
              Выбрать категорию вручную
            </button>
          </div>
        </div>
      `;
    }).join('');

    listEl.innerHTML = paymentsHtml || '<div class="placeholder">Нет расходов для обработки</div>';
    modal.style.display = 'block';
  } catch (error) {
    addLog('error', `Ошибка загрузки расходов: ${error.message}`);
  }
}

// Assign expense category and optionally create mapping rule
async function assignExpenseCategory(paymentId, categoryId, patternType, patternValue, confidence) {
  try {
    addLog('info', `Присвоение категории расходу ${paymentId}...`);

    // Always create rule when selecting from suggestions (user confirmed the match)
    const shouldCreateRule = true; // Always create rule when user selects from suggestions
    const priority = confidence >= 100 ? 10 : Math.round(confidence / 10);

    const response = await fetch(`${API_BASE}/payments/${paymentId}/expense-category`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expenseCategoryId: categoryId,
        createMapping: shouldCreateRule, // Always create rule when user selects from suggestions
        patternType: patternType,
        patternValue: patternValue,
        priority: priority
      })
    });

    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || 'Не удалось присвоить категорию');
    }

    if (payload.data?.mapping) {
      addLog('success', `Категория присвоена расходу ${paymentId}. Правило создано.`);
    } else {
      addLog('success', `Категория присвоена расходу ${paymentId}.`);
    }
    
    // Remove this expense from the modal
    const expenseItem = document.querySelector(`.expense-item:has([onclick*="${paymentId}"])`);
    if (expenseItem) {
      expenseItem.style.opacity = '0.5';
      expenseItem.style.pointerEvents = 'none';
      expenseItem.innerHTML = '<div style="color: green;">✓ Категория присвоена (правило создано)</div>';
    }

    // Reload PNL report and mappings
    loadMappings(); // Reload mappings to show new rule
    loadPnlReport();
  } catch (error) {
    addLog('error', `Ошибка присвоения категории: ${error.message}`);
  }
}

// Show manual category selection dialog
async function showManualCategorySelect(paymentId) {
  // Load expense categories
  let categories = [];
  try {
    const response = await fetch(`${API_BASE}/pnl/expense-categories`);
    const payload = await response.json();
    if (payload.success && payload.data) {
      categories = payload.data;
    }
  } catch (error) {
    addLog('error', `Ошибка загрузки категорий: ${error.message}`);
    return;
  }

  // Get payment details to determine pattern
  let payment = null;
  try {
    const response = await fetch(`${API_BASE}/payments/${paymentId}`);
    const payload = await response.json();
    if (payload.success && payload.data) {
      payment = payload.data;
    }
  } catch (error) {
    addLog('error', `Ошибка загрузки платежа: ${error.message}`);
    return;
  }

  if (!payment) return;

  // Create selection dialog
  const categoryOptions = categories.map(cat => 
    `<option value="${cat.id}">${cat.name}</option>`
  ).join('');

  const patternTypeOptions = `
    <option value="category" ${payment.category ? '' : 'disabled'}>Категория CSV: ${payment.category || 'не указана'}</option>
    <option value="description" ${payment.description ? '' : 'disabled'}>Описание: ${payment.description ? payment.description.substring(0, 50) : 'не указано'}</option>
    <option value="payer" ${payment.payer_name ? '' : 'disabled'}>Плательщик: ${payment.payer_name || 'не указан'}</option>
  `;

  const dialogHtml = `
    <div class="modal" id="manual-category-modal" style="display: block;">
      <div class="modal-content" style="max-width: 500px;">
        <div class="modal-header">
          <h3>Выбрать категорию вручную</h3>
          <button class="modal-close" onclick="closeManualCategoryModal()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Категория расходов:</label>
            <select id="manual-category-select" class="form-control">
              <option value="">Выберите категорию...</option>
              ${categoryOptions}
            </select>
          </div>
          <div class="form-group">
            <label>Создать правило на основе:</label>
            <select id="manual-pattern-type" class="form-control">
              ${patternTypeOptions}
            </select>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" id="manual-create-rule" checked>
              Создать правило категоризации
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="saveManualCategory(${paymentId})">Сохранить</button>
          <button class="btn btn-secondary" onclick="closeManualCategoryModal()">Отмена</button>
        </div>
      </div>
    </div>
  `;

  const dialogDiv = document.createElement('div');
  dialogDiv.innerHTML = dialogHtml;
  document.body.appendChild(dialogDiv.firstElementChild);
}

function closeManualCategoryModal() {
  const modal = document.getElementById('manual-category-modal');
  if (modal) {
    modal.remove();
  }
}

async function saveManualCategory(paymentId) {
  const categoryId = parseInt(document.getElementById('manual-category-select')?.value, 10);
  const patternType = document.getElementById('manual-pattern-type')?.value;
  const createRule = document.getElementById('manual-create-rule')?.checked;

  if (!categoryId) {
    addLog('error', 'Выберите категорию');
    return;
  }

  try {
    // Get payment to determine pattern value
    const paymentResponse = await fetch(`${API_BASE}/payments/${paymentId}`);
    const paymentPayload = await paymentResponse.json();
    const payment = paymentPayload.data;

    let patternValue = '';
    if (patternType === 'category' && payment.category) {
      patternValue = payment.category;
    } else if (patternType === 'description' && payment.description) {
      patternValue = payment.description.substring(0, 100);
    } else if (patternType === 'payer' && payment.payer_name) {
      patternValue = payment.payer_name;
    }

    const response = await fetch(`${API_BASE}/payments/${paymentId}/expense-category`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expenseCategoryId: categoryId,
        createMapping: createRule && patternType && patternValue,
        patternType: createRule ? patternType : null,
        patternValue: createRule ? patternValue : null,
        priority: 0
      })
    });

    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || 'Не удалось присвоить категорию');
    }

    addLog('success', `Категория присвоена расходу ${paymentId}${createRule ? '. Правило создано.' : '.'}`);
    closeManualCategoryModal();
    
    // Remove expense from suggestions modal
    const expenseItem = document.querySelector(`.expense-item:has([onclick*="${paymentId}"])`);
    if (expenseItem) {
      expenseItem.style.opacity = '0.5';
      expenseItem.style.pointerEvents = 'none';
      expenseItem.innerHTML = '<div style="color: green;">✓ Категория присвоена</div>';
    }

    loadPnlReport();
  } catch (error) {
    addLog('error', `Ошибка сохранения категории: ${error.message}`);
  }
}

// Make functions available globally
window.closeExpenseSuggestionsModal = closeExpenseSuggestionsModal;
window.assignExpenseCategory = assignExpenseCategory;
window.showManualCategorySelect = showManualCategorySelect;
window.closeManualCategoryModal = closeManualCategoryModal;
window.saveManualCategory = saveManualCategory;

