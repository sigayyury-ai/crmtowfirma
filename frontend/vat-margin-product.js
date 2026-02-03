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

// State for payment search and linking
const productPaymentSearchState = {
  searchResults: [],
  isLoading: false,
  currentProductId: null,
  hasSearched: false
};

// State for expense categories
let expenseCategoriesMap = {};

const productPayerPaymentsModalState = {
  context: null,
  payments: [],
  totalPayments: 0
};

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
    exportButton: document.getElementById('product-export-csv'),
    summaryContainer: document.getElementById('product-summary'),
    proformasContainer: document.getElementById('product-proformas'),
    linkedPaymentsContainer: document.getElementById('product-linked-payments'),
    stripePaymentsContainer: document.getElementById('product-stripe-payments'),
    vatMarginTable: document.getElementById('vat-margin-table'),
    vatMarginExportButton: document.getElementById('vat-margin-export'),
    alertBox: document.getElementById('product-alert'),
    payerModal: document.getElementById('product-payer-modal'),
    payerModalTitle: document.getElementById('product-payer-title'),
    payerModalBody: document.getElementById('product-payer-body'),
    payerModalClose: document.getElementById('product-payer-close'),
    createPaymentModal: document.getElementById('product-create-payment-modal'),
    createPaymentClose: document.getElementById('product-create-payment-close'),
    createPaymentCancel: document.getElementById('product-create-payment-cancel-btn'),
    createPaymentSubmit: document.getElementById('product-create-payment-submit-btn')
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

  elements.exportButton?.addEventListener('click', () => {
    exportProductDetailCsv();
  });

  elements.vatMarginExportButton?.addEventListener('click', () => {
    exportVatMarginCsv();
  });

  elements.proformasContainer?.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-payer-action="show-payments"]');
    if (!trigger || !elements.proformasContainer.contains(trigger)) {
      return;
    }
    const payerName = trigger.dataset.payerName || '';
    const proforma = trigger.dataset.proformaFullnumber || '';
    const dealId = trigger.dataset.dealId || '';
    const dealUrl = trigger.dataset.dealUrl || '';
    openProductPayerPaymentsModal({
      payerName: payerName || null,
      proformaFullnumber: proforma || null,
      dealId: dealId || null,
      dealUrl: dealUrl || null
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
    const dealId = trigger.dataset.dealId || '';
    const dealUrl = trigger.dataset.dealUrl || '';
    openProductPayerPaymentsModal({
      payerName: payerName || null,
      proformaFullnumber: proforma || null,
      dealId: dealId || null,
      dealUrl: dealUrl || null
    });
  });

  elements.payerModalBody?.addEventListener('click', handleProductPayerPaymentsBodyClick);

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

  // Create payment from receipt modal handlers
  elements.createPaymentClose?.addEventListener('click', closeCreatePaymentModal);
  elements.createPaymentCancel?.addEventListener('click', closeCreatePaymentModal);
  elements.createPaymentModal?.addEventListener('click', (event) => {
    if (event.target === elements.createPaymentModal) {
      closeCreatePaymentModal();
    }
  });
  elements.createPaymentSubmit?.addEventListener('click', async () => {
    await handleCreatePaymentFromReceipt();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isCreatePaymentModalOpen()) {
      closeCreatePaymentModal();
    }
  });

  // Open create payment modal button (delegated event)
  document.addEventListener('click', (event) => {
    const button = event.target.closest('#product-create-payment-from-receipt-btn');
    if (button) {
      event.preventDefault();
      openCreatePaymentModal().catch(error => {
        console.error('Error opening create payment modal:', error);
        showAlert('error', `Не удалось открыть форму: ${error.message}`);
      });
    }
  });

  elements.stripePaymentsContainer?.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-payer-action="show-stripe-payments"]');
    if (!trigger || !elements.stripePaymentsContainer.contains(trigger)) {
      return;
    }
    const payerName = trigger.dataset.payerName || '';
    const dealId = trigger.dataset.dealId || '';
    openProductStripePaymentsModal({
      payerName: payerName || null,
      dealId: dealId || null
    });
  });
  elements.stripePaymentsContainer?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const trigger = event.target.closest('[data-payer-action="show-stripe-payments"]');
    if (!trigger || !elements.stripePaymentsContainer.contains(trigger)) {
      return;
    }
    event.preventDefault();
    const payerName = trigger.dataset.payerName || '';
    const dealId = trigger.dataset.dealId || '';
    openProductStripePaymentsModal({
      payerName: payerName || null,
      dealId: dealId || null
    });
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

  renderVatMarginTable(productDetail);
}

