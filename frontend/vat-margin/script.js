const tabs = document.querySelectorAll('nav button');
const sections = document.querySelectorAll('.tab');
const fileInput = document.getElementById('fileInput');
const uploadSummary = document.getElementById('uploadSummary');
const transactionsTable = document.querySelector('#transactionsTable tbody');
const reportTable = document.querySelector('#reportTable tbody');
const manualTable = document.querySelector('#manualTable tbody');

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


