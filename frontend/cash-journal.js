const tableBody = document.getElementById('cashTableBody');
const summaryExpected = document.getElementById('summaryExpected');
const summaryReceived = document.getElementById('summaryReceived');
const summaryPending = document.getElementById('summaryPending');
const filterFrom = document.getElementById('filterFrom');
const filterTo = document.getElementById('filterTo');
const filterStatus = document.getElementById('filterStatus');
const applyFiltersBtn = document.getElementById('applyFilters');

const formatCurrency = (amount, currency = 'PLN') => {
  if (!Number.isFinite(amount)) return '—';
  return `${amount.toFixed(2)} ${currency}`;
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString('ru-RU');
};

const getDefaultDateRange = () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10)
  };
};

const DEMO_CASH_PAYMENTS = [
  {
    id: 1,
    deal_id: 99001001,
    cash_expected_amount: 4000,
    currency: 'PLN',
    expected_date: '2025-11-12',
    created_at: '2025-11-10T09:00:00Z',
    status: 'pending_confirmation',
    cash_received_amount: null,
    source: 'manual',
    proformas: {
      buyer_name: 'Demo Client Surf',
      expected_close_date: '2025-11-20'
    }
  },
  {
    id: 2,
    deal_id: 99001002,
    cash_expected_amount: 800,
    currency: 'EUR',
    expected_date: '2025-11-15',
    created_at: '2025-11-05T10:00:00Z',
    status: 'received',
    cash_received_amount: 800,
    source: 'manual',
    proformas: {
      buyer_name: 'Demo Client Sailing',
      expected_close_date: '2025-12-01'
    }
  },
  {
    id: 3,
    deal_id: 99001003,
    cash_expected_amount: 1500,
    currency: 'PLN',
    expected_date: '2025-11-03',
    created_at: '2025-11-01T08:00:00Z',
    status: 'refunded',
    cash_received_amount: 1500,
    source: 'manual',
    proformas: {
      buyer_name: 'Demo Client Workshop',
      expected_close_date: '2025-11-07'
    }
  }
];

const DEMO_CASH_SUMMARY = [
  {
    period_month: '2025-11-01',
    expected_total_pln: 5500,
    received_total_pln: 2300,
    pending_total_pln: 1700
  }
];

async function fetchCashPayments(params = {}) {
  const url = new URL('/api/cash-payments', window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, value);
    }
  });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to load cash payments');
  }
  const data = await response.json();
  return data.items || [];
}

async function fetchSummary(params = {}) {
  const url = new URL('/api/cash-summary', window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.append(key, value);
    }
  });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to load cash summary');
  }
  const data = await response.json();
  return data.summary || [];
}

function renderTable(items) {
  if (!items.length) {
    tableBody.innerHTML = '<tr><td colspan="8" class="text-muted">Нет записей за выбранный период</td></tr>';
    return;
  }

  tableBody.innerHTML = '';
  items.forEach((item) => {
    const tr = document.createElement('tr');
    const dealLink = item.deal_id
      ? `<a href="https://comoon.pipedrive.com/deal/${item.deal_id}" target="_blank" rel="noopener">Deal #${item.deal_id}</a>`
      : '—';

    const buyerName = item.proformas?.buyer_name || item.proformas?.buyer_alt_name || '—';
    const closeDate = item.proformas?.expected_close_date || null;

    const canConfirm = item.status === 'pending' || item.status === 'pending_confirmation';

    tr.innerHTML = `
      <td>${dealLink}</td>
      <td>${buyerName}</td>
      <td>${formatCurrency(item.cash_expected_amount)}</td>
      <td>${item.currency || 'PLN'}</td>
      <td>
        <div>${formatDate(item.expected_date)}</div>
        <small class="text-muted">Close: ${formatDate(closeDate)}</small>
      </td>
      <td><span class="tag ${item.status}">${item.status}</span></td>
      <td>${item.cash_received_amount ? formatCurrency(item.cash_received_amount) : '—'}</td>
      <td>
        ${canConfirm ? `<button class="btn btn-primary btn-confirm" data-id="${item.id}">Подтвердить</button>` : ''}
        <button class="btn btn-secondary btn-refund" data-id="${item.id}">Возврат</button>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}

function renderSummary(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    summaryExpected.textContent = '0';
    summaryReceived.textContent = '0';
    summaryPending.textContent = '0';
    return;
  }

  const totals = entries.reduce(
    (acc, item) => {
      acc.expected += item.expected_total_pln || 0;
      acc.received += item.received_total_pln || 0;
      acc.pending += item.pending_total_pln || 0;
      return acc;
    },
    { expected: 0, received: 0, pending: 0 }
  );

  summaryExpected.textContent = `${totals.expected.toFixed(2)} PLN`;
  summaryReceived.textContent = `${totals.received.toFixed(2)} PLN`;
  summaryPending.textContent = `${totals.pending.toFixed(2)} PLN`;
}

async function loadJournal() {
  const filters = {
    expectedFrom: filterFrom.value,
    expectedTo: filterTo.value,
    status: filterStatus.value,
  };

  const [payments, summary] = await Promise.allSettled([
    fetchCashPayments(filters),
    fetchSummary({ from: filters.expectedFrom, to: filters.expectedTo })
  ]);

  const list = payments.status === 'fulfilled' ? payments.value : DEMO_CASH_PAYMENTS;
  const summaryData = summary.status === 'fulfilled' ? summary.value : DEMO_CASH_SUMMARY;

  if (payments.status === 'rejected') {
    console.warn('Using demo cash payments data');
  }

  if (summary.status === 'rejected') {
    console.warn('Using demo cash summary data');
  }

  renderTable(list);
  renderSummary(summaryData);
}

function initFilters() {
  const { from, to } = getDefaultDateRange();
  if (!filterFrom.value) {
    filterFrom.value = from;
  }
  if (!filterTo.value) {
    filterTo.value = to;
  }
applyFiltersBtn.addEventListener('click', () => {
  loadJournal().catch((error) => {
    console.error(error);
    alert('Не удалось загрузить данные журнала наличных.');
  });
});
}

async function handleConfirm(paymentId) {
  const amountInput = prompt('Введите подтвержденную сумму (оставьте пустым, чтобы использовать ожидаемую):', '');
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
    await loadJournal();
  } catch (error) {
    console.error(error);
    alert('Не удалось подтвердить платеж');
  }
}

async function handleRefund(paymentId) {
  const amountInput = prompt('Сумма возврата (оставьте пустым для полной):', '');
  const reason = prompt('Причина возврата:', 'Клиент отказался');

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
    await loadJournal();
  } catch (error) {
    console.error(error);
    alert('Не удалось выполнить возврат');
  }
}

tableBody.addEventListener('click', (event) => {
  const target = event.target;
  if (target.matches('.btn-confirm')) {
    const id = Number(target.dataset.id);
    if (Number.isFinite(id)) {
      handleConfirm(id);
    }
  }
  if (target.matches('.btn-refund')) {
    const id = Number(target.dataset.id);
    if (Number.isFinite(id)) {
      handleRefund(id);
    }
  }
});

initFilters();
loadJournal().catch((error) => {
  console.error(error);
  renderTable(DEMO_CASH_PAYMENTS);
  renderSummary(DEMO_CASH_SUMMARY);
});
