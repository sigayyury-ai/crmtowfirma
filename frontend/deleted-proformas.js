'use strict';

const API_BASE = '/api/vat-margin/deleted-proformas';

const elements = {
  refreshButton: document.getElementById('refresh-deleted'),
  exportButton: document.getElementById('export-deleted'),
  clearLogButton: document.getElementById('deleted-clear-log'),
  dateFrom: document.getElementById('deleted-date-from'),
  dateTo: document.getElementById('deleted-date-to'),
  status: document.getElementById('deleted-status'),
  search: document.getElementById('deleted-search'),
  summary: document.getElementById('deleted-summary'),
  table: document.getElementById('deleted-table'),
  count: document.getElementById('deleted-count'),
  log: document.getElementById('deleted-log')
};

const state = {
  isLoading: false,
  lastResult: null
};

function init() {
  setDefaultDates();
  elements.refreshButton.addEventListener('click', loadDeletedProformas);
  elements.clearLogButton.addEventListener('click', clearLog);
  elements.status.addEventListener('change', handleFilterChange);
  elements.dateFrom.addEventListener('change', handleFilterChange);
  elements.dateTo.addEventListener('change', handleFilterChange);
  elements.search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      loadDeletedProformas();
    }
  });
  logInfo('Готово к загрузке данных');
}

function setDefaultDates() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const format = (date) => date.toISOString().slice(0, 10);
  elements.dateFrom.value = format(start);
  elements.dateTo.value = format(now);
}

function handleFilterChange() {
  if (!state.isLoading) {
    loadDeletedProformas();
  }
}

function buildQueryParams() {
  const params = new URLSearchParams();
  params.set('page', '1');
  params.set('pageSize', '100');

  const dateFrom = elements.dateFrom.value;
  const dateTo = elements.dateTo.value;
  const status = elements.status.value;
  const search = elements.search.value.trim();

  if (dateFrom) params.set('startDate', dateFrom);
  if (dateTo) params.set('endDate', dateTo);
  if (status && status !== 'all') params.set('status', status);
  if (search.length > 0) params.set('search', search);

  return params;
}

async function loadDeletedProformas() {
  if (state.isLoading) {
    return;
  }

  try {
    state.isLoading = true;
    setLoading(true);
    logInfo('Загружаем список удалённых проформ...');

    const params = buildQueryParams();
    const response = await fetch(`${API_BASE}?${params.toString()}`);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }

    state.lastResult = result;
    renderSummary(result.summary);
    renderTable(result.data);
    elements.count.textContent = `${result.total} записей`;
    logSuccess(`Загружено ${result.total} записей`);
  } catch (error) {
    console.error('Failed to load deleted proformas', error);
    renderError(error.message);
    logError(`Ошибка загрузки: ${error.message}`);
  } finally {
    state.isLoading = false;
    setLoading(false);
  }
}

function setLoading(isLoading) {
  elements.refreshButton.disabled = isLoading;
  elements.refreshButton.innerHTML = isLoading
    ? '<div class="loading"></div> Загрузка...'
    : '🔄 Обновить';
}

function renderSummary(summary = {}) {
  if (!summary || !summary.totalsByCurrency) {
    elements.summary.innerHTML = '<div class="placeholder">Нет данных для отображения</div>';
    return;
  }

  const currencyCards = Object.entries(summary.totalsByCurrency).map(([currency, totals]) => {
    const formatter = new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: currency || 'PLN',
      minimumFractionDigits: 2
    });

    return `
      <div class="summary-card">
        <h3>${currency}</h3>
        <p><strong>Сумма проформ:</strong> ${formatter.format(totals.total || 0)}</p>
        <p><strong>Получено платежей:</strong> ${formatter.format(totals.payments || 0)}</p>
        <p><strong>Баланс:</strong> ${formatter.format(totals.balance || 0)}</p>
      </div>
    `;
  }).join('');

  const statusList = Object.entries(summary.statusCounts || {}).map(([status, count]) => `
    <li>${status}: ${count}</li>
  `).join('');

  elements.summary.innerHTML = `
    <div class="summary-card">
      <h3>Всего записей</h3>
      <p class="summary-total">${summary.totalCount || 0}</p>
      <div class="summary-status">
        <h4>Статусы</h4>
        <ul>${statusList || '<li>Нет данных</li>'}</ul>
      </div>
    </div>
    ${currencyCards || '<div class="summary-card"><p>Нет данных по валютам</p></div>'}
  `;
}

function renderTable(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    elements.table.innerHTML = '<div class="placeholder">По заданным фильтрам ничего не найдено</div>';
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
      ${rows.map(renderRow).join('')}
    </tbody>
  `;

  elements.table.innerHTML = '';
  elements.table.appendChild(table);
}

function renderRow(row) {
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
  const buyer = [row.buyerName, row.buyerEmail].filter(Boolean).join('<br>');
  const number = row.proformaNumber || '—';
  const dealLink = row.dealId
    ? `<a href="https://comoon.pipedrive.com/deal/${row.dealId}" target="_blank" rel="noopener">Deal ${row.dealId}</a>`
    : '—';

  return `
    <tr>
      <td>${number}</td>
      <td>${buyer || '—'}</td>
      <td>${formatNumber(row.total)}</td>
      <td>${formatNumber(row.paymentsTotal)}</td>
      <td>${formatNumber(row.balance)}</td>
      <td>${currency}</td>
      <td>${deletedAt}</td>
      <td>${issuedAt}</td>
      <td>${dealLink}</td>
    </tr>
  `;
}

function renderError(message) {
  elements.summary.innerHTML = `<div class="error-box">${message}</div>`;
  elements.table.innerHTML = `<div class="error-box">${message}</div>`;
  elements.count.textContent = '0 записей';
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('ru-RU');
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('ru-RU');
}

function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="timestamp">[${timestamp}]</span>${message}`;
  elements.log.appendChild(entry);
  elements.log.scrollTop = elements.log.scrollHeight;
}

function logInfo(message) {
  log(message, 'info');
}

function logSuccess(message) {
  log(message, 'success');
}

function logError(message) {
  log(message, 'error');
}

function clearLog() {
  elements.log.innerHTML = '';
  logInfo('Лог очищен');
}

document.addEventListener('DOMContentLoaded', init);

