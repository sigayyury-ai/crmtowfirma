const API_BASE = window.location.origin;

let expenseCategoriesMap = {};

// State for expense details (similar to paymentsState in vat-margin-script.js)
const expensesState = {
  items: [],
  selectedId: null,
  details: new Map(),
  detailRowEl: null,
  detailCellEl: null
};

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
  loadExpenseCategories();
  loadExpenses();
  
  // Handle CSV file input change
  document.getElementById('expensesCsvInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleExpensesCsvUpload();
    }
  });
});

// Utility functions
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function addLog(type, message) {
  const logContainer = document.getElementById('uploadLog');
  if (!logContainer) return;
  
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry ${type}`;
  logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logContainer.appendChild(logEntry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Load expense categories
async function loadExpenseCategories() {
  try {
    const response = await fetch(`${API_BASE}/api/pnl/expense-categories`);
    const payload = await response.json();
    if (payload.success && payload.data) {
      payload.data.forEach(cat => {
        expenseCategoriesMap[cat.id] = cat;
      });
    }
  } catch (error) {
    console.error('Failed to load expense categories:', error);
    addLog('error', `Ошибка загрузки категорий: ${error.message}`);
  }
}

// Load expenses
async function loadExpenses() {
  try {
    const cacheBuster = `&_t=${Date.now()}`;
    const url = `${API_BASE}/api/vat-margin/payments?direction=out&limit=1000${cacheBuster}`;
    
    const response = await fetch(url);
    const payload = await response.json();
    
    if (!payload.success) {
      throw new Error(payload.error || 'Не удалось загрузить расходы');
    }
    
    let expenses = payload.data || payload.payments || [];
    
    // Ensure only expenses (direction = 'out') are shown
    expenses = expenses.filter(e => e.direction === 'out');
    
    expensesState.items = expenses;
    
    // Update statistics
    updateStatistics(expenses);
    
    // Render table
    renderExpensesTable(expenses);
    
  } catch (error) {
    console.error('Failed to load expenses:', error);
    addLog('error', `Ошибка загрузки расходов: ${error.message}`);
    document.getElementById('expensesTableBody').innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px; color: red;">
          Ошибка загрузки: ${error.message}
        </td>
      </tr>
    `;
  }
}

// Update statistics
function updateStatistics(expenses) {
  const total = expenses.length;
  const uncategorized = expenses.filter(e => !e.expense_category_id).length;
  const categorized = total - uncategorized;
  
  document.getElementById('totalExpenses').textContent = total;
  document.getElementById('uncategorizedExpenses').textContent = uncategorized;
  document.getElementById('categorizedExpenses').textContent = categorized;
}

