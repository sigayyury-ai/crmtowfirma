const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const { getRate } = require('../stripe/exchangeRateService');
const mqlConfig = require('../../config/mql');
const path = require('path');
const fs = require('fs');
const { parse } = require('csv-parse/sync');

class PnlExpenseClient {
  constructor(options = {}) {
    this.supabase = supabase;
    this.categoryIds = options.categoryIds || mqlConfig.marketingExpenseCategoryIds || [];
    this.rateCache = new Map();
  }

  async getMarketingExpenses(year) {
    if (!this.supabase) {
      throw new Error('Supabase client is not configured');
    }
    if (!Number.isFinite(year)) {
      throw new Error('Year must be a finite number');
    }
    if (!this.categoryIds.length) {
      logger.warn('No marketing expense category IDs configured; returning zero spend');
      return this._emptyResponse(year);
    }

    const range = this._getYearRange(year);
    const { data, error } = await this.supabase
      .from('payments')
      .select('id, operation_date, amount, currency, expense_category_id')
      .in('expense_category_id', this.categoryIds)
      .eq('direction', 'out')
      .gte('operation_date', range.start)
      .lte('operation_date', range.end)
      .limit(5000);

    if (error) {
      logger.error('Failed to fetch marketing expenses from Supabase', { error: error.message });
      throw new Error('Failed to load marketing expenses');
    }

    const months = this._initMonths(year);
    for (const payment of data || []) {
      const monthKey = this._getMonthKey(payment.operation_date);
      if (!monthKey) continue;

      const amountPln = await this._resolveAmountPln(payment);
      if (!Number.isFinite(amountPln) || amountPln <= 0) continue;

      months[monthKey] += amountPln;
    }

    await this._appendManualEntries(months, year);
    await this._appendCsvMarketing(months, year);

    const total = Object.values(months).reduce((sum, value) => sum + value, 0);
    return { year, months, total };
  }

  _initMonths(year) {
    return Array.from({ length: 12 }, (_, idx) => `${year}-${String(idx + 1).padStart(2, '0')}`).reduce(
      (acc, key) => {
        acc[key] = 0;
        return acc;
      },
      {}
    );
  }

  _getYearRange(year) {
    return {
      start: new Date(Date.UTC(year, 0, 1)).toISOString(),
      end: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)).toISOString()
    };
  }

  _getMonthKey(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  async _resolveAmountPln(payment) {
    const baseAmount = Math.abs(Number(payment.amount) || 0);
    if (!baseAmount) {
      return null;
    }

    const currency = (payment.currency || 'PLN').toUpperCase();
    if (currency === 'PLN') {
      return baseAmount;
    }

    try {
      const rate = await this._getRate(currency);
      if (!Number.isFinite(rate)) {
        return null;
      }
      return baseAmount * rate;
    } catch (error) {
      logger.warn('Unable to convert marketing expense to PLN', {
        paymentId: payment.id,
        currency,
        error: error.message
      });
      return null;
    }
  }

  async _getRate(currency) {
    if (this.rateCache.has(currency)) {
      return this.rateCache.get(currency);
    }
    const rate = await getRate(currency, 'PLN');
    this.rateCache.set(currency, rate);
    return rate;
  }

  _emptyResponse(year) {
    return {
      year,
      months: this._initMonths(year),
      total: 0
    };
  }

  async _appendManualEntries(months, year) {
    try {
      const { data, error } = await this.supabase
        .from('pnl_manual_entries')
        .select('month, amount_pln, expense_category_id')
        .eq('entry_type', 'expense')
        .eq('year', year)
        .in('expense_category_id', this.categoryIds);

      if (error) {
        logger.error('Failed to load manual marketing expense entries', { error: error.message });
        return;
      }

      for (const entry of data || []) {
        const monthNum = Number(entry.month);
        if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) continue;
        const key = `${year}-${String(monthNum).padStart(2, '0')}`;
        const amount = Number(entry.amount_pln) || 0;
        months[key] += amount;
      }
    } catch (error) {
      logger.error('Exception while loading manual marketing entries', { error: error.message });
    }
  }

  async _appendCsvMarketing(months, year) {
    try {
      const baseDir = path.join(process.cwd(), 'tests', 'historia_cvs_2025-11-21');
      const csvFiles = fs.readdirSync(baseDir).filter((file) => file.endsWith('.csv'));
      if (!csvFiles.length) {
        return;
      }
      for (const fileName of csvFiles) {
        const filePath = path.join(baseDir, fileName);
        const csvBudget = this._parseMarketingCsv(filePath, year);
        Object.entries(csvBudget).forEach(([monthKey, value]) => {
          months[monthKey] = (months[monthKey] || 0) + value;
        });
      }
    } catch (error) {
      logger.warn('Failed to load marketing CSV files', { error: error.message });
    }
  }

  _parseMarketingCsv(filePath, year) {
    const allowedKeywords = ['FACEBK', 'Google', 'LinkedIn'];
    let totalPerMonth = {};
    const raw = fs.readFileSync(filePath, 'utf8');
    parse(raw, { skip_empty_lines: true }).forEach((row) => {
      const [date1, date2, desc] = row;
      const dateStr = date1 || date2;
      if (!dateStr || !desc) return;
      const norm = dateStr.replaceAll('.', '-');
      const parts = norm.split('-');
      let rowYear;
      let rowMonth;
      if (parts[0].length === 4) {
        rowYear = Number(parts[0]);
        rowMonth = Number(parts[1]);
      } else {
        rowMonth = Number(parts[1]);
        rowYear = Number(parts[2]);
      }
      if (rowYear !== year) return;
      const matchesKeyword = allowedKeywords.some((keyword) =>
        desc.toUpperCase().includes(keyword.toUpperCase())
      );
      if (!matchesKeyword) return;
      const amount = this._parseAmount(row[5]);
      if (amount > 0) return; // we only care about expenses
      const monthKey = `${year}-${String(rowMonth).padStart(2, '0')}`;
      totalPerMonth[monthKey] = (totalPerMonth[monthKey] || 0) + Math.abs(amount);
    });
    return totalPerMonth;
  }

  _parseAmount(rawValue) {
    if (!rawValue) return 0;
    return Number(String(rawValue).replace(/\./g, '').replace(',', '.'));
  }
}

module.exports = PnlExpenseClient;


