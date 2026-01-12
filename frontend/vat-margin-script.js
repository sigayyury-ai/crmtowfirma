const API_BASE = '/api';
const TAB_PATH_MAP = {
  report2: '/vat-margin',
  products: '/vat-margin/products',
  stripe: '/vat-margin/stripe',
  deleted: '/vat-margin/deleted',
  payments: '/vat-margin/payments',
  'cash-journal': '/vat-margin/cash-journal'
};

const TAB_HASH_MAP = {
  products: '',
  stripe: '',
  deleted: '',
  report2: '',
  payments: '',
  'cash-journal': ''
};

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

const payerPaymentsModalState = {
  context: null,
  payments: [],
  totalPayments: 0
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

const APPROX_MARGIN_RATE = 0.35;

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
    paymentsReceiptsSection: document.getElementById('payments-receipts'),
    paymentsDiagnosticsSection: document.getElementById('payments-diagnostics'),
    paymentsFacebookAdsSection: document.getElementById('payments-facebook-ads'),
    receiptUploadInput: document.getElementById('receipt-upload-input'),
    receiptsContainer: document.getElementById('receipts-container'),
    receiptsRefresh: document.getElementById('receipts-refresh'),
    diagnosticsDealId: document.getElementById('diagnostics-deal-id'),
    diagnosticsLoadBtn: document.getElementById('diagnostics-load-btn'),
    diagnosticsClearBtn: document.getElementById('diagnostics-clear-btn'),
    diagnosticsContent: document.getElementById('diagnostics-content'),
    outgoingExpensesIframe: document.getElementById('outgoing-expenses-iframe'),
    outgoingUploadButton: document.getElementById('outgoing-upload-btn'),
    outgoingRefreshButton: document.getElementById('outgoing-refresh-btn'),
    cashSummaryExpected: document.getElementById('cashSummaryExpected'),
    cashSummaryReceived: document.getElementById('cashSummaryReceived'),
    cashSummaryPending: document.getElementById('cashSummaryPending'),
    cashFilterProduct: document.getElementById('cashFilterProduct'),
    cashFilterStatus: document.getElementById('cashFilterStatus'),
    cashFiltersApply: document.getElementById('cashFiltersApply'),
    cashTableBody: document.getElementById('cashTableBody'),
    payerPaymentsModal: document.getElementById('payer-payments-modal'),
    payerPaymentsTitle: document.getElementById('payer-payments-title'),
    payerPaymentsBody: document.getElementById('payer-payments-body'),
    payerPaymentsClose: document.getElementById('payer-payments-close')
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
  elements.paymentReportContainer?.addEventListener('click', handlePaymentReportAction);
  elements.paymentReportContainer?.addEventListener('keydown', handlePaymentReportKeydown);
  elements.payerPaymentsClose?.addEventListener('click', closePayerPaymentsModal);
  elements.payerPaymentsBody?.addEventListener('click', handlePayerPaymentsBodyClick);
  elements.payerPaymentsModal?.addEventListener('click', (event) => {
    if (event.target === elements.payerPaymentsModal) {
      closePayerPaymentsModal();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isPayerPaymentsModalOpen()) {
      closePayerPaymentsModal();
    }
  });
  initPaymentsSubtabs();
  
  // Receipts
  elements.receiptUploadInput?.addEventListener('change', handleReceiptUpload);
  elements.receiptsRefresh?.addEventListener('click', () => loadReceipts());
  
  // Диагностика сделок
  elements.diagnosticsLoadBtn?.addEventListener('click', loadDealDiagnostics);
  elements.diagnosticsClearBtn?.addEventListener('click', clearDealDiagnostics);
  elements.diagnosticsDealId?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      loadDealDiagnostics();
    }
  });

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
  const pathname = window.location.pathname;
  console.log('initTabs: Initializing tabs', { pathname });
  
  const initialTab = getInitialTabFromPath(pathname) || 'report2';
  console.log('initTabs: Initial tab determined', { initialTab, pathname });
  
  switchTab(initialTab, { suppressPathUpdate: true });

  if (initialTab === 'payments') {
    const initialPaymentsSubtab = getInitialPaymentsSubtabFromPath(pathname) || 'incoming';
    console.log('initTabs: Initial payments subtab determined', { initialPaymentsSubtab, pathname });
    togglePaymentsSubtab(initialPaymentsSubtab, {
      suppressDataLoad: false,
      suppressPathUpdate: true
    });
  }
}

