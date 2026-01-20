const API_BASE = window.location.origin;
let expenseCategoriesMap = {};
let incomeCategoriesMap = {};

// State for expense details (similar to paymentsState in vat-margin-script.js)
const expensesState = {
  items: [],
  selectedId: null,
  details: new Map(),
  detailRowEl: null,
  detailCellEl: null
};

// State for product list (used for linking expenses to products)
const expenseProductLinkState = {
  products: [],
  loaded: false,
  isLoading: false,
  error: null,
  loadPromise: null
};

let autoCategorizeInProgress = false;

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
  console.log('Expenses page loaded, initializing...');
  
  // Check if required elements exist
  const tbody = document.getElementById('expensesTableBody');
  if (!tbody) {
    console.error('expensesTableBody element not found in DOM!');
    return;
  }
  
  loadExpenseCategories();
  loadIncomeCategories();
  loadExpenses();
  
  // Handle CSV file input change
  const csvInput = document.getElementById('expensesCsvInput');
  if (csvInput) {
    csvInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleExpensesCsvUpload();
      }
    });
  } else {
    console.warn('expensesCsvInput element not found');
  }

  const autoCategorizeBtn = document.getElementById('autoCategorizeBtn');
  if (autoCategorizeBtn) {
    autoCategorizeBtn.addEventListener('click', () => {
      autoCategorizeExpenses().catch((error) => {
        console.error('Auto-categorization failed:', error);
        addLog('error', `Автокатегоризация завершилась с ошибкой: ${error.message}`);
      });
    });
  }
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
  
  // Ограничиваем количество логов до 3 последних записей
  const logEntries = logContainer.querySelectorAll('.log-entry');
  if (logEntries.length > 3) {
    // Удаляем самые старые записи, оставляя только 3 последние
    for (let i = 0; i < logEntries.length - 3; i++) {
      logEntries[i].remove();
    }
  }
  
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Filter products for autocomplete
function filterProducts(query, suggestionsContainer, searchInput, idInput) {
  const products = expenseProductLinkState.products || [];
  
  console.log('filterProducts called', {
    query,
    productsCount: products.length,
    queryLength: query?.length,
    hasContainer: !!suggestionsContainer
  });
  
  if (!suggestionsContainer) {
    console.error('filterProducts: suggestionsContainer is missing');
    return;
  }
  
  if (!query || query.length < 2) {
    suggestionsContainer.style.display = 'none';
    return;
  }
  
  const queryLower = query.toLowerCase();
  const filtered = products.filter(product => {
    const name = (product.name || '').toLowerCase();
    return name.includes(queryLower);
  }).slice(0, 10); // Limit to 10 results
  
  console.log('filtered products', {
    query,
    filteredCount: filtered.length,
    products: filtered.map(p => p.name)
  });
  
  if (filtered.length === 0) {
    suggestionsContainer.innerHTML = '<div class="suggestion-item" style="color: #999; font-style: italic; padding: 8px 12px;">Продукты не найдены</div>';
    suggestionsContainer.style.display = 'block';
    return;
  }
  
  suggestionsContainer.innerHTML = filtered.map(product => {
    const name = escapeHtml(product.name || 'Без названия');
    return `
      <div class="suggestion-item" data-product-id="${product.id}" data-product-name="${escapeHtml(product.name || '')}">
        ${name}
      </div>
    `;
  }).join('');
  
  // Add click handlers
  suggestionsContainer.querySelectorAll('.suggestion-item').forEach(item => {
    item.addEventListener('click', () => {
      const productId = item.dataset.productId;
      const productName = item.dataset.productName;
      if (productId && productName && idInput && searchInput) {
        idInput.value = productId;
        searchInput.value = productName;
        suggestionsContainer.style.display = 'none';
        console.log('Product selected', { productId, productName });
      }
    });
  });
  
  suggestionsContainer.style.display = 'block';
}

async function ensureExpenseProductsLoaded({ force = false } = {}) {
  if (expenseProductLinkState.loaded && !force) {
    return expenseProductLinkState.products;
  }

  if (expenseProductLinkState.loadPromise && !force) {
    return expenseProductLinkState.loadPromise;
  }

  expenseProductLinkState.isLoading = true;
  expenseProductLinkState.error = null;

  const loader = fetch(`${API_BASE}/api/products/in-progress`)
    .then((response) => response.json())
    .then((payload) => {
      if (!payload.success) {
        throw new Error(payload.error || 'Не удалось получить продукты');
      }
      const products = Array.isArray(payload.data) ? payload.data : [];
      console.log('Products loaded for expenses (in_progress only)', {
        count: products.length,
        products: products.slice(0, 5).map(p => ({ 
          id: p.id, 
          name: p.name, 
          status: p.calculation_status || 'unknown' 
        }))
      });
      expenseProductLinkState.products = products;
      expenseProductLinkState.loaded = true;
      expenseProductLinkState.error = null;
      return products;
    })
    .catch((error) => {
      expenseProductLinkState.error = error.message || 'Не удалось получить продукты';
      addLog('warning', `Не удалось получить список продуктов: ${expenseProductLinkState.error}`);
      throw error;
    })
    .finally(() => {
      expenseProductLinkState.isLoading = false;
      expenseProductLinkState.loadPromise = null;
    });

  expenseProductLinkState.loadPromise = loader;
  return loader;
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
    addLog('error', `Ошибка загрузки категорий расходов: ${error.message}`);
  }
}

// Load income categories
async function loadIncomeCategories() {
  try {
    const response = await fetch(`${API_BASE}/api/pnl/categories`);
    const payload = await response.json();
    if (payload.success && payload.data) {
      payload.data.forEach(cat => {
        incomeCategoriesMap[cat.id] = cat;
      });
    }
  } catch (error) {
    console.error('Failed to load income categories:', error);
    addLog('error', `Ошибка загрузки категорий доходов: ${error.message}`);
  }
}