function exportProductDetailCsv() {
  if (!productDetail) {
    showAlert('info', 'Нет данных для экспорта');
    return;
  }

  const headers = [
    'Продукт',
    'Источник',
    'Контрагент',
    'Дата',
    'Сумма (ориг.)',
    'Сумма (PLN)',
    'Оплачено (PLN)',
    'Статус',
    'Deal ID'
  ];

  const rows = [];

  (productDetail.proformas || []).forEach((item) => {
    rows.push([
      productDetail.productName || '',
      item.fullnumber || '',
      item.buyerName || item.buyerAltName || '',
      formatDate(item.date),
      Number(item.total || 0),
      Number(item.totalPln || 0),
      Number(item.paidPln || 0),
      paymentStatusLabels[item.paymentStatus] || item.paymentStatus || '',
      item.dealId || ''
    ]);
  });

  (productDetail.stripePayments || []).forEach((payment) => {
    const name = payment.customerName || payment.companyName || payment.customerEmail || 'Stripe клиент';
    const identifier = payment.sessionId
      ? `Stripe ${payment.sessionId}`
      : `Stripe ${payment.paymentType || ''}`.trim();
    rows.push([
      productDetail.productName || '',
      identifier,
      name,
      formatDate(payment.createdAt),
      Number(payment.amount || 0),
      Number(payment.amountPln || payment.amount || 0),
      Number(payment.amountPln || payment.amount || 0),
      payment.paymentType || 'Stripe',
      payment.stripe_deal_id || ''
    ]);
  });

  if (!rows.length) {
    showAlert('info', 'Нет данных для экспорта');
    return;
  }

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => {
      const value = cell === undefined || cell === null ? '' : String(cell);
      if (value.includes('"') || value.includes(',') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(','))
    .join('\n');

  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const safeName = (productDetail.productName || 'product')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '');
  anchor.href = url;
  anchor.download = `${safeName}_detail.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function exportVatMarginCsv() {
  if (!productDetail) {
    showAlert('info', 'Нет данных для экспорта');
    return;
  }

  const context = buildVatMarginContext(productDetail);
  if (!context) {
    showAlert('info', 'Недостаточно данных для экспорта VAT-маржи');
    return;
  }

  const headers = [
    'Имя участника',
    'Сумма (PLN)',
    'Расход (PLN)',
    'Маржа (PLN)',
    'VAT %',
    'VAT к оплате (PLN)'
  ];

  const rows = context.rows.map((row) => [
    row.name,
    Number(row.amountPln.toFixed(2)),
    Number(context.expensesPerParticipant.toFixed(2)),
    Number(row.margin.toFixed(2)),
    Number((context.vatRate * 100).toFixed(0)),
    Number(row.vat.toFixed(2))
  ]);

  rows.push([
    'Итого',
    Number(context.totalAmount.toFixed(2)),
    Number(context.totalExpenses.toFixed(2)),
    Number(context.totalMargin.toFixed(2)),
    Number((context.vatRate * 100).toFixed(0)),
    Number(context.totalVat.toFixed(2))
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => {
      const value = cell === undefined || cell === null ? '' : String(cell);
      if (value.includes('"') || value.includes(',') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(','))
    .join('\n');

  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const safeName = (productDetail.productName || 'product')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '');
  anchor.href = url;
  anchor.download = `${safeName}_vat_margin.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function renderSummaryCards(detail) {
  if (!elements.summaryContainer) return;

  const totals = detail.totals || {};
  const expenseTotals = detail.expenseTotals?.currencyTotals
    || calculateExpenseTotals(detail.linkedPayments).currencyTotals;
  
  // Получаем сумму расходов в PLN
  // ВАЖНО: всегда пересчитываем из linkedPayments, чтобы учесть все платежи с актуальными amountPln
  // detail.expenseTotals может содержать устаревшие данные до обновления amount_pln в базе
  const calculatedExpenses = calculateExpenseTotals(detail.linkedPayments || {}).totalPln;
  const expenseTotalsPln = detail.expenseTotals?.totalPln;
  
  // Используем пересчитанное значение, если оно больше (значит есть новые платежи с amount_pln)
  // Или если expenseTotalsPln отсутствует/некорректно
  const totalExpensesPln = (calculatedExpenses > 0 && calculatedExpenses > (expenseTotalsPln || 0)) 
    ? calculatedExpenses 
    : (Number.isFinite(expenseTotalsPln) ? expenseTotalsPln : calculatedExpenses || 0);
  
  // Вычисляем PIT: 9% от разницы между "Оплачено" и "Расходы"
  const paidPln = totals.paidPln || 0;
  const profit = paidPln - totalExpensesPln; // Прибыль до налогов
  const pit = profit > 0 ? profit * 0.09 : 0; // PIT = 9% от прибыли
  
  // Вычисляем НДС: маржа считается как брутто (с НДС), поэтому нужно считать НДС от маржи нетто
  // Формула: маржа_нетто = маржа_брутто / 1.23, НДС = маржа_нетто * 0.23 = маржа_брутто * 0.23 / 1.23
  const margin = paidPln - totalExpensesPln; // Маржа брутто = Оплачено - Расходы
  const marginNetto = margin > 0 ? margin / 1.23 : 0; // Маржа нетто (без НДС)
  const totalVat = marginNetto > 0 ? marginNetto * 0.23 : 0; // НДС = 23% от маржи нетто
  
  // Для месячной сводки используем детальный расчет по месяцам
  const monthlyBreakdown = detail.monthlyBreakdown || [];
  const totalPreviousReports = monthlyBreakdown.reduce((sum, item) => sum + (item.razemBrutto || item.amount || 0), 0);
  const totalPreviousExpenses = monthlyBreakdown.reduce((sum, item) => sum + (item.expenses || item.purchasePrice || 0), 0);
  
  // НДС из месячной сводки (для отображения в таблице)
  const vatFromMonthlyBreakdown = monthlyBreakdown.reduce((sum, item) => sum + (item.vatAmount || 0), 0);
  
  // НДС финальной фактуры (для отображения в таблице)
  const finalInvoiceBrutto = Math.max(0, paidPln - totalPreviousReports);
  const finalInvoiceExpenses = Math.max(0, totalExpensesPln - totalPreviousExpenses);
  const finalInvoiceMargin = finalInvoiceBrutto - finalInvoiceExpenses;
  const finalInvoiceMarginNetto = finalInvoiceMargin > 0 ? finalInvoiceMargin / 1.23 : 0;
  const vatFromFinalInvoice = finalInvoiceMarginNetto > 0 ? finalInvoiceMarginNetto * 0.23 : 0;
  
  // Получаем сумму наличных платежей и количество сделок с наличкой
  const cashTotalPln = detail.cashTotalPln || 0;
  const cashDealsCount = detail.cashDealsCount || 0;
  
  // Рассчитываем наличку плюсом (из проформ)
  const cashPlusPln = (detail.proformas || []).reduce((sum, proforma) => {
    const cashPln = proforma.payments_total_cash_pln || proforma.paymentsTotalCashPln || 0;
    return sum + (Number(cashPln) || 0);
  }, 0);
  
  const summaryItems = [
    {
      label: 'Суммарная выручка (PLN)',
      value: formatCurrency(totals.grossPln || 0, 'PLN')
    },
    {
      label: 'Оплачено (PLN)',
      value: formatCurrency(paidPln, 'PLN')
    },
    {
      label: 'Проформ / Stripe',
      value: `${(detail.proformaCount || 0).toLocaleString('ru-RU')} / ${(detail.stripeTotals?.paymentsCount || 0).toLocaleString('ru-RU')}`
    },
    {
      label: 'Расходы (привязанные)',
      value: formatCurrency(totalExpensesPln, 'PLN')
    },
    {
      label: 'Маржа нетто',
      value: formatCurrency(marginNetto, 'PLN')
    },
    {
      label: 'Наличка',
      value: formatCurrency(cashTotalPln, 'PLN') + (cashDealsCount > 0 ? ` (${cashDealsCount} ${cashDealsCount === 1 ? 'сделка' : cashDealsCount < 5 ? 'сделки' : 'сделок'})` : '')
    },
    {
      label: 'PIT (налог)',
      value: formatCurrency(pit, 'PLN')
    },
    {
      label: 'НДС (налог)',
      value: formatCurrency(totalVat, 'PLN')
    },
    {
      label: 'Реальный заработок',
      value: (() => {
        const realEarnings = paidPln - totalExpensesPln - pit - totalVat;
        const totalCash = cashTotalPln + cashPlusPln;
        const finalEarnings = realEarnings + totalCash;
        if (totalCash > 0) {
          return `${formatCurrency(realEarnings, 'PLN')} + ${formatCurrency(totalCash, 'PLN')} = ${formatCurrency(finalEarnings, 'PLN')}`;
        }
        return formatCurrency(realEarnings, 'PLN');
      })()
    }
  ];

  // Вычисляем процент реальной маржи (от оплаченной суммы)
  const realEarnings = paidPln - totalExpensesPln - pit - totalVat;
  const marginPercent = paidPln > 0 ? ((realEarnings / paidPln) * 100) : 0;
  
  summaryItems.push({
    label: 'Реальная маржа (%)',
    value: `${marginPercent >= 0 ? '+' : ''}${marginPercent.toFixed(2)}%`
  });

  elements.summaryContainer.innerHTML = summaryItems
    .map((card) => {
      // Добавляем tooltip для "Суммарная выручка"
      const tooltip = card.label === 'Суммарная выручка (PLN)' 
        ? ' title="Включает: сумма всех проформ (line_total) + сумма всех Stripe платежей (amountPln), конвертированные в PLN"'
        : '';
      return `
      <div class="summary-card"${tooltip}>
        <span class="summary-label">${escapeHtml(card.label)}</span>
        <span class="summary-value">${escapeHtml(card.value)}</span>
      </div>
    `;
    })
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
                ${item.dealId ? `data-deal-id="${escapeHtml(String(item.dealId))}"` : ''}
                ${item.dealUrl ? `data-deal-url="${escapeHtml(item.dealUrl)}"` : ''}
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

  // Получаем product_id из productDetail или productSlug
  let productId = null;
  if (productDetail && (productDetail.productId || productDetail.id)) {
    productId = productDetail.productId || productDetail.id;
  } else if (productSlug && !isNaN(parseInt(productSlug))) {
    productId = parseInt(productSlug);
  }
  productPaymentSearchState.currentProductId = productId;

  // Формируем HTML с поиском и результатами
  const showCreateButton = productPaymentSearchState.searchResults.length === 0 && !productPaymentSearchState.isLoading;
  const searchPanelHTML = renderPaymentSearchPanel(productId, showCreateButton);
  const linkedPaymentsHTML = incoming.length === 0 && outgoing.length === 0
    ? '<div class="placeholder">Связанных платежей пока нет</div>'
    : '';

  const sections = [];
  if (incoming.length) {
    sections.push(createLinkedPaymentsSection('Входящие платежи', incoming, { showHeader: true }));
  }
  if (outgoing.length) {
    sections.push(createLinkedPaymentsSection('Исходящие платежи', outgoing, { showHeader: false }));
  }

  const searchResultsHTML = renderPaymentSearchResults();

  elements.linkedPaymentsContainer.innerHTML = `
    ${searchPanelHTML}
    ${searchResultsHTML}
    ${linkedPaymentsHTML}
    ${sections.join('')}
  `;

  // Настраиваем обработчики поиска (обработчики устанавливаются в setupPaymentSearchHandlers)
  setupPaymentSearchHandlers(productId);
}

function renderVatMarginTable(detail) {
  if (!detail || !elements.vatMarginTable) {
    return;
  }

  const context = buildVatMarginContext(detail);
  if (!context) {
    elements.vatMarginTable.innerHTML = '<div class="placeholder">Недостаточно данных для расчёта VAT</div>';
    elements.vatMarginExportButton?.setAttribute('disabled', 'disabled');
    return;
  }

  elements.vatMarginExportButton?.removeAttribute('disabled');

  const rows = context.rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td class="numeric">${formatCurrency(row.amountPln, 'PLN')}</td>
        <td class="numeric">${formatCurrency(context.expensesPerParticipant, 'PLN')}</td>
        <td class="numeric">${formatCurrency(row.margin, 'PLN')}</td>
        <td class="numeric">${(context.vatRate * 100).toFixed(0)}%</td>
        <td class="numeric">${formatCurrency(row.vat, 'PLN')}</td>
      </tr>
    `).join('');

  // Получаем месячную сводку из detail
  const monthlyBreakdown = detail.monthlyBreakdown || [];
  
  // Рассчитываем сумму всех предыдущих месячных отчетов для финальной фактуры
  const totalPreviousReports = monthlyBreakdown.reduce((sum, item) => sum + (item.razemBrutto || item.amount || 0), 0);
  const totalPreviousExpenses = monthlyBreakdown.reduce((sum, item) => sum + (item.expenses || item.purchasePrice || 0), 0);
  
  // Финальная фактура: Итого (брутто) = Все оплаченные поступления - Уже поданные в предыдущих месяцах
  const finalInvoiceBrutto = Math.max(0, (detail.totals?.paidPln || 0) - totalPreviousReports);
  
  // Финальная фактура: Наши расходы = Все расходы - Уже поданные расходы в предыдущих месяцах
  const finalInvoiceExpenses = Math.max(0, (context.totalExpenses || 0) - totalPreviousExpenses);
  
  const monthlyBreakdownHtml = monthlyBreakdown.length > 0
    ? `
      <div class="monthly-breakdown" style="margin: 20px 0; padding: 15px; background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px;">
        <h3 style="margin: 0 0 15px 0; font-size: 1.1em; font-weight: 600; color: #333;">Поступления по месяцам (для фактуры маржи)</h3>
        <div style="overflow-x: auto;">
          <table class="detail-table monthly-breakdown-table" style="width: 100%; min-width: 800px; font-size: 0.9em;">
            <thead>
              <tr>
                <th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd; white-space: nowrap;">Месяц</th>
                <th class="numeric" style="text-align: right; padding: 8px; border-bottom: 2px solid #ddd; white-space: nowrap; font-weight: 600;">Итого (брутто)<br><span style="font-weight: normal; font-size: 0.85em; color: #666;">Razem / brutto (PLN)</span></th>
                <th class="numeric" style="text-align: right; padding: 8px; border-bottom: 2px solid #ddd; white-space: nowrap;">Наши расходы<br><span style="font-weight: normal; font-size: 0.85em; color: #666;">Cena zakupu (PLN)</span></th>
                <th class="numeric" style="text-align: right; padding: 8px; border-bottom: 2px solid #ddd; white-space: nowrap;">Чистая маржа<br><span style="font-weight: normal; font-size: 0.85em; color: #666;">Marża netto (PLN)</span></th>
                <th class="numeric" style="text-align: right; padding: 8px; border-bottom: 2px solid #ddd; white-space: nowrap;">Ставка НДС<br><span style="font-weight: normal; font-size: 0.85em; color: #666;">Stawka</span></th>
                <th class="numeric" style="text-align: right; padding: 8px; border-bottom: 2px solid #ddd; white-space: nowrap;">НДС к оплате<br><span style="font-weight: normal; font-size: 0.85em; color: #666;">(PLN)</span></th>
              </tr>
            </thead>
            <tbody>
              ${monthlyBreakdown.map((item) => `
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #eee; white-space: nowrap;">${formatMonthLabel(item.month)}</td>
                  <td class="numeric" style="text-align: right; padding: 8px; border-bottom: 1px solid #eee; font-weight: 600; background: #f0f8ff;">${formatCurrency(item.razemBrutto || item.amount || 0, 'PLN')}</td>
                  <td class="numeric" style="text-align: right; padding: 8px; border-bottom: 1px solid #eee;">${formatCurrency(item.expenses || item.purchasePrice || 0, 'PLN')}</td>
                  <td class="numeric" style="text-align: right; padding: 8px; border-bottom: 1px solid #eee; color: #0066cc; font-weight: 500;">${formatCurrency(item.netMargin || 0, 'PLN')}</td>
                  <td class="numeric" style="text-align: right; padding: 8px; border-bottom: 1px solid #eee;">${item.vatRate ? `${(item.vatRate * 100).toFixed(0)}%` : '—'}</td>
                  <td class="numeric" style="text-align: right; padding: 8px; border-bottom: 1px solid #eee; color: #d9534f; font-weight: 500;">${formatCurrency(item.vatAmount || 0, 'PLN')}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr style="background: #f5f5f5; font-weight: 600;">
                <td style="padding: 10px 8px; border-top: 2px solid #ddd;">Итого</td>
                <td class="numeric" style="text-align: right; padding: 10px 8px; border-top: 2px solid #ddd; background: #e0f0ff;">${formatCurrency(monthlyBreakdown.reduce((sum, item) => sum + (item.razemBrutto || item.amount || 0), 0), 'PLN')}</td>
                <td class="numeric" style="text-align: right; padding: 10px 8px; border-top: 2px solid #ddd;">${formatCurrency(monthlyBreakdown.reduce((sum, item) => sum + (item.expenses || item.purchasePrice || 0), 0), 'PLN')}</td>
                <td class="numeric" style="text-align: right; padding: 10px 8px; border-top: 2px solid #ddd; color: #0066cc;">${formatCurrency(monthlyBreakdown.reduce((sum, item) => sum + (item.netMargin || 0), 0), 'PLN')}</td>
                <td class="numeric" style="text-align: right; padding: 10px 8px; border-top: 2px solid #ddd;">—</td>
                <td class="numeric" style="text-align: right; padding: 10px 8px; border-top: 2px solid #ddd; color: #d9534f;">${formatCurrency(monthlyBreakdown.reduce((sum, item) => sum + (item.vatAmount || 0), 0), 'PLN')}</td>
              </tr>
            </tfoot>
          </table>
          <table class="detail-table monthly-breakdown-table" style="width: 100%; min-width: 800px; font-size: 0.9em; margin-top: 20px;">
            <thead>
              <tr>
                <th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd; white-space: nowrap; background: #e8f4f8;">Финальная фактура</th>
                <th class="numeric" style="text-align: right; padding: 8px; border-bottom: 2px solid #ddd; white-space: nowrap; font-weight: 600; background: #e8f4f8;">Итого (брутто)<br><span style="font-weight: normal; font-size: 0.85em; color: #666;">Razem / brutto (PLN)</span></th>
                <th class="numeric" style="text-align: right; padding: 8px; border-bottom: 2px solid #ddd; white-space: nowrap; background: #e8f4f8;">Наши расходы<br><span style="font-weight: normal; font-size: 0.85em; color: #666;">Cena zakupu (PLN)</span></th>
                <th class="numeric" style="text-align: right; padding: 8px; border-bottom: 2px solid #ddd; white-space: nowrap; background: #e8f4f8;">Чистая маржа<br><span style="font-weight: normal; font-size: 0.85em; color: #666;">Marża netto (PLN)</span></th>
                <th class="numeric" style="text-align: right; padding: 8px; border-bottom: 2px solid #ddd; white-space: nowrap; background: #e8f4f8;">Ставка НДС<br><span style="font-weight: normal; font-size: 0.85em; color: #666;">Stawka</span></th>
                <th class="numeric" style="text-align: right; padding: 8px; border-bottom: 2px solid #ddd; white-space: nowrap; background: #e8f4f8;">НДС к оплате<br><span style="font-weight: normal; font-size: 0.85em; color: #666;">(PLN)</span></th>
              </tr>
            </thead>
            <tbody>
              <tr style="background: #f0f8ff; font-weight: 600;">
                <td style="padding: 10px 8px; border-bottom: 1px solid #ddd;">Данные для корректирующей фактуры</td>
                <td class="numeric" style="text-align: right; padding: 10px 8px; border-bottom: 1px solid #ddd; font-weight: 600; background: #e0f0ff;">${formatCurrency(finalInvoiceBrutto, 'PLN')}</td>
                <td class="numeric" style="text-align: right; padding: 10px 8px; border-bottom: 1px solid #ddd; font-weight: 600;">${formatCurrency(finalInvoiceExpenses, 'PLN')}</td>
                <td class="numeric" style="text-align: right; padding: 10px 8px; border-bottom: 1px solid #ddd; color: #0066cc; font-weight: 600;">${formatCurrency(finalInvoiceBrutto - finalInvoiceExpenses, 'PLN')}</td>
                <td class="numeric" style="text-align: right; padding: 10px 8px; border-bottom: 1px solid #ddd;">23%</td>
                <td class="numeric" style="text-align: right; padding: 10px 8px; border-bottom: 1px solid #ddd; color: #d9534f; font-weight: 600;">${formatCurrency((finalInvoiceBrutto - finalInvoiceExpenses) * 0.23, 'PLN')}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style="margin-top: 10px; padding: 15px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; font-size: 0.85em; color: #856404;">
          <div style="margin-bottom: 10px;">
            <strong>Формулы расчета:</strong> Итого (Razem / brutto) = Наши расходы + Чистая маржа (Marża netto). Расходы рассчитываются как 35% от Итого (брутто). Маржа = Итого - Расходы (65%). НДС рассчитывается как 23% от маржи.
          </div>
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #ffc107;">
            <strong>Расшифровка полей:</strong>
            <ul style="margin: 8px 0 0 0; padding-left: 20px;">
              <li style="margin-bottom: 6px;"><strong>Итого (брутто) / Razem / brutto</strong> — сумма всех реально оплаченных поступлений от клиентов за месяц. Это базовая сумма для расчета фактуры маржи.</li>
              <li style="margin-bottom: 6px;"><strong>Наши расходы</strong> — реальные расходы, связанные с продуктом (35% от Итого брутто). Используются для расчета себестоимости в фактуре маржи.</li>
              <li style="margin-bottom: 6px;"><strong>Чистая маржа / Marża netto</strong> — разница между Итого (брутто) и Нашими расходами (65% от Итого брутто). Это прибыль до уплаты НДС.</li>
              <li style="margin-bottom: 6px;"><strong>НДС к оплате</strong> — налог на добавленную стоимость, рассчитываемый как 23% от чистой маржи. Это сумма НДС, которую необходимо уплатить в налоговую службу.</li>
            </ul>
          </div>
        </div>
      </div>
    `
    : '';

  elements.vatMarginTable.innerHTML = `
    <div class="vat-summary">
      <div class="vat-summary-card">
        <span class="label">Всего расходов</span>
        <span class="value">${formatCurrency(context.totalExpenses, 'PLN')}</span>
      </div>
    </div>
    ${monthlyBreakdownHtml}
  `;
}

function buildVatMarginContext(detail) {
  if (!detail) return null;

  const participants = buildParticipantsList(detail);
  if (!participants.length) {
    return null;
  }

  // ВАЖНО: всегда пересчитываем из linkedPayments, чтобы учесть все платежи с актуальными amountPln
  const calculatedExpenses = calculateExpenseTotals(detail.linkedPayments || {}).totalPln;
  const expenseTotals = detail.expenseTotals?.totalPln;
  const totalExpensesPln = (calculatedExpenses > 0 && calculatedExpenses > (expenseTotals || 0))
    ? calculatedExpenses
    : (Number.isFinite(expenseTotals) ? expenseTotals : calculatedExpenses || 0);
  const expensesPerParticipant = participants.length
    ? Number((totalExpensesPln / participants.length).toFixed(2))
    : 0;

  const vatRate = 0.23;
  const rows = [];
  let totalAmount = 0;
  let totalVat = 0;

  participants.forEach((participant) => {
    const margin = Number((participant.amountPln - expensesPerParticipant).toFixed(2));
    const vat = Number((margin * vatRate).toFixed(2));
    totalAmount += participant.amountPln;
    totalVat += vat;
    rows.push({
      name: participant.name,
      amountPln: participant.amountPln,
      margin,
      vat
    });
  });

  const totalExpenses = Number((expensesPerParticipant * participants.length).toFixed(2));
  const totalMargin = Number((totalAmount - totalExpenses).toFixed(2));

  return {
    rows,
    totalAmount: Number(totalAmount.toFixed(2)),
    totalExpenses,
    totalMargin,
    totalVat: Number(totalVat.toFixed(2)),
    expensesPerParticipant,
    vatRate,
    participantsCount: participants.length
  };
}

function buildParticipantsList(detail) {
  const participants = [];

  (detail.proformas || []).forEach((item) => {
    const amountPln = Number(item.paidPln || item.totalPln || 0);
    participants.push({
      name: item.buyerName || item.buyerAltName || item.fullnumber || '—',
      amountPln
    });
  });

  (detail.stripePayments || []).forEach((payment) => {
    const amountPln = Number(payment.amountPln || 0);
    const name = payment.customerName || payment.companyName || payment.customerEmail || 'Stripe клиент';
    participants.push({
      name,
      amountPln
    });
  });

  return participants.filter((p) => Number.isFinite(p.amountPln) && p.amountPln > 0);
}

function calculateExpenseTotals(linkedPayments) {
  const totals = {
    currencyTotals: {},
    totalPln: 0
  };
  const expenses = linkedPayments?.outgoing || [];

  expenses.forEach((item) => {
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount === 0) return;
    const currency = (item.currency || 'PLN').toUpperCase();
    totals.currencyTotals[currency] = (totals.currencyTotals[currency] || 0) + amount;
    
    // Все платежи при загрузке в базу уже конвертируются в PLN (amount_pln)
    // Суммируем только amount_pln - это единственный метод вывода всех расходов в PLN
    // ВАЖНО: учитываем все платежи с amountPln, включая отрицательные (возвраты уменьшают расходы)
    const amountPln = Number(item.amountPln);
    
    if (Number.isFinite(amountPln) && amountPln !== null && amountPln !== undefined) {
      totals.totalPln += amountPln;
    }
  });

  return totals;
}

function createLinkedPaymentsSection(title, items, options = {}) {
  const showHeader = options.showHeader !== false && Boolean(title);
  const INITIAL_LIMIT = 10;
  const hasMore = items.length > INITIAL_LIMIT;
  const remainingCount = items.length - INITIAL_LIMIT;
  
  // Генерируем все строки сразу, но помечаем те, что должны быть скрыты
  const rows = items
    .map((item, index) => {
      const description = item.description || '—';
      const counterparty = item.payerName || '—';
      const operationDate = item.operationDate ? formatDate(item.operationDate) : '—';
      const linkedAt = item.linkedAt ? formatDate(item.linkedAt) : '—';
      const linkedBy = item.linkedBy || '—';
      const amount = formatCurrency(item.amount || 0, item.currency || 'PLN');
      const source = item.source || '—';
      const isHidden = index >= INITIAL_LIMIT;
      const hiddenStyle = isHidden ? 'style="display: none;"' : '';
      const hiddenAttr = isHidden ? 'data-hidden-row="true"' : '';

      return `
        <tr ${hiddenAttr} ${hiddenStyle}>
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

  const sectionId = `linked-payments-${title.toLowerCase().replace(/\s+/g, '-')}`;
  const buttonId = `show-more-${sectionId}`;

  return `
    <div class="linked-payments-group" data-section-id="${sectionId}">
      ${showHeader ? `<h3>${escapeHtml(title)} <span style="font-weight: normal; font-size: 0.9em; color: #666;">(${items.length})</span></h3>` : ''}
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
      ${hasMore ? `
        <div style="text-align: center; margin-top: 15px;">
          <button id="${buttonId}" class="btn btn-secondary" style="padding: 8px 20px; font-size: 0.9em;">
            Показать еще ${remainingCount} ${remainingCount === 1 ? 'запись' : remainingCount < 5 ? 'записи' : 'записей'}
          </button>
        </div>
      ` : ''}
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

  // Группируем Stripe платежи по сделке (stripe_deal_id)
  // Если у плательщика несколько платежей по одной сделке - объединяем в одну строку
  // Если сделки разные - показываем отдельными строками
  const dealGroups = new Map();

  items.forEach((payment) => {
    const payerName = payment.customerName || payment.companyName || payment.customerEmail || 'Stripe клиент';
    const dealId = payment.stripe_deal_id || null;
    const dealUrl = payment.stripe_deal_url || null;
    
    // Ключ группировки: сделка (если есть) или плательщик (если сделки нет)
    // Если сделки разные - будут разные группы
    const groupKey = dealId 
      ? `deal:${dealId}` 
      : `payer:${payerName.toLowerCase().trim()}`;

    if (!dealGroups.has(groupKey)) {
      dealGroups.set(groupKey, {
        payerName,
        payments: [],
        currencyTotals: {},
        totalPln: 0,
        firstDate: null,
        lastDate: null,
        dealId,
        dealUrl
      });
    }

    const group = dealGroups.get(groupKey);
    group.payments.push(payment);

    const amount = Number(payment.amount || 0);
    const currency = (payment.currency || 'PLN').toUpperCase();
    group.currencyTotals[currency] = (group.currencyTotals[currency] || 0) + amount;

    const amountPln = Number(payment.amountPln || 0);
    group.totalPln += amountPln;

    const paymentDate = payment.createdAt ? new Date(payment.createdAt) : null;
    if (paymentDate && !isNaN(paymentDate.getTime())) {
      if (!group.firstDate || paymentDate < group.firstDate) {
        group.firstDate = paymentDate;
      }
      if (!group.lastDate || paymentDate > group.lastDate) {
        group.lastDate = paymentDate;
      }
    }

    // Обновляем dealId и dealUrl если появились (для группы без сделки)
    if (dealId && !group.dealId) {
      group.dealId = dealId;
    }
    if (dealUrl && !group.dealUrl) {
      group.dealUrl = dealUrl;
    }
  });

  const rows = Array.from(dealGroups.values())
    .map((group) => {
      const entryCurrencyTotals = Object.entries(group.currencyTotals)
        .filter(([, amount]) => Number.isFinite(amount) && amount !== 0)
        .map(([cur, amount]) => formatCurrency(amount, cur))
        .join(' + ') || '—';
      const entryPlnTotal = formatCurrency(group.totalPln, 'PLN');

      const firstDate = group.firstDate ? formatDate(group.firstDate.toISOString()) : null;
      const lastDate = group.lastDate ? formatDate(group.lastDate.toISOString()) : null;
      let dateLabel = firstDate || '—';
      if (firstDate && lastDate && firstDate !== lastDate) {
        dateLabel = `${firstDate} → ${lastDate}`;
      }

      const dealLink = group.dealUrl && group.dealId
        ? `<div class="deal-link-wrapper"><a class="deal-link" href="${escapeHtml(group.dealUrl)}" target="_blank" rel="noopener noreferrer">Deal #${escapeHtml(String(group.dealId))}</a></div>`
        : '';

      const dealCell = dealLink || '—';

      const hasPayments = group.payments.length > 0;
      const payerLabel = escapeHtml(group.payerName);

      const payerCellContent = hasPayments && payerLabel !== '—'
        ? `
            <span
              class="payer-link"
              data-payer-action="show-stripe-payments"
              data-payer-name="${escapeHtml(group.payerName)}"
              ${group.dealId ? `data-deal-id="${escapeHtml(String(group.dealId))}"` : ''}
              role="button"
              tabindex="0"
            >
              ${payerLabel}
            </span>
          `
        : payerLabel;

      return `
        <tr>
          <td>
            <div>${dateLabel}</div>
          </td>
          <td>${payerCellContent}</td>
          <td class="amount">${entryCurrencyTotals}</td>
          <td class="amount">${entryPlnTotal}</td>
          <td>${dealCell}</td>
          <td>
            <span class="status auto">Stripe</span>
          </td>
        </tr>
      `;
    })
    .join('');

  elements.stripePaymentsContainer.innerHTML = `
    <table class="payments-table group-table">
      <thead>
        <tr>
          <th>Дата</th>
          <th>Плательщик</th>
          <th>Сумма</th>
          <th>Сумма (PLN)</th>
          <th>Deal</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function showProductPayerPaymentsModalLoading({ payerName, proforma }) {
  if (elements.payerModalTitle) {
    elements.payerModalTitle.textContent = payerName
      ? `Платежи: ${payerName}`
      : 'Платежи контрагента';
  }

  const metaParts = [];
  if (payerName) {
    metaParts.push(`Контрагент: ${escapeHtml(payerName)}`);
  }
  if (proforma?.fullnumber) {
    metaParts.push(`Проформа: ${escapeHtml(proforma.fullnumber)}`);
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

async function openProductPayerPaymentsModal({ payerName, proformaFullnumber, dealId, dealUrl }) {
  if (!elements.payerModalBody) return;

  const proforma = proformaFullnumber ? { fullnumber: proformaFullnumber, pipedrive_deal_id: dealId, pipedrive_deal_url: dealUrl } : null;
  showProductPayerPaymentsModalLoading({ payerName, proforma });

  const params = new URLSearchParams();
  if (payerName) {
    params.set('payer', payerName.trim().toLowerCase());
  }
  if (proformaFullnumber) {
    params.set('proforma', proformaFullnumber.trim());
  }
  // Добавляем фильтрацию по сделке, если есть
  if (dealId) {
    params.set('dealId', dealId);
  }
  // Добавляем фильтрацию по дате из текущего отчета (если доступна)
  // Для страницы продукта нужно получить даты из URL или из состояния
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('dateFrom')) {
    params.set('dateFrom', urlParams.get('dateFrom'));
  }
  if (urlParams.get('dateTo')) {
    params.set('dateTo', urlParams.get('dateTo'));
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
    proforma,
    payments,
    totalPayments: totalCount,
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
  proforma,
  payments = [],
  totalPayments = 0,
  filterNote = false
}) {
  if (!elements.payerModalBody) return;

  const visiblePayments = Array.isArray(payments) ? payments : [];
  const totalPln = visiblePayments.reduce(
    (sum, payment) => sum + (Number(payment.amount_pln) || 0),
    0
  );

  productPayerPaymentsModalState.context = { payerName, proforma };
  productPayerPaymentsModalState.payments = visiblePayments.slice();
  productPayerPaymentsModalState.totalPayments = totalPayments;

  if (elements.payerModalTitle) {
    elements.payerModalTitle.textContent = payerName
      ? `Платежи: ${payerName}`
      : 'Все платежи';
  }

  const metaParts = [];
  if (payerName) {
    metaParts.push(`Контрагент: ${escapeHtml(payerName)}`);
  }
  if (proforma?.fullnumber) {
    metaParts.push(`Проформа: ${escapeHtml(proforma.fullnumber)}`);
  }
  if (proforma?.pipedrive_deal_id && proforma?.pipedrive_deal_url) {
    const dealUrl = escapeHtml(proforma.pipedrive_deal_url);
    metaParts.push(
      `<a href="${dealUrl}" target="_blank" rel="noopener noreferrer">Deal #${escapeHtml(String(proforma.pipedrive_deal_id))}</a>`
    );
  }
  if (filterNote) {
    metaParts.push('Показаны платежи по проформе');
  }

  const paymentsCountLabel = totalPayments && payerName && visiblePayments.length !== totalPayments
    ? `${visiblePayments.length} из ${totalPayments}`
    : `${visiblePayments.length}`;

  // Функция для форматирования ID платежа
  // Используем ID из базы данных (как для проформ), а не ID сессии Stripe
  const formatPaymentId = (payment) => {
    if (!payment?.id) return '—';
    
    // Приоритет: используем stripe_payment_id (реальный ID из stripe_payments), если есть
    // Иначе используем обычный id (может быть числовым для банковских платежей или UUID для Stripe)
    const displayId = payment.stripe_payment_id || payment.id;
    const idStr = String(displayId);
    
    // Если это числовой ID (для банковских платежей) - показываем как есть
    if (typeof displayId === 'number' || /^\d+$/.test(idStr)) {
      return escapeHtml(String(displayId));
    }
    
    // Если это UUID (для Stripe платежей из stripe_payments) - показываем короткую версию
    if (idStr.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      const shortId = idStr.substring(0, 8) + '...';
      return `<span title="${escapeHtml(idStr)}">${escapeHtml(shortId)}</span>`;
    }
    
    // Если ID начинается с stripe_ (синтетический ID из отчета) - показываем короткую версию
    if (idStr.startsWith('stripe_')) {
      const shortId = idStr.length > 30 ? idStr.substring(0, 30) + '...' : idStr;
      return `<span title="${escapeHtml(idStr)}">${escapeHtml(shortId)}</span>`;
    }
    
    // Для остальных случаев показываем ID как есть
    return escapeHtml(idStr);
  };
  
  // Функция для форматирования описания платежа
  const formatPaymentDescription = (payment) => {
    if (!payment) return '—';
    
    const parts = [];
    
    // Для Stripe платежей добавляем информацию о статусе и ID сессии
    if (payment.source === 'stripe' || payment.source === 'stripe_event') {
      // Добавляем ID сессии Stripe в описание
      if (payment.stripe_session_id) {
        const sessionId = payment.stripe_session_id;
        const shortSessionId = sessionId.length > 30 ? sessionId.substring(0, 30) + '...' : sessionId;
        parts.push(`<span style="color: #666; font-size: 0.9em;">Stripe Session: <code style="background: #f5f5f5; padding: 2px 4px; border-radius: 3px;">${escapeHtml(shortSessionId)}</code></span>`);
      }
      
      // Добавляем статус платежа
      if (payment.stripe_payment_status) {
        const statusLabels = {
          'paid': '✅ Оплачено',
          'pending': '⏳ В обработке',
          'unpaid': '❌ Не оплачено',
          'failed': '❌ Не удалось',
          'canceled': '❌ Отменено'
        };
        const statusLabel = statusLabels[payment.stripe_payment_status] || payment.stripe_payment_status;
        parts.push(statusLabel);
      }
      
      // Добавляем информацию о продукте, если есть
      if (payment.stripe_product_name) {
        parts.push(`Продукт: ${escapeHtml(payment.stripe_product_name)}`);
      }
      
      // Добавляем ссылку на Stripe dashboard, если есть session_id
      if (payment.stripe_session_id) {
        const stripeUrl = `https://dashboard.stripe.com/payments/${payment.stripe_session_id}`;
        parts.push(`<a href="${stripeUrl}" target="_blank" rel="noopener noreferrer" style="color: #635bff; text-decoration: none;">Stripe Dashboard →</a>`);
      }
    }
    
    // Добавляем обычное описание, если есть
    if (payment.description && !payment.description.includes('Stripe')) {
      parts.push(escapeHtml(payment.description));
    }
    
    return parts.length > 0 ? parts.join('<br>') : '—';
  };
  
  const rows = visiblePayments.length
    ? visiblePayments
      .map((payment) => `
        <tr>
          <td>${formatPaymentId(payment)}</td>
          <td>${escapeHtml(formatDate(payment.date) || '—')}</td>
          <td>${formatCurrency(payment.amount || 0, payment.currency || 'PLN')}</td>
          <td>${Number.isFinite(Number(payment.amount_pln)) ? formatCurrency(Number(payment.amount_pln), 'PLN') : '—'}</td>
          <td>${formatPaymentDescription(payment)}</td>
          <td>${escapeHtml(payment.status?.label || payment.stripe_payment_status || payment.manual_status || payment.match_status || '—')}</td>
          <td class="actions-col">
            <button
              type="button"
              class="payer-payment-action"
              data-payer-payment-action="delete"
              data-payment-id="${escapeHtml(String(payment.id || ''))}"
              title="Удалить платёж и отвязать от проформы"
            >
              🗑
            </button>
          </td>
        </tr>
      `)
      .join('')
    : '<tr><td colspan="7" class="payer-payments-empty">Нет платежей для выбранного плательщика</td></tr>';

  elements.payerModalBody.innerHTML = `
    <div class="payer-payments-summary">
      ${metaParts.length ? `<div class="summary-meta">${metaParts.join(' • ')}</div>` : ''}
      <div class="summary-stats">
        <span>Платежей: ${paymentsCountLabel}</span>
        <span>Сумма (PLN): ${formatCurrency(totalPln, 'PLN')}</span>
      </div>
    </div>
    <table class="payer-payments-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Дата</th>
          <th>Сумма</th>
          <th>Сумма (PLN)</th>
          <th>Описание</th>
          <th>Статус</th>
          <th class="actions-col">Действия</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

function handleProductPayerPaymentsBodyClick(event) {
  const actionButton = event.target.closest('[data-payer-payment-action]');
  if (!actionButton || !elements.payerModalBody?.contains(actionButton)) {
    return;
  }

  event.preventDefault();

  const { payerPaymentAction: action, paymentId } = actionButton.dataset;
  if (!action || !paymentId) {
    return;
  }

  if (action === 'delete') {
    deleteProductPayerPayment(paymentId, actionButton);
  }
}

async function deleteProductPayerPayment(paymentId, triggerButton) {
  const idLabel = String(paymentId);
  if (!idLabel) return;

  const { payerName, proforma } = productPayerPaymentsModalState.context || {};
  const confirmationMessage = [
    `Удалить платёж ${idLabel}?`,
    payerName ? `Плательщик: ${payerName}` : null,
    proforma?.fullnumber ? `Проформа: ${proforma.fullnumber}` : null,
    '',
    'Привязка к проформе будет удалена.'
  ]
    .filter(Boolean)
    .join('\n');

  if (!window.confirm(confirmationMessage)) {
    return;
  }

  if (triggerButton) {
    triggerButton.disabled = true;
  }

  try {
    showAlert('info', `Удаляю платёж ${idLabel}...`);
    const result = await apiCall(`/vat-margin/payments/${encodeURIComponent(idLabel)}`, 'DELETE');
    if (!result?.success) {
      throw new Error(result?.error || 'Не удалось удалить платёж');
    }
    applyProductPayerPaymentRemoval(idLabel);
    showAlert('success', `Платёж ${idLabel} удалён`);
  } catch (error) {
    console.error('Failed to delete payment from modal', error);
    showAlert('error', `Не удалось удалить платёж ${idLabel}: ${error.message}`);
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
    }
  }
}

function applyProductPayerPaymentRemoval(paymentId) {
  const idKey = String(paymentId);
  if (!productPayerPaymentsModalState.context) {
    return;
  }

  productPayerPaymentsModalState.payments = productPayerPaymentsModalState.payments
    .filter((payment) => String(payment.id) !== idKey);

  productPayerPaymentsModalState.totalPayments = Math.max(
    productPayerPaymentsModalState.totalPayments - 1,
    productPayerPaymentsModalState.payments.length
  );

  const { context } = productPayerPaymentsModalState;
  renderProductPayerPaymentsModal({
    ...context,
    payments: productPayerPaymentsModalState.payments,
    totalPayments: productPayerPaymentsModalState.totalPayments
  });

  // Перезагружаем данные продукта для обновления таблицы проформ
  loadProductDetail().catch(() => {});
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

async function openProductStripePaymentsModal({ payerName, dealId }) {
  if (!elements.payerModalBody || !productDetail) return;

  const stripePayments = Array.isArray(productDetail.stripePayments) ? productDetail.stripePayments : [];
  
  // Фильтруем по плательщику и сделке (если указана)
  let filteredPayments = stripePayments;
  
  if (payerName) {
    filteredPayments = filteredPayments.filter((payment) => {
      const paymentPayerName = payment.customerName || payment.companyName || payment.customerEmail || '';
      return paymentPayerName.toLowerCase().trim() === payerName.toLowerCase().trim();
    });
  }
  
  if (dealId) {
    filteredPayments = filteredPayments.filter((payment) => {
      return payment.stripe_deal_id && String(payment.stripe_deal_id) === String(dealId);
    });
  }

  if (!filteredPayments.length) {
    showProductPayerPaymentsError('Stripe платежи не найдены');
    return;
  }

  // Находим информацию о сделке для отображения
  const firstPayment = filteredPayments[0];
  const dealUrl = firstPayment?.stripe_deal_url || null;
  const proforma = dealId && dealUrl 
    ? { fullnumber: null, pipedrive_deal_id: dealId, pipedrive_deal_url: dealUrl }
    : null;
    
  showProductPayerPaymentsModalLoading({ payerName, proforma });

  // Преобразуем Stripe платежи в формат для модального окна
  const payments = filteredPayments.map((payment) => ({
    id: payment.sessionId || payment.id || null,
    date: payment.createdAt || null,
    amount: payment.amount || 0,
    amount_pln: payment.amountPln || 0,
    currency: payment.currency || 'PLN',
    description: `Stripe ${payment.paymentType || 'платёж'}`,
    proforma_fullnumber: null,
    status: { label: 'Stripe' },
    manual_status: null,
    match_status: null
  }));

  renderProductPayerPaymentsModal({
    payerName,
    proforma,
    payments,
    totalPayments: payments.length,
    filterNote: false
  });
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

// Create payment from receipt modal functions
async function openCreatePaymentModal() {
  if (!elements.createPaymentModal) return;
  
  // Set default date to today
  const dateInput = document.getElementById('product-payment-date');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
  }
  
  // Clear form
  const fileInput = document.getElementById('product-receipt-file');
  const amountInput = document.getElementById('product-payment-amount');
  const descriptionInput = document.getElementById('product-payment-description');
  const directionSelect = document.getElementById('product-payment-direction');
  const categorySelect = document.getElementById('product-payment-expense-category');
  const categoryWrapper = document.getElementById('product-payment-expense-category-wrapper');
  const statusDiv = document.getElementById('product-create-payment-status');
  const filesPreview = document.getElementById('product-receipt-files-preview');
  
  if (fileInput) fileInput.value = '';
  if (amountInput) amountInput.value = '';
  if (descriptionInput) descriptionInput.value = '';
  if (directionSelect) directionSelect.value = 'out';
  if (categorySelect) categorySelect.value = '';
  if (statusDiv) statusDiv.innerHTML = '';
  if (filesPreview) filesPreview.innerHTML = '';
  
  // Load expense categories
  await loadExpenseCategoriesForModal();
  
  // Setup direction change handler to show/hide category field
  if (directionSelect && categoryWrapper) {
    const updateCategoryVisibility = () => {
      categoryWrapper.style.display = directionSelect.value === 'out' ? 'block' : 'none';
      if (directionSelect.value !== 'out' && categorySelect) {
        categorySelect.value = '';
      }
    };
    
    // Remove old handlers
    directionSelect.onchange = null;
    directionSelect.addEventListener('change', updateCategoryVisibility);
    updateCategoryVisibility(); // Initial state
  }

  // Setup file input change handler to show preview
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      const filesPreview = document.getElementById('product-receipt-files-preview');
      if (filesPreview) {
        if (files.length === 0) {
          filesPreview.innerHTML = '';
        } else {
          const fileList = files.map((file, index) => {
            const size = (file.size / 1024 / 1024).toFixed(2);
            return `${index + 1}. ${escapeHtml(file.name)} (${size} MB)`;
          }).join('<br>');
          filesPreview.innerHTML = `<div style="color: #666; margin-top: 5px;">Выбрано файлов: ${files.length}<br>${fileList}</div>`;
        }
      }
    });
  }
  
  elements.createPaymentModal.style.display = 'block';
  document.body.classList.add('modal-open');
}

// Load expense categories for modal
async function loadExpenseCategoriesForModal() {
  const categorySelect = document.getElementById('product-payment-expense-category');
  if (!categorySelect) return;

  // If already loaded, just populate select
  if (Object.keys(expenseCategoriesMap).length > 0) {
    populateExpenseCategorySelect(categorySelect);
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/pnl/expense-categories`);
    const result = await response.json();

    if (result.success && result.data) {
      result.data.forEach(cat => {
        expenseCategoriesMap[cat.id] = cat;
      });
      populateExpenseCategorySelect(categorySelect);
    }
  } catch (error) {
    console.error('Failed to load expense categories:', error);
  }
}

