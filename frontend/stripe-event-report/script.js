const API_BASE = '/api/reports/stripe-events';

const elements = {
  title: document.getElementById('event-title'),
  subtitle: document.getElementById('event-subtitle'),
  generatedAt: document.getElementById('event-generated-at'),
  currencyMeta: document.getElementById('event-currency-meta'),
  totalOriginal: document.getElementById('event-total-original'),
  paymentsTotal: document.getElementById('event-payments-total'),
  participantsCount: document.getElementById('event-participants-count'),
  participantsTable: document.getElementById('event-participants-table'),
  warningBox: document.getElementById('event-warning'),
  errorBox: document.getElementById('event-error'),
  exportButton: document.getElementById('event-export')
};

const params = new URLSearchParams(window.location.search);
const eventKey = params.get('eventKey');

document.addEventListener('DOMContentLoaded', () => {
  if (!eventKey) {
    showError('Не указан идентификатор мероприятия. Вернитесь к списку и выберите мероприятие.');
    setParticipantsPlaceholder('Ключ мероприятия не задан');
    disableExport();
    return;
  }

  elements.subtitle.textContent = `Мероприятие: ${eventKey}`;
  loadEventReport(eventKey);
  elements.exportButton?.addEventListener('click', handleExport);
});

async function loadEventReport(key) {
  setParticipantsPlaceholder('Загружаем данные Stripe...');
  disableExport();
  hideError();
  hideWarning();

  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(key)}`, {
      credentials: 'include'
    });
    const result = await response.json();
    if (!response.ok || result?.success === false) {
      throw new Error(result?.error || `HTTP ${response.status}`);
    }

    const report = result?.data?.eventReport;
    if (!report) {
      throw new Error('Отчет по мероприятию не найден');
    }
    renderEvent(report);
    enableExport();
  } catch (error) {
    console.error('Failed to load Stripe event report', error);
    showError(error.message || 'Не удалось загрузить отчёт по мероприятию');
    setParticipantsPlaceholder('Ошибка загрузки данных');
  }
}

function renderEvent(report) {
  const currency = report.currency || 'PLN';
  elements.title.textContent = report.eventLabel || report.eventKey || 'Мероприятие';
  elements.subtitle.textContent = report.eventKey ? `Ключ: ${report.eventKey}` : 'Ключ не указан';

  if (report.generatedAt) {
    elements.generatedAt.textContent = `Сформировано: ${formatDateTime(report.generatedAt)}`;
  } else {
    elements.generatedAt.textContent = '';
  }

  renderWarnings(report.warnings);
  renderTotals(report, currency);
  renderParticipants(Array.isArray(report.participants) ? report.participants : [], currency);
}

function renderTotals(report, currency) {
  const totals = report.totals || {};

  if (Number.isFinite(totals.grossRevenue)) {
    elements.totalOriginal.textContent = formatCurrency(totals.grossRevenue, currency);
  } else {
    elements.totalOriginal.textContent = '—';
  }

  const currencyMeta = [`Валюта отчёта: ${currency}`];
  if (currency !== 'PLN') {
    const hasPln = Number.isFinite(totals.grossRevenuePln) && totals.grossRevenuePln > 0;
    currencyMeta.push(hasPln
      ? `эквивалент: ${formatCurrency(totals.grossRevenuePln, 'PLN')}`
      : 'конвертация недоступна');
  }
  elements.currencyMeta.textContent = currencyMeta.join(' • ');

  const totalPayments = Number.isFinite(report.totalLineItems)
    ? report.totalLineItems
    : Number.isFinite(totals.sessionsCount)
      ? totals.sessionsCount
      : null;
  elements.paymentsTotal.textContent = totalPayments !== null
    ? pluralize(totalPayments, 'платёж', 'платежа', 'платежей')
    : '—';
}

function renderParticipants(participants, defaultCurrency) {
  if (!elements.participantsTable) return;

  if (!Array.isArray(participants) || participants.length === 0) {
    setParticipantsPlaceholder('Нет успешных платежей для этого мероприятия');
    elements.participantsCount.textContent = '0 участников';
    return;
  }

  const rows = participants.map((participant) => {
    const currency = participant.currency || defaultCurrency || 'PLN';
    const totalOriginal = Number.isFinite(Number(participant.totalAmount))
      ? formatCurrency(Number(participant.totalAmount), currency)
      : '—';
    const totalPlnValue = Number(participant.totalAmountPln);
    const totalPln = Number.isFinite(totalPlnValue) && totalPlnValue > 0
      ? formatCurrency(totalPlnValue, 'PLN')
      : (currency === 'PLN'
        ? formatCurrency(Number(participant.totalAmount) || 0, 'PLN')
        : '—');

    return `
      <tr>
        <td>${escapeHtml(participant.displayName || '—')}</td>
        <td class="numeric-col">${totalPln}</td>
        <td class="numeric-col">${totalOriginal}</td>
      </tr>
    `;
  }).join('');

  const tableHtml = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Имя</th>
          <th class="numeric-col">Сумма (PLN)</th>
          <th class="numeric-col">Сумма</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  elements.participantsTable.innerHTML = tableHtml;
  elements.participantsCount.textContent = pluralize(participants.length, 'участник', 'участника', 'участников');
}

function renderWarnings(warnings) {
  if (!elements.warningBox) return;

  if (!warnings || warnings.length === 0) {
    elements.warningBox.classList.add('hidden');
    elements.warningBox.textContent = '';
    return;
  }

  elements.warningBox.classList.remove('hidden');
  elements.warningBox.innerHTML = warnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join('');
}

function showError(message) {
  if (!elements.errorBox) return;
  elements.errorBox.classList.remove('hidden');
  elements.errorBox.textContent = message;
}

function hideError() {
  elements.errorBox?.classList.add('hidden');
  if (elements.errorBox) {
    elements.errorBox.textContent = '';
  }
}

function hideWarning() {
  elements.warningBox?.classList.add('hidden');
  if (elements.warningBox) {
    elements.warningBox.textContent = '';
  }
}

function setParticipantsPlaceholder(message) {
  if (!elements.participantsTable) return;
  elements.participantsTable.innerHTML = `<div class="placeholder">${escapeHtml(message)}</div>`;
}

function disableExport() {
  if (elements.exportButton) {
    elements.exportButton.disabled = true;
  }
}

function enableExport() {
  if (elements.exportButton) {
    elements.exportButton.disabled = false;
  }
}

function formatCurrency(value, currency = 'PLN') {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU');
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function pluralize(count, one, few, many) {
  if (!Number.isFinite(count)) return `0 ${many}`;
  const absCount = Math.abs(count);
  const mod10 = absCount % 10;
  const mod100 = absCount % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${count} ${few}`;
  return `${count} ${many}`;
}

async function handleExport(event) {
  event.preventDefault();
  if (!eventKey) return;

  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(eventKey)}/export`, {
      credentials: 'include'
    });
    if (!response.ok) {
      throw new Error(`Экспорт недоступен (HTTP ${response.status})`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${eventKey}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Export failed', error);
    showError(error.message || 'Не удалось экспортировать отчёт');
  }
}

