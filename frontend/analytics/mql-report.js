const CHANNELS = ['Organic search', 'Paid search', 'Organic social', 'Paid social', 'Direct', 'Referral', 'Partners', 'None'];
const API_URL = '/api/analytics/mql-summary';

const viewButtons = document.querySelectorAll('.view-toggle button');
const yearSelect = document.getElementById('year-select');
const tableWrapper = document.getElementById('table-wrapper');
const sendpulseSyncEl = document.getElementById('sendpulse-sync');
const pipedriveSyncEl = document.getElementById('pipedrive-sync');

const state = {
  view: 'source',
  year: Number(yearSelect?.value) || new Date().getFullYear()
};

const summaryCache = new Map();
let currentSummary = null;

async function loadSummary(year) {
  const cacheKey = String(year);
  if (summaryCache.has(cacheKey)) {
    currentSummary = summaryCache.get(cacheKey);
    updateSyncInfo();
    renderTable();
    return;
  }

  showPlaceholder('Загружаем данные отчёта…');
  try {
    const response = await fetch(`${API_URL}?year=${year}`, {
      credentials: 'include'
    });
    if (!response.ok) {
      throw new Error(`API responded with ${response.status}`);
    }
    const payload = await response.json();
    if (!payload.success) {
      throw new Error(payload.error || 'Unknown API error');
    }
    summaryCache.set(cacheKey, payload.data);
    currentSummary = payload.data;
    updateSyncInfo();
    renderTable();
  } catch (error) {
    console.error('Failed to load MQL summary', error);
    showPlaceholder('Не удалось загрузить данные. Попробуйте обновить страницу позже.');
  }
}

function showPlaceholder(text) {
  tableWrapper.innerHTML = `<div class="placeholder">${text}</div>`;
}

