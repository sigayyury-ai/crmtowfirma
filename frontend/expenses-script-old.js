const API_BASE = window.location.origin;

let expenseCategoriesMap = {};
let currentFilter = 'all';

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    loadExpenseCategories();
    // By default, show only uncategorized expenses
    document.querySelector('input[name="filter"][value="uncategorized"]').checked = true;
    currentFilter = 'uncategorized';
    loadExpenses();
    
    // Handle CSV file input change
    document.getElementById('expensesCsvInput').addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleExpensesCsvUpload();
        }
    });
});

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
    const filter = document.querySelector('input[name="filter"]:checked')?.value || 'all';
    currentFilter = filter;
    
    try {
        // Add cache busting to ensure fresh data
        const cacheBuster = `&_t=${Date.now()}`;
        let url = `${API_BASE}/api/vat-margin/payments?direction=out&limit=1000${cacheBuster}`;
        
        if (filter === 'uncategorized') {
            url += '&uncategorized=true';
        } else if (filter === 'categorized') {
            // We'll filter on client side for now
        }
        
        const response = await fetch(url);
        const payload = await response.json();
        
        if (!payload.success) {
            throw new Error(payload.error || 'Не удалось загрузить расходы');
        }
        
        let expenses = payload.data || payload.payments || [];
        
        // Ensure only expenses (direction = 'out') are shown
        expenses = expenses.filter(e => {
            if (e.direction !== 'out') {
                console.warn('Found non-expense payment:', e);
                return false;
            }
            return true;
        });
        
        // Filter categorized if needed
        if (filter === 'categorized') {
            expenses = expenses.filter(e => e.expense_category_id !== null && e.expense_category_id !== undefined);
        } else if (filter === 'uncategorized') {
            expenses = expenses.filter(e => !e.expense_category_id);
        }
        
        console.log(`Loaded ${expenses.length} expenses (filter: ${filter})`);
        
        // Update statistics
        updateStatistics(expenses);
        
        // Render table
        renderExpensesTable(expenses);
        
        // If showing uncategorized, try to load suggestions for first few expenses
        if (filter === 'uncategorized' && expenses.length > 0) {
            loadSuggestionsForExpenses(expenses.slice(0, 10)); // Load suggestions for first 10
        }
        
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

// Render expenses table
function renderExpensesTable(expenses) {
    const tbody = document.getElementById('expensesTableBody');
    
    if (expenses.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px;">
                    ${currentFilter === 'uncategorized' 
                        ? 'Все расходы категоризированы! 🎉' 
                        : 'Нет расходов для отображения'}
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = expenses.map(expense => {
        const categoryName = expense.expense_category_id 
            ? (expenseCategoriesMap[expense.expense_category_id]?.name || `ID: ${expense.expense_category_id}`)
            : '<span style="color: #999;">Без категории</span>';
        
        // Show confidence if expense was auto-matched
        const confidenceBadge = expense.match_confidence && expense.match_confidence >= 90
            ? `<span style="background: #10b981; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; margin-left: 5px;" title="Автоматически категоризировано с уверенностью ${expense.match_confidence}%">${expense.match_confidence}%</span>`
            : '';
        
        const date = expense.operation_date || expense.date || '';
        const formattedDate = date ? new Date(date).toLocaleDateString('ru-RU') : '';
        
        // Check if we have suggestions cached for this expense
        const hasSuggestions = window.expenseSuggestionsCache && window.expenseSuggestionsCache[expense.id];
        const suggestionsCount = hasSuggestions ? window.expenseSuggestionsCache[expense.id].length : 0;
        
        return `
            <tr class="expense-item" data-expense-id="${expense.id}">
                <td>${formattedDate}</td>
                <td class="expense-description" title="${escapeHtml(expense.description || '')}">
                    ${escapeHtml(expense.description || 'Без описания')}
                </td>
                <td>${escapeHtml(expense.payer_name || expense.payer || '')}</td>
                <td class="expense-amount">
                    ${expense.amount ? `${expense.amount.toFixed(2)} ${expense.currency || 'PLN'}` : ''}
                </td>
                <td>${categoryName}${confidenceBadge}</td>
                <td class="expense-actions">
                    ${!expense.expense_category_id ? `
                        ${suggestionsCount > 0 ? `
                            <span class="suggestions-badge" onclick="showSuggestions(${expense.id})" title="Найдено ${suggestionsCount} предложений">
                                ${suggestionsCount} предложений
                            </span>
                        ` : `
                            <button class="btn btn-sm btn-primary" onclick="showSuggestions(${expense.id})">
                                Предложения
                            </button>
                        `}
                        <button class="btn btn-sm btn-secondary" onclick="showManualCategorySelect(${expense.id})">
                            Выбрать
                        </button>
                    ` : `
                        <button class="btn btn-sm btn-secondary" onclick="changeCategory(${expense.id})">
                            Изменить
                        </button>
                    `}
                    <button class="btn btn-sm btn-danger" onclick="deleteExpense(${expense.id})" title="Удалить ошибочный расход">
                        🗑️
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Load suggestions for multiple expenses (for background loading)
async function loadSuggestionsForExpenses(expenses) {
    if (!window.expenseSuggestionsCache) {
        window.expenseSuggestionsCache = {};
    }
    
    // Load suggestions for expenses without category
    const uncategorizedExpenses = expenses.filter(e => !e.expense_category_id);
    
    const promises = uncategorizedExpenses.map(async (expense) => {
        try {
            const response = await fetch(`${API_BASE}/api/payments/${expense.id}/expense-category-suggestions`);
            const payload = await response.json();
            
            if (payload.success && payload.data && payload.data.length > 0) {
                window.expenseSuggestionsCache[expense.id] = payload.data;
                // Update the badge in the table if visible
                updateExpenseRowBadge(expense.id, payload.data.length);
            }
        } catch (error) {
            console.error(`Failed to load suggestions for expense ${expense.id}:`, error);
        }
    });
    
    await Promise.all(promises);
}

// Update expense row badge with suggestions count
function updateExpenseRowBadge(expenseId, count) {
    const row = document.querySelector(`tr[data-expense-id="${expenseId}"]`);
    if (!row) return;
    
    const actionsCell = row.querySelector('.expense-actions');
    if (!actionsCell) return;
    
    // Find the suggestions button and update it
    const suggestionsBtn = actionsCell.querySelector('button[onclick*="showSuggestions"]');
    if (suggestionsBtn && count > 0) {
        suggestionsBtn.outerHTML = `
            <span class="suggestions-badge" onclick="showSuggestions(${expenseId})" title="Найдено ${count} предложений">
                ${count} предложений
            </span>
        `;
    }
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
        
        // Reload expenses (keep uncategorized filter to show new expenses)
        if (currentFilter !== 'uncategorized') {
            document.querySelector('input[name="filter"][value="uncategorized"]').checked = true;
            currentFilter = 'uncategorized';
        }
        loadExpenses();
        
    } catch (error) {
        console.error('CSV upload error:', error);
        addLog('error', `Ошибка загрузки CSV: ${error.message}`);
    }
}

// Show suggestions for an expense
async function showSuggestions(expenseId) {
    try {
        // Check cache first
        let suggestions = window.expenseSuggestionsCache && window.expenseSuggestionsCache[expenseId];
        
        if (!suggestions) {
            const response = await fetch(`${API_BASE}/api/payments/${expenseId}/expense-category-suggestions`);
            const payload = await response.json();
            
            if (!payload.success) {
                throw new Error(payload.error || 'Не удалось загрузить предложения');
            }
            
            suggestions = payload.data || [];
            
            // Cache suggestions
            if (!window.expenseSuggestionsCache) {
                window.expenseSuggestionsCache = {};
            }
            window.expenseSuggestionsCache[expenseId] = suggestions;
        }
        
        const expense = await getExpenseDetails(expenseId);
        
        if (!expense) {
            throw new Error('Не удалось загрузить данные расхода');
        }
        
        showSuggestionsModal(expense, suggestions);
        
    } catch (error) {
        console.error('Failed to load suggestions:', error);
        addLog('error', `Ошибка загрузки предложений: ${error.message}`);
    }
}

// Get expense details
async function getExpenseDetails(expenseId) {
    try {
        const response = await fetch(`${API_BASE}/api/payments/${expenseId}`);
        const payload = await response.json();
        
        if (payload.success && payload.data) {
            return payload.data;
        }
        return null;
    } catch (error) {
        console.error('Failed to get expense details:', error);
        return null;
    }
}

// Show suggestions modal
function showSuggestionsModal(expense, suggestions) {
    const modal = document.getElementById('suggestionsModal');
    const title = document.getElementById('suggestionsModalTitle');
    const body = document.getElementById('suggestionsModalBody');
    
    title.textContent = `Предложения для: ${escapeHtml(expense.description || 'Без описания')}`;
    
    if (suggestions.length === 0) {
        body.innerHTML = `
            <p>Нет предложений для этого расхода.</p>
            <button class="btn btn-primary" onclick="closeSuggestionsModal(); showManualCategorySelect(${expense.id})">
                Выбрать категорию вручную
            </button>
        `;
    } else {
        body.innerHTML = `
            <div style="margin-bottom: 15px;">
                <strong>Сумма:</strong> ${expense.amount} ${expense.currency || 'PLN'}<br>
                <strong>Плательщик:</strong> ${escapeHtml(expense.payer_name || 'Не указан')}
            </div>
            <h4>Предложения:</h4>
            ${suggestions.map(suggestion => {
                const categoryName = expenseCategoriesMap[suggestion.categoryId]?.name || `ID: ${suggestion.categoryId}`;
                const isPerfectMatch = suggestion.confidence >= 100;
                return `
                    <div class="suggestion-item ${isPerfectMatch ? 'high-confidence' : ''}" style="margin-bottom: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong>${categoryName}</strong>
                                <span style="color: #666; margin-left: 10px;">${suggestion.confidence}% уверенности</span>
                                ${isPerfectMatch ? '<span style="background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; margin-left: 8px;">100% - правило будет создано</span>' : ''}
                                <div style="font-size: 0.9em; color: #888; margin-top: 5px;">${suggestion.matchDetails || ''}</div>
                            </div>
                            <button class="btn btn-sm btn-primary" 
                                    onclick="assignExpenseCategory(${expense.id}, ${suggestion.categoryId}, '${suggestion.patternType}', '${escapeHtml(suggestion.patternValue)}', ${suggestion.confidence}); closeSuggestionsModal();">
                                Выбрать
                            </button>
                        </div>
                    </div>
                `;
            }).join('')}
            <div style="margin-top: 20px;">
                <button class="btn btn-secondary" onclick="closeSuggestionsModal(); showManualCategorySelect(${expense.id})">
                    Выбрать категорию вручную
                </button>
            </div>
        `;
    }
    
    modal.style.display = 'block';
}

// Close suggestions modal
function closeSuggestionsModal() {
    document.getElementById('suggestionsModal').style.display = 'none';
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('suggestionsModal');
    if (event.target === modal) {
        closeSuggestionsModal();
    }
}

// Assign expense category
async function assignExpenseCategory(expenseId, categoryId, patternType, patternValue, confidence) {
    try {
        addLog('info', `Присвоение категории расходу ${expenseId}...`);
        
        const shouldCreateRule = true; // Always create rule when selecting from suggestions
        const priority = confidence >= 100 ? 10 : Math.round(confidence / 10);
        
        const response = await fetch(`${API_BASE}/api/payments/${expenseId}/expense-category`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                expenseCategoryId: categoryId,
                createMapping: shouldCreateRule,
                patternType: patternType,
                patternValue: patternValue,
                priority: priority
            })
        });
        
        const payload = await response.json();
        
        if (!response.ok || !payload.success) {
            console.error('Failed to assign category:', payload);
            throw new Error(payload.error || payload.message || 'Не удалось присвоить категорию');
        }
        
        // Verify that category was actually assigned
        const updatedPayment = payload.data?.payment;
        if (updatedPayment && updatedPayment.expense_category_id === categoryId) {
            addLog('success', `Категория присвоена расходу ${expenseId} (ID категории: ${categoryId})`);
        } else {
            console.warn('Category assignment response:', payload);
            addLog('warning', `Категория присвоена, но ответ не содержит подтверждения`);
        }
        
        // Remove from cache
        if (window.expenseSuggestionsCache) {
            delete window.expenseSuggestionsCache[expenseId];
        }
        
        // Small delay to ensure database update is complete
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Reload expenses (will keep current filter)
        loadExpenses();
        
    } catch (error) {
        console.error('Failed to assign category:', error);
        addLog('error', `Ошибка присвоения категории: ${error.message}`);
    }
}

// Show manual category selection
async function showManualCategorySelect(expenseId) {
    const expense = await getExpenseDetails(expenseId);
    if (!expense) {
        addLog('error', 'Не удалось загрузить данные расхода');
        return;
    }
    
    const categoryOptions = Object.values(expenseCategoriesMap).map(cat => 
        `<option value="${cat.id}">${cat.name}</option>`
    ).join('');
    
    const patternTypeOptions = `
        <option value="description" ${expense.description ? '' : 'disabled'}>Описание: ${expense.description ? expense.description.substring(0, 50) : 'не указано'}</option>
        <option value="payer" ${expense.payer_name ? '' : 'disabled'}>Плательщик: ${expense.payer_name || 'не указан'}</option>
    `;
    
    const dialogHtml = `
        <div class="suggestions-modal" id="manual-category-modal" style="display: block;">
            <div class="suggestions-modal-content">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h3>Выбрать категорию вручную</h3>
                    <button class="btn btn-secondary" onclick="closeManualCategoryModal()">&times;</button>
                </div>
                <div>
                    <div style="margin-bottom: 15px;">
                        <strong>Расход:</strong> ${escapeHtml(expense.description || 'Без описания')}<br>
                        <strong>Сумма:</strong> ${expense.amount} ${expense.currency || 'PLN'}
                    </div>
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label>Категория расходов:</label>
                        <select id="manual-category-select" class="form-control category-select">
                            <option value="">Выберите категорию...</option>
                            ${categoryOptions}
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label>Создать правило на основе:</label>
                        <select id="manual-pattern-type" class="form-control">
                            ${patternTypeOptions}
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label>
                            <input type="checkbox" id="manual-create-rule" checked>
                            Создать правило категоризации
                        </label>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn btn-primary" onclick="saveManualCategory(${expenseId})">Сохранить</button>
                        <button class="btn btn-secondary" onclick="closeManualCategoryModal()">Отмена</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    const dialogDiv = document.createElement('div');
    dialogDiv.innerHTML = dialogHtml;
    document.body.appendChild(dialogDiv.firstElementChild);
}

// Close manual category modal
function closeManualCategoryModal() {
    const modal = document.getElementById('manual-category-modal');
    if (modal) {
        modal.remove();
    }
}

// Save manual category
async function saveManualCategory(expenseId) {
    const categorySelect = document.getElementById('manual-category-select');
    const patternTypeSelect = document.getElementById('manual-pattern-type');
    const createRuleCheckbox = document.getElementById('manual-create-rule');
    
    const categoryId = parseInt(categorySelect.value);
    const patternType = patternTypeSelect.value;
    const createRule = createRuleCheckbox.checked;
    
    if (!categoryId) {
        addLog('warning', 'Выберите категорию');
        return;
    }
    
    if (createRule && !patternType) {
        addLog('warning', 'Выберите тип правила');
        return;
    }
    
    try {
        const expense = await getExpenseDetails(expenseId);
        if (!expense) {
            throw new Error('Не удалось загрузить данные расхода');
        }
        
        let patternValue = '';
        if (createRule) {
            if (patternType === 'description') {
                patternValue = expense.description || '';
            } else if (patternType === 'payer') {
                patternValue = expense.payer_name || '';
            }
        }
        
        await assignExpenseCategory(
            expenseId,
            categoryId,
            createRule ? patternType : null,
            patternValue,
            createRule ? 100 : 0
        );
        
        closeManualCategoryModal();
        
    } catch (error) {
        console.error('Failed to save manual category:', error);
        addLog('error', `Ошибка сохранения категории: ${error.message}`);
    }
}

// Change category
function changeCategory(expenseId) {
    showManualCategorySelect(expenseId);
}

// Add log message
function addLog(type, message) {
    const logDiv = document.getElementById('uploadLog');
    if (!logDiv) return;
    
    const timestamp = new Date().toLocaleTimeString('ru-RU');
    const color = type === 'error' ? 'red' : type === 'success' ? 'green' : type === 'warning' ? 'orange' : 'black';
    
    const logEntry = document.createElement('div');
    logEntry.style.color = color;
    logEntry.style.marginBottom = '5px';
    logEntry.textContent = `[${timestamp}] ${message}`;
    
    logDiv.appendChild(logEntry);
    logDiv.scrollTop = logDiv.scrollHeight;
}

// Delete expense
async function deleteExpense(expenseId) {
    if (!confirm('Вы уверены, что хотите удалить этот расход? Это действие нельзя отменить.')) {
        return;
    }
    
    try {
        addLog('info', `Удаление расхода ${expenseId}...`);
        
        const response = await fetch(`${API_BASE}/api/vat-margin/payments/${expenseId}`, {
            method: 'DELETE'
        });
        
        const payload = await response.json();
        
        if (!response.ok || !payload.success) {
            throw new Error(payload.error || payload.message || 'Не удалось удалить расход');
        }
        
        addLog('success', `Расход ${expenseId} удален`);
        
        // Remove from cache
        if (window.expenseSuggestionsCache) {
            delete window.expenseSuggestionsCache[expenseId];
        }
        
        // Reload expenses (will keep current filter)
        loadExpenses();
        
    } catch (error) {
        console.error('Failed to delete expense:', error);
        addLog('error', `Ошибка удаления расхода: ${error.message}`);
    }
}

// Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