// Populate expense category select
function populateExpenseCategorySelect(selectElement) {
  if (!selectElement) return;
  
  const categories = Object.values(expenseCategoriesMap).sort((a, b) => {
    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  selectElement.innerHTML = '<option value="">Выберите категорию...</option>' +
    categories.map(cat => 
      `<option value="${cat.id}">${escapeHtml(cat.name || 'Без названия')}</option>`
    ).join('');
}

function closeCreatePaymentModal() {
  if (elements.createPaymentModal) {
    elements.createPaymentModal.style.display = 'none';
  }
  document.body.classList.remove('modal-open');
}

function isCreatePaymentModalOpen() {
  return Boolean(elements.createPaymentModal && elements.createPaymentModal.style.display === 'block');
}

async function handleCreatePaymentFromReceipt() {
  const fileInput = document.getElementById('product-receipt-file');
  const amountInput = document.getElementById('product-payment-amount');
  const currencySelect = document.getElementById('product-payment-currency');
  const dateInput = document.getElementById('product-payment-date');
  const descriptionInput = document.getElementById('product-payment-description');
  const directionSelect = document.getElementById('product-payment-direction');
  const statusDiv = document.getElementById('product-create-payment-status');
  const submitButton = elements.createPaymentSubmit;

  if (!fileInput || !amountInput || !dateInput || !currencySelect || !directionSelect) {
    showAlert('error', 'Не найдены поля формы');
    return;
  }

  const files = Array.from(fileInput.files || []);
  const amount = parseFloat(amountInput.value);
  const currency = currencySelect.value || 'PLN';
  const operationDate = dateInput.value;
  const description = descriptionInput?.value?.trim() || '';
  const direction = directionSelect.value || 'out';

  // Validation
  if (!files || files.length === 0) {
    if (statusDiv) {
      statusDiv.innerHTML = '<div style="color: #d9534f; padding: 10px; background: #f8d7da; border-radius: 4px;">Пожалуйста, выберите файл(ы) чека</div>';
    }
    return;
  }

  if (!amount || amount <= 0) {
    if (statusDiv) {
      statusDiv.innerHTML = '<div style="color: #d9534f; padding: 10px; background: #f8d7da; border-radius: 4px;">Пожалуйста, укажите корректную сумму</div>';
    }
    return;
  }

  if (!operationDate) {
    if (statusDiv) {
      statusDiv.innerHTML = '<div style="color: #d9534f; padding: 10px; background: #f8d7da; border-radius: 4px;">Пожалуйста, укажите дату оплаты</div>';
    }
    return;
  }

  try {
    setButtonLoading(submitButton, true, `Загружаю чек${files.length > 1 ? 'и' : ''} (${files.length})...`);
    if (statusDiv) statusDiv.innerHTML = '';

    // Step 1: Upload all receipt files
    const receiptIds = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setButtonLoading(submitButton, true, `Загружаю чек ${i + 1} из ${files.length}...`);
      
      const formData = new FormData();
      formData.append('file', file);

      const uploadResponse = await fetch(`${API_BASE}/receipts/upload`, {
        method: 'POST',
        body: formData
      });

      const uploadResult = await uploadResponse.json();
      
      if (!uploadResponse.ok || !uploadResult.success) {
        throw new Error(uploadResult?.error || `Не удалось загрузить чек ${i + 1}: ${file.name}`);
      }

      const receiptId = uploadResult.data?.receiptId;
      if (!receiptId) {
        throw new Error(`Не получен ID чека после загрузки ${i + 1}: ${file.name}`);
      }

      receiptIds.push(receiptId);
    }

    // Use the first receipt ID for payment creation (main receipt)
    const receiptId = receiptIds[0];
    if (!receiptId) {
      throw new Error('Не получен ID чека после загрузки');
    }

    // Step 2: Get product ID - try multiple sources
    let productId = productPaymentSearchState.currentProductId;
    if (!productId && productDetail) {
      productId = productDetail.productId || productDetail.id;
    }
    if (!productId && productSlug && !isNaN(parseInt(productSlug))) {
      productId = parseInt(productSlug);
    }
    // Try to extract from URL if still not found
    if (!productId) {
      const urlMatch = window.location.pathname.match(/\/vat-margin\/products\/([^\/]+)/);
      if (urlMatch) {
        const slugFromUrl = urlMatch[1];
        if (slugFromUrl.startsWith('id-')) {
          const idFromUrl = parseInt(slugFromUrl.replace('id-', ''));
          if (!isNaN(idFromUrl)) {
            productId = idFromUrl;
          }
        }
      }
    }

    console.log('Creating payment from receipt', {
      productId,
      productSlug,
      productDetailId: productDetail?.productId || productDetail?.id,
      currentProductId: productPaymentSearchState.currentProductId,
      urlPath: window.location.pathname
    });

    // Warn if productId is still not found
    if (!productId) {
      console.warn('⚠️  Product ID not found! Payment will be created without product link.');
      if (statusDiv) {
        statusDiv.innerHTML = '<div style="color: #856404; padding: 10px; background: #fff3cd; border-radius: 4px; margin-bottom: 10px;">⚠️ Внимание: Продукт не определен. Платеж будет создан без связи с продуктом. Вы сможете связать его позже.</div>';
      }
    }

    // Step 3: Get expense category if direction is 'out'
    const categorySelect = document.getElementById('product-payment-expense-category');
    const expenseCategoryId = (direction === 'out' && categorySelect?.value) 
      ? parseInt(categorySelect.value, 10) 
      : null;

    // Step 4: Create payment from receipt (using first receipt as primary)
    setButtonLoading(submitButton, true, 'Создаю платеж...');

    const createResponse = await fetch(`${API_BASE}/receipts/${encodeURIComponent(receiptId)}/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        currency,
        operationDate,
        description,
        direction,
        productId,
        expenseCategoryId
      })
    });

    const createResult = await createResponse.json();

    if (!createResponse.ok || !createResult.success) {
      throw new Error(createResult?.error || 'Не удалось создать платеж');
    }

    const paymentId = createResult.data.id;

    // Step 5: Link additional receipts to the payment (if any)
    if (receiptIds.length > 1) {
      setButtonLoading(submitButton, true, `Связываю дополнительные чеки (${receiptIds.length - 1})...`);
      
      for (let i = 1; i < receiptIds.length; i++) {
        const additionalReceiptId = receiptIds[i];
        try {
          // Link additional receipt to the same payment
          const linkResponse = await fetch(`${API_BASE}/receipts/${encodeURIComponent(additionalReceiptId)}/link-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              paymentId: paymentId.toString()
            })
          });

          const linkResult = await linkResponse.json();
          if (!linkResponse.ok || !linkResult.success) {
            console.warn(`Не удалось связать чек ${i + 1} с платежом:`, linkResult?.error);
          }
        } catch (linkError) {
          console.warn(`Ошибка при связывании чека ${i + 1} с платежом:`, linkError);
        }
      }
    }

    const receiptCountText = receiptIds.length > 1 ? ` (${receiptIds.length} файл${receiptIds.length > 4 ? 'ов' : receiptIds.length > 1 ? 'а' : ''})` : '';
    showAlert('success', `Платеж #${paymentId} успешно создан из чека${receiptCountText}`);
    closeCreatePaymentModal();

    // Reload product detail to show new payment
    // Add delay to ensure database is updated and indexes are refreshed
    console.log('Payment created, reloading product detail', {
      paymentId,
      productId
    });
    
    // Wait a bit longer for database to process the link
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await loadProductDetail();
    
    // Check if payment appears in linked payments after reload
    setTimeout(() => {
      if (productDetail?.linkedPayments) {
        const foundPayment = 
          (productDetail.linkedPayments.incoming || []).find(p => p.paymentId === paymentId) ||
          (productDetail.linkedPayments.outgoing || []).find(p => p.paymentId === paymentId);
        
        if (!foundPayment) {
          console.warn('Payment not found in linked payments after reload', {
            paymentId,
            productId,
            incomingCount: (productDetail.linkedPayments.incoming || []).length,
            outgoingCount: (productDetail.linkedPayments.outgoing || []).length
          });
        } else {
          console.log('Payment successfully appears in linked payments', {
            paymentId,
            productId,
            direction: foundPayment.direction
          });
        }
      }
    }, 500);

  } catch (error) {
    console.error('Error creating payment from receipt:', error);
    if (statusDiv) {
      statusDiv.innerHTML = `<div style="color: #d9534f; padding: 10px; background: #f8d7da; border-radius: 4px;">Ошибка: ${escapeHtml(error.message)}</div>`;
    }
    showAlert('error', `Не удалось создать платеж: ${error.message}`);
  } finally {
    setButtonLoading(submitButton, false, '💾 Создать платеж');
  }
}

