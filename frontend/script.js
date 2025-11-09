// API Base URL
const API_BASE = '/api';

// Sanitization helpers
const SANITIZE_PATTERNS = [
    { regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '***masked-email***' },
    { regex: /(?:\+?\d[\s-]?){6,15}/g, replacement: '***masked-phone***' },
    { regex: /[A-Za-z0-9\-_]{20,}/g, replacement: '***masked-token***' },
    { regex: /CO-PROF\s?\d{1,3}\/\d{4}/gi, replacement: (match) => `CO-PROF ***/${match.slice(-4)}` },
    {
        regex: /\b\d{1,3}(?:[\s\u00A0]?)?(?:\d{3}(?:[\s\u00A0]?))*([.,]\d{1,2})?\s?(PLN|USD|EUR)?\b/gi,
        replacement: '~[amount-masked]'
    }
];

function sanitizeText(value) {
    if (typeof value !== 'string') return value;
    return SANITIZE_PATTERNS.reduce((acc, pattern) => {
        const replacement = typeof pattern.replacement === 'function' ? pattern.replacement : () => pattern.replacement;
        return acc.replace(pattern.regex, (match) => replacement(match));
    }, value);
}

function sanitizeValue(value) {
    if (typeof value === 'string') return sanitizeText(value);
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
    if (value && typeof value === 'object') {
        return Object.keys(value).reduce((acc, key) => {
            acc[key] = sanitizeValue(value[key]);
            return acc;
        }, Array.isArray(value) ? [] : {});
    }
    return value;
}

function sanitizeError(error) {
    const message = sanitizeText(error?.message || String(error));
    if (error instanceof Error) {
        const sanitized = new Error(message);
        sanitized.stack = error.stack;
        return sanitized;
    }
    return new Error(message);
}

// DOM Elements
const elements = {
    schedulerStatus: document.getElementById('scheduler-status'),
    schedulerInfo: document.getElementById('scheduler-info'),
    pipedriveStatus: document.getElementById('pipedrive-status'),
    wfirmaStatus: document.getElementById('wfirma-status'),
    resultsContainer: document.getElementById('results-container'),
    logsContainer: document.getElementById('logs-container'),
    
    // Buttons
    startScheduler: document.getElementById('start-scheduler'),
    stopScheduler: document.getElementById('stop-scheduler'),
    refreshStatus: document.getElementById('refresh-status'),
    runPolling: document.getElementById('run-polling'),
    getPending: document.getElementById('get-pending'),
    testApis: document.getElementById('test-apis'),
};

// State
let isPolling = false;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    refreshSystemStatus();
    addLog('info', 'Система инициализирована');
});

// Event Listeners
function initializeEventListeners() {
    elements.startScheduler.addEventListener('click', startScheduler);
    elements.stopScheduler.addEventListener('click', stopScheduler);
    elements.refreshStatus.addEventListener('click', refreshSystemStatus);
    elements.runPolling.addEventListener('click', runManualPolling);
    elements.getPending.addEventListener('click', getPendingDeals);
    elements.testApis.addEventListener('click', testAllApis);
}

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
        const result = sanitizeValue(await response.json());
        
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        
        return result;
    } catch (error) {
        const safeError = sanitizeError(error);
        console.error('API Error:', safeError.message);
        throw safeError;
    }
}

// Scheduler Functions
async function startScheduler() {
    try {
        setButtonLoading(elements.startScheduler, true);
        addLog('info', 'Запуск планировщика...');
        
        const result = await apiCall('/invoice-processing/start', 'POST');
        
        addLog('success', 'Планировщик запущен успешно');
        refreshSystemStatus();
        showResult('success', 'Планировщик запущен', result);
    } catch (error) {
        addLog('error', `Ошибка запуска планировщика: ${error.message}`);
        showResult('error', 'Ошибка запуска планировщика', { error: error.message });
    } finally {
        setButtonLoading(elements.startScheduler, false);
    }
}

async function stopScheduler() {
    try {
        setButtonLoading(elements.stopScheduler, true);
        addLog('info', 'Остановка планировщика...');
        
        const result = await apiCall('/invoice-processing/stop', 'POST');
        
        addLog('success', 'Планировщик остановлен');
        refreshSystemStatus();
        showResult('success', 'Планировщик остановлен', result);
    } catch (error) {
        addLog('error', `Ошибка остановки планировщика: ${error.message}`);
        showResult('error', 'Ошибка остановки планировщика', { error: error.message });
    } finally {
        setButtonLoading(elements.stopScheduler, false);
    }
}

