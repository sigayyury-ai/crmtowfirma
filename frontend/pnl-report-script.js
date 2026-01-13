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
    const yearOptions = Array.from(elements.yearSelect.options).map(opt => Number(opt.value));
    
    // Add current year option if it doesn't exist (dynamic year support)
    if (!yearOptions.includes(currentYear)) {
      const opt = document.createElement('option');
      opt.value = String(currentYear);
      opt.textContent = currentYear;
      elements.yearSelect.appendChild(opt);
    }
    
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
      // Save expanded state of current year before switching
      const currentYear = elements.yearSelect.value;
      if (currentYear) {
        saveExpandedState(currentYear);
      }
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

/**
 * Save expanded state of collapsible sections
 */
function saveExpandedState(year) {
  const state = {};
  const headers = document.querySelectorAll('.collapsible-header');
  
  headers.forEach(header => {
    const rowLabel = header.querySelector('.row-label');
    if (!rowLabel) return;
    
    // Get text without arrow symbols (▼ or ▶) for consistent matching
    let headerText = rowLabel.textContent?.trim() || '';
    // Remove arrow symbols for consistent key matching
    headerText = headerText.replace(/[▼▶]/g, '').trim();
    if (!headerText) return;
    
    // Find content rows for this header
    const allRows = Array.from(header.parentElement.querySelectorAll('tr'));
    const headerIndex = allRows.indexOf(header);
    const contentRows = [];
    
    for (let i = headerIndex + 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (row.classList.contains('collapsible-header') || 
          row.classList.contains('profit-loss-row') ||
          row.classList.contains('balance-row') ||
          row.classList.contains('roi-row') ||
          row.classList.contains('ebitda-row')) {
        break;
      }
      if (row.classList.contains('collapsible-content')) {
        contentRows.push(row);
      }
    }
    
    if (contentRows.length > 0) {
      // Check if section is expanded (display is not 'none')
      // Use computed style to check actual visibility
      const firstRow = contentRows[0];
      if (firstRow) {
        const computedStyle = window.getComputedStyle(firstRow);
        const isExpanded = computedStyle.display !== 'none';
        state[headerText] = isExpanded;
      }
    }
  });
  
  // Save to localStorage
  const storageKey = `pnl-report-expanded-${year}`;
  localStorage.setItem(storageKey, JSON.stringify(state));
}

/**
 * Restore expanded state of collapsible sections
 */
function restoreExpandedState(year) {
  const storageKey = `pnl-report-expanded-${year}`;
  const savedState = localStorage.getItem(storageKey);
  
  if (!savedState) {
    return;
  }
  
  try {
    const state = JSON.parse(savedState);
    const headers = document.querySelectorAll('.collapsible-header');
    
    headers.forEach(header => {
      const rowLabel = header.querySelector('.row-label');
      if (!rowLabel) return;
      
      // Get text without arrow symbols (▼ or ▶) for consistent matching
      let headerText = rowLabel.textContent?.trim() || '';
      // Remove arrow symbols for consistent key matching
      headerText = headerText.replace(/[▼▶]/g, '').trim();
      if (!headerText) return;
      
      const shouldBeExpanded = state[headerText];
      if (shouldBeExpanded === undefined) {
        return;
      }
      
      if (!shouldBeExpanded) {
        return; // Already collapsed by default
      }
      
      // Find content rows for this header
      const allRows = Array.from(header.parentElement.querySelectorAll('tr'));
      const headerIndex = allRows.indexOf(header);
      const contentRows = [];
      
      for (let i = headerIndex + 1; i < allRows.length; i++) {
        const row = allRows[i];
        if (row.classList.contains('collapsible-header') || 
            row.classList.contains('profit-loss-row') ||
            row.classList.contains('balance-row') ||
            row.classList.contains('roi-row') ||
            row.classList.contains('ebitda-row')) {
          break;
        }
        if (row.classList.contains('collapsible-content')) {
          contentRows.push(row);
        }
      }
      
      if (contentRows.length > 0 && shouldBeExpanded) {
        // Expand the section
        contentRows.forEach(row => {
          row.style.display = '';
        });
        
        // Update icon
        const toggleBtn = header.querySelector('.collapse-toggle');
        if (toggleBtn) {
          const icon = toggleBtn.querySelector('.collapse-icon');
          if (icon) {
            icon.textContent = '▼';
          }
          toggleBtn.setAttribute('title', 'Нажмите для скрытия деталей');
        }
      }
    });
  } catch (error) {
    console.error('Error restoring expanded state:', error);
  }
}

/**
 * Refresh PNL report silently (without showing loading indicator and without page jump)
 */
async function refreshPnlReportSilently() {
  if (!elements.reportContainer) {
    return;
  }

  const selectedYear = elements.yearSelect ? elements.yearSelect.value : new Date().getFullYear().toString();
  
  if (!selectedYear) {
    return;
  }

  try {
    // Save current scroll position
    const scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
    
    // Save expanded state before refresh
    saveExpandedState(selectedYear);
    
    const url = `${API_BASE}/pnl/report?year=${encodeURIComponent(selectedYear)}`;
    const response = await fetch(url);
    const result = await response.json();

    if (!response.ok || !result.success) {
      // Silent fail - don't show error, just log it
      addLog('error', `Ошибка обновления отчета: ${result.error || result.message}`);
      return;
    }

    renderReport(result.data);
    
    // Restore scroll position
    window.scrollTo(0, scrollPosition);
    
    // Restore expanded state after DOM is fully rendered
    setTimeout(() => {
      restoreExpandedState(selectedYear);
    }, 100);
  } catch (error) {
    // Silent fail - don't show error, just log it
    addLog('error', `Ошибка обновления отчета: ${error.message}`);
  }
}