// Load expenses/income - show payments based on filter
async function loadExpenses() {
  const tbody = document.getElementById('expensesTableBody');
  if (!tbody) {
    console.error('expensesTableBody element not found!');
    return;
  }

  try {
    // Show loading state
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px;">
          Загрузка платежей...
        </td>
      </tr>
    `;

    // Get current direction filter
    const cacheBuster = `&_t=${Date.now()}`;
    const url = `${API_BASE}/api/vat-margin/payments?direction=out&limit=10000${cacheBuster}`;
    const currentDirection = 'out';
    
    console.log('Loading payments from:', url);
    addLog('info', `Загрузка расходов из: ${url}`);
    
    let response;
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout
      
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
      if (fetchError.name === 'AbortError') {
        throw new Error('Превышено время ожидания ответа от сервера (30 секунд)');
      } else if (fetchError.message && (fetchError.message.includes('Failed to fetch') || fetchError.message.includes('ERR_EMPTY_RESPONSE'))) {
        throw new Error('Сервер не отвечает. Проверьте, что сервер запущен и доступен. Возможно, сервер упал с ошибкой - проверьте логи сервера.');
      }
      throw fetchError;
    }
    
    if (!response.ok) {
      let errorText = '';
      try {
        errorText = await response.text();
        console.error('API error response:', errorText);
      } catch (e) {
        errorText = `HTTP ${response.status}: ${response.statusText}`;
      }
      throw new Error(errorText || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    const payload = await response.json();
    console.log('API response:', { 
      success: payload.success, 
      error: payload.error,
      dataLength: payload.data?.length, 
      paymentsLength: payload.payments?.length,
      fullPayload: payload
    });
    
    addLog('info', `API ответ: success=${payload.success}, data.length=${payload.data?.length || 0}, payments.length=${payload.payments?.length || 0}`);
    
    if (!payload.success) {
      throw new Error(payload.error || 'Не удалось загрузить расходы');
    }
    
    let payments = payload.data || payload.payments || [];
    console.log('Raw payments count:', payments.length);
    console.log('Sample payments:', payments.slice(0, 3));
    
    // Дедупликация: убираем дубликаты по ID, дате, сумме и описанию
    const seenPayments = new Map();
    const uniquePayments = [];
    let duplicatesCount = 0;
    
    for (const payment of payments) {
      if (!payment || !payment.id) {
        continue;
      }
      
      // Создаем ключ для дедупликации: ID платежа (самый надежный способ)
      const key = `id_${payment.id}`;
      
      if (seenPayments.has(key)) {
        duplicatesCount++;
        console.warn('Duplicate payment found by ID:', {
          id: payment.id,
          date: payment.operation_date,
          amount: payment.amount,
          description: payment.description?.substring(0, 50)
        });
        continue;
      }
      
      // Также проверяем дубликаты по дате, сумме и началу описания (для случаев когда один платеж импортирован дважды с разными ID)
      const date = payment.operation_date || '';
      const amount = payment.amount || 0;
      const descriptionStart = (payment.description || '').substring(0, 50).toLowerCase().trim();
      const duplicateKey = `${date}_${amount}_${descriptionStart}`;
      
      if (seenPayments.has(duplicateKey)) {
        duplicatesCount++;
        console.warn('Duplicate payment found by date/amount/description:', {
          id: payment.id,
          date: payment.operation_date,
          amount: payment.amount,
          description: payment.description?.substring(0, 50),
          existingId: seenPayments.get(duplicateKey).id
        });
        continue;
      }
      
      seenPayments.set(key, payment);
      seenPayments.set(duplicateKey, payment);
      uniquePayments.push(payment);
    }
    
    if (duplicatesCount > 0) {
      addLog('warning', `Найдено дубликатов: ${duplicatesCount}. Показано уникальных: ${uniquePayments.length}`);
      console.warn(`Removed ${duplicatesCount} duplicate payments`);
    }
    
    payments = uniquePayments;
    
    addLog('info', `Получено расходов: ${payments.length}${duplicatesCount > 0 ? ` (удалено дубликатов: ${duplicatesCount})` : ''}`);
    
    if (payments.length === 0) {
      const message = 'Нет расходов в базе данных';
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 40px; color: #666;">
            <strong style="font-size: 1.2em;">${message}</strong>
          </td>
        </tr>
      `;
      expensesState.items = [];
      updateStatistics([]);
      return;
    }
    
    // Store all payments in state (для фильтрации)
    expensesState.items = payments;
    
    // Обновляем фильтр по категориям и применяем текущий выбор
    updateCategoryFilter('out');
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter && !categoryFilter.value) {
      categoryFilter.value = 'null';
    }
    
    filterExpenses();
    
  } catch (error) {
    console.error('Failed to load expenses:', error);
    addLog('error', `Ошибка загрузки расходов: ${error.message}`);
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 40px; color: red;">
            Ошибка загрузки: ${error.message}
            <br><small>Проверьте консоль браузера для подробностей</small>
          </td>
        </tr>
      `;
    }
  }
}

// Update statistics
function updateStatistics(payments) {
  const total = payments.length;
  const uncategorized = payments.filter((payment) => !payment.expense_category_id).length;
  const categorized = total - uncategorized;
  
  document.getElementById('totalExpenses').textContent = total;
  document.getElementById('uncategorizedExpenses').textContent = uncategorized;
  document.getElementById('categorizedExpenses').textContent = categorized;
}

// Update category filter dropdown based on direction
function updateCategoryFilter(direction) {
  const categoryFilter = document.getElementById('categoryFilter');
  if (!categoryFilter) return;
  
  const previousValue = categoryFilter.value || '';
  
  // Keep "Все категории" and "Без категории" options
  categoryFilter.innerHTML = `
    <option value="">Все категории</option>
    <option value="null">Без категории</option>
  `;
  
  if (direction === 'in') {
    // Show income categories
    Object.values(incomeCategoriesMap).forEach(cat => {
      const option = document.createElement('option');
      option.value = cat.id;
      option.textContent = cat.name;
      categoryFilter.appendChild(option);
    });
  } else if (direction === 'out') {
    // Show expense categories
    Object.values(expenseCategoriesMap).forEach(cat => {
      const option = document.createElement('option');
      option.value = cat.id;
      option.textContent = cat.name;
      categoryFilter.appendChild(option);
    });
  } else {
    // Show both categories (for 'all')
    const allCategories = [
      ...Object.values(expenseCategoriesMap).map(cat => ({ ...cat, type: 'expense' })),
      ...Object.values(incomeCategoriesMap).map(cat => ({ ...cat, type: 'income' }))
    ];
    allCategories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat.id;
      option.textContent = `${cat.name} (${cat.type === 'expense' ? 'расход' : 'доход'})`;
      categoryFilter.appendChild(option);
    });
  }

  if (previousValue && Array.from(categoryFilter.options).some((opt) => opt.value === previousValue)) {
    categoryFilter.value = previousValue;
  }
}

// Render expenses/income table
function renderExpensesTable(payments) {
  const tbody = document.getElementById('expensesTableBody');
  
  if (payments.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px;">
          Нет расходов для отображения
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = payments.map(payment => {
    const isIncome = payment.direction === 'in';
    const isExpense = payment.direction === 'out';
    
    // Get category name based on direction
    let categoryName = '';
    let categoryId = null;
    let categorySelect = '';
    
    if (isIncome) {
      categoryId = payment.income_category_id;
      categoryName = categoryId 
        ? (incomeCategoriesMap[categoryId]?.name || `ID: ${categoryId}`)
        : '<span style="color: #999;">Без категории</span>';
      
      // Build income category select dropdown
      const categoryOptions = Object.values(incomeCategoriesMap).map(cat => 
        `<option value="${cat.id}" ${cat.id === categoryId ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`
      ).join('');
      
      categorySelect = `
        <select 
          class="category-select-inline" 
          data-payment-id="${payment.id}"
          data-category-type="income"
          style="min-width: 180px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9em;"
          onchange="handleQuickCategoryChange(event, ${payment.id}, 'income')"
          onclick="event.stopPropagation();"
          autocomplete="off"
          data-lpignore="true"
        >
          <option value="">-- Без категории --</option>
          ${categoryOptions}
        </select>
      `;
    } else if (isExpense) {
      categoryId = payment.expense_category_id;
      categoryName = categoryId 
        ? (expenseCategoriesMap[categoryId]?.name || `ID: ${categoryId}`)
        : '<span style="color: #999;">Без категории</span>';
      
      // Build expense category select dropdown
      const categoryOptions = Object.values(expenseCategoriesMap).map(cat => 
        `<option value="${cat.id}" ${cat.id === categoryId ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`
      ).join('');
      
      categorySelect = `
        <select 
          class="category-select-inline" 
          data-payment-id="${payment.id}"
          data-category-type="expense"
          style="min-width: 180px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9em;"
          onchange="handleQuickCategoryChange(event, ${payment.id}, 'expense')"
          onclick="event.stopPropagation();"
          autocomplete="off"
          data-lpignore="true"
        >
          <option value="">-- Без категории --</option>
          ${categoryOptions}
        </select>
      `;
    }
    
    const confidenceBadge = payment.match_confidence && payment.match_confidence >= 90
      ? `<span style="background: #10b981; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; margin-left: 5px;" title="Автоматически категоризировано с уверенностью ${payment.match_confidence}%">${payment.match_confidence}%</span>`
      : '';
    
    const date = payment.operation_date || payment.date || '';
    const formattedDate = date ? new Date(date).toLocaleDateString('ru-RU') : '';
    
    const amountClass = isIncome ? 'expense-amount income' : 'expense-amount';
    const amountColor = isIncome ? '#10b981' : '#dc3545';
    
    return `
      <tr class="expense-row" data-expense-id="${payment.id}" style="cursor: pointer;">
        <td>${formattedDate}</td>
        <td class="expense-description" title="${escapeHtml(payment.description || '')}">
          ${escapeHtml(payment.description || 'Без описания')}
        </td>
        <td>${escapeHtml(payment.payer_name || payment.payer || '')}</td>
        <td class="${amountClass}" style="color: ${amountColor}; font-weight: 600;">
          ${payment.amount_raw || (payment.amount ? `${isIncome ? '+' : '-'}${payment.amount.toFixed(2)} ${payment.currency || 'PLN'}` : '')}
        </td>
        <td>
          ${categorySelect}
          ${confidenceBadge}
          ${isIncome ? `<span style="color: #10b981; font-size: 0.85em; margin-left: 5px;">💰 Доход</span>` : ''}
        </td>
        <td>
          <span style="color: #666; font-size: 0.9em;">Кликните для деталей</span>
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

// Handle quick category change from inline select
async function handleQuickCategoryChange(event, paymentId, categoryType = 'expense') {
  event.stopPropagation();
  const select = event.target;
  const categoryId = select.value.trim() || null;
  
  try {
    // Disable select while saving
    select.disabled = true;
    select.style.opacity = '0.6';
    
    // Get payment data to check direction
    const currentPayment = expensesState.items.find(p => p.id === paymentId);
    const isIncomePayment = currentPayment?.direction === 'in';
    
    let endpoint, body;
    if (categoryType === 'income') {
      // For income: use mark-as-refund endpoint if category is "Возвраты", otherwise update directly
      const refundsCategoryId = Object.values(incomeCategoriesMap).find(cat => cat.name === 'Возвраты')?.id;
      if (categoryId && parseInt(categoryId, 10) === refundsCategoryId && isIncomePayment) {
        // Mark as refund (only for income payments)
        endpoint = `${API_BASE}/api/vat-margin/payments/${encodeURIComponent(paymentId)}/mark-as-refund`;
        body = { comment: 'Категория установлена через UI' };
      } else {
        // Update income category directly
        endpoint = `${API_BASE}/api/vat-margin/payments/${encodeURIComponent(paymentId)}/income-category`;
        body = {
          income_category_id: categoryId ? parseInt(categoryId, 10) : null
        };
      }
    } else {
      // Update expense category
      endpoint = `${API_BASE}/api/vat-margin/payments/${encodeURIComponent(paymentId)}/expense-category`;
      body = {
        expense_category_id: categoryId ? parseInt(categoryId, 10) : null
      };
    }
    
    const response = await fetch(endpoint, {
      method: categoryType === 'income' && body.comment ? 'POST' : 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || payload.message || 'Не удалось обновить категорию');
    }
    
    const payload = await response.json();
    
    // Update local state
    const payment = expensesState.items.find(p => p.id === paymentId);
    if (payment) {
      if (categoryType === 'income') {
        payment.income_category_id = categoryId ? parseInt(categoryId, 10) : null;
      } else {
        payment.expense_category_id = categoryId ? parseInt(categoryId, 10) : null;
      }
    }
    
    // Update statistics
    updateStatistics(expensesState.items);
    
    // Show success message
    const paymentType = categoryType === 'income' ? 'дохода' : 'расхода';
    addLog('success', `Категория обновлена для ${paymentType} ${paymentId}`);
    
    // Reload detail if selected
    if (expensesState.selectedId === String(paymentId)) {
      const updatedRow = getExpenseRowElement(paymentId);
      if (updatedRow) {
        selectExpenseRow(updatedRow, { skipScroll: true, forceReload: true }).catch(() => clearExpenseDetailRow());
      }
    }
    
    // Re-render table to update category display
    filterExpenses();
    
  } catch (error) {
    console.error('Failed to update category:', error);
    addLog('error', `Ошибка обновления категории: ${error.message}`);
    
    // Revert select value
    const payment = expensesState.items.find(p => p.id === paymentId);
    if (payment) {
      if (categoryType === 'income') {
        select.value = payment.income_category_id || '';
      } else {
        select.value = payment.expense_category_id || '';
      }
    }
  } finally {
    select.disabled = false;
    select.style.opacity = '1';
  }
}

// Filter expenses by category and search (we always show outgoing payments)
function filterExpenses() {
  const categoryFilter = document.getElementById('categoryFilter');
  const searchInput = document.getElementById('paymentSearchInput');
  if (!categoryFilter) return;
  
  const categoryFilterValue = categoryFilter.value;
  const searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
  
  let filteredPayments = expensesState.items.filter((payment) => payment.direction === 'out');

  // Apply category filter
  if (categoryFilterValue === 'null') {
    filteredPayments = filteredPayments.filter((payment) => !payment.expense_category_id);
  } else if (categoryFilterValue) {
    const categoryId = parseInt(categoryFilterValue, 10);
    if (!Number.isNaN(categoryId)) {
      filteredPayments = filteredPayments.filter((payment) => payment.expense_category_id === categoryId);
    }
  }

  // Apply search filter
  if (searchQuery) {
    // Try to parse search query as a number for amount matching
    const searchQueryNum = parseFloat(searchQuery.replace(/[^\d.,-]/g, '').replace(',', '.'));
    const isNumericSearch = !Number.isNaN(searchQueryNum);
    
    filteredPayments = filteredPayments.filter((payment) => {
      const description = (payment.description || '').toLowerCase();
      const payerName = (payment.payer_name || '').toLowerCase();
      const currency = (payment.currency || '').toLowerCase();
      const id = String(payment.id || '');
      
      // Check text fields
      if (description.includes(searchQuery) ||
          payerName.includes(searchQuery) ||
          currency.includes(searchQuery) ||
          id.includes(searchQuery)) {
        return true;
      }
      
      // Check amount as string (for partial matches like "510")
      const amountStr = String(payment.amount || '');
      if (amountStr.includes(searchQuery)) {
        return true;
      }
      
      // Check amount_raw (formatted amount with currency)
      if (payment.amount_raw) {
        const amountRawLower = String(payment.amount_raw).toLowerCase();
        if (amountRawLower.includes(searchQuery)) {
          return true;
        }
      }
      
      // Check numeric amount (for exact or partial numeric matches)
      if (isNumericSearch && payment.amount != null) {
        const paymentAmount = parseFloat(payment.amount);
        if (!Number.isNaN(paymentAmount)) {
          // Match exact amount
          if (Math.abs(paymentAmount - searchQueryNum) < 0.01) {
            return true;
          }
          // Match amount as string (e.g., "510" matches "510.00")
          const paymentAmountStr = paymentAmount.toFixed(2);
          const searchQueryStr = searchQueryNum.toFixed(2);
          if (paymentAmountStr.includes(searchQuery.replace(/[^\d.,-]/g, '')) ||
              searchQueryStr.includes(String(paymentAmount).replace(/[^\d.,-]/g, ''))) {
            return true;
          }
        }
      }
      
      return false;
    });
  }

  expensesState.filteredItems = filteredPayments;
  renderExpensesTable(filteredPayments);
  updateStatistics(filteredPayments);
}

function setAutoCategorizeButtonState(loading, label) {
  const button = document.getElementById('autoCategorizeBtn');
  if (!button) return;
  if (loading) {
    button.disabled = true;
    button.textContent = label || '🤖 Автокатегоризация...';
  } else {
    button.disabled = false;
    button.textContent = '🤖 Автокатегоризация';
  }
}

async function autoCategorizeExpenses() {
  if (autoCategorizeInProgress) {
    addLog('warning', 'Автокатегоризация уже выполняется');
    return;
  }

  const uncategorizedExpenses = expensesState.items.filter(
    (payment) => payment.direction === 'out' && !payment.expense_category_id
  );

  if (uncategorizedExpenses.length === 0) {
    addLog('info', 'Нет расходов без категории для автокатегоризации');
    return;
  }

  autoCategorizeInProgress = true;
  addLog('info', `Автокатегоризация запущена: ${uncategorizedExpenses.length} расходов без категории`);
  setAutoCategorizeButtonState(true, `🤖 0/${uncategorizedExpenses.length}`);

  let appliedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let index = 0; index < uncategorizedExpenses.length; index += 1) {
    const payment = uncategorizedExpenses[index];
    setAutoCategorizeButtonState(true, `🤖 ${index + 1}/${uncategorizedExpenses.length}`);

    try {
      const detail = await loadExpenseDetails(String(payment.id), { forceReload: false });
      const suggestions = detail?.suggestions || [];
      const bestSuggestion = suggestions
        .filter((suggestion) => suggestion && suggestion.categoryId)
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];

      if (!bestSuggestion) {
        skippedCount += 1;
        addLog('info', `Расход ${payment.id}: нет предложений, пропускаем`);
        continue;
      }

      await applyExpenseCategoryFromSuggestion(payment.id, bestSuggestion);

      const categoryId = parseInt(bestSuggestion.categoryId, 10);
      payment.expense_category_id = categoryId;

      const cachedDetail = expensesState.details.get(String(payment.id));
      if (cachedDetail?.expense) {
        cachedDetail.expense.expense_category_id = categoryId;
      }
      if (cachedDetail?.payment) {
        cachedDetail.payment.expense_category_id = categoryId;
      }

      appliedCount += 1;
      const categoryName = expenseCategoriesMap[categoryId]?.name || `ID: ${categoryId}`;
      addLog('success', `Расход ${payment.id}: установлена категория ${categoryName}`);
    } catch (error) {
      errorCount += 1;
      console.error('Auto-categorization item failed', { paymentId: payment.id, error });
      addLog('error', `Расход ${payment.id}: ${error.message}`);
    }
  }

  try {
    const currentFilter = document.getElementById('categoryFilter')?.value || 'null';
    await loadExpenses();
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter && categoryFilter.value !== currentFilter) {
      categoryFilter.value = currentFilter;
    }
    filterExpenses();
  } finally {
    setAutoCategorizeButtonState(false);
    autoCategorizeInProgress = false;
    addLog('info', `Автокатегоризация завершена: применено ${appliedCount}, без предложений ${skippedCount}, ошибок ${errorCount}`);
  }
}

