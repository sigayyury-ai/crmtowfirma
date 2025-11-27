const tabs = document.querySelectorAll('nav button');
const sections = document.querySelectorAll('.tab');
const fileInput = document.getElementById('fileInput');
const uploadSummary = document.getElementById('uploadSummary');
const transactionsTable = document.querySelector('#transactionsTable tbody');
const reportTable = document.querySelector('#reportTable tbody');
const manualTable = document.querySelector('#manualTable tbody');
const cashSummaryTable = document.querySelector('#cashSummaryTable tbody');
const cashSummaryExpected = document.getElementById('cashSummaryExpected');
const cashSummaryReceived = document.getElementById('cashSummaryReceived');
const cashSummaryPending = document.getElementById('cashSummaryPending');
const cashDealIdInput = document.getElementById('cashDealId');
const cashAmountInput = document.getElementById('cashAmount');
const cashCurrencySelect = document.getElementById('cashCurrency');
const cashExpectedDateInput = document.getElementById('cashExpectedDate');
const cashIndicator = document.getElementById('cashIndicator');
const createCashPaymentBtn = document.getElementById('createCashPayment');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    sections.forEach((s) => s.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

function renderTransactions(transactions) {
  transactionsTable.innerHTML = '';
  transactions.forEach((tx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${tx.id}</td>
      <td>${tx.bookingDate}</td>
      <td>${tx.title}</td>
      <td>${tx.proforma || '–'}</td>
      <td>${tx.amount.toFixed(2)}</td>
      <td><span class="tag ${tx.status}">${tx.status}</span></td>
    `;
    transactionsTable.appendChild(tr);
  });
}

function renderReport(report) {
  reportTable.innerHTML = '';
  report.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.product}</td>
      <td>${item.month}</td>
      <td>${item.expected.toFixed(2)}</td>
      <td>${item.actual.toFixed(2)}</td>
      <td>${item.difference.toFixed(2)}</td>
      <td><span class="tag ${item.status}">${item.status}</span></td>
    `;
    reportTable.appendChild(tr);
  });
}

function renderManual(manual) {
  manualTable.innerHTML = '';
  manual.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.id}</td>
      <td>${item.bookingDate}</td>
      <td>${item.title}</td>
      <td>${item.amount.toFixed(2)}</td>
      <td>${item.reason}</td>
      <td><button class="btn">Назначить</button></td>
    `;
    manualTable.appendChild(tr);
  });
}

function showSummary(transactions) {
  const total = transactions.length;
  const matched = transactions.filter((tx) => tx.status === 'matched').length;
  const manual = transactions.filter((tx) => tx.status === 'manual').length;
  uploadSummary.innerHTML = `
    <strong>Итоги:</strong>
    <ul>
      <li>Всего операций: ${total}</li>
      <li>Сопоставлено автоматически: ${matched}</li>
      <li>Требует ручной обработки: ${manual}</li>
    </ul>
  `;
}

function loadSample() {
  renderTransactions(SAMPLE_TRANSACTIONS);
  renderReport(SAMPLE_REPORT);
  renderManual(SAMPLE_MANUAL);
  showSummary(SAMPLE_TRANSACTIONS);
  loadCashSummary();
  refreshCashIndicator();
}

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const text = await file.text();
  parseCSV(text);
});

function parseCSV(text) {
  const rows = text.split('\n').filter((line) => line.startsWith('2025-'));
  const transactions = rows.map((row, index) => {
    const cols = row.split(';');
    const title = cols[3].replace(/"/g, '').trim();
    const proformaMatch = title.match(/CO-PROF\s*(\d+[\/\-]?\d{4})/i);
    const proforma = proformaMatch ? `CO-PROF ${proformaMatch[1].replace('-', '/')}` : null;
    const amount = parseFloat(cols[6].replace(/\s/g, '').replace(',', '.'));
    const status = proforma ? 'matched' : 'manual';
    return {
      id: index + 1,
      bookingDate: cols[0],
      title,
      proforma,
      amount,
      status,
    };
  });

  renderTransactions(transactions);
  showSummary(transactions);

  const report = aggregate(transactions);
  renderReport(report);

  const manual = transactions.filter((tx) => tx.status === 'manual');
  renderManual(manual);
}

function aggregate(transactions) {
  const map = new Map();
  transactions.forEach((tx) => {
    const key = `Product ${tx.proforma || 'Manual'}|2025-09`;
    const entry = map.get(key) || {
      product: tx.proforma ? `Product ${tx.proforma}` : 'Manual allocation',
      month: '2025-09',
      expected: tx.proforma ? 2000 : 0,
      actual: 0,
    };
    entry.actual += tx.amount;
    map.set(key, entry);
  });
  return Array.from(map.values()).map((item) => {
    const difference = item.actual - item.expected;
    return {
      ...item,
      difference,
      status: difference === 0 ? 'paid' : difference < 0 ? 'partial' : 'overpaid',
    };
  });
}

loadSample();

const CASH_SUMMARY_FALLBACK = [
  {
    period_month: '2025-11-01',
    product_name: 'Demo Hybrid Cash',
    expected_total_pln: 5500,
    received_total_pln: 2300,
    pending_total_pln: 3200
  }
];

async function fetchCashSummaryData() {
  const url = new URL('/api/cash-summary', window.location.origin);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  url.searchParams.append('from', monthStart);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Cash summary fetch failed');
  }
  const data = await response.json();
  return data.summary || [];
}

function renderCashSummaryTable(data) {
  const entries = data.length ? data : CASH_SUMMARY_FALLBACK;
  cashSummaryTable.innerHTML = '';
  entries.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.period_month || '—'}</td>
      <td>${item.product_name || item.resolved_product_name || '—'}</td>
      <td>${(item.expected_total_pln || 0).toFixed(2)}</td>
      <td>${(item.received_total_pln || 0).toFixed(2)}</td>
      <td>${(item.pending_total_pln || 0).toFixed(2)}</td>
    `;
    cashSummaryTable.appendChild(tr);
  });
}