// Render payment search panel
function renderPaymentSearchPanel(productId, showCreateButton = false) {
  if (!productId) return '';
  
  return `
    <div class="payment-search-panel" style="margin-bottom: 30px; padding: 20px; background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px;">
      <h3 style="margin: 0 0 15px 0; font-size: 1.1em; font-weight: 600;">Поиск платежей для связывания</h3>
      <div style="display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 250px;">
          <label for="product-payment-search-input" style="display: block; margin-bottom: 5px; font-weight: 500;">Поиск по названию или сумме</label>
          <input
            type="text"
            id="product-payment-search-input"
            class="form-control"
            placeholder="Введите название, сумму или ID платежа..."
            style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.95em;"
          />
        </div>
        <button
          id="product-payment-search-btn"
          class="btn btn-primary"
          style="padding: 8px 20px; height: fit-content;"
        >
          🔍 Найти
        </button>
        <button
          id="product-create-payment-from-receipt-btn"
          class="btn btn-secondary"
          style="padding: 8px 20px; height: fit-content; ${showCreateButton ? '' : 'display: none;'}"
        >
          📄 Создать платеж из чека
        </button>
      </div>
      <div class="payment-search-hint" style="margin-top: 10px; font-size: 0.85em; color: #666;">
        Поиск работает по описанию платежа, контрагенту, сумме и ID. ${showCreateButton ? 'Если платежа нет в базе (оплата другой картой), можно создать его на основе чека.' : ''}
      </div>
    </div>
  `;
}

