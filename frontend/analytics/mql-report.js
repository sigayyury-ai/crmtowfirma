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
  const totals = buildTotals(months, dataset);
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
  const totalTh = document.createElement('th');
  totalTh.textContent = 'Итого';
  totalTh.classList.add('total-column');
  headerRow.appendChild(totalTh);
  head.appendChild(headerRow);

  if (state.view === 'source') {
    renderSourceRows(body, months, dataset, totals);
  } else {
    renderChannelRows(body, months, dataset, totals);
  }

  tableWrapper.innerHTML = '';
  tableWrapper.appendChild(tableClone);
  bindSubscriberEditors();
}

function renderSourceRows(body, months, dataset, totals) {
  const accordionRows = buildMqlAccordionRows(months, dataset, totals);
  accordionRows.forEach((row) => body.appendChild(row));

  const rows = [
    { label: 'Выигранные сделки', metric: 'won', source: 'combined', formatter: formatNumber },
    { label: 'Закрытые сделки', metric: 'closed', source: 'combined', formatter: formatNumber },
    { label: 'Повторные продажи', metric: 'repeat', source: 'combined', formatter: formatNumber },
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
      let value = getRowValue(row, dataset, month);
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
    const totalValue = getSummaryValue(row, totals);
    const totalTd = document.createElement('td');
    totalTd.classList.add('total-cell');
    let resolvedTotal = totalValue;
    if (!row.allowNull && (resolvedTotal === undefined || resolvedTotal === null)) {
      resolvedTotal = 0;
    }
    totalTd.textContent = row.formatter(resolvedTotal);
    tr.appendChild(totalTd);
    body.appendChild(tr);
  });
}

function buildMqlAccordionRows(months, dataset, totals) {
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
  const totalTd = document.createElement('td');
  totalTd.classList.add('total-cell');
  totalTd.textContent = formatNumber(totals.sources.combined.mql);
  headerRow.appendChild(totalTd);

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
    const totalValue = totals.sources[source.key]?.mql ?? 0;
    const totalCell = document.createElement('td');
    totalCell.classList.add('total-cell');
    totalCell.textContent = formatNumber(totalValue);
    tr.appendChild(totalCell);

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

function renderChannelRows(body, months, dataset, totals) {
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
    const totalTd = document.createElement('td');
    totalTd.classList.add('total-cell');
    totalTd.textContent = formatNumber(totals.channels[channel] || 0);
    tr.appendChild(totalTd);
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

function getRowValue(row, dataset, month) {
  if (row.source) {
    return dataset.sources[month][row.source][row.metric];
  }
  return dataset.metrics[month][row.metric];
}

function getSummaryValue(row, totals) {
  if (row.source) {
    return totals.sources[row.source]?.[row.metric] ?? null;
  }
  return totals.metrics[row.metric];
}

function buildTotals(months, dataset) {
  const totals = {
    sources: {
      combined: { mql: 0, won: 0, closed: 0, repeat: 0, conversion: null },
      pipedrive: { mql: 0 },
      sendpulse: { mql: 0 }
    },
    metrics: {
      budget: 0,
      subscribers: null,
      newSubscribers: 0,
      costPerSubscriber: null,
      costPerMql: null,
      costPerDeal: null
    },
    channels: {}
  };

  months.forEach((month) => {
    const sourceRow = dataset.sources[month] || {};
    const metricRow = dataset.metrics[month] || {};

    totals.sources.combined.mql += Number(sourceRow.combined?.mql) || 0;
    totals.sources.combined.won += Number(sourceRow.combined?.won) || 0;
    totals.sources.combined.closed += Number(sourceRow.combined?.closed) || 0;
    totals.sources.combined.repeat += Number(sourceRow.combined?.repeat) || 0;
    totals.sources.pipedrive.mql += Number(sourceRow.pipedrive?.mql) || 0;
    totals.sources.sendpulse.mql += Number(sourceRow.sendpulse?.mql) || 0;

    const subscribers = metricRow.subscribers;
    if (isFiniteNumber(subscribers)) {
      totals.metrics.subscribers = subscribers;
    }

    totals.metrics.budget += Number(metricRow.budget) || 0;
    totals.metrics.newSubscribers += Number(metricRow.newSubscribers) || 0;

    const channelRow = dataset.channels[month] || {};
    Object.entries(channelRow).forEach(([channel, value]) => {
      totals.channels[channel] = (totals.channels[channel] || 0) + (Number(value) || 0);
    });
  });

  const totalBudget = totals.metrics.budget;
  const totalNewSubscribers = totals.metrics.newSubscribers;
  const totalMql = totals.sources.combined.mql;
  const totalWon = totals.sources.combined.won;

  totals.metrics.costPerSubscriber =
    totalBudget > 0 && totalNewSubscribers > 0 ? totalBudget / totalNewSubscribers : null;
  totals.metrics.costPerMql = totalBudget > 0 && totalMql > 0 ? totalBudget / totalMql : null;
  totals.metrics.costPerDeal = totalBudget > 0 && totalWon > 0 ? totalBudget / totalWon : null;
  totals.sources.combined.conversion = totalMql > 0 ? totalWon / totalMql : null;

  return totals;
}

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


