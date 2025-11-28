const API_BASE = '/api';

let elements = {};
let paymentsLoaded = false;
let productsLoaded = false;
let paymentReportLoaded = false;
let activeTab = 'report2';
let activePaymentsSubtab = 'incoming';
let deletedTabInitialized = false;
let deletedTabAutoLoaded = false;
let cashJournalInitialized = false;
let outgoingIframeObserver = null;

const paymentsState = {
  items: [],
  history: [],
  selectedId: null,
  details: new Map(),
  detailRowEl: null,
  detailCellEl: null
};

const productStatusLabels = {
  in_progress: 'В процессе',
  calculated: 'Рассчитан'
};

const paymentReportState = {
  groups: [],
  summary: null,
  filters: null
};

const deletedProformasState = {
  isLoading: false,
  lastResult: null
};

const stripeEventsState = {
  items: [],
  isLoaded: false,
  isLoading: false,
  error: null
};

const cashStatusLabels = {
  pending: 'Ожидается',
  pending_confirmation: 'На подтверждении',
  received: 'Получено',
  refunded: 'Возврат',
  cancelled: 'Отменено'
};

function saveSelectedPeriod() {
  if (!elements.monthSelect || !elements.yearSelect) return;
  const monthValue = elements.monthSelect.value;
  const yearValue = elements.yearSelect.value;
  if (monthValue) {
    window.localStorage.setItem('vatMargin.month', monthValue);
  }
  if (yearValue) {
    window.localStorage.setItem('vatMargin.year', yearValue);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();

  if (!elements.paymentReportContainer || !elements.logsContainer) {
    console.error('VAT Margin UI: missing core DOM nodes', elements);
    return;
  }

  initMonthYearSelectors();
  bindEvents();
  initTabs();
  applyInitialHashSelection();
  initOutgoingExpensesFrame();

  addLog('info', 'VAT Margin Tracker инициализирован');
});

function cacheDom() {
  elements = {
    vatMarginContainer: document.getElementById('vat-margin-container'),
    logsContainer: document.getElementById('logs-container'),
    loadVatMargin: document.getElementById('load-vat-margin'),
    exportReport: document.getElementById('export-report'),
    monthSelect: document.getElementById('month-select'),
    yearSelect: document.getElementById('year-select'),
    clearLogs: document.getElementById('clear-logs'),
    tabButtons: Array.from(document.querySelectorAll('.tab-button')),
    tabContents: Array.from(document.querySelectorAll('.tab-content')),
    refreshProducts: document.getElementById('refresh-products'),
    productSummaryTable: document.getElementById('product-summary-table'),
    bankCsvInput: document.getElementById('bank-csv-input'),
    expensesCsvInput: document.getElementById('expenses-csv-input'),
    bulkApproveMatches: document.getElementById('bulk-approve-matches'),
    resetMatches: document.getElementById('reset-matches'),
    exportPayments: document.getElementById('export-payments'),
    uploadsHistory: document.querySelector('[data-history="list"]'),
    paymentsTable: document.getElementById('payments-table'),
    paymentReportContainer: document.getElementById('payment-report-container'),
    paymentReportSummary: document.getElementById('payment-report-summary'),
    exportPaymentReport: document.getElementById('export-payment-report'),
    refreshDeleted: document.getElementById('refresh-deleted'),
    exportDeleted: document.getElementById('export-deleted'),
    deletedClearLog: document.getElementById('deleted-clear-log'),
    deletedDateFrom: document.getElementById('deleted-date-from'),
    deletedDateTo: document.getElementById('deleted-date-to'),
    deletedStatus: document.getElementById('deleted-status'),
    deletedSearch: document.getElementById('deleted-search'),
    deletedTable: document.getElementById('deleted-table'),
    deletedCount: document.getElementById('deleted-count'),
    deletedLog: document.getElementById('deleted-log'),
    stripeSummaryTable: document.getElementById('stripe-summary-table'),
    stripeEventsCount: document.getElementById('stripe-events-count'),
    stripeStatusIndicator: document.getElementById('stripe-status-indicator'),
    stripeRefreshEvents: document.getElementById('stripe-refresh-events'),
    paymentsSubtabButtons: Array.from(document.querySelectorAll('[data-payments-tab]')),
    paymentsIncomingSection: document.getElementById('payments-incoming'),
    paymentsOutgoingSection: document.getElementById('payments-outgoing'),
    outgoingExpensesIframe: document.getElementById('outgoing-expenses-iframe'),
    outgoingUploadButton: document.getElementById('outgoing-upload-btn'),
    outgoingRefreshButton: document.getElementById('outgoing-refresh-btn'),
    cashSummaryExpected: document.getElementById('cashSummaryExpected'),
    cashSummaryReceived: document.getElementById('cashSummaryReceived'),
    cashSummaryPending: document.getElementById('cashSummaryPending'),
    cashFilterProduct: document.getElementById('cashFilterProduct'),
    cashFilterStatus: document.getElementById('cashFilterStatus'),
    cashFiltersApply: document.getElementById('cashFiltersApply'),
    cashTableBody: document.getElementById('cashTableBody')
  };
}

function bindEvents() {
  elements.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  elements.loadVatMargin?.addEventListener('click', () => loadVatMarginData());
  elements.exportReport?.addEventListener('click', exportReportCsv);
  elements.clearLogs?.addEventListener('click', clearLogs);
  elements.refreshProducts?.addEventListener('click', () => {
    loadProductSummary();
  });
  elements.exportPaymentReport?.addEventListener('click', exportPaymentReportCsv);
  elements.bulkApproveMatches?.addEventListener('click', bulkApproveMatches);
  elements.resetMatches?.addEventListener('click', resetPaymentMatches);
  elements.exportPayments?.addEventListener('click', exportPaymentsCsv);
  elements.bankCsvInput?.addEventListener('change', handleCsvUpload);
  elements.expensesCsvInput?.addEventListener('change', handleExpensesCsvUpload);
  elements.paymentsTable?.addEventListener('click', handlePaymentActionClick);
  elements.stripeRefreshEvents?.addEventListener('click', () => loadStripeEvents({ force: true }));
  elements.cashFiltersApply?.addEventListener('click', () => loadCashJournal());
  elements.cashFilterStatus?.addEventListener('change', () => loadCashJournal());
  elements.cashFilterProduct?.addEventListener('change', () => loadCashJournal());
  elements.cashTableBody?.addEventListener('click', (event) => {
    const target = event.target;
    if (target.matches('.btn-confirm')) {
      const id = Number(target.dataset.id);
      if (Number.isFinite(id)) {
        confirmCashPayment(id);
      }
    }
    if (target.matches('.btn-refund')) {
      const id = Number(target.dataset.id);
      if (Number.isFinite(id)) {
        refundCashPayment(id);
      }
    }
  });
  initPaymentsSubtabs();

  initDeletedTab();

  [elements.monthSelect, elements.yearSelect].forEach((select) => {
    select?.addEventListener('change', () => {
      saveSelectedPeriod();

      if (activeTab === 'report2') {
        loadPaymentReportData({ silent: true });
      }
    });
  });
}

function initTabs() {
  switchTab('report2');
}

function switchTab(tabName) {
  activeTab = tabName;
  elements.tabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  elements.tabContents.forEach((content) => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });

  if (tabName === 'report2') {
    if (!paymentReportLoaded) {
      loadPaymentReportData();
    } else {
      renderPaymentReportSummary(paymentReportState.summary);
      renderPaymentReport(paymentReportState.groups);
    }
    return;
  }

  if (tabName === 'products') {
    if (!productsLoaded) {
      loadProductSummary();
      productsLoaded = true;
    } else {
      renderProductSummaryTable(productSummaryData);
    }
    return;
  }

  if (tabName === 'stripe') {
    if (!stripeEventsState.isLoaded) {
      loadStripeEvents();
    } else {
      renderStripeTransactions(stripeEventsState.items);
    }
    return;
  }

  if (tabName === 'deleted') {
    initDeletedTab();
    if (!deletedTabAutoLoaded) {
      deletedTabAutoLoaded = true;
      loadDeletedProformas();
    }
    return;
  }

  if (tabName === 'payments') {
    togglePaymentsSubtab('incoming', { suppressDataLoad: true });
    if (!paymentsLoaded) {
      loadPaymentsData();
      paymentsLoaded = true;
    }
    return;
  }

  if (tabName === 'cash-journal') {
    if (!cashJournalInitialized) {
      initCashJournalTab();
      cashJournalInitialized = true;
    } else {
      loadCashJournal();
    }
    return;
  }
}

function initPaymentsSubtabs() {
  if (!elements.paymentsSubtabButtons?.length) return;
  togglePaymentsSubtab(activePaymentsSubtab);
  elements.paymentsSubtabButtons.forEach((btn) => {
    btn.addEventListener('click', () => togglePaymentsSubtab(btn.dataset.paymentsTab));
  });
}

function togglePaymentsSubtab(subtab, options = {}) {
  const { suppressDataLoad = false } = options;
  activePaymentsSubtab = subtab || 'incoming';
  const sections = {
    incoming: elements.paymentsIncomingSection,
    outgoing: elements.paymentsOutgoingSection
  };

  elements.paymentsSubtabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.paymentsTab === activePaymentsSubtab);
  });

  Object.entries(sections).forEach(([key, section]) => {
    section?.classList.toggle('active', key === activePaymentsSubtab);
  });

  if (
    !suppressDataLoad &&
    activeTab === 'payments' &&
    activePaymentsSubtab === 'incoming' &&
    !paymentsLoaded
  ) {
    loadPaymentsData();
    paymentsLoaded = true;
  }
}

function initOutgoingExpensesFrame() {
  const iframe = elements.outgoingExpensesIframe;
  if (!iframe) return;

  const bindUploadProxy = () => {
    const uploadButton = elements.outgoingUploadButton;
    if (!uploadButton) return;
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) return;
    uploadButton.onclick = () => {
      try {
        const input = iframeDoc.getElementById('expensesCsvInput');
        if (input) {
          input.click();
        }
      } catch (error) {
        console.warn('VAT Margin: failed to trigger outgoing upload', error);
      }
    };
  };

  const resize = () => {
    if (!iframe || !iframe.contentWindow) return;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      const height = doc?.body?.scrollHeight || 0;
      if (height > 0) {
        iframe.style.height = `${height}px`;
      }
    } catch (error) {
      console.warn('VAT Margin: unable to resize outgoing expenses iframe', error);
    }
  };

  iframe.addEventListener('load', () => {
    resize();
    bindUploadProxy();
    const refreshButton = elements.outgoingRefreshButton;
    if (refreshButton) {
      refreshButton.onclick = () => {
        try {
          iframe.contentWindow?.loadExpenses?.();
        } catch (error) {
          console.warn('VAT Margin: failed to refresh outgoing expenses', error);
        }
      };
    }
    if (outgoingIframeObserver) {
      outgoingIframeObserver.disconnect();
    }
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      const target = doc?.body;
      if (target && typeof ResizeObserver !== 'undefined') {
        outgoingIframeObserver = new ResizeObserver(() => resize());
        outgoingIframeObserver.observe(target);
      }
    } catch (error) {
      console.warn('VAT Margin: unable to observe outgoing expenses iframe', error);
    }
  });
}

