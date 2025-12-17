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

const DATE_LOCALE = 'ru-RU';

function formatDateTime(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(DATE_LOCALE, {
        hour12: false
    });
}

function formatRelativeTime(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';

    const diffMs = date.getTime() - Date.now();
    const absMs = Math.abs(diffMs);
    const totalSeconds = Math.round(absMs / 1000);

    let label;
    if (totalSeconds < 60) {
        label = '<1 мин';
    } else {
        const totalMinutes = Math.floor(totalSeconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const parts = [];
        if (hours > 0) {
            parts.push(`${hours} ч`);
        }
        if (minutes > 0) {
            parts.push(`${minutes} мин`);
        }
        label = parts.join(' ') || '<1 мин';
    }

    return diffMs >= 0 ? `через ${label}` : `${label} назад`;
}

function formatRelativeStart(iso) {
    if (!iso) return '—';
    const dateText = formatDateTime(iso);
    const relative = formatRelativeTime(iso);
    if (relative === '—') {
        return dateText;
    }
    return `${dateText} (${relative})`;
}

function formatDateOnly(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(DATE_LOCALE, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// DOM Elements
const elements = {
    schedulerStatus: document.getElementById('scheduler-status'),
    schedulerInfo: document.getElementById('scheduler-info'),
    pipedriveStatus: document.getElementById('pipedrive-status'),
    wfirmaStatus: document.getElementById('wfirma-status'),
    resultsContainer: document.getElementById('results-container'),
    logsContainer: document.getElementById('logs-container'),
    cronTasksContainer: document.getElementById('cron-tasks-container'),
    
    // Buttons
    refreshStatus: document.getElementById('refresh-status'),
    runPolling: document.getElementById('run-polling'),
    getPending: document.getElementById('get-pending'),
    testApis: document.getElementById('test-apis'),
    refreshCronTasks: document.getElementById('refresh-cron-tasks'),
};

// State
let isPolling = false;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    refreshSystemStatus();
    loadCronTasks();
    addLog('info', 'Система инициализирована');
});

// Event Listeners
function initializeEventListeners() {
    elements.refreshStatus?.addEventListener('click', (e) => refreshSystemStatus(e));
    elements.runPolling?.addEventListener('click', runManualPolling);
    elements.getPending?.addEventListener('click', getPendingDeals);
    elements.testApis?.addEventListener('click', testAllApis);
    elements.refreshCronTasks?.addEventListener('click', loadCronTasks);
}

// API Functions
async function apiCall(endpoint, method = 'GET', data = null, apiOptions = {}) {
    try {
        const { sanitize = true } = apiOptions;
        const requestOptions = {
            method,
            headers: {
                'Content-Type': 'application/json',
            }
        };
        
        if (data) {
            requestOptions.body = JSON.stringify(data);
        }
        
        const response = await fetch(`${API_BASE}${endpoint}`, requestOptions);
        
        // Handle non-JSON responses
        let payload;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            payload = await response.json();
        } else {
            const text = await response.text();
            payload = { error: text || `HTTP ${response.status}` };
        }
        
        const result = sanitize ? sanitizeValue(payload) : payload;
        
        if (!response.ok) {
            // Don't throw for 400/500 errors on test endpoints - return error object instead
            // This prevents console errors for expected configuration issues
            // 400 = configuration error (not a real error, just not configured)
            // 500 = server error (should be logged but not thrown for test endpoints)
            if ((response.status === 400 || response.status === 500) && 
                (endpoint.includes('/test') || endpoint.includes('/pipedrive/test') || endpoint.includes('/wfirma/test'))) {
                // Suppress console error for test endpoints - these are expected to fail if not configured
                return {
                    success: false,
                    error: result.error || 'Internal server error',
                    message: result.message || result.error || 'API test failed'
                };
            }
            throw new Error(result.error || result.message || `HTTP ${response.status}`);
        }
        
        return result;
    } catch (error) {
        const safeError = sanitizeError(error);
        // Only log non-test endpoint errors to avoid console spam
        if (!endpoint.includes('/test') && !endpoint.includes('/pipedrive/test')) {
            console.error('API Error:', safeError.message);
        }
        throw safeError;
    }
}

