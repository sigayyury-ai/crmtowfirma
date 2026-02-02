# Интеграция валидации с сервисом диагностики сделок

**Дата**: 2026-02-02  
**Цель**: Интегрировать информацию о валидации в Deal Diagnostics Service для отображения менеджерам

## Обзор

`DealDiagnosticsService` - это сервис для диагностики сделок, который показывает sales менеджерам полную информацию о состоянии платежей, проблемах и доступных действиях. Валидация должна быть интегрирована в этот сервис, чтобы менеджеры могли видеть ошибки и предупреждения валидации.

## Текущая структура Deal Diagnostics

### Что показывает сейчас:

```javascript
{
  dealId: 123,
  dealInfo: { ... },           // Информация о сделке
  summary: { ... },            // Сводка по платежам
  payments: { ... },          // Все платежи (Stripe, Proforma, Cash)
  proformas: [ ... ],         // Проформы
  refunds: { ... },           // Возвраты
  automations: { ... },       // Автоматизации статусов
  notifications: { ... },     // Уведомления
  issues: [ ... ],            // Проблемы и ошибки
  tasks: [ ... ],             // Задачи из Pipedrive
  cronTasks: { ... },         // Cron задачи
  availableActions: [ ... ],  // Доступные действия
  paymentSchedules: { ... }   // Графики платежей
}
```

### Структура issues:

```javascript
{
  severity: 'critical' | 'warning' | 'info',
  category: 'deal' | 'proformas' | 'stripe' | 'currency' | 'amounts' | 'schedule',
  code: 'DEAL_NOT_FOUND' | 'NO_PROFORMAS' | 'CURRENCY_MISMATCH' | ...,
  message: 'Человекочитаемое сообщение',
  details: { ... }
}
```

---

## Интеграция валидации

### Что нужно добавить:

1. **Получение ошибок валидации** из таблицы `validation_errors`
2. **Получение предупреждений валидации** (severity='warning')
3. **Проверка текущего состояния валидации** (если сессия еще не создана)
4. **Отображение в issues** с соответствующими severity и category

---

## Новый раздел: Validation

### Структура данных валидации в диагностике:

```javascript
{
  validation: {
    // Текущее состояние валидации (если сессия еще не создана)
    currentStatus: {
      valid: boolean,
      errors: [ ... ],
      warnings: [ ... ],
      missing_fields: [ ... ],
      invalid_fields: [ ... ],
      field_errors: { ... }
    },
    
    // История ошибок валидации из БД
    validationErrors: [
      {
        id: 'uuid',
        process_type: 'session_creation',
        errors: [ ... ],
        field_errors: { ... },
        missing_fields: [ ... ],
        invalid_fields: [ ... ],
        status: 'pending' | 'resolved' | 'ignored',
        severity: 'error' | 'warning',
        created_at: '2026-02-02T10:00:00Z',
        resolved_at: null,
        resolved_by: null
      }
    ],
    
    // История предупреждений валидации
    validationWarnings: [
      {
        id: 'uuid',
        process_type: 'session_creation',
        warnings: [ ... ],
        field: 'notification_channel_id',
        message: 'SendPulse ID or Telegram Chat ID not found',
        severity: 'warning',
        created_at: '2026-02-02T10:00:00Z'
      }
    ],
    
    // Последняя попытка создания сессии
    lastValidationAttempt: {
      timestamp: '2026-02-02T10:00:00Z',
      success: false,
      errors: [ ... ],
      warnings: [ ... ]
    },
    
    // Рекомендации для менеджера
    recommendations: [
      {
        field: 'product',
        action: 'add_product',
        message: 'Добавьте продукт в сделку для создания платежной сессии',
        priority: 'high'
      },
      {
        field: 'notification_channel_id',
        action: 'add_sendpulse_id',
        message: 'Рекомендуется добавить SendPulse ID для улучшения коммуникации',
        priority: 'low'
      }
    ]
  }
}
```

---

## Новые issues для валидации

### Issue: Ошибки валидации (блокируют создание сессии)

```javascript
{
  severity: 'critical',
  category: 'validation',
  code: 'VALIDATION_ERRORS',
  message: 'Обнаружены ошибки валидации, блокирующие создание платежной сессии',
  details: {
    errors: [
      {
        field: 'product',
        message: 'Product is required - deal must have at least one product',
        code: 'REQUIRED_FIELD'
      },
      {
        field: 'address',
        message: 'Address is required - customer address must be specified',
        code: 'REQUIRED_FIELD'
      }
    ],
    missing_fields: ['product', 'address'],
    invalid_fields: [],
    field_errors: {
      product: 'Product is required',
      address: 'Address is required'
    },
    validation_error_id: 'uuid',
    created_at: '2026-02-02T10:00:00Z',
    action_required: 'Исправьте ошибки и перезапустите создание сессии',
    can_retry: true
  }
}
```