function initDeletedTab() {
  if (deletedTabInitialized) return;

  const hasRequiredElements = elements.refreshDeleted
    && elements.deletedTable
    && elements.deletedLog;

  if (!hasRequiredElements) {
    return;
  }

  setDeletedDefaultDates();

  elements.refreshDeleted?.addEventListener('click', () => loadDeletedProformas());
  elements.deletedClearLog?.addEventListener('click', clearDeletedLog);
  elements.deletedStatus?.addEventListener('change', handleDeletedFilterChange);
  elements.deletedDateFrom?.addEventListener('change', handleDeletedFilterChange);
  elements.deletedDateTo?.addEventListener('change', handleDeletedFilterChange);
  elements.deletedSearch?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      loadDeletedProformas();
    }
  });

  addDeletedLog('info', 'Готово к загрузке данных');
  deletedTabInitialized = true;
}

function setDeletedDefaultDates() {
  if (!elements.deletedDateFrom || !elements.deletedDateTo) return;

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const format = (date) => date.toISOString().slice(0, 10);

  elements.deletedDateFrom.value = format(start);
  elements.deletedDateTo.value = format(now);
}

function handleDeletedFilterChange() {
  if (deletedProformasState.isLoading) return;
  loadDeletedProformas();
}

function buildDeletedQueryParams() {
  const params = new URLSearchParams();
  params.set('page', '1');
  params.set('pageSize', '100');

  const dateFrom = elements.deletedDateFrom?.value;
  const dateTo = elements.deletedDateTo?.value;
  const status = elements.deletedStatus?.value;
  const search = elements.deletedSearch?.value?.trim();

  if (dateFrom) params.set('startDate', dateFrom);
  if (dateTo) params.set('endDate', dateTo);
  if (status && status !== 'all') params.set('status', status);
  if (search) params.set('search', search);

  return params;
}

async function loadDeletedProformas() {
  const hasDom = elements.deletedTable
    && elements.deletedLog
    && elements.refreshDeleted;

  if (!hasDom) {
    return;
  }

  if (deletedProformasState.isLoading) {
    return;
  }

  try {
    deletedProformasState.isLoading = true;
    setButtonLoading(elements.refreshDeleted, true, 'Загрузка...');
    addDeletedLog('info', 'Загружаем список удалённых проформ...');
    elements.exportDeleted && (elements.exportDeleted.disabled = true);

    const params = buildDeletedQueryParams();
    const response = await fetch(`${API_BASE}/vat-margin/deleted-proformas?${params.toString()}`);
    const result = await response.json();

    if (!response.ok || !result?.success) {
      throw new Error(result?.error || `HTTP ${response.status}`);
    }

    deletedProformasState.lastResult = result;
    renderDeletedTable(Array.isArray(result.data) ? result.data : []);
    if (elements.deletedCount) {
      const total = Number.isFinite(result.total) ? result.total : 0;
      elements.deletedCount.textContent = `${total} записей`;
    }
    addDeletedLog('success', `Загружено ${result.total ?? 0} записей`);
    if (elements.exportDeleted) {
      elements.exportDeleted.disabled = !(result.total > 0);
    }
  } catch (error) {
    console.error('Failed to load deleted proformas', error);
    renderDeletedError(error.message);
    addDeletedLog('error', `Ошибка загрузки: ${error.message}`);
  } finally {
    deletedProformasState.isLoading = false;
    setButtonLoading(elements.refreshDeleted, false);
  }
}

function renderDeletedTable(rows = []) {
  if (!elements.deletedTable) return;

  if (!Array.isArray(rows) || rows.length === 0) {
    elements.deletedTable.innerHTML = '<div class="placeholder">По заданным фильтрам ничего не найдено</div>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Номер</th>
        <th>Покупатель</th>
        <th>Сумма</th>
        <th>Платежи</th>
        <th>Баланс</th>
        <th>Валюта</th>
        <th>Удалена</th>
        <th>Выставлена</th>
        <th>Сделка</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(renderDeletedRow).join('')}
    </tbody>
  `;

  elements.deletedTable.innerHTML = '';
  elements.deletedTable.appendChild(table);
}

function renderDeletedRow(row) {
  const currency = row.currency || 'PLN';
  const formatter = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  });

  const formatNumber = (value) => {
    if (value === null || value === undefined) {
      return '—';
    }
    return formatter.format(value);
  };

  const deletedAt = row.deletedAt ? formatDateTime(row.deletedAt) : '—';
  const issuedAt = row.issuedAt ? formatDate(row.issuedAt) : '—';
  const buyerName = row.buyerName ? escapeHtml(row.buyerName) : '';
  const buyerEmail = row.buyerEmail ? escapeHtml(row.buyerEmail) : '';
  const buyer = [buyerName, buyerEmail].filter(Boolean).join('<br>');
  const number = escapeHtml(row.proformaNumber || row.fullnumber || '—');
  const dealIdRaw = row.dealId !== undefined && row.dealId !== null ? String(row.dealId) : '';
  const dealId = dealIdRaw.trim();
  const dealLink = dealId
    ? `<a href="https://comoon.pipedrive.com/deal/${encodeURIComponent(dealId)}" target="_blank" rel="noopener">Deal ${escapeHtml(dealId)}</a>`
    : '—';

  return `
    <tr>
      <td>${number}</td>
      <td>${buyer || '—'}</td>
      <td>${formatNumber(row.total)}</td>
      <td>${formatNumber(row.paymentsTotal)}</td>
      <td>${formatNumber(row.balance)}</td>
      <td>${escapeHtml(currency)}</td>
      <td>${deletedAt}</td>
      <td>${issuedAt}</td>
      <td>${dealLink}</td>
    </tr>
  `;
}

function renderDeletedError(message) {
  const safeMessage = escapeHtml(message || 'Неизвестная ошибка');
  elements.deletedTable && (elements.deletedTable.innerHTML = `<div class="error-box">${safeMessage}</div>`);
  if (elements.deletedCount) {
    elements.deletedCount.textContent = '0 записей';
  }
}

async function loadStripeEvents({ force = false } = {}) {
  if (!elements.stripeSummaryTable) return;
  if (stripeEventsState.isLoading) return;

  if (force) {
    stripeEventsState.items = [];
    stripeEventsState.isLoaded = false;
  }

  stripeEventsState.isLoading = true;
  stripeEventsState.error = null;
  updateStripeStatus('loading', 'Загружаем мероприятия...');
  elements.stripeSummaryTable.innerHTML = '<div class="placeholder">Загружаем мероприятия Stripe...</div>';
  if (elements.stripeEventsCount) {
    elements.stripeEventsCount.textContent = '0 мероприятий';
  }
  setButtonLoading(elements.stripeRefreshEvents, true, 'Загрузка...');

  try {
    const response = await fetch('/api/reports/stripe-events/summary?limit=100');
    const result = await response.json();
    if (!response.ok || result?.success === false) {
      throw new Error(result?.message || 'Не удалось получить мероприятия Stripe');
    }

    const items = Array.isArray(result?.data?.items) ? result.data.items : [];
    stripeEventsState.items = items;
    stripeEventsState.isLoaded = true;
    renderStripeEvents(items);
    const countText = formatEventsCount(items.length);
    if (elements.stripeEventsCount) {
      elements.stripeEventsCount.textContent = countText;
    }
    updateStripeStatus('success', `Подключено • ${countText}`);
  } catch (error) {
    console.error('Failed to load Stripe events summary', error);
    stripeEventsState.error = error.message;
    elements.stripeSummaryTable.innerHTML = `<div class="error-box">${escapeHtml(error.message || 'Не удалось загрузить мероприятия Stripe')}</div>`;
    if (elements.stripeEventsCount) {
      elements.stripeEventsCount.textContent = '0 мероприятий';
    }
    updateStripeStatus('error', 'Ошибка загрузки Stripe');
  } finally {
    stripeEventsState.isLoading = false;
    setButtonLoading(elements.stripeRefreshEvents, false);
  }
}

function renderStripeEvents(items = []) {
  if (!elements.stripeSummaryTable) return;

  if (!Array.isArray(items) || items.length === 0) {
    elements.stripeSummaryTable.innerHTML = '<div class="placeholder">Нет мероприятий Stripe</div>';
    return;
  }

  const tableHtml = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Мероприятие</th>
          <th class="numeric-col">Валюта</th>
          <th class="numeric-col">Сумма</th>
          <th class="numeric-col">Платежей</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(renderStripeEventRow).join('')}
      </tbody>
    </table>
  `;

  elements.stripeSummaryTable.innerHTML = tableHtml;
}

function renderStripeEventRow(event) {
  const eventKey = event?.eventKey || '';
  const label = escapeHtml(event?.eventLabel || eventKey || 'Без названия');
  const currencyCode = escapeHtml(event?.currency || 'PLN');
  const totalValue = Number(event?.grossRevenue);
  const amount = Number.isFinite(totalValue)
    ? formatCurrency(totalValue, event?.currency || 'PLN')
    : '—';
  const payments = Number.isFinite(Number(event?.paymentsCount)) ? Number(event.paymentsCount) : 0;
  const detailUrl = eventKey ? `/stripe-event-report?eventKey=${encodeURIComponent(eventKey)}` : null;
  const titleLink = detailUrl ? `<a href="${detailUrl}">${label}</a>` : label;

  return `
    <tr data-event-key="${escapeHtml(eventKey)}">
      <td>${titleLink}</td>
      <td class="numeric-col">${currencyCode}</td>
      <td class="numeric-col">${amount}</td>
      <td class="numeric-col">${payments}</td>
    </tr>
  `;
}

function updateStripeStatus(status, message) {
  if (!elements.stripeStatusIndicator) return;
  const classMap = {
    idle: 'status-idle',
    loading: 'status-loading',
    success: 'status-success',
    error: 'status-error'
  };

  elements.stripeStatusIndicator.textContent = message || '';
  elements.stripeStatusIndicator.classList.remove(
    'status-idle',
    'status-loading',
    'status-success',
    'status-error'
  );
  elements.stripeStatusIndicator.classList.add(classMap[status] || 'status-idle');
}

function formatEventsCount(count) {
  if (!Number.isFinite(count) || count <= 0) {
    return '0 мероприятий';
  }
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} мероприятие`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${count} мероприятия`;
  return `${count} мероприятий`;
}