// Render payment search results
function renderPaymentSearchResults() {
  const results = productPaymentSearchState.searchResults || [];
  const isLoading = productPaymentSearchState.isLoading;

  if (isLoading) {
    return `
      <div class="payment-search-results" style="margin-bottom: 30px;">
        <div style="text-align: center; padding: 40px;">
          <div class="loading"></div>
          <div style="margin-top: 10px; color: #666;">Поиск платежей...</div>
        </div>
      </div>
    `;
  }

  if (results.length === 0) {
    // Если поиск выполнен, но результатов нет - показываем сообщение
    const hasSearched = productPaymentSearchState.hasSearched || false;
    if (!hasSearched) {
      return `
        <div class="payment-search-results" style="margin-bottom: 30px; display: none;">
          <div style="padding: 20px; background: #fff; border: 1px solid #e0e0e0; border-radius: 6px;">
            <div style="text-align: center; color: #666;">Начните поиск для отображения результатов</div>
          </div>
        </div>
      `;
    }
    
    // Поиск выполнен, но результатов нет - показываем сообщение
    return `
      <div class="payment-search-results" style="margin-bottom: 30px;">
        <div style="padding: 20px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px;">
          <div style="text-align: center; color: #856404; font-weight: 500;">
            Платежи не найдены. Если оплата была произведена другой картой, создайте платеж из чека.
          </div>
        </div>
      </div>
    `;
  }

  const rows = results.map((payment) => {
    const isLinkedToCurrentProduct = payment.linked_product_id === productPaymentSearchState.currentProductId;
    const isLinkedToOtherProduct = payment.linked_product_id && payment.linked_product_id !== productPaymentSearchState.currentProductId;
    const date = payment.operation_date || payment.date || '—';
    const formattedDate = date !== '—' ? formatDate(date) : '—';
    const amount = formatCurrency(payment.amount || 0, payment.currency || 'PLN');
    const description = payment.description || '—';
    const payerName = payment.payer_name || payment.payer || '—';
    const direction = payment.direction === 'in' ? '💰 Доход' : '💸 Расход';
    const directionClass = payment.direction === 'in' ? 'status-complete' : 'status-error';

    let actionCell = '';
    if (isLinkedToCurrentProduct) {
      actionCell = '<span style="color: #10b981; font-weight: 600;">✓ Связан</span>';
    } else {
      // Для всех остальных случаев (не связан или связан с другим продуктом) показываем кнопку "Связать"
      // Она автоматически отвяжет от предыдущего продукта при необходимости
      const buttonText = isLinkedToOtherProduct ? '🔄 Пересвязать' : '🔗 Связать';
      const buttonStyle = isLinkedToOtherProduct 
        ? 'padding: 4px 12px; font-size: 0.85em; background: #f59e0b; color: white;'
        : 'padding: 4px 12px; font-size: 0.85em;';
      
      actionCell = `
        <button 
          class="btn btn-secondary btn-sm" 
          data-action="link-payment" 
          data-payment-id="${escapeHtml(String(payment.id))}"
          style="${buttonStyle}"
          ${isLinkedToOtherProduct ? `title="Отвязать от продукта ${payment.linked_product_id} и связать с текущим"` : ''}
        >
          ${buttonText}
        </button>
      `;
    }

    return `
      <tr ${isLinkedToCurrentProduct ? 'style="background: #e8f5e9;"' : isLinkedToOtherProduct ? 'style="background: #fff7ed;"' : ''}>
        <td>${escapeHtml(formattedDate)}</td>
        <td>${escapeHtml(description)}</td>
        <td>${escapeHtml(payerName)}</td>
        <td class="numeric">${escapeHtml(amount)}</td>
        <td><span class="status-badge ${directionClass}">${escapeHtml(direction)}</span></td>
        <td style="text-align: center;">
          ${actionCell}
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="payment-search-results" style="margin-bottom: 30px;">
      <div style="padding: 20px; background: #fff; border: 1px solid #e0e0e0; border-radius: 6px;">
        <h4 style="margin: 0 0 15px 0; font-size: 1em; font-weight: 600;">
          Результаты поиска: ${results.length} ${results.length === 1 ? 'платеж' : results.length < 5 ? 'платежа' : 'платежей'}
        </h4>
        <div style="overflow-x: auto;">
          <table class="data-table" style="width: 100%;">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Описание</th>
                <th>Контрагент</th>
                <th class="numeric">Сумма</th>
                <th>Направление</th>
                <th style="text-align: center;">Действие</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// Setup payment search handlers
function setupPaymentSearchHandlers(productId) {
  const searchInput = document.getElementById('product-payment-search-input');
  const searchButton = document.getElementById('product-payment-search-btn');

  if (!searchInput || !searchButton) return;

  // Удаляем старые обработчики, если они есть
  const newSearchButton = searchButton.cloneNode(true);
  searchButton.parentNode.replaceChild(newSearchButton, searchButton);
  const newSearchInput = searchInput.cloneNode(true);
  searchInput.parentNode.replaceChild(newSearchInput, searchInput);

  const performSearch = async () => {
    const query = newSearchInput.value.trim();
    if (!query) {
      showAlert('info', 'Введите запрос для поиска');
      return;
    }

    await searchPayments(query, productId);
  };

  newSearchButton.addEventListener('click', performSearch);
  newSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performSearch();
    }
  });

  // Используем делегирование событий для всех действий в контейнере
  if (!elements.linkedPaymentsContainer.dataset.handlersSetup) {
    elements.linkedPaymentsContainer.addEventListener('click', async (event) => {
      // Обработка кнопок "Показать больше"
      const showMoreButton = event.target.closest('[id^="show-more-linked-payments-"]');
      if (showMoreButton) {
        const sectionId = showMoreButton.id.replace('show-more-', '');
        const section = elements.linkedPaymentsContainer.querySelector(`[data-section-id="${sectionId}"]`);
        if (section) {
          const hiddenRows = section.querySelectorAll('tbody tr[data-hidden-row="true"]');
          hiddenRows.forEach((row) => {
            row.style.display = '';
            row.removeAttribute('data-hidden-row');
          });
          showMoreButton.style.display = 'none';
        }
        return;
      }

      // Обработка кнопок связывания платежей (работает для всех случаев, включая пересвязывание)
      const linkButton = event.target.closest('[data-action="link-payment"]');
      if (linkButton) {
        event.preventDefault();
        // Получаем актуальный productId из состояния или productDetail
        let currentProductId = productPaymentSearchState.currentProductId;
        if (!currentProductId && productDetail) {
          currentProductId = productDetail.productId || productDetail.id;
        }
        if (!currentProductId && productSlug && !isNaN(parseInt(productSlug))) {
          currentProductId = parseInt(productSlug);
        }
        
        const paymentId = linkButton.dataset.paymentId;
        if (paymentId && currentProductId) {
          // Проверяем, связан ли платеж с другим продуктом
          const payment = productPaymentSearchState.searchResults.find(p => String(p.id) === String(paymentId));
          const isLinkedToOther = payment && payment.linked_product_id && payment.linked_product_id !== currentProductId;
          
          if (isLinkedToOther) {
            const confirmMessage = `Платеж #${paymentId} уже связан с другим продуктом (ID: ${payment.linked_product_id}). Отвязать от него и связать с текущим продуктом (ID: ${currentProductId})?`;
            if (!confirm(confirmMessage)) {
              return;
            }
          }
          
          await linkPaymentToProduct(paymentId, currentProductId, linkButton);
        } else {
          showAlert('error', 'Не удалось определить идентификатор продукта');
        }
        return;
      }
    });
    elements.linkedPaymentsContainer.dataset.handlersSetup = 'true';
  }
}

