/**
 * Check for duplicate payments/expenses
 */
async function checkDuplicates() {
  const year = parseInt(elements.yearSelect?.value || new Date().getFullYear(), 10);
  const month = new Date().getMonth() + 1; // Current month
  
  if (!year) {
    alert('Пожалуйста, выберите год');
    return;
  }

  try {
    addLog('info', `Проверка дублей за ${monthNames[month]} ${year}`);
    
    // Check expenses first (most common duplicates)
    const expensesUrl = `${API_BASE}/pnl/duplicates?year=${year}&month=${month}&direction=out`;
    addLog('info', `Запрос: ${expensesUrl}`);
    
    const expensesResponse = await fetch(expensesUrl);
    const expensesResult = await expensesResponse.json();
    
    if (!expensesResponse.ok || !expensesResult.success) {
      throw new Error(expensesResult.error || `HTTP ${expensesResponse.status}`);
    }
    
    const expenseDuplicates = expensesResult.data || [];
    
    // Check revenue duplicates
    const revenueUrl = `${API_BASE}/pnl/duplicates?year=${year}&month=${month}&direction=in`;
    const revenueResponse = await fetch(revenueUrl);
    const revenueResult = await revenueResponse.json();
    
    const revenueDuplicates = revenueResult.success ? (revenueResult.data || []) : [];
    
    const allDuplicates = [
      ...expenseDuplicates.map(d => ({ ...d, direction: 'out' })),
      ...revenueDuplicates.map(d => ({ ...d, direction: 'in' }))
    ];
    
    if (allDuplicates.length === 0) {
      addLog('success', 'Дубли не найдены');
      alert('Дубли не найдены за выбранный период');
      return;
    }
    
    addLog('success', `Найдено групп дублей: ${allDuplicates.length}`);
    showDuplicatesModal(allDuplicates, year, month);
    
  } catch (error) {
    addLog('error', `Ошибка проверки дублей: ${error.message}`);
    alert('Ошибка: ' + error.message);
  }
}

/**
 * Show duplicates modal
 */
