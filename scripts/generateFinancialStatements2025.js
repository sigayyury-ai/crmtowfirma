#!/usr/bin/env node

/**
 * Скрипт формирует текстовые версии:
 * 1) RZiS (Rachunek zysków i strat) за 2025 год
 * 2) Bilans spółki COMOON Sp. z o.o. на 31.12.2025
 *
 * Данные берутся из Supabase через существующий PnlReportService.
 * В доходах исключается категория "Наличные".
 *
 * ВНИМАНИЕ:
 * - Скрипт не пытается "угадывать" капитал, задолженности и т.д.
 *   Эти значения можно передать через параметры CLI или заполнить
 *   вручную на основе полученных сумм.
 */

require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const PnlReportService = require('../src/services/pnl/pnlReportService');
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');

if (!supabase) {
  // eslint-disable-next-line no-console
  console.error('❌ Supabase client is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const YEAR = 2025;
const START_MONTH = 8; // Август (месяцы 1-12, где 1=январь, 8=август)
const COMPANY_NAME = 'COMOON Sp. z o.o.';
const PERIOD_LABEL = '01.08.2025–31.12.2025';
const BALANCE_DATE = '31.12.2025';
const PREPARED_BY = 'Yury Sihai, członek zarządu';

/**
 * Найти категорию по имени (без учета регистра)
 * @param {Array} categories
 * @param {string} name
 * @returns {Object|null}
 */
function findCategoryByName(categories, name) {
  if (!Array.isArray(categories)) return null;
  const target = (name || '').trim().toLowerCase();
  if (!target) return null;
  return categories.find((cat) => (cat.name || '').trim().toLowerCase() === target) || null;
}

/**
 * Сгруппировать расходы по "корзинам" для блока D RZiS
 * @param {Array} expenseCategories
 * @param {Array} expensesFromReport
 */
function aggregateOperatingExpenses(expenseCategories, expensesFromReport) {
  const buckets = {
    wynagrodzeniaZarzadu: 0,
    zusZdrowotne: 0,
    uslugiObce: 0,
    softwareHosting: 0,
    marketing: 0,
    logistyka: 0,
    arendaDomow: 0,
    inne: 0
  };

  if (!Array.isArray(expensesFromReport)) {
    return buckets;
  }

  // Карта id -> name для удобства
  const nameById = new Map();
  (expenseCategories || []).forEach((cat) => {
    if (cat && cat.id != null) {
      nameById.set(cat.id, (cat.name || '').trim());
    }
  });

  expensesFromReport.forEach((cat) => {
    if (!cat) return;
    const catId = cat.id;
    const catNameRaw = nameById.get(catId) || cat.name || '';
    const name = (catNameRaw || '').toLowerCase();
    const amount = Number(cat.total?.amountPln || 0);
    if (!Number.isFinite(amount) || amount === 0) {
      return;
    }

    // Набор эвристик по именам категорий, основанный на существующей карте из importPnlFromExcel.js
    if (name.includes('salary') || name.includes('зарплат') || name.includes('na вывод')) {
      buckets.wynagrodzeniaZarzadu += amount;
    } else if (name.includes('zus') || name.includes('зус')) {
      buckets.zusZdrowotne += amount;
    } else if (name.includes('услуги') || name.includes('works') || name.includes('services')) {
      buckets.uslugiObce += amount;
    } else if (
      name.includes('tools') ||
      name.includes('software') ||
      name.includes('hosting') ||
      name.includes('saas')
    ) {
      buckets.softwareHosting += amount;
    } else if (
      name.includes('marketing') ||
      name.includes('advertising') ||
      name.includes('ads')
    ) {
      buckets.marketing += amount;
    } else if (
      name.includes('logist') ||
      name.includes('логистик') ||
      name.includes('доставк') ||
      name.includes('shipping') ||
      name.includes('transport')
    ) {
      buckets.logistyka += amount;
    } else if (
      name.includes('аренд') ||
      name.includes('rent') ||
      name.includes('domow') ||
      name.includes('домов')
    ) {
      buckets.arendaDomow += amount;
    } else {
      buckets.inne += amount;
    }
  });

  return buckets;
}

/**
 * Формат числа как PLN с двумя знаками после запятой (польский формат)
 * @param {number} value
 * @returns {string}
 */
function formatPln(value) {
  const n = Number(value) || 0;
  return `${n.toFixed(2).replace('.', ',')} PLN`;
}

/**
 * Отфильтровать данные по месяцам (только с START_MONTH по декабрь)
 * @param {Array} monthlyData - Массив объектов с полем month
 * @returns {Array} Отфильтрованные данные
 */
function filterByMonths(monthlyData) {
  if (!Array.isArray(monthlyData)) return [];
  return monthlyData.filter((item) => {
    const month = item.month;
    return month >= START_MONTH && month <= 12;
  });
}

/**
 * Суммировать данные по месяцам (только с START_MONTH по декабрь)
 * @param {Array} monthlyData - Массив объектов с полями month и amountPln
 * @returns {number} Сумма
 */
function sumByMonths(monthlyData) {
  if (!Array.isArray(monthlyData)) return 0;
  return monthlyData
    .filter((item) => {
      const month = item.month;
      return month >= START_MONTH && month <= 12;
    })
    .reduce((sum, item) => sum + Number(item.amountPln || 0), 0);
}

/**
 * Сгенерировать текст отчета RZiS
 * @param {Object} pnl
 * @param {Array} incomeCategoriesFromReport
 * @param {Array} expenseCategories
 * @returns {string}
 */
function generateRzis(pnl, incomeCategoriesFromReport, expenseCategories) {
  const categories = Array.isArray(incomeCategoriesFromReport) ? incomeCategoriesFromReport : [];

  // Фильтруем категории доходов - суммируем только месяцы с августа
  const filteredCategories = categories.map((cat) => {
    const filteredMonthly = filterByMonths(cat.monthly || []);
    const filteredTotal = sumByMonths(cat.monthly || []);
    return {
      ...cat,
      monthly: filteredMonthly,
      total: {
        ...cat.total,
        amountPln: filteredTotal
      }
    };
  });

  // Найти категорию "Наличные" и исключить ее из доходов
  const cashCategory =
    findCategoryByName(filteredCategories, 'Наличные') ||
    findCategoryByName(filteredCategories, 'Cash') ||
    null;

  // Суммируем доходы только за месяцы с августа
  const totalRevenueAll = sumByMonths(
    (pnl.monthly || []).map((m) => ({ month: m.month, amountPln: m.amountPln || 0 }))
  );
  const cashRevenue = cashCategory ? Number(cashCategory.total?.amountPln || 0) : 0;
  const revenueNet = totalRevenueAll - cashRevenue;

  // Расходы по данным сервиса - фильтруем только месяцы с августа
  const expensesFromReport = Array.isArray(pnl.expenses) ? pnl.expenses : [];
  const filteredExpenses = expensesFromReport.map((exp) => {
    const filteredMonthly = filterByMonths(exp.monthly || []);
    const filteredTotal = sumByMonths(exp.monthly || []);
    return {
      ...exp,
      monthly: filteredMonthly,
      total: {
        ...exp.total,
        amountPln: filteredTotal
      }
    };
  });
  const expensesTotal = sumByMonths(
    (pnl.monthly || []).map((m) => {
      // Суммируем расходы по месяцам
      const monthExpenses = expensesFromReport.reduce((sum, exp) => {
        const monthEntry = (exp.monthly || []).find((me) => me.month === m.month);
        return sum + (monthEntry?.amountPln || 0);
      }, 0);
      return { month: m.month, amountPln: monthExpenses };
    })
  );

  const opExpenseBuckets = aggregateOperatingExpenses(expenseCategories, filteredExpenses);
  const opExpensesSum =
    opExpenseBuckets.wynagrodzeniaZarzadu +
    opExpenseBuckets.zusZdrowotne +
    opExpenseBuckets.uslugiObce +
    opExpenseBuckets.softwareHosting +
    opExpenseBuckets.marketing +
    opExpenseBuckets.logistyka +
    opExpenseBuckets.arendaDomow +
    opExpenseBuckets.inne;

  // Для простоты считаем, что весь расход = операционные расходы
  // (стоимость продаж в B оставляем нулевой, если нет отдельной аналитики).
  const A_przychodyNetto = revenueNet;
  const B_kosztWlasnySprzedazy = 0;
  const C_zyskBruttoZeSprzedazy = A_przychodyNetto - B_kosztWlasnySprzedazy;
  const D_kosztyDzialalnosciOperacyjnej = opExpensesSum || expensesTotal;
  const E_zyskStrataZDzialalnosciOperacyjnej = C_zyskBruttoZeSprzedazy - D_kosztyDzialalnosciOperacyjnej;

  const F_pozostalePrzychodyOperacyjne = 0;
  const G_pozostaleKosztyOperacyjne = 0;
  const H_zyskStrataBrutto = E_zyskStrataZDzialalnosciOperacyjnej + F_pozostalePrzychodyOperacyjne - G_pozostaleKosztyOperacyjne;

  // Подоходный налог в явном виде в системе не выделен, поэтому ставим 0
  const I_podatekDochodowy = 0;
  const J_zyskStrataNetto = H_zyskStrataBrutto - I_podatekDochodowy;

  const lines = [];
  lines.push(`RACHUNEK ZYSKÓW I STRAT (RZiS)`);
  lines.push(`${COMPANY_NAME}`);
  lines.push(`Okres: ${PERIOD_LABEL}`);
  lines.push(`Sporządził: ${PREPARED_BY}`);
  lines.push('');
  lines.push(`A. Przychody netto ze sprzedaży: ${formatPln(A_przychodyNetto)}`);
  lines.push(`B. Koszt własny sprzedaży: ${formatPln(B_kosztWlasnySprzedazy)}`);
  lines.push(`C. Zysk brutto ze sprzedaży: ${formatPln(C_zyskBruttoZeSprzedazy)}`);
  lines.push(`D. Koszty działalności operacyjnej: ${formatPln(D_kosztyDzialalnosciOperacyjnej)}`);
  lines.push(`   – wynagrodzenia zarządu: ${formatPln(opExpenseBuckets.wynagrodzeniaZarzadu)}`);
  lines.push(`   – ZUS zdrowotne: ${formatPln(opExpenseBuckets.zusZdrowotne)}`);
  lines.push(`   – koszty usług obcych: ${formatPln(opExpenseBuckets.uslugiObce)}`);
  lines.push(`   – software/hosting: ${formatPln(opExpenseBuckets.softwareHosting)}`);
  lines.push(`   – marketing: ${formatPln(opExpenseBuckets.marketing)}`);
  lines.push(`   – logistyka: ${formatPln(opExpenseBuckets.logistyka)}`);
  lines.push(`   – arenda domów: ${formatPln(opExpenseBuckets.arendaDomow)}`);
  lines.push(`   – inne koszty: ${formatPln(opExpenseBuckets.inne)}`);
  lines.push(`E. Zysk/Strata z działalności operacyjnej: ${formatPln(E_zyskStrataZDzialalnosciOperacyjnej)}`);
  lines.push(`F. Pozostałe przychody operacyjne: ${formatPln(F_pozostalePrzychodyOperacyjne)}`);
  lines.push(`G. Pozostałe koszty operacyjne: ${formatPln(G_pozostaleKosztyOperacyjne)}`);
  lines.push(`H. Zysk/Strata brutto: ${formatPln(H_zyskStrataBrutto)}`);
  lines.push(`I. Podatek dochodowy: ${formatPln(I_podatekDochodowy)}`);
  lines.push(`J. Zysk/Strata netto: ${formatPln(J_zyskStrataNetto)}`);

  return {
    text: lines.join('\n'),
    netProfit: J_zyskStrataNetto
  };
}

/**
 * Очень упрощённая оценка денежных средств на банковском счёте на конец 2025 года.
 * Берём все операции по платежам с августа 2025 до конца 2025 в PLN и считаем входящие минус исходящие.
 * @returns {Promise<number>}
 */
async function calculateCashAtBankPln() {
  const startDate = new Date(Date.UTC(2025, START_MONTH - 1, 1, 0, 0, 0, 0)).toISOString(); // 1 августа 2025
  const endDate = new Date(Date.UTC(2025, 11, 31, 23, 59, 59, 999)).toISOString(); // 31 декабря 2025

  // Берём только PLN-платежи с августа; другие валюты при необходимости можно допилить отдельно.
  const { data, error } = await supabase
    .from('payments')
    .select('direction, amount, currency')
    .gte('operation_date', startDate)
    .lte('operation_date', endDate)
    .limit(20000);

  if (error) {
    // eslint-disable-next-line no-console
    console.warn('⚠️ Nie udało się pobrać danych płatności dla Bilansu:', error.message || error);
    return 0;
  }

  let balancePln = 0;
  (data || []).forEach((p) => {
    const currency = (p.currency || 'PLN').toUpperCase();
    if (currency !== 'PLN') {
      return;
    }
    const amount = Number(p.amount || 0);
    if (!Number.isFinite(amount) || amount === 0) return;
    if (p.direction === 'in') {
      balancePln += amount;
    } else if (p.direction === 'out') {
      balancePln -= amount;
    }
  });

  return balancePln;
}

/**
 * Сгенерировать упрощённый Bilans на 31.12.2025.
 * Некоторые статьи (kapitał zakładowy, zobowiązania) по умолчанию 0 и
 * должны быть при необходимости скорректированы вручную.
 * @param {number} netProfit
 * @param {number} cashAtBank
 * @returns {string}
 */
function generateBilans(netProfit, cashAtBank) {
  const kapitalZakladowy = 0; // Можно подставить вручную либо через доработку скрипта
  const naleznosciOdKontrahentow = 0; // Можно доработать на основе danych z proformas
  const aktywaTrwale = 0;
  const inneAktywa = 0;

  const zobowiazaniaZUS = 0;
  const zobowiazaniaUS = 0;
  const zobowiazaniaDostawcy = 0;

  const aktywaObrotoweRazem = cashAtBank + naleznosciOdKontrahentow;
  const aktywaRazem = aktywaObrotoweRazem + aktywaTrwale + inneAktywa;

  const pasywaRazem =
    kapitalZakladowy +
    netProfit +
    zobowiazaniaZUS +
    zobowiazaniaUS +
    zobowiazaniaDostawcy;

  const lines = [];
  lines.push(`BILANS SPÓŁKI ${COMPANY_NAME}`);
  lines.push(`na dzień ${BALANCE_DATE}`);
  lines.push(`Sporządził: Yury Sihai`);
  lines.push('');
  lines.push('AKTYWA:');
  lines.push(`  1. Środki pieniężne na rachunku bankowym: ${formatPln(cashAtBank)}`);
  lines.push(`  2. Należności od kontrahentów: ${formatPln(naleznosciOdKontrahentow)}`);
  lines.push(`  3. Aktywa obrotowe razem: ${formatPln(aktywaObrotoweRazem)}`);
  lines.push(`  4. Aktywa trwałe: ${formatPln(aktywaTrwale)}`);
  lines.push(`  5. Inne aktywa: ${formatPln(inneAktywa)}`);
  lines.push(`  Aktywa razem: ${formatPln(aktywaRazem)}`);
  lines.push('');
  lines.push('PASYWA:');
  lines.push(`  1. Kapitał zakładowy: ${formatPln(kapitalZakladowy)}`);
  lines.push(`  2. Zysk/strata netto: ${formatPln(netProfit)}`);
  lines.push(`  3. Zobowiązania wobec ZUS: ${formatPln(zobowiazaniaZUS)}`);
  lines.push(`  4. Zobowiązania wobec US: ${formatPln(zobowiazaniaUS)}`);
  lines.push(`  5. Zobowiązania wobec dostawców: ${formatPln(zobowiazaniaDostawcy)}`);
  lines.push(`  6. Pasywa razem: ${formatPln(pasywaRazem)}`);
  lines.push('');
  lines.push(`Sprawdzenie: aktywa razem = ${formatPln(aktywaRazem)}, pasywa razem = ${formatPln(pasywaRazem)}`);

  return lines.join('\n');
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('🔍 Generowanie RZiS i Bilansu za 2025...');

  const pnlService = new PnlReportService();
  const expenseCategoryService = new ExpenseCategoryService();

  try {
    const [pnl, expenseCategories] = await Promise.all([
      pnlService.getMonthlyRevenue(YEAR, false),
      expenseCategoryService.listCategories()
    ]);

    const rzisResult = generateRzis(pnl, pnl.categories, expenseCategories);
    const cashAtBank = await calculateCashAtBankPln();
    const bilansText = generateBilans(rzisResult.netProfit, cashAtBank);

    // eslint-disable-next-line no-console
    console.log('\n' + '='.repeat(80));
    // eslint-disable-next-line no-console
    console.log('\nRZiS:\n');
    // eslint-disable-next-line no-console
    console.log(rzisResult.text);

    // eslint-disable-next-line no-console
    console.log('\n' + '='.repeat(80));
    // eslint-disable-next-line no-console
    console.log('\nBilans:\n');
    // eslint-disable-next-line no-console
    console.log(bilansText);

    // eslint-disable-next-line no-console
    console.log('\n' + '='.repeat(80));
    // eslint-disable-next-line no-console
    console.log('\n✅ Gotowe. Możesz skopiować powyższe teksty do PDF / Word.');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('❌ Błąd podczas generowania raportów:', error.message || error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  generateRzis,
  generateBilans,
  calculateCashAtBankPln
};