function renderReport(data) {
  if (!data || !data.monthly || !Array.isArray(data.monthly)) {
    elements.reportContainer.innerHTML = '<div class="placeholder">Нет данных для отображения</div>';
    return;
  }

  const { monthly, total, year, categories, expenses, expensesTotal, profitLoss, balance, roi, ebitda } = data;
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
  if (total && total.currencyBreakdown && Object.keys(total.currencyBreakdown).length > 0) {
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
    // Header row: "Расходы" (sum of all expense categories) with collapse button
    const expenseHeaderRowHtml = `
      <tr class="category-header-row expense-header-row collapsible-header" data-section="expenses">
        <td class="row-label">
          <button class="collapse-toggle" aria-label="Свернуть/развернуть категории расходов" title="Нажмите для просмотра деталей">
            <span class="collapse-icon">▶</span>
          </button>
          <strong>Расходы</strong>
        </td>
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

    // Expense category rows (collapsed by default)
    const expenseCategoryRows = expenses.map(category => {
      const categoryMonthly = category.monthly || [];
      const categoryTotal = category.total?.amountPln || 0;
      const isManual = expenseCategoryMap.get(category.id)?.management_type === 'manual';
      
      return `
        <tr class="expense-row collapsible-content" style="display: none;">
          <td class="row-label category-indent">${escapeHtml(category.name)}</td>
          ${monthly.map(entry => {
            const monthEntry = categoryMonthly.find(m => m.month === entry.month);
            const amount = monthEntry?.amountPln || 0;
            const hasData = amount > 0;
            
            // Add currency breakdown for this month if available (in one line)
            let monthBreakdownHtml = '';
            if (hasData && monthEntry?.currencyBreakdown && Object.keys(monthEntry.currencyBreakdown).length > 0) {
              const breakdownItems = Object.keys(monthEntry.currencyBreakdown)
                .map(curr => `${formatCurrency(monthEntry.currencyBreakdown[curr])} ${curr}`)
                .join(', ');
              monthBreakdownHtml = ` <span class="currency-breakdown">(${breakdownItems})</span>`;
            }
            
            const editableClass = isManual ? ' editable' : '';
            const dataAttrs = isManual ? `data-expense-category-id="${category.id}" data-year="${year}" data-month="${entry.month}" data-entry-type="expense" data-has-data="${hasData}"` : '';
            
            // For manual categories: show plus icon centered if no data, otherwise show amount
            let cellContent = '';
            if (isManual) {
              if (hasData) {
                cellContent = `${formatCurrency(amount)}${monthBreakdownHtml}`;
              } else {
                // Show centered plus icon when no data
                cellContent = '<span class="add-expense-icon">+</span>';
              }
            } else {
              cellContent = hasData ? formatCurrency(amount) + monthBreakdownHtml : '';
            }
            
            return `<td class="amount-cell${editableClass}" ${dataAttrs} style="position: relative; cursor: ${isManual ? 'pointer' : 'default'};">
                      ${cellContent}
                    </td>`;
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
    // Header row: "Приходы" (sum of all categories) with collapse button
    const headerRowHtml = `
      <tr class="category-header-row collapsible-header" data-section="income">
        <td class="row-label">
          <button class="collapse-toggle" aria-label="Свернуть/развернуть категории доходов" title="Нажмите для просмотра деталей">
            <span class="collapse-icon">▶</span>
          </button>
          <strong>Приходы</strong>
        </td>
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
        <td class="amount-cell total-cell"><strong>${formatCurrency((total && total.amountPln) ? total.amountPln : 0)}</strong></td>
      </tr>
    `;

    // Category rows (collapsed by default)
    const categoryRows = categories.map(category => {
      const categoryMonthly = category.monthly || [];
      const categoryTotal = category.total?.amountPln || 0;
      const isManual = categoryMap.get(category.id)?.management_type === 'manual';
      
      return `
        <tr class="collapsible-content" style="display: none;">
          <td class="row-label category-indent">${escapeHtml(category.name)}</td>
          ${monthly.map(entry => {
            const monthEntry = categoryMonthly.find(m => m.month === entry.month);
            const amount = monthEntry?.amountPln || 0;
            const hasData = amount > 0;
            
            // Add currency breakdown for this month if available (in one line)
            let monthBreakdownHtml = '';
            if (hasData && monthEntry?.currencyBreakdown && Object.keys(monthEntry.currencyBreakdown).length > 0) {
              const breakdownItems = Object.keys(monthEntry.currencyBreakdown)
                .map(curr => `${formatCurrency(monthEntry.currencyBreakdown[curr])} ${curr}`)
                .join(', ');
              monthBreakdownHtml = ` <span class="currency-breakdown">(${breakdownItems})</span>`;
            }
            
            const editableClass = isManual ? ' editable' : '';
            const dataAttrs = isManual ? `data-category-id="${category.id}" data-year="${year}" data-month="${entry.month}" data-entry-type="revenue" data-has-data="${hasData}"` : '';
            
            // For manual categories: show plus icon centered if no data, otherwise show amount
            let cellContent = '';
            if (isManual) {
              if (hasData) {
                cellContent = `${formatCurrency(amount)}${monthBreakdownHtml}`;
              } else {
                cellContent = '<span class="add-expense-icon">+</span>';
              }
            } else {
              const amountDisplay = amount > 0 ? formatCurrency(amount) : '—';
              cellContent = `${amountDisplay}${monthBreakdownHtml}`;
            }
            
            return `<td class="amount-cell${editableClass}" ${dataAttrs} style="${isManual ? 'cursor: pointer; position: relative;' : ''}">${cellContent}</td>`;
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
        <td class="amount-cell total-cell"><strong>${formatCurrency((total && total.amountPln) ? total.amountPln : 0)}</strong></td>
      </tr>
    `;
  }

  // Build profit/loss row (Доход / Убыток) - displayed at the bottom
  let profitLossRowHtml = '';
  if (profitLoss && profitLoss.monthly && Array.isArray(profitLoss.monthly)) {
    profitLossRowHtml = `
      <tr class="profit-loss-row" style="background-color: #f8f9fa; border-top: 2px solid #333;">
        <td class="row-label"><strong>Доход / Убыток</strong></td>
        ${monthly.map(entry => {
          const profitLossEntry = profitLoss.monthly.find(p => p.month === entry.month);
          const profitLossAmount = profitLossEntry?.amountPln || 0;
          
          // Color: green for profit, red for loss
          const colorClass = profitLossAmount >= 0 ? 'profit' : 'loss';
          const color = profitLossAmount >= 0 ? '#10b981' : '#dc3545';
          const sign = profitLossAmount >= 0 ? '+' : '-';
          const amountDisplay = profitLossAmount !== 0 ? `${sign}${formatCurrency(Math.abs(profitLossAmount))}` : '—';
          
          return `<td class="amount-cell" style="color: ${color}; font-weight: 600;">${amountDisplay}</td>`;
        }).join('')}
        <td class="amount-cell total-cell" style="color: ${(profitLoss.total?.amountPln || 0) >= 0 ? '#10b981' : '#dc3545'}; font-weight: 600;">
          <strong>${(profitLoss.total?.amountPln || 0) >= 0 ? '+' : '-'}${formatCurrency(Math.abs(profitLoss.total?.amountPln || 0))}</strong>
        </td>
      </tr>
    `;
  }

  // Build balance row (Баланс) - cumulative running total, displayed after profit/loss
  let balanceRowHtml = '';
  if (balance && balance.monthly && Array.isArray(balance.monthly)) {
    balanceRowHtml = `
      <tr class="balance-row" style="background-color: #e8f5e9; border-top: 2px solid #4caf50;">
        <td class="row-label"><strong>Баланс</strong></td>
        ${monthly.map(entry => {
          const balanceEntry = balance.monthly.find(b => b.month === entry.month);
          const balanceAmount = balanceEntry?.amountPln || 0;
          
          // Color: green for positive balance, red for negative balance
          const color = balanceAmount >= 0 ? '#10b981' : '#dc3545';
          const sign = balanceAmount >= 0 ? '+' : '-';
          const amountDisplay = balanceAmount !== 0 ? `${sign}${formatCurrency(Math.abs(balanceAmount))}` : '—';
          
          return `<td class="amount-cell" style="color: ${color}; font-weight: 700;">${amountDisplay}</td>`;
        }).join('')}
        <td class="amount-cell total-cell" style="color: ${(balance.total?.amountPln || 0) >= 0 ? '#10b981' : '#dc3545'}; font-weight: 700;">
          <strong>${(balance.total?.amountPln || 0) >= 0 ? '+' : '-'}${formatCurrency(Math.abs(balance.total?.amountPln || 0))}</strong>
        </td>
      </tr>
    `;
  }

  // Build ROI row (ROI - Return on Investment) - displayed after balance
  // ROI = ((Revenue - Expenses) / Expenses) × 100% = (Profit/Loss / Expenses) × 100%
  let roiRowHtml = '';
  if (roi && roi.monthly && Array.isArray(roi.monthly)) {
    roiRowHtml = `
      <tr class="roi-row" style="background-color: #fff3cd; border-top: 2px solid #ffc107;">
        <td class="row-label"><strong>ROI (%)</strong></td>
        ${monthly.map(entry => {
          const roiEntry = roi.monthly.find(r => r.month === entry.month);
          const roiValue = roiEntry?.roi;
          
          // ROI can be null if expenses = 0 (cannot calculate)
          if (roiValue === null || roiValue === undefined) {
            return `<td class="amount-cell" style="color: #999;">—</td>`;
          }
          
          // Color: green for positive ROI, red for negative ROI
          const color = roiValue >= 0 ? '#10b981' : '#dc3545';
          const sign = roiValue >= 0 ? '+' : '';
          const roiDisplay = `${sign}${roiValue.toFixed(2)}%`;
          
          return `<td class="amount-cell" style="color: ${color}; font-weight: 600;">${roiDisplay}</td>`;
        }).join('')}
        <td class="amount-cell total-cell" style="color: ${(roi.total?.roi !== null && roi.total?.roi !== undefined && roi.total.roi >= 0) ? '#10b981' : '#dc3545'}; font-weight: 600;">
          <strong>${roi.total?.roi !== null && roi.total?.roi !== undefined ? `${roi.total.roi >= 0 ? '+' : ''}${roi.total.roi.toFixed(2)}%` : '—'}</strong>
        </td>
      </tr>
    `;
  }

  // Build EBITDA row (Earnings Before Interest, Taxes, Depreciation, and Amortization)
  // EBITDA = Revenue - Operating Expenses (excluding Taxes)
  // Note: We exclude taxes but don't have separate data for Interest, Depreciation, Amortization
  let ebitdaRowHtml = '';
  if (ebitda && ebitda.monthly && Array.isArray(ebitda.monthly)) {
    ebitdaRowHtml = `
      <tr class="ebitda-row" style="background-color: #e3f2fd; border-top: 2px solid #2196f3;">
        <td class="row-label"><strong>EBITDA</strong></td>
        ${monthly.map(entry => {
          const ebitdaEntry = ebitda.monthly.find(e => e.month === entry.month);
          const ebitdaAmount = ebitdaEntry?.amountPln || 0;
          
          // Color: green for positive EBITDA, red for negative EBITDA
          const color = ebitdaAmount >= 0 ? '#10b981' : '#dc3545';
          const sign = ebitdaAmount >= 0 ? '+' : '';
          const ebitdaDisplay = ebitdaAmount !== 0 ? `${sign}${formatCurrency(Math.abs(ebitdaAmount))}` : '—';
          
          return `<td class="amount-cell" style="color: ${color}; font-weight: 600;">${ebitdaDisplay}</td>`;
        }).join('')}
        <td class="amount-cell total-cell" style="color: ${(ebitda.total?.amountPln || 0) >= 0 ? '#10b981' : '#dc3545'}; font-weight: 600;">
          <strong>${(ebitda.total?.amountPln || 0) >= 0 ? '+' : ''}${formatCurrency(Math.abs(ebitda.total?.amountPln || 0))}</strong>
        </td>
      </tr>
    `;
  }

  // Calculate margin
  const revenue = (total && total.amountPln) ? Number(total.amountPln) : 0;
  const expensesAmount = expensesTotal?.amountPln ? Number(expensesTotal.amountPln) : 0;
  const margin = revenue - expensesAmount;
  const marginPercent = (revenue > 0 && Number.isFinite(revenue) && Number.isFinite(margin)) 
    ? ((margin / revenue) * 100) 
    : 0;

  // Calculate real margin (excluding certain expense categories)
  // Categories to exclude: "Продукты и бытовые вещи" (ID: 44) and "Авто и обслуживание"
  // Ищем по ID и по имени для надежности
  const excludedCategoryIds = [44]; // Продукты и бытовые вещи
  const excludedCategoryNames = ['продукты и бытовые', 'авто и обслуживание', 'food', 'car', 'auto', 'автомобиль'];
  let realExpensesAmount = expensesAmount;
  
  if (hasExpenses) {
    const excludedAmount = expenses
      .filter(cat => {
        // Проверяем по ID
        if (excludedCategoryIds.includes(cat.id)) {
          return true;
        }
        // Проверяем по имени
        const categoryName = (cat.name || '').toLowerCase();
        return excludedCategoryNames.some(excludedName => 
          categoryName.includes(excludedName.toLowerCase())
        );
      })
      .reduce((sum, cat) => sum + (Number(cat.total?.amountPln) || 0), 0);
    
    realExpensesAmount = expensesAmount - excludedAmount;
  }
  
  const realMargin = revenue - realExpensesAmount;
  const realMarginPercent = (revenue > 0 && Number.isFinite(revenue) && Number.isFinite(realMargin)) 
    ? ((realMargin / revenue) * 100) 
    : 0;

  let html = `
    <div class="pnl-summary">
      <h3>Год: ${year || 'N/A'}</h3>
      <div class="summary-stats">
        <div class="stat-item">
          <span class="stat-label">Всего приходов:</span>
          <span class="stat-value">${formatCurrency(revenue)} PLN</span>
        </div>
        ${expensesTotal ? `
        <div class="stat-item">
          <span class="stat-label">Всего расходов:</span>
          <span class="stat-value">${formatCurrency(expensesAmount)} PLN</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Маржинальность:</span>
          <span class="stat-value">${formatCurrency(margin)} PLN (${Number.isFinite(marginPercent) ? Math.round(marginPercent * 100) / 100 : '0'}%)</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Реальная маржинальность:</span>
          <span class="stat-value">${formatCurrency(realMargin)} PLN (${Number.isFinite(realMarginPercent) ? Math.round(realMarginPercent * 100) / 100 : '0'}%)</span>
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
          ${profitLossRowHtml}
          ${balanceRowHtml}
          ${roiRowHtml}
          ${ebitdaRowHtml}
        </tbody>
      </table>
    </div>
  `;

  elements.reportContainer.innerHTML = html;
  
  // Attach event listeners for editable cells (both revenue and expenses)
  if (hasCategories || hasExpenses) {
    attachEditableCellListeners();
  }
  
  // Attach collapse/expand handlers for category sections
  attachCollapseHandlers();
  
  // Attach click handlers for expense cells (opens add modal if no data, list modal if data exists)
  attachExpenseCellClickHandlers();
  
  // Attach click handlers for revenue cells (opens add modal if no data, list modal if data exists)
  attachRevenueCellClickHandlers();
  
  // Restore expanded state after all handlers are attached and DOM is ready
  // Use setTimeout to ensure DOM is fully rendered
  const selectedYear = elements.yearSelect ? elements.yearSelect.value : new Date().getFullYear().toString();
  if (selectedYear) {
    setTimeout(() => {
      restoreExpandedState(selectedYear);
    }, 0);
  }
}

function attachCollapseHandlers() {
  const headers = document.querySelectorAll('.collapsible-header');
  headers.forEach(header => {
    const toggleBtn = header.querySelector('.collapse-toggle');
    if (!toggleBtn) return;
    
    // Make entire header row clickable
    header.addEventListener('click', (e) => {
      // Don't trigger if clicking on editable cell
      if (e.target.closest('.editable')) return;
      
      const icon = toggleBtn.querySelector('.collapse-icon');
      // Find all collapsible content rows after this header until next header or summary row
      const allRows = Array.from(header.parentElement.querySelectorAll('tr'));
      const headerIndex = allRows.indexOf(header);
      const contentRows = [];
      
      for (let i = headerIndex + 1; i < allRows.length; i++) {
        const row = allRows[i];
        // Stop at next header or summary rows (profit/loss, balance, ROI, EBITDA)
        if (row.classList.contains('collapsible-header') || 
            row.classList.contains('profit-loss-row') ||
            row.classList.contains('balance-row') ||
            row.classList.contains('roi-row') ||
            row.classList.contains('ebitda-row')) {
          break;
        }
        if (row.classList.contains('collapsible-content')) {
          contentRows.push(row);
        }
      }
      
      if (contentRows.length === 0) return;
      
      // Toggle visibility
      // Check if section is expanded (display is not 'none')
      const isExpanded = contentRows[0]?.style.display !== 'none';
      
      contentRows.forEach(row => {
        row.style.display = isExpanded ? 'none' : '';
      });
      
      // Update icon
      if (icon) {
        icon.textContent = isExpanded ? '▶' : '▼';
      }
      
      // Update button title
      toggleBtn.setAttribute('title', isExpanded ? 'Нажмите для просмотра деталей' : 'Нажмите для скрытия деталей');
      
      // Save expanded state to localStorage
      const selectedYear = elements.yearSelect ? elements.yearSelect.value : new Date().getFullYear().toString();
      if (selectedYear) {
        saveExpandedState(selectedYear);
      }
    });
  });
}

function attachEditableCellListeners() {
  const editableCells = elements.reportContainer.querySelectorAll('.amount-cell.editable');
  
  editableCells.forEach(cell => {
    // For expense and revenue entries with management_type='manual', use modal instead of inline edit
    const entryType = cell.getAttribute('data-entry-type');
    if (entryType === 'expense' || entryType === 'revenue') {
      // Expense and revenue cells will be handled by attachExpenseCellClickHandlers and attachRevenueCellClickHandlers
      return;
    }
    cell.addEventListener('click', handleCellClick);
  });
}

/**
 * Attach click handlers for expense category cells
 * If no data: open add modal
 * If data exists: open list modal
 */
function attachExpenseCellClickHandlers() {
  const expenseCells = elements.reportContainer.querySelectorAll('.amount-cell[data-entry-type="expense"]');
  
  expenseCells.forEach(cell => {
    cell.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent other handlers from firing
      
      const expenseCategoryId = parseInt(cell.getAttribute('data-expense-category-id'), 10);
      const year = parseInt(cell.getAttribute('data-year'), 10);
      const month = parseInt(cell.getAttribute('data-month'), 10);
      const hasData = cell.getAttribute('data-has-data') === 'true';
      
      if (!expenseCategoryId || !year || !month) {
        addLog('error', `Недостаточно данных для открытия модального окна: expenseCategoryId=${expenseCategoryId}, year=${year}, month=${month}`);
        return;
      }
      
      if (hasData) {
        // If data exists, show list modal
        showExpenseListModal(expenseCategoryId, year, month);
      } else {
        // If no data, show add modal
        showAddExpenseModal(expenseCategoryId, year, month);
      }
    });
  });
}

/**
 * Attach click handlers for revenue category cells
 * If no data: open add modal
 * If data exists: open list modal
 */
function attachRevenueCellClickHandlers() {
  const revenueCells = elements.reportContainer.querySelectorAll('.amount-cell[data-entry-type="revenue"]');
  
  revenueCells.forEach(cell => {
    cell.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent other handlers from firing
      
      const categoryId = parseInt(cell.getAttribute('data-category-id'), 10);
      const year = parseInt(cell.getAttribute('data-year'), 10);
      const month = parseInt(cell.getAttribute('data-month'), 10);
      const hasData = cell.getAttribute('data-has-data') === 'true';
      
      if (!categoryId || !year || !month) {
        addLog('error', `Недостаточно данных для открытия модального окна: categoryId=${categoryId}, year=${year}, month=${month}`);
        return;
      }
      
      if (hasData) {
        // If data exists, show list modal
        showRevenueListModal(categoryId, year, month);
      } else {
        // If no data, show add modal
        showAddRevenueModal(categoryId, year, month);
      }
    });
  });
}

function handleCellClick(e) {
  const cell = e.currentTarget;
  if (cell.classList.contains('editing') || cell.classList.contains('saving')) {
    return;
  }
  
  // Don't handle expense entries here - they have their own handler
  const entryType = cell.getAttribute('data-entry-type');
  if (entryType === 'expense') {
    return;
  }
  
  const categoryId = parseInt(cell.getAttribute('data-category-id'), 10) || null;
  const expenseCategoryId = parseInt(cell.getAttribute('data-expense-category-id'), 10) || null;
  const year = parseInt(cell.getAttribute('data-year'), 10);
  const month = parseInt(cell.getAttribute('data-month'), 10);
  
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
    return '0';
  }
  // Округляем до целых чисел
  return Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
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

  // Check if display_order is available (at least one category should have it)
  const hasDisplayOrder = categories.some(cat => cat.display_order != null);

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

// ==================== Manual Cash Expense Entries ====================

let currentExpenseContext = null; // { expenseCategoryId, year, month }
let currentExpenseListContext = null; // { expenseCategoryId, year, month }
let currentEditEntryId = null; // ID of entry being edited

/**
 * Show modal for adding expense entry
 */
function showAddExpenseModal(expenseCategoryId, year, month) {
  currentExpenseContext = { expenseCategoryId, year, month };
  const modal = document.getElementById('add-expense-modal');
  if (modal) {
    // Update modal title for expense
    const title = modal.querySelector('.modal-header h3');
    if (title) title.textContent = 'Добавить расход';
    modal.style.display = 'block';
    modal.setAttribute('data-entry-type', 'expense');
    const amountInput = document.getElementById('expense-amount');
    if (amountInput) {
      amountInput.focus();
    }
  }
}

/**
 * Close add expense modal
 */
function closeAddExpenseModal() {
  const modal = document.getElementById('add-expense-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  const amountInput = document.getElementById('expense-amount');
  const commentInput = document.getElementById('expense-comment');
  if (amountInput) amountInput.value = '';
  if (commentInput) commentInput.value = '';
  currentExpenseContext = null;
}

/**
 * Save expense entry
 */
async function saveExpenseEntry() {
  if (!currentExpenseContext) {
    addLog('error', 'Контекст расхода не найден');
    return;
  }

  const amountInput = document.getElementById('expense-amount');
  const commentInput = document.getElementById('expense-comment');
  
  if (!amountInput) {
    addLog('error', 'Поле суммы не найдено');
    return;
  }

  const amount = parseFloat(amountInput.value);
  const comment = commentInput ? commentInput.value.trim() : '';

  if (!amount || amount <= 0) {
    alert('Введите корректную сумму (больше нуля)');
    return;
  }

  try {
    addLog('info', `Сохранение расхода: ${amount} PLN...`);
    
    const response = await fetch(`${API_BASE}/pnl/manual-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expenseCategoryId: currentExpenseContext.expenseCategoryId,
        entryType: 'expense',
        year: currentExpenseContext.year,
        month: currentExpenseContext.month,
        amountPln: amount,
        notes: comment || null
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Ошибка сохранения');
    }

    addLog('success', `Расход сохранен: ${amount} PLN`);
    closeAddExpenseModal();
    
    // Refresh report silently (without showing loading indicator and without page jump)
    await refreshPnlReportSilently();
  } catch (error) {
    addLog('error', `Ошибка сохранения расхода: ${error.message}`);
    alert('Ошибка: ' + error.message);
  }
}

/**
 * Show expense list modal
 */
async function showExpenseListModal(expenseCategoryId, year, month) {
  currentExpenseListContext = { expenseCategoryId, year, month };
  
  try {
    // Validate parameters
    if (!expenseCategoryId || !Number.isFinite(expenseCategoryId) || expenseCategoryId <= 0) {
      throw new Error(`Некорректный expenseCategoryId: ${expenseCategoryId}`);
    }
    if (!year || !Number.isFinite(year) || year < 2020 || year > 2030) {
      throw new Error(`Некорректный year: ${year}`);
    }
    if (!month || !Number.isFinite(month) || month < 1 || month > 12) {
      throw new Error(`Некорректный month: ${month}`);
    }
    
    addLog('info', `Загрузка списка расходов: expenseCategoryId=${expenseCategoryId}, year=${year}, month=${month}`);
    
    const url = `${API_BASE}/pnl/manual-entries?expenseCategoryId=${expenseCategoryId}&year=${year}&month=${month}&entryType=expense`;
    addLog('info', `Запрос: ${url}`);
    
    const response = await fetch(url);
    const result = await response.json();

    if (!response.ok || !result.success) {
      const errorMsg = result.error || result.message || `HTTP ${response.status}: ${response.statusText}`;
      addLog('error', `Ошибка ответа сервера: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    const entries = result.data || [];
    addLog('success', `Загружено записей: ${entries.length}`);
    renderExpenseList(entries, expenseCategoryId, year, month);
    
    const modal = document.getElementById('expense-list-modal');
    if (modal) {
      // Update modal title for expense
      const title = document.getElementById('list-entry-title');
      if (title) title.textContent = 'Расходы за месяц';
      // Save context in modal data attributes for later use
      modal.setAttribute('data-expense-category-id', expenseCategoryId);
      modal.setAttribute('data-year', year);
      modal.setAttribute('data-month', month);
      modal.setAttribute('data-entry-type', 'expense');
      modal.style.display = 'block';
    }
  } catch (error) {
    addLog('error', `Ошибка загрузки списка расходов: ${error.message}`);
    alert('Ошибка: ' + error.message);
  }
}

/**
 * Render expense list
 */
function renderExpenseList(entries, expenseCategoryId, year, month) {
  const container = document.getElementById('expense-list-container');
  if (!container) return;

  if (entries.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Нет расходов за этот месяц</p>';
    return;
  }

  const total = entries.reduce((sum, e) => sum + (parseFloat(e.amount_pln) || 0), 0);
  const monthName = monthNames[month] || `Месяц ${month}`;

  container.innerHTML = `
    <div class="expense-list-header" style="margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 4px;">
      <strong>Итого за ${monthName}: ${formatCurrency(total)} PLN</strong>
      <div style="font-size: 0.9em; color: #666; margin-top: 5px;">Всего записей: ${entries.length}</div>
    </div>
    <div class="expense-list" style="max-height: 400px; overflow-y: auto;">
      ${entries.map(entry => {
        const createdDate = new Date(entry.created_at).toLocaleDateString('ru-RU', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        const entryType = entry.entry_type || 'expense';
        const editFunc = entryType === 'revenue' ? 'editRevenueEntry' : 'editExpenseEntry';
        const deleteFunc = entryType === 'revenue' ? 'deleteRevenueEntry' : 'deleteExpenseEntry';
        const amountColor = entryType === 'revenue' ? '#28a745' : '#dc3545';
        return `
          <div class="expense-entry-item" style="display: flex; justify-content: space-between; align-items: start; padding: 12px; border-bottom: 1px solid #ddd;">
            <div class="expense-entry-info" style="flex: 1;">
              <div class="expense-entry-amount" style="font-weight: bold; font-size: 16px; color: ${amountColor};">
                ${formatCurrency(entry.amount_pln)} PLN
              </div>
              <div class="expense-entry-comment" style="color: #666; margin-top: 4px; word-break: break-word;">
                ${entry.notes ? escapeHtml(entry.notes) : '<span style="color: #999;">(без комментария)</span>'}
              </div>
              <div class="expense-entry-date" style="color: #999; font-size: 12px; margin-top: 6px;">
                ${createdDate}
              </div>
            </div>
            <div class="expense-entry-actions" style="display: flex; gap: 8px; margin-left: 15px;">
              <button class="btn btn-sm btn-secondary" onclick="${editFunc}(${entry.id})" title="Редактировать">
                ✏️
              </button>
              <button class="btn btn-sm btn-danger" onclick="${deleteFunc}(${entry.id})" title="Удалить">
                🗑️
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Close expense list modal
 */
function closeExpenseListModal() {
  const modal = document.getElementById('expense-list-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  currentExpenseListContext = null;
}

/**
 * Show add expense modal from list modal
 */
function showAddExpenseModalFromList() {
  const modal = document.getElementById('expense-list-modal');
  if (!modal) {
    addLog('error', 'Модальное окно списка расходов не найдено');
    return;
  }
  
  // Get context from modal data attributes (more reliable than currentExpenseListContext)
  const expenseCategoryId = parseInt(modal.getAttribute('data-expense-category-id'), 10);
  const year = parseInt(modal.getAttribute('data-year'), 10);
  const month = parseInt(modal.getAttribute('data-month'), 10);
  
  if (!expenseCategoryId || !year || !month) {
    // Fallback to currentExpenseListContext if data attributes are missing
    if (!currentExpenseListContext) {
      addLog('error', 'Не удалось получить контекст для добавления расхода');
      return;
    }
    showAddExpenseModal(
      currentExpenseListContext.expenseCategoryId,
      currentExpenseListContext.year,
      currentExpenseListContext.month
    );
    return;
  }
  
  closeExpenseListModal();
  showAddExpenseModal(expenseCategoryId, year, month);
}

/**
 * Edit expense entry
 */
function editExpenseEntry(entryId, amount, notes) {
  currentEditEntryId = entryId;
  const modal = document.getElementById('edit-expense-modal');
  const amountInput = document.getElementById('edit-expense-amount');
  const commentInput = document.getElementById('edit-expense-comment');
  
  if (modal && amountInput && commentInput) {
    amountInput.value = amount || '';
    commentInput.value = notes || '';
    modal.style.display = 'block';
    amountInput.focus();
  }
}

/**
 * Close edit expense modal
 */
function closeEditExpenseModal() {
  const modal = document.getElementById('edit-expense-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  const amountInput = document.getElementById('edit-expense-amount');
  const commentInput = document.getElementById('edit-expense-comment');
  if (amountInput) amountInput.value = '';
  if (commentInput) commentInput.value = '';
  currentEditEntryId = null;
}

/**
 * Save edited expense entry
 */
async function saveEditedExpenseEntry() {
  if (!currentEditEntryId) {
    addLog('error', 'ID записи для редактирования не найден');
    return;
  }

  const amountInput = document.getElementById('edit-expense-amount');
  const commentInput = document.getElementById('edit-expense-comment');
  
  if (!amountInput) {
    addLog('error', 'Поле суммы не найдено');
    return;
  }

  const amount = parseFloat(amountInput.value);
  const comment = commentInput ? commentInput.value.trim() : '';

  if (!amount || amount <= 0) {
    alert('Введите корректную сумму (больше нуля)');
    return;
  }

  try {
    const modal = document.getElementById('edit-expense-modal');
    const entryType = modal ? modal.getAttribute('data-entry-type') : 'expense';
    const entryTypeName = entryType === 'revenue' ? 'дохода' : 'расхода';
    
    addLog('info', `Обновление ${entryTypeName} ID ${currentEditEntryId}...`);
    
    const response = await fetch(`${API_BASE}/pnl/manual-entries/${currentEditEntryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountPln: amount,
        notes: comment || null
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Ошибка обновления');
    }

    addLog('success', `${entryTypeName === 'дохода' ? 'Доход' : 'Расход'} обновлен: ${amount} PLN`);
    closeEditExpenseModal();
    
    // Refresh list and report silently
    if (modal && modal.style.display === 'block') {
      if (entryType === 'revenue' && currentRevenueListContext) {
        await showRevenueListModal(
          currentRevenueListContext.categoryId,
          currentRevenueListContext.year,
          currentRevenueListContext.month
        );
      } else if (entryType === 'expense' && currentExpenseListContext) {
        await showExpenseListModal(
          currentExpenseListContext.expenseCategoryId,
          currentExpenseListContext.year,
          currentExpenseListContext.month
        );
      }
    }
    await refreshPnlReportSilently();
  } catch (error) {
    addLog('error', `Ошибка обновления: ${error.message}`);
    alert('Ошибка: ' + error.message);
  }
}

/**
 * Delete expense entry
 */
async function deleteExpenseEntry(entryId) {
  if (!confirm('Удалить этот расход? Это действие нельзя отменить.')) {
    return;
  }

  try {
    addLog('info', `Удаление расхода ID ${entryId}...`);
    
    const response = await fetch(`${API_BASE}/pnl/manual-entries/${entryId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Ошибка удаления');
    }

    addLog('success', 'Расход удален');
    
    // Refresh list and report silently
    if (currentExpenseListContext) {
      await showExpenseListModal(
        currentExpenseListContext.expenseCategoryId,
        currentExpenseListContext.year,
        currentExpenseListContext.month
      );
    }
    await refreshPnlReportSilently();
  } catch (error) {
    addLog('error', `Ошибка удаления расхода: ${error.message}`);
    alert('Ошибка: ' + error.message);
  }
}

// ==================== Manual Cash Revenue Entries ====================

let currentRevenueContext = null; // { categoryId, year, month }
let currentRevenueListContext = null; // { categoryId, year, month }

/**
 * Show modal for adding revenue entry
 */
function showAddRevenueModal(categoryId, year, month) {
  currentRevenueContext = { categoryId, year, month };
  const modal = document.getElementById('add-expense-modal');
  if (modal) {
    // Update modal title for revenue
    const title = document.getElementById('add-entry-title');
    if (title) title.textContent = 'Добавить доход';
    modal.style.display = 'block';
    modal.setAttribute('data-entry-type', 'revenue');
    const amountInput = document.getElementById('expense-amount');
    if (amountInput) {
      amountInput.focus();
    }
  }
}


/**
 * Save revenue entry
 */
async function saveRevenueEntry() {
  if (!currentRevenueContext) {
    addLog('error', 'Контекст дохода не найден');
    return;
  }

  const amountInput = document.getElementById('expense-amount');
  const commentInput = document.getElementById('expense-comment');
  
  if (!amountInput) {
    addLog('error', 'Поле суммы не найдено');
    return;
  }

  const amount = parseFloat(amountInput.value);
  const comment = commentInput ? commentInput.value.trim() : '';

  if (!amount || amount <= 0) {
    alert('Введите корректную сумму (больше нуля)');
    return;
  }

  try {
    addLog('info', `Сохранение дохода: ${amount} PLN...`);
    
    const response = await fetch(`${API_BASE}/pnl/manual-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categoryId: currentRevenueContext.categoryId,
        entryType: 'revenue',
        year: currentRevenueContext.year,
        month: currentRevenueContext.month,
        amountPln: amount,
        notes: comment || null
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Ошибка сохранения');
    }

    addLog('success', `Доход сохранен: ${amount} PLN`);
    closeAddRevenueModal();
    
    // Refresh report silently
    await refreshPnlReportSilently();
  } catch (error) {
    addLog('error', `Ошибка сохранения дохода: ${error.message}`);
    alert('Ошибка: ' + error.message);
  }
}

/**
 * Close add revenue modal
 */
function closeAddRevenueModal() {
  const modal = document.getElementById('add-expense-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.removeAttribute('data-entry-type');
  }
  const amountInput = document.getElementById('expense-amount');
  const commentInput = document.getElementById('expense-comment');
  if (amountInput) amountInput.value = '';
  if (commentInput) commentInput.value = '';
  currentRevenueContext = null;
}

/**
 * Show revenue list modal
 */
async function showRevenueListModal(categoryId, year, month) {
  currentRevenueListContext = { categoryId, year, month };
  
  try {
    if (!categoryId || !Number.isFinite(categoryId) || categoryId <= 0) {
      throw new Error(`Некорректный categoryId: ${categoryId}`);
    }
    if (!year || !Number.isFinite(year) || year < 2020 || year > 2030) {
      throw new Error(`Некорректный year: ${year}`);
    }
    if (!month || !Number.isFinite(month) || month < 1 || month > 12) {
      throw new Error(`Некорректный month: ${month}`);
    }
    
    addLog('info', `Загрузка списка доходов: categoryId=${categoryId}, year=${year}, month=${month}`);
    
    const url = `${API_BASE}/pnl/manual-entries?categoryId=${categoryId}&year=${year}&month=${month}&entryType=revenue`;
    const response = await fetch(url);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || `HTTP ${response.status}`);
    }

    const entries = result.data || [];
    addLog('success', `Загружено записей: ${entries.length}`);
    renderRevenueList(entries, categoryId, year, month);
    
    const modal = document.getElementById('expense-list-modal');
    if (modal) {
      // Update modal title for revenue
      const title = document.getElementById('list-entry-title');
      if (title) title.textContent = 'Доходы за месяц';
      modal.setAttribute('data-category-id', categoryId);
      modal.setAttribute('data-year', year);
      modal.setAttribute('data-month', month);
      modal.setAttribute('data-entry-type', 'revenue');
      modal.style.display = 'block';
    }
  } catch (error) {
    addLog('error', `Ошибка загрузки списка доходов: ${error.message}`);
    alert('Ошибка: ' + error.message);
  }
}

/**
 * Render revenue list (reuses renderExpenseList with revenue-specific handlers)
 */
function renderRevenueList(entries, categoryId, year, month) {
  // Mark entries as revenue type and reuse the same rendering function
  entries.forEach(entry => {
    entry.entry_type = 'revenue';
  });
  renderExpenseList(entries, categoryId, year, month);
}

/**
 * Close revenue list modal
 */
function closeRevenueListModal() {
  const modal = document.getElementById('expense-list-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.removeAttribute('data-category-id');
    modal.removeAttribute('data-expense-category-id');
    modal.removeAttribute('data-year');
    modal.removeAttribute('data-month');
    modal.removeAttribute('data-entry-type');
  }
  currentRevenueListContext = null;
}

/**
 * Show add revenue modal from list
 */
function showAddRevenueModalFromList() {
  const modal = document.getElementById('expense-list-modal');
  if (!modal) return;
  
  const entryType = modal.getAttribute('data-entry-type');
  if (entryType !== 'revenue') {
    addLog('error', 'Неверный тип записи');
    return;
  }
  
  const categoryId = parseInt(modal.getAttribute('data-category-id'), 10);
  const year = parseInt(modal.getAttribute('data-year'), 10);
  const month = parseInt(modal.getAttribute('data-month'), 10);
  
  if (!categoryId || !year || !month) {
    // Fallback to context
    if (currentRevenueListContext) {
      showAddRevenueModal(
        currentRevenueListContext.categoryId,
        currentRevenueListContext.year,
        currentRevenueListContext.month
      );
    } else {
      addLog('error', 'Не удалось определить контекст для добавления дохода');
    }
    return;
  }
  
  closeRevenueListModal();
  showAddRevenueModal(categoryId, year, month);
}

/**
 * Edit revenue entry
 */
function editRevenueEntry(entryId) {
  currentEditEntryId = entryId;
  
  // Fetch entry data
  fetch(`${API_BASE}/pnl/manual-entries/${entryId}`)
    .then(res => res.json())
    .then(result => {
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Не удалось загрузить запись');
      }
      
      const entry = result.data;
      const amountInput = document.getElementById('edit-expense-amount');
      const commentInput = document.getElementById('edit-expense-comment');
      
      if (amountInput) amountInput.value = entry.amount_pln || '';
      if (commentInput) commentInput.value = entry.notes || '';
      
      const modal = document.getElementById('edit-expense-modal');
      if (modal) {
        // Update modal title based on entry type
        const title = document.getElementById('edit-entry-title');
        if (title) {
          title.textContent = entry.entry_type === 'revenue' ? 'Редактировать доход' : 'Редактировать расход';
        }
        modal.setAttribute('data-entry-type', entry.entry_type || 'expense');
        modal.style.display = 'block';
      }
    })
    .catch(error => {
      addLog('error', `Ошибка загрузки записи: ${error.message}`);
      alert('Ошибка: ' + error.message);
    });
}

/**
 * Save edited revenue entry
 */
async function saveEditedRevenueEntry() {
  if (!currentEditEntryId) {
    addLog('error', 'ID записи для редактирования не найден');
    return;
  }

  const amountInput = document.getElementById('edit-expense-amount');
  const commentInput = document.getElementById('edit-expense-comment');
  
  if (!amountInput) {
    addLog('error', 'Поле суммы не найдено');
    return;
  }

  const amount = parseFloat(amountInput.value);
  const comment = commentInput ? commentInput.value.trim() : '';

  if (!amount || amount <= 0) {
    alert('Введите корректную сумму (больше нуля)');
    return;
  }

  try {
    addLog('info', `Обновление дохода ID ${currentEditEntryId}...`);
    
    const response = await fetch(`${API_BASE}/pnl/manual-entries/${currentEditEntryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountPln: amount,
        notes: comment || null
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Ошибка обновления');
    }

    addLog('success', `Доход обновлен: ${amount} PLN`);
    closeEditExpenseModal();
    
    // Refresh list and report silently
    const modal = document.getElementById('expense-list-modal');
    if (modal && modal.style.display === 'block') {
      const entryType = modal.getAttribute('data-entry-type');
      if (entryType === 'revenue' && currentRevenueListContext) {
        await showRevenueListModal(
          currentRevenueListContext.categoryId,
          currentRevenueListContext.year,
          currentRevenueListContext.month
        );
      } else if (entryType === 'expense' && currentExpenseListContext) {
        await showExpenseListModal(
          currentExpenseListContext.expenseCategoryId,
          currentExpenseListContext.year,
          currentExpenseListContext.month
        );
      }
    }
    await refreshPnlReportSilently();
  } catch (error) {
    addLog('error', `Ошибка обновления дохода: ${error.message}`);
    alert('Ошибка: ' + error.message);
  }
}

/**
 * Delete revenue entry
 */
async function deleteRevenueEntry(entryId) {
  if (!confirm('Вы уверены, что хотите удалить этот доход?')) {
    return;
  }

  try {
    addLog('info', `Удаление дохода ID ${entryId}...`);
    
    const response = await fetch(`${API_BASE}/pnl/manual-entries/${entryId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Ошибка удаления');
    }

    addLog('success', 'Доход удален');
    
    // Refresh list and report silently
    const modal = document.getElementById('expense-list-modal');
    if (modal && modal.style.display === 'block') {
      const entryType = modal.getAttribute('data-entry-type');
      if (entryType === 'revenue' && currentRevenueListContext) {
        await showRevenueListModal(
          currentRevenueListContext.categoryId,
          currentRevenueListContext.year,
          currentRevenueListContext.month
        );
      } else if (entryType === 'expense' && currentExpenseListContext) {
        await showExpenseListModal(
          currentExpenseListContext.expenseCategoryId,
          currentExpenseListContext.year,
          currentExpenseListContext.month
        );
      }
    }
    await refreshPnlReportSilently();
  } catch (error) {
    addLog('error', `Ошибка удаления дохода: ${error.message}`);
    alert('Ошибка: ' + error.message);
  }
}

// Make functions available globally
window.showAddExpenseModal = showAddExpenseModal;
window.closeAddExpenseModal = closeAddExpenseModal;
window.saveExpenseEntry = saveExpenseEntry;
window.showExpenseListModal = showExpenseListModal;
window.closeExpenseListModal = closeExpenseListModal;
window.showAddExpenseModalFromList = showAddExpenseModalFromList;
window.showAddRevenueModal = showAddRevenueModal;
window.closeAddRevenueModal = closeAddRevenueModal;
window.saveRevenueEntry = saveRevenueEntry;
window.showRevenueListModal = showRevenueListModal;
window.closeRevenueListModal = closeRevenueListModal;
window.showAddRevenueModalFromList = showAddRevenueModalFromList;
window.editRevenueEntry = editRevenueEntry;
window.saveEditedRevenueEntry = saveEditedRevenueEntry;
window.deleteRevenueEntry = deleteRevenueEntry;

/**
 * Handle add entry from list (works for both expense and revenue)
 */
function handleAddEntryFromList() {
  const modal = document.getElementById('expense-list-modal');
  if (!modal) return;
  
  const entryType = modal.getAttribute('data-entry-type');
  if (entryType === 'revenue') {
    showAddRevenueModalFromList();
  } else {
    showAddExpenseModalFromList();
  }
}

window.handleAddEntryFromList = handleAddEntryFromList;

/**
 * Handle save edited entry (works for both expense and revenue)
 */
function handleSaveEditedEntry() {
  const modal = document.getElementById('edit-expense-modal');
  if (!modal) return;
  
  const entryType = modal.getAttribute('data-entry-type');
  if (entryType === 'revenue') {
    saveEditedRevenueEntry();
  } else {
    saveEditedExpenseEntry();
  }
}

window.handleSaveEditedEntry = handleSaveEditedEntry;

/**
 * Handle save entry (works for both expense and revenue)
 */
function handleSaveEntry() {
  const modal = document.getElementById('add-expense-modal');
  if (!modal) return;
  
  const entryType = modal.getAttribute('data-entry-type');
  if (entryType === 'revenue') {
    saveRevenueEntry();
  } else {
    saveExpenseEntry();
  }
}

window.handleSaveEntry = handleSaveEntry;

/**
 * Handle close add modal (works for both expense and revenue)
 */
function handleCloseAddModal() {
  const modal = document.getElementById('add-expense-modal');
  if (!modal) return;
  
  const entryType = modal.getAttribute('data-entry-type');
  if (entryType === 'revenue') {
    closeAddRevenueModal();
  } else {
    closeAddExpenseModal();
  }
}

window.handleCloseAddModal = handleCloseAddModal;

/**
 * Handle close list modal (works for both expense and revenue)
 */
function handleCloseListModal() {
  const modal = document.getElementById('expense-list-modal');
  if (!modal) return;
  
  const entryType = modal.getAttribute('data-entry-type');
  if (entryType === 'revenue') {
    closeRevenueListModal();
  } else {
    closeExpenseListModal();
  }
}

window.handleCloseListModal = handleCloseListModal;

/**
 * Handle close edit modal (works for both expense and revenue)
 */
function handleCloseEditModal() {
  closeEditExpenseModal(); // Same function works for both
}

window.handleCloseEditModal = handleCloseEditModal;
window.editExpenseEntry = editExpenseEntry;
window.closeEditExpenseModal = closeEditExpenseModal;
window.saveEditedExpenseEntry = saveEditedExpenseEntry;
window.deleteExpenseEntry = deleteExpenseEntry;

