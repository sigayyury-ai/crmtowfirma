const API_BASE = '/api';

const statusLabels = {
  in_progress: 'В процессе',
  calculated: 'Рассчитан'
};

const paymentStatusLabels = {
  paid: 'Оплачено',
  partial: 'Частично',
  unpaid: 'Ожидает оплаты',
  unknown: '—'
};

let elements = {};
let productSlug = null;
let productDetail = null;
let isSaving = false;

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  parseProductSlug();
  bindEvents();
  loadProductDetail();
});

function cacheDom() {
  elements = {
    title: document.getElementById('product-title'),
    subtitle: document.getElementById('product-subtitle'),
    statusSelect: document.getElementById('detail-status'),
    dueMonthInput: document.getElementById('detail-due-month'),
    saveButton: document.getElementById('product-save-status'),
    summaryContainer: document.getElementById('product-summary'),
    monthlyContainer: document.getElementById('product-monthly'),
    proformasContainer: document.getElementById('product-proformas'),
    alertBox: document.getElementById('product-alert')
  };
}

function parseProductSlug() {
  const params = new URLSearchParams(window.location.search);
  productSlug = params.get('product');

  if (!productSlug) {
    showAlert('error', 'Не указан продукт. Вернитесь к сводке и выберите продукт ещё раз.');
    if (elements.subtitle) {
      elements.subtitle.textContent = 'Не удалось определить продукт';
    }
  }
}

function bindEvents() {
  if (elements.saveButton) {
    elements.saveButton.addEventListener('click', async (event) => {
      event.preventDefault();
      await saveProductStatus();
    });
  }
}

function showAlert(type, message) {
  if (!elements.alertBox) return;

  elements.alertBox.classList.remove('hidden', 'alert-info', 'alert-success', 'alert-error');
  elements.alertBox.textContent = message;

  if (type === 'success') {
    elements.alertBox.classList.add('alert-success');
  } else if (type === 'info') {
    elements.alertBox.classList.add('alert-info');
  } else {
    elements.alertBox.classList.add('alert-error');
  }
}

function clearAlert() {
  if (!elements.alertBox) return;
  elements.alertBox.classList.add('hidden');
  elements.alertBox.textContent = '';
}