async function applyExpenseCategoryFromSuggestion(paymentId, suggestion) {
  const categoryId = parseInt(suggestion.categoryId, 10);
  if (!categoryId) {
    throw new Error('Некорректное предложение категории');
  }

  const body = {
    expense_category_id: categoryId,
    createMapping: suggestion.patternType !== null && suggestion.patternType !== undefined,
    patternType: suggestion.patternType || null,
    patternValue: suggestion.patternValue || '',
    priority: suggestion.confidence >= 100
      ? 10
      : Math.max(1, Math.round((suggestion.confidence || 0) / 10))
  };

  const response = await fetch(
    `${API_BASE}/api/vat-margin/payments/${encodeURIComponent(paymentId)}/expense-category`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload?.error || payload?.message || 'Не удалось присвоить категорию');
  }

  return categoryId;
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
    if (detail?.expense?.direction === 'out') {
      try {
        await ensureExpenseProductsLoaded();
      } catch (productError) {
        console.debug('Failed to pre-load products for expense linking:', productError.message);
      }
    }
    renderExpenseDetail(detail, detailCell);
  } catch (error) {
    addLog('error', `Не удалось получить детали расхода: ${error.message}`);
    detailCell.innerHTML = `<div class="payment-detail-placeholder">Не удалось получить детали: ${escapeHtml(error.message)}</div>`;
  }
}

