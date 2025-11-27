const tableBody = document.getElementById('cashTableBody');
const summaryExpected = document.getElementById('summaryExpected');
const summaryReceived = document.getElementById('summaryReceived');
const summaryPending = document.getElementById('summaryPending');
const filterStatus = document.getElementById('filterStatus');
const filterProduct = document.getElementById('filterProduct');
const applyFiltersBtn = document.getElementById('applyFilters');

const STATUS_LABELS = {
  pending: 'Ожидается',
  pending_confirmation: 'На подтверждении',
  received: 'Получено',
  refunded: 'Возврат',
  cancelled: 'Отменено'
};

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

const DEMO_CASH_PAYMENTS = [];
const DEMO_CASH_SUMMARY = [];

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
    if (value !== undefined && value !== null && value !== '') {
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

async function loadProductOptions() {
  if (!filterProduct) {
    return;
  }
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

    filterProduct.innerHTML = '<option value=\"\">Все продукты</option>';
    Array.from(unique.entries())
      .sort((a, b) => a[1].localeCompare(b[1], 'ru'))
      .forEach(([id, name]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        filterProduct.appendChild(option);
      });
  } catch (error) {
    console.warn('Не удалось загрузить список продуктов', error);
  }
}

function renderTable(items) {
  if (!items.length) {
    tableBody.innerHTML = '<tr><td colspan="7" class="text-muted">Нет записей за выбранный период</td></tr>';
    return;
  }

  tableBody.innerHTML = '';
  items.forEach((item) => {
    const tr = document.createElement('tr');
    const rawBuyerName =
      item.metadata?.buyerName ||
      item.metadata?.buyer_name ||
      item.metadata?.personName ||
      item.metadata?.person_name ||
      item.proformas?.buyer_name ||
      item.proformas?.buyer_alt_name ||
      item.deal_person_name ||
      null;

    const buyerName = rawBuyerName || (item.deal_id ? `Сделка #${item.deal_id}` : '—');

    const clientCell = item.deal_id
      ? `<a href="https://comoon.pipedrive.com/deal/${item.deal_id}" target="_blank" rel="noopener">${buyerName}</a>`
      : buyerName;

    const canConfirm = item.status === 'pending' || item.status === 'pending_confirmation';
    const statusLabel = STATUS_LABELS[item.status] || item.status;

    tr.innerHTML = `
      <td>${clientCell}</td>
      <td>${formatCurrency(item.cash_expected_amount, item.currency || 'PLN')}</td>
      <td>${formatDate(item.expected_date)}</td>
      <td><span class="tag ${item.status}">${statusLabel}</span></td>
      <td>${item.cash_received_amount ? formatCurrency(item.cash_received_amount, item.currency || 'PLN') : '—'}</td>
      <td class="actions-cell">
        ${canConfirm ? `<button class="btn btn-primary btn-confirm" data-id="${item.id}">Подтвердить</button>` : ''}
        <button class="btn btn-secondary btn-refund" data-id="${item.id}">Возврат</button>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}

function renderSummary(entries, fallbackItems = []) {
  if (Array.isArray(entries) && entries.length > 0) {
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
    return;
  }

  const totals = (Array.isArray(fallbackItems) ? fallbackItems : []).reduce(
    (acc, item) => {
      const expected = Number(item.cash_expected_amount) || 0;
      const received = Number(item.cash_received_amount) || 0;
      if (item.status === 'received') {
        acc.received += received || expected;
      } else if (item.status === 'pending' || item.status === 'pending_confirmation') {
        acc.pending += Math.max(expected - received, 0);
      }
      acc.expected += expected;
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
    status: filterStatus?.value || '',
    productId: filterProduct && filterProduct.value ? filterProduct.value : undefined
  };

  const [payments, summary] = await Promise.allSettled([
    fetchCashPayments(filters),
    fetchSummary(filters.productId ? { productId: filters.productId } : {})
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
  renderSummary(summaryData, list);
}

function initFilters() {
  if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener('click', () => {
      loadJournal().catch((error) => {
        console.error(error);
        alert('Не удалось загрузить данные журнала наличных.');
      });
    });
  }

  if (filterStatus) {
    filterStatus.addEventListener('change', () => {
      loadJournal().catch((error) => {
        console.error(error);
        alert('Не удалось загрузить данные журнала наличных.');
      });
    });
  }

  if (filterProduct) {
    filterProduct.addEventListener('change', () => {
      loadJournal().catch((error) => {
        console.error(error);
        alert('Не удалось загрузить данные журнала наличных.');
      });
    });
  }
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
loadProductOptions().finally(() => {
  loadJournal().catch((error) => {
    console.error(error);
    renderTable(DEMO_CASH_PAYMENTS);
    renderSummary(DEMO_CASH_SUMMARY);
  });
});