async function refreshSystemStatus(event) {
    try {
        setButtonLoading(elements.refreshStatus, true);
        
        // Get scheduler status
        const schedulerResult = await apiCall('/invoice-processing/status', 'GET', null, { sanitize: false });
        updateSchedulerStatus(schedulerResult.status);
        
        // Test APIs only when manually triggered (not on page load)
        // This prevents 500 errors in console if APIs are not configured
        const isManualRefresh = event && event.type === 'click';
        if (isManualRefresh) {
            await testPipedriveApi();
            await testWfirmaApi();
        }
        
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
            // Check if it's a rate limit error
            const isRateLimit = result.error?.includes('rate limit') || 
                               result.error?.includes('429') ||
                               result.message?.includes('rate limit') ||
                               result.message?.includes('429') ||
                               result.message?.includes('Превышен лимит');
            
            if (isRateLimit) {
                addLog('warn', '⚠️ Превышен лимит запросов к Pipedrive API. Подождите несколько минут и попробуйте снова.');
                showResult('warning', 'Превышен лимит запросов', {
                    error: 'Pipedrive API rate limit exceeded',
                    message: 'Превышен лимит запросов к Pipedrive API. Подождите несколько минут и попробуйте снова.'
                });
            } else {
                addLog('error', `Ошибка получения задач: ${result.error || result.message || 'Unknown error'}`);
                showResult('error', 'Ошибка получения задач', result);
            }
        }
    } catch (error) {
        // Check if it's a rate limit error
        const isRateLimit = error.message?.includes('429') || 
                           error.message?.includes('rate limit') ||
                           error.message?.includes('Too Many Requests');
        
        if (isRateLimit) {
            addLog('warn', '⚠️ Превышен лимит запросов к Pipedrive API. Подождите несколько минут и попробуйте снова.');
            showResult('warning', 'Превышен лимит запросов', {
                error: 'Pipedrive API rate limit exceeded',
                message: 'Превышен лимит запросов к Pipedrive API. Подождите несколько минут и попробуйте снова.'
            });
        } else {
            addLog('error', `Ошибка получения задач: ${error.message}`);
            showResult('error', 'Ошибка получения задач', { error: error.message });
        }
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
        // Use apiCall with error handling that doesn't throw for test endpoints
        const result = await apiCall('/pipedrive/test');
        if (result && result.success) {
            elements.pipedriveStatus.textContent = '✅ Подключен';
            elements.pipedriveStatus.className = 'status-indicator healthy';
            addLog('success', `Pipedrive API: ${result.user?.name || 'Connected'}`);
        } else {
            // Handle gracefully - don't show as error if it's a configuration issue
            const isConfigError = result && (
                result.error?.includes('not configured') || 
                result.error?.includes('not initialized') ||
                result.message?.includes('not configured') ||
                result.message?.includes('not initialized')
            );
            
            if (isConfigError) {
                elements.pipedriveStatus.textContent = '⚠️ Не настроен';
                elements.pipedriveStatus.className = 'status-indicator warning';
                addLog('warn', 'Pipedrive API не настроен (PIPEDRIVE_API_TOKEN отсутствует)');
            } else {
                elements.pipedriveStatus.textContent = '❌ Ошибка';
                elements.pipedriveStatus.className = 'status-indicator error';
                addLog('warn', `Pipedrive API: ${result?.message || result?.error || 'Not configured'}`);
            }
        }
    } catch (error) {
        // This should not happen for test endpoints, but handle gracefully
        const errorMessage = error.message || 'Unknown error';
        if (errorMessage.includes('500') || errorMessage.includes('Internal Server Error')) {
            elements.pipedriveStatus.textContent = '⚠️ Не настроен';
            elements.pipedriveStatus.className = 'status-indicator warning';
            addLog('warn', 'Pipedrive API не настроен или недоступен');
        } else {
            elements.pipedriveStatus.textContent = '❌ Недоступен';
            elements.pipedriveStatus.className = 'status-indicator error';
            addLog('warn', `Pipedrive API: ${errorMessage}`);
        }
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
    if (!status) {
        return;
    }

    const isScheduled = Boolean(status.isScheduled);
    const isProcessing = Boolean(status.isProcessing);
    const indicator = elements.schedulerStatus;
    const info = elements.schedulerInfo;

    if (!indicator || !info) {
        return;
    }

    if (isProcessing) {
        indicator.textContent = '🟡 Выполняется';
        indicator.className = 'status-indicator running';
    } else if (isScheduled) {
        indicator.textContent = '🟢 Автозапуск включен';
        indicator.className = 'status-indicator running';
    } else {
        indicator.textContent = '⚠️ Автозапуск выключен';
        indicator.className = 'status-indicator stopped';
    }

    const lastRun = formatDateTime(status.lastRunAt);
    const nextRun = formatDateTime(status.nextRun);
    const details = [];

    if (status.currentRun) {
        details.push(`Текущий запуск: ${formatRelativeStart(status.currentRun.startedAt)}`);
    } else if (status.lastRunAt) {
        details.push(`Последний запуск: ${lastRun}`);
    } else {
        details.push('Последний запуск: —');
    }

    details.push(`Следующий запуск: ${nextRun}`);

    if (status.retryScheduled) {
        details.push(`Повтор: ${formatDateTime(status.nextRetryAt)} (${formatRelativeTime(status.nextRetryAt)})`);
    }

    info.innerHTML = '';
    details.forEach((line) => {
        const row = document.createElement('div');
        row.textContent = line;
        info.appendChild(row);
    });
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
    if (!button) return;
    if (loading) {
        button.disabled = true;
        button.innerHTML = '<div class="loading"></div> Загрузка...';
    } else {
        button.disabled = false;
        // Restore original text based on button ID
        const originalTexts = {
            'refresh-status': '🔄 Обновить статус',
            'run-polling': '🔍 Запустить Polling',
            'get-pending': '📋 Показать ожидающие',
            'test-apis': '🧪 Тест API',
            'refresh-cron-tasks': '🔄 Обновить список'
        };
        button.innerHTML = originalTexts[button.id] || button.textContent;
    }
}