// Render expenses table (without action buttons)
function renderExpensesTable(expenses) {
  const tbody = document.getElementById('expensesTableBody');
  
  if (expenses.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px;">
          Нет расходов для отображения
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = expenses.map(expense => {
    const categoryName = expense.expense_category_id 
      ? (expenseCategoriesMap[expense.expense_category_id]?.name || `ID: ${expense.expense_category_id}`)
      : '<span style="color: #999;">Без категории</span>';
    
    const confidenceBadge = expense.match_confidence && expense.match_confidence >= 90
      ? `<span style="background: #10b981; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; margin-left: 5px;" title="Автоматически категоризировано с уверенностью ${expense.match_confidence}%">${expense.match_confidence}%</span>`
      : '';
    
    const date = expense.operation_date || expense.date || '';
    const formattedDate = date ? new Date(date).toLocaleDateString('ru-RU') : '';
    
    return `
      <tr class="expense-row" data-expense-id="${expense.id}" style="cursor: pointer;">
        <td>${formattedDate}</td>
        <td class="expense-description" title="${escapeHtml(expense.description || '')}">
          ${escapeHtml(expense.description || 'Без описания')}
        </td>
        <td>${escapeHtml(expense.payer_name || expense.payer || '')}</td>
        <td class="expense-amount">
          ${expense.amount ? `${expense.amount.toFixed(2)} ${expense.currency || 'PLN'}` : ''}
        </td>
        <td>${categoryName}${confidenceBadge}</td>
        <td>
          ${expense.expense_category_id ? '' : '<span style="color: #999;">Кликните для категоризации</span>'}
        </td>
      </tr>
    `;
  }).join('');
  
  // Add click handlers to rows
  tbody.querySelectorAll('tr[data-expense-id]').forEach(row => {
    row.addEventListener('click', handleExpenseRowClick);
  });
  
  highlightSelectedExpenseRow();
  
  // If there's a selected expense, reload its details
  if (expensesState.selectedId) {
    const selectedRow = getExpenseRowElement(expensesState.selectedId);
    if (selectedRow) {
      selectExpenseRow(selectedRow, { skipScroll: true }).catch(() => {
        clearExpenseDetailRow();
      });
    } else {
      clearExpenseDetailRow();
    }
  } else {
    clearExpenseDetailRow();
  }
}

// Handle expense row click
function handleExpenseRowClick(event) {
  const row = event.currentTarget || event.target.closest('tr[data-expense-id]');
  if (!row || !row.dataset.expenseId) return;
  selectExpenseRow(row).catch((error) => {
    console.warn('selectExpenseRow error:', error);
  });
}

// Highlight selected expense row
function highlightSelectedExpenseRow() {
  const tbody = document.getElementById('expensesTableBody');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr[data-expense-id]');
  rows.forEach((row) => {
    row.classList.toggle('selected', expensesState.selectedId && row.dataset.expenseId === expensesState.selectedId);
  });
}

// Get expense row element
function getExpenseRowElement(expenseId) {
  const tbody = document.getElementById('expensesTableBody');
  if (!tbody) return null;
  const idKey = String(expenseId);
  try {
    const selector = `tr[data-expense-id="${CSS && CSS.escape ? CSS.escape(idKey) : idKey}"]`;
    return tbody.querySelector(selector);
  } catch (error) {
    return tbody.querySelector(`tr[data-expense-id="${idKey.replace(/"/g, '\\"')}"]`);
  }
}

// Clear expense detail row
function clearExpenseDetailRow() {
  if (expensesState.detailRowEl && expensesState.detailRowEl.parentNode) {
    expensesState.detailRowEl.remove();
  }
  expensesState.detailRowEl = null;
  expensesState.detailCellEl = null;
}

// Ensure expense detail row exists
function ensureExpenseDetailRow(anchorRow) {
  if (!anchorRow || !anchorRow.parentNode) {
    clearExpenseDetailRow();
    return { detailRow: null, detailCell: null };
  }

  const anchorId = anchorRow.dataset.expenseId;

  if (expensesState.detailRowEl && expensesState.detailRowEl.dataset.anchorId === anchorId) {
    expensesState.detailCellEl.colSpan = anchorRow.children.length;
    return { detailRow: expensesState.detailRowEl, detailCell: expensesState.detailCellEl };
  }

  clearExpenseDetailRow();

  const detailRow = document.createElement('tr');
  detailRow.className = 'payment-detail-row';
  detailRow.dataset.anchorId = anchorId;

  const detailCell = document.createElement('td');
  detailCell.colSpan = anchorRow.children.length;
  detailCell.className = 'payment-detail-cell';
  detailCell.innerHTML = '<div class="payment-detail-placeholder">Загрузка деталей расхода...</div>';

  detailRow.appendChild(detailCell);

  if (anchorRow.nextSibling) {
    anchorRow.parentNode.insertBefore(detailRow, anchorRow.nextSibling);
  } else {
    anchorRow.parentNode.appendChild(detailRow);
  }

  expensesState.detailRowEl = detailRow;
  expensesState.detailCellEl = detailCell;

  return { detailRow, detailCell };
}

// Select expense row and load details
async function selectExpenseRow(row, { forceReload = false, skipScroll = false } = {}) {
  if (!row) return;

  const expenseId = row.dataset.expenseId;
  const idKey = String(expenseId);

  expensesState.selectedId = idKey;
  highlightSelectedExpenseRow();

  const { detailCell } = ensureExpenseDetailRow(row);
  if (!detailCell) {
    addLog('warning', 'Не удалось открыть панель детализации для выбранного расхода');
    return;
  }

  detailCell.innerHTML = '<div class="payment-detail-placeholder">Загрузка деталей расхода...</div>';

  if (!skipScroll) {
    row.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  try {
    const detail = await loadExpenseDetails(idKey, { forceReload });
    renderExpenseDetail(detail, detailCell);
  } catch (error) {
    addLog('error', `Не удалось получить детали расхода: ${error.message}`);
    detailCell.innerHTML = `<div class="payment-detail-placeholder">Не удалось получить детали: ${escapeHtml(error.message)}</div>`;
  }
}

// Load expense details (with suggestions from OpenAI)
async function loadExpenseDetails(expenseId, { forceReload = false } = {}) {
  const cacheKey = String(expenseId);
  if (!forceReload && expensesState.details.has(cacheKey)) {
    return expensesState.details.get(cacheKey);
  }

  // Load expense data
  const expenseResponse = await fetch(`${API_BASE}/api/payments/${encodeURIComponent(cacheKey)}`);
  const expensePayload = await expenseResponse.json();
  
  if (!expensePayload.success || !expensePayload.data) {
    throw new Error(expensePayload.error || 'Не удалось получить данные расхода');
  }

  const expense = expensePayload.data;

  // Load suggestions (this will trigger OpenAI if no rules match)
  const suggestionsResponse = await fetch(`${API_BASE}/api/payments/${encodeURIComponent(cacheKey)}/expense-category-suggestions`);
  const suggestionsPayload = await suggestionsResponse.json();
  
  const suggestions = suggestionsPayload.success ? (suggestionsPayload.data || []) : [];

  const result = {
    expense,
    suggestions
  };

  expensesState.details.set(cacheKey, result);
  return result;
}

// Render expense detail (similar to renderPaymentDetail)
function renderExpenseDetail(data, target = expensesState.detailCellEl) {
  if (!target) return;
  if (!data || !data.expense) {
    target.innerHTML = '<div class="payment-detail-placeholder">Не удалось загрузить данные расхода</div>';
    return;
  }

  const { expense, suggestions = [] } = data;
  const categoryName = expense.expense_category_id 
    ? (expenseCategoriesMap[expense.expense_category_id]?.name || `ID: ${expense.expense_category_id}`)
    : 'Без категории';

  const date = expense.operation_date || expense.date || '';
  const formattedDate = date ? new Date(date).toLocaleDateString('ru-RU') : '';

  const metaRows = [
    renderExpenseMeta('ID платежа', escapeHtml(String(expense.id))),
    renderExpenseMeta('Дата', formattedDate || '—'),
    renderExpenseMeta('Сумма', expense.amount ? `${expense.amount.toFixed(2)} ${expense.currency || 'PLN'}` : '—'),
    renderExpenseMeta('Плательщик', escapeHtml(expense.payer_name || expense.payer || '—')),
    renderExpenseMeta('Описание', escapeHtml(expense.description || '—')),
    renderExpenseMeta('Категория', categoryName),
    renderExpenseMeta('Уверенность', expense.match_confidence ? `${Math.round(expense.match_confidence)}%` : '—')
  ];

  const suggestionItems = suggestions.length > 0
    ? suggestions.map((suggestion) => {
      const isSelected = suggestion.categoryId === expense.expense_category_id;
      const categoryName = expenseCategoriesMap[suggestion.categoryId]?.name || `ID: ${suggestion.categoryId}`;
      const isPerfectMatch = suggestion.confidence >= 100;
      const cardClass = `candidate-card${isSelected ? ' selected' : ''}`;
      
      return `
        <li
          class="${cardClass}"
          data-category-id="${escapeHtml(String(suggestion.categoryId))}"
        >
          <div class="candidate-title">${escapeHtml(categoryName)}</div>
          <div class="candidate-meta">
            <span>⭐ ${suggestion.confidence}% уверенности</span>
            ${isPerfectMatch ? '<span style="background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85em;">100% - правило будет создано</span>' : ''}
            ${suggestion.matchDetails ? `<span class="candidate-reason">${escapeHtml(suggestion.matchDetails)}</span>` : ''}
            ${suggestion.patternType === 'ai' ? '<span style="background: #6366f1; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85em;">AI</span>' : ''}
          </div>
        </li>
      `;
    }).join('')
    : '<li class="candidate-card disabled">Предложения не найдены. Выберите категорию вручную.</li>';

  target.innerHTML = `
    <div class="payment-detail" data-expense-id="${escapeHtml(String(expense.id))}">
      <header>
        <h3>Расход ${expense.amount ? `${expense.amount.toFixed(2)} ${expense.currency || 'PLN'}` : ''}</h3>
      </header>
      <div class="payment-meta">
        ${metaRows.join('')}
      </div>
      <div class="manual-match-panel">
        <label for="expense-category-select">Категория расходов</label>
        <select id="expense-category-select" class="form-control">
          <option value="">Выберите категорию...</option>
          ${Object.values(expenseCategoriesMap).map(cat => 
            `<option value="${cat.id}" ${cat.id === expense.expense_category_id ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`
          ).join('')}
        </select>
        <span class="manual-match-hint">Выберите категорию из списка или кликните на предложение ниже.</span>
        <div class="manual-match-actions">
          <button class="btn btn-primary" id="expense-save">💾 Сохранить</button>
          <button class="btn btn-secondary" id="expense-reset">↩️ Очистить</button>
          <button class="btn btn-danger" id="expense-delete">🗑️ Удалить</button>
        </div>
      </div>
      <div class="candidate-panel">
        <h4>Возможные совпадения</h4>
        <ul class="candidate-list">
          ${suggestionItems}
        </ul>
      </div>
    </div>
  `;

  setupExpenseDetailHandlers(expense.id, target);
}

// Render expense meta row
function renderExpenseMeta(label, value) {
  return `
    <div class="payment-meta-row">
      <span class="payment-meta-label">${escapeHtml(label)}</span>
      <span class="payment-meta-value">${value}</span>
    </div>
  `;
}

// Setup expense detail handlers
function setupExpenseDetailHandlers(expenseId, root = expensesState.detailCellEl) {
  if (!root) return;

  const categorySelect = root.querySelector('#expense-category-select');
  const saveButton = root.querySelector('#expense-save');
  const resetButton = root.querySelector('#expense-reset');
  const deleteButton = root.querySelector('#expense-delete');
  const candidateCards = root.querySelectorAll('.candidate-card');

  // Handle candidate card clicks
  candidateCards.forEach((card) => {
    if (card.classList.contains('disabled')) return;
    card.addEventListener('click', () => {
      const categoryId = card.dataset.categoryId;
      if (categorySelect && categoryId) {
        categorySelect.value = categoryId;
        categorySelect.focus();
      }
      candidateCards.forEach((node) => {
        node.classList.toggle('selected', node === card);
      });
    });
  });

  // Handle save button
  saveButton?.addEventListener('click', async () => {
    if (!categorySelect) return;
    const categoryId = categorySelect.value.trim();
    if (!categoryId) {
      addLog('warning', 'Выберите категорию перед сохранением');
      categorySelect.focus();
      return;
    }

    try {
      setButtonLoading(saveButton, true, 'Сохранение...');
      
      // Find the selected suggestion to get pattern info
      const selectedCard = root.querySelector('.candidate-card.selected');
      let patternType = null;
      let patternValue = '';
      let confidence = 0;
      
      if (selectedCard) {
        const suggestion = expensesState.details.get(String(expenseId))?.suggestions?.find(
          s => String(s.categoryId) === selectedCard.dataset.categoryId
        );
        if (suggestion) {
          patternType = suggestion.patternType;
          patternValue = suggestion.patternValue || '';
          confidence = suggestion.confidence || 0;
        }
      }

      const response = await fetch(`${API_BASE}/api/payments/${encodeURIComponent(expenseId)}/expense-category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenseCategoryId: parseInt(categoryId),
          createMapping: patternType !== null,
          patternType: patternType,
          patternValue: patternValue,
          priority: confidence >= 100 ? 10 : Math.round(confidence / 10)
        })
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || payload.message || 'Не удалось сохранить категорию');
      }

      // Reload expenses
      await loadExpenses();
      
      // Reload detail if still selected
      if (expensesState.selectedId === String(expenseId)) {
        const updatedRow = getExpenseRowElement(expenseId);
        if (updatedRow) {
          selectExpenseRow(updatedRow, { skipScroll: true, forceReload: true }).catch(() => clearExpenseDetailRow());
        }
      }

      addLog('success', `Категория присвоена расходу ${expenseId}`);
    } catch (error) {
      addLog('error', `Не удалось сохранить категорию: ${error.message}`);
    } finally {
      setButtonLoading(saveButton, false, '💾 Сохранить');
    }
  });

  // Handle reset button
  resetButton?.addEventListener('click', async () => {
    try {
      setButtonLoading(resetButton, true, 'Очистка...');
      
      const response = await fetch(`${API_BASE}/api/payments/${encodeURIComponent(expenseId)}/expense-category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenseCategoryId: null
        })
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || payload.message || 'Не удалось очистить категорию');
      }

      // Reload expenses
      await loadExpenses();
      
      // Reload detail if still selected
      if (expensesState.selectedId === String(expenseId)) {
        const updatedRow = getExpenseRowElement(expenseId);
        if (updatedRow) {
          selectExpenseRow(updatedRow, { skipScroll: true, forceReload: true }).catch(() => clearExpenseDetailRow());
        }
      }

      addLog('info', `Категория расхода ${expenseId} очищена`);
    } catch (error) {
      addLog('error', `Не удалось очистить категорию: ${error.message}`);
    } finally {
      setButtonLoading(resetButton, false, '↩️ Очистить');
    }
  });

  // Handle delete button
  deleteButton?.addEventListener('click', async () => {
    if (!confirm('Вы уверены, что хотите удалить этот расход?')) {
      return;
    }

    try {
      setButtonLoading(deleteButton, true, 'Удаление...');
      
      const response = await fetch(`${API_BASE}/api/vat-margin/payments/${encodeURIComponent(expenseId)}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        let errorMessage = 'Не удалось удалить расход';
        try {
          const payload = await response.json();
          errorMessage = payload.error || payload.message || errorMessage;
        } catch (e) {
          // If response is not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      expensesState.selectedId = null;
      clearExpenseDetailRow();
      
      // Reload expenses
      await loadExpenses();

      addLog('success', `Расход ${expenseId} удален`);
    } catch (error) {
      addLog('error', `Не удалось удалить расход: ${error.message}`);
    } finally {
      setButtonLoading(deleteButton, false, '🗑️ Удалить');
    }
  });
}

// Utility function to set button loading state
function setButtonLoading(button, loading, text) {
  if (!button) return;
  button.disabled = loading;
  button.textContent = text;
}

// Handle CSV upload
async function handleExpensesCsvUpload() {
  const fileInput = document.getElementById('expensesCsvInput');
  const thresholdInput = document.getElementById('autoMatchThreshold');
  const file = fileInput.files?.[0];
  
  if (!file) {
    addLog('warning', 'Выберите файл для загрузки');
    return;
  }
  
  if (!file.name.endsWith('.csv')) {
    addLog('warning', 'Поддерживаются только CSV файлы');
    return;
  }
  
  const threshold = parseInt(thresholdInput.value, 10) || 90;
  const validThreshold = Math.max(0, Math.min(100, threshold));
  
  addLog('info', `Загрузка файла ${file.name}... (порог автокатегоризации: ${validThreshold}%)`);
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch(`${API_BASE}/api/payments/import-expenses?autoMatchThreshold=${validThreshold}`, {
      method: 'POST',
      body: formData
    });
    
    const payload = await response.json();
    
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || payload.message || 'Не удалось загрузить файл');
    }
    
    const stats = payload.data || {};
    const autoMatched = stats.autoMatched || stats.categorized || 0;
    const uncategorized = stats.uncategorized || 0;
    const threshold = stats.autoMatchThreshold || 90;
    
    if (autoMatched > 0) {
      addLog('success', `Файл загружен. Обработано: ${stats.processed || 0}, автоматически категоризировано: ${autoMatched} (>=${threshold}%), без категории: ${uncategorized}`);
    } else {
      addLog('success', `Файл загружен. Обработано: ${stats.processed || 0}, без категории: ${uncategorized}`);
    }
    
    // Clear file input
    fileInput.value = '';
    
    // Reload expenses
    loadExpenses();
    
  } catch (error) {
    console.error('CSV upload error:', error);
    addLog('error', `Ошибка загрузки CSV: ${error.message}`);
  }
}

