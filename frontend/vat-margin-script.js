// API Base URL
const API_BASE = '/api';

// DOM Elements - инициализируем после загрузки DOM
let elements = {};

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Инициализируем элементы после загрузки DOM
    elements = {
        vatMarginContainer: document.getElementById('vat-margin-container'),
        logsContainer: document.getElementById('logs-container'),
        loadVatMargin: document.getElementById('load-vat-margin')
    };
    
    // Проверяем, что все элементы найдены
    if (!elements.vatMarginContainer || !elements.logsContainer || !elements.loadVatMargin) {
        console.error('Не найдены необходимые элементы DOM:', {
            vatMarginContainer: !!elements.vatMarginContainer,
            logsContainer: !!elements.logsContainer,
            loadVatMargin: !!elements.loadVatMargin
        });
        return;
    }
    
    try {
        // Добавляем обработчики событий
        if (elements.loadVatMargin) {
            elements.loadVatMargin.addEventListener('click', loadVatMarginData);
        }
        
        addLog('info', 'VAT Margin Tracker инициализирован');
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        addLog('error', `Ошибка инициализации: ${error.message}`);
    }
});


// API Functions
async function apiCall(endpoint, method = 'GET', data = null) {
    try {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            }
        };
        
        if (data) {
            options.body = JSON.stringify(data);
        }
        
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        
        return result;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// VAT Margin Functions
async function loadVatMarginData() {
    try {
        // Проверяем наличие элементов перед использованием
        if (!elements.loadVatMargin || !elements.vatMarginContainer) {
            throw new Error('Не найдены необходимые элементы DOM');
        }
        
        setButtonLoading(elements.loadVatMargin, true);
        addLog('info', 'Загрузка всех проформ из wFirma...');
        
        // Загружаем все проформы без фильтра по дате
        const result = await apiCall(`/vat-margin/monthly-proformas`);
        
        if (result.success) {
            addLog('success', `Загружено ${result.count} продуктов`);
            showVatMarginData(result.data, result.period || {});
        } else {
            throw new Error(result.error || 'Ошибка загрузки данных');
        }
    } catch (error) {
        console.error('Ошибка загрузки VAT Margin:', error);
        addLog('error', `Ошибка загрузки VAT Margin: ${error.message}`);
        
        if (elements.vatMarginContainer) {
            elements.vatMarginContainer.innerHTML = `
                <div class="result-item error">
                    <h4>Ошибка загрузки данных</h4>
                    <p>${error.message}</p>
                </div>
            `;
        }
    } finally {
        if (elements.loadVatMargin) {
            setButtonLoading(elements.loadVatMargin, false);
        }
    }
}

