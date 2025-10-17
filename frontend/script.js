// API Base URL
const API_BASE = '/api';

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
    testApis: document.getElementById('test-apis')
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
        addLog('info', 'Получение ожидающих сделок...');
        
        const result = await apiCall('/invoice-processing/pending');
        
        if (result.success) {
            addLog('success', `Найдено ${result.deals.length} сделок для обработки`);
            showPendingDeals(result.deals);
        } else {
            addLog('error', `Ошибка получения сделок: ${result.error}`);
            showResult('error', 'Ошибка получения сделок', result);
        }
    } catch (error) {
        addLog('error', `Ошибка получения сделок: ${error.message}`);
        showResult('error', 'Ошибка получения сделок', { error: error.message });
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

function showPendingDeals(deals) {
    const resultItem = document.createElement('div');
    resultItem.className = 'result-item';
    
    const timestamp = new Date().toLocaleTimeString();
    
    let dealsHtml = '';
    if (deals.length > 0) {
        dealsHtml = '<h5>Ожидающие сделки:</h5><ul>';
        deals.forEach(deal => {
            const invoiceType = deal['ad67729ecfe0345287b71a3b00910e8ba5b3b496'] || 'Не указан';
            dealsHtml += `<li>Deal ${deal.id}: ${deal.title} - ${invoiceType} (${deal.value} ${deal.currency})</li>`;
        });
        dealsHtml += '</ul>';
    } else {
        dealsHtml = '<p>Нет сделок для обработки</p>';
    }
    
    resultItem.innerHTML = `
        <h4>Ожидающие сделки</h4>
        <p><strong>Время:</strong> ${timestamp}</p>
        <p><strong>Количество:</strong> ${deals.length}</p>
        ${dealsHtml}
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