### Issue: Предупреждения валидации (не блокируют)

```javascript
{
  severity: 'warning',
  category: 'validation',
  code: 'VALIDATION_WARNINGS',
  message: 'Обнаружены предупреждения валидации (сессия может быть создана, но рекомендуется исправить)',
  details: {
    warnings: [
      {
        field: 'notification_channel_id',
        message: 'SendPulse ID or Telegram Chat ID not found - notifications will be sent via email only',
        code: 'MISSING_NOTIFICATION_CHANNEL',
        severity: 'warning'
      }
    ],
    validation_warning_id: 'uuid',
    created_at: '2026-02-02T10:00:00Z',
    action_required: 'Рекомендуется добавить SendPulse ID или Telegram Chat ID для улучшения коммуникации',
    can_retry: false // Сессия уже создана, предупреждение информационное
  }
}
```

### Issue: B2B специфичные ошибки

```javascript
{
  severity: 'critical',
  category: 'validation',
  code: 'B2B_VALIDATION_ERROR',
  message: 'Для B2B сделки отсутствуют обязательные данные',
  details: {
    errors: [
      {
        field: 'organization',
        message: 'Organization is required for B2B deals',
        code: 'REQUIRED_FIELD'
      },
      {
        field: 'company_tax_id',
        message: 'Business ID (NIP/VAT) is required for B2B deals',
        code: 'REQUIRED_FIELD'
      }
    ],
    missing_fields: ['organization', 'company_tax_id'],
    deal_type: 'B2B',
    action_required: 'Создайте Organization в CRM и заполните Business ID (NIP/VAT)',
    can_retry: true
  }
}
```

---

## Метод получения валидации

### Новый метод в DealDiagnosticsService:

```javascript
async getValidationInfo(dealId) {
  try {
    if (!this.supabase) return null;
    
    // 1. Получить ошибки валидации из БД
    const { data: validationErrors } = await this.supabase
      .from('validation_errors')
      .select('*')
      .eq('deal_id', String(dealId))
      .order('created_at', { ascending: false });
    
    // Разделить на ошибки и предупреждения
    const errors = (validationErrors || []).filter(e => e.severity === 'error');
    const warnings = (validationErrors || []).filter(e => e.severity === 'warning');
    
    // 2. Получить последнюю попытку валидации
    const lastError = errors[0] || null;
    const lastWarning = warnings[0] || null;
    
    // 3. Проверить текущее состояние валидации (если сессия еще не создана)
    let currentStatus = null;
    const hasUnpaidSessions = await this.checkUnpaidSessions(dealId);
    
    if (!hasUnpaidSessions && !lastError) {
      // Сессия еще не создана, можно проверить текущее состояние
      const ValidationService = require('./microservices/validationService');
      const validationService = new ValidationService();
      
      // Получить данные сделки для валидации
      const dealResult = await this.pipedriveClient.getDealWithRelatedData(dealId);
      if (dealResult.success && dealResult.deal) {
        // Подготовить данные для валидации (аналогично quickstart.md)
        const validationData = { /* ... */ };
        currentStatus = await validationService.validateSessionData(validationData);
      }
    }
    
    // 4. Сформировать рекомендации
    const recommendations = this.generateValidationRecommendations({
      errors,
      warnings,
      currentStatus
    });
    
    return {
      currentStatus,
      validationErrors: errors,
      validationWarnings: warnings,
      lastValidationAttempt: lastError || lastWarning || null,
      recommendations
    };
  } catch (error) {
    this.logger.warn('Error fetching validation info', { dealId, error: error.message });
    return null;
  }
}
```

---

## Интеграция в analyzeIssues

### Добавление валидационных issues:

```javascript
analyzeIssues({ dealInfo, payments, proformas, refunds, cashPayments, automations, notifications, initialPaymentSchedule, currentPaymentSchedule, validation }) {
  const issues = [];
  
  // ... существующие проверки ...
  
  // Проверка валидации: Ошибки (блокируют создание сессии)
  if (validation && validation.validationErrors && validation.validationErrors.length > 0) {
    const unresolvedErrors = validation.validationErrors.filter(e => 
      e.status === 'pending' || e.status === null
    );
    
    if (unresolvedErrors.length > 0) {
      const latestError = unresolvedErrors[0];
      
      issues.push({
        severity: 'critical',
        category: 'validation',
        code: 'VALIDATION_ERRORS',
        message: 'Обнаружены ошибки валидации, блокирующие создание платежной сессии',
        details: {
          errors: latestError.errors || [],
          missing_fields: latestError.missing_fields || [],
          invalid_fields: latestError.invalid_fields || [],
          field_errors: latestError.field_errors || {},
          validation_error_id: latestError.id,
          created_at: latestError.created_at,
          process_type: latestError.process_type,
          action_required: 'Исправьте ошибки и перезапустите создание сессии',
          can_retry: true,
          recommendations: validation.recommendations?.filter(r => 
            latestError.missing_fields?.includes(r.field) || 
            latestError.invalid_fields?.includes(r.field)
          ) || []
        }
      });
    }
  }
  
  // Проверка валидации: Предупреждения (не блокируют)
  if (validation && validation.validationWarnings && validation.validationWarnings.length > 0) {
    const recentWarnings = validation.validationWarnings.filter(w => {
      const warningDate = new Date(w.created_at);
      const daysAgo = (Date.now() - warningDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysAgo <= 7; // Показывать предупреждения за последние 7 дней
    });
    
    if (recentWarnings.length > 0) {
      issues.push({
        severity: 'warning',
        category: 'validation',
        code: 'VALIDATION_WARNINGS',
        message: 'Обнаружены предупреждения валидации (рекомендуется исправить)',
        details: {
          warnings: recentWarnings.map(w => ({
            field: w.field || 'unknown',
            message: w.errors?.[0]?.message || w.message || 'Validation warning',
            code: w.errors?.[0]?.code || 'WARNING',
            created_at: w.created_at
          })),
          action_required: 'Рекомендуется исправить предупреждения для улучшения качества данных',
          recommendations: validation.recommendations?.filter(r => 
            recentWarnings.some(w => w.field === r.field)
          ) || []
        }
      });
    }
  }
  
  // Проверка валидации: Текущее состояние (если сессия еще не создана)
  if (validation && validation.currentStatus && !validation.currentStatus.valid) {
    issues.push({
      severity: 'info',
      category: 'validation',
      code: 'CURRENT_VALIDATION_FAILED',
      message: 'Текущее состояние данных не проходит валидацию для создания сессии',
      details: {
        errors: validation.currentStatus.errors || [],
        warnings: validation.currentStatus.warnings || [],
        missing_fields: validation.currentStatus.missing_fields || [],
        invalid_fields: validation.currentStatus.invalid_fields || [],
        note: 'Это предварительная проверка. Исправьте ошибки перед созданием сессии.',
        recommendations: validation.recommendations || []
      }
    });
  }
  
  return issues;
}
```

---

## Обновление getDealDiagnostics

### Добавление валидации в основной метод:

```javascript
async getDealDiagnostics(dealId) {
  // ... существующий код ...
  
  // 11. Получаем информацию о валидации
  const validation = await this.getValidationInfo(dealId);
  
  // 12. Анализируем проблемы (добавляем validation в параметры)
  const issues = this.analyzeIssues({
    dealInfo,
    payments,
    proformas,
    refunds,
    cashPayments,
    automations,
    notifications,
    initialPaymentSchedule,
    currentPaymentSchedule,
    validation // Добавляем валидацию
  });
  
  // ... остальной код ...
  
  return {
    success: true,
    dealId: parseInt(dealId),
    dealInfo,
    summary,
    payments,
    proformas,
    refunds,
    cashPayments,
    automations,
    notifications,
    validation, // Добавляем валидацию в ответ
    issues,
    tasks,
    cronTasks,
    availableActions,
    paymentSchedules: {
      initial: initialPaymentSchedule,
      current: currentPaymentSchedule
    },
    stripeSearchHint,
    generatedAt: new Date().toISOString()
  };
}
```

---

## Отображение в UI

### Пример отображения валидации в диагностике:

