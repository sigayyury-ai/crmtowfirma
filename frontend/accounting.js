const API_BASE = '/api';

const elements = {
  vatFlowFrom: document.getElementById('vat-flow-from'),
  vatFlowTo: document.getElementById('vat-flow-to'),
  vatFlowLoadBtn: document.getElementById('vat-flow-load-btn'),
  vatFlowExportCsv: document.getElementById('vat-flow-export-csv'),
  vatFlowLoading: document.getElementById('vat-flow-loading'),
  vatFlowError: document.getElementById('vat-flow-error'),
  vatFlowResult: document.getElementById('vat-flow-result'),
  vatFlowMarginTotal: document.getElementById('vat-flow-margin-total'),
  vatFlowMarginCount: document.getElementById('vat-flow-margin-count'),
  vatFlowGeneralTotal: document.getElementById('vat-flow-general-total'),
  vatFlowGeneralCount: document.getElementById('vat-flow-general-count'),
  detailModal: document.getElementById('vat-flow-detail-modal'),
  detailTitle: document.getElementById('vat-flow-detail-title'),
  detailTbody: document.getElementById('vat-flow-detail-tbody'),
  detailSummary: document.getElementById('vat-flow-detail-summary'),
  detailClose: document.querySelector('.vat-flow-detail-close'),
  detailBackdrop: document.querySelector('.vat-flow-detail-backdrop')
};

let lastVatFlowData = null;
let lastVatFlowFrom = null;
let lastVatFlowTo = null;

function initDefaultDates() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  if (elements.vatFlowFrom) elements.vatFlowFrom.value = firstDay.toISOString().slice(0, 10);
  if (elements.vatFlowTo) elements.vatFlowTo.value = lastDay.toISOString().slice(0, 10);
}

async function loadVatFlowReport() {
  const from = elements.vatFlowFrom?.value;
  const to = elements.vatFlowTo?.value;
  if (!from || !to) {
    if (elements.vatFlowError) {
      elements.vatFlowError.textContent = 'Укажите период (С и По)';
      elements.vatFlowError.style.display = 'block';
    }
    return;
  }
  if (elements.vatFlowError) elements.vatFlowError.style.display = 'none';
  if (elements.vatFlowLoading) elements.vatFlowLoading.style.display = 'block';
  if (elements.vatFlowResult) elements.vatFlowResult.style.display = 'none';
  if (elements.vatFlowExportCsv) elements.vatFlowExportCsv.style.display = 'none';

  try {
    const url = `${API_BASE}/pnl/expenses-by-vat-flow?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || json.message || 'Ошибка загрузки');
    }
    const data = json.data;
    lastVatFlowData = data;
    lastVatFlowFrom = from;
    lastVatFlowTo = to;
    if (elements.vatFlowMarginTotal) elements.vatFlowMarginTotal.textContent = (data.margin_scheme?.totalPln ?? 0).toFixed(2) + ' PLN';
    if (elements.vatFlowMarginCount) elements.vatFlowMarginCount.textContent = data.margin_scheme?.count ?? 0;
    if (elements.vatFlowGeneralTotal) elements.vatFlowGeneralTotal.textContent = (data.general?.totalPln ?? 0).toFixed(2) + ' PLN';
    if (elements.vatFlowGeneralCount) elements.vatFlowGeneralCount.textContent = data.general?.count ?? 0;
    if (elements.vatFlowResult) elements.vatFlowResult.style.display = 'block';
    if (elements.vatFlowExportCsv) {
      elements.vatFlowExportCsv.href = `${API_BASE}/pnl/expenses-general/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=csv`;
      elements.vatFlowExportCsv.style.display = 'inline-block';
    }
  } catch (err) {
    if (elements.vatFlowError) {
      elements.vatFlowError.textContent = err.message || 'Ошибка';
      elements.vatFlowError.style.display = 'block';
    }
  } finally {
    if (elements.vatFlowLoading) elements.vatFlowLoading.style.display = 'none';
  }
}

const FLOW_LABELS = {
  margin_scheme: 'VAT marża (Art. 119) — состав',
  general: 'Wydatki ogólne (zwykły VAT) — состав'
};

function formatSource(source) {
  if (!source) return 'bank';
  const s = String(source).toLowerCase();
  if (s === 'bank_statement') return 'bank';
  if (s === 'manual') return 'ręczny';
  return source;
}

function openDetailModal(flow, title, items, totalPln) {
  if (!elements.detailModal || !elements.detailTbody) return;
  if (elements.detailTitle) elements.detailTitle.textContent = title;
  elements.detailTbody.innerHTML = '';
  if (!items || !items.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6">Нет операций за выбранный период</td>';
    elements.detailTbody.appendChild(tr);
  } else {
    items.forEach(it => {
      const dateStr = it.date ? it.date.slice(0, 10) : '—';
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${escapeHtml(dateStr)}</td>` +
        `<td>${Number(it.amountPln).toFixed(2)}</td>` +
        `<td>${escapeHtml(it.payer_name || '—')}</td>` +
        `<td>${escapeHtml(it.categoryName || '—')}</td>` +
        `<td>${escapeHtml(formatSource(it.source))}</td>` +
        `<td>${escapeHtml(it.vat_flow_reason || '—')}</td>`;
      elements.detailTbody.appendChild(tr);
    });
  }
  if (elements.detailSummary) {
    elements.detailSummary.textContent = `Итого: ${(totalPln ?? 0).toFixed(2)} PLN, ${items?.length ?? 0} операций`;
  }
  elements.detailModal.style.display = 'flex';
  document.body.classList.add('modal-open');
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function closeDetailModal() {
  if (elements.detailModal) elements.detailModal.style.display = 'none';
  document.body.classList.remove('modal-open');
}