// Load expense/income details (with suggestions from OpenAI for expenses only)
async function loadExpenseDetails(paymentId, { forceReload = false } = {}) {
  const cacheKey = String(paymentId);
  if (!forceReload && expensesState.details.has(cacheKey)) {
    return expensesState.details.get(cacheKey);
  }

  // Load payment data
  const paymentResponse = await fetch(`${API_BASE}/api/payments/${encodeURIComponent(cacheKey)}`);
  const paymentPayload = await paymentResponse.json();
  
  if (!paymentPayload.success || !paymentPayload.data) {
    throw new Error(paymentPayload.error || 'Не удалось получить данные платежа');
  }

  const payment = paymentPayload.data;

  // Load suggestions only for expenses (direction='out')
  // Income payments don't need expense category suggestions
  let suggestions = [];
  if (payment.direction === 'out') {
    try {
      const suggestionsResponse = await fetch(`${API_BASE}/api/payments/${encodeURIComponent(cacheKey)}/expense-category-suggestions`);
      
      // Check if response is ok before parsing JSON
      if (!suggestionsResponse.ok) {
        // If server returns error, just skip suggestions (non-critical)
        console.debug(`Suggestions endpoint returned ${suggestionsResponse.status} for payment ${cacheKey}, skipping suggestions`);
      } else {
        const suggestionsPayload = await suggestionsResponse.json();
        
        if (suggestionsPayload.success) {
          suggestions = suggestionsPayload.data || [];
        }
      }
    } catch (suggestionsError) {
      // If suggestions fail (network error, connection refused, etc.), continue without them (non-critical)
      // Only log in debug mode, not as warning, since this is expected behavior
      console.debug('Failed to load expense category suggestions (non-critical):', suggestionsError.name || suggestionsError.message);
    }
  }

  let link = null;
  try {
    const linkResponse = await fetch(`${API_BASE}/api/payments/${encodeURIComponent(cacheKey)}/link-product`);
    if (linkResponse.ok) {
      const linkPayload = await linkResponse.json();
      if (linkPayload.success) {
        link = linkPayload.data || null;
      }
    }
  } catch (linkError) {
    console.debug('Failed to load product link info (non-critical):', linkError.message);
  }

  const result = {
    expense: payment,
    payment,
    suggestions,
    link
  };

  expensesState.details.set(cacheKey, result);
  return result;
}

