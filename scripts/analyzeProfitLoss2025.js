#!/usr/bin/env node

/**
 * Детальный анализ прибыли/убытка за 2025 год
 * Показывает почему получился убыток -30 487,06 PLN
 */

require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const PnlReportService = require('../src/services/pnl/pnlReportService');
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');

if (!supabase) {
  console.error('❌ Supabase client is not configured.');
  process.exit(1);
}

const YEAR = 2025;

function formatPln(value) {
  const n = Number(value) || 0;
  return `${n.toFixed(2).replace('.', ',')} PLN`;
}

function findCategoryByName(categories, name) {
  if (!Array.isArray(categories)) return null;
  const target = (name || '').trim().toLowerCase();
  if (!target) return null;
  return categories.find((cat) => (cat.name || '').trim().toLowerCase() === target) || null;
}

async function main() {
  console.log('🔍 Детальный анализ прибыли/убытка за 2025 год\n');
  console.log('='.repeat(80));

  const pnlService = new PnlReportService();
  const expenseCategoryService = new ExpenseCategoryService();

  try {
    const [pnl, expenseCategories] = await Promise.all([
      pnlService.getMonthlyRevenue(YEAR, false),
      expenseCategoryService.listCategories()
    ]);

    // ========== ДОХОДЫ ==========
    console.log('\n📊 ДОХОДЫ:');
    console.log('-'.repeat(80));
    
    const totalRevenueAll = Number(pnl.total?.amountPln || 0);
    console.log(`Общая сумма доходов (все категории): ${formatPln(totalRevenueAll)}`);

    const categories = Array.isArray(pnl.categories) ? pnl.categories : [];
    const cashCategory = findCategoryByName(categories, 'Наличные') || findCategoryByName(categories, 'Cash');
    const cashRevenue = cashCategory ? Number(cashCategory.total?.amountPln || 0) : 0;
    
    if (cashCategory) {
      console.log(`  └─ Исключено (категория "${cashCategory.name}"): ${formatPln(cashRevenue)}`);
    } else {
      console.log(`  └─ Категория "Наличные" не найдена, исключений нет`);
    }

    const revenueNet = totalRevenueAll - cashRevenue;
    console.log(`\n✅ ЧИСТЫЕ ДОХОДЫ (после исключения наличных): ${formatPln(revenueNet)}`);

    // Детализация по категориям доходов
    console.log('\nДетализация доходов по категориям:');
    categories.forEach((cat) => {
      const amount = Number(cat.total?.amountPln || 0);
      if (amount !== 0) {
        const isExcluded = cashCategory && cat.id === cashCategory.id;
        const marker = isExcluded ? '❌ (исключено)' : '✓';
        console.log(`  ${marker} ${cat.name || 'Без названия'}: ${formatPln(amount)}`);
      }
    });

    // ========== РАСХОДЫ ==========
    console.log('\n\n💰 РАСХОДЫ:');
    console.log('-'.repeat(80));

    const expensesFromReport = Array.isArray(pnl.expenses) ? pnl.expenses : [];
    const expensesTotal = Number(pnl.expensesTotal?.amountPln || 0);
    console.log(`Общая сумма расходов: ${formatPln(expensesTotal)}`);
    console.log(`Количество категорий расходов: ${expensesFromReport.length}`);

    // Детализация расходов по категориям
    console.log('\nДетализация расходов по категориям:');
    const nameById = new Map();
    (expenseCategories || []).forEach((cat) => {
      if (cat && cat.id != null) {
        nameById.set(cat.id, (cat.name || '').trim());
      }
    });

    let expensesSum = 0;
    expensesFromReport.forEach((cat) => {
      if (!cat) return;
      const catId = cat.id;
      const catNameRaw = nameById.get(catId) || cat.name || 'Без названия';
      const amount = Number(cat.total?.amountPln || 0);
      if (Number.isFinite(amount) && amount !== 0) {
        expensesSum += amount;
        console.log(`  • ${catNameRaw}: ${formatPln(amount)}`);
      }
    });

    if (Math.abs(expensesSum - expensesTotal) > 0.01) {
      console.log(`\n⚠️  Внимание: сумма по категориям (${formatPln(expensesSum)}) не совпадает с общей суммой (${formatPln(expensesTotal)})`);
    }

    // Группировка расходов по корзинам
    console.log('\n\n📦 ГРУППИРОВКА РАСХОДОВ ПО КОРЗИНАМ:');
    console.log('-'.repeat(80));

    const buckets = {
      wynagrodzeniaZarzadu: 0,
      zusZdrowotne: 0,
      uslugiObce: 0,
      softwareHosting: 0,
      marketing: 0,
      inne: 0
    };

    expensesFromReport.forEach((cat) => {
      if (!cat) return;
      const catId = cat.id;
      const catNameRaw = nameById.get(catId) || cat.name || '';
      const name = (catNameRaw || '').toLowerCase();
      const amount = Number(cat.total?.amountPln || 0);
      if (!Number.isFinite(amount) || amount === 0) return;

      if (name.includes('salary') || name.includes('зарплат') || name.includes('na вывод')) {
        buckets.wynagrodzeniaZarzadu += amount;
      } else if (name.includes('zus')) {
        buckets.zusZdrowotne += amount;
      } else if (name.includes('услуги') || name.includes('works') || name.includes('services')) {
        buckets.uslugiObce += amount;
      } else if (name.includes('tools') || name.includes('software') || name.includes('hosting') || name.includes('saas')) {
        buckets.softwareHosting += amount;
      } else if (name.includes('marketing') || name.includes('advertising') || name.includes('ads')) {
        buckets.marketing += amount;
      } else {
        buckets.inne += amount;
      }
    });

    console.log(`  • Зарплаты: ${formatPln(buckets.wynagrodzeniaZarzadu)}`);
    console.log(`  • ZUS/здоровье: ${formatPln(buckets.zusZdrowotne)}`);
    console.log(`  • Услуги: ${formatPln(buckets.uslugiObce)}`);
    console.log(`  • Software/Hosting: ${formatPln(buckets.softwareHosting)}`);
    console.log(`  • Маркетинг: ${formatPln(buckets.marketing)}`);
    console.log(`  • Прочее: ${formatPln(buckets.inne)}`);

    const opExpensesSum = Object.values(buckets).reduce((sum, val) => sum + val, 0);
    console.log(`\n  ИТОГО операционные расходы: ${formatPln(opExpensesSum)}`);

    // ========== ИТОГОВЫЙ РАСЧЕТ ==========
    console.log('\n\n📈 ИТОГОВЫЙ РАСЧЕТ:');
    console.log('='.repeat(80));

    const A_przychodyNetto = revenueNet;
    const B_kosztWlasnySprzedazy = 0;
    const C_zyskBruttoZeSprzedazy = A_przychodyNetto - B_kosztWlasnySprzedazy;
    const D_kosztyDzialalnosciOperacyjnej = opExpensesSum || expensesTotal;
    const E_zyskStrataZDzialalnosciOperacyjnej = C_zyskBruttoZeSprzedazy - D_kosztyDzialalnosciOperacyjnej;

    console.log(`A. Доходы (чистые):           ${formatPln(A_przychodyNetto)}`);
    console.log(`B. Себестоимость продаж:      ${formatPln(B_kosztWlasnySprzedazy)}`);
    console.log(`C. Валовая прибыль:           ${formatPln(C_zyskBruttoZeSprzedazy)}`);
    console.log(`D. Операционные расходы:      ${formatPln(D_kosztyDzialalnosciOperacyjnej)}`);
    console.log(`E. Прибыль/Убыток:            ${formatPln(E_zyskStrataZDzialalnosciOperacyjnej)}`);

    console.log('\n' + '='.repeat(80));
    console.log('\n💡 ВЫВОДЫ:');
    console.log('-'.repeat(80));
    
    if (E_zyskStrataZDzialalnosciOperacyjnej < 0) {
      const loss = Math.abs(E_zyskStrataZDzialalnosciOperacyjnej);
      const lossPercent = ((loss / A_przychodyNetto) * 100).toFixed(2);
      console.log(`❌ Убыток составляет ${formatPln(loss)} (${lossPercent}% от доходов)`);
      console.log(`\nПричины убытка:`);
      console.log(`  • Расходы (${formatPln(D_kosztyDzialalnosciOperacyjnej)}) превышают доходы (${formatPln(A_przychodyNetto)})`);
      console.log(`  • Разница: ${formatPln(D_kosztyDzialalnosciOperacyjnej - A_przychodyNetto)}`);
      
      if (buckets.inne > A_przychodyNetto * 0.3) {
        console.log(`\n⚠️  Внимание: категория "Прочее" составляет ${formatPln(buckets.inne)} (${((buckets.inne / D_kosztyDzialalnosciOperacyjnej) * 100).toFixed(1)}% от всех расходов)`);
        console.log(`   Рекомендуется проверить детализацию этой категории.`);
      }
    } else {
      console.log(`✅ Прибыль составляет ${formatPln(E_zyskStrataZDzialalnosciOperacyjnej)}`);
    }

  } catch (error) {
    console.error('❌ Ошибка:', error.message || error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}