// Cron Tasks Functions
async function loadCronTasks() {
    if (!elements.cronTasksContainer) return;
    
    try {
        setButtonLoading(elements.refreshCronTasks, true);
        elements.cronTasksContainer.innerHTML = '<div class="placeholder">Загрузка задач...</div>';
        
        const result = await apiCall('/second-payment-scheduler/upcoming-tasks', 'GET', null, { sanitize: false });
        
        if (result.success && result.tasks) {
            displayCronTasks(result.tasks, result.nextRun);
        } else {
            elements.cronTasksContainer.innerHTML = '<div class="placeholder">Ошибка загрузки задач</div>';
        }
    } catch (error) {
        elements.cronTasksContainer.innerHTML = `<div class="placeholder">Ошибка: ${error.message}</div>`;
        addLog('error', `Ошибка загрузки задач cron: ${error.message}`);
    } finally {
        setButtonLoading(elements.refreshCronTasks, false);
    }
}

function displayCronTasks(tasks, nextRun) {
    if (!elements.cronTasksContainer) return;
    
    if (tasks.length === 0) {
        elements.cronTasksContainer.innerHTML = `
            <div class="placeholder">
                <p>Нет задач для создания вторых платежей</p>
                <p style="margin-top: 10px; font-size: 0.9rem; color: #718096;">
                    Следующий запуск: ${nextRun || '09:00 ежедневно'}
                </p>
            </div>
        `;
        return;
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tasksHtml = tasks.map(task => {
        const taskDate = new Date(task.secondPaymentDate);
        taskDate.setHours(0, 0, 0, 0);
        
        let badgeClass = 'upcoming';
        let badgeText = `через ${task.daysUntilSecondPayment} дн.`;
        
        if (task.daysUntilSecondPayment < 0) {
            badgeClass = 'overdue';
            badgeText = `просрочено ${Math.abs(task.daysUntilSecondPayment)} дн.`;
        } else if (task.daysUntilSecondPayment === 0) {
            badgeClass = 'today';
            badgeText = 'сегодня';
        }
        
        // Используем статус из API, если он есть
        const itemClass = task.status || (task.daysUntilSecondPayment < 0 ? 'overdue' : 
                          task.daysUntilSecondPayment <= 3 ? 'upcoming' : '');
        
        // Определяем тип задачи
        const taskTypeLabel = task.type === 'manual_rest' ? 'Ручная задача (остаток)' : 
                             task.type === 'stripe_second_payment' ? 'Автоматическая (Stripe, второй платеж)' :
                             task.type === 'proforma_reminder' ? 'Напоминание (Проформа)' :
                             task.type === 'google_meet_reminder' ? 'Напоминание (Google Meet)' :
                             task.type === 'second_payment' ? 'Автоматическая (второй платеж)' : 
                             'Задача';
        
        return `
            <div class="cron-task-item ${itemClass}" data-task-id="${task.taskId || task.dealId || 'unknown'}-${task.type}-${task.secondPaymentDate || task.scheduledDate || 'unknown'}">
                <div class="cron-task-header">
                    <div>
                        ${task.dealUrl ? `<a href="${task.dealUrl}" target="_blank" class="cron-task-title">Deal #${task.dealId || 'N/A'}</a>` : `<span class="cron-task-title">Deal #${task.dealId || 'N/A'}</span>`}
                        <span class="cron-task-badge ${badgeClass}">${badgeText}</span>
                        ${task.type === 'manual_rest' ? '<span class="cron-task-badge manual" style="background: #805ad5; margin-left: 8px;">Ручная</span>' : ''}
                        ${task.paymentMethod === 'proforma' ? '<span class="cron-task-badge" style="background: #38a169; margin-left: 8px;">Проформа</span>' : ''}
                        ${task.type === 'google_meet_reminder' ? '<span class="cron-task-badge" style="background: #3182ce; margin-left: 8px;">Google Meet</span>' : ''}
                        ${task.type === 'google_meet_reminder' 
                          ? `<button class="cron-task-delete-btn" onclick="deleteGoogleMeetReminder('${task.taskId}', '${task.taskDescription || 'Google Meet'}')" title="Удалить напоминание">×</button>`
                          : (task.dealId ? `<button class="cron-task-delete-btn" onclick="hideCronTask(${task.dealId}, '${task.type}', '${task.secondPaymentDate}')" title="Удалить из очереди">×</button>` : '')
                        }
                    </div>
                    <div class="cron-task-date">${formatDateOnly(task.secondPaymentDate || task.scheduledDate)}</div>
                </div>
                <div class="cron-task-details">
                    <div class="cron-task-detail">
                        <strong>Тип:</strong> ${taskTypeLabel}
                    </div>
                    <div class="cron-task-detail">
                        <strong>Клиент:</strong> ${task.customerEmail}
                    </div>
                    ${task.secondPaymentAmount !== undefined && task.secondPaymentAmount > 0 ? `
                    <div class="cron-task-detail">
                        <strong>Сумма:</strong> ${task.secondPaymentAmount.toFixed(2)} ${task.currency || 'PLN'}
                    </div>
                    ` : ''}
                    ${task.proformaNumber ? `<div class="cron-task-detail"><strong>Проформа:</strong> ${task.proformaNumber}</div>` : ''}
                    ${task.bankAccountNumber ? `<div class="cron-task-detail"><strong>Банковский счет:</strong> ${task.bankAccountNumber}</div>` : ''}
                    ${task.expectedCloseDate ? `<div class="cron-task-detail">
                        <strong>Начало лагеря:</strong> ${formatDateOnly(task.expectedCloseDate)}
                    </div>` : ''}
                    ${task.note ? `<div class="cron-task-detail" style="color: #718096; font-style: italic;">${task.note}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    elements.cronTasksContainer.innerHTML = `
        <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e2e8f0;">
            <strong>Найдено задач: ${tasks.length}</strong>
            <span style="color: #718096; margin-left: 10px; font-size: 0.9rem;">
                Следующий запуск: ${nextRun || '09:00 ежедневно'}
            </span>
        </div>
        ${tasksHtml}
    `;
}

async function hideCronTask(dealId, taskType, secondPaymentDate) {
    if (!confirm(`Удалить задачу Deal #${dealId} из очереди?`)) {
        return;
    }
    
    try {
        const result = await apiCall('/second-payment-scheduler/hide-task', 'POST', {
            dealId,
            taskType,
            secondPaymentDate
        });
        
        if (result.success) {
            addLog('success', `Задача Deal #${dealId} удалена из очереди`);
            // Перезагружаем список задач
            await loadCronTasks();
        } else {
            addLog('error', `Ошибка удаления задачи: ${result.error || result.message}`);
        }
    } catch (error) {
        addLog('error', `Ошибка удаления задачи: ${error.message}`);
    }
}

async function deleteGoogleMeetReminder(taskId, eventSummary) {
    if (!confirm(`Удалить напоминание "${eventSummary}"?`)) {
        return;
    }
    
    try {
        const result = await apiCall(`/google-meet-reminders/${encodeURIComponent(taskId)}`, 'DELETE');
        
        if (result.success) {
            addLog('success', `Напоминание "${eventSummary}" удалено`);
            // Перезагружаем список задач
            await loadCronTasks();
        } else {
            addLog('error', `Ошибка удаления напоминания: ${result.error || result.message}`);
        }
    } catch (error) {
        addLog('error', `Ошибка удаления напоминания: ${error.message}`);
    }
}