```html
<!-- Секция валидации -->
<section class="validation-section">
  <h3>🔍 Валидация данных</h3>
  
  <!-- Ошибки валидации -->
  <div v-if="validation.validationErrors.length > 0" class="validation-errors">
    <h4>❌ Ошибки (блокируют создание сессии)</h4>
    <ul>
      <li v-for="error in validation.validationErrors" :key="error.id">
        <strong>{{ error.field_errors }}</strong>
        <p>{{ error.message }}</p>
        <small>Создано: {{ error.created_at }}</small>
        <button v-if="error.can_retry" @click="retrySessionCreation">
          Исправить и перезапустить
        </button>
      </li>
    </ul>
  </div>
  
  <!-- Предупреждения валидации -->
  <div v-if="validation.validationWarnings.length > 0" class="validation-warnings">
    <h4>⚠️ Предупреждения (не блокируют)</h4>
    <ul>
      <li v-for="warning in validation.validationWarnings" :key="warning.id">
        <strong>{{ warning.field }}</strong>
        <p>{{ warning.message }}</p>
        <small>Создано: {{ warning.created_at }}</small>
      </li>
    </ul>
  </div>
  
  <!-- Рекомендации -->
  <div v-if="validation.recommendations.length > 0" class="validation-recommendations">
    <h4>💡 Рекомендации</h4>
    <ul>
      <li v-for="rec in validation.recommendations" :key="rec.field">
        <strong>{{ rec.field }}</strong>: {{ rec.message }}
        <span class="priority" :class="rec.priority">{{ rec.priority }}</span>
      </li>
    </ul>
  </div>
  
  <!-- Текущее состояние (если сессия еще не создана) -->
  <div v-if="validation.currentStatus" class="current-validation-status">
    <h4>📊 Текущее состояние валидации</h4>
    <div :class="{ valid: validation.currentStatus.valid, invalid: !validation.currentStatus.valid }">
      <span v-if="validation.currentStatus.valid">✅ Все поля валидны</span>
      <span v-else>❌ Обнаружены проблемы</span>
    </div>
  </div>
</section>
```

---

## API Endpoint

### Обновление существующего endpoint:

```
GET /api/pipedrive/deals/:id/diagnostics
```

**Ответ теперь включает**:
```json
{
  "success": true,
  "dealId": 123,
  "dealInfo": { ... },
  "payments": { ... },
  "validation": {
    "currentStatus": { ... },
    "validationErrors": [ ... ],
    "validationWarnings": [ ... ],
    "lastValidationAttempt": { ... },
    "recommendations": [ ... ]
  },
  "issues": [
    {
      "severity": "critical",
      "category": "validation",
      "code": "VALIDATION_ERRORS",
      "message": "Обнаружены ошибки валидации",
      "details": { ... }
    }
  ],
  ...
}
```

---

## Интеграция с доступными действиями

### Новое действие: Retry Session Creation

```javascript
determineAvailableActions({ dealInfo, payments, proformas, notifications, issues, tasks, cronTasks, validation }) {
  const actions = [];
  
  // ... существующие действия ...
  
  // Действие: Перезапустить создание сессии после исправления ошибок валидации
  if (validation && validation.validationErrors && validation.validationErrors.length > 0) {
    const unresolvedErrors = validation.validationErrors.filter(e => 
      e.status === 'pending' || e.status === null
    );
    
    if (unresolvedErrors.length > 0) {
      actions.push({
        id: 'retry-session-creation',
        label: 'Исправить ошибки и перезапустить создание сессии',
        endpoint: `/api/pipedrive/deals/${dealInfo.dealId}/diagnostics/actions/create-stripe-session`,
        method: 'POST',
        description: 'После исправления ошибок валидации можно перезапустить создание сессии',
        requires: {
          fields: unresolvedErrors[0].missing_fields || [],
          validation: true
        },
        available: true
      });
    }
  }
  
  return actions;
}
```

---

## Пример использования

### Сценарий: Менеджер открывает диагностику сделки

```
1. Менеджер открывает: GET /api/pipedrive/deals/123/diagnostics
2. Система получает:
   - Информацию о сделке
   - Все платежи
   - Ошибки валидации из БД
   - Текущее состояние валидации (если сессия не создана)
3. Система анализирует проблемы:
   - Обнаруживает ошибки валидации
   - Добавляет их в issues с severity='critical'
   - Формирует рекомендации
4. Менеджер видит:
   - ❌ Ошибки валидации: отсутствует продукт, адрес
   - 💡 Рекомендации: добавить продукт в сделку, заполнить адрес клиента
   - 🔄 Действие: "Исправить ошибки и перезапустить создание сессии"
5. Менеджер исправляет данные в CRM
6. Менеджер нажимает "Перезапустить создание сессии"
7. Система выполняет валидацию снова
8. Если валидация успешна → сессия создается
9. Ошибки валидации помечаются как resolved
```

---

## Итог

**Deal Diagnostics Service должен показывать**:
- ✅ Ошибки валидации из БД (блокирующие создание сессии)
- ✅ Предупреждения валидации (не блокирующие)
- ✅ Текущее состояние валидации (если сессия еще не создана)
- ✅ Рекомендации по исправлению ошибок
- ✅ Возможность перезапустить создание сессии после исправления

**Интеграция**:
- ValidationService используется для проверки текущего состояния
- Данные из таблицы `validation_errors` отображаются в диагностике
- Issues включают валидационные проблемы
- Available Actions включают действие "Перезапустить создание сессии"