async function refreshSystemStatus() {
    try {
        setButtonLoading(elements.refreshStatus, true);
        
        // Get scheduler status
        const schedulerResult = await apiCall('/invoice-processing/status');
        updateSchedulerStatus(schedulerResult.status);
        
        // Test APIs
        await testPipedriveApi();
        await testWfirmaApi();
        
        addLog('info', 'Статус системы обновлен');
    } catch (error) {
        addLog('error', `Ошибка обновления статуса: ${error.message}`);
    } finally {
        setButtonLoading(elements.refreshStatus, false);
    }
}

// Polling Functions
async function runManualPolling() {
    if (isPolling) {
        addLog('warning', 'Polling уже выполняется...');
        return;
    }
    
    try {
        isPolling = true;
        setButtonLoading(elements.runPolling, true);
        addLog('info', 'Запуск ручного polling...');
        
        const result = await apiCall('/invoice-processing/run', 'POST', { period: 'manual' });
        
        addLog('success', `Polling завершен: ${result.summary.successful} успешно, ${result.summary.errors} ошибок`);
        showPollingResults(result);
    } catch (error) {
        addLog('error', `Ошибка polling: ${error.message}`);
        showResult('error', 'Ошибка polling', { error: error.message });
    } finally {
        isPolling = false;
        setButtonLoading(elements.runPolling, false);
    }
}

async function getPendingDeals() {
    try {
        setButtonLoading(elements.getPending, true);
        addLog('info', 'Получение ожидающих задач...');
        
        const result = await apiCall('/invoice-processing/pending');
        
        if (result.success) {
            const creationCount = result.stats?.creationCount || (result.creationDeals?.length || 0);
            const deletionCount = result.stats?.deletionCount || (result.deletionDeals?.length || 0);
            addLog('success', `Найдено ${creationCount} задач на создание и ${deletionCount} задач на удаление`);
            showPendingDeals(result);
        } else {
            addLog('error', `Ошибка получения задач: ${result.error}`);
            showResult('error', 'Ошибка получения задач', result);
        }
    } catch (error) {
        addLog('error', `Ошибка получения задач: ${error.message}`);
        showResult('error', 'Ошибка получения задач', { error: error.message });
    } finally {
        setButtonLoading(elements.getPending, false);
    }
}

// API Testing
async function testAllApis() {
    try {
        setButtonLoading(elements.testApis, true);
        addLog('info', 'Тестирование всех API...');
        
        await testPipedriveApi();
        await testWfirmaApi();
        
        addLog('success', 'Тестирование API завершено');
    } catch (error) {
        addLog('error', `Ошибка тестирования API: ${error.message}`);
    } finally {
        setButtonLoading(elements.testApis, false);
    }
}

async function testPipedriveApi() {
    try {
        const result = await apiCall('/pipedrive/test');
        if (result.success) {
            elements.pipedriveStatus.textContent = '✅ Подключен';
            elements.pipedriveStatus.className = 'status-indicator healthy';
            addLog('success', `Pipedrive API: ${result.user} (${result.company})`);
        } else {
            elements.pipedriveStatus.textContent = '❌ Ошибка';
            elements.pipedriveStatus.className = 'status-indicator error';
            addLog('error', `Pipedrive API: ${result.error}`);
        }
    } catch (error) {
        elements.pipedriveStatus.textContent = '❌ Недоступен';
        elements.pipedriveStatus.className = 'status-indicator error';
        addLog('error', `Pipedrive API: ${error.message}`);
    }
}

async function testWfirmaApi() {
    try {
        const result = await apiCall('/test');
        if (result.success) {
            elements.wfirmaStatus.textContent = '✅ Подключен';
            elements.wfirmaStatus.className = 'status-indicator healthy';
            addLog('success', `wFirma API: ${result.message}`);
        } else {
            elements.wfirmaStatus.textContent = '❌ Ошибка';
            elements.wfirmaStatus.className = 'status-indicator error';
            addLog('error', `wFirma API: ${result.error}`);
        }
    } catch (error) {
        elements.wfirmaStatus.textContent = '❌ Недоступен';
        elements.wfirmaStatus.className = 'status-indicator error';
        addLog('error', `wFirma API: ${error.message}`);
    }
}

// UI Update Functions
function updateSchedulerStatus(status) {
    if (status.isRunning) {
        elements.schedulerStatus.textContent = '🟢 Запущен';
        elements.schedulerStatus.className = 'status-indicator running';
        elements.schedulerInfo.innerHTML = `
            <div>Задач: ${status.jobsCount}</div>
            <div>Следующий запуск: ${status.nextRuns[0]?.time || 'N/A'}</div>
        `;
    } else {
        elements.schedulerStatus.textContent = '🔴 Остановлен';
        elements.schedulerStatus.className = 'status-indicator stopped';
        elements.schedulerInfo.innerHTML = `
            <div>Задач: ${status.jobsCount}</div>
            <div>Расписание: 9:00, 13:00, 18:00</div>
        `;
    }
}