// Search payments by query
async function searchPayments(query, productId) {
  if (!elements.linkedPaymentsContainer) return;

  productPaymentSearchState.isLoading = true;
  productPaymentSearchState.hasSearched = true;
  
  // Обновляем только отображение результатов поиска, сохраняя панель поиска
  const resultsContainer = elements.linkedPaymentsContainer.querySelector('.payment-search-results');
  if (resultsContainer) {
    resultsContainer.style.display = 'block';
    resultsContainer.outerHTML = renderPaymentSearchResults();
  } else {
    // Если контейнера результатов еще нет, создаем его после панели поиска
    const searchPanel = elements.linkedPaymentsContainer.querySelector('.payment-search-panel');
    if (searchPanel) {
      searchPanel.insertAdjacentHTML('afterend', renderPaymentSearchResults());
    }
  }
  
  // Скрываем кнопку "Создать платеж" во время поиска
  const createButton = elements.linkedPaymentsContainer.querySelector('#product-create-payment-from-receipt-btn');
  if (createButton) {
    createButton.style.display = 'none';
  }

  try {
    // Поиск платежей через API (без фильтра по направлению, чтобы найти все)
    const response = await apiCall(`/vat-margin/payments?limit=500`);
    
    if (!response?.success) {
      throw new Error(response?.error || 'Не удалось найти платежи');
    }

    const allPayments = response.data || response.payments || [];
    
    // Фильтруем платежи по запросу (похоже на filterExpenses)
    const searchQueryLower = query.toLowerCase().trim();
    const searchQueryNum = parseFloat(searchQueryLower.replace(/[^\d.,-]/g, '').replace(',', '.'));
    const isNumericSearch = !Number.isNaN(searchQueryNum);

    const filteredPayments = allPayments.filter((payment) => {
      const description = (payment.description || '').toLowerCase();
      const payerName = (payment.payer_name || payment.payer || '').toLowerCase();
      const currency = (payment.currency || '').toLowerCase();
      const id = String(payment.id || '');

      // Проверка текстовых полей
      if (description.includes(searchQueryLower) ||
          payerName.includes(searchQueryLower) ||
          currency.includes(searchQueryLower) ||
          id.includes(searchQueryLower)) {
        return true;
      }

      // Проверка суммы как строки
      const amountStr = String(payment.amount || '');
      if (amountStr.includes(searchQueryLower)) {
        return true;
      }

      // Проверка amount_raw
      if (payment.amount_raw) {
        const amountRawLower = String(payment.amount_raw).toLowerCase();
        if (amountRawLower.includes(searchQueryLower)) {
          return true;
        }
      }

      // Числовая проверка суммы
      if (isNumericSearch && payment.amount != null) {
        const paymentAmount = parseFloat(payment.amount);
        if (!Number.isNaN(paymentAmount)) {
          if (Math.abs(paymentAmount - searchQueryNum) < 0.01) {
            return true;
          }
          const paymentAmountStr = paymentAmount.toFixed(2);
          if (paymentAmountStr.includes(searchQueryLower.replace(/[^\d.,-]/g, ''))) {
            return true;
          }
        }
      }

      return false;
    });

    // Загружаем информацию о связях с продуктами
    const paymentsWithLinks = await Promise.all(
      filteredPayments.map(async (payment) => {
        try {
          const linkResponse = await fetch(`${API_BASE}/payments/${encodeURIComponent(payment.id)}/link-product`);
          if (linkResponse.ok) {
            const linkPayload = await linkResponse.json();
            if (linkPayload.success && linkPayload.data) {
              return {
                ...payment,
                linked_product_id: linkPayload.data.product_id
              };
            }
          }
        } catch (error) {
          // Игнорируем ошибки при загрузке связей
        }
        return payment;
      })
    );

    productPaymentSearchState.searchResults = paymentsWithLinks;
    productPaymentSearchState.isLoading = false;

    // Обновляем только результаты поиска, сохраняя панель поиска
    const resultsContainer = elements.linkedPaymentsContainer.querySelector('.payment-search-results');
    if (resultsContainer) {
      resultsContainer.outerHTML = renderPaymentSearchResults();
    } else {
      // Если контейнера результатов еще нет, создаем его
      const searchPanel = elements.linkedPaymentsContainer.querySelector('.payment-search-panel');
      if (searchPanel) {
        searchPanel.insertAdjacentHTML('afterend', renderPaymentSearchResults());
      }
    }

    // Показываем/скрываем кнопку "Создать платеж из чека" в зависимости от результатов
    const createButton = elements.linkedPaymentsContainer.querySelector('#product-create-payment-from-receipt-btn');
    if (createButton) {
      const hasResults = paymentsWithLinks.length > 0;
      createButton.style.display = hasResults ? 'none' : '';
    }
    
    // Обновляем подсказку в панели поиска
    const searchPanel = elements.linkedPaymentsContainer.querySelector('.payment-search-panel');
    if (searchPanel) {
      const hintDivs = searchPanel.querySelectorAll('.payment-search-hint');
      const hintDiv = Array.from(hintDivs).find(div => div.textContent.includes('Поиск работает'));
      if (hintDiv) {
        const hasResults = paymentsWithLinks.length > 0;
        hintDiv.innerHTML = hasResults 
          ? 'Поиск работает по описанию платежа, контрагенту, сумме и ID'
          : 'Поиск работает по описанию платежа, контрагенту, сумме и ID. Если платежа нет в базе (оплата другой картой), можно создать его на основе чека.';
      }
    }

  } catch (error) {
    productPaymentSearchState.isLoading = false;
    showAlert('error', `Ошибка поиска: ${error.message}`);
    console.error('Payment search error:', error);
  }
}