function addDeletedLog(type, message) {
  if (!elements.deletedLog) return;

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="timestamp">[${timestamp}]</span>${message}`;
  elements.deletedLog.appendChild(entry);
  elements.deletedLog.scrollTop = elements.deletedLog.scrollHeight;
}

function clearDeletedLog() {
  if (!elements.deletedLog) return;
  elements.deletedLog.innerHTML = '';
  addDeletedLog('info', 'Лог очищен');
}


function initMonthYearSelectors() {
  if (!elements.monthSelect || !elements.yearSelect) return;

  const today = new Date();
  const monthOptions = Array.from(elements.monthSelect.options ?? []).map((option) => option.value);
  const yearOptions = Array.from(elements.yearSelect.options ?? []).map((option) => option.value);

  const defaultMonth = String(today.getMonth() + 1);
  const selectedMonth = monthOptions.includes(defaultMonth) ? defaultMonth : (monthOptions[0] || '');

  const yearFallback = (() => {
    const numericYears = yearOptions.map(Number).filter(Number.isFinite);
    if (numericYears.length === 0) {
      return String(today.getFullYear());
    }
    const minYear = Math.min(...numericYears);
    const maxYear = Math.max(...numericYears);
    const bounded = Math.min(maxYear, Math.max(minYear, today.getFullYear()));
    return String(bounded);
  })();

  const selectedYear = yearOptions.includes(String(today.getFullYear()))
    ? String(today.getFullYear())
    : yearFallback;

  if (selectedMonth) {
    elements.monthSelect.value = selectedMonth;
  }

  if (selectedYear) {
    elements.yearSelect.value = selectedYear;
  }

  saveSelectedPeriod();
}

function getSelectedPeriod() {
  const month = elements.monthSelect ? parseInt(elements.monthSelect.value, 10) : null;
  const year = elements.yearSelect ? parseInt(elements.yearSelect.value, 10) : null;
  return { month, year };
}

async function apiCall(endpoint, method = 'GET', data = null, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  const config = { method, headers };

  if (!(data instanceof FormData)) {
    config.headers['Content-Type'] = 'application/json';
  }

  if (data) {
    config.body = data instanceof FormData ? data : JSON.stringify(data);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, config);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const errorMessage = payload?.error || payload?.message || `HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload;
}

async function loadVatMarginData({ silent = false } = {}) {
  if (!elements.vatMarginContainer) return;

  try {
    const { month, year } = getSelectedPeriod();
    saveSelectedPeriod();

    if (!silent) {
      setButtonLoading(elements.loadVatMargin, true, 'Загрузка...');
    }

    addLog('info', `Запрашиваю данные за ${month}.${year}`);
    const query = new URLSearchParams({ month, year });
    const result = await apiCall(`/vat-margin/monthly-proformas?${query.toString()}`);

    if (!result?.success) {
      throw new Error(result?.error || 'Ошибка загрузки данных');
    }

    renderVatMarginTable(result.data || []);
    addLog('success', `Получено ${result.data?.length || 0} строк`);
  } catch (error) {
    console.error('VAT Margin fetch error:', error);
    addLog('error', `Ошибка загрузки отчёта: ${error.message}`);
    elements.vatMarginContainer.innerHTML = `
      <div class="placeholder">Не удалось получить данные. ${error.message}</div>
    `;
  } finally {
    if (!silent) {
      setButtonLoading(elements.loadVatMargin, false, '🔄 Обновить');
    }
  }
}

function normalizeProductKey(value) {
  if (value === null || value === undefined) {
    return 'без названия';
  }

  const normalized = String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\.\-_/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || 'без названия';
}

function renderVatMarginTable(data) {
  if (!elements.vatMarginContainer) return;

  if (!Array.isArray(data) || data.length === 0) {
    elements.vatMarginContainer.innerHTML = '<div class="placeholder">Нет данных за выбранный период</div>';
    return;
  }

  const groupsMap = new Map();

  data.forEach((item) => {
    const name = item.name && typeof item.name === 'string' && item.name.trim().length > 0
      ? item.name.trim()
      : 'Без названия';
    const currency = item.currency || 'PLN';
    const productKey = item.product_id
      ? `id:${item.product_id}`
      : item.product_key || normalizeProductKey(name);

    if (!groupsMap.has(productKey)) {
      groupsMap.set(productKey, {
        key: productKey,
        name,
        currencyTotals: {},
        rows: [],
        totals: {
          count: 0,
          quantity: 0,
          pln: 0,
          paid: 0,
          hasPln: false
        },
        proformas: new Set()
      });
    }

    const group = groupsMap.get(productKey);

    if ((group.name === 'Без названия' || group.name === normalizeProductKey(group.name))
      && name !== 'Без названия') {
      group.name = name;
    }

    const rawQuantity = Number(item.quantity ?? item.count ?? 0);
    const quantity = Number.isFinite(rawQuantity) && rawQuantity !== 0 ? rawQuantity : 1;
    const rawUnitPrice = Number(item.unit_price ?? item.price ?? 0);
    const unitPrice = Number.isFinite(rawUnitPrice) ? rawUnitPrice : 0;
    const rawLineTotal = Number(item.line_total);
    let lineTotal = Number.isFinite(rawLineTotal) ? rawLineTotal : unitPrice * quantity;
    if (!Number.isFinite(lineTotal)) {
      const fallbackTotal = Number(item.total ?? item.proforma_total ?? 0) || 0;
      lineTotal = fallbackTotal;
    }

    const exchangeRate = Number(item.currency_exchange ?? item.currencyExchange);
    let totalPlnValue = null;
    if (Number.isFinite(exchangeRate) && exchangeRate > 0) {
      totalPlnValue = lineTotal * exchangeRate;
    } else if (currency === 'PLN') {
      totalPlnValue = lineTotal;
    }

    const rawPaid = Number(item.payments_total_pln ?? item.payments_total ?? 0) || 0;
    const paidPln = totalPlnValue !== null ? Math.min(rawPaid, totalPlnValue) : rawPaid;
    const status = determinePaymentStatus(totalPlnValue ?? lineTotal, paidPln);

    group.rows.push({
      fullnumber: item.fullnumber || item.number || '—',
      date: item.date || null,
      currency,
      quantity,
      unitPrice,
      lineTotal,
      exchangeRate: Number.isFinite(exchangeRate) ? exchangeRate : null,
      totalPlnValue,
      paidPln,
      status,
      dealId: item.pipedrive_deal_id || null,
      dealUrl: item.pipedrive_deal_url || null,
      buyerName: item.buyer_name || item.buyer_alt_name || null,
      buyerAltName: item.buyer_alt_name || null,
      buyerEmail: item.buyer_email || null,
      buyerPhone: item.buyer_phone || null,
      buyerStreet: item.buyer_street || null,
      buyerZip: item.buyer_zip || null,
      buyerCity: item.buyer_city || null,
      buyerCountry: item.buyer_country || null
    });

    group.totals.count += 1;
    group.totals.quantity += quantity;
    group.currencyTotals[currency] = (group.currencyTotals[currency] || 0) + lineTotal;
    if (totalPlnValue !== null) {
      group.totals.pln += totalPlnValue;
      group.totals.paid += paidPln;
      group.totals.hasPln = true;
    }
    const proformaKey = item.fullnumber || item.number || `id:${item.proforma_id || item.id || Math.random()}`;
    group.proformas.add(proformaKey);
  });

  const groups = Array.from(groupsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  const html = groups
    .map((group) => {
      const originalParts = Object.entries(group.currencyTotals)
        .filter(([, amount]) => Number.isFinite(amount) && amount !== 0)
        .map(([cur, amount]) => formatCurrency(amount, cur));
      const totalOriginalFormatted = originalParts.length > 0
        ? originalParts.join(' + ')
        : '—';
      const totalPlnFormatted = group.totals.hasPln ? formatCurrency(group.totals.pln, 'PLN') : '—';
      const paidPlnFormatted = group.totals.hasPln ? formatCurrency(group.totals.paid, 'PLN') : '—';
      const proformaCount = group.proformas.size;

      const rowsHtml = group.rows
        .map((row) => {
          const dealId = row.dealId ? String(row.dealId) : null;
          const dealLinkHtml = row.dealUrl && dealId
            ? `<div class="deal-link-wrapper"><a class="deal-link" href="${row.dealUrl}" target="_blank" rel="noopener noreferrer">Deal #${escapeHtml(dealId)}</a></div>`
            : '';
          const buyerPrimary = row.buyerName || row.buyerAltName || null;
          const buyerMetaParts = [];
          if (row.buyerCity || row.buyerCountry) {
            const locationParts = [row.buyerCity, row.buyerCountry].filter(Boolean);
            if (locationParts.length) {
              buyerMetaParts.push(locationParts.join(', '));
            }
          }
          if (row.buyerStreet) {
            buyerMetaParts.push(row.buyerStreet);
          }
          const contactParts = [row.buyerEmail, row.buyerPhone].filter(Boolean);
          if (contactParts.length) {
            buyerMetaParts.push(contactParts.join(' • '));
          }
          const buyerCellHtml = buyerPrimary
            ? `
              <div class="buyer-name">${escapeHtml(buyerPrimary)}</div>
              ${buyerMetaParts.length ? `<div class="buyer-meta">${escapeHtml(buyerMetaParts.join(' | '))}</div>` : ''}
            `
            : '—';

          return `
          <tr>
            <td class="fullnumber">
              <div>${escapeHtml(row.fullnumber)}</div>
              ${dealLinkHtml}
            </td>
            <td>${formatDate(row.date)}</td>
            <td class="buyer-cell">${buyerCellHtml}</td>
            <td class="amount">${formatCurrency(row.lineTotal, row.currency)}</td>
            <td class="amount">${row.exchangeRate ? row.exchangeRate.toFixed(4) : '—'}</td>
            <td class="amount">${row.totalPlnValue !== null ? formatCurrency(row.totalPlnValue, 'PLN') : '—'}</td>
            <td class="amount">${row.totalPlnValue !== null ? formatCurrency(row.paidPln, 'PLN') : '—'}</td>
            <td><span class="status ${row.status.className}">${row.status.label}</span></td>
          </tr>
        `;
        })
        .join('');

      return `
        <div class="product-group">
          <div class="product-group-header">
            <div class="product-title">
              <div class="product-name">${escapeHtml(group.name)}</div>
              <div class="product-meta">${proformaCount.toLocaleString('ru-RU')} проф., ${group.totals.quantity.toLocaleString('ru-RU')} позиций</div>
            </div>
            <div class="product-summary">
              <span>${paidPlnFormatted !== '—' ? paidPlnFormatted : '0,00 PLN'}</span>
            </div>
          </div>
          <table class="payments-table group-table">
            <thead>
              <tr>
                <th>Проформа</th>
                <th>Дата</th>
                <th>Клиент</th>
                <th>Сумма</th>
                <th>Курс</th>
                <th>Всего в PLN</th>
                <th>Оплачено</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;
    })
    .join('');

  elements.vatMarginContainer.innerHTML = html;
}

// === Product Report Prototype ===

let productSummaryData = [];

async function loadProductSummary({ silent = false } = {}) {
  if (!elements.productSummaryTable) return;

  try {
    if (!silent) {
      elements.productSummaryTable.innerHTML = '<div class="placeholder">Загружаю данные по продуктам...</div>';
    }

    const result = await apiCall('/vat-margin/products/summary');

    if (!result?.success) {
      throw new Error(result?.error || 'Не удалось получить список продуктов');
    }

    productSummaryData = Array.isArray(result.data) ? result.data : [];
    renderProductSummaryTable(productSummaryData);

    if (!silent) {
      addLog('success', `Загружено продуктов: ${productSummaryData.length}`);
    }
  } catch (error) {
    console.error('Product summary fetch error:', error); // eslint-disable-line no-console
    addLog('error', `Ошибка при загрузке продуктов: ${error.message}`);
    elements.productSummaryTable.innerHTML = `<div class="placeholder">Не удалось загрузить данные: ${escapeHtml(error.message)}</div>`;
  }
}

function renderProductSummaryTable(products) {
  if (!elements.productSummaryTable) return;

  if (!Array.isArray(products) || products.length === 0) {
    elements.productSummaryTable.innerHTML = '<div class="placeholder">Нет продуктов для отображения</div>';
    return;
  }

  const rows = products
    .map((product) => {
      const details = [];
      if (typeof product.proformaCount === 'number') {
        details.push(`${product.proformaCount.toLocaleString('ru-RU')} проф.`);
      }
      if (product.lastSaleDate) {
        details.push(`последняя продажа ${formatDate(product.lastSaleDate)}`);
      }
      if (product.calculationDueMonth) {
        details.push(`рассчитать до ${formatMonthLabel(product.calculationDueMonth)}`);
      }

      let detailHtml = details.length
        ? `<div class="product-table-note">${escapeHtml(details.join(' • '))}</div>`
        : '';

      const stripeTotals = product.stripeTotals || null;
      const stripeWarnings = [];
      if (stripeTotals?.paymentsCount) {
        const stripeParts = [
          formatPaymentCount(stripeTotals.paymentsCount),
          formatCurrency(stripeTotals.grossPln || 0, 'PLN')
        ];
        if (stripeTotals.taxPln) {
          stripeParts.push(`VAT ${formatCurrency(stripeTotals.taxPln, 'PLN')}`);
        }
        details.push(`Stripe: ${stripeParts.filter(Boolean).join(' • ')}`);
        if (stripeTotals.missingVatCount) {
          stripeWarnings.push(`без VAT: ${stripeTotals.missingVatCount}`);
        }
        if (stripeTotals.invalidAddressCount) {
          stripeWarnings.push(`нет адреса: ${stripeTotals.invalidAddressCount}`);
        }
      }

      detailHtml = details.length
        ? `<div class="product-table-note">${escapeHtml(details.join(' • '))}</div>`
        : '';

      const stripeNote = stripeWarnings.length
        ? `<div class="product-table-note warning">${escapeHtml(`⚠️ ${stripeWarnings.join(', ')}`)}</div>`
        : '';

      const combinedNotes = [detailHtml, stripeNote].filter(Boolean).join('');

      const slug = encodeURIComponent(product.productSlug || product.productKey || product.productId || 'unknown');
      const detailUrl = `/vat-margin-product.html?product=${slug}`;

      return `
        <tr data-product-slug="${escapeHtml(product.productSlug || '')}">
          <td>
            <a class="product-link" href="${detailUrl}" data-product-link-id="${escapeHtml(product.productSlug || '')}">${escapeHtml(product.productName || 'Без названия')}</a>
            ${combinedNotes}
          </td>
          <td class="numeric">${(product.proformaCount || 0).toLocaleString('ru-RU')}</td>
          <td>
            <select class="status-select" data-product-slug="${escapeHtml(product.productSlug || '')}">
              <option value="in_progress"${product.calculationStatus === 'in_progress' ? ' selected' : ''}>В процессе</option>
              <option value="calculated"${product.calculationStatus === 'calculated' ? ' selected' : ''}>Рассчитан</option>
            </select>
          </td>
          <td>
            <input
              type="month"
              class="due-month-input"
              data-product-slug="${escapeHtml(product.productSlug || '')}"
              value="${product.calculationDueMonth || ''}"
              placeholder="YYYY-MM"
            />
          </td>
        </tr>
      `;
    })
    .join('');

  elements.productSummaryTable.innerHTML = `
    <table class="summary-table">
      <thead>
        <tr>
          <th>Продукт</th>
          <th>Проформ</th>
          <th>Статус</th>
          <th>Месяц расчёта</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  elements.productSummaryTable
    .querySelectorAll('.status-select')
    .forEach((select) => {
      select.addEventListener('change', () => {
        handleProductStatusChange(select.dataset.productSlug, select.value);
      });
    });

  elements.productSummaryTable
    .querySelectorAll('.due-month-input')
    .forEach((input) => {
      input.addEventListener('change', () => {
        handleProductDueMonthChange(input.dataset.productSlug, input.value);
      });
    });

  elements.productSummaryTable
    .querySelectorAll('[data-product-link]')
    .forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const targetSlug = link.dataset.productLink;
        if (targetSlug) {
          window.location.hash = 'tab-products';
          handleProductLinkClick(targetSlug);
          window.location.href = link.getAttribute('href');
        }
      });
    });
}

