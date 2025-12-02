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

const paymentStatusClasses = {
  paid: 'status-complete',
  partial: 'status-warning',
  unpaid: 'status-error',
  unknown: 'status-auto'
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
    proformasContainer: document.getElementById('product-proformas'),
    linkedPaymentsContainer: document.getElementById('product-linked-payments'),
    stripePaymentsContainer: document.getElementById('product-stripe-payments'),
    alertBox: document.getElementById('product-alert'),
    payerModal: document.getElementById('product-payer-modal'),
    payerModalTitle: document.getElementById('product-payer-title'),
    payerModalBody: document.getElementById('product-payer-body'),
    payerModalClose: document.getElementById('product-payer-close')
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

  elements.proformasContainer?.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-payer-action="show-payments"]');
    if (!trigger || !elements.proformasContainer.contains(trigger)) {
      return;
    }
    const payerName = trigger.dataset.payerName || '';
    const proforma = trigger.dataset.proformaFullnumber || '';
    openProductPayerPaymentsModal({
      payerName: payerName || null,
      proformaFullnumber: proforma || null
    });
  });
  elements.proformasContainer?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const trigger = event.target.closest('[data-payer-action="show-payments"]');
    if (!trigger || !elements.proformasContainer.contains(trigger)) {
      return;
    }
    event.preventDefault();
    const payerName = trigger.dataset.payerName || '';
    const proforma = trigger.dataset.proformaFullnumber || '';
    openProductPayerPaymentsModal({
      payerName: payerName || null,
      proformaFullnumber: proforma || null
    });
  });

  elements.payerModalClose?.addEventListener('click', closeProductPayerPaymentsModal);
  elements.payerModal?.addEventListener('click', (event) => {
    if (event.target === elements.payerModal) {
      closeProductPayerPaymentsModal();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isProductPayerModalOpen()) {
      closeProductPayerPaymentsModal();
    }
  });
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
    elements.proformasContainer.innerHTML = '<div class="placeholder">Данные отсутствуют</div>';
  }
}

function renderProductDetail() {
  if (!productDetail) return;

  const isStripeOnlyProduct = productDetail.source === 'stripe_event'
    || (productDetail.proformaCount === 0 && productDetail.stripeTotals?.paymentsCount > 0);

  if (elements.title) {
    elements.title.textContent = productDetail.productName || 'Без названия';
  }

  if (elements.subtitle) {
    const proformaLabel = `${(productDetail.proformaCount || 0).toLocaleString('ru-RU')} проф.`;
    const stripeLabel = productDetail.stripeTotals?.paymentsCount
      ? `${formatPaymentCount(productDetail.stripeTotals.paymentsCount)} Stripe`
      : 'Stripe платежей нет';
    const dateParts = [];
    if (productDetail.lastSaleDate) {
      dateParts.push(`последняя продажа ${formatDate(productDetail.lastSaleDate)}`);
    }
    if (productDetail.stripeTotals?.lastPaymentAt) {
      dateParts.push(`последний Stripe ${formatDate(productDetail.stripeTotals.lastPaymentAt)}`);
    }
    if (dateParts.length === 0) {
      dateParts.push('история продаж отсутствует');
    }
    elements.subtitle.textContent = `${proformaLabel}, ${stripeLabel} • ${dateParts.join(' • ')}`;
  }

  if (elements.statusSelect) {
    elements.statusSelect.value = productDetail.calculationStatus || 'in_progress';
  }

  if (elements.dueMonthInput) {
    elements.dueMonthInput.value = productDetail.calculationDueMonth || '';
  }

  renderSummaryCards(productDetail);

  try {
    renderProformasTable(productDetail.proformas || [], { isStripeOnly: isStripeOnlyProduct });
  } catch (error) {
    console.error('Failed to render proformas table', error);
    if (elements.proformasContainer) {
      elements.proformasContainer.innerHTML = '<div class="placeholder">Не удалось отобразить проформы</div>';
    }
  }

  renderStripePaymentsTable(productDetail.stripePayments || [], {
    stripeTotals: productDetail.stripeTotals,
    isStripeOnly: isStripeOnlyProduct
  });
  renderLinkedPaymentsTables(productDetail.linkedPayments || {});
}