function showVatMarginData(data, period) {
    if (!elements.vatMarginContainer) {
        console.error('vatMarginContainer не найден');
        return;
    }
    
    if (!data || data.length === 0) {
        elements.vatMarginContainer.innerHTML = `
            <div class="placeholder">
                <p>Проформы не найдены</p>
            </div>
        `;
        return;
    }
    
    // Сортируем данные по названию продукта, затем по дате (от новых к старым)
    const sortedData = [...data].sort((a, b) => {
        // Сначала по названию продукта
        const nameCompare = (a.name || '').localeCompare(b.name || '');
        if (nameCompare !== 0) return nameCompare;
        
        // Если названия одинаковые, сортируем по дате (от новых к старым)
        if (a.date > b.date) return -1;
        if (a.date < b.date) return 1;
        return 0;
    });
    
    // Calculate totals - группируем по валютам и считаем общую сумму в PLN
    const totalsByCurrency = {};
    const uniqueProformas = new Set();
    let totalPLN = 0;
    
    sortedData.forEach(item => {
        const currency = item.currency || 'PLN';
        const amount = item.total || 0;
        const currencyExchange = item.currency_exchange ? parseFloat(item.currency_exchange) : null;
        
        if (!totalsByCurrency[currency]) {
            totalsByCurrency[currency] = 0;
        }
        totalsByCurrency[currency] += amount;
        uniqueProformas.add(item.fullnumber);
        
        // Добавляем к общей сумме в PLN
        if (currencyExchange && currencyExchange > 0) {
            totalPLN += amount * currencyExchange;
        } else if (currency === 'PLN') {
            totalPLN += amount;
        }
    });
    
    const currencySummary = Object.entries(totalsByCurrency).map(([curr, amount]) => 
        `${formatCurrency(amount, curr)}`
    ).join(', ');
    
    let html = `
        <div class="vat-margin-summary">
            <h3>Сводка</h3>
            <div class="summary-grid">
                <div class="summary-item">
                    <span class="summary-label">Всего записей:</span>
                    <span class="summary-value">${sortedData.length}</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Всего проформ:</span>
                    <span class="summary-value">${uniqueProformas.size}</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Общая сумма:</span>
                    <span class="summary-value">${currencySummary || '—'}</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Всего в PLN:</span>
                    <span class="summary-value">${formatCurrency(totalPLN, 'PLN')}</span>
                </div>
            </div>
        </div>
        <div class="vat-margin-table">
        `;
        
        let currentProductName = null;
        let groupTotalPLN = 0;
        
        sortedData.forEach((item, index) => {
            const total = item.total || 0;
            const currency = item.currency || 'PLN';
            const currencyExchange = item.currency_exchange ? parseFloat(item.currency_exchange) : null;
            const currencyExchangeDisplay = currencyExchange ? currencyExchange.toFixed(4) : '—';
            const date = item.date ? new Date(item.date).toLocaleDateString('ru-RU') : '—';
            
            // Вычисляем сумму в PLN: total * currency_exchange
            const totalPLN = currencyExchange && currencyExchange > 0 ? total * currencyExchange : null;
            const totalPLNDisplay = totalPLN !== null ? formatCurrency(totalPLN, 'PLN') : '—';
            
            // Если это новый продукт, добавляем заголовок группы
            const productName = item.name || '—';
            if (currentProductName !== productName) {
                if (currentProductName !== null) {
                    // Добавляем итоговую строку для предыдущей группы
                    html += `
                        <tr class="product-group-total">
                            <td colspan="5" style="text-align: right; font-weight: 600; background: #f8f9fa; padding: 15px;">
                                Итого в PLN:
                            </td>
                            <td style="font-weight: 700; background: #f8f9fa; padding: 15px; color: #667eea;">
                                ${formatCurrency(groupTotalPLN, 'PLN')}
                            </td>
                        </tr>
                    `;
                    // Закрываем предыдущую группу
                    html += '</tbody></table></div>';
                }
                // Начинаем новую группу
                currentProductName = productName;
                groupTotalPLN = 0; // Сбрасываем счетчик для новой группы
                html += `
                    <div class="product-group">
                        <h4 class="product-group-header">${escapeHtml(productName)}</h4>
                        <table class="product-group-table">
                            <thead>
                                <tr>
                                    <th>Номер проформы</th>
                                    <th>Дата</th>
                                    <th>Валюта</th>
                                    <th>Сумма</th>
                                    <th>Курс валюты</th>
                                    <th>Всего в PLN</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
            }
            
            // Добавляем к общей сумме группы
            if (totalPLN !== null) {
                groupTotalPLN += totalPLN;
            } else if (currency === 'PLN') {
                groupTotalPLN += total;
            }
            
            html += `
                <tr class="vat-margin-row" data-index="${index}">
                    <td class="fullnumber">${escapeHtml(item.fullnumber || '—')}</td>
                    <td class="date">${date}</td>
                    <td class="currency">${currency}</td>
                    <td class="amount">${formatCurrency(total, currency)}</td>
                    <td class="currency-exchange">${currencyExchangeDisplay}</td>
                    <td class="total-pln">${totalPLNDisplay}</td>
                </tr>
            `;
        });
        
        // Закрываем последнюю группу с итоговой строкой
        if (currentProductName !== null) {
            html += `
                <tr class="product-group-total">
                    <td colspan="5" style="text-align: right; font-weight: 600; background: #f8f9fa; padding: 15px;">
                        Итого в PLN:
                    </td>
                    <td style="font-weight: 700; background: #f8f9fa; padding: 15px; color: #667eea;">
                        ${formatCurrency(groupTotalPLN, 'PLN')}
                    </td>
                </tr>
            `;
            html += '</tbody></table></div>';
        }
    
    html += `
        </div>
    `;
    
    elements.vatMarginContainer.innerHTML = html;
}

function toggleInvoices(index) {
    const detailRow = document.getElementById(`invoices-${index}`);
    if (detailRow) {
        detailRow.style.display = detailRow.style.display === 'none' ? 'table-row' : 'none';
    }
}

function formatCurrency(amount, currency = 'PLN') {
    return new Intl.NumberFormat('pl-PL', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function addLog(type, message) {
    if (!elements.logsContainer) {
        console.log(`[${type}] ${message}`);
        return;
    }
    
    try {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        
        const timestamp = new Date().toLocaleTimeString();
        logEntry.innerHTML = `<span class="timestamp">[${timestamp}]</span>${message}`;
        
        elements.logsContainer.appendChild(logEntry);
        elements.logsContainer.scrollTop = elements.logsContainer.scrollHeight;
    } catch (error) {
        console.error('Ошибка добавления лога:', error);
    }
}

function setButtonLoading(button, loading) {
    if (loading) {
        button.disabled = true;
        button.innerHTML = '<div class="loading"></div> Загрузка...';
    } else {
        button.disabled = false;
        button.innerHTML = '📈 Загрузить все проформы';
    }
}

// Make toggleInvoices globally available
window.toggleInvoices = toggleInvoices;