function showResult(type, title, data) {
    const resultItem = document.createElement('div');
    resultItem.className = `result-item ${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    
    resultItem.innerHTML = `
        <h4>${title}</h4>
        <p><strong>Время:</strong> ${timestamp}</p>
        <pre>${JSON.stringify(data, null, 2)}</pre>
    `;
    
    elements.resultsContainer.innerHTML = '';
    elements.resultsContainer.appendChild(resultItem);
}

function showPollingResults(result) {
    const resultItem = document.createElement('div');
    resultItem.className = `result-item ${result.success ? 'success' : 'error'}`;
    
    const timestamp = new Date().toLocaleTimeString();
    
    let resultsHtml = '';
    if (result.results && result.results.length > 0) {
        resultsHtml = '<h5>Результаты обработки:</h5><ul>';
        result.results.forEach(r => {
            const icon = r.success ? '✅' : '❌';
            resultsHtml += `<li>${icon} Deal ${r.dealId}: ${r.message || r.error}</li>`;
        });
        resultsHtml += '</ul>';
    }
    
    resultItem.innerHTML = `
        <h4>Результат Polling</h4>
        <p><strong>Время:</strong> ${timestamp}</p>
        <p><strong>Всего:</strong> ${result.summary?.total || 0}</p>
        <p><strong>Успешно:</strong> ${result.summary?.successful || 0}</p>
        <p><strong>Ошибок:</strong> ${result.summary?.errors || 0}</p>
        ${resultsHtml}
    `;
    
    elements.resultsContainer.innerHTML = '';
    elements.resultsContainer.appendChild(resultItem);
}

function showPendingDeals(payload) {
    const creationDeals = Array.isArray(payload?.creationDeals) ? payload.creationDeals : [];
    const deletionDeals = Array.isArray(payload?.deletionDeals) ? payload.deletionDeals : [];
    const timestamp = new Date().toLocaleTimeString();

    const creationList = creationDeals.length > 0
        ? `<h5>Создание проформ:</h5><ul>${creationDeals.map(deal => {
            const invoiceType = deal['ad67729ecfe0345287b71a3b00910e8ba5b3b496'] || 'Не указан';
            return `<li>Deal ${deal.id}: ${deal.title} - ${invoiceType} (${deal.value} ${deal.currency})</li>`;
        }).join('')}</ul>`
        : '<p>Нет сделок для создания проформ</p>';

    const deletionList = deletionDeals.length > 0
        ? `<h5>Удаление проформ:</h5><ul>${deletionDeals.map(deal => {
            const valueLabel = [deal.value, deal.currency].filter(Boolean).join(' ');
            return `<li>Deal ${deal.id}: ${deal.title}${valueLabel ? ` (${valueLabel})` : ''}</li>`;
        }).join('')}</ul>`
        : '<p>Нет сделок на удаление проформ</p>';

    const resultItem = document.createElement('div');
    resultItem.className = 'result-item info';
    resultItem.innerHTML = `
        <h4>Задачи по проформам</h4>
        <p><strong>Время:</strong> ${timestamp}</p>
        <p><strong>На создание:</strong> ${creationDeals.length}</p>
        <p><strong>На удаление:</strong> ${deletionDeals.length}</p>
        <div class="pending-section">${creationList}</div>
        <div class="pending-section">${deletionList}</div>
    `;

    elements.resultsContainer.innerHTML = '';
    elements.resultsContainer.appendChild(resultItem);
}

function addLog(type, message) {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    logEntry.innerHTML = `<span class="timestamp">[${timestamp}]</span>${message}`;
    
    elements.logsContainer.appendChild(logEntry);
    elements.logsContainer.scrollTop = elements.logsContainer.scrollHeight;
}

function setButtonLoading(button, loading) {
    if (loading) {
        button.disabled = true;
        button.innerHTML = '<div class="loading"></div> Загрузка...';
    } else {
        button.disabled = false;
        // Restore original text based on button ID
        const originalTexts = {
            'start-scheduler': '▶️ Запустить',
            'stop-scheduler': '⏹️ Остановить',
            'refresh-status': '🔄 Обновить статус',
            'run-polling': '🔍 Запустить Polling',
            'get-pending': '📋 Показать ожидающие',
            'test-apis': '🧪 Тест API'
        };
        button.innerHTML = originalTexts[button.id] || button.textContent;
    }
}