// Link payment to product
async function linkPaymentToProduct(paymentId, productId, button) {
  if (!paymentId || !productId) {
    showAlert('error', 'Не указаны платеж или продукт');
    return;
  }

  try {
    setButtonLoading(button, true, 'Связываю...');
    
    // Убеждаемся, что productId - это число
    const numericProductId = Number(productId);
    if (!Number.isInteger(numericProductId)) {
      throw new Error('Некорректный идентификатор продукта');
    }
    
    const response = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}/link-product`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: numericProductId })
    });

    const payload = await response.json();
    
    if (!response.ok || !payload.success) {
      throw new Error(payload?.error || payload?.message || 'Не удалось связать платеж');
    }

    // Проверяем, был ли это пересвязывание или новая связь, и обновляем состояние
    const payment = productPaymentSearchState.searchResults.find(p => String(p.id) === String(paymentId));
    const wasRelinked = payment && payment.linked_product_id && payment.linked_product_id !== productId;
    
    const successMessage = wasRelinked 
      ? `Платеж #${paymentId} успешно пересвязан с продуктом`
      : `Платеж #${paymentId} успешно связан с продуктом`;
    showAlert('success', successMessage);
    
    // Обновляем состояние
    if (payment) {
      payment.linked_product_id = productId;
    }

    // Перезагружаем данные продукта
    await loadProductDetail();
    
  } catch (error) {
    showAlert('error', `Не удалось связать платеж: ${error.message}`);
    console.error('Link payment error:', error);
  } finally {
    setButtonLoading(button, false, '🔗 Связать');
  }
}