async function handleProductStatusChange(productSlug, nextStatus) {
  if (!productSlug) return;

  try {
    const result = await apiCall(`/vat-margin/products/${encodeURIComponent(productSlug)}/status`, 'POST', {
      status: nextStatus
    });

    if (!result?.success) {
      throw new Error(result?.error || 'Не удалось обновить статус');
    }

    const target = productSummaryData.find((item) => (item.productSlug || '') === result.data.productSlug);
    if (target) {
      target.calculationStatus = result.data.calculationStatus;
    }

    addLog('success', `Статус продукта обновлён на «${productStatusLabels[result.data.calculationStatus] || result.data.calculationStatus}»`);
    renderProductSummaryTable(productSummaryData);
  } catch (error) {
    addLog('error', `Не удалось обновить статус: ${error.message}`);
    renderProductSummaryTable(productSummaryData);
  }
}

async function handleProductDueMonthChange(productSlug, dueMonthValue) {
  if (!productSlug) return;

  try {
    const result = await apiCall(`/vat-margin/products/${encodeURIComponent(productSlug)}/status`, 'POST', {
      dueMonth: dueMonthValue || null
    });

    if (!result?.success) {
      throw new Error(result?.error || 'Не удалось обновить месяц расчёта');
    }

    const target = productSummaryData.find((item) => (item.productSlug || '') === result.data.productSlug);
    if (target) {
      target.calculationDueMonth = result.data.calculationDueMonth || null;
    }

    if (result.data.calculationDueMonth) {
      addLog('info', `Месяц расчёта обновлён на ${formatMonthLabel(result.data.calculationDueMonth)}`);
    } else {
      addLog('info', 'Месяц расчёта очищен');
    }

    renderProductSummaryTable(productSummaryData);
  } catch (error) {
    addLog('error', `Не удалось обновить месяц расчёта: ${error.message}`);
    renderProductSummaryTable(productSummaryData);
  }
}

function formatMonthLabel(monthString) {
  if (!monthString) return '—';
  const [year, month] = monthString.split('-').map((part) => parseInt(part, 10));
  if (!year || Number.isNaN(month) || month < 1 || month > 12) return monthString;

  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric'
  });
}

function determinePaymentStatus(totalPln, paidPln) {
  if (totalPln <= 0) {
    return { label: '—', className: 'auto' };
  }

  const ratio = paidPln / totalPln;
  if (ratio >= 0.98) return { label: 'Оплачено', className: 'auto' };
  if (ratio > 0) return { label: 'Частично', className: 'needs_review' };
  return { label: 'Ожидает оплаты', className: 'unmatched' };
}

function formatCurrency(amount, currency = 'PLN') {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU');
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU');
}

function formatPaymentCount(count) {
  if (!Number.isFinite(count) || count <= 0) return '';
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} платеж`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} платежа`;
  }
  return `${count} платежей`;
}

async function exportReportCsv() {
  const { month, year } = getSelectedPeriod();
  const url = `${API_BASE}/vat-margin/export?${new URLSearchParams({ month, year }).toString()}`;
  window.open(url, '_blank');
  addLog('info', 'Экспорт отчёта запрошен');
}

async function loadPaymentReportData({ silent = false } = {}) {
  if (!elements.paymentReportContainer) return;

  try {
    const { month, year } = getSelectedPeriod();
    saveSelectedPeriod();
    const params = new URLSearchParams();
    if (Number.isFinite(month)) params.set('month', month);
    if (Number.isFinite(year)) params.set('year', year);
    params.set('status', 'all');

    if (!silent && elements.loadPaymentReport) {
      setButtonLoading(elements.loadPaymentReport, true, 'Загрузка...');
    }

    addLog('info', `Запрашиваю платежный отчёт за ${month}.${year}`);
    const result = await apiCall(`/vat-margin/payment-report?${params.toString()}`);

    if (!result?.success) {
      throw new Error(result?.error || 'Ошибка загрузки отчёта');
    }

    paymentReportState.groups = Array.isArray(result.data) ? result.data : [];
    paymentReportState.summary = result.summary || null;
    paymentReportState.filters = result.filters || null;
    paymentReportLoaded = true;

    renderPaymentReportSummary(paymentReportState.summary);
    renderPaymentReport(paymentReportState.groups);

    const paymentsCount = paymentReportState.summary?.payments_count
      ?? paymentReportState.groups.reduce(
        (acc, group) => acc + (group?.totals?.payments_count || 0),
        0
      );
    addLog('success', `Получено платежей: ${paymentsCount}`);
  } catch (error) {
    console.error('Payment report fetch error:', error);
    addLog('error', `Ошибка загрузки платежного отчёта: ${error.message}`);
    if (elements.paymentReportContainer) {
      elements.paymentReportContainer.innerHTML = `<div class="placeholder">Не удалось получить данные. ${escapeHtml(error.message)}</div>`;
    }
    if (elements.paymentReportSummary) {
      elements.paymentReportSummary.innerHTML = '';
    }
  } finally {
    if (!silent && elements.loadPaymentReport) {
      setButtonLoading(elements.loadPaymentReport, false, '🔄 Обновить');
    }
  }
}