function renderSummaryCards(detail) {
  if (!elements.summaryContainer) return;

  const totals = detail.totals || {};
  const summaryItems = [
    {
      label: 'Суммарная выручка (PLN)',
      value: formatCurrency(totals.grossPln || 0, 'PLN')
    },
    {
      label: 'Оплачено (PLN)',
      value: formatCurrency(totals.paidPln || 0, 'PLN')
    },
    {
      label: 'Проформ',
      value: (detail.proformaCount || 0).toLocaleString('ru-RU')
    },
    {
      label: 'Платежей Stripe',
      value: (detail.stripeTotals?.paymentsCount || 0).toLocaleString('ru-RU')
    }
  ];

  elements.summaryContainer.innerHTML = summaryItems
    .map((card) => `
      <div class="summary-card">
        <span class="summary-label">${escapeHtml(card.label)}</span>
        <span class="summary-value">${escapeHtml(card.value)}</span>
      </div>
    `)
    .join('');
}

function renderProformasTable(items, { isStripeOnly = false } = {}) {
  if (!elements.proformasContainer) return;

  if (isStripeOnly) {
    elements.proformasContainer.innerHTML = '<div class="placeholder">Это продукт из Stripe, проформы для него не создаются.</div>';
    return;
  }

  const validItems = Array.isArray(items)
    ? items.filter((item) => item && typeof item === 'object')
    : [];

  if (!validItems.length) {
    elements.proformasContainer.innerHTML = '<div class="placeholder">Проформы не найдены</div>';
    return;
  }

  const rows = validItems
    .map((item) => {
      const buyerName = item.buyerName || item.buyerAltName || null;
      const proformaLabel = escapeHtml(item.fullnumber || '—');
      const proformaCell = item.dealUrl
        ? `<a class="deal-link" href="${item.dealUrl}" target="_blank" rel="noopener noreferrer">${proformaLabel}</a>`
        : proformaLabel;

      const paymentCount = Number(item.paymentCount) || 0;
      const paymentCountLabel = paymentCount > 0 ? formatPaymentCount(paymentCount) : '';
      const paymentsBadge = paymentCountLabel
        ? `<div class="payments-count-badge">${escapeHtml(paymentCountLabel)}</div>`
        : '';

      const buyerCell = buyerName && item.fullnumber
        ? `
            <div class="buyer-cell">
              <span
                class="payer-link"
                data-payer-action="show-payments"
                data-payer-name="${escapeHtml(buyerName)}"
                data-proforma-fullnumber="${escapeHtml(item.fullnumber)}"
                role="button"
                tabindex="0"
              >
                ${escapeHtml(buyerName)}
              </span>
              ${paymentsBadge}
            </div>
          `
        : `
            <div class="buyer-cell">
              ${escapeHtml(buyerName || '—')}
              ${paymentsBadge}
            </div>
          `;

      return `
        <tr>
          <td>${proformaCell}</td>
          <td>${buyerCell}</td>
          <td>${escapeHtml(formatDate(item.date))}</td>
          <td>${formatCurrencyMap(item.currencyTotals || {})}</td>
          <td class="numeric">${formatCurrency(item.totalPln || 0, 'PLN')}</td>
          <td class="numeric">${formatCurrency(item.paidPln || 0, 'PLN')}</td>
          <td>${renderPaymentStatusBadge(item.paymentStatus)}</td>
        </tr>
      `;
    })
    .join('');

  elements.proformasContainer.innerHTML = `
    <table class="detail-table">
      <thead>
        <tr>
          <th>Проформа</th>
          <th>Контрагент</th>
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

function renderLinkedPaymentsTables(linkedPayments) {
  if (!elements.linkedPaymentsContainer) return;

  const incoming = linkedPayments?.incoming || [];
  const outgoing = linkedPayments?.outgoing || [];

  if (incoming.length === 0 && outgoing.length === 0) {
    elements.linkedPaymentsContainer.innerHTML = '<div class="placeholder">Связанных платежей пока нет</div>';
    return;
  }

  const sections = [];

  if (incoming.length) {
    sections.push(createLinkedPaymentsSection('Входящие платежи', incoming, { showHeader: true }));
  }

  if (outgoing.length) {
    sections.push(createLinkedPaymentsSection('Исходящие платежи', outgoing, { showHeader: false }));
  }

  elements.linkedPaymentsContainer.innerHTML = sections.join('');
}

function createLinkedPaymentsSection(title, items, options = {}) {
  const showHeader = options.showHeader !== false && Boolean(title);
  const rows = items
    .map((item) => {
      const description = item.description || '—';
      const counterparty = item.payerName || '—';
      const operationDate = item.operationDate ? formatDate(item.operationDate) : '—';
      const linkedAt = item.linkedAt ? formatDate(item.linkedAt) : '—';
      const linkedBy = item.linkedBy || '—';
      const amount = formatCurrency(item.amount || 0, item.currency || 'PLN');
      const source = item.source || '—';

      return `
        <tr>
          <td>${escapeHtml(operationDate)}</td>
          <td>${escapeHtml(description)}</td>
          <td>${escapeHtml(counterparty)}</td>
          <td class="numeric">${escapeHtml(amount)}</td>
          <td>${escapeHtml(source)}</td>
          <td>${escapeHtml(linkedBy)}</td>
          <td>${escapeHtml(linkedAt)}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="linked-payments-group">
      ${showHeader ? `<h3>${escapeHtml(title)}</h3>` : ''}
      <table class="data-table">
        <thead>
          <tr>
            <th>Дата операции</th>
            <th>Описание</th>
            <th>Контрагент</th>
            <th class="numeric">Сумма</th>
            <th>Источник</th>
            <th>Связал</th>
            <th>Дата связи</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function renderStripePaymentsTable(items, { stripeTotals = null, isStripeOnly = false } = {}) {
  if (!elements.stripePaymentsContainer) return;

  if (!Array.isArray(items) || items.length === 0) {
    if (stripeTotals?.paymentsCount) {
      const summaryParts = [
        `Всего платежей: ${stripeTotals.paymentsCount.toLocaleString('ru-RU')}`,
        `Выручка: ${formatCurrency(stripeTotals.grossPln || 0, 'PLN')}`
      ];
      if (stripeTotals.grossTaxPln) {
        summaryParts.push(`VAT: ${formatCurrency(stripeTotals.grossTaxPln, 'PLN')}`);
      }
      if (stripeTotals.lastPaymentAt) {
        summaryParts.push(`последний платёж ${formatDateTime(stripeTotals.lastPaymentAt)}`);
      }
      const note = isStripeOnly
        ? 'Это продукт создан из Stripe Events, подробные checkout-сессии доступны в отчётах Stripe.'
        : 'Stripe платежи агрегированы, подробные сессии пока недоступны.';
      elements.stripePaymentsContainer.innerHTML = `
        <div class="placeholder">
          <div>${note}</div>
          <div>${summaryParts.join(' • ')}</div>
        </div>
      `;
      return;
    }
    elements.stripePaymentsContainer.innerHTML = '<div class="placeholder">Stripe платежей нет</div>';
    return;
  }

  const rows = items
    .map((payment) => {
      const sessionCell = payment.sessionId
        ? buildStripePaymentLink(payment.sessionId, payment.paymentMode)
        : '—';
      const paymentType = payment.paymentType ? escapeHtml(payment.paymentType) : '—';
      const amountPln = formatCurrency(payment.amountPln || 0, 'PLN');
      const amountOriginal = formatCurrency(payment.amount || 0, payment.currency || 'PLN');
      const taxPln = formatCurrency(payment.taxAmountPln || 0, 'PLN');
      const customerInfo = renderStripeCustomer(payment);
      const flags = renderStripeFlags(payment);
      const createdAt = formatDateTime(payment.createdAt);

      return `
        <tr>
          <td>${sessionCell}</td>
          <td>${paymentType}</td>
          <td>${customerInfo}</td>
          <td class="numeric">${amountPln}</td>
          <td>${amountOriginal}</td>
          <td class="numeric">${taxPln}</td>
          <td>${flags}</td>
          <td>${createdAt}</td>
        </tr>
      `;
    })
    .join('');

  elements.stripePaymentsContainer.innerHTML = `
    <table class="detail-table">
      <thead>
        <tr>
          <th>Платёж</th>
          <th>Тип</th>
          <th>Клиент</th>
          <th>Сумма (PLN)</th>
          <th>Сумма</th>
          <th>VAT (PLN)</th>
          <th>Статусы</th>
          <th>Дата</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function showProductPayerPaymentsModalLoading({ payerName, proformaFullnumber }) {
  if (elements.payerModalTitle) {
    elements.payerModalTitle.textContent = payerName
      ? `Платежи: ${payerName}`
      : 'Платежи контрагента';
  }

  const metaParts = [];
  if (payerName) {
    metaParts.push(`Контрагент: ${escapeHtml(payerName)}`);
  }
  if (proformaFullnumber) {
    metaParts.push(`Проформа: ${escapeHtml(proformaFullnumber)}`);
  }

  if (elements.payerModalBody) {
    elements.payerModalBody.innerHTML = `
      ${metaParts.length ? `<div class="payer-payments-summary"><div class="summary-meta">${metaParts.join(' • ')}</div></div>` : ''}
      <div class="loading-indicator">Загружаю платежи...</div>
    `;
  }

  if (elements.payerModal) {
    elements.payerModal.style.display = 'block';
  }
  document.body.classList.add('modal-open');
}

async function openProductPayerPaymentsModal({ payerName, proformaFullnumber }) {
  if (!elements.payerModalBody) return;

  showProductPayerPaymentsModalLoading({ payerName, proformaFullnumber });

  const params = new URLSearchParams();
  if (payerName) {
    params.set('payer', payerName.trim().toLowerCase());
  }
  if (proformaFullnumber) {
    params.set('proforma', proformaFullnumber.trim());
  }

  let payments = [];
  let totalCount = 0;
  let filterApplied = Boolean(payerName);
  let fallbackUsed = false;

  if (params.toString()) {
    try {
      const result = await apiCall(`/vat-margin/payer-payments?${params.toString()}`);
      if (result?.success && Array.isArray(result.payments)) {
        payments = result.payments;
        totalCount = Number(result.count) || payments.length;
      } else if (result?.error) {
        showProductPayerPaymentsError(result.error);
        return;
      }
    } catch (error) {
      showProductPayerPaymentsError(error.message);
      return;
    }
  }

  if (!payments.length && payerName && proformaFullnumber) {
    try {
      const fallbackParams = new URLSearchParams();
      fallbackParams.set('proforma', proformaFullnumber.trim());
      const result = await apiCall(`/vat-margin/payer-payments?${fallbackParams.toString()}`);
      if (result?.success && Array.isArray(result.payments)) {
        payments = result.payments;
        totalCount = Number(result.count) || payments.length;
        fallbackUsed = true;
        filterApplied = false;
      }
    } catch (error) {
      // swallow fallback error; will show message below if still empty
    }
  }

  if (!payments.length) {
    showProductPayerPaymentsError('Платежи не найдены');
    return;
  }

  renderProductPayerPaymentsModal({
    payerName,
    proformaFullnumber,
    payments,
    totalCount,
    filterNote: fallbackUsed
  });
}

function showProductPayerPaymentsError(message) {
  if (elements.payerModalBody) {
    elements.payerModalBody.innerHTML = `<div class="placeholder">Не удалось загрузить платежи: ${escapeHtml(message)}</div>`;
  }
}

function renderProductPayerPaymentsModal({
  payerName,
  proformaFullnumber,
  payments = [],
  totalCount = 0,
  filterNote = false
}) {
  if (!elements.payerModalBody) return;

  const rows = payments.length
    ? payments.map((payment) => `
        <tr>
          <td>${escapeHtml(String(payment.id || '—'))}</td>
          <td>${escapeHtml(formatDate(payment.date) || '—')}</td>
          <td class="numeric">${formatCurrency(payment.amount || 0, payment.currency || 'PLN')}</td>
          <td>${escapeHtml(payment.description || '—')}</td>
          <td>${escapeHtml(payment.proforma_fullnumber || '—')}</td>
          <td>${escapeHtml(payment.manual_status || payment.match_status || '—')}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="5" class="payer-payments-empty">Платежи не найдены</td></tr>';

  elements.payerModalBody.innerHTML = `
    <div class="payer-payments-summary">
      <div class="summary-meta">
        ${payerName ? `Контрагент: ${escapeHtml(payerName)}` : ''}
        ${proformaFullnumber ? ` • Проформа: ${escapeHtml(proformaFullnumber)}` : ''}
        ${filterNote ? ' • Показаны платежи по проформе' : ''}
      </div>
      <div class="summary-stats">
        <span>Платежей: ${(totalCount || payments.length || 0).toLocaleString('ru-RU')}</span>
      </div>
    </div>
    <table class="payer-payments-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Дата</th>
          <th>Сумма</th>
          <th>Описание</th>
          <th>Проформа</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function closeProductPayerPaymentsModal() {
  if (elements.payerModal) {
    elements.payerModal.style.display = 'none';
  }
  document.body.classList.remove('modal-open');
}

function isProductPayerModalOpen() {
  return Boolean(elements.payerModal && elements.payerModal.style.display === 'block');
}

function renderPaymentStatusBadge(status) {
  const normalized = status && paymentStatusLabels[status] ? status : 'unknown';
  const label = paymentStatusLabels[normalized];
  const className = paymentStatusClasses[normalized] || paymentStatusClasses.unknown;
  return `<span class="status-badge ${className}">${escapeHtml(label)}</span>`;
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

function buildStripePaymentLink(sessionId, mode) {
  const prefix = mode === 'test' ? 'test/' : '';
  const url = `https://dashboard.stripe.com/${prefix}payments/${encodeURIComponent(sessionId)}`;
  return `<a class="deal-link" href="${url}" target="_blank" rel="noopener noreferrer">Session ${escapeHtml(sessionId)}</a>`;
}

function renderStripeCustomer(payment) {
  const parts = [];
  if (payment.customerType === 'organization') {
    if (payment.companyName) {
      parts.push(escapeHtml(payment.companyName));
    }
    if (payment.companyTaxId) {
      parts.push(`NIP ${escapeHtml(payment.companyTaxId)}`);
    }
  }
  const contact = payment.customerName || payment.customerEmail;
  if (contact) {
    parts.push(escapeHtml(contact));
  }
  return parts.length ? parts.join('<br>') : '—';
}

function renderStripeFlags(payment) {
  const badges = [];
  const customerTypeLabel = payment.customerType === 'organization' ? 'B2B' : 'B2C';
  badges.push(renderStripeBadge(customerTypeLabel, payment.customerType === 'organization' ? 'status-complete' : 'status-auto'));

  if (payment.expectedVat) {
    badges.push(renderStripeBadge('VAT обязателен', 'status-pending'));
    if (!(payment.taxAmountPln > 0)) {
      badges.push(renderStripeBadge('Нет VAT', 'status-warning'));
    }
    if (payment.addressValidated === false) {
      badges.push(renderStripeBadge('Нет адреса', 'status-error'));
    }
  }

  return badges.length ? badges.join(' ') : '—';
}

function renderStripeBadge(label, className = 'status-auto') {
  return `<span class="status-badge ${className}">${escapeHtml(label)}</span>`;
}

function formatPaymentCount(count) {
  if (!Number.isFinite(count) || count <= 0) return '';
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} платеж`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${count} платежа`;
  return `${count} платежей`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU');
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