// Render expense/income detail
function renderExpenseDetail(data, target = expensesState.detailCellEl) {
  if (!target) return;
  if (!data || !data.expense) {
    target.innerHTML = '<div class="payment-detail-placeholder">Не удалось загрузить данные платежа</div>';
    return;
  }

  const { expense, suggestions = [], link } = data;
  const isIncome = expense.direction === 'in';
  const isExpense = expense.direction === 'out';
  const linkedProductIdAttr = link?.product_id ? escapeHtml(String(link.product_id)) : '';
  
  // Get category name based on direction
  let categoryName = '';
  if (isIncome) {
    categoryName = expense.income_category_id 
      ? (incomeCategoriesMap[expense.income_category_id]?.name || `ID: ${expense.income_category_id}`)
      : 'Без категории';
  } else if (isExpense) {
    categoryName = expense.expense_category_id 
      ? (expenseCategoriesMap[expense.expense_category_id]?.name || `ID: ${expense.expense_category_id}`)
      : 'Без категории';
  }

  const date = expense.operation_date || expense.date || '';
  const formattedDate = date ? new Date(date).toLocaleDateString('ru-RU') : '';

  const paymentType = isIncome ? 'Доход' : 'Расход';
  const amountColor = isIncome ? '#10b981' : '#dc3545';

  // Используем amount_raw для отображения оригинальной суммы с плюсом/минусом
  const originalAmount = expense.amount_raw || (expense.amount ? `${isIncome ? '+' : '-'}${expense.amount.toFixed(2)} ${expense.currency || 'PLN'}` : '—');
  
  const metaRows = [
    renderExpenseMeta('ID платежа', escapeHtml(String(expense.id))),
    renderExpenseMeta('Дата', formattedDate || '—'),
    renderExpenseMeta('Сумма (оригинальная)', originalAmount),
    renderExpenseMeta('Плательщик', escapeHtml(expense.payer_name || expense.payer || '—')),
    renderExpenseMeta('Описание', escapeHtml(expense.description || '—')),
    renderExpenseMeta('Направление', isIncome ? '💰 Доход (in)' : '💸 Расход (out)'),
    renderExpenseMeta('Категория', categoryName),
    renderExpenseMeta('Уверенность', expense.match_confidence ? `${Math.round(expense.match_confidence)}%` : '—')
  ];

  // Build category select based on direction
  let categorySelectHTML = '';
  let categoryPanelHTML = '';
  
  if (isIncome) {
    // For income: show income category select
    const incomeCategoryOptions = Object.values(incomeCategoriesMap).map(cat => 
      `<option value="${cat.id}" ${cat.id === expense.income_category_id ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`
    ).join('');
    
    categorySelectHTML = `
      <label for="income-category-select">Категория доходов</label>
      <select id="income-category-select" class="form-control">
        <option value="">Выберите категорию...</option>
        ${incomeCategoryOptions}
      </select>
      <span class="manual-match-hint">Выберите категорию дохода из списка.</span>
    `;
    
    categoryPanelHTML = ''; // No suggestions for income
  } else if (isExpense) {
    // For expenses: show expense category select with suggestions
    const expenseCategoryOptions = Object.values(expenseCategoriesMap).map(cat => 
      `<option value="${cat.id}" ${cat.id === expense.expense_category_id ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`
    ).join('');
    
    const suggestionItems = suggestions.length > 0
      ? suggestions.map((suggestion) => {
        const isSelected = suggestion.categoryId === expense.expense_category_id;
        const suggestionCategoryName = expenseCategoriesMap[suggestion.categoryId]?.name || `ID: ${suggestion.categoryId}`;
        const isPerfectMatch = suggestion.confidence >= 100;
        const cardClass = `candidate-card${isSelected ? ' selected' : ''}`;
        
        return `
          <li
            class="${cardClass}"
            data-category-id="${escapeHtml(String(suggestion.categoryId))}"
          >
            <div class="candidate-title">${escapeHtml(suggestionCategoryName)}</div>
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
    
    categorySelectHTML = `
      <label for="expense-category-select">Категория расходов</label>
      <select id="expense-category-select" class="form-control">
        <option value="">Выберите категорию...</option>
        ${expenseCategoryOptions}
      </select>
      <span class="manual-match-hint">Выберите категорию из списка или кликните на предложение ниже.</span>
    `;
    
    categoryPanelHTML = `
      <div class="candidate-panel">
        <h4>Возможные совпадения</h4>
        <ul class="candidate-list">
          ${suggestionItems}
        </ul>
      </div>
    `;
  }

  // Используем amount_raw для заголовка
  const headerAmount = expense.amount_raw || (expense.amount ? `${isIncome ? '+' : '-'}${expense.amount.toFixed(2)} ${expense.currency || 'PLN'}` : '');
  
  const productLinkPanelHTML = isExpense ? renderExpenseProductLinkPanel(link) : '';

  target.innerHTML = `
    <div class="payment-detail" data-expense-id="${escapeHtml(String(expense.id))}" data-linked-product="${linkedProductIdAttr}">
      <header>
        <h3>${paymentType} ${headerAmount}</h3>
      </header>
      <div class="payment-meta">
        ${metaRows.join('')}
      </div>
      <div class="manual-match-panel">
        ${categorySelectHTML}
        <div class="manual-match-actions">
          <button class="btn btn-primary" id="expense-save">💾 Сохранить</button>
          <button class="btn btn-secondary" id="expense-reset">↩️ Очистить</button>
          <button class="btn btn-danger" id="expense-delete">🗑️ Удалить</button>
          ${isExpense ? '<button class="btn btn-info" id="expense-move-to-income" style="background: #0ea5e9; color: white;">📥 Перенести в приход</button>' : ''}
          ${isIncome ? '<button class="btn btn-info" id="expense-move-to-expense" style="background: #dc3545; color: white;">📤 Переместить в расходы</button>' : ''}
        </div>
      </div>
      ${categoryPanelHTML}
      ${productLinkPanelHTML}
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

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('ru-RU');
}

function renderExpenseProductLinkPanel(link) {
  if (expenseProductLinkState.isLoading && !expenseProductLinkState.loaded) {
    return `
      <div class="product-link-panel">
        <label>Привязка к продукту</label>
        <div class="product-link-placeholder">Загружаю список продуктов...</div>
      </div>
    `;
  }

  if (expenseProductLinkState.error) {
    return `
      <div class="product-link-panel error">
        <label>Привязка к продукту</label>
        <div class="product-link-placeholder">
          ${escapeHtml(expenseProductLinkState.error)}
          <button class="btn btn-secondary" id="expense-products-reload">↻ Повторить</button>
        </div>
      </div>
    `;
  }

  const products = expenseProductLinkState.products || [];
  const linkedProductId = link?.product_id ? String(link.product_id) : '';
  const linkedProductName = link?.product?.name || (linkedProductId && !products.some((product) => String(product.id) === linkedProductId) ? `Продукт #${linkedProductId}` : '');

  const linkedMeta = link
    ? `<div class="product-link-meta">Связано ${escapeHtml(formatDateTime(link.linked_at) || '')}${link.linked_by ? ` • ${escapeHtml(link.linked_by)}` : ''}</div>`
    : '<div class="product-link-meta muted">Связь не установлена</div>';

  return `
    <div class="product-link-panel">
      <label for="expense-product-search">Привязка к продукту</label>
      <div class="product-search-wrapper" style="position: relative;">
        <input 
          type="text" 
          id="expense-product-search" 
          class="input-field" 
          placeholder="Начните вводить название продукта..."
          value="${linkedProductName ? escapeHtml(linkedProductName) : ''}"
          autocomplete="off"
          ${products.length === 0 ? ' disabled' : ''}
        />
        <input type="hidden" id="expense-product-id" value="${linkedProductId || ''}" />
        <div id="expense-product-suggestions" class="suggestions-list" style="display: none;"></div>
      </div>
      <div class="product-link-actions">
        <button class="btn btn-primary" id="expense-product-link-btn"${products.length === 0 ? ' disabled' : ''}>🔗 Связать</button>
        <button class="btn btn-secondary" id="expense-product-unlink-btn"${link ? '' : ' disabled'}>✖ Отвязать</button>
        <button class="btn btn-secondary" id="expense-products-reload">↻ Обновить список</button>
      </div>
      ${linkedMeta}
    </div>
  `;
}

// Setup expense/income detail handlers
function setupExpenseDetailHandlers(paymentId, root = expensesState.detailCellEl) {
  if (!root) return;

  // Get payment data to determine direction
  // Try to get from state first, then from detail data
  let payment = expensesState.items.find(p => p.id === paymentId);
  if (!payment) {
    // Try to get from details cache
    const detailData = expensesState.details.get(String(paymentId));
    if (detailData && detailData.expense) {
      payment = detailData.expense;
    } else if (detailData && detailData.payment) {
      payment = detailData.payment;
    }
  }
  
  const isIncome = payment?.direction === 'in';
  const isExpense = payment?.direction === 'out';
  
  // Log for debugging
  console.log('setupExpenseDetailHandlers', {
    paymentId,
    paymentDirection: payment?.direction,
    isIncome,
    isExpense,
    hasPayment: !!payment
  });

  // Get the correct category select based on direction
  const expenseCategorySelect = root.querySelector('#expense-category-select');
  const incomeCategorySelect = root.querySelector('#income-category-select');
  const categorySelect = isIncome ? incomeCategorySelect : expenseCategorySelect;
  
  const saveButton = root.querySelector('#expense-save');
  const resetButton = root.querySelector('#expense-reset');
  const deleteButton = root.querySelector('#expense-delete');
  const moveToIncomeButton = root.querySelector('#expense-move-to-income');
  const moveToExpenseButton = root.querySelector('#expense-move-to-expense');
  const candidateCards = root.querySelectorAll('.candidate-card');
  const productSearchInput = root.querySelector('#expense-product-search');
  const productIdInput = root.querySelector('#expense-product-id');
  const productSuggestions = root.querySelector('#expense-product-suggestions');
  const productLinkBtn = root.querySelector('#expense-product-link-btn');
  const productUnlinkBtn = root.querySelector('#expense-product-unlink-btn');
  const reloadProductsBtn = root.querySelector('#expense-products-reload');

  // Handle candidate card clicks (only for expenses with suggestions)
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
      
      // Determine direction from the select element itself
      // If income-category-select exists, it's income; if expense-category-select exists, it's expense
      const hasIncomeSelect = !!incomeCategorySelect;
      const hasExpenseSelect = !!expenseCategorySelect;
      const paymentIsIncome = hasIncomeSelect || (payment && payment.direction === 'in');
      const paymentIsExpense = hasExpenseSelect || (payment && payment.direction === 'out');
      
      console.log('Save button clicked', {
        paymentId,
        categoryId,
        hasIncomeSelect,
        hasExpenseSelect,
        paymentDirection: payment?.direction,
        paymentIsIncome,
        paymentIsExpense
      });
      
      let endpoint, body;
      
      if (paymentIsIncome) {
        // For income: use income-category endpoint
        endpoint = `${API_BASE}/api/vat-margin/payments/${encodeURIComponent(paymentId)}/income-category`;
        body = {
          income_category_id: parseInt(categoryId, 10)
        };
      } else if (paymentIsExpense) {
        // For expenses: use expense-category endpoint with pattern info
        // Find the selected suggestion to get pattern info
        const selectedCard = root.querySelector('.candidate-card.selected');
        let patternType = null;
        let patternValue = '';
        let confidence = 0;
        
        if (selectedCard) {
          const suggestion = expensesState.details.get(String(paymentId))?.suggestions?.find(
            s => String(s.categoryId) === selectedCard.dataset.categoryId
          );
          if (suggestion) {
            patternType = suggestion.patternType;
            patternValue = suggestion.patternValue || '';
            confidence = suggestion.confidence || 0;
          }
        }

        endpoint = `${API_BASE}/api/vat-margin/payments/${encodeURIComponent(paymentId)}/expense-category`;
        body = {
          expense_category_id: parseInt(categoryId, 10),
          createMapping: patternType !== null,
          patternType: patternType,
          patternValue: patternValue,
          priority: confidence >= 100 ? 10 : Math.round(confidence / 10)
        };
      } else {
        // Fallback: try to determine from payment data in details
        const detailData = expensesState.details.get(String(paymentId));
        const detailPayment = detailData?.expense || detailData?.payment;
        if (detailPayment && detailPayment.direction === 'in') {
          // It's income, use income endpoint
          endpoint = `${API_BASE}/api/vat-margin/payments/${encodeURIComponent(paymentId)}/income-category`;
          body = {
            income_category_id: parseInt(categoryId, 10)
          };
        } else {
          throw new Error(`Неизвестное направление платежа. Payment ID: ${paymentId}, direction: ${detailPayment?.direction || 'unknown'}`);
        }
      }

      console.log('Saving category', { endpoint, body, paymentId });

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        const errorMsg = payload.error || payload.message || 'Не удалось сохранить категорию';
        console.error('Failed to save category', { endpoint, body, response: payload, paymentId });
        throw new Error(errorMsg);
      }

      // Сохраняем текущий фильтр по категории
      const currentCategory = document.getElementById('categoryFilter')?.value || 'null';
      
      // Reload expenses
      await loadExpenses();
      
      // Восстанавливаем фильтры после загрузки
      setTimeout(() => {
        const categoryFilter = document.getElementById('categoryFilter');
        if (categoryFilter && categoryFilter.value !== currentCategory) {
          categoryFilter.value = currentCategory;
        }
        // Применяем фильтры
        filterExpenses();
      }, 100);
      
      // Reload detail if still selected
      if (expensesState.selectedId === String(paymentId)) {
        const updatedRow = getExpenseRowElement(paymentId);
        if (updatedRow) {
          selectExpenseRow(updatedRow, { skipScroll: true, forceReload: true }).catch(() => clearExpenseDetailRow());
        }
      }

      const paymentType = isIncome ? 'доходу' : 'расходу';
      addLog('success', `Категория присвоена ${paymentType} ${paymentId}`);
    } catch (error) {
      addLog('error', `Не удалось сохранить категорию: ${error.message}`);
    } finally {
      setButtonLoading(saveButton, false, '💾 Сохранить');
    }
  });

  // Handle reset button
  resetButton?.addEventListener('click', async () => {
    if (!categorySelect) return;
    
    try {
      setButtonLoading(resetButton, true, 'Очистка...');
      
      let endpoint, body;
      if (isIncome) {
        endpoint = `${API_BASE}/api/vat-margin/payments/${encodeURIComponent(paymentId)}/income-category`;
        body = { income_category_id: null };
      } else if (isExpense) {
        endpoint = `${API_BASE}/api/vat-margin/payments/${encodeURIComponent(paymentId)}/expense-category`;
        body = { expense_category_id: null };
      } else {
        throw new Error('Неизвестное направление платежа');
      }

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || payload.message || 'Не удалось очистить категорию');
      }

      const currentCategory = document.getElementById('categoryFilter')?.value || 'null';
      
      // Reload payments
      await loadExpenses();
      
      // Восстанавливаем фильтры после загрузки
      setTimeout(() => {
        const categoryFilter = document.getElementById('categoryFilter');
        if (categoryFilter && categoryFilter.value !== currentCategory) {
          categoryFilter.value = currentCategory;
        }
        // Применяем фильтры
        filterExpenses();
      }, 100);
      
      // Reload detail if still selected
      if (expensesState.selectedId === String(paymentId)) {
        const updatedRow = getExpenseRowElement(paymentId);
        if (updatedRow) {
          selectExpenseRow(updatedRow, { skipScroll: true, forceReload: true }).catch(() => clearExpenseDetailRow());
        }
      }

      const paymentType = isIncome ? 'дохода' : 'расхода';
      addLog('info', `Категория ${paymentType} ${paymentId} очищена`);
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
      
      const response = await fetch(`${API_BASE}/api/vat-margin/payments/${encodeURIComponent(paymentId)}`, {
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

      addLog('success', `Расход ${paymentId} удален`);
    } catch (error) {
      addLog('error', `Не удалось удалить расход: ${error.message}`);
    } finally {
      setButtonLoading(deleteButton, false, '🗑️ Удалить');
    }
  });

  // Handle move to income button (for expenses)
  moveToIncomeButton?.addEventListener('click', async () => {
    try {
      setButtonLoading(moveToIncomeButton, true, 'Перенос...');
      
      const response = await fetch(`${API_BASE}/api/vat-margin/payments/${encodeURIComponent(paymentId)}/direction`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: 'in'
        })
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || payload.message || 'Не удалось перенести платёж');
      }

      const payload = await response.json();
      
      addLog('success', `Платёж ${paymentId} перенесен в приходы (доходы)`);
      
      const currentCategory = document.getElementById('categoryFilter')?.value || 'null';
      const categoryFilter = document.getElementById('categoryFilter');
      if (categoryFilter && categoryFilter.value !== currentCategory) {
        categoryFilter.value = currentCategory;
      }
      
      // Close detail view and reload expenses list
      clearExpenseDetailRow();
      await loadExpenses();
      
    } catch (error) {
      console.error('Failed to move expense to income:', error);
      addLog('error', `Не удалось перенести платёж: ${error.message}`);
    } finally {
      setButtonLoading(moveToIncomeButton, false, '📥 Перенести в приход');
    }
  });

  // Handle move to expense button (for income)
  moveToExpenseButton?.addEventListener('click', async () => {
    try {
      setButtonLoading(moveToExpenseButton, true, 'Перенос...');
      
      const response = await fetch(`${API_BASE}/api/vat-margin/payments/${encodeURIComponent(paymentId)}/direction`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: 'out'
        })
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || payload.message || 'Не удалось переместить платёж');
      }

      const payload = await response.json();
      
      addLog('success', `Платёж ${paymentId} перемещен в расходы`);
      
      const currentCategory = document.getElementById('categoryFilter')?.value || 'null';
      const categoryFilter = document.getElementById('categoryFilter');
      if (categoryFilter && categoryFilter.value !== currentCategory) {
        categoryFilter.value = currentCategory;
      }
      
      // Close detail view and reload expenses list
      clearExpenseDetailRow();
      await loadExpenses();
      
    } catch (error) {
      console.error('Failed to move income to expense:', error);
      addLog('error', `Не удалось переместить платёж: ${error.message}`);
    } finally {
      setButtonLoading(moveToExpenseButton, false, '📤 Переместить в расходы');
    }
  });

  if (isExpense) {
    // Setup product search autocomplete
    if (productSearchInput && productIdInput && productSuggestions) {
      console.log('Setting up product search autocomplete', {
        hasSearchInput: !!productSearchInput,
        hasIdInput: !!productIdInput,
        hasSuggestions: !!productSuggestions
      });
      
      // Ensure products are loaded
      ensureExpenseProductsLoaded().then(products => {
        console.log('Products loaded for autocomplete', {
          count: products?.length || 0,
          products: products?.slice(0, 3).map(p => p.name)
        });
      }).catch(err => {
        console.error('Failed to load products for autocomplete:', err);
      });
      
      let searchTimeout = null;
      
      productSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        console.log('Product search input', { query, length: query.length });
        
        // Clear hidden input when search is cleared
        if (!query) {
          productIdInput.value = '';
          productSuggestions.style.display = 'none';
          return;
        }
        
        // Debounce search
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          console.log('Calling filterProducts', { query });
          filterProducts(query, productSuggestions, productSearchInput, productIdInput);
        }, 200);
      });
      
      // Hide suggestions when clicking outside
      const clickHandler = (e) => {
        if (productSearchInput && productSuggestions && 
            !productSearchInput.contains(e.target) && 
            !productSuggestions.contains(e.target)) {
          productSuggestions.style.display = 'none';
        }
      };
      document.addEventListener('click', clickHandler);
      
      // Handle Enter key
      productSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const firstSuggestion = productSuggestions.querySelector('.suggestion-item');
          if (firstSuggestion) {
            firstSuggestion.click();
          }
        } else if (e.key === 'Escape') {
          productSuggestions.style.display = 'none';
        }
      });
    } else {
      console.warn('Product search elements not found', {
        productSearchInput: !!productSearchInput,
        productIdInput: !!productIdInput,
        productSuggestions: !!productSuggestions
      });
    }

    reloadProductsBtn?.addEventListener('click', async () => {
      try {
        setButtonLoading(reloadProductsBtn, true, 'Обновление...');
        await ensureExpenseProductsLoaded({ force: true });
        const refreshed = await loadExpenseDetails(paymentId, { forceReload: true });
        renderExpenseDetail(refreshed, root);
      } catch (error) {
        addLog('error', `Не удалось обновить список продуктов: ${error.message}`);
      } finally {
        setButtonLoading(reloadProductsBtn, false, '↻ Обновить список');
      }
    });

    productLinkBtn?.addEventListener('click', async () => {
      if (!productIdInput) return;
      const productId = productIdInput.value;
      if (!productId) {
        addLog('warning', 'Выберите продукт перед привязкой');
        productSearchInput?.focus();
        return;
      }
      try {
        setButtonLoading(productLinkBtn, true, 'Связываю...');
        const response = await fetch(`${API_BASE}/api/payments/${encodeURIComponent(paymentId)}/link-product`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: Number(productId) })
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Не удалось связать платеж');
        }
        const productName = productSearchInput?.value || productId;
        addLog('success', `Расход ${paymentId} привязан к продукту ${productName}`);
        const refreshed = await loadExpenseDetails(paymentId, { forceReload: true });
        renderExpenseDetail(refreshed, root);
      } catch (error) {
        addLog('error', `Не удалось привязать расход: ${error.message}`);
      } finally {
        setButtonLoading(productLinkBtn, false, '🔗 Связать');
      }
    });

    productUnlinkBtn?.addEventListener('click', async () => {
      try {
        setButtonLoading(productUnlinkBtn, true, 'Отвязываю...');
        const response = await fetch(`${API_BASE}/api/payments/${encodeURIComponent(paymentId)}/link-product`, {
          method: 'DELETE'
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Не удалось удалить связь');
        }
        addLog('info', `Связь расхода ${paymentId} с продуктом удалена`);
        const refreshed = await loadExpenseDetails(paymentId, { forceReload: true });
        renderExpenseDetail(refreshed, root);
      } catch (error) {
        addLog('error', `Не удалось удалить связь: ${error.message}`);
      } finally {
        setButtonLoading(productUnlinkBtn, false, '✖ Отвязать');
      }
    });
  }
}