function formatMonth(label) {
  const [year, month] = label.split('-');
  const date = new Date(`${year}-${month}-01T00:00:00Z`);
  return date.toLocaleString('ru-RU', { month: 'short' });
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatNumber(value) {
  if (!isFiniteNumber(value)) return '—';
  return Math.round(value).toLocaleString('ru-RU');
}

function formatCurrency(value) {
  if (!isFiniteNumber(value)) return '—';
  return `${Math.round(value).toLocaleString('ru-RU')} PLN`;
}

function formatPercent(value) {
  if (!isFiniteNumber(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function renderTable() {
  const dataset = currentSummary;
  if (!dataset) return;
  const months = dataset.months;
  const template = document.getElementById('table-template');
  const tableClone = template.content.cloneNode(true);
  const head = tableClone.getElementById('table-head');
  const body = tableClone.getElementById('table-body');

  const headerRow = document.createElement('tr');
  const blankCell = document.createElement('th');
  blankCell.textContent = 'Показатель';
  headerRow.appendChild(blankCell);
  months.forEach((month) => {
    const th = document.createElement('th');
    th.textContent = formatMonth(month);
    headerRow.appendChild(th);
  });
  head.appendChild(headerRow);

  if (state.view === 'source') {
    renderSourceRows(body, months, dataset);
  } else {
    renderChannelRows(body, months, dataset);
  }

  tableWrapper.innerHTML = '';
  tableWrapper.appendChild(tableClone);
  bindSubscriberEditors();
}

function renderSourceRows(body, months, dataset) {
  const accordionRows = buildMqlAccordionRows(months, dataset);
  accordionRows.forEach((row) => body.appendChild(row));

  const rows = [
    { label: 'Выигранные сделки', metric: 'won', source: 'combined', formatter: formatNumber },
    { label: 'Закрытые сделки', metric: 'closed', source: 'combined', formatter: formatNumber },
    { label: 'Conversion %', metric: 'conversion', source: 'combined', formatter: formatPercent },
    { label: 'Маркетинговый бюджет', metric: 'budget', formatter: formatCurrency },
    { label: 'Подписчики (Instagram)', metric: 'subscribers', formatter: formatNumber },
    { label: 'Новые подписчики', metric: 'newSubscribers', formatter: formatNumber },
    { label: 'Стоимость подписчика', metric: 'costPerSubscriber', formatter: formatCurrency, allowNull: true },
    { label: 'Стоимость MQL', metric: 'costPerMql', formatter: formatCurrency, allowNull: true },
    { label: 'Стоимость сделки', metric: 'costPerDeal', formatter: formatCurrency, allowNull: true }
  ];

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const labelTd = document.createElement('td');
    labelTd.textContent = row.label;
    tr.appendChild(labelTd);

    months.forEach((month) => {
      const td = document.createElement('td');
      let value;
      if (row.source) {
        value = dataset.sources[month][row.source][row.metric];
      } else {
        value = dataset.metrics[month][row.metric];
      }
      if (row.label === 'Подписчики (Instagram)') {
        td.classList.add('subscriber-cell');
        td.dataset.monthKey = month;
        td.dataset.rawValue = Number.isFinite(value) ? value : '';
      }
      if (!row.allowNull && (value === undefined || value === null)) {
        value = 0;
      }
      td.textContent = row.formatter(value);
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

function buildMqlAccordionRows(months, dataset) {
  const headerRow = document.createElement('tr');
  headerRow.classList.add('mql-accordion-header');

  const labelTd = document.createElement('td');
  labelTd.classList.add('row-label');
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'collapse-toggle';
  toggleBtn.innerHTML = '<span class="collapse-icon">▶</span>';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = 'MQL Leads';
  labelTd.appendChild(toggleBtn);
  labelTd.appendChild(labelSpan);
  headerRow.appendChild(labelTd);

  months.forEach((month) => {
    const td = document.createElement('td');
    td.textContent = formatNumber(dataset.sources[month].combined.mql);
    headerRow.appendChild(td);
  });

  const sources = [
    { key: 'pipedrive', label: 'MQL — Pipedrive' },
    { key: 'sendpulse', label: 'MQL — SendPulse' }
  ];

  const detailRows = sources.map((source) => {
    const tr = document.createElement('tr');
    tr.classList.add('mql-accordion-content');
    tr.style.display = 'none';
    const detailLabel = document.createElement('td');
    detailLabel.classList.add('row-label');
    detailLabel.textContent = source.label;
    tr.appendChild(detailLabel);

    months.forEach((month) => {
      const td = document.createElement('td');
      td.textContent = formatNumber(dataset.sources[month][source.key].mql ?? 0);
      tr.appendChild(td);
    });

    return tr;
  });

  let isOpen = false;

  const toggleAccordion = () => {
    isOpen = !isOpen;
    headerRow.classList.toggle('is-open', isOpen);
    detailRows.forEach((row) => {
      row.style.display = isOpen ? 'table-row' : 'none';
    });
  };

  toggleBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleAccordion();
  });
  headerRow.addEventListener('click', (event) => {
    if (event.target.closest('button')) {
      return;
    }
    toggleAccordion();
  });

  return [headerRow, ...detailRows];
}

function renderChannelRows(body, months, dataset) {
  const fallbackKeys = Object.keys(dataset.channels[months[0]] || {});
  let channelKeys = CHANNELS.filter((key) => dataset.channels[months[0]]?.[key] !== undefined);
  if (channelKeys.length === 0) {
    channelKeys = fallbackKeys;
  }
  channelKeys.forEach((channel) => {
    const tr = document.createElement('tr');
    const labelTd = document.createElement('td');
    labelTd.textContent = channel;
    tr.appendChild(labelTd);

    months.forEach((month) => {
      const td = document.createElement('td');
      td.textContent = formatNumber(dataset.channels[month][channel]);
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

function updateSyncInfo() {
  sendpulseSyncEl.textContent = currentSummary?.sync.sendpulse || '—';
  pipedriveSyncEl.textContent = currentSummary?.sync.pipedrive || '—';
}

function bindEvents() {
  viewButtons.forEach((button) => {
    button.addEventListener('click', () => {
      viewButtons.forEach((btn) => btn.classList.remove('is-active'));
      button.classList.add('is-active');
      state.view = button.dataset.view;
      renderTable();
    });
  });

  yearSelect.addEventListener('change', (event) => {
    state.year = Number(event.target.value);
    loadSummary(state.year);
  });

  // rerender automatically without manual refresh button
}

function init() {
  bindEvents();
  loadSummary(state.year);
}

init();

function bindSubscriberEditors() {
  const cells = tableWrapper.querySelectorAll('.subscriber-cell');
  cells.forEach((cell) => {
    cell.addEventListener('click', () => startSubscriberEdit(cell));
  });
}

function startSubscriberEdit(cell) {
  if (cell.dataset.editing === '1') return;
  cell.dataset.editing = '1';

  const monthKey = cell.dataset.monthKey;
  const rawValue = cell.dataset.rawValue;
  const initialValue =
    rawValue === undefined || rawValue === null || rawValue === '' ? '' : Number(rawValue);

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  if (initialValue !== '') {
    input.value = initialValue;
  }

  cell.classList.add('editing');
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  const handleBlur = () => finishEdit(true);
  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finishEdit(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishEdit(false);
    }
  };

  input.addEventListener('blur', handleBlur, { once: true });
  input.addEventListener('keydown', handleKeyDown);

  async function finishEdit(commit) {
    input.removeEventListener('keydown', handleKeyDown);
    if (!commit) {
      restoreCell(initialValue);
      return;
    }
    const parsedValue = Number(input.value);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      restoreCell(initialValue);
      return;
    }

    try {
      const result = await saveSubscriberValue(monthKey, parsedValue);
      const newValue = result?.subscribers ?? parsedValue;
      const newDelta = result?.newSubscribers ?? 0;
      const newCost = result?.costPerSubscriber ?? null;
      const monthIndex = currentSummary.months.indexOf(monthKey);
      if (monthIndex !== -1) {
        currentSummary.metrics[monthKey].subscribers = newValue;
        currentSummary.metrics[monthKey].newSubscribers = newDelta;
        currentSummary.metrics[monthKey].costPerSubscriber = newCost;
      }
      restoreCell(newValue);
      renderTable();
    } catch (error) {
      console.error('Failed to update subscribers', error);
      restoreCell(initialValue);
    }
  }

  function restoreCell(value) {
    cell.classList.remove('editing');
    cell.dataset.editing = '0';
    cell.textContent = formatNumber(value);
    cell.dataset.rawValue = Number.isFinite(value) ? value : '';
  }
}

async function saveSubscriberValue(monthKey, subscribers) {
  const monthNumber = Number(monthKey.split('-')[1]);
  const response = await fetch('/api/analytics/mql-subscribers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      year: state.year,
      month: monthNumber,
      subscribers
    })
  });

  if (!response.ok) {
    throw new Error(`API responded with ${response.status}`);
  }

  const payload = await response.json();
  return payload?.data || null;
}