function showDuplicatesModal(duplicates, year, month) {
  const modal = document.getElementById('duplicates-modal');
  const container = document.getElementById('duplicates-container');
  const title = document.getElementById('duplicates-modal-title');
  
  if (!modal || !container) {
    addLog('error', 'Модальное окно дублей не найдено');
    return;
  }
  
  modal.style.display = 'block';
  
  if (title) {
    const monthName = monthNames[month] || `Месяц ${month}`;
    title.textContent = `Дубли за ${monthName} ${year} (${duplicates.length} групп)`;
  }
  
  // Format currency
  function formatCurrency(amount, currency = 'PLN') {
    const numAmount = parseFloat(amount) || 0;
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: currency || 'PLN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numAmount);
  }
  
  // Format date
  function formatDate(dateString) {
    if (!dateString) return 'Не указана';
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }
  
  const html = `
    <div style="max-height: 70vh; overflow-y: auto;">
      ${duplicates.map((dup, idx) => `
        <div class="duplicate-group" style="margin-bottom: 30px; padding: 15px; border: 2px solid #ffc107; border-radius: 8px; background: #fffbf0;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <div>
              <h4 style="margin: 0; color: #856404;">Группа ${idx + 1}: ${escapeHtml(dup.payer)}</h4>
              <div style="margin-top: 5px; color: #666;">
                Сумма: <strong>${formatCurrency(dup.amount, dup.currency)}</strong> • 
                Количество дублей: <strong>${dup.count}</strong>
              </div>
            </div>
            <button class="btn btn-sm" onclick="deleteAllDuplicatesInGroup(${idx}, '${dup.direction}')" 
                    style="background: #dc3545; color: white; padding: 6px 12px;">
              Удалить все кроме первого
            </button>
          </div>
          <div style="display: grid; gap: 10px;">
            ${dup.payments.map((payment, pIdx) => `
              <div class="duplicate-payment-item" style="display: grid; grid-template-columns: 1fr 120px 150px 100px; gap: 10px; padding: 10px; background: ${pIdx === 0 ? '#e7f3ff' : '#fff'}; border-left: 4px solid ${pIdx === 0 ? '#0066cc' : '#ffc107'}; border-radius: 4px;">
                <div>
                  <div style="font-weight: 500;">${escapeHtml(payment.payer)}</div>
                  ${payment.description ? `<div style="font-size: 0.9em; color: #666; margin-top: 4px;">${escapeHtml(payment.description)}</div>` : ''}
                  ${pIdx === 0 ? '<div style="font-size: 0.85em; color: #0066cc; margin-top: 4px;">✓ Оставить (первый)</div>' : ''}
                </div>
                <div style="font-size: 0.9em;">${formatDate(payment.date)}</div>
                <div style="font-weight: 600; color: ${dup.direction === 'out' ? '#dc3545' : '#10b981'};">
                  ${formatCurrency(payment.amount, payment.currency)}
                </div>
                <div>
                  ${pIdx > 0 ? `
                    <button class="btn btn-link btn-sm" onclick="deleteDuplicatePayment(${payment.id}, '${dup.direction}')" 
                            style="color: #dc3545; padding: 4px 8px; font-size: 0.85em;">
                      Удалить дубль
                    </button>
                  ` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
  
  container.innerHTML = html;
}

/**
 * Close duplicates modal
 */
function closeDuplicatesModal() {
  const modal = document.getElementById('duplicates-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

/**
 * Delete duplicate payment
 */
async function deleteDuplicatePayment(paymentId, direction) {
  if (!confirm('Вы уверены, что хотите пометить этот платеж как дубль и удалить?')) {
    return;
  }

  try {
    addLog('info', `Удаление дубля: paymentId=${paymentId}, direction=${direction}`);
    
    const endpoint = direction === 'out' 
      ? `${API_BASE}/pnl/expenses/${paymentId}/delete`
      : `${API_BASE}/pnl/payments/${paymentId}/delete`;
    
    const body = direction === 'out' 
      ? {}
      : { source: 'bank' };
    
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || `HTTP ${response.status}`);
    }

    addLog('success', `Дубль успешно удален`);
    
    // Refresh duplicates list
    await checkDuplicates();
    
    // Refresh PNL report totals
    await refreshPnlReportSilently();
    
  } catch (error) {
    addLog('error', `Ошибка удаления дубля: ${error.message}`);
    alert('Ошибка: ' + error.message);
  }
}

/**
 * Delete all duplicates in group except the first one
 */
async function deleteAllDuplicatesInGroup(groupIndex, direction) {
  const modal = document.getElementById('duplicates-modal');
  const container = document.getElementById('duplicates-container');
  if (!modal || !container) return;
  
  const duplicateGroups = Array.from(container.querySelectorAll('.duplicate-group'));
  if (groupIndex >= duplicateGroups.length) return;
  
  const group = duplicateGroups[groupIndex];
  const paymentItems = Array.from(group.querySelectorAll('.duplicate-payment-item'));
  
  // Skip first payment (index 0), delete the rest
  const paymentsToDelete = paymentItems.slice(1);
  
  if (paymentsToDelete.length === 0) {
    alert('Нет дублей для удаления');
    return;
  }
  
  if (!confirm(`Вы уверены, что хотите удалить ${paymentsToDelete.length} дублей из этой группы? Будет оставлен только первый платеж.`)) {
    return;
  }

  try {
    addLog('info', `Удаление ${paymentsToDelete.length} дублей из группы ${groupIndex + 1}`);
    
    // Extract payment IDs from buttons
    const deletePromises = paymentsToDelete.map(item => {
      const button = item.querySelector('button[onclick*="deleteDuplicatePayment"]');
      if (!button) return null;
      
      const onclick = button.getAttribute('onclick');
      const match = onclick.match(/deleteDuplicatePayment\((\d+),/);
      if (!match) return null;
      
      const paymentId = parseInt(match[1], 10);
      return deleteDuplicatePayment(paymentId, direction);
    }).filter(p => p !== null);
    
    await Promise.all(deletePromises);
    
    addLog('success', `Все дубли из группы удалены`);
    
    // Refresh duplicates list
    await checkDuplicates();
    
    // Refresh PNL report totals
    await refreshPnlReportSilently();
    
  } catch (error) {
    addLog('error', `Ошибка удаления дублей: ${error.message}`);
    alert('Ошибка: ' + error.message);
  }
}