function renderPaymentReportSummary(summary) {
  if (!elements.paymentReportSummary) return;
  if (!summary) {
    elements.paymentReportSummary.innerHTML = '';
    return;
  }

  const cardsHtml = `
    <div class="summary-card">
      <span class="summary-label">Платежей</span>
      <span class="summary-value">${(summary.payments_count || 0).toLocaleString('ru-RU')}</span>
    </div>
    <div class="summary-card">
      <span class="summary-label">Продуктов</span>
      <span class="summary-value">${(summary.products_count || 0).toLocaleString('ru-RU')}</span>
    </div>
    <div class="summary-card">
      <span class="summary-label">Всего (PLN)</span>
      <span class="summary-value">${formatCurrency(summary.total_pln || 0, 'PLN')}</span>
    </div>
    <div class="summary-card">
      <span class="summary-label">Без привязки</span>
      <span class="summary-value">${(summary.unmatched_count || 0).toLocaleString('ru-RU')}</span>
    </div>
  `;

  elements.paymentReportSummary.innerHTML = cardsHtml;
}

function renderPaymentReport(groups) {
  if (!elements.paymentReportContainer) return;
  if (!Array.isArray(groups) || groups.length === 0) {
    elements.paymentReportContainer.innerHTML = '<div class="placeholder">Нет данных за выбранный период</div>';
    return;
  }

  const html = groups.map((group) => {
    const currencyTotals = Object.entries(group.totals?.currency_totals || {})
      .filter(([, amount]) => Number.isFinite(amount) && amount !== 0)
      .map(([cur, amount]) => formatCurrency(amount, cur))
      .join(' + ') || '—';

    const plnTotal = formatCurrency(group.totals?.pln_total || 0, 'PLN');
    const proformaCount = group.totals?.proforma_count || 0;
    const paymentsCount = group.totals?.payments_count || 0;

    const rows = (group.entries || []).map((entry) => {
      const paymentCount = entry.totals?.payment_count || 0;
      const entryCurrencyTotals = Object.entries(entry.totals?.currency_totals || {})
        .filter(([, amount]) => Number.isFinite(amount) && amount !== 0)
        .map(([cur, amount]) => formatCurrency(amount, cur))
        .join(' + ') || '—';
      const entryPlnTotal = formatCurrency(entry.totals?.pln_total || 0, 'PLN');

      const proforma = entry.proforma || null;

      const proformaLabel = proforma?.fullnumber
        ? escapeHtml(proforma.fullnumber)
        : '—';

      const dealLink = proforma?.pipedrive_deal_url && proforma?.pipedrive_deal_id
        ? `<div class="deal-link-wrapper"><a class="deal-link" href="${proforma.pipedrive_deal_url}" target="_blank" rel="noopener noreferrer">Deal #${escapeHtml(String(proforma.pipedrive_deal_id))}</a></div>`
        : '';

      const proformaCell = proforma
        ? `
          <div class="proforma-info">
            <div>${proformaLabel}</div>
            ${dealLink}
          </div>
        `
        : '—';

      const firstDate = entry.first_payment_date ? formatDate(entry.first_payment_date) : null;
      const lastDate = entry.last_payment_date ? formatDate(entry.last_payment_date) : null;
      let dateLabel = firstDate || '—';
      if (firstDate && lastDate && firstDate !== lastDate) {
        dateLabel = `${firstDate} → ${lastDate}`;
      }

      const payerLabel = entry.payer_names && entry.payer_names.length > 0
        ? escapeHtml(entry.payer_names.join(', '))
        : '—';

      const paymentCountLabel = formatPaymentCount(paymentCount);
      const paymentsBadge = paymentCount > 1 ? `<div class="payments-count-badge">${paymentCountLabel}</div>` : '';

      return `
        <tr>
          <td>
            <div>${dateLabel}</div>
            ${paymentsBadge}
          </td>
          <td>${payerLabel}</td>
          <td class="amount">${entryCurrencyTotals}</td>
          <td class="amount">${entryPlnTotal}</td>
          <td>${proformaCell}</td>
          <td>
            <span class="status ${entry.status?.className || 'auto'}">${escapeHtml(entry.status?.label || '—')}</span>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="product-group">
        <div class="product-group-header">
          <div class="product-title">
            <div class="product-name">${escapeHtml(group.name || 'Без названия')}</div>
            <div class="product-meta">${proformaCount.toLocaleString('ru-RU')} проф., ${paymentsCount.toLocaleString('ru-RU')} платеж(ей)</div>
          </div>
          <div class="product-summary">
            <span>${plnTotal}</span>
            <span class="currency-breakdown">${currencyTotals}</span>
          </div>
        </div>
        <table class="payments-table group-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Плательщик</th>
              <th>Сумма</th>
              <th>Сумма (PLN)</th>
              <th>Проформа</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }).join('');

  elements.paymentReportContainer.innerHTML = html;
}

function exportPaymentReportCsv() {
  const { month, year } = getSelectedPeriod();
  const params = new URLSearchParams();
  if (Number.isFinite(month)) params.set('month', month);
  if (Number.isFinite(year)) params.set('year', year);
  params.set('status', 'all');
  window.open(`${API_BASE}/vat-margin/payment-report/export?${params.toString()}`, '_blank');
  addLog('info', 'Экспорт платежного отчёта запрошен');
}

async function loadPaymentsData({ silent = false } = {}) {
  if (!elements.paymentsTable) return;

  try {
    if (!silent) addLog('info', 'Загрузка приходных платежей...');
    // Загружаем только приходные платежи (direction='in')
    const result = await apiCall('/vat-margin/payments?direction=in');

    if (!result?.success) {
      throw new Error(result?.error || 'Не удалось получить платежи');
    }

    const previousSelectedId = paymentsState.selectedId;

    // Фильтруем только приходные платежи (direction='in'), не подтвержденные вручную,
    // и не являющиеся возвратами (income_category_id не должен быть установлен)
    // Примечание: основная фильтрация возвратов происходит на бэкенде в SQL запросе, это дополнительная защита
    paymentsState.items = (Array.isArray(result.data) ? result.data : [])
      .filter((item) => {
        // Дополнительная проверка на клиенте для безопасности
        // Если есть income_category_id, это может быть возврат (возвраты исключаются из списка приходных платежей)
        const isRefund = !!item.income_category_id;
        return item.direction === 'in' && item.manual_status !== 'approved' && !isRefund;
      });
    paymentsState.history = Array.isArray(result.history) ? result.history : [];

    const pendingIds = new Set(paymentsState.items.map((item) => String(item.id)));
    Array.from(paymentsState.details.keys()).forEach((key) => {
      if (!pendingIds.has(key)) {
        paymentsState.details.delete(key);
      }
    });

    renderPaymentsTable(paymentsState.items);

    if (previousSelectedId && paymentsState.items.some((item) => String(item.id) === String(previousSelectedId))) {
      paymentsState.selectedId = String(previousSelectedId);
      const selectedRow = getPaymentRowElement(paymentsState.selectedId);
      if (selectedRow) {
        await selectPaymentRow(selectedRow, { forceReload: true, skipScroll: true });
      } else {
        clearPaymentDetailRow();
      }
    } else {
      paymentsState.selectedId = null;
      clearPaymentDetailRow();
    }

    if (!silent) addLog('success', `Получено ${paymentsState.items.length} платежей`);
  } catch (error) {
    console.warn('Payments fetch error:', error.message);
    if (!silent) addLog('warning', `Не удалось загрузить платежи: ${error.message}`);
    renderPaymentsPlaceholder(error.message);
  }
}

function renderPaymentsPlaceholder(message = 'Пока нет данных') {
  if (!elements.paymentsTable) return;
  elements.paymentsTable.innerHTML = `<div class="placeholder">${message}</div>`;
  clearPaymentDetailRow();
}

function renderUploadsHistory(history) {
  if (!elements.uploadsHistory) return;

  if (!Array.isArray(history) || history.length === 0) {
    elements.uploadsHistory.innerHTML = '<li class="placeholder">Загрузите CSV, чтобы увидеть историю</li>';
    return;
  }

  elements.uploadsHistory.innerHTML = history
    .map((item) => `
      <li>
        <div class="meta">
          <span>📄 ${escapeHtml(item.filename || 'bank.csv')}</span>
          <span>⏱ ${formatDate(item.uploaded_at) || '—'}</span>
          <span>👤 ${escapeHtml(item.user || '—')}</span>
        </div>
        <div class="meta">
          <span>✅ ${item.matched || 0}</span>
          <span>⚠️ ${item.needs_review || 0}</span>
        </div>
      </li>
    `)
    .join('');
}

function renderPaymentsTable(data) {
  if (!elements.paymentsTable) return;

  if (!Array.isArray(data) || data.length === 0) {
    renderPaymentsPlaceholder('Пока нет загруженных платежей');
    return;
  }

  clearPaymentDetailRow();

  const rows = data
    .map((item) => {
      const statusPresentation = getPaymentStatusPresentation(item);
      const manualBadge = renderManualStatusBadge(statusPresentation.badge);
      const rawPaymentId = String(item.id);
      const paymentId = escapeHtml(rawPaymentId);
      const isSelected = paymentsState.selectedId && paymentsState.selectedId === rawPaymentId;
      const confidence = Number.isFinite(item.confidence) ? `${Math.round(item.confidence)}%` : '—';
      const hasAutoMatch = Boolean(item.auto_proforma_fullnumber);

      return `
        <tr data-payment-id="${paymentId}"${isSelected ? ' class="selected"' : ''}>
          <td>${formatDate(item.date)}</td>
          <td>${escapeHtml(item.description || '')}</td>
          <td class="amount">${formatCurrency(item.amount || 0, item.currency || 'PLN')}</td>
          <td>${escapeHtml(item.payer || '—')}</td>
          <td>${escapeHtml(item.matched_proforma || '—')}</td>
          <td>
            <span class="status ${statusPresentation.className}">${statusPresentation.label}</span>
            ${manualBadge}
            <div class="status-meta">⭐ ${confidence}</div>
          </td>
          <td class="actions-cell">
            <button
              class="action-btn approve"
              data-action="approve"
              data-id="${paymentId}"
              ${hasAutoMatch ? '' : 'disabled'}
              title="${hasAutoMatch ? 'Подтвердить автоматическое совпадение' : 'Нет автоматического совпадения'}"
            >✓</button>
            <button
              class="action-btn delete"
              data-action="delete"
              data-id="${paymentId}"
              title="Удалить платеж"
            >✕</button>
          </td>
        </tr>
      `;
    })
    .join('');

  elements.paymentsTable.innerHTML = `
    <table class="payments-table">
      <thead>
        <tr>
          <th>Дата</th>
          <th>Описание</th>
          <th>Сумма</th>
          <th>Плательщик</th>
          <th>Проформа</th>
          <th>Статус</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  elements.paymentsTable
    .querySelectorAll('tbody tr')
    .forEach((row) => {
      row.addEventListener('click', handlePaymentRowClick);
    });

  highlightSelectedPaymentRow();

  if (paymentsState.selectedId) {
    const selectedRow = getPaymentRowElement(paymentsState.selectedId);
    if (selectedRow) {
      selectPaymentRow(selectedRow, { skipScroll: true }).catch(() => {
        clearPaymentDetailRow();
      });
    } else {
      clearPaymentDetailRow();
    }
  } else {
    clearPaymentDetailRow();
  }
}

function getPaymentStatusPresentation(item = {}) {
  if (item.manual_status === 'approved') {
    return { label: 'Сопоставлено (ручн.)', className: 'matched manual', badge: 'approved' };
  }

  if (item.manual_status === 'rejected') {
    return { label: 'Отклонено (ручн.)', className: 'unmatched manual', badge: 'rejected' };
  }

  const baseStatus = item.status || 'needs_review';
  const origin = item.origin || 'auto';

  if (baseStatus === 'matched') {
    if (origin === 'manual') {
      return { label: 'Сопоставлено (ручн.)', className: 'matched manual', badge: 'approved' };
    }
    return { label: 'Сопоставлено (авто)', className: 'matched', badge: null };
  }

  if (baseStatus === 'needs_review') {
    return { label: 'Требует проверки', className: 'needs_review', badge: null };
  }

  if (baseStatus === 'unmatched') {
    return { label: 'Не найдено', className: 'unmatched', badge: null };
  }

  return { label: 'Неизвестно', className: 'needs_review', badge: null };
}

function renderManualStatusBadge(type) {
  if (!type) return '';
  if (type === 'approved') {
    return '<span class="manual-status-badge">Ручное сопоставление</span>';
  }
  if (type === 'rejected') {
    return '<span class="manual-status-badge rejected">Отклонено вручную</span>';
  }
  return '';
}

function handlePaymentRowClick(event) {
  const row = event.currentTarget || event.target.closest('tr[data-payment-id]');
  if (!row || !row.dataset.paymentId) return;
  selectPaymentRow(row).catch((error) => {
    console.warn('selectPaymentRow error:', error);
  });
}

function handlePaymentActionClick(event) {
  const actionButton = event.target.closest('[data-action][data-id]');
  if (!actionButton || !elements.paymentsTable.contains(actionButton)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const { action, id } = actionButton.dataset;
  if (!id) return;

  if (action === 'approve') {
    approvePaymentQuick(id);
    return;
  }

  if (action === 'delete') {
    deletePaymentQuick(id);
  }
}

function highlightSelectedPaymentRow() {
  if (!elements.paymentsTable) return;
  const rows = elements.paymentsTable.querySelectorAll('tbody tr');
  rows.forEach((row) => {
    row.classList.toggle('selected', paymentsState.selectedId && row.dataset.paymentId === paymentsState.selectedId);
  });
}

function getPaymentRowElement(paymentId) {
  if (!elements.paymentsTable) return null;
  const idKey = String(paymentId);
  try {
    const selector = `tbody tr[data-payment-id="${CSS && CSS.escape ? CSS.escape(idKey) : idKey}"]`;
    return elements.paymentsTable.querySelector(selector);
  } catch (error) {
    return elements.paymentsTable.querySelector(`tbody tr[data-payment-id="${idKey.replace(/"/g, '\\"')}"]`);
  }
}

function clearPaymentDetailRow() {
  if (paymentsState.detailRowEl && paymentsState.detailRowEl.parentNode) {
    paymentsState.detailRowEl.remove();
  }
  paymentsState.detailRowEl = null;
  paymentsState.detailCellEl = null;
}

function ensurePaymentDetailRow(anchorRow) {
  if (!anchorRow || !anchorRow.parentNode) {
    clearPaymentDetailRow();
    return { detailRow: null, detailCell: null };
  }

  const anchorId = anchorRow.dataset.paymentId;

  if (paymentsState.detailRowEl && paymentsState.detailRowEl.dataset.anchorId === anchorId) {
    paymentsState.detailCellEl.colSpan = anchorRow.children.length;
    return { detailRow: paymentsState.detailRowEl, detailCell: paymentsState.detailCellEl };
  }

  clearPaymentDetailRow();

  const detailRow = document.createElement('tr');
  detailRow.className = 'payment-detail-row';
  detailRow.dataset.anchorId = anchorId;

  const detailCell = document.createElement('td');
  detailCell.colSpan = anchorRow.children.length;
  detailCell.className = 'payment-detail-cell';
  detailCell.innerHTML = '<div class="payment-detail-placeholder">Выберите платеж, чтобы открыть детали</div>';

  detailRow.appendChild(detailCell);

  if (anchorRow.nextSibling) {
    anchorRow.parentNode.insertBefore(detailRow, anchorRow.nextSibling);
  } else {
    anchorRow.parentNode.appendChild(detailRow);
  }

  paymentsState.detailRowEl = detailRow;
  paymentsState.detailCellEl = detailCell;

  return { detailRow, detailCell };
}

function renderPaymentDetailPlaceholder(message = 'Выберите платеж, чтобы открыть детали', target = paymentsState.detailCellEl) {
  if (!target) return;
  target.innerHTML = `<div class="payment-detail-placeholder">${escapeHtml(message)}</div>`;
}

function renderPaymentDetailLoading(target = paymentsState.detailCellEl) {
  renderPaymentDetailPlaceholder('Загружаю детали платежа...', target);
}

async function selectPaymentRow(row, { forceReload = false, skipScroll = false } = {}) {
  if (!row) return;

  const paymentId = row.dataset.paymentId;
  const idKey = String(paymentId);

  paymentsState.selectedId = idKey;
  highlightSelectedPaymentRow();

  const { detailCell } = ensurePaymentDetailRow(row);
  if (!detailCell) {
    addLog('warning', 'Не удалось открыть панель детализации для выбранного платежа');
    return;
  }

  renderPaymentDetailLoading(detailCell);

  if (!skipScroll) {
    row.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  try {
    const detail = await loadPaymentDetails(idKey, { forceReload });
    renderPaymentDetail(detail, detailCell);
  } catch (error) {
    addLog('error', `Не удалось получить детали платежа: ${error.message}`);
    renderPaymentDetailPlaceholder(`Не удалось получить детали: ${escapeHtml(error.message)}`, detailCell);
  }
}

async function loadPaymentDetails(paymentId, { forceReload = false } = {}) {
  const cacheKey = String(paymentId);
  if (!forceReload && paymentsState.details.has(cacheKey)) {
    return paymentsState.details.get(cacheKey);
  }

  const result = await apiCall(`/vat-margin/payments/${encodeURIComponent(cacheKey)}`);
  if (!result?.success) {
    throw new Error(result?.error || 'Не удалось получить детали платежа');
  }

  paymentsState.details.set(cacheKey, result);
  return result;
}

function renderPaymentMeta(label, value) {
  return `
    <div class="payment-meta-row">
      <span class="payment-meta-label">${escapeHtml(label)}</span>
      <span class="payment-meta-value">${value}</span>
    </div>
  `;
}

function renderPaymentDetail(data, target = paymentsState.detailCellEl) {
  if (!target) return;
  if (!data || !data.payment) {
    renderPaymentDetailPlaceholder(undefined, target);
    return;
  }

  const { payment, candidates = [] } = data;
  const statusPresentation = getPaymentStatusPresentation(payment);
  const manualBadge = renderManualStatusBadge(statusPresentation.badge);
  const manualInputValue = payment.manual_status === 'approved'
    ? payment.matched_proforma || ''
    : payment.matched_proforma || payment.auto_proforma_fullnumber || '';
  const commentValue = payment.manual_comment || '';

  const metaRows = [
    renderPaymentMeta('ID платежа', escapeHtml(String(payment.id))),
    renderPaymentMeta('Дата', escapeHtml(formatDate(payment.date))),
    renderPaymentMeta('Сумма', escapeHtml(formatCurrency(payment.amount || 0, payment.currency || 'PLN'))),
    renderPaymentMeta('Плательщик', escapeHtml(payment.payer || '—')),
    renderPaymentMeta('Описание', escapeHtml(payment.description || '—')),
    renderPaymentMeta('Авто совпадение', escapeHtml(payment.auto_proforma_fullnumber || '—')),
    renderPaymentMeta('Текущая привязка', escapeHtml(payment.matched_proforma || '—')),
    renderPaymentMeta('Статус', escapeHtml(statusPresentation.label)),
    renderPaymentMeta('Уверенность', escapeHtml(
      Number.isFinite(payment.confidence) ? `${Math.round(payment.confidence)}%` : '—'
    ))
  ];

  const candidateItems = candidates.length > 0
    ? candidates.map((candidate) => {
      const isSelected = candidate.proforma_fullnumber === payment.matched_proforma;
      const candidateCurrency = candidate.proforma_currency || payment.currency || 'PLN';
      const amountDiff = Number.isFinite(candidate.amount_diff) ? formatCurrency(candidate.amount_diff, candidateCurrency) : '—';
      const isNotFound = !candidate.proforma_id; // Проформа не найдена в базе
      const cardClass = `candidate-card${isSelected ? ' selected' : ''}${isNotFound ? ' disabled' : ''}`;
      
      return `
        <li
          class="${cardClass}"
          data-fullnumber="${escapeHtml(candidate.proforma_fullnumber || '')}"
          data-proforma-id="${escapeHtml(String(candidate.proforma_id || ''))}"
        >
          <div class="candidate-title">${escapeHtml(candidate.proforma_fullnumber || '—')}</div>
          <div class="candidate-meta">
            ${isNotFound ? '' : `<span>👤 ${escapeHtml(candidate.buyer_name || '—')}</span>`}
            ${isNotFound ? '' : `<span>💰 ${formatCurrency(candidate.proforma_total || 0, candidateCurrency)}</span>`}
            ${isNotFound ? '' : `<span>⚖️ Остаток ${formatCurrency(candidate.remaining || 0, candidateCurrency)}</span>`}
            <span>⭐ ${candidate.score !== undefined ? escapeHtml(String(candidate.score)) : '—'}</span>
            ${isNotFound ? '' : `<span>Δ ${amountDiff}</span>`}
            ${candidate.reason ? `<span class="candidate-reason">${escapeHtml(candidate.reason)}</span>` : ''}
          </div>
        </li>
      `;
    }).join('')
    : '<li class="candidate-card disabled">Совпадения не найдены</li>';

  target.innerHTML = `
    <div class="payment-detail" data-payment-id="${escapeHtml(String(payment.id))}">
      <header>
        <h3>Платёж ${formatCurrency(payment.amount || 0, payment.currency || 'PLN')}</h3>
        ${manualBadge || ''}
      </header>
      <div class="payment-meta">
        ${metaRows.join('')}
      </div>
      <div class="manual-match-panel">
        <label for="payment-proforma-input">Номер проформы</label>
        <input id="payment-proforma-input" type="text" autocomplete="off" value="${escapeHtml(manualInputValue)}" placeholder="Например: CO-PROF 123/2025" />
        <span class="manual-match-hint">Введите номер проформы и нажмите «Сохранить», чтобы подтвердить связь вручную.</span>
        <label for="payment-comment-input">Комментарий</label>
        <textarea id="payment-comment-input" rows="3" placeholder="Комментарий для истории">${escapeHtml(commentValue)}</textarea>
        <div class="manual-match-actions">
          <button class="btn btn-primary" id="payment-manual-save">💾 Сохранить</button>
          <button class="btn btn-secondary" id="payment-manual-reset">↩️ Очистить</button>
          ${payment.direction === 'in' ? '<button class="btn btn-warning" id="payment-move-to-expense" style="background: #f59e0b; color: white;">📤 Перекинуть в расходы</button>' : ''}
          ${payment.direction === 'in' ? '<button class="btn btn-info" id="payment-send-to-pnl" style="background: #0ea5e9; color: white;">📊 Отправить в PNL (возвраты)</button>' : ''}
        </div>
      </div>
      <div class="candidate-panel">
        <h4>Возможные совпадения</h4>
        <ul class="candidate-list">
          ${candidateItems}
        </ul>
      </div>
    </div>
  `;

  setupPaymentDetailHandlers(payment.id, target);
}

function setupPaymentDetailHandlers(paymentId, root = paymentsState.detailCellEl) {
  if (!root) return;

  const input = root.querySelector('#payment-proforma-input');
  const comment = root.querySelector('#payment-comment-input');
  const saveButton = root.querySelector('#payment-manual-save');
  const resetButton = root.querySelector('#payment-manual-reset');
  const moveToExpenseButton = root.querySelector('#payment-move-to-expense');
  const sendToPnlButton = root.querySelector('#payment-send-to-pnl');
  const candidateCards = root.querySelectorAll('.candidate-card');

  candidateCards.forEach((card) => {
    if (card.classList.contains('disabled')) return;
    card.addEventListener('click', () => {
      const fullnumber = card.dataset.fullnumber || '';
      if (input) {
        input.value = fullnumber;
        input.focus();
      }
      candidateCards.forEach((node) => {
        node.classList.toggle('selected', node === card);
      });
    });
  });

  saveButton?.addEventListener('click', async () => {
    if (!input) return;
    const fullnumber = input.value.trim();
    if (!fullnumber) {
      addLog('warning', 'Введите номер проформы перед сохранением');
      input.focus();
      return;
    }

    try {
      setButtonLoading(saveButton, true, 'Сохранение...');
      const result = await apiCall(`/vat-margin/payments/${encodeURIComponent(paymentId)}/assign`, 'POST', {
        fullnumber,
        comment: comment?.value?.trim() || null
      });

      paymentsState.details.set(String(paymentId), result);
      updatePaymentInState(result.payment);
      renderPaymentsTable(paymentsState.items);
      paymentsState.selectedId = result.payment && result.payment.manual_status === 'approved'
        ? null
        : String(paymentId);
      if (paymentsState.selectedId) {
        const updatedRow = getPaymentRowElement(paymentsState.selectedId);
        if (updatedRow) {
          selectPaymentRow(updatedRow, { skipScroll: true }).catch(() => clearPaymentDetailRow());
        } else {
          clearPaymentDetailRow();
        }
      } else {
        clearPaymentDetailRow();
      }
      addLog('success', `Платёж ${paymentId} привязан к проформе ${fullnumber}`);
    } catch (error) {
      addLog('error', `Не удалось сохранить привязку: ${error.message}`);
    } finally {
      setButtonLoading(saveButton, false, '💾 Сохранить');
    }
  });

  resetButton?.addEventListener('click', async () => {
    try {
      setButtonLoading(resetButton, true, 'Очистка...');
      const result = await apiCall(`/vat-margin/payments/${encodeURIComponent(paymentId)}/unmatch`, 'POST', {
        comment: comment?.value?.trim() || null
      });

      paymentsState.details.set(String(paymentId), result);
      updatePaymentInState(result.payment);
      renderPaymentsTable(paymentsState.items);
      paymentsState.selectedId = String(paymentId);
      const updatedRow = getPaymentRowElement(paymentsState.selectedId);
      if (updatedRow) {
        selectPaymentRow(updatedRow, { skipScroll: true }).catch(() => clearPaymentDetailRow());
      } else {
        clearPaymentDetailRow();
      }
      addLog('info', `Привязка платежа ${paymentId} сброшена`);
    } catch (error) {
      addLog('error', `Не удалось сбросить привязку: ${error.message}`);
    } finally {
      setButtonLoading(resetButton, false, '↩️ Очистить');
    }
  });

  // Handle "Move to Expense" button
  moveToExpenseButton?.addEventListener('click', async () => {
    if (!confirm(`Вы уверены, что хотите перекинуть этот платёж в расходы?\n\nПлатёж будет перемещен из раздела приходных платежей в раздел расходов. Привязка к проформам будет удалена.`)) {
      return;
    }

    try {
      setButtonLoading(moveToExpenseButton, true, 'Перенос...');
      
      const result = await apiCall(`/vat-margin/payments/${encodeURIComponent(paymentId)}/direction`, 'PUT', {
        direction: 'out'
      });

      if (!result?.success || !result?.payment) {
        throw new Error(result?.error || 'Не удалось изменить направление платежа');
      }

      // Удаляем платеж из деталей
      paymentsState.details.delete(String(paymentId));
      
      // Удаляем из списка приходных платежей (теперь это расход)
      paymentsState.items = paymentsState.items.filter((item) => String(item.id) !== String(paymentId));
      paymentsState.selectedId = null;
      clearPaymentDetailRow();
      
      // Перезагружаем список приходных платежей с сервера для обновления
      await loadPaymentsData({ silent: true });
      
      addLog('success', `Платёж ${paymentId} перекинут в расходы`);
    } catch (error) {
      addLog('error', `Не удалось перекинуть платёж в расходы: ${error.message}`);
    } finally {
      setButtonLoading(moveToExpenseButton, false, '📤 Перекинуть в расходы');
    }
  });

  // Handle "Send to PNL" button (for refunds)
  sendToPnlButton?.addEventListener('click', async () => {
    if (!confirm('Отправить этот платеж в раздел "Возвраты" PNL отчета? Платеж не будет сопоставлен с проформами.')) {
      return;
    }

    try {
      setButtonLoading(sendToPnlButton, true, 'Отправка...');
      
      // Mark payment as refund by setting it to a special income category "Возвраты"
      const result = await apiCall(`/vat-margin/payments/${encodeURIComponent(paymentId)}/mark-as-refund`, 'POST', {
        comment: comment?.value?.trim() || null
      });

      paymentsState.details.set(String(paymentId), result);
      updatePaymentInState(result.payment);
      renderPaymentsTable(paymentsState.items);
      
      // Remove from list (refunds are shown separately in PNL)
      paymentsState.items = paymentsState.items.filter((item) => String(item.id) !== String(paymentId));
      paymentsState.selectedId = null;
      clearPaymentDetailRow();
      
      addLog('success', `Платеж ${paymentId} отправлен в раздел "Возвраты" PNL отчета`);
    } catch (error) {
      addLog('error', `Не удалось отправить платеж в PNL: ${error.message}`);
    } finally {
      setButtonLoading(sendToPnlButton, false, '📊 Отправить в PNL (возвраты)');
    }
  });
}

function updatePaymentInState(payment) {
  if (!payment) return;
  const idKey = String(payment.id);

  // Удаляем платеж, если он подтвержден вручную, если это не приходной платеж,
  // или если он помечен как возврат (имеет income_category_id - возвраты исключаются из списка приходных платежей)
  // Примечание: основная фильтрация возвратов происходит на бэкенде в SQL запросе
  const isRefund = !!payment.income_category_id; // Если есть income_category_id, это может быть возврат

  if (payment.manual_status === 'approved' || payment.direction !== 'in' || isRefund) {
    paymentsState.items = paymentsState.items.filter((item) => String(item.id) !== idKey);
    paymentsState.details.delete(idKey);
    return;
  }

  // Обновляем только приходные платежи (direction='in'), которые не являются возвратами
  const index = paymentsState.items.findIndex((item) => String(item.id) === idKey);
  if (index !== -1) {
    paymentsState.items[index] = payment;
  } else {
    // Добавляем только если это приходной платеж и не возврат
    if (payment.direction === 'in' && !isRefund) {
      paymentsState.items.unshift(payment);
    }
  }
}

async function handleCsvUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.name.endsWith('.csv')) {
    addLog('warning', 'Поддерживаются только CSV файлы');
    return;
  }

  addLog('info', `Загрузка файла ${file.name}...`);
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch(`${API_BASE}/vat-margin/payments/upload`, {
      method: 'POST',
      body: formData
    });

    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || 'Не удалось загрузить файл');
    }

    addLog('success', `Файл ${file.name} загружен. Сопоставлено: ${payload.matched || 0}`);
    elements.bankCsvInput.value = '';
    await loadPaymentsData({ silent: true });
  } catch (error) {
    addLog('error', `Ошибка загрузки CSV: ${error.message}`);
  }
}

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
    addLog('success', `Файл расходов ${file.name} загружен. Обработано: ${stats.processed || 0}, категоризировано: ${stats.categorized || 0}, без категории: ${stats.uncategorized || 0}`);
    elements.expensesCsvInput.value = '';
    // Reload PNL report if it's open
    if (typeof loadPnlReport === 'function') {
      loadPnlReport();
    }
  } catch (error) {
    addLog('error', `Ошибка загрузки CSV расходов: ${error.message}`);
  }
}

