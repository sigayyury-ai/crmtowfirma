const API_BASE = '/api';

let elements = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();

  if (!elements.vatMarginContainer || !elements.logsContainer) {
    console.error('VAT Margin UI: missing core DOM nodes', elements);
    return;
  }

  initTabs();
  initMonthYearSelectors();
  bindEvents();

  addLog('info', 'VAT Margin Tracker инициализирован');
  loadVatMarginData();
  loadPaymentsData({ silent: true });
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
    bankCsvInput: document.getElementById('bank-csv-input'),
    refreshPayments: document.getElementById('refresh-payments'),
    applyMatches: document.getElementById('apply-matches'),
    resetMatches: document.getElementById('reset-matches'),
    exportPayments: document.getElementById('export-payments'),
    uploadsHistory: document.querySelector('[data-history="list"]'),
    paymentsTable: document.getElementById('payments-table')
  };
}

function bindEvents() {
  elements.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  elements.loadVatMargin?.addEventListener('click', () => loadVatMarginData());
  elements.exportReport?.addEventListener('click', exportReportCsv);
  elements.clearLogs?.addEventListener('click', clearLogs);
  elements.refreshPayments?.addEventListener('click', () => loadPaymentsData());
  elements.applyMatches?.addEventListener('click', applyPaymentMatches);
  elements.resetMatches?.addEventListener('click', resetPaymentMatches);
  elements.exportPayments?.addEventListener('click', exportPaymentsCsv);
  elements.bankCsvInput?.addEventListener('change', handleCsvUpload);

  [elements.monthSelect, elements.yearSelect].forEach((select) => {
    select?.addEventListener('change', () => loadVatMarginData({ silent: true }));
  });
}

function initTabs() {
  switchTab('report');
}

function switchTab(tabName) {
  elements.tabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  elements.tabContents.forEach((content) => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });
}

function initMonthYearSelectors() {
  if (!elements.monthSelect || !elements.yearSelect) return;

  const today = new Date();
  const currentMonth = String(today.getMonth() + 1);
  const boundedYear = Math.min(2030, Math.max(2025, today.getFullYear()));
  const currentYear = String(boundedYear);

  if (!elements.monthSelect.value) {
    elements.monthSelect.value = currentMonth;
  }

  if (!elements.yearSelect.value) {
    elements.yearSelect.value = currentYear;
  }
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

function renderVatMarginTable(data) {
  if (!elements.vatMarginContainer) return;

  if (!Array.isArray(data) || data.length === 0) {
    elements.vatMarginContainer.innerHTML = '<div class="placeholder">Нет данных за выбранный период</div>';
    return;
  }

  const rows = data
    .map((item) => {
      const currency = item.currency || 'PLN';
      const amount = Number(item.total) || 0;
      const exchange = Number(item.currency_exchange) || (currency === 'PLN' ? 1 : null);
      const amountPln = exchange ? amount * exchange : amount;
      const paidRaw = Number(item.payments_total_pln ?? item.payments_total) || 0;
      const paymentsExchange = Number(item.payments_currency_exchange || exchange || 1);
      const paidPln = exchange ? Math.min(paidRaw * paymentsExchange, amountPln) : Math.min(paidRaw, amountPln);
      const status = determinePaymentStatus(amountPln, paidPln);

      return `
        <tr>
          <td>${escapeHtml(item.name || '—')}</td>
          <td>${escapeHtml(item.fullnumber || item.number || '—')}</td>
          <td>${formatDate(item.date)}</td>
          <td>${currency}</td>
          <td class="amount">${formatCurrency(amount, currency)}</td>
          <td class="amount">${exchange ? exchange.toFixed(4) : '—'}</td>
          <td class="amount">${formatCurrency(amountPln, 'PLN')}</td>
          <td class="amount">${formatCurrency(paidPln, 'PLN')}</td>
          <td><span class="status ${status.className}">${status.label}</span></td>
        </tr>
      `;
    })
    .join('');

  elements.vatMarginContainer.innerHTML = `
    <table class="payments-table vat-report-table">
      <thead>
        <tr>
          <th>Продукт</th>
          <th>Проформа</th>
          <th>Дата</th>
          <th>Валюта</th>
          <th>Сумма</th>
          <th>Курс</th>
          <th>Всего в PLN</th>
          <th>Оплачено</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
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

async function exportReportCsv() {
  const { month, year } = getSelectedPeriod();
  const url = `${API_BASE}/vat-margin/export?${new URLSearchParams({ month, year }).toString()}`;
  window.open(url, '_blank');
  addLog('info', 'Экспорт отчёта запрошен');
}

async function loadPaymentsData({ silent = false } = {}) {
  if (!elements.paymentsTable) return;

  try {
    if (!silent) addLog('info', 'Загрузка платежей...');
    const result = await apiCall('/vat-margin/payments');

    if (!result?.success) {
      throw new Error(result?.error || 'Не удалось получить платежи');
    }

    renderUploadsHistory(result.history || []);
    renderPaymentsTable(result.data || []);
    if (!silent) addLog('success', `Получено ${result.data?.length || 0} платежей`);
  } catch (error) {
    console.warn('Payments fetch error:', error.message);
    if (!silent) addLog('warning', `Не удалось загрузить платежи: ${error.message}`);
    renderPaymentsPlaceholder(error.message);
  }
}

function renderPaymentsPlaceholder(message = 'Пока нет данных') {
  if (!elements.paymentsTable) return;
  elements.paymentsTable.innerHTML = `<div class="placeholder">${message}</div>`;
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

  const rows = data
    .map((item) => {
      const statusClass = item.status || 'needs_review';
      const statusLabel = {
        matched: 'Сопоставлено',
        auto: 'Авто',
        needs_review: 'Требует проверки',
        unmatched: 'Не найдено'
      }[statusClass] || 'Неизвестно';

      return `
        <tr>
          <td>${formatDate(item.date)}</td>
          <td>${escapeHtml(item.description || '')}</td>
          <td class="amount">${formatCurrency(item.amount || 0, item.currency || 'PLN')}</td>
          <td>${escapeHtml(item.payer || '—')}</td>
          <td>${escapeHtml(item.matched_proforma || '—')}</td>
          <td><span class="status ${statusClass}">${statusLabel}</span></td>
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
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
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

async function applyPaymentMatches() {
  try {
    setButtonLoading(elements.applyMatches, true, 'Применение...');
    const result = await apiCall('/vat-margin/payments/apply', 'POST');
    if (!result.success) {
      throw new Error(result.error || 'Не удалось применить сопоставления');
    }
    addLog('success', 'Сопоставления применены');
    await loadPaymentsData({ silent: true });
  } catch (error) {
    addLog('error', `Ошибка применения сопоставлений: ${error.message}`);
  } finally {
    setButtonLoading(elements.applyMatches, false, '✔️ Применить');
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

function exportPaymentsCsv() {
  window.open(`${API_BASE}/vat-margin/payments/export`, '_blank');
  addLog('info', 'Экспорт платежей запрошен');
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