function switchTab(tabName, options = {}) {
  const { suppressPathUpdate = false } = options;
  activeTab = tabName;
  elements.tabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  elements.tabContents.forEach((content) => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });

  if (!suppressPathUpdate) {
    updateBrowserPathForTab(tabName);
  }

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
      renderStripeEvents(stripeEventsState.items);
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
    togglePaymentsSubtab('incoming', {
      suppressDataLoad: true,
      suppressPathUpdate: true
    });
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
  const { suppressDataLoad = false, suppressPathUpdate = false } = options;
  activePaymentsSubtab = subtab || 'incoming';
  const sections = {
    incoming: elements.paymentsIncomingSection,
    outgoing: elements.paymentsOutgoingSection,
    receipts: elements.paymentsReceiptsSection,
    diagnostics: elements.paymentsDiagnosticsSection,
    'facebook-ads': elements.paymentsFacebookAdsSection
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

  if (
    !suppressDataLoad &&
    activeTab === 'payments' &&
    activePaymentsSubtab === 'facebook-ads'
  ) {
    // Initialize Facebook Ads tab if not already initialized
    console.log('Facebook Ads: Tab activated, checking initFacebookAdsTab function');
    if (typeof initFacebookAdsTab === 'function') {
      console.log('Facebook Ads: Calling initFacebookAdsTab');
      initFacebookAdsTab();
    } else {
      console.error('Facebook Ads: initFacebookAdsTab function not found! Make sure facebook-ads-script.js is loaded.');
    }
  }

  if (
    !suppressDataLoad &&
    activeTab === 'payments' &&
    activePaymentsSubtab === 'receipts'
  ) {
    loadReceipts();
  }

  if (!suppressPathUpdate && activeTab === 'payments') {
    const targetPath =
      activePaymentsSubtab === 'incoming' ? '/vat-margin/payments' : 
      activePaymentsSubtab === 'outgoing' ? '/vat-margin/expenses' :
      activePaymentsSubtab === 'receipts' ? '/vat-margin/receipts' :
      activePaymentsSubtab === 'facebook-ads' ? '/vat-margin/facebook-ads' :
      '/vat-margin/diagnostics';
    if (window.location.pathname !== targetPath) {
      window.history.replaceState(null, '', targetPath);
    }
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

    const rawItems = Array.isArray(result?.data?.items) ? result.data.items : [];
    const normalizedItems = rawItems.map((item) => ({
      eventKey: item?.event_key ?? item?.eventKey ?? '',
      eventLabel: item?.event_label ?? item?.eventLabel ?? item?.event_key ?? 'Без названия',
      currency: item?.currency || 'PLN',
      grossRevenue: Number(
        item?.gross_revenue_pln ??
          item?.grossRevenuePln ??
          item?.gross_revenue ??
          item?.grossRevenue ??
          0
      ),
      paymentsCount: Number(item?.payments_count ?? item?.paymentsCount ?? 0),
      lastPaymentAt: item?.last_payment_at ?? item?.lastPaymentAt ?? null
    }));

    stripeEventsState.items = normalizedItems;
    stripeEventsState.isLoaded = true;
    renderStripeEvents(normalizedItems);
    const countText = formatEventsCount(normalizedItems.length);
    if (elements.stripeEventsCount) {
      elements.stripeEventsCount.textContent = countText;
    }
    updateStripeStatus('success', '');
  } catch (error) {
    console.error('Failed to load Stripe events summary', error);
    stripeEventsState.error = error.message;
    elements.stripeSummaryTable.innerHTML = `<div class="error-box">${escapeHtml(error.message || 'Не удалось загрузить мероприятия Stripe')}</div>`;
    if (elements.stripeEventsCount) {
      elements.stripeEventsCount.textContent = '0 мероприятий';
    }
    updateStripeStatus('error', 'Ошибка загрузки мероприятий');
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
  const currentYear = today.getFullYear();
  const monthOptions = Array.from(elements.monthSelect.options ?? []).map((option) => option.value);
  const yearOptions = Array.from(elements.yearSelect.options ?? []).map((option) => option.value);

  // Add current year option if it doesn't exist (dynamic year support)
  if (!yearOptions.includes(String(currentYear))) {
    const opt = document.createElement('option');
    opt.value = String(currentYear);
    opt.textContent = currentYear;
    elements.yearSelect.appendChild(opt);
    yearOptions.push(String(currentYear));
  }

  const defaultMonth = String(today.getMonth() + 1);
  const selectedMonth = monthOptions.includes(defaultMonth) ? defaultMonth : (monthOptions[0] || '');

  // Always use current year as selected year (it's already added above if missing)
  const selectedYear = String(currentYear);

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
            <a class="product-link" href="${detailUrl}" data-product-link="${escapeHtml(product.productSlug || '')}">${escapeHtml(product.productName || 'Без названия')}</a>
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
      const slug = select.dataset.productSlug || '';
      select.dataset.originalValue = select.value;
      select.addEventListener('change', () => {
        if (!slug.startsWith('id-')) {
          addLog('warning', 'Статус можно менять только для продуктов из таблицы products');
          select.value = select.dataset.originalValue || select.value;
          return;
        }
        handleProductStatusChange(slug, select.value);
      });
    });

  elements.productSummaryTable
    .querySelectorAll('.due-month-input')
    .forEach((input) => {
      const slug = input.dataset.productSlug || '';
      input.dataset.originalValue = input.value || '';
      input.addEventListener('change', () => {
        if (!slug.startsWith('id-')) {
          addLog('warning', 'Месяц расчёта можно менять только для продуктов из таблицы products');
          input.value = input.dataset.originalValue || '';
          return;
        }
        handleProductDueMonthChange(slug, input.value);
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

  const totalPln = Number(summary.total_pln || 0);
  const approxExpenses = totalPln * APPROX_MARGIN_RATE;
  const approxMargin = totalPln - approxExpenses;

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
      <span class="summary-label">Расходы</span>
      <span class="summary-value">${formatCurrency(approxExpenses, 'PLN')}</span>
    </div>
    <div class="summary-card">
      <span class="summary-label">Маржа</span>
      <span class="summary-value">${formatCurrency(approxMargin, 'PLN')}</span>
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

  const html = groups.map((group, groupIndex) => {
    const currencyTotals = Object.entries(group.totals?.currency_totals || {})
      .filter(([, amount]) => Number.isFinite(amount) && amount !== 0)
      .map(([cur, amount]) => formatCurrency(amount, cur))
      .join(' + ') || '—';

    const totalPln = Number(group.totals?.pln_total || 0);
    const plnTotal = formatCurrency(totalPln, 'PLN');
    const approxExpenses = formatCurrency(totalPln * APPROX_MARGIN_RATE, 'PLN');
    const approxMargin = formatCurrency(totalPln - (totalPln * APPROX_MARGIN_RATE), 'PLN');
    const proformaCount = group.totals?.proforma_count || 0;
    const paymentsCount = group.totals?.payments_count || 0;

    // Объединяем entries: если у одного плательщика несколько платежей по одной проформе,
    // добавляем их к одной строке вместо показа отдельными строками
    const entriesMap = new Map();
    (group.entries || []).forEach((entry, entryIndex) => {
      const proforma = entry.proforma || null;
      const proformaKey = proforma?.fullnumber || 'no-proforma';
      const hasPayerNames = Array.isArray(entry.payer_names) && entry.payer_names.length > 0;
      const fallbackPayerName = entry.proforma?.buyer?.name || entry.proforma?.buyer?.alt_name || '—';
      const payerKey = hasPayerNames
        ? entry.payer_names.join(',').toLowerCase().trim()
        : (fallbackPayerName || '—').toLowerCase().trim();
      
      // Ключ: плательщик + проформа (если у плательщика платежи по разным проформам - показываем отдельно)
      const uniqueKey = `${payerKey}::${proformaKey}`;
      
      if (entriesMap.has(uniqueKey)) {
        // Это второй (или последующий) платёж того же плательщика по той же проформе - объединяем
        const existing = entriesMap.get(uniqueKey);
        existing.entryIndex = entryIndex; // Обновляем индекс на последний для корректного открытия модального окна
        
        // Объединяем массивы платежей
        const existingPayments = Array.isArray(existing.entry.payments) ? existing.entry.payments : [];
        const newPayments = Array.isArray(entry.payments) ? entry.payments : [];
        existing.entry.payments = [...existingPayments, ...newPayments];
        
        // Суммируем суммы в PLN
        const existingPln = Number(existing.entry.totals?.pln_total || 0);
        const newPln = Number(entry.totals?.pln_total || 0);
        existing.entry.totals = existing.entry.totals || {};
        existing.entry.totals.pln_total = existingPln + newPln;
        
        // Объединяем валютные суммы
        const existingCurrencyTotals = existing.entry.totals.currency_totals || {};
        const newCurrencyTotals = entry.totals?.currency_totals || {};
        Object.entries(newCurrencyTotals).forEach(([cur, amount]) => {
          existingCurrencyTotals[cur] = (existingCurrencyTotals[cur] || 0) + (Number(amount) || 0);
        });
        existing.entry.totals.currency_totals = existingCurrencyTotals;
        
        // Обновляем диапазон дат (первая и последняя дата платежей)
        if (entry.first_payment_date) {
          if (!existing.entry.first_payment_date || entry.first_payment_date < existing.entry.first_payment_date) {
            existing.entry.first_payment_date = entry.first_payment_date;
          }
        }
        if (entry.last_payment_date) {
          if (!existing.entry.last_payment_date || entry.last_payment_date > existing.entry.last_payment_date) {
            existing.entry.last_payment_date = entry.last_payment_date;
          }
        }
        
        // Суммируем количество платежей
        existing.entry.totals.payment_count = (existing.entry.totals.payment_count || 0) + (entry.totals?.payment_count || 0);
      } else {
        // Первый платёж этого плательщика по этой проформе - создаём новую entry
        entriesMap.set(uniqueKey, { entry, entryIndex });
      }
    });

    const rows = Array.from(entriesMap.values()).map(({ entry, entryIndex }) => {
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

      const stripeDealLink = !proforma && entry.stripe_deal_url && entry.stripe_deal_id
        ? `<div class="deal-link-wrapper"><a class="deal-link" href="${entry.stripe_deal_url}" target="_blank" rel="noopener noreferrer">Deal #${escapeHtml(String(entry.stripe_deal_id))}</a></div>`
        : '';

      const proformaCell = proforma
        ? `
          <div class="proforma-info">
            <div>${proformaLabel}</div>
            ${dealLink}
          </div>
        `
        : (stripeDealLink || '—');

      const firstDate = entry.first_payment_date ? formatDate(entry.first_payment_date) : null;
      const lastDate = entry.last_payment_date ? formatDate(entry.last_payment_date) : null;
      let dateLabel = firstDate || '—';
      if (firstDate && lastDate && firstDate !== lastDate) {
        dateLabel = `${firstDate} → ${lastDate}`;
      }

      const paymentsList = Array.isArray(entry.payments) ? entry.payments : [];
      const hasPayments = paymentsList.length > 0;
      const hasPayerNames = Array.isArray(entry.payer_names) && entry.payer_names.length > 0;
      const fallbackPayerName = entry.proforma?.buyer?.name || entry.proforma?.buyer?.alt_name || '—';
      const payerLabel = hasPayerNames
        ? escapeHtml(entry.payer_names.join(', '))
        : escapeHtml(fallbackPayerName || '—');

      const payerNameFilter = hasPayerNames && entry.payer_names.length === 1
        ? entry.payer_names[0]
        : (fallbackPayerName || '');

      const payerCellContent = hasPayments && payerLabel !== '—'
        ? `
            <span
              class="payer-link"
              data-payer-action="show-payments"
              data-group-index="${groupIndex}"
              data-entry-index="${entryIndex}"
              data-payer-name="${escapeHtml(payerNameFilter || '')}"
              role="button"
              tabindex="0"
            >
              ${payerLabel}
            </span>
          `
        : payerLabel;

      return `
        <tr>
          <td>
            <div>${dateLabel}</div>
          </td>
          <td>${payerCellContent}</td>
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
          <div class="metric">
            <span class="metric-label">Всего приходов</span>
            <span class="metric-value">${plnTotal}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Расходы</span>
            <span class="metric-value">${approxExpenses}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Маржа</span>
            <span class="metric-value">${approxMargin}</span>
          </div>
          <div class="currency-breakdown">${currencyTotals}</div>
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

function handlePaymentReportAction(event) {
  const trigger = event.target.closest('[data-payer-action="show-payments"]');
  if (!trigger || !elements.paymentReportContainer?.contains(trigger)) {
    return;
  }

  const groupIndex = Number(trigger.dataset.groupIndex);
  const entryIndex = Number(trigger.dataset.entryIndex);

  if (!Number.isInteger(groupIndex) || !Number.isInteger(entryIndex)) {
    addLog('warning', 'Не удалось определить позицию платежей для отображения');
    return;
  }

  const payerName = (trigger.dataset.payerName || '').trim();
  openPayerPaymentsModal({
    groupIndex,
    entryIndex,
    payerName: payerName || null
  });
}

function handlePaymentReportKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  const trigger = event.target.closest('[data-payer-action="show-payments"]');
  if (!trigger || !elements.paymentReportContainer?.contains(trigger)) {
    return;
  }

  event.preventDefault();
  handlePaymentReportAction(event);
}

async function openPayerPaymentsModal({ groupIndex, entryIndex, payerName }) {
  const groups = Array.isArray(paymentReportState.groups) ? paymentReportState.groups : [];
  const group = groups[groupIndex];
  if (!group) {
    addLog('warning', 'Не удалось найти группу платежей для отображения деталей плательщика');
    return;
  }

  const entries = Array.isArray(group.entries) ? group.entries : [];
  const entry = entries[entryIndex];
  if (!entry) {
    addLog('warning', 'Не удалось найти запись с платежами для выбранного плательщика');
    return;
  }

  const proforma = entry.proforma || null;
  const groupName = group.name || 'Без названия';
  showPayerPaymentsModalLoading({ groupName, proforma, payerName });

  const paymentsSource = Array.isArray(entry.payments) ? entry.payments : [];
  const params = new URLSearchParams();
  if (payerName) {
    params.set('payer', payerName.trim().toLowerCase());
  }
  if (proforma?.fullnumber) {
    params.set('proforma', proforma.fullnumber.trim());
  }

  let fetchedPayments = [];
  let fetchedCount = 0;

  if (params.toString()) {
    try {
      const result = await apiCall(`/vat-margin/payer-payments?${params.toString()}`);
      if (result?.success && Array.isArray(result.payments)) {
        fetchedPayments = result.payments;
        fetchedCount = Number(result.count) || fetchedPayments.length;
      } else if (result?.error) {
        addLog('warning', `Не удалось загрузить платежи плательщика: ${result.error}`);
      }
    } catch (error) {
      addLog('error', `Не удалось загрузить платежи плательщика: ${error.message}`);
    }
  }

  const payments = fetchedPayments.length ? fetchedPayments : paymentsSource;
  const totalPayments = fetchedCount
    || paymentsSource.length
    || entry.totals?.payment_count
    || payments.length;

  renderPayerPaymentsModal({
    groupName,
    proforma,
    payerName,
    payments,
    totalPayments
  });
}

function handlePayerPaymentsBodyClick(event) {
  const actionButton = event.target.closest('[data-payer-payment-action]');
  if (!actionButton || !elements.payerPaymentsBody?.contains(actionButton)) {
    return;
  }

  event.preventDefault();

  const { payerPaymentAction: action, paymentId } = actionButton.dataset;
  if (!action || !paymentId) {
    return;
  }

  if (action === 'delete') {
    deletePayerPaymentFromModal(paymentId, actionButton);
  }
}

async function deletePayerPaymentFromModal(paymentId, triggerButton) {
  const idLabel = String(paymentId);
  if (!idLabel) return;

  const { payerName, proforma } = payerPaymentsModalState.context || {};
  const confirmationMessage = [
    `Удалить платёж ${idLabel}?`,
    payerName ? `Плательщик: ${payerName}` : null,
    proforma?.fullnumber ? `Проформа: ${proforma.fullnumber}` : null,
    '',
    'Привязка к проформе будет удалена.'
  ]
    .filter(Boolean)
    .join('\n');

  if (!window.confirm(confirmationMessage)) {
    return;
  }

  if (triggerButton) {
    triggerButton.disabled = true;
  }

  try {
    addLog('info', `Удаляю платёж ${idLabel} через модальное окно`);
    const result = await apiCall(`/vat-margin/payments/${encodeURIComponent(idLabel)}`, 'DELETE');
    if (!result?.success) {
      throw new Error(result?.error || 'Не удалось удалить платёж');
    }
    applyPayerPaymentRemoval(idLabel);
    addLog('success', `Платёж ${idLabel} удалён`);
  } catch (error) {
    console.error('Failed to delete payment from modal', error);
    addLog('error', `Не удалось удалить платёж ${idLabel}: ${error.message}`);
    alert(`Не удалось удалить платёж: ${error.message}`);
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
    }
  }
}

function applyPayerPaymentRemoval(paymentId) {
  const idKey = String(paymentId);
  if (!payerPaymentsModalState.context) {
    return;
  }

  payerPaymentsModalState.payments = payerPaymentsModalState.payments
    .filter((payment) => String(payment.id) !== idKey);

  payerPaymentsModalState.totalPayments = Math.max(
    payerPaymentsModalState.totalPayments - 1,
    payerPaymentsModalState.payments.length
  );

  const { context } = payerPaymentsModalState;
  renderPayerPaymentsModal({
    ...context,
    payments: payerPaymentsModalState.payments,
    totalPayments: payerPaymentsModalState.totalPayments
  });

  removePaymentFromState(idKey);
  loadPaymentReportData({ silent: true }).catch(() => {});
}

function renderPayerPaymentsModal({
  groupName,
  proforma,
  payerName,
  payments,
  totalPayments
}) {
  if (!elements.payerPaymentsModal || !elements.payerPaymentsBody) {
    addLog('warning', 'Модальное окно для платежей плательщика недоступно');
    return;
  }

  const visiblePayments = Array.isArray(payments) ? payments : [];
  const totalPln = visiblePayments.reduce(
    (sum, payment) => sum + (Number(payment.amount_pln) || 0),
    0
  );

  payerPaymentsModalState.context = { groupName, proforma, payerName };
  payerPaymentsModalState.payments = visiblePayments.slice();
  payerPaymentsModalState.totalPayments = totalPayments;

  if (elements.payerPaymentsTitle) {
    elements.payerPaymentsTitle.textContent = payerName
      ? `Платежи: ${payerName}`
      : 'Все платежи';
  }

  const metaParts = [];
  if (groupName) {
    metaParts.push(`Продукт: ${escapeHtml(groupName)}`);
  }
  if (proforma?.fullnumber) {
    metaParts.push(`Проформа: ${escapeHtml(proforma.fullnumber)}`);
  }
  if (proforma?.pipedrive_deal_id && proforma?.pipedrive_deal_url) {
    const dealUrl = escapeHtml(proforma.pipedrive_deal_url);
    metaParts.push(
      `<a href="${dealUrl}" target="_blank" rel="noopener noreferrer">Deal #${escapeHtml(String(proforma.pipedrive_deal_id))}</a>`
    );
  }

  const paymentsCountLabel = totalPayments && payerName && visiblePayments.length !== totalPayments
    ? `${visiblePayments.length} из ${totalPayments}`
    : `${visiblePayments.length}`;

  const rows = visiblePayments.length
    ? visiblePayments
      .map((payment) => `
        <tr>
          <td>${payment?.id != null ? escapeHtml(String(payment.id)) : '—'}</td>
          <td>${escapeHtml(formatDate(payment.date) || '—')}</td>
          <td>${formatCurrency(payment.amount || 0, payment.currency || 'PLN')}</td>
          <td>${Number.isFinite(Number(payment.amount_pln)) ? formatCurrency(Number(payment.amount_pln), 'PLN') : '—'}</td>
          <td>${escapeHtml(payment.description || '—')}</td>
          <td>${escapeHtml(payment.status?.label || '—')}</td>
          <td class="actions-col">
            <button
              type="button"
              class="payer-payment-action"
              data-payer-payment-action="delete"
              data-payment-id="${escapeHtml(String(payment.id || ''))}"
              title="Удалить платёж и отвязать от проформы"
            >
              🗑
            </button>
          </td>
        </tr>
      `)
      .join('')
    : '<tr><td colspan="7" class="payer-payments-empty">Нет платежей для выбранного плательщика</td></tr>';

  elements.payerPaymentsBody.innerHTML = `
    <div class="payer-payments-summary">
      ${metaParts.length ? `<div class="summary-meta">${metaParts.join(' • ')}</div>` : ''}
      <div class="summary-stats">
        <span>Платежей: ${paymentsCountLabel}</span>
        <span>Сумма (PLN): ${formatCurrency(totalPln, 'PLN')}</span>
      </div>
    </div>
    <table class="payer-payments-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Дата</th>
          <th>Сумма</th>
          <th>Сумма (PLN)</th>
          <th>Описание</th>
          <th>Статус</th>
          <th class="actions-col">Действия</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;

  elements.payerPaymentsModal.style.display = 'block';
  document.body.classList.add('modal-open');
}

function showPayerPaymentsModalLoading({ groupName, proforma, payerName }) {
  if (elements.payerPaymentsTitle) {
    elements.payerPaymentsTitle.textContent = payerName
      ? `Платежи: ${payerName}`
      : 'Платежи';
  }
  if (elements.payerPaymentsBody) {
    const metaParts = [];
    if (groupName) {
      metaParts.push(`Продукт: ${escapeHtml(groupName)}`);
    }
    if (proforma?.fullnumber) {
      metaParts.push(`Проформа: ${escapeHtml(proforma.fullnumber)}`);
    }
    const metaHtml = metaParts.length
      ? `<div class="payer-payments-summary"><div class="summary-meta">${metaParts.join(' • ')}</div></div>`
      : '';
    elements.payerPaymentsBody.innerHTML = `
      ${metaHtml}
      <div class="loading-indicator">Загружаю платежи...</div>
    `;
  }
  elements.payerPaymentsModal.style.display = 'block';
  document.body.classList.add('modal-open');
}

function closePayerPaymentsModal() {
  if (!elements.payerPaymentsModal) return;
  elements.payerPaymentsModal.style.display = 'none';
  document.body.classList.remove('modal-open');
}

function isPayerPaymentsModalOpen() {
  return Boolean(elements.payerPaymentsModal && elements.payerPaymentsModal.style.display === 'block');
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

  const headerAmount =
    payment.amount_raw ||
    formatCurrency(payment.amount || 0, payment.currency || 'PLN');

  const rawAmountLabel = payment.amount_raw || '—';
  const normalizedAmountLabel = formatCurrency(payment.amount || 0, payment.currency || 'PLN');

  const metaRows = [
    renderPaymentMeta('ID платежа', escapeHtml(String(payment.id))),
    renderPaymentMeta('Дата', escapeHtml(formatDate(payment.date))),
    renderPaymentMeta('Сумма (как в выписке)', escapeHtml(rawAmountLabel)),
    renderPaymentMeta('Сумма (для расчёта)', escapeHtml(normalizedAmountLabel)),
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
        <h3>Платёж ${escapeHtml(headerAmount)}</h3>
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

    removePaymentFromState(paymentId);
    addLog('success', `Платёж ${paymentId} удалён`);
  } catch (error) {
    addLog('error', `Ошибка удаления платежа: ${error.message}`);
  }
}

function removePaymentFromState(paymentId) {
  const idKey = String(paymentId);
  const paymentIndex = paymentsState.items.findIndex((item) => String(item.id) === idKey);

  if (paymentIndex !== -1) {
    paymentsState.items.splice(paymentIndex, 1);
    if (paymentsState.selectedId === idKey) {
      paymentsState.selectedId = null;
      clearPaymentDetailRow();
    }
    renderPaymentsTable(paymentsState.items);
  } else if (paymentsState.selectedId === idKey) {
    paymentsState.selectedId = null;
    clearPaymentDetailRow();
  }

  paymentsState.details.delete(idKey);
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
    return;
  }
  if (hash === 'tab-cash-journal') {
    switchTab('cash-journal');
  }
}

function getInitialTabFromPath(pathname) {
  switch (pathname) {
    case '/':
    case '/vat-margin.html':
    case '/vat-margin':
    case '/vat-margin/':
    case '/reporting':
      return 'report2';
    case '/products':
    case '/vat-margin/products':
      return 'products';
    case '/stripe':
    case '/vat-margin/stripe':
      return 'stripe';
    case '/deleted':
    case '/vat-margin/deleted':
      return 'deleted';
    case '/payments':
    case '/vat-margin/payments':
      return 'payments';
    case '/vat-margin/diagnostics':
      return 'payments'; // Диагностика находится внутри вкладки payments
    case '/vat-margin/facebook-ads':
    case '/facebook-ads':
      return 'payments'; // Facebook Ads находится внутри вкладки payments
    case '/expenses':
    case '/vat-margin/expenses':
      return 'payments';
    case '/cash-journal':
    case '/vat-margin/cash-journal':
      return 'cash-journal';
    default:
      return null;
  }
}

function updateBrowserPathForTab(tabName) {
  const basePath = TAB_PATH_MAP[tabName] || '/vat-margin';
  const hash = TAB_HASH_MAP[tabName] || '';
  const target = `${basePath}${hash}`;
  const current = `${window.location.pathname}${window.location.hash}`;
  if (current !== target) {
    window.history.replaceState(null, '', target);
  }
}

function getInitialPaymentsSubtabFromPath(pathname) {
  if (pathname === '/expenses' || pathname === '/vat-margin/expenses') {
    return 'outgoing';
  }
  if (pathname === '/vat-margin/diagnostics') {
    return 'diagnostics';
  }
  if (pathname === '/vat-margin/facebook-ads' || pathname === '/facebook-ads') {
    return 'facebook-ads';
  }
  return 'incoming';
}

// Диагностика сделок
async function loadDealDiagnostics() {
  const dealId = elements.diagnosticsDealId?.value?.trim();
  if (!dealId) {
    alert('Введите ID сделки');
    return;
  }
  
  const dealIdNum = parseInt(dealId);
  if (isNaN(dealIdNum)) {
    alert('ID сделки должен быть числом');
    return;
  }
  
  const contentEl = elements.diagnosticsContent;
  if (!contentEl) return;
  
  contentEl.innerHTML = '<div class="loading">Загрузка диагностики...</div>';
  
  try {
    const response = await fetch(`${API_BASE}/pipedrive/deals/${dealIdNum}/diagnostics`);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || 'Ошибка загрузки диагностики');
    }
    
    renderDiagnostics(data);
  } catch (error) {
    console.error('Error loading diagnostics:', error);
    contentEl.innerHTML = `<div class="error">Ошибка: ${error.message}</div>`;
  }
}

function clearDealDiagnostics() {
  if (elements.diagnosticsDealId) {
    elements.diagnosticsDealId.value = '';
  }
  if (elements.diagnosticsContent) {
    elements.diagnosticsContent.innerHTML = '<div class="placeholder">Введите ID сделки и нажмите "Загрузить" для получения диагностической информации</div>';
  }
}

function renderDiagnostics(data) {
  const contentEl = elements.diagnosticsContent;
  if (!contentEl) return;
  
  if (!data.success) {
    contentEl.innerHTML = `<div class="diagnostics-error-box">
      <div class="error-icon">❌</div>
      <div class="error-content">
        <h3>Ошибка загрузки диагностики</h3>
        <p>${data.error || 'Неизвестная ошибка'}</p>
      </div>
    </div>`;
    return;
  }
  
  const { dealInfo, summary, payments, proformas, refunds, cashPayments, automations, notifications, issues, paymentSchedules, availableActions, tasks, cronTasks } = data;
  
  let html = '<div class="diagnostics-container">';
  
  // Заголовок с иконкой и метаданными
  html += `<div class="diagnostics-header">
    <div class="diagnostics-header-main">
      <div class="diagnostics-icon">🔍</div>
      <div class="diagnostics-title">
        <h2>Диагностика сделки #${data.dealId}</h2>
        <div class="diagnostics-meta">
          <span class="meta-item">🕐 ${new Date(data.generatedAt).toLocaleString('ru-RU')}</span>
        </div>
      </div>
    </div>
    ${issues && issues.length > 0 
      ? `<div class="diagnostics-status-badge ${issues.some(i => i.severity === 'critical') ? 'critical' : issues.some(i => i.severity === 'warning') ? 'warning' : 'info'}">
          ${issues.filter(i => i.severity === 'critical').length > 0 ? '🔴 Критические проблемы' : 
            issues.filter(i => i.severity === 'warning').length > 0 ? '🟡 Есть предупреждения' : 
            'ℹ️ Информация'}
        </div>`
      : `<div class="diagnostics-status-badge success">✅ Проблем не обнаружено</div>`}
  </div>`;
  
  // 1. ИНФОРМАЦИЯ О СДЕЛКЕ (Flow Step 1)
  if (dealInfo.found) {
    html += `<div class="diagnostics-flow-section" data-flow-step="1">
      <div class="flow-section-header">
        <div class="flow-step-number">1</div>
        <h3>📋 Информация о сделке</h3>
      </div>
      <div class="diagnostics-card">
        <div class="deal-info-grid">
          <div class="info-item">
            <div class="info-label">Название</div>
            <div class="info-value">${escapeHtml(dealInfo.title || 'N/A')}</div>
          </div>
          <div class="info-item highlight">
            <div class="info-label">Сумма сделки</div>
            <div class="info-value large">${dealInfo.value || 0} ${dealInfo.currency || 'PLN'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Текущий статус</div>
            <div class="info-value">
              <span class="status-badge stage">${dealInfo.stageName || `ID: ${dealInfo.stageId}`}</span>
            </div>
          </div>
          ${dealInfo.closeDate ? `<div class="info-item">
            <div class="info-label">Дата закрытия</div>
            <div class="info-value">${new Date(dealInfo.closeDate).toLocaleDateString('ru-RU')}</div>
          </div>` : ''}
          ${dealInfo.person ? `<div class="info-item">
            <div class="info-label">Клиент</div>
            <div class="info-value">${escapeHtml(dealInfo.person.name || 'N/A')}</div>
          </div>` : ''}
          ${dealInfo.person?.email ? `<div class="info-item">
            <div class="info-label">Email</div>
            <div class="info-value"><a href="mailto:${escapeHtml(dealInfo.person.email)}">${escapeHtml(dealInfo.person.email)}</a></div>
          </div>` : ''}
        </div>
      </div>
    </div>`;
  } else {
    html += `<div class="diagnostics-flow-section error" data-flow-step="1">
      <div class="flow-section-header">
        <div class="flow-step-number error">1</div>
        <h3>❌ Сделка не найдена</h3>
      </div>
      <div class="diagnostics-card error">
        <p>${dealInfo.error || 'Неизвестная ошибка'}</p>
      </div>
    </div>`;
  }
  
  // 2. СВОДКА ПЛАТЕЖЕЙ (Flow Step 2)
  const dealCurrency = summary.dealCurrency || dealInfo.currency || 'PLN';
  const progressPercent = summary.paymentProgress || 0;
  const progressColor = progressPercent >= 100 ? '#10b981' : progressPercent >= 50 ? '#f59e0b' : '#ef4444';
  
  html += `<div class="diagnostics-flow-section" data-flow-step="2">
    <div class="flow-section-header">
      <div class="flow-step-number">2</div>
      <h3>💰 Сводка платежей</h3>
    </div>
    <div class="diagnostics-card">
      <div class="payment-summary-grid">
        <div class="summary-item primary">
          <div class="summary-label">Сумма сделки</div>
          <div class="summary-value">${summary.dealValue || 0} ${dealCurrency}</div>
        </div>
        <div class="summary-item ${summary.totalPaid > 0 ? 'success' : 'warning'}">
          <div class="summary-label">Оплачено</div>
          <div class="summary-value">${summary.totalPaidInOriginalCurrency || summary.totalPaid || 0} ${dealCurrency}</div>
          ${summary.totalPaid && summary.totalPaidInOriginalCurrency && summary.totalPaid !== summary.totalPaidInOriginalCurrency 
            ? `<div class="summary-sublabel">(${summary.totalPaid || 0} PLN)</div>` 
            : ''}
        </div>
        <div class="summary-item ${summary.remaining > 0 ? 'warning' : 'success'}">
          <div class="summary-label">Остаток</div>
          <div class="summary-value">${summary.remaining !== null ? `${summary.remaining || 0} ${dealCurrency}` : 'N/A'}</div>
        </div>
        <div class="summary-item progress">
          <div class="summary-label">Прогресс оплаты</div>
          <div class="progress-container">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progressPercent}%; background: ${progressColor};"></div>
            </div>
            <div class="progress-text">${progressPercent.toFixed(1)}%</div>
          </div>
        </div>
      </div>
      
      ${summary.hasCurrencyMismatch 
        ? `<div class="currency-warning-box">
            <div class="warning-icon">⚠️</div>
            <div class="warning-content">
              <strong>Разные валюты</strong>
              <p>Проверка выполняется по факту webhook подтверждения, а не по сумме</p>
              <div class="warning-stats">Webhook подтверждений: ${summary.stripeWebhookVerifiedCount || 0}</div>
            </div>
          </div>` 
        : ''}
      
      ${paymentSchedules ? `<div class="payment-schedule-info" style="margin-top: 20px; padding: 16px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #3b82f6;">
        <div style="font-weight: 600; margin-bottom: 12px; color: #1e40af;">📅 Графики платежей</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>
            <div style="font-size: 0.9em; color: #6b7280; margin-bottom: 4px;">Первичный график (при создании первого платежа)</div>
            <div style="font-size: 1.1em; font-weight: 600; color: #1e40af;">
              ${paymentSchedules.initial?.schedule || 'не найден'}
              ${paymentSchedules.initial?.firstPaymentDate 
                ? `<div style="font-size: 0.85em; color: #6b7280; margin-top: 4px; font-weight: normal;">
                    Дата первого платежа: ${new Date(paymentSchedules.initial.firstPaymentDate).toLocaleString('ru-RU')}
                  </div>`
                : ''}
            </div>
            ${paymentSchedules.initial?.source === 'first_payment' 
              ? `<div style="font-size: 0.85em; color: #6b7280; margin-top: 4px;">
                  Источник: первый платеж (${paymentSchedules.initial.firstPaymentType || 'N/A'})
                </div>`
              : paymentSchedules.initial?.note 
                ? `<div style="font-size: 0.85em; color: #9ca3af; margin-top: 4px;">${paymentSchedules.initial.note}</div>`
                : ''}
          </div>
          <div>
            <div style="font-size: 0.9em; color: #6b7280; margin-bottom: 4px;">Текущий график (рассчитан сейчас)</div>
            <div style="font-size: 1.1em; font-weight: 600; color: ${paymentSchedules.initial?.schedule && paymentSchedules.current?.schedule && paymentSchedules.initial.schedule !== paymentSchedules.current.schedule ? '#dc2626' : '#059669'};">
              ${paymentSchedules.current?.schedule || '100%'}
              ${paymentSchedules.initial?.schedule && paymentSchedules.current?.schedule && paymentSchedules.initial.schedule !== paymentSchedules.current.schedule
                ? `<div style="font-size: 0.85em; color: #dc2626; margin-top: 4px; font-weight: normal;">
                    ⚠️ График изменился! Первичный был ${paymentSchedules.initial.schedule}
                  </div>`
                : ''}
            </div>
          </div>
        </div>
        ${paymentSchedules.initial?.schedule && paymentSchedules.initial.schedule === '50/50'
          ? `<div style="margin-top: 12px; padding: 12px; background: #eff6ff; border-radius: 6px; font-size: 0.9em; color: #1e40af;">
              💡 <strong>Важно:</strong> Первичный график 50/50 используется для определения необходимости второго платежа, даже если текущий график изменился на 100%
            </div>`
          : ''}
      </div>` : ''}
      
      <div class="payment-stats-grid">
        <div class="stat-item">
          <div class="stat-icon">💳</div>
          <div class="stat-content">
            <div class="stat-value">${summary.stripePaymentsCount || 0}</div>
            <div class="stat-label">Stripe платежей</div>
            <div class="stat-sublabel">оплачено: ${summary.stripePaidCount || 0}, webhook: ${summary.stripeWebhookVerifiedCount || 0}</div>
          </div>
        </div>
        <div class="stat-item">
          <div class="stat-icon">🧾</div>
          <div class="stat-content">
            <div class="stat-value">${summary.proformaPaymentsCount || 0}</div>
            <div class="stat-label">Proforma платежей</div>
          </div>
        </div>
        <div class="stat-item">
          <div class="stat-icon">📄</div>
          <div class="stat-content">
            <div class="stat-value">${summary.proformasCount || 0}</div>
            <div class="stat-label">Проформ</div>
          </div>
        </div>
        <div class="stat-item">
          <div class="stat-icon">💵</div>
          <div class="stat-content">
            <div class="stat-value">${summary.cashPaymentsCount || 0}</div>
            <div class="stat-label">Наличных платежей</div>
          </div>
        </div>
        ${summary.refundsCount > 0 ? `<div class="stat-item warning">
          <div class="stat-icon">↩️</div>
          <div class="stat-content">
            <div class="stat-value">${summary.refundsCount || 0}</div>
            <div class="stat-label">Возвратов</div>
          </div>
        </div>` : ''}
      </div>
    </div>
  </div>`;
  
  // 3. ПРОБЛЕМЫ И ПРЕДУПРЕЖДЕНИЯ (Flow Step 3)
  if (issues && issues.length > 0) {
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    const warningIssues = issues.filter(i => i.severity === 'warning');
    const infoIssues = issues.filter(i => i.severity === 'info');
    
    html += `<div class="diagnostics-flow-section ${criticalIssues.length > 0 ? 'has-critical' : ''}" data-flow-step="3">
      <div class="flow-section-header">
        <div class="flow-step-number ${criticalIssues.length > 0 ? 'error' : warningIssues.length > 0 ? 'warning' : 'info'}">3</div>
        <h3>⚠️ Проблемы и предупреждения</h3>
        <div class="issues-count">
          ${criticalIssues.length > 0 ? `<span class="count-badge critical">${criticalIssues.length} критических</span>` : ''}
          ${warningIssues.length > 0 ? `<span class="count-badge warning">${warningIssues.length} предупреждений</span>` : ''}
          ${infoIssues.length > 0 ? `<span class="count-badge info">${infoIssues.length} информационных</span>` : ''}
        </div>
      </div>
      <div class="diagnostics-card">
        <div class="issues-list">`;
    
    issues.forEach((issue, index) => {
      const severityClass = issue.severity === 'critical' ? 'critical' : 
                           issue.severity === 'warning' ? 'warning' : 'info';
      const severityIcon = issue.severity === 'critical' ? '🔴' : 
                          issue.severity === 'warning' ? '🟡' : 'ℹ️';
      
      html += `<div class="issue-item ${severityClass}">
        <div class="issue-icon">${severityIcon}</div>
        <div class="issue-content">
          <div class="issue-header">
            <strong>${issue.message}</strong>
            <span class="issue-code">${issue.code || 'N/A'}</span>
          </div>
          ${issue.details && Object.keys(issue.details).length > 0 
            ? `<div class="issue-details">${formatIssueDetails(issue.details)}</div>` 
            : ''}
        </div>
      </div>`;
    });
    
    html += `</div></div></div>`;
  } else {
    html += `<div class="diagnostics-flow-section success" data-flow-step="3">
      <div class="flow-section-header">
        <div class="flow-step-number success">3</div>
        <h3>✅ Проверка проблем</h3>
      </div>
      <div class="diagnostics-card success">
        <div class="success-message">
          <div class="success-icon">✅</div>
          <div class="success-text">Проблем не обнаружено. Все системы работают корректно.</div>
        </div>
      </div>
    </div>`;
  }
  
  // 4. ДЕТАЛИ ПЛАТЕЖЕЙ (Flow Step 4)
  html += `<div class="diagnostics-flow-section" data-flow-step="4">
    <div class="flow-section-header">
      <div class="flow-step-number">4</div>
      <h3>💳 Детали платежей</h3>
    </div>
    <div class="diagnostics-card">`;
  
  if (payments.stripe.length > 0) {
    html += `<div class="payment-type-section">
      <div class="payment-type-header">
        <div class="payment-type-icon">💳</div>
        <h4>Stripe платежи <span class="count-badge">${payments.stripe.length}</span></h4>
      </div>
      <div class="table-wrapper">
        <table class="diagnostics-table modern-table">
          <thead>
            <tr>
              <th>Тип</th>
              <th>Статус</th>
              <th>Сумма</th>
              <th>Валюта</th>
              <th>В PLN</th>
              <th>Дата</th>
              <th>Webhook</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>`;
    
    payments.stripe.forEach(p => {
      const statusClass = p.paymentStatus === 'paid' ? 'success' : p.paymentStatus === 'unpaid' ? 'warning' : 'info';
      html += `<tr class="payment-row ${statusClass}">
        <td><span class="payment-type-badge">${p.paymentType || 'N/A'}</span></td>
        <td><span class="status-badge ${statusClass}">${p.paymentStatus}</span></td>
        <td class="amount-cell"><strong>${p.amount || 0}</strong></td>
        <td><span class="currency-badge">${p.currency || 'PLN'}</span></td>
        <td>${p.amountPln && p.amountPln !== p.amount 
          ? `<div class="amount-pln">${p.amountPln.toFixed(2)} PLN</div><small class="exchange-rate">курс: ${p.exchangeRate?.toFixed(4) || 'N/A'}</small>` 
          : '<span class="no-conversion">-</span>'}
        </td>
        <td>${p.createdAt ? new Date(p.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}</td>
        <td>
          ${p.webhookVerified 
            ? '<span class="webhook-badge success" title="Webhook подтвержден">✅</span>' 
            : '<span class="webhook-badge warning" title="Webhook не подтвержден">❌</span>'}
          ${p.webhookEvents && p.webhookEvents.length > 0 
            ? `<div class="webhook-events-count">${p.webhookEvents.length} событий</div>` 
            : ''}
        </td>
        <td>${p.sessionUrl ? `<a href="${p.sessionUrl}" target="_blank" class="action-link">Открыть в Stripe</a>` : '-'}</td>
      </tr>`;
    });
    
    html += `</tbody></table></div></div>`;
  }
  
  if (payments.proforma.length > 0) {
    html += `<div class="payment-type-section">
      <div class="payment-type-header">
        <div class="payment-type-icon">🧾</div>
        <h4>Proforma платежи <span class="count-badge">${payments.proforma.length}</span></h4>
      </div>
      <div class="table-wrapper">
        <table class="diagnostics-table modern-table">
          <thead>
            <tr>
              <th>Сумма</th>
              <th>Валюта</th>
              <th>Дата</th>
              <th>Проформа</th>
              <th>Статус</th>
              <th>Описание</th>
            </tr>
          </thead>
          <tbody>`;
    
    payments.proforma.forEach(p => {
      html += `<tr>
        <td class="amount-cell"><strong>${p.amount || 0}</strong></td>
        <td><span class="currency-badge">${p.currency || 'PLN'}</span></td>
        <td>${p.operationDate ? new Date(p.operationDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}</td>
        <td><code class="proforma-number">${escapeHtml(p.proformaNumber || 'N/A')}</code></td>
        <td><span class="status-badge ${p.matchStatus || 'matched'}">${p.matchStatus || 'matched'}</span></td>
        <td class="description-cell">${escapeHtml(p.description || '')}</td>
      </tr>`;
    });
    
    html += `</tbody></table></div></div>`;
  }
  
  if (payments.stripe.length === 0 && payments.proforma.length === 0) {
    html += `<div class="empty-state">
      <div class="empty-icon">💳</div>
      <div class="empty-text">Платежи не найдены</div>
    </div>`;
  }
  
  html += `</div></div>`;
  
  // 5. ПРОФОРМЫ (Flow Step 5)
  if (proformas && proformas.length > 0) {
    html += `<div class="diagnostics-flow-section" data-flow-step="5">
      <div class="flow-section-header">
        <div class="flow-step-number">5</div>
        <h3>🧾 Проформы</h3>
        <div class="issues-count"><span class="count-badge">${proformas.length}</span></div>
      </div>
      <div class="diagnostics-card">
        <div class="table-wrapper">
          <table class="diagnostics-table modern-table">
            <thead>
              <tr>
                <th>Номер</th>
                <th>Сумма</th>
                <th>Оплачено</th>
                <th>Остаток</th>
                <th>Статус</th>
                <th>Дата выдачи</th>
              </tr>
            </thead>
            <tbody>`;
    
    proformas.forEach(p => {
      const isPaid = (p.remaining || 0) <= 0.01;
      html += `<tr class="${isPaid ? 'proforma-paid' : 'proforma-unpaid'}">
        <td><code class="proforma-number">${escapeHtml(p.fullnumber || 'N/A')}</code></td>
        <td class="amount-cell"><strong>${p.total || 0}</strong> <span class="currency-badge">${p.currency || 'PLN'}</span></td>
        <td class="amount-cell">${p.paymentsTotal || 0} <span class="currency-badge">${p.currency || 'PLN'}</span></td>
        <td class="amount-cell ${isPaid ? 'success' : 'warning'}">${p.remaining || 0} <span class="currency-badge">${p.currency || 'PLN'}</span></td>
        <td><span class="status-badge ${p.status}">${p.status}</span></td>
        <td>${p.issuedAt ? new Date(p.issuedAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}</td>
      </tr>`;
    });
    
    html += `</tbody></table></div></div></div>`;
  }
  
  // 6. ВОЗВРАТЫ (Flow Step 6)
  if (refunds && (refunds.stripe.length > 0 || refunds.cash.length > 0)) {
    html += `<div class="diagnostics-flow-section" data-flow-step="6">
      <div class="flow-section-header">
        <div class="flow-step-number warning">6</div>
        <h3>↩️ Возвраты</h3>
        <div class="issues-count"><span class="count-badge warning">${refunds.stripe.length + refunds.cash.length}</span></div>
      </div>
      <div class="diagnostics-card">`;
    
    if (refunds.stripe.length > 0) {
      html += `<div class="refund-type-section">
        <div class="payment-type-header">
          <div class="payment-type-icon">💳</div>
          <h4>Stripe возвраты <span class="count-badge warning">${refunds.stripe.length}</span></h4>
        </div>
        <div class="table-wrapper">
          <table class="diagnostics-table modern-table">
            <thead>
              <tr>
                <th>Сумма</th>
                <th>Валюта</th>
                <th>Причина</th>
                <th>Дата</th>
              </tr>
            </thead>
            <tbody>`;
      
      refunds.stripe.forEach(r => {
        html += `<tr class="refund-row">
          <td class="amount-cell warning"><strong>-${Math.abs(r.amount || 0)}</strong></td>
          <td><span class="currency-badge">${r.currency || 'PLN'}</span></td>
          <td>${escapeHtml(r.reason || 'N/A')}</td>
          <td>${r.loggedAt ? new Date(r.loggedAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}</td>
        </tr>`;
      });
      
      html += `</tbody></table></div></div>`;
    }
    
    html += `</div></div>`;
  }
  
  // 7. АВТОМАТИЗАЦИИ (Flow Step 7)
  if (automations) {
    html += `<div class="diagnostics-flow-section" data-flow-step="7">
      <div class="flow-section-header">
        <div class="flow-step-number">7</div>
        <h3>🤖 Автоматизации статусов</h3>
      </div>
      <div class="diagnostics-card">
        <div class="automation-info">
          <div class="automation-item">
            <div class="automation-label">Текущий статус</div>
            <div class="automation-value">
              <span class="status-badge stage">${dealInfo.stageName || `ID: ${dealInfo.stageId}`}</span>
            </div>
          </div>
          ${automations.expectedStage ? `<div class="automation-item">
            <div class="automation-label">Ожидаемый статус</div>
            <div class="automation-value">
              <span class="status-badge stage">${automations.expectedStageName || `ID: ${automations.expectedStage}`}</span>
            </div>
          </div>` : ''}
          ${automations.calculation ? `<div class="automation-item">
            <div class="automation-label">Расчет автоматизации</div>
            <div class="automation-value">${escapeHtml(automations.calculation.reason || 'N/A')}</div>
          </div>` : ''}
        </div>
      </div>
    </div>`;
  }
  
  // 8. УВЕДОМЛЕНИЯ (Flow Step 8)
  if (notifications && notifications.proformaReminders.length > 0) {
    html += `<div class="diagnostics-flow-section" data-flow-step="8">
      <div class="flow-section-header">
        <div class="flow-step-number">8</div>
        <h3>📨 Уведомления</h3>
        <div class="issues-count"><span class="count-badge">${notifications.proformaReminders.length}</span></div>
      </div>
      <div class="diagnostics-card">
        <div class="notification-info">
          <div class="notification-header">
            <div class="notification-icon">📧</div>
            <div>Отправлено напоминаний о проформах: <strong>${notifications.proformaReminders.length}</strong></div>
          </div>
        </div>
        <div class="table-wrapper">
          <table class="diagnostics-table modern-table">
            <thead>
              <tr>
                <th>Дата платежа</th>
                <th>Дата отправки</th>
                <th>Проформа</th>
              </tr>
            </thead>
            <tbody>`;
    
    notifications.proformaReminders.forEach(n => {
      html += `<tr>
        <td>${n.secondPaymentDate || 'N/A'}</td>
        <td>${n.sentAt ? new Date(n.sentAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}</td>
        <td><code class="proforma-number">${escapeHtml(n.proformaNumber || 'N/A')}</code></td>
      </tr>`;
    });
    
    html += `</tbody></table></div></div></div>`;
  }
  
  // 9. ДОСТУПНЫЕ ДЕЙСТВИЯ (Flow Step 9)
  if (availableActions && availableActions.length > 0) {
    html += `<div class="diagnostics-flow-section" data-flow-step="9">
      <div class="flow-section-header">
        <div class="flow-step-number">9</div>
        <h3>⚡ Ручные действия</h3>
        <div class="issues-count"><span class="count-badge">${availableActions.length}</span></div>
      </div>
      <div class="diagnostics-card">
        <div class="actions-list">`;
    
    availableActions.forEach(action => {
      const actionClass = action.available ? 'action-available' : 'action-unavailable';
      html += `<div class="action-item ${actionClass}">
        <div class="action-icon">${action.available ? '✅' : '❌'}</div>
        <div class="action-content">
          <div class="action-header">
            <strong>${escapeHtml(action.name)}</strong>
            ${action.available 
              ? '<span class="action-badge available">Доступно</span>' 
              : '<span class="action-badge unavailable">Недоступно</span>'}
          </div>
          <div class="action-description">${escapeHtml(action.description || '')}</div>
          ${action.reason ? `<div class="action-reason">${escapeHtml(action.reason)}</div>` : ''}
          ${action.available ? `
            <div class="action-controls" style="margin-top: 12px;">
              <button class="btn btn-primary btn-sm action-execute-btn" 
                      data-action-id="${action.id}" 
                      data-endpoint="${action.endpoint}"
                      data-method="${action.method || 'POST'}">
                Выполнить
              </button>
            </div>
          ` : ''}
        </div>
      </div>`;
    });
    
    html += `</div></div></div>`;
  }
  
  // 10. ЗАДАЧИ (Flow Step 10)
  if (tasks || cronTasks) {
    const allTasks = [];
    if (tasks) {
      if (tasks.upcoming && tasks.upcoming.length > 0) {
        allTasks.push(...tasks.upcoming.map(t => ({ ...t, source: 'pipedrive', type: 'upcoming' })));
      }
      if (tasks.past && tasks.past.length > 0) {
        allTasks.push(...tasks.past.map(t => ({ ...t, source: 'pipedrive', type: 'past' })));
      }
    }
    if (cronTasks && cronTasks.length > 0) {
      allTasks.push(...cronTasks.map(t => ({ ...t, source: 'cron' })));
    }
    
    if (allTasks.length > 0) {
      html += `<div class="diagnostics-flow-section" data-flow-step="10">
        <div class="flow-section-header">
          <div class="flow-step-number">10</div>
          <h3>📋 Задачи</h3>
          <div class="issues-count"><span class="count-badge">${allTasks.length}</span></div>
        </div>
        <div class="diagnostics-card">
          <div class="table-wrapper">
            <table class="diagnostics-table modern-table">
              <thead>
                <tr>
                  <th>Источник</th>
                  <th>Тип</th>
                  <th>Описание</th>
                  <th>Дата</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>`;
      
      allTasks.forEach(task => {
        const isPast = task.type === 'past' || (task.dueDate && new Date(task.dueDate) < new Date());
        html += `<tr class="${isPast ? 'task-past' : 'task-upcoming'}">
          <td><span class="task-source-badge">${task.source === 'pipedrive' ? 'Pipedrive' : 'Cron'}</span></td>
          <td>${escapeHtml(task.type || task.taskType || 'N/A')}</td>
          <td>${escapeHtml(task.subject || task.description || task.taskDescription || 'N/A')}</td>
          <td>${task.dueDate || task.secondPaymentDate 
            ? new Date(task.dueDate || task.secondPaymentDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : 'N/A'}</td>
          <td><span class="status-badge ${isPast ? 'warning' : 'info'}">${isPast ? 'Прошедшая' : 'Будущая'}</span></td>
        </tr>`;
      });
      
      html += `</tbody></table></div></div></div>`;
    }
  }
  
  html += '</div>';
  
  contentEl.innerHTML = html;
  
  // Привязываем обработчики для кнопок действий
  if (availableActions && availableActions.length > 0) {
    document.querySelectorAll('.action-execute-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const actionId = e.target.dataset.actionId;
        const endpoint = e.target.dataset.endpoint;
        const method = e.target.dataset.method || 'POST';
        
        if (!confirm(`Выполнить действие "${e.target.closest('.action-item').querySelector('strong').textContent}"?`)) {
          return;
        }
        
        e.target.disabled = true;
        e.target.textContent = 'Выполняется...';
        
        try {
          const response = await fetch(endpoint, {
            method: method,
            headers: {
              'Content-Type': 'application/json'
            },
            body: method === 'POST' ? JSON.stringify({}) : undefined
          });
          
          const result = await response.json();
          
          if (result.success) {
            alert(`✅ Действие выполнено успешно!\n\n${JSON.stringify(result, null, 2)}`);
            // Перезагружаем диагностику
            loadDealDiagnostics();
          } else {
            alert(`❌ Ошибка выполнения действия:\n\n${result.error || result.message || 'Неизвестная ошибка'}`);
          }
        } catch (error) {
          alert(`❌ Ошибка выполнения действия:\n\n${error.message}`);
        } finally {
          e.target.disabled = false;
          e.target.textContent = 'Выполнить';
        }
      });
    });
  }
}

function formatIssueDetails(details) {
  if (!details || Object.keys(details).length === 0) {
    return '';
  }
  
  return Object.entries(details)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `<strong>${key}:</strong> ${value.length} элементов`;
      }
      if (typeof value === 'object') {
        return `<strong>${key}:</strong> ${JSON.stringify(value)}`;
      }
      return `<strong>${key}:</strong> ${value}`;
    })
    .join('<br>');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== Receipts Management ====================

let receiptsState = {
  items: [],
  pollingIntervals: new Map()
};

// Batch upload state
const batchUploadState = {
  queue: [],
  processing: [],
  completed: [],
  failed: [],
  isProcessing: false
};

async function handleReceiptUpload(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/heic', 'image/heif', 'application/pdf'];
  const maxSize = 10 * 1024 * 1024; // 10MB

  // Validate all files
  const validFiles = [];
  const errors = [];

  files.forEach((file, index) => {
    if (!allowedTypes.includes(file.type)) {
      errors.push(`${file.name}: неподдерживаемый тип файла`);
      return;
    }
    if (file.size > maxSize) {
      errors.push(`${file.name}: файл слишком большой (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      return;
    }
    validFiles.push(file);
  });

  if (errors.length > 0) {
    errors.forEach(error => addLog('error', error));
  }

  if (validFiles.length === 0) {
    event.target.value = '';
    return;
  }

  // Add files to batch queue
  const batchItems = validFiles.map(file => ({
    file,
    id: `batch-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    status: 'pending',
    receiptId: null,
    error: null
  }));

  batchUploadState.queue.push(...batchItems);
  
  addLog('info', `Добавлено ${validFiles.length} файл(ов) в очередь обработки`);

  // Start batch processing
  processBatchQueue();

  // Reset input
  event.target.value = '';
}

async function processBatchQueue() {
  if (batchUploadState.isProcessing || batchUploadState.queue.length === 0) {
    return;
  }

  batchUploadState.isProcessing = true;
  updateBatchUploadUI();

  // Process files in parallel (max 3 at a time to avoid overwhelming the server)
  const maxConcurrent = 3;
  const batch = batchUploadState.queue.splice(0, maxConcurrent);
  
  batch.forEach(item => {
    item.status = 'uploading';
    batchUploadState.processing.push(item);
  });

  updateBatchUploadUI();

  // Process all files in batch concurrently
  const uploadPromises = batch.map(item => uploadReceiptFile(item));

  try {
    await Promise.allSettled(uploadPromises);
  } catch (error) {
    console.error('Batch upload error:', error);
  }

  // Continue processing if there are more files
  if (batchUploadState.queue.length > 0) {
    // Wait a bit before processing next batch
    setTimeout(() => {
      batchUploadState.isProcessing = false;
      processBatchQueue();
    }, 500);
  } else {
    batchUploadState.isProcessing = false;
  }

  updateBatchUploadUI();
  
  // Reload receipts list after batch completes
  if (batchUploadState.queue.length === 0 && batchUploadState.processing.length === 0) {
    setTimeout(() => loadReceipts(), 1000);
  }
}

async function uploadReceiptFile(batchItem) {
  const { file, id } = batchItem;

  try {
    batchItem.status = 'uploading';
    updateBatchUploadUI();

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/receipts/upload`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Ошибка загрузки');
    }

    const result = await response.json();
    batchItem.receiptId = result.data.receiptId;
    batchItem.status = 'processing';
    
    // Move to processing (background processing)
    const index = batchUploadState.processing.findIndex(item => item.id === id);
    if (index >= 0) {
      batchUploadState.processing[index] = batchItem;
    }

    addLog('success', `✓ ${file.name} загружен. Обработка в фоне...`);

    // Start background polling (non-blocking)
    startReceiptPolling(batchItem.receiptId, batchItem);

    // Mark as completed after a delay (processing continues in background)
    setTimeout(() => {
      const itemIndex = batchUploadState.processing.findIndex(item => item.id === id);
      if (itemIndex >= 0) {
        const item = batchUploadState.processing[itemIndex];
        batchUploadState.processing.splice(itemIndex, 1);
        batchUploadState.completed.push(item);
        updateBatchUploadUI();
      }
    }, 2000);

  } catch (error) {
    console.error('Receipt upload error:', error);
    batchItem.status = 'failed';
    batchItem.error = error.message;

    const index = batchUploadState.processing.findIndex(item => item.id === id);
    if (index >= 0) {
      batchUploadState.processing.splice(index, 1);
      batchUploadState.failed.push(batchItem);
    }

    addLog('error', `✗ ${file.name}: ${error.message}`);
    updateBatchUploadUI();
  }
}

function updateBatchUploadUI() {
  // Update batch upload status if UI element exists
  const total = batchUploadState.queue.length + batchUploadState.processing.length + 
                 batchUploadState.completed.length + batchUploadState.failed.length;
  const processing = batchUploadState.processing.length;
  const completed = batchUploadState.completed.length;
  const failed = batchUploadState.failed.length;

  if (total > 0 && elements.receiptsContainer) {
    // Add or update batch status indicator
    let statusEl = document.getElementById('batch-upload-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'batch-upload-status';
      statusEl.className = 'batch-upload-status';
      elements.receiptsContainer.parentElement?.insertBefore(statusEl, elements.receiptsContainer);
    }

    const queueCount = batchUploadState.queue.length;
    const statusText = queueCount > 0 
      ? `В очереди: ${queueCount} | Обработка: ${processing} | Готово: ${completed}${failed > 0 ? ` | Ошибок: ${failed}` : ''}`
      : processing > 0
        ? `Обработка: ${processing} | Готово: ${completed}${failed > 0 ? ` | Ошибок: ${failed}` : ''}`
        : `Готово: ${completed}${failed > 0 ? ` | Ошибок: ${failed}` : ''}`;

    statusEl.innerHTML = `
      <div class="batch-status-header">
        <span>📦 Пакетная обработка: ${statusText}</span>
        ${total > 0 ? `<button class="btn btn-link btn-sm" onclick="clearBatchStatus()">Очистить</button>` : ''}
      </div>
    `;
  }
}

function clearBatchStatus() {
  batchUploadState.queue = [];
  batchUploadState.processing = [];
  batchUploadState.completed = [];
  batchUploadState.failed = [];
  const statusEl = document.getElementById('batch-upload-status');
  if (statusEl) {
    statusEl.remove();
  }
}

// Make function available globally
window.clearBatchStatus = clearBatchStatus;

function startReceiptPolling(receiptId, batchItem = null) {
  // Stop existing polling for this receipt
  const existingInterval = receiptsState.pollingIntervals.get(receiptId);
  if (existingInterval) {
    clearInterval(existingInterval);
  }

  let pollCount = 0;
  const maxPolls = 20; // 20 polls = ~40 seconds max
  const pollInterval = 2000; // 2 seconds

  const interval = setInterval(async () => {
    pollCount++;
    
    try {
      const response = await fetch(`${API_BASE}/receipts/${receiptId}`);
      if (!response.ok) {
        clearInterval(interval);
        receiptsState.pollingIntervals.delete(receiptId);
        if (batchItem) {
          batchItem.status = 'failed';
          batchItem.error = 'Не удалось получить статус';
        }
        return;
      }

      const result = await response.json();
      const receipt = result.data.receipt;

      // Update batch item status if provided
      if (batchItem) {
        if (receipt.status === 'matched') {
          batchItem.status = 'completed';
        } else if (receipt.status === 'failed') {
          batchItem.status = 'failed';
          batchItem.error = 'Обработка завершилась с ошибкой';
        }
      }

      // Stop polling if processing is complete
      if (receipt.status === 'matched' || receipt.status === 'failed') {
        clearInterval(interval);
        receiptsState.pollingIntervals.delete(receiptId);
        await loadReceipts(); // Refresh list
        return;
      }

      // Stop if max polls reached
      if (pollCount >= maxPolls) {
        clearInterval(interval);
        receiptsState.pollingIntervals.delete(receiptId);
        await loadReceipts(); // Refresh list
      }

    } catch (error) {
      console.error('Receipt polling error:', error);
      clearInterval(interval);
      receiptsState.pollingIntervals.delete(receiptId);
      if (batchItem) {
        batchItem.status = 'failed';
        batchItem.error = error.message;
      }
    }
  }, pollInterval);

  receiptsState.pollingIntervals.set(receiptId, interval);
}

async function loadReceipts() {
  if (!elements.receiptsContainer) return;

  try {
    elements.receiptsContainer.innerHTML = '<div class="placeholder">Загрузка чеков...</div>';

    const response = await fetch(`${API_BASE}/receipts?limit=100`);
    if (!response.ok) {
      throw new Error('Не удалось загрузить чеки');
    }

    const result = await response.json();
    receiptsState.items = result.data || [];

    renderReceipts();

  } catch (error) {
    console.error('Error loading receipts:', error);
    elements.receiptsContainer.innerHTML = `<div class="placeholder error">Ошибка загрузки: ${error.message}</div>`;
  }
}

async function renderReceipts() {
  if (!elements.receiptsContainer) return;

  if (!receiptsState.items || receiptsState.items.length === 0) {
    elements.receiptsContainer.innerHTML = '<div class="placeholder">Нет загруженных чеков</div>';
    return;
  }

  const html = receiptsState.items.map(receipt => {
    const statusLabels = {
      uploaded: 'Загружен',
      processing: 'Обработка...',
      matched: 'Привязан',
      failed: 'Ошибка'
    };

    const statusClass = {
      uploaded: 'status-uploaded',
      processing: 'status-processing',
      matched: 'status-matched',
      failed: 'status-failed'
    }[receipt.status] || '';

    return `
      <div class="receipt-card" data-receipt-id="${receipt.id}">
        <div class="receipt-header">
          <div class="receipt-info">
            <h4>${escapeHtml(receipt.original_filename)}</h4>
            <div class="receipt-meta">
              <span class="receipt-date">${new Date(receipt.uploaded_at).toLocaleString('ru-RU')}</span>
              <span class="receipt-size">${(receipt.size_bytes / 1024).toFixed(1)} KB</span>
            </div>
          </div>
          <div class="receipt-status ${statusClass}">
            ${statusLabels[receipt.status] || receipt.status}
          </div>
        </div>
        <div class="receipt-content" data-receipt-content="${receipt.id}">
          <div class="loading-indicator">Загрузка деталей...</div>
        </div>
      </div>
    `;
  }).join('');

  elements.receiptsContainer.innerHTML = html;

  // Load details for each receipt
  receiptsState.items.forEach(receipt => {
    loadReceiptDetails(receipt.id);
  });
}

async function loadReceiptDetails(receiptId) {
  const contentEl = document.querySelector(`[data-receipt-content="${receiptId}"]`);
  if (!contentEl) return;

  try {
    const response = await fetch(`${API_BASE}/receipts/${receiptId}`);
    if (!response.ok) {
      throw new Error('Не удалось загрузить детали');
    }

    const result = await response.json();
    const { receipt, extraction, link, candidates } = result.data;

    // Debug logging
    console.log('Receipt details loaded:', {
      receiptId,
      hasExtraction: !!extraction,
      extractionStatus: extraction?.status,
      hasLink: !!link,
      candidatesCount: candidates?.length || 0,
      candidates: candidates
    });

    let html = '';

    // Show extracted data
    if (extraction && extraction.status === 'done' && extraction.extracted_json) {
      const extracted = extraction.extracted_json;
      html += `
        <div class="receipt-extracted">
          <h5>Извлеченные данные:</h5>
          <div class="extracted-fields">
            ${extracted.vendor ? `<div><strong>Вендор:</strong> ${escapeHtml(extracted.vendor)}</div>` : ''}
            ${extracted.date ? `<div><strong>Дата:</strong> ${escapeHtml(extracted.date)}</div>` : ''}
            ${extracted.amount ? `<div><strong>Сумма:</strong> ${extracted.amount} ${extracted.currency || ''}</div>` : ''}
            ${extracted.confidence ? `<div><strong>Уверенность:</strong> ${extracted.confidence}%</div>` : ''}
          </div>
        </div>
      `;
    } else if (extraction && extraction.status === 'failed') {
      html += `<div class="receipt-error">Ошибка извлечения: ${escapeHtml(extraction.error || 'Неизвестная ошибка')}</div>`;
    } else if (extraction && extraction.status === 'processing') {
      html += `<div class="receipt-processing">Обработка документа...</div>`;
    }

    // Show linked payment
    if (link) {
      html += `
        <div class="receipt-linked">
          <h5>Привязан к платежу:</h5>
          <div class="linked-payment">
            <span>Платеж #${link.payment_id}</span>
            <button class="btn btn-link btn-sm" onclick="unlinkReceipt('${receiptId}')">Отвязать</button>
          </div>
        </div>
      `;
    }

    // Show candidates ONLY if payment is NOT linked
    if (!link && candidates && Array.isArray(candidates) && candidates.length > 0) {
      html += `
        <div class="receipt-candidates">
          <h5>Кандидаты платежей (${candidates.length}):</h5>
          <div class="candidates-list">
            ${candidates.map(candidate => {
              try {
                const isLinked = link && link.payment_id === candidate.payment_id;
                return `
                  <div class="candidate-item ${isLinked ? 'candidate-linked' : ''}" onclick="${isLinked ? '' : `linkReceiptToPayment('${receiptId}', ${candidate.payment_id})`}" style="${isLinked ? 'opacity: 0.7; cursor: default;' : 'cursor: pointer;'}">
                    ${isLinked ? '<div style="position: absolute; top: 8px; right: 8px; background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">✓ Привязан</div>' : ''}
                    <div class="candidate-main">
                      <div class="candidate-amount">${candidate.amount} ${candidate.currency || 'PLN'}</div>
                      <div class="candidate-date">${new Date(candidate.operation_date).toLocaleDateString('ru-RU')}</div>
                    </div>
                    <div class="candidate-details">
                      <div class="candidate-description">${escapeHtml(candidate.description || '')}</div>
                      <div class="candidate-payer">${escapeHtml(candidate.payer_name || '')}</div>
                    </div>
                    <div class="candidate-score">
                      <span class="score-badge">${candidate.score}%</span>
                      <div class="score-reasons">${(candidate.reasons || []).join(', ')}</div>
                    </div>
                  </div>
                `;
              } catch (err) {
                console.error('Error rendering candidate:', err, candidate);
                return '';
              }
            }).filter(Boolean).join('')}
          </div>
        </div>
      `;
    }
    
    // Show manual search only if no link and no candidates
    if (!link && extraction && extraction.status === 'done') {
      if (!candidates || candidates.length === 0) {
        // Show manual search when no candidates found
        const extracted = extraction.extracted_json || {};
        html += `
          <div class="receipt-no-candidates">
            <div class="no-candidates-message">
              Кандидаты не найдены автоматически
              <br>
              <small style="color: #64748b; margin-top: 8px; display: block;">
                Если платежи еще не загружены в систему, используйте кнопку "Повторить поиск" после их загрузки
              </small>
            </div>
            <button class="btn btn-primary btn-sm" onclick="reSearchReceiptCandidates('${receiptId}')" style="margin-top: 12px;">
              🔄 Повторить поиск кандидатов
            </button>
            <div class="manual-search-section">
              <h5>Ручной поиск платежа:</h5>
              <div class="manual-search-form">
                <div class="search-field">
                  <label>Описание (название вендора):</label>
                  <input type="text" id="manual-search-description-${receiptId}" 
                         class="input-field" 
                         placeholder="Введите название или описание платежа"
                         value="${escapeHtml(extracted.vendor || '')}">
                </div>
                <div class="search-field">
                  <label>Сумма:</label>
                  <input type="number" step="0.01" id="manual-search-amount-${receiptId}" 
                         class="input-field" 
                         placeholder="Сумма"
                         value="${extracted.amount || ''}">
                </div>
                <div class="search-field">
                  <label>Дата:</label>
                  <input type="date" id="manual-search-date-${receiptId}" 
                         class="input-field" 
                         value="${extracted.date || ''}">
                </div>
                <div class="search-field">
                  <label>Валюта:</label>
                  <select id="manual-search-currency-${receiptId}" class="input-field">
                    <option value="">Все</option>
                    <option value="PLN" ${extracted.currency === 'PLN' ? 'selected' : ''}>PLN</option>
                    <option value="EUR" ${extracted.currency === 'EUR' ? 'selected' : ''}>EUR</option>
                    <option value="USD" ${extracted.currency === 'USD' ? 'selected' : ''}>USD</option>
                  </select>
                </div>
                <button class="btn btn-primary" onclick="searchPaymentsManually('${receiptId}')">
                  🔍 Найти платежи
                </button>
              </div>
              <div id="manual-search-results-${receiptId}" class="manual-search-results" style="display: none;"></div>
            </div>
          </div>
        `;
      }
    }

    // Show receipt preview if available
    if (receipt && receipt.storage_path) {
      html += `
        <div class="receipt-preview-section">
          <h5>Превью чека:</h5>
          <div class="receipt-preview-container">
            <img id="receipt-preview-${receiptId}" 
                 src="" 
                 alt="Превью чека" 
                 class="receipt-preview-image"
                 style="max-width: 100%; max-height: 400px; border: 1px solid #e2e8f0; border-radius: 4px; cursor: pointer;"
                 onclick="window.open(this.src, '_blank')"
                 onerror="this.style.display='none'">
            <div class="receipt-preview-loading">Загрузка превью...</div>
          </div>
        </div>
      `;
    }

    contentEl.innerHTML = html;

    // Load receipt preview
    if (receipt && receipt.storage_path) {
      loadReceiptPreview(receiptId);
    }

  } catch (error) {
    console.error('Error loading receipt details:', error);
    contentEl.innerHTML = `<div class="receipt-error">Ошибка загрузки: ${error.message}</div>`;
  }
}

/**
 * Load receipt preview image
 * @param {string} receiptId - Receipt ID
 */
async function loadReceiptPreview(receiptId) {
  try {
    const imgElement = document.getElementById(`receipt-preview-${receiptId}`);
    const loadingElement = imgElement?.parentElement?.querySelector('.receipt-preview-loading');
    
    if (!imgElement) {
      console.warn('Receipt preview image element not found', { receiptId });
      return;
    }

    // Show loading state
    if (loadingElement) {
      loadingElement.textContent = 'Загрузка превью...';
      loadingElement.style.display = 'block';
    }
    imgElement.style.display = 'none';

    // Fetch file URL from API
    const response = await fetch(`${API_BASE}/receipts/${receiptId}/file`);
    
    if (!response.ok) {
      let errorMessage = 'Не удалось загрузить превью';
      try {
        const error = await response.json();
        errorMessage = error.error || error.message || errorMessage;
      } catch (e) {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Ошибка получения URL файла');
    }

    const fileUrl = result.data?.fileUrl;

    if (!fileUrl) {
      throw new Error('URL файла не получен от сервера');
    }

    // Set image source
    imgElement.src = fileUrl;
    
    // Show image on successful load
    imgElement.onload = () => {
      imgElement.style.display = 'block';
      if (loadingElement) {
        loadingElement.style.display = 'none';
      }
    };

    // Handle image load error
    imgElement.onerror = () => {
      console.error('Image load error', { receiptId, fileUrl });
      imgElement.style.display = 'none';
      if (loadingElement) {
        loadingElement.textContent = 'Не удалось загрузить изображение. Возможно, файл поврежден или недоступен.';
        loadingElement.style.display = 'block';
      }
    };

    // Timeout fallback - if image doesn't load within 10 seconds, show error
    setTimeout(() => {
      if (imgElement.style.display === 'none' && loadingElement && loadingElement.textContent === 'Загрузка превью...') {
        loadingElement.textContent = 'Таймаут загрузки. Попробуйте обновить страницу.';
      }
    }, 10000);

  } catch (error) {
    console.error('Error loading receipt preview:', error);
    const imgElement = document.getElementById(`receipt-preview-${receiptId}`);
    const loadingElement = imgElement?.parentElement?.querySelector('.receipt-preview-loading');
    
    if (imgElement) {
      imgElement.style.display = 'none';
    }
    
    if (loadingElement) {
      const errorMsg = error.message || 'Неизвестная ошибка';
      loadingElement.textContent = `Ошибка загрузки: ${errorMsg}`;
      loadingElement.style.display = 'block';
    }
  }
}

async function linkReceiptToPayment(receiptId, paymentId) {
  try {
    const response = await fetch(`${API_BASE}/receipts/${receiptId}/link-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Ошибка привязки');
    }

    addLog('success', `Чек привязан к платежу #${paymentId}`);
    await loadReceipts();

  } catch (error) {
    console.error('Error linking receipt:', error);
    addLog('error', `Не удалось привязать чек: ${error.message}`);
  }
}

async function unlinkReceipt(receiptId) {
  if (!confirm('Отвязать чек от платежа?')) return;

  try {
    const response = await fetch(`${API_BASE}/receipts/${receiptId}/link-payment`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Ошибка отвязки');
    }

    addLog('success', 'Чек отвязан от платежа');
    await loadReceipts();

  } catch (error) {
    console.error('Error unlinking receipt:', error);
    addLog('error', `Не удалось отвязать чек: ${error.message}`);
  }
}

/**
 * Re-search candidates for a receipt
 * @param {string} receiptId - Receipt ID
 */
async function reSearchReceiptCandidates(receiptId) {
  try {
    const contentEl = document.querySelector(`[data-receipt-content="${receiptId}"]`);
    if (!contentEl) {
      addLog('error', 'Элемент чека не найден');
      return;
    }

    // Show loading state
    const noCandidatesEl = contentEl.querySelector('.receipt-no-candidates');
    if (noCandidatesEl) {
      const messageEl = noCandidatesEl.querySelector('.no-candidates-message');
      if (messageEl) {
        messageEl.innerHTML = '🔄 Поиск кандидатов...';
      }
      const buttonEl = noCandidatesEl.querySelector('button');
      if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.textContent = '🔄 Поиск...';
      }
    }

    const response = await fetch(`${API_BASE}/receipts/${receiptId}/re-search`, {
      method: 'POST'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Ошибка поиска');
    }

    const result = await response.json();
    const candidates = result.data?.candidates || [];

    if (candidates.length > 0) {
      addLog('success', `Найдено кандидатов: ${candidates.length}`);
    } else {
      addLog('info', 'Кандидаты не найдены. Платежи могут быть еще не загружены.');
    }

    // Reload receipt details to show new candidates
    await loadReceiptDetails(receiptId);

  } catch (error) {
    console.error('Error re-searching candidates:', error);
    addLog('error', `Не удалось выполнить поиск: ${error.message}`);
    
    // Restore original message
    const contentEl = document.querySelector(`[data-receipt-content="${receiptId}"]`);
    if (contentEl) {
      const noCandidatesEl = contentEl.querySelector('.receipt-no-candidates');
      if (noCandidatesEl) {
        const messageEl = noCandidatesEl.querySelector('.no-candidates-message');
        if (messageEl) {
          messageEl.innerHTML = `
            Кандидаты не найдены автоматически
            <br>
            <small style="color: #64748b; margin-top: 8px; display: block;">
              Если платежи еще не загружены в систему, используйте кнопку "Повторить поиск" после их загрузки
            </small>
          `;
        }
        const buttonEl = noCandidatesEl.querySelector('button');
        if (buttonEl) {
          buttonEl.disabled = false;
          buttonEl.textContent = '🔄 Повторить поиск кандидатов';
        }
      }
    }
  }
}

// Make functions available globally for onclick handlers
window.linkReceiptToPayment = linkReceiptToPayment;
window.unlinkReceipt = unlinkReceipt;
window.reSearchReceiptCandidates = reSearchReceiptCandidates;