// Utility function to set button loading state
function setButtonLoading(button, loading, text) {
  if (!button) return;
  button.disabled = loading;
  button.textContent = text;
}

// Display unmatched expenses from last CSV upload
function displayUnmatchedExpenses(expenses) {
  const section = document.getElementById('unmatchedExpensesSection');
  const container = document.getElementById('unmatchedExpensesContainer');
  
  if (!section || !container) return;
  
  if (expenses.length === 0) {
    hideUnmatchedExpenses();
    return;
  }
  
  section.style.display = 'block';
  
  const tableHtml = `
    <table class="expenses-table" style="margin-top: 10px;">
      <thead>
        <tr>
          <th>Дата</th>
          <th>Описание</th>
          <th>Плательщик</th>
          <th>Сумма</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>
        ${expenses.map(expense => {
          const date = expense.operation_date || expense.date || '';
          const formattedDate = date ? new Date(date).toLocaleDateString('ru-RU') : '';
          const isIncome = expense.direction === 'in';
          const amountColor = isIncome ? '#10b981' : '#dc3545';
          const originalAmount = expense.amount_raw || (expense.amount ? `${isIncome ? '+' : '-'}${expense.amount.toFixed(2)} ${expense.currency || 'PLN'}` : '');
          return `
            <tr class="expense-row" data-expense-id="${expense.id}" style="cursor: pointer;">
              <td>${formattedDate}</td>
              <td class="expense-description" title="${escapeHtml(expense.description || '')}">
                ${escapeHtml(expense.description || 'Без описания')}
              </td>
              <td>${escapeHtml(expense.payer_name || expense.payer || '')}</td>
              <td class="expense-amount" style="color: ${amountColor}; font-weight: 600;">
                ${originalAmount}
              </td>
              <td>
                <button class="btn btn-primary" onclick="selectUnmatchedExpense(${expense.id})" style="padding: 5px 10px; font-size: 0.9em;">
                  Выбрать категорию
                </button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
  
  container.innerHTML = `
    <p style="color: #666; margin-bottom: 10px;">
      Найдено <strong>${expenses.length}</strong> расходов без категории из последней загрузки CSV.
      Кликните на строку или кнопку "Выбрать категорию" для назначения категории.
    </p>
    ${tableHtml}
  `;
  
  // Add click handlers to rows
  container.querySelectorAll('tr[data-expense-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        const expenseId = row.dataset.expenseId;
        selectUnmatchedExpense(expenseId);
      }
    });
  });
}