async function apiCall(endpoint, method = 'GET', data = null) {
  const config = {
    method,
    headers: {}
  };

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

async function loadProductDetail() {
  if (!productSlug || !elements.summaryContainer) return;

  try {
    clearAlert();
    elements.title.textContent = 'Загрузка...';
    elements.subtitle.textContent = 'Получаем данные по продукту';
    elements.summaryContainer.innerHTML = '<div class="placeholder">Загрузка...</div>';
    elements.monthlyContainer.innerHTML = '<div class="placeholder">Загрузка...</div>';
    elements.proformasContainer.innerHTML = '<div class="placeholder">Загрузка...</div>';

    const result = await apiCall(`/vat-margin/products/${encodeURIComponent(productSlug)}/detail`);

    if (!result?.success) {
      throw new Error(result?.error || 'Не удалось получить данные продукта');
    }

    productDetail = result.data;
    renderProductDetail();
  } catch (error) {
    showAlert('error', error.message);
    elements.summaryContainer.innerHTML = `<div class="placeholder">Не удалось загрузить данные: ${escapeHtml(error.message)}</div>`;
    elements.monthlyContainer.innerHTML = '<div class="placeholder">Данные отсутствуют</div>';
    elements.proformasContainer.innerHTML = '<div class="placeholder">Данные отсутствуют</div>';
  }
}

function renderProductDetail() {
  if (!productDetail) return;

  if (elements.title) {
    elements.title.textContent = productDetail.productName || 'Без названия';
  }

  if (elements.subtitle) {
    const dateText = productDetail.lastSaleDate
      ? `последняя продажа ${formatDate(productDetail.lastSaleDate)}`
      : 'история продаж отсутствует';
    elements.subtitle.textContent = `${productDetail.proformaCount || 0} проф., ${dateText}`;
  }

  if (elements.statusSelect) {
    elements.statusSelect.value = productDetail.calculationStatus || 'in_progress';
  }

  if (elements.dueMonthInput) {
    elements.dueMonthInput.value = productDetail.calculationDueMonth || '';
  }

  renderSummaryCards(productDetail);
  renderMonthlyTable(productDetail.monthlyBreakdown || []);
  renderProformasTable(productDetail.proformas || []);
}

function renderSummaryCards(detail) {
  if (!elements.summaryContainer) return;

  const cards = [
    {
      label: 'Суммарная выручка (PLN)',
      value: formatCurrency(detail.totals?.grossPln || 0, 'PLN')
    },
    {
      label: 'Оплачено (PLN)',
      value: formatCurrency(detail.totals?.paidPln || 0, 'PLN')
    },
    {
      label: 'Доля в общей выручке',
      value: detail.revenueShare ? `${(detail.revenueShare * 100).toFixed(2)}%` : '—'
    }
  ];

  const originalTotals = detail.totals?.currencyTotals || {};
  Object.entries(originalTotals).forEach(([currency, amount]) => {
    cards.push({
      label: `Выручка в ${currency}`,
      value: formatCurrency(amount, currency)
    });
  });

  elements.summaryContainer.innerHTML = cards
    .map((card) => `
      <div class="summary-card">
        <span class="summary-label">${escapeHtml(card.label)}</span>
        <span class="summary-value">${escapeHtml(card.value)}</span>
      </div>
    `)
    .join('');
}

function renderMonthlyTable(items) {
  if (!elements.monthlyContainer) return;

  if (!Array.isArray(items) || items.length === 0) {
    elements.monthlyContainer.innerHTML = '<div class="placeholder">Данные отсутствуют</div>';
    return;
  }

  const rows = items
    .map((item) => `
      <tr>
        <td>${escapeHtml(formatMonthLabel(item.month))}</td>
        <td class="numeric">${item.proformaCount?.toLocaleString('ru-RU') || '0'}</td>
        <td class="numeric">${formatCurrency(item.grossPln || 0, 'PLN')}</td>
        <td>${formatCurrencyMap(item.currencyTotals || {})}</td>
      </tr>
    `)
    .join('');

  elements.monthlyContainer.innerHTML = `
    <table class="detail-table">
      <thead>
        <tr>
          <th>Месяц</th>
          <th>Проф.</th>
          <th>Выручка (PLN)</th>
          <th>Выручка (оригинал)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderProformasTable(items) {
  if (!elements.proformasContainer) return;

  if (!Array.isArray(items) || items.length === 0) {
    elements.proformasContainer.innerHTML = '<div class="placeholder">Данные отсутствуют</div>';
    return;
  }

  const rows = items
    .map((item) => {
      const dealId = item.dealId ? String(item.dealId) : null;
      const dealLinkHtml = item.dealUrl && dealId
        ? `<div class="deal-link-wrapper"><a class="deal-link" href="${item.dealUrl}" target="_blank" rel="noopener noreferrer">Deal #${escapeHtml(dealId)}</a></div>`
        : '';

      return `
      <tr>
        <td>
          <div>${escapeHtml(item.fullnumber || '—')}</div>
          ${dealLinkHtml}
        </td>
        <td>${escapeHtml(formatDate(item.date))}</td>
        <td>${formatCurrencyMap(item.currencyTotals || {})}</td>
        <td class="numeric">${formatCurrency(item.totalPln || 0, 'PLN')}</td>
        <td class="numeric">${formatCurrency(item.paidPln || 0, 'PLN')}</td>
        <td>${escapeHtml(paymentStatusLabels[item.paymentStatus] || paymentStatusLabels.unknown)}</td>
      </tr>
    `;
    })
    .join('');

  elements.proformasContainer.innerHTML = `
    <table class="detail-table">
      <thead>
        <tr>
          <th>Проформа</th>
          <th>Дата</th>
          <th>Сумма (оригинал)</th>
          <th>Сумма (PLN)</th>
          <th>Оплачено (PLN)</th>
          <th>Статус оплаты</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function saveProductStatus() {
  if (!productSlug || !elements.saveButton || isSaving) return;

  try {
    clearAlert();
    isSaving = true;
    setButtonLoading(elements.saveButton, true, 'Сохранение...');

    const payload = {
      status: elements.statusSelect?.value || undefined,
      dueMonth: elements.dueMonthInput?.value || null
    };

    const result = await apiCall(`/vat-margin/products/${encodeURIComponent(productSlug)}/status`, 'POST', payload);

    if (!result?.success) {
      throw new Error(result?.error || 'Не удалось сохранить изменения');
    }

    showAlert('success', 'Статус продукта обновлён');
    await loadProductDetail();
  } catch (error) {
    showAlert('error', error.message);
  } finally {
    isSaving = false;
    setButtonLoading(elements.saveButton, false, '💾 Сохранить');
  }
}

function formatCurrency(amount, currency = 'PLN') {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);
}

function formatCurrencyMap(totals) {
  const entries = Object.entries(totals || {});
  if (!entries.length) return '—';
  return entries
    .map(([currency, amount]) => formatCurrency(amount, currency))
    .join(' + ');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU');
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

function escapeHtml(text) {
  if (text === undefined || text === null) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setButtonLoading(button, loading, loadingText = 'Загрузка...') {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.dataset.originalText || button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<div class=\"loading\"></div> ${loadingText}`;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.originalText || button.innerHTML;
    delete button.dataset.originalText;
  }
}