async function bulkApproveMatches() {
  try {
    setButtonLoading(elements.bulkApproveMatches, true, 'Подтверждаю...');
    const result = await apiCall('/vat-margin/payments/apply', 'POST');
    if (!result.success) {
      throw new Error(result.error || 'Не удалось применить сопоставления');
    }
    const processed = result?.processed || 0;
    const skipped = result?.skipped || 0;
    if (processed === 0) {
      addLog('info', 'Нет автоматических совпадений для подтверждения');
    } else {
      addLog('success', `Подтверждено автоматически: ${processed}. Пропущено: ${skipped}.`);
    }
    await loadPaymentsData({ silent: true });
  } catch (error) {
    addLog('error', `Ошибка подтверждения: ${error.message}`);
  } finally {
    setButtonLoading(elements.bulkApproveMatches, false, '✅ Подтвердить авто-совпадения');
  }
}

async function resetPaymentMatches() {
  try {
    setButtonLoading(elements.resetMatches, true, 'Сброс...');
    const result = await apiCall('/vat-margin/payments/reset', 'POST');
    if (!result.success) {
      throw new Error(result.error || 'Не удалось сбросить сопоставления');
    }
    addLog('success', 'Сопоставления сброшены');
    await loadPaymentsData({ silent: true });
  } catch (error) {
    addLog('error', `Ошибка сброса: ${error.message}`);
  } finally {
    setButtonLoading(elements.resetMatches, false, '❌ Сбросить');
  }
}