async function onVatFlowCardClick(flow) {
  const from = elements.vatFlowFrom?.value;
  const to = elements.vatFlowTo?.value;
  if (!from || !to) return;
  const title = FLOW_LABELS[flow] || flow;
  let items = [];
  let totalPln = 0;
  if (lastVatFlowData && lastVatFlowFrom === from && lastVatFlowTo === to) {
    const branch = flow === 'margin_scheme' ? lastVatFlowData.margin_scheme : lastVatFlowData.general;
    items = branch?.items ?? [];
    totalPln = branch?.totalPln ?? 0;
  } else {
    try {
      const url = `${API_BASE}/pnl/expenses-by-vat-flow/detail?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&flow=${encodeURIComponent(flow)}`;
      const res = await fetch(url);
      const json = await res.json();
      if (res.ok && json.success) {
        items = json.items ?? [];
        totalPln = json.totalPln ?? 0;
      }
    } catch (err) {
      if (elements.vatFlowError) {
        elements.vatFlowError.textContent = 'Ошибка загрузки деталей: ' + (err.message || '');
        elements.vatFlowError.style.display = 'block';
      }
      return;
    }
  }
  openDetailModal(flow, title, items, totalPln);
}

document.addEventListener('DOMContentLoaded', () => {
  initDefaultDates();
  if (elements.vatFlowLoadBtn) {
    elements.vatFlowLoadBtn.addEventListener('click', loadVatFlowReport);
  }
  document.querySelectorAll('.vat-flow-card').forEach(card => {
    const flow = card.getAttribute('data-flow');
    if (!flow) return;
    card.addEventListener('click', () => onVatFlowCardClick(flow));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onVatFlowCardClick(flow);
      }
    });
  });
  if (elements.detailClose) elements.detailClose.addEventListener('click', closeDetailModal);
  if (elements.detailBackdrop) elements.detailBackdrop.addEventListener('click', closeDetailModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.detailModal && elements.detailModal.style.display === 'flex') {
      closeDetailModal();
    }
  });
  // Сразу показываем результат за текущий месяц
  loadVatFlowReport();
});