function renderCashSummaryCards(data) {
  const totals = data.reduce(
    (acc, item) => {
      acc.expected += item.expected_total_pln || 0;
      acc.received += item.received_total_pln || 0;
      acc.pending += item.pending_total_pln || 0;
      return acc;
    },
    { expected: 0, received: 0, pending: 0 }
  );

  cashSummaryExpected.textContent = `${totals.expected.toFixed(2)} PLN`;
  cashSummaryReceived.textContent = `${totals.received.toFixed(2)} PLN`;
  cashSummaryPending.textContent = `${totals.pending.toFixed(2)} PLN`;
}

async function loadCashSummary() {
  try {
    const data = await fetchCashSummaryData();
    renderCashSummaryCards(data);
    renderCashSummaryTable(data);
  } catch (error) {
    console.warn('Using fallback cash summary data', error);
    renderCashSummaryCards(CASH_SUMMARY_FALLBACK);
    renderCashSummaryTable(CASH_SUMMARY_FALLBACK);
  }
}

async function refreshCashIndicator() {
  try {
    const data = await fetchCashSummaryData();
    const pending = data.reduce((sum, item) => sum + (item.pending_total_pln || 0), 0);
    if (pending > 0) {
      cashIndicator.textContent = `Ожидаем кэш: ${pending.toFixed(2)} PLN`;
      cashIndicator.classList.add('warning');
    } else {
      cashIndicator.textContent = 'Ожиданий наличных нет';
      cashIndicator.classList.remove('warning');
    }
  } catch (error) {
    cashIndicator.textContent = 'Не удалось получить сводку';
    console.warn('Failed to refresh cash indicator', error);
  }
}
async function createCashPayment(payload) {
  const response = await fetch('/api/cash-payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Cash API error');
  }
  return response.json();
}

createCashPaymentBtn.addEventListener('click', async () => {
  const dealId = Number(cashDealIdInput.value);
  const amount = Number(cashAmountInput.value);
  const currency = cashCurrencySelect.value;
  const expectedDate = cashExpectedDateInput.value;

  if (!Number.isFinite(dealId) || dealId <= 0) {
    alert('Укажите Deal ID');
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    alert('Введите сумму наличных');
    return;
  }

  try {
    createCashPaymentBtn.disabled = true;
    createCashPaymentBtn.textContent = '⏳ Добавляем...';
    await createCashPayment({
      dealId,
      amount,
      currency,
      expectedDate
    });
    cashDealIdInput.value = '';
    cashAmountInput.value = '';
    cashExpectedDateInput.value = '';
    await refreshCashIndicator();
    alert('Наличный платёж создан — задача добавлена в Pipedrive');
  } catch (error) {
    console.error(error);
    alert('Не удалось создать наличный платёж');
  } finally {
    createCashPaymentBtn.disabled = false;
    createCashPaymentBtn.textContent = '➕ Добавить наличный платёж';
  }
});