async function approvePaymentQuick(paymentId) {
  const payment = paymentsState.items.find((item) => String(item.id) === String(paymentId));
  if (!payment) {
    addLog('warning', `Платёж ${paymentId} не найден в списке`);
    return;
  }

  if (!payment.auto_proforma_fullnumber) {
    addLog('warning', `У платежа ${paymentId} нет автоматического совпадения`);
    return;
  }

  try {
    addLog('info', `Подтверждаю платеж ${paymentId} → ${payment.auto_proforma_fullnumber}`);
    const result = await apiCall(`/vat-margin/payments/${encodeURIComponent(paymentId)}/approve`, 'POST');
    if (!result.success) {
      throw new Error(result.error || 'Не удалось подтвердить платеж');
    }

    paymentsState.details.delete(String(paymentId));
    updatePaymentInState(result.payment);
    renderPaymentsTable(paymentsState.items);
    paymentsState.selectedId = null;
    addLog('success', `Платёж ${paymentId} подтверждён`);
  } catch (error) {
    addLog('error', `Ошибка подтверждения платежа: ${error.message}`);
  }
}

async function deletePaymentQuick(paymentId) {
  const paymentIndex = paymentsState.items.findIndex((item) => String(item.id) === String(paymentId));
  if (paymentIndex === -1) {
    addLog('warning', `Платёж ${paymentId} не найден в списке`);
    return;
  }

  const payment = paymentsState.items[paymentIndex];
  const confirmation = window.confirm(`Удалить платеж ${paymentId} (${payment.payer || '—'}, ${formatCurrency(payment.amount || 0, payment.currency || 'PLN')})?`);
  if (!confirmation) {
    return;
  }

  try {
    addLog('info', `Удаляю платеж ${paymentId}`);
    const result = await apiCall(`/vat-margin/payments/${encodeURIComponent(paymentId)}`, 'DELETE');
    if (!result.success) {
      throw new Error(result.error || 'Не удалось удалить платеж');
    }

    paymentsState.details.delete(String(paymentId));
    paymentsState.items.splice(paymentIndex, 1);
    if (paymentsState.selectedId === String(paymentId)) {
      paymentsState.selectedId = null;
    }
    renderPaymentsTable(paymentsState.items);
    addLog('success', `Платёж ${paymentId} удалён`);
  } catch (error) {
    addLog('error', `Ошибка удаления платежа: ${error.message}`);
  }
}

