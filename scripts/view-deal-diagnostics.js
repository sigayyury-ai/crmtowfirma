#!/usr/bin/env node

/**
 * Просмотр диагностики сделки - как видит менеджер
 * 
 * Показывает полную диагностику сделки, включая ошибки валидации
 * 
 * Usage:
 *   node scripts/view-deal-diagnostics.js <dealId>
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const DealDiagnosticsService = require('../src/services/dealDiagnosticsService');
const logger = require('../src/utils/logger');

async function viewDealDiagnostics(dealId) {
  try {
    console.log(`📊 Диагностика Deal #${dealId}\n`);
    console.log('='.repeat(70));

    const diagnosticsService = new DealDiagnosticsService();
    const diagnostics = await diagnosticsService.getDealDiagnostics(dealId);

    if (!diagnostics.success) {
      console.error('❌ Ошибка получения диагностики:', diagnostics.error);
      process.exit(1);
    }

    // Основная информация о сделке
    console.log('\n📋 Информация о сделке:');
    console.log('-'.repeat(70));
    console.log(`   Название: ${diagnostics.dealInfo.title || 'N/A'}`);
    console.log(`   Статус: ${diagnostics.dealInfo.status || 'N/A'}`);
    console.log(`   Сумма: ${diagnostics.dealInfo.value || 0} ${diagnostics.dealInfo.currency || 'PLN'}`);
    console.log(`   Email: ${diagnostics.dealInfo.personEmail || 'N/A'}`);

    // Валидация
    if (diagnostics.validation) {
      console.log('\n🔍 Валидация данных:');
      console.log('-'.repeat(70));
      
      const validation = diagnostics.validation;
      
      // Ошибки валидации
      if (validation.validationErrors && validation.validationErrors.length > 0) {
        console.log('\n❌ Ошибки валидации (блокируют создание сессии):');
        validation.validationErrors.forEach((err, i) => {
          console.log(`\n   ${i + 1}. Ошибка #${err.id.substring(0, 8)}...`);
          console.log(`      Тип процесса: ${err.process_type}`);
          console.log(`      Статус: ${err.status}`);
          console.log(`      Создано: ${new Date(err.created_at).toLocaleString()}`);
          
          if (err.missing_fields && err.missing_fields.length > 0) {
            console.log(`      ❌ Недостающие поля: ${err.missing_fields.join(', ')}`);
          }
          
          if (err.invalid_fields && err.invalid_fields.length > 0) {
            console.log(`      ⚠️  Некорректные поля: ${err.invalid_fields.join(', ')}`);
          }
          
          if (err.errors && err.errors.length > 0) {
            console.log(`      Детали ошибок:`);
            err.errors.forEach(e => {
              console.log(`         • ${e.field}: ${e.message}`);
            });
          }
          
          if (err.field_errors) {
            console.log(`      Ошибки по полям:`);
            Object.entries(err.field_errors).forEach(([field, message]) => {
              console.log(`         • ${field}: ${message}`);
            });
          }
        });
      } else {
        console.log('   ✅ Ошибок валидации нет');
      }

      // Предупреждения валидации
      if (validation.validationWarnings && validation.validationWarnings.length > 0) {
        console.log('\n⚠️  Предупреждения валидации (не блокируют создание сессии):');
        validation.validationWarnings.forEach((warn, i) => {
          console.log(`\n   ${i + 1}. Предупреждение #${warn.id.substring(0, 8)}...`);
          console.log(`      Создано: ${new Date(warn.created_at).toLocaleString()}`);
          
          if (warn.errors && warn.errors.length > 0) {
            warn.errors.forEach(e => {
              console.log(`      • ${e.field}: ${e.message}`);
            });
          }
        });
      } else {
        console.log('   ✅ Предупреждений валидации нет');
      }

      // Рекомендации
      if (validation.recommendations && validation.recommendations.length > 0) {
        console.log('\n💡 Рекомендации по исправлению:');
        validation.recommendations.forEach((rec, i) => {
          const priorityIcon = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
          console.log(`   ${i + 1}. ${priorityIcon} ${rec.field}: ${rec.message}`);
        });
      }
    } else {
      console.log('\n🔍 Валидация: Данные не получены');
    }

    // Issues (проблемы)
    if (diagnostics.issues && diagnostics.issues.length > 0) {
      console.log('\n🚨 Проблемы и ошибки:');
      console.log('-'.repeat(70));
      
      diagnostics.issues.forEach((issue, i) => {
        const severityIcon = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
        const severityText = issue.severity === 'critical' ? 'КРИТИЧНО' : issue.severity === 'warning' ? 'ПРЕДУПРЕЖДЕНИЕ' : 'ИНФО';
        
        console.log(`\n   ${i + 1}. ${severityIcon} [${severityText}] ${issue.category.toUpperCase()}`);
        console.log(`      ${issue.message}`);
        
        if (issue.code === 'VALIDATION_ERRORS' && issue.details) {
          console.log(`      Код: ${issue.code}`);
          console.log(`      Действие: ${issue.details.action_required || 'Исправьте ошибки'}`);
          console.log(`      Можно перезапустить: ${issue.details.can_retry ? '✅ Да' : '❌ Нет'}`);
          
          if (issue.details.missing_fields && issue.details.missing_fields.length > 0) {
            console.log(`      Недостающие поля: ${issue.details.missing_fields.join(', ')}`);
          }
          
          if (issue.details.recommendations && issue.details.recommendations.length > 0) {
            console.log(`      Рекомендации:`);
            issue.details.recommendations.forEach(rec => {
              console.log(`         • ${rec.field}: ${rec.message}`);
            });
          }
        }
      });
    } else {
      console.log('\n✅ Проблем не обнаружено');
    }

    // Доступные действия
    if (diagnostics.availableActions && diagnostics.availableActions.length > 0) {
      console.log('\n⚡ Доступные действия:');
      console.log('-'.repeat(70));
      
      diagnostics.availableActions.forEach((action, i) => {
        console.log(`   ${i + 1}. ${action.label}`);
        if (action.description) {
          console.log(`      ${action.description}`);
        }
        if (action.endpoint) {
          console.log(`      Endpoint: ${action.method || 'POST'} ${action.endpoint}`);
        }
      });
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ Диагностика завершена');
    console.log('\n💡 Для просмотра в браузере откройте:');
    console.log(`   http://localhost:3000/frontend/deal-diagnostics.html?dealId=${dealId}`);
    console.log(`   или через API: GET /api/pipedrive/deals/${dealId}/diagnostics`);

  } catch (error) {
    console.error('\n❌ Ошибка при получении диагностики:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Парсинг аргументов
const args = process.argv.slice(2);
const dealId = args[0];

if (!dealId) {
  console.error('Usage: node scripts/view-deal-diagnostics.js <dealId>');
  console.error('\nПример:');
  console.error('  node scripts/view-deal-diagnostics.js 2109');
  process.exit(1);
}

viewDealDiagnostics(dealId);