// Hide unmatched expenses section
function hideUnmatchedExpenses() {
  const section = document.getElementById('unmatchedExpensesSection');
  if (section) {
    section.style.display = 'none';
  }
}

// Select unmatched expense and show detail panel
function selectUnmatchedExpense(expenseId) {
  const row = getExpenseRowElement(expenseId);
  if (row) {
    selectExpenseRow(row).catch((error) => {
      console.warn('selectExpenseRow error:', error);
    });
  } else {
    // If row not found in main table, load it
    loadExpenses().then(() => {
      const row = getExpenseRowElement(expenseId);
      if (row) {
        selectExpenseRow(row).catch((error) => {
          console.warn('selectExpenseRow error:', error);
        });
      }
    });
  }
}

// Handle CSV upload
async function handleExpensesCsvUpload() {
  const fileInput = document.getElementById('expensesCsvInput');
  const uploadButton = document.getElementById('uploadCsvButton');
  const uploadButtonText = document.getElementById('uploadButtonText');
  const uploadButtonSpinner = document.getElementById('uploadButtonSpinner');
  const uploadProgress = document.getElementById('uploadProgress');
  const uploadProgressText = document.getElementById('uploadProgressText');
  const uploadProgressDetails = document.getElementById('uploadProgressDetails');
  const file = fileInput.files?.[0];
  
  if (!file) {
    addLog('warning', 'Выберите файл для загрузки');
    return;
  }
  
  if (!file.name.endsWith('.csv')) {
    addLog('warning', 'Поддерживаются только CSV файлы');
    return;
  }
  
  // Show loading state
  fileInput.disabled = true;
  uploadButton.disabled = true;
  uploadButtonText.style.display = 'none';
  uploadButtonSpinner.style.display = 'inline-block';
  uploadProgress.style.display = 'block';
  uploadProgressText.textContent = 'Обработка файла...';
  uploadProgressDetails.textContent = `Файл: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
  
  addLog('info', `Загрузка файла ${file.name} (${(file.size / 1024).toFixed(2)} KB)...`);
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    // Add timeout and better error handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout
    
    // Update progress message
    uploadProgressText.textContent = 'Отправка файла на сервер...';
    uploadProgressDetails.textContent = 'Пожалуйста, подождите...';
    
    let response;
    try {
      response = await fetch(`${API_BASE}/api/payments/import-expenses`, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error('Превышено время ожидания ответа сервера (5 минут). Файл слишком большой или сервер не отвечает.');
      }
      if (fetchError.message.includes('Failed to fetch') || fetchError.message.includes('ERR_CONNECTION_RESET')) {
        throw new Error('Соединение с сервером разорвано. Возможно, файл слишком большой или произошла ошибка на сервере. Проверьте логи сервера.');
      }
      throw fetchError;
    }
    
    // Update progress message
    uploadProgressText.textContent = 'Обработка данных...';
    uploadProgressDetails.textContent = 'Анализ CSV файла и категоризация расходов...';
    
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorPayload = await response.json();
        errorMessage = errorPayload.error || errorPayload.message || errorMessage;
      } catch (e) {
        // Response is not JSON
      }
      throw new Error(errorMessage);
    }
    
    const payload = await response.json();
    
    if (!payload.success) {
      throw new Error(payload.error || payload.message || 'Не удалось загрузить файл');
    }
    
    // Update progress message
    uploadProgressText.textContent = 'Завершение обработки...';
    uploadProgressDetails.textContent = 'Сохранение результатов...';
    
    const stats = payload.data || {};
    const total = stats.total || 0;
    const expensesProcessed = stats.processed || stats.expenses?.processed || 0;
    const incomeProcessed = stats.income?.processed || 0;
    const autoMatched = stats.categorized || stats.expenses?.categorized || 0;
    const uncategorized = stats.uncategorized || stats.expenses?.uncategorized || 0;
    const uncategorizedExpenses = payload.data?.uncategorizedExpenses || [];
    
    // Hide progress indicator
    setTimeout(() => {
      uploadProgress.style.display = 'none';
    }, 500);
    
    addLog('success', `Файл загружен успешно!`);
    addLog('info', `Всего записей в CSV: ${total}`);
    addLog('info', `Расходов обработано: ${expensesProcessed} (отрицательные суммы)`);
    addLog('info', `Доходов обработано: ${incomeProcessed} (положительные суммы)`);
    
    if (expensesProcessed > 0) {
      if (autoMatched > 0) {
        addLog('success', `Автоматически категоризировано: ${autoMatched}`);
      }
      addLog('info', `Без категории: ${uncategorized} (требуют ручного выбора или автокатегоризации)`);
    } else {
      addLog('warning', `⚠️ В CSV файле не найдено расходов (отрицательных сумм).`);
      addLog('info', `Проверьте формат CSV: расходы должны иметь знак минус перед суммой (например: "-100.00 PLN")`);
    }
    
    // Show unmatched expenses section if there are uncategorized expenses
    if (uncategorizedExpenses.length > 0) {
      displayUnmatchedExpenses(uncategorizedExpenses);
    } else {
      hideUnmatchedExpenses();
    }
    
    // Clear file input
    fileInput.value = '';
    
    // Reload expenses
    uploadProgressText.textContent = 'Обновление списка расходов...';
    uploadProgressDetails.textContent = 'Загрузка обновленных данных...';
    await loadExpenses();
    
    // Hide progress after reload
    uploadProgress.style.display = 'none';
    
  } catch (error) {
    console.error('CSV upload error:', error);
    addLog('error', `Ошибка загрузки CSV: ${error.message}`);
    
    // Hide progress on error
    uploadProgress.style.display = 'none';
  } finally {
    // Restore UI state
    fileInput.disabled = false;
    uploadButton.disabled = false;
    uploadButtonText.style.display = 'inline';
    uploadButtonSpinner.style.display = 'none';
  }
}