function exportPaymentsCsv() {
  window.open(`${API_BASE}/vat-margin/payments/export`, '_blank');
  addLog('info', 'Экспорт платежей запрошен');
}

function initCashJournalTab() {
  loadCashProductOptions().finally(() => {
    loadCashJournal();
  });
}

async function loadCashJournal() {
  if (!elements.cashTableBody) return;

  const filters = {
    status: elements.cashFilterStatus?.value || '',
    productId: elements.cashFilterProduct?.value || ''
  };

  try {
    const [paymentsResult, summaryResult] = await Promise.allSettled([
      fetchCashJournalPayments(filters),
      fetchCashSummary(filters)
    ]);

    const payments = paymentsResult.status === 'fulfilled' ? paymentsResult.value : [];
    const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : [];

    renderCashJournalTable(payments);
    renderCashSummary(summary, payments);
  } catch (error) {
    console.error('Cash journal load failed', error);
    renderCashJournalTable([]);
    renderCashSummary([], []);
  }
}

async function fetchCashJournalPayments(filters = {}) {
  const url = new URL('/api/cash-payments', window.location.origin);
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, value);
    }
  });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Не удалось загрузить наличные платежи');
  }
  const data = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

async function fetchCashSummary(filters = {}) {
  const url = new URL('/api/cash-summary', window.location.origin);
  if (filters.productId) {
    url.searchParams.append('productId', filters.productId);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Не удалось загрузить сводку наличных');
  }
  const data = await response.json();
  return Array.isArray(data.summary) ? data.summary : [];
}

function renderCashJournalTable(items = []) {
  const tbody = elements.cashTableBody;
  if (!tbody) return;

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Нет данных за выбранный период</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  items.forEach((item) => {
    const rawBuyerName =
      item.metadata?.buyerName ||
      item.metadata?.buyer_name ||
      item.metadata?.personName ||
      item.metadata?.person_name ||
      item.proformas?.buyer_name ||
      item.proformas?.buyer_alt_name ||
      item.deal_person_name ||
      null;

    const buyerName = rawBuyerName || (item.deal_id ? `Сделка #${item.deал_id}` : '—');
    const clientCell = item.deal_id
      ? `<a href="https://comoon.pipedrive.com/deal/${item.deal_id}" target="_blank" rel="noopener">${buyerName}</a>`
      : buyerName;

    const canConfirm = item.status === 'pending' || item.status === 'pending_confirmation';
    const statusLabel = cashStatusLabels[item.status] || item.status || '—';

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${clientCell}</td>
      <td>${formatCurrency(item.cash_expected_amount || 0, item.currency || 'PLN')}</td>
      <td>${formatDate(item.expected_date)}</td>
      <td><span class="tag ${item.status}">${statusLabel}</span></td>
      <td>${item.cash_received_amount ? formatCurrency(item.cash_received_amount, item.currency || 'PLN') : '—'}</td>
      <td class="actions-cell">
        ${canConfirm ? `<button class="btn btn-primary btn-confirm" data-id="${item.id}">Подтвердить</button>` : ''}
        <button class="btn btn-secondary btn-refund" data-id="${item.id}">Возврат</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function renderCashSummary(summaryEntries = [], fallbackItems = []) {
  const expectedEl = elements.cashSummaryExpected;
  const receivedEl = elements.cashSummaryReceived;
  const pendingEl = elements.cashSummaryPending;
  if (!expectedEl || !receivedEl || !pendingEl) return;

  const totals = { expected: 0, received: 0, pending: 0 };

  if (Array.isArray(summaryEntries) && summaryEntries.length > 0) {
    summaryEntries.forEach((item) => {
      totals.expected += item.expected_total_pln || 0;
      totals.received += item.received_total_pln || 0;
      totals.pending += item.pending_total_pln || 0;
    });
  } else if (Array.isArray(fallbackItems)) {
    fallbackItems.forEach((item) => {
      const expected = Number(item.cash_expected_amount) || 0;
      const received = Number(item.cash_received_amount) || 0;
      totals.expected += expected;
      if (item.status === 'received') {
        totals.received += received || expected;
      } else if (item.status === 'pending' || item.status === 'pending_confirmation') {
        totals.pending += Math.max(expected - received, 0);
      }
    });
  }

  expectedEl.textContent = `${totals.expected.toFixed(2)} PLN`;
  receivedEl.textContent = `${totals.received.toFixed(2)} PLN`;
  pendingEl.textContent = `${totals.pending.toFixed(2)} PLN`;
}

async function loadCashProductOptions() {
  if (!elements.cashFilterProduct) return;
  try {
    const response = await fetch('/api/vat-margin/products/summary');
    if (!response.ok) {
      throw new Error('Не удалось загрузить продукты');
    }
    const payload = await response.json();
    const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const unique = new Map();
    items.forEach((item) => {
      const id = item.productId;
      const name = item.productName || `Продукт #${item.productId}`;
      const isActive = !item.calculationStatus || item.calculationStatus === 'in_progress';
      if (!id || unique.has(id) || !isActive) {
        return;
      }
      unique.set(id, name);
    });

    elements.cashFilterProduct.innerHTML = '<option value=\"\">Все продукты</option>';
    Array.from(unique.entries())
      .sort((a, b) => a[1].localeCompare(b[1], 'ru'))
      .forEach(([id, name]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        elements.cashFilterProduct.appendChild(option);
      });
  } catch (error) {
    console.warn('Не удалось загрузить список продуктов для журнала наличных', error);
  }
}

async function confirmCashPayment(paymentId) {
  const amountInput = window.prompt('Введите подтвержденную сумму (оставьте пустым, чтобы использовать ожидаемую):', '');
  const payload = {};
  if (amountInput) {
    const parsed = parseFloat(amountInput.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) {
      payload.amount = parsed;
    }
  }

  try {
    const response = await fetch(`/api/cash-payments/${paymentId}/confirm`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error('Ошибка подтверждения');
    }
    await loadCashJournal();
  } catch (error) {
    console.error(error);
    alert('Не удалось подтвердить платеж');
  }
}

async function refundCashPayment(paymentId) {
  const amountInput = window.prompt('Сумма возврата (оставьте пустым для полной):', '');
  const reason = window.prompt('Причина возврата:', 'Клиент отказался');

  const payload = {
    cashPaymentId: paymentId,
    reason
  };
  if (amountInput) {
    const parsed = parseFloat(amountInput.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) {
      payload.amount = parsed;
    }
  }

  try {
    const response = await fetch('/api/cash-refunds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error('Ошибка возврата');
    }
    await loadCashJournal();
  } catch (error) {
    console.error(error);
    alert('Не удалось выполнить возврат');
  }
}

function addLog(type, message) {
  if (!elements.logsContainer) return;

  const logEntry = document.createElement('div');
  logEntry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  logEntry.innerHTML = `<span class="timestamp">[${timestamp}]</span>${message}`;
  elements.logsContainer.appendChild(logEntry);
  elements.logsContainer.scrollTop = elements.logsContainer.scrollHeight;
}

function clearLogs() {
    if (elements.logsContainer) {
        elements.logsContainer.innerHTML = '';
        addLog('info', 'Логи очищены');
    }
}

function setButtonLoading(button, loading, loadingText = 'Загрузка...') {
    if (!button) return;
    if (loading) {
        button.dataset.originalText = button.dataset.originalText || button.innerHTML;
        button.disabled = true;
        button.innerHTML = `<div class="loading"></div> ${loadingText}`;
    } else {
        button.disabled = false;
        button.innerHTML = button.dataset.originalText || button.innerHTML;
        delete button.dataset.originalText;
    }
}

function escapeHtml(text) {
    if (text === undefined || text === null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function applyInitialHashSelection() {
  const hash = window.location.hash?.replace('#', '').trim();
  if (hash === 'tab-products') {
    switchTab('products');
    return;
  }
  if (hash === 'tab-deleted') {
    switchTab('deleted');
    return;
  }
  if (hash === 'tab-payments') {
    switchTab('payments');
  }
}
