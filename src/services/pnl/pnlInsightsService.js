const logger = require('../../utils/logger');
const NodeCache = require('node-cache');
const PnlReportService = require('./pnlReportService');
const ManualEntryService = require('./manualEntryService');
const ExpenseCategoryService = require('./expenseCategoryService');
const OpenAIService = require('../ai/openAIService');
const mqlRepository = require('../analytics/mqlRepository');

/**
 * Service for calculating analytical insights from PNL data
 * Provides comprehensive yearly financial analytics including:
 * - Revenue metrics
 * - Expenses statistics
 * - Break-even analysis
 * - Year-over-year comparisons
 * - Profitability metrics
 * - And more...
 */
class PnlInsightsService {
  constructor() {
    this.pnlReportService = new PnlReportService();
    this.manualEntryService = new ManualEntryService();
    this.expenseCategoryService = new ExpenseCategoryService();
    this.openAIService = new OpenAIService();
    
    // Cache for AI-generated strategic insights
    // TTL: 30 days (monthly regeneration)
    this.aiInsightsCache = new NodeCache({
      stdTTL: 30 * 24 * 60 * 60, // 30 days in seconds
      checkperiod: 60 * 60 // Check for expired keys every hour
    });
    
    // Clear ALL cache entries on startup - always use fresh data
    setTimeout(() => {
      const allKeys = this.aiInsightsCache.keys();
      if (allKeys.length > 0) {
        logger.info('Clearing all AI insights cache on startup', { 
          cacheKeysCount: allKeys.length,
          keys: allKeys.slice(0, 10) // Log first 10 keys
        });
        this.aiInsightsCache.flushAll();
      }
    }, 1000); // Delay to ensure cache is initialized
  }

  /**
   * Get comprehensive insights for a year
   * @param {number} year - Year (2020-2030)
   * @param {string} [asOfDate] - Optional ISO 8601 date string for historical filtering
   * @param {boolean} [regenerateAI=false] - Whether to regenerate AI insights (ignore cache)
   * @param {string} [aiPeriod='month'] - AI regeneration period: 'month', 'quarter', or 'year'
   * @returns {Promise<Object>} Insights object with all calculated metrics
   */
  async getInsights(year, asOfDate = null, regenerateAI = false, aiPeriod = 'month') {
    try {
      // Validate year
      if (!Number.isFinite(year) || year < 2020 || year > 2030) {
        throw new Error('Year must be a number between 2020 and 2030');
      }

      // Validate asOfDate if provided
      if (asOfDate) {
        const date = new Date(asOfDate);
        if (isNaN(date.getTime())) {
          throw new Error('Invalid asOfDate format. Expected ISO 8601 date string.');
        }
        if (date > new Date()) {
          throw new Error('asOfDate cannot be in the future');
        }
      }

      logger.info('Generating insights', { year, asOfDate, regenerateAI, aiPeriod });

      // Initialize response structure
      const insights = {
        year,
        asOfDate: asOfDate || null,
        generatedAt: new Date().toISOString(),
        revenueMetrics: {},
        expensesStatistics: {},
        breakEvenAnalysis: {},
        yearOverYear: null,
        profitabilityMetrics: {},
        quarterlyAnalysis: {},
        operationalEfficiency: {},
        trendAnalysis: {},
        stabilityVolatility: {},
        cashRunway: {},
        expenseEfficiency: {},
        predictiveInsights: {},
        performanceBenchmarks: null,
        monthByMonth: {},
        strategicInsights: null,
        marketingMetrics: null
      };

      // Calculate metrics (implemented incrementally in phases)
      insights.revenueMetrics = await this.calculateRevenueMetrics(year, asOfDate);
      insights.expensesStatistics = await this.calculateExpensesStatistics(year, asOfDate, insights.revenueMetrics);
      insights.breakEvenAnalysis = await this.calculateBreakEvenAnalysis(insights.revenueMetrics, insights.expensesStatistics);
      insights.yearOverYear = await this.calculateYearOverYear(year, asOfDate, insights.revenueMetrics, insights.expensesStatistics, insights.breakEvenAnalysis);
      insights.profitabilityMetrics = await this.calculateProfitabilityMetrics(insights.breakEvenAnalysis, insights.revenueMetrics, insights.expensesStatistics, year, asOfDate);
      insights.quarterlyAnalysis = await this.calculateQuarterlyAnalysis(year, asOfDate, insights.revenueMetrics, insights.expensesStatistics);
      insights.operationalEfficiency = await this.calculateOperationalEfficiency(insights.revenueMetrics, insights.expensesStatistics);
      insights.trendAnalysis = await this.calculateTrendAnalysis(year, asOfDate);
      insights.stabilityVolatility = await this.calculateStabilityVolatility(year, asOfDate);
      insights.cashRunway = await this.calculateCashRunway(insights.revenueMetrics, insights.expensesStatistics, insights.breakEvenAnalysis);
      insights.expenseEfficiency = await this.calculateExpenseEfficiency(year, asOfDate, insights.expensesStatistics);
      insights.predictiveInsights = await this.calculatePredictiveInsights(insights.revenueMetrics, insights.expensesStatistics, insights.trendAnalysis, insights.yearOverYear, insights.breakEvenAnalysis);
      insights.performanceBenchmarks = await this.calculatePerformanceBenchmarks(year, asOfDate, insights.revenueMetrics, insights.expensesStatistics, insights.breakEvenAnalysis, insights.yearOverYear, insights.profitabilityMetrics);
      insights.monthByMonth = await this.calculateMonthByMonthInsights(year, asOfDate, insights.revenueMetrics, insights.expensesStatistics, insights.breakEvenAnalysis);
      
      // Get marketing metrics
      insights.marketingMetrics = await this.calculateMarketingMetrics(year, asOfDate);
      
      // Generate strategic insights (AI-powered with fallback to rule-based)
      insights.strategicInsights = await this.calculateStrategicInsights(insights, regenerateAI, aiPeriod);

      return insights;
    } catch (error) {
      logger.error('Error generating insights', { error: error.message, stack: error.stack, year, asOfDate });
      throw error;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Calculate total from array of numbers
   * @param {Array<number>} values - Array of numbers
   * @returns {number} Sum of values
   */
  calculateTotal(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return 0;
    }
    return values.reduce((sum, val) => {
      const num = Number(val);
      return sum + (Number.isFinite(num) ? num : 0);
    }, 0);
  }

  /**
   * Calculate average from array of numbers
   * @param {Array<number>} values - Array of numbers
   * @returns {number|null} Average or null if empty array
   */
  calculateAverage(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }
    const total = this.calculateTotal(values);
    return total / values.length;
  }

  /**
   * Find maximum value in array with its index
   * @param {Array<number>} values - Array of numbers
   * @returns {Object|null} {value: number, index: number} or null if empty
   */
  findMax(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }
    let maxValue = -Infinity;
    let maxIndex = -1;
    values.forEach((val, index) => {
      const num = Number(val);
      if (Number.isFinite(num) && num > maxValue) {
        maxValue = num;
        maxIndex = index;
      }
    });
    return maxIndex >= 0 ? { value: maxValue, index: maxIndex } : null;
  }

  /**
   * Find minimum value in array with its index
   * @param {Array<number>} values - Array of numbers
   * @returns {Object|null} {value: number, index: number} or null if empty
   */
  findMin(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }
    let minValue = Infinity;
    let minIndex = -1;
    values.forEach((val, index) => {
      const num = Number(val);
      if (Number.isFinite(num) && num < minValue) {
        minValue = num;
        minIndex = index;
      }
    });
    return minIndex >= 0 ? { value: minValue, index: minIndex } : null;
  }

  /**
   * Calculate standard deviation
   * @param {Array<number>} values - Array of numbers
   * @returns {number|null} Standard deviation or null if empty array
   */
  calculateStandardDeviation(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }
    const avg = this.calculateAverage(values);
    if (avg === null) {
      return null;
    }
    const squareDiffs = values.map(val => {
      const num = Number(val);
      if (!Number.isFinite(num)) return 0;
      const diff = num - avg;
      return diff * diff;
    });
    const avgSquareDiff = this.calculateAverage(squareDiffs);
    return avgSquareDiff !== null ? Math.sqrt(avgSquareDiff) : null;
  }

  /**
   * Calculate coefficient of variation (CV) as percentage
   * @param {Array<number>} values - Array of numbers
   * @returns {number|null} Coefficient of variation as percentage or null if empty
   */
  calculateCoefficientOfVariation(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }
    const mean = this.calculateAverage(values);
    const stdDev = this.calculateStandardDeviation(values);
    if (mean === null || stdDev === null || mean === 0) {
      return null;
    }
    return (stdDev / mean) * 100;
  }

  // ============================================================================
  // Revenue Metrics Calculation (Phase 4)
  // ============================================================================

  /**
   * Calculate key revenue metrics
   * @param {number} year - Year (2020-2030)
   * @param {string} [asOfDate] - Optional ISO 8601 date string for historical filtering
   * @returns {Promise<Object>} Revenue metrics object
   */
  async calculateRevenueMetrics(year, asOfDate = null) {
    try {
      // Get monthly revenue data
      // Note: getMonthlyRevenue doesn't support asOfDate yet, will be added in Phase 20
      const monthlyData = await this.pnlReportService.getMonthlyRevenue(year, false);
      
      if (!monthlyData || !monthlyData.monthly || !Array.isArray(monthlyData.monthly)) {
        logger.warn('No monthly revenue data available', { year });
        return {
          totalAnnual: 0,
          averageMonthly: null,
          bestMonth: null,
          worstMonth: null,
          totalPayments: 0
        };
      }

      const monthlyArray = monthlyData.monthly;
      
      // Extract amounts and payment counts
      const amounts = monthlyArray.map(m => m.amountPln || 0);
      const paymentCounts = monthlyArray.map(m => m.paymentCount || 0);

      // Calculate total annual revenue
      const totalAnnual = this.calculateTotal(amounts);

      // Calculate average monthly revenue
      const nonZeroAmounts = amounts.filter(a => a > 0);
      const averageMonthly = nonZeroAmounts.length > 0 
        ? this.calculateAverage(nonZeroAmounts) 
        : null;

      // Find best performing month
      const maxResult = this.findMax(amounts);
      const bestMonth = maxResult && maxResult.value > 0 ? {
        month: maxResult.index + 1, // month is 1-based
        monthName: this.getMonthName(maxResult.index + 1),
        amount: Math.round(maxResult.value * 100) / 100
      } : null;

      // Find worst performing month (excluding zero months if all are zero)
      const nonZeroIndices = amounts
        .map((val, idx) => ({ val, idx }))
        .filter(item => item.val > 0);
      
      let worstMonth = null;
      if (nonZeroIndices.length > 0) {
        const minNonZero = nonZeroIndices.reduce((min, item) => 
          item.val < min.val ? item : min
        );
        worstMonth = {
          month: minNonZero.idx + 1,
          monthName: this.getMonthName(minNonZero.idx + 1),
          amount: Math.round(minNonZero.val * 100) / 100
        };
      } else if (amounts.some(a => a === 0)) {
        // If all are zero, find first zero month
        const firstZeroIndex = amounts.findIndex(a => a === 0);
        if (firstZeroIndex >= 0) {
          worstMonth = {
            month: firstZeroIndex + 1,
            monthName: this.getMonthName(firstZeroIndex + 1),
            amount: 0
          };
        }
      }

      // Calculate total payment count
      const totalPayments = this.calculateTotal(paymentCounts);

      return {
        totalAnnual: Math.round(totalAnnual * 100) / 100,
        averageMonthly: averageMonthly !== null ? Math.round(averageMonthly * 100) / 100 : null,
        bestMonth,
        worstMonth,
        totalPayments: Math.round(totalPayments)
      };
    } catch (error) {
      logger.error('Error calculating revenue metrics', { error: error.message, year, asOfDate });
      throw error;
    }
  }

  /**
   * Get month name in Russian
   * @param {number} month - Month number (1-12)
   * @returns {string} Month name
   */
  getMonthName(month) {
    const monthNames = {
      1: 'Январь',
      2: 'Февраль',
      3: 'Март',
      4: 'Апрель',
      5: 'Май',
      6: 'Июнь',
      7: 'Июль',
      8: 'Август',
      9: 'Сентябрь',
      10: 'Октябрь',
      11: 'Ноябрь',
      12: 'Декабрь'
    };
    return monthNames[month] || `Месяц ${month}`;
  }

  // ============================================================================
  // Expenses Statistics Calculation (Phase 5)
  // ============================================================================

  /**
   * Calculate expenses statistics
   * @param {number} year - Year (2020-2030)
   * @param {string} [asOfDate] - Optional ISO 8601 date string for historical filtering
   * @param {Object} revenueMetrics - Revenue metrics (for expenses-to-revenue ratio)
   * @returns {Promise<Object>} Expenses statistics object
   */
  async calculateExpensesStatistics(year, asOfDate = null, revenueMetrics = null) {
    try {
      // Get expenses for the year
      const expenses = await this.manualEntryService.getExpenses(year, asOfDate);
      
      if (!expenses || !Array.isArray(expenses) || expenses.length === 0) {
        logger.info('No expenses data available', { year });
        return {
          totalAnnual: 0,
          averageMonthly: null,
          topCategories: [],
          expensesToRevenueRatio: null
        };
      }

      // Calculate total annual expenses
      const amounts = expenses.map(e => e.amount_pln || 0);
      const totalAnnual = this.calculateTotal(amounts);

      // Group expenses by month to calculate average monthly
      const monthlyTotals = {};
      expenses.forEach(expense => {
        const month = expense.month;
        if (!monthlyTotals[month]) {
          monthlyTotals[month] = 0;
        }
        monthlyTotals[month] += expense.amount_pln || 0;
      });

      const monthlyAmounts = Object.values(monthlyTotals);
      const nonZeroMonthlyAmounts = monthlyAmounts.filter(a => a > 0);
      const averageMonthly = nonZeroMonthlyAmounts.length > 0
        ? this.calculateAverage(nonZeroMonthlyAmounts)
        : null;

      // Get top expense categories
      const categoryTotals = {};
      expenses.forEach(expense => {
        const categoryId = expense.expense_category_id;
        if (categoryId) {
          if (!categoryTotals[categoryId]) {
            categoryTotals[categoryId] = 0;
          }
          categoryTotals[categoryId] += expense.amount_pln || 0;
        }
      });

      // Sort categories by total amount and get top 5
      const categoryEntries = Object.entries(categoryTotals)
        .map(([categoryId, total]) => ({
          categoryId: parseInt(categoryId, 10),
          total: total
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      // Get category names
      let topCategories = [];
      try {
        const allCategories = await this.expenseCategoryService.listCategories();
        const categoryMap = new Map(allCategories.map(cat => [cat.id, cat]));
        
        topCategories = categoryEntries.map(entry => {
          const category = categoryMap.get(entry.categoryId);
          // Calculate percentage of total revenue
          let percentageOfRevenue = null;
          if (revenueMetrics && revenueMetrics.totalAnnual > 0) {
            percentageOfRevenue = (entry.total / revenueMetrics.totalAnnual) * 100;
            percentageOfRevenue = Math.round(percentageOfRevenue * 100) / 100;
          }
          
          return {
            categoryId: entry.categoryId,
            categoryName: category ? category.name : `Категория ${entry.categoryId}`,
            total: Math.round(entry.total * 100) / 100,
            percentageOfRevenue
          };
        });
      } catch (error) {
        logger.warn('Failed to load expense categories for top categories', { error: error.message });
        // Return without names if categories can't be loaded
        topCategories = categoryEntries.map(entry => {
          let percentageOfRevenue = null;
          if (revenueMetrics && revenueMetrics.totalAnnual > 0) {
            percentageOfRevenue = (entry.total / revenueMetrics.totalAnnual) * 100;
            percentageOfRevenue = Math.round(percentageOfRevenue * 100) / 100;
          }
          
          return {
            categoryId: entry.categoryId,
            categoryName: `Категория ${entry.categoryId}`,
            total: Math.round(entry.total * 100) / 100,
            percentageOfRevenue
          };
        });
      }

      // Calculate expenses-to-revenue ratio
      let expensesToRevenueRatio = null;
      if (revenueMetrics && revenueMetrics.totalAnnual > 0) {
        expensesToRevenueRatio = (totalAnnual / revenueMetrics.totalAnnual) * 100;
        expensesToRevenueRatio = Math.round(expensesToRevenueRatio * 100) / 100;
      }

      return {
        totalAnnual: Math.round(totalAnnual * 100) / 100,
        averageMonthly: averageMonthly !== null ? Math.round(averageMonthly * 100) / 100 : null,
        topCategories,
        expensesToRevenueRatio
      };
    } catch (error) {
      logger.error('Error calculating expenses statistics', { error: error.message, year, asOfDate });
      throw error;
    }
  }

  // ============================================================================
  // Break-Even Analysis Calculation (Phase 6)
  // ============================================================================

  /**
   * Calculate break-even analysis
   * @param {Object} revenueMetrics - Revenue metrics
   * @param {Object} expensesStatistics - Expenses statistics
   * @returns {Object} Break-even analysis object
   */
  calculateBreakEvenAnalysis(revenueMetrics, expensesStatistics) {
    try {
      if (!revenueMetrics || !expensesStatistics) {
        return {
          monthlyBreakEven: null,
          annualBreakEven: null,
          monthsToBreakEven: null,
          profitLoss: null,
          profitMargin: null
        };
      }

      // Monthly break-even point = average monthly expenses
      const monthlyBreakEven = expensesStatistics.averageMonthly !== null
        ? Math.round(expensesStatistics.averageMonthly * 100) / 100
        : null;

      // Annual break-even point = total annual expenses
      const annualBreakEven = expensesStatistics.totalAnnual !== null
        ? Math.round(expensesStatistics.totalAnnual * 100) / 100
        : null;

      // Months to break-even = total annual expenses / average monthly revenue
      let monthsToBreakEven = null;
      if (revenueMetrics.averageMonthly !== null && 
          revenueMetrics.averageMonthly > 0 && 
          annualBreakEven !== null) {
        monthsToBreakEven = annualBreakEven / revenueMetrics.averageMonthly;
        monthsToBreakEven = Math.round(monthsToBreakEven * 100) / 100;
      }

      // Profit/loss for the year = total revenue - total expenses
      const profitLoss = revenueMetrics.totalAnnual - expensesStatistics.totalAnnual;
      const profitLossRounded = Math.round(profitLoss * 100) / 100;

      // Profit margin = (profit/loss / revenue) * 100%
      let profitMargin = null;
      if (revenueMetrics.totalAnnual > 0) {
        profitMargin = (profitLoss / revenueMetrics.totalAnnual) * 100;
        profitMargin = Math.round(profitMargin * 100) / 100;
      }

      return {
        monthlyBreakEven,
        annualBreakEven,
        monthsToBreakEven,
        profitLoss: profitLossRounded,
        profitMargin
      };
    } catch (error) {
      logger.error('Error calculating break-even analysis', { error: error.message });
      throw error;
    }
  }

  // ============================================================================
  // Year-over-Year Comparison Calculation (Phase 7)
  // ============================================================================

  /**
   * Calculate year-over-year comparison
   * @param {number} year - Current year (2020-2030)
   * @param {string} [asOfDate] - Optional ISO 8601 date string for historical filtering
   * @param {Object} currentRevenueMetrics - Current year revenue metrics
   * @param {Object} currentExpensesStatistics - Current year expenses statistics
   * @param {Object} currentBreakEvenAnalysis - Current year break-even analysis
   * @returns {Promise<Object|null>} Year-over-year comparison object or null if previous year unavailable
   */
  /**
   * Get all years that have PNL data
   * @returns {Promise<Array<number>>} Array of years with data
   */
  async getAvailableYears() {
    try {
      const years = [];
      const currentYear = new Date().getFullYear();
      
      // Check years from 2020 to current year + 1 (for future planning)
      // Use parallel processing for better performance
      const yearChecks = [];
      for (let y = 2020; y <= currentYear + 1; y++) {
        yearChecks.push(
          this.calculateRevenueMetrics(y)
            .then(metrics => {
              // Consider year available if it has any revenue or expenses data
              if (metrics && (metrics.totalAnnual > 0 || metrics.totalPayments > 0)) {
                return y;
              }
              return null;
            })
            .catch(() => null) // Skip years with errors
        );
      }
      
      const results = await Promise.all(yearChecks);
      const availableYears = results.filter(y => y !== null);
      
      return availableYears.sort((a, b) => b - a); // Sort descending (newest first)
    } catch (error) {
      logger.error('Error getting available years', { error: error.message });
      return [];
    }
  }

  async calculateYearOverYear(year, asOfDate, currentRevenueMetrics, currentExpensesStatistics, currentBreakEvenAnalysis) {
    try {
      const previousYear = year - 1;
      
      // Validate previous year is in valid range
      if (previousYear < 2020) {
        return null;
      }

      // Get previous year metrics (without full insights to avoid recursion)
      let previousRevenueMetrics, previousExpensesStatistics, previousBreakEvenAnalysis;
      try {
        previousRevenueMetrics = await this.calculateRevenueMetrics(previousYear, asOfDate);
        previousExpensesStatistics = await this.calculateExpensesStatistics(previousYear, asOfDate, previousRevenueMetrics);
        previousBreakEvenAnalysis = await this.calculateBreakEvenAnalysis(previousRevenueMetrics, previousExpensesStatistics);
      } catch (error) {
        logger.warn('Failed to get previous year metrics for YoY comparison', { 
          error: error.message, 
          previousYear 
        });
        return null;
      }

      // Check if we have valid data for comparison
      if (!previousRevenueMetrics || !previousExpensesStatistics || 
          previousRevenueMetrics.totalAnnual === undefined ||
          previousExpensesStatistics.totalAnnual === undefined) {
        return null;
      }

      // Calculate revenue growth rate
      let revenueGrowthRate = null;
      if (previousRevenueMetrics.totalAnnual > 0) {
        revenueGrowthRate = ((currentRevenueMetrics.totalAnnual - previousRevenueMetrics.totalAnnual) / 
                            previousRevenueMetrics.totalAnnual) * 100;
        revenueGrowthRate = Math.round(revenueGrowthRate * 100) / 100;
      } else if (currentRevenueMetrics.totalAnnual > 0) {
        // Previous year had zero revenue, current year has revenue = infinite growth
        revenueGrowthRate = 100; // Or could be null/Infinity, but 100% is more user-friendly
      }

      // Calculate expenses growth rate
      let expensesGrowthRate = null;
      if (previousExpensesStatistics.totalAnnual > 0) {
        expensesGrowthRate = ((currentExpensesStatistics.totalAnnual - previousExpensesStatistics.totalAnnual) / 
                             previousExpensesStatistics.totalAnnual) * 100;
        expensesGrowthRate = Math.round(expensesGrowthRate * 100) / 100;
      } else if (currentExpensesStatistics.totalAnnual > 0) {
        expensesGrowthRate = 100; // Previous year had zero expenses
      }

      // Calculate profit change
      const currentProfit = currentBreakEvenAnalysis?.profitLoss || 0;
      const previousProfit = previousBreakEvenAnalysis?.profitLoss || 0;
      const profitChange = currentProfit - previousProfit;
      const profitChangeRounded = Math.round(profitChange * 100) / 100;

      // Calculate profit change percentage
      let profitChangePercent = null;
      if (Math.abs(previousProfit) > 0) {
        profitChangePercent = (profitChange / Math.abs(previousProfit)) * 100;
        profitChangePercent = Math.round(profitChangePercent * 100) / 100;
      } else if (profitChange !== 0) {
        // Previous profit was zero, current profit is non-zero
        profitChangePercent = profitChange > 0 ? 100 : -100;
      }

      // Compare best/worst months with all available years
      const availableYears = await this.getAvailableYears();
      const allYearsBestMonths = [];
      const allYearsWorstMonths = [];
      
      // Get best/worst months for all available years
      for (const y of availableYears) {
        try {
          const yearMetrics = await this.calculateRevenueMetrics(y, asOfDate);
          if (yearMetrics && yearMetrics.bestMonth && yearMetrics.worstMonth) {
            allYearsBestMonths.push({
              year: y,
              month: yearMetrics.bestMonth.month,
              monthName: yearMetrics.bestMonth.monthName,
              amount: yearMetrics.bestMonth.amount
            });
            allYearsWorstMonths.push({
              year: y,
              month: yearMetrics.worstMonth.month,
              monthName: yearMetrics.worstMonth.monthName,
              amount: yearMetrics.worstMonth.amount
            });
          }
        } catch (error) {
          logger.debug('Skipping year for best/worst month comparison', { year: y, error: error.message });
        }
      }
      
      // Find overall best and worst months across all years
      const overallBestMonth = allYearsBestMonths.length > 0 
        ? allYearsBestMonths.reduce((best, current) => current.amount > best.amount ? current : best)
        : null;
      const overallWorstMonth = allYearsWorstMonths.length > 0
        ? allYearsWorstMonths.reduce((worst, current) => current.amount < worst.amount ? current : worst)
        : null;

      const bestMonthComparison = {
        current: currentRevenueMetrics.bestMonth,
        previous: previousRevenueMetrics.bestMonth,
        allYears: allYearsBestMonths,
        overallBest: overallBestMonth
      };

      const worstMonthComparison = {
        current: currentRevenueMetrics.worstMonth,
        previous: previousRevenueMetrics.worstMonth,
        allYears: allYearsWorstMonths,
        overallWorst: overallWorstMonth
      };

      // Compare average monthly revenue
      const averageMonthlyComparison = {
        current: currentRevenueMetrics.averageMonthly,
        previous: previousRevenueMetrics.averageMonthly,
        change: null,
        changePercent: null
      };

      if (averageMonthlyComparison.current !== null && averageMonthlyComparison.previous !== null) {
        averageMonthlyComparison.change = averageMonthlyComparison.current - averageMonthlyComparison.previous;
        averageMonthlyComparison.change = Math.round(averageMonthlyComparison.change * 100) / 100;
        
        if (averageMonthlyComparison.previous > 0) {
          averageMonthlyComparison.changePercent = (averageMonthlyComparison.change / averageMonthlyComparison.previous) * 100;
          averageMonthlyComparison.changePercent = Math.round(averageMonthlyComparison.changePercent * 100) / 100;
        }
      }

      return {
        previousYear,
        revenueGrowthRate,
        expensesGrowthRate,
        profitChange: profitChangeRounded,
        profitChangePercent,
        bestMonthComparison,
        worstMonthComparison,
        averageMonthlyComparison
      };
    } catch (error) {
      logger.error('Error calculating year-over-year comparison', { error: error.message, year, asOfDate });
      return null;
    }
  }

  // ============================================================================
  // Profitability Metrics Calculation (Phase 8)
  // ============================================================================

  /**
   * Calculate profitability metrics
   * @param {Object} breakEvenAnalysis - Break-even analysis (contains profit/loss and profit margin)
   * @param {Object} revenueMetrics - Revenue metrics
   * @param {Object} expensesStatistics - Expenses statistics (for calculating operating expenses)
   * @param {number} year - Year (for getting expense categories)
   * @param {string} [asOfDate] - Optional ISO 8601 date string
   * @returns {Promise<Object>} Profitability metrics object
   */
  async calculateProfitabilityMetrics(breakEvenAnalysis, revenueMetrics, expensesStatistics, year, asOfDate = null) {
    try {
      if (!breakEvenAnalysis || !revenueMetrics || !expensesStatistics) {
        return {
          profitMargin: null,
          operatingMargin: null,
          netProfitMargin: null
        };
      }

      // Net profit margin = (profit/loss / revenue) * 100%
      // This is the overall profit margin after all expenses
      const netProfitMargin = breakEvenAnalysis.profitMargin;

      // Try to calculate operating margin by excluding tax expenses
      let operatingMargin = null;
      try {
        // Get expense categories to identify tax categories
        const expenseCategories = await this.expenseCategoryService.listCategories();
        const taxCategoryIds = new Set();
        
        expenseCategories.forEach(cat => {
          const catName = (cat.name || '').toUpperCase();
          if (catName === 'НАЛОГИ' || catName === 'ВАТ' || catName === 'ЗУС' || 
              catName.includes('TAX') || catName.includes('PIT') || catName.includes('CIT')) {
            taxCategoryIds.add(cat.id);
          }
        });

        // Get expenses by category to calculate operating expenses (excluding taxes)
        const expenses = await this.manualEntryService.getExpenses(year, asOfDate);
        let operatingExpenses = 0;
        let taxExpenses = 0;

        expenses.forEach(expense => {
          const amount = expense.amount_pln || 0;
          if (taxCategoryIds.has(expense.expense_category_id)) {
            taxExpenses += amount;
          } else {
            operatingExpenses += amount;
          }
        });

        // Operating margin = (revenue - operating expenses) / revenue * 100%
        if (revenueMetrics.totalAnnual > 0) {
          const operatingProfit = revenueMetrics.totalAnnual - operatingExpenses;
          operatingMargin = (operatingProfit / revenueMetrics.totalAnnual) * 100;
          operatingMargin = Math.round(operatingMargin * 100) / 100;
        }
      } catch (error) {
        logger.warn('Failed to calculate operating margin, using net profit margin', { error: error.message });
        // Fallback: use net profit margin if we can't calculate operating margin
        operatingMargin = netProfitMargin;
      }

      // Profit margin (same as net profit margin for this context)
      const profitMargin = netProfitMargin;

      return {
        profitMargin,
        operatingMargin,
        netProfitMargin
      };
    } catch (error) {
      logger.error('Error calculating profitability metrics', { error: error.message });
      throw error;
    }
  }

  // ============================================================================
  // Quarterly Analysis Calculation (Phase 9)
  // ============================================================================

  /**
   * Calculate quarterly analysis
   * @param {number} year - Year (2020-2030)
   * @param {string} [asOfDate] - Optional ISO 8601 date string for historical filtering
   * @param {Object} revenueMetrics - Revenue metrics
   * @param {Object} expensesStatistics - Expenses statistics
   * @returns {Promise<Object>} Quarterly analysis object
   */
  async calculateQuarterlyAnalysis(year, asOfDate, revenueMetrics, expensesStatistics) {
    try {
      // Get monthly revenue data
      const monthlyData = await this.pnlReportService.getMonthlyRevenue(year, false);
      
      if (!monthlyData || !monthlyData.monthly || !Array.isArray(monthlyData.monthly)) {
        return {
          q1: { revenue: 0, profitLoss: null },
          q2: { revenue: 0, profitLoss: null },
          q3: { revenue: 0, profitLoss: null },
          q4: { revenue: 0, profitLoss: null },
          bestQuarter: null,
          worstQuarter: null,
          quarterlyTrends: []
        };
      }

      const monthlyArray = monthlyData.monthly;
      
      // Get expenses by month
      const expenses = await this.manualEntryService.getExpenses(year, asOfDate);
      const monthlyExpenses = {};
      expenses.forEach(expense => {
        const month = expense.month;
        if (!monthlyExpenses[month]) {
          monthlyExpenses[month] = 0;
        }
        monthlyExpenses[month] += expense.amount_pln || 0;
      });

      // Calculate quarterly totals
      const quarters = {
        q1: { months: [1, 2, 3], revenue: 0, expenses: 0 },
        q2: { months: [4, 5, 6], revenue: 0, expenses: 0 },
        q3: { months: [7, 8, 9], revenue: 0, expenses: 0 },
        q4: { months: [10, 11, 12], revenue: 0, expenses: 0 }
      };

      // Sum revenue and expenses by quarter
      monthlyArray.forEach(monthEntry => {
        const month = monthEntry.month;
        const revenue = monthEntry.amountPln || 0;
        const expenses = monthlyExpenses[month] || 0;

        Object.keys(quarters).forEach(quarterKey => {
          if (quarters[quarterKey].months.includes(month)) {
            quarters[quarterKey].revenue += revenue;
            quarters[quarterKey].expenses += expenses;
          }
        });
      });

      // Calculate profit/loss for each quarter
      const quarterlyData = {};
      Object.keys(quarters).forEach(quarterKey => {
        const quarter = quarters[quarterKey];
        const profitLoss = quarter.revenue - quarter.expenses;
        quarterlyData[quarterKey] = {
          revenue: Math.round(quarter.revenue * 100) / 100,
          profitLoss: Math.round(profitLoss * 100) / 100
        };
      });

      // Find best and worst quarters by revenue
      const quarterRevenues = [
        { quarter: 'Q1', revenue: quarterlyData.q1.revenue },
        { quarter: 'Q2', revenue: quarterlyData.q2.revenue },
        { quarter: 'Q3', revenue: quarterlyData.q3.revenue },
        { quarter: 'Q4', revenue: quarterlyData.q4.revenue }
      ];

      const bestQuarter = quarterRevenues.reduce((max, q) => q.revenue > max.revenue ? q : max, quarterRevenues[0]);
      const worstQuarter = quarterRevenues.reduce((min, q) => q.revenue < min.revenue ? q : min, quarterRevenues[0]);

      // Calculate quarterly trends (growth rates between quarters)
      const quarterlyTrends = [];
      const quartersList = ['q1', 'q2', 'q3', 'q4'];
      for (let i = 0; i < quartersList.length - 1; i++) {
        const currentQuarter = quarterlyData[quartersList[i]];
        const nextQuarter = quarterlyData[quartersList[i + 1]];
        
        let growthRate = null;
        if (currentQuarter.revenue > 0) {
          growthRate = ((nextQuarter.revenue - currentQuarter.revenue) / currentQuarter.revenue) * 100;
          growthRate = Math.round(growthRate * 100) / 100;
        } else if (nextQuarter.revenue > 0) {
          growthRate = 100; // From zero to positive
        }

        quarterlyTrends.push({
          from: quartersList[i].toUpperCase(),
          to: quartersList[i + 1].toUpperCase(),
          growthRate
        });
      }

      return {
        q1: quarterlyData.q1,
        q2: quarterlyData.q2,
        q3: quarterlyData.q3,
        q4: quarterlyData.q4,
        bestQuarter: {
          quarter: bestQuarter.quarter,
          revenue: bestQuarter.revenue
        },
        worstQuarter: {
          quarter: worstQuarter.quarter,
          revenue: worstQuarter.revenue
        },
        quarterlyTrends
      };
    } catch (error) {
      logger.error('Error calculating quarterly analysis', { error: error.message, year, asOfDate });
      throw error;
    }
  }

  // ============================================================================
  // Operational Efficiency Calculation (Phase 10)
  // ============================================================================

  /**
   * Calculate operational efficiency metrics
   * @param {Object} revenueMetrics - Revenue metrics
   * @param {Object} expensesStatistics - Expenses statistics
   * @returns {Object} Operational efficiency object
   */
  calculateOperationalEfficiency(revenueMetrics, expensesStatistics) {
    try {
      if (!revenueMetrics || !expensesStatistics) {
        return {
          averageTransactionValue: null,
          revenuePerMonth: null,
          expensesPerMonth: null,
          efficiencyRatio: null
        };
      }

      // Average transaction value = total revenue / total payment count
      let averageTransactionValue = null;
      if (revenueMetrics.totalPayments > 0 && revenueMetrics.totalAnnual > 0) {
        averageTransactionValue = revenueMetrics.totalAnnual / revenueMetrics.totalPayments;
        averageTransactionValue = Math.round(averageTransactionValue * 100) / 100;
      }

      // Revenue per month = average monthly revenue (already calculated)
      const revenuePerMonth = revenueMetrics.averageMonthly;

      // Expenses per month = average monthly expenses (already calculated)
      const expensesPerMonth = expensesStatistics.averageMonthly;

      // Efficiency ratio = expenses / revenue (lower is better)
      let efficiencyRatio = null;
      if (revenuePerMonth !== null && revenuePerMonth > 0 && expensesPerMonth !== null) {
        efficiencyRatio = (expensesPerMonth / revenuePerMonth) * 100;
        efficiencyRatio = Math.round(efficiencyRatio * 100) / 100;
      }

      return {
        averageTransactionValue,
        revenuePerMonth: revenuePerMonth !== null ? Math.round(revenuePerMonth * 100) / 100 : null,
        expensesPerMonth: expensesPerMonth !== null ? Math.round(expensesPerMonth * 100) / 100 : null,
        efficiencyRatio
      };
    } catch (error) {
      logger.error('Error calculating operational efficiency', { error: error.message });
      throw error;
    }
  }

  // ============================================================================
  // Trend Analysis Calculation (Phase 11)
  // ============================================================================

  /**
   * Calculate trend analysis
   * @param {number} year - Year (2020-2030)
   * @param {string} [asOfDate] - Optional ISO 8601 date string for historical filtering
   * @returns {Promise<Object>} Trend analysis object
   */
  async calculateTrendAnalysis(year, asOfDate = null) {
    try {
      // Get monthly revenue data
      const monthlyData = await this.pnlReportService.getMonthlyRevenue(year, false);
      
      if (!monthlyData || !monthlyData.monthly || !Array.isArray(monthlyData.monthly)) {
        return {
          firstHalfVsSecondHalf: null,
          peakPeriod: null,
          lowPeriod: null,
          monthOverMonthGrowth: [],
          seasonalityDetected: false
        };
      }

      const monthlyArray = monthlyData.monthly;
      const amounts = monthlyArray.map(m => m.amountPln || 0);

      // Calculate first half (Jan-Jun) vs second half (Jul-Dec)
      const firstHalf = amounts.slice(0, 6).reduce((sum, val) => sum + val, 0);
      const secondHalf = amounts.slice(6, 12).reduce((sum, val) => sum + val, 0);
      
      let firstHalfVsSecondHalf = null;
      if (firstHalf > 0) {
        firstHalfVsSecondHalf = ((secondHalf - firstHalf) / firstHalf) * 100;
        firstHalfVsSecondHalf = Math.round(firstHalfVsSecondHalf * 100) / 100;
      } else if (secondHalf > 0) {
        firstHalfVsSecondHalf = 100; // From zero to positive
      }

      // Identify peak revenue period (consecutive months with highest revenue)
      let peakStart = 0;
      let peakEnd = 0;
      let peakSum = 0;
      let maxPeakSum = 0;

      for (let i = 0; i < amounts.length; i++) {
        if (amounts[i] > 0) {
          peakSum += amounts[i];
          if (peakSum > maxPeakSum) {
            maxPeakSum = peakSum;
            peakEnd = i;
          }
        } else {
          peakSum = 0;
          peakStart = i + 1;
        }
      }

      // Find actual peak period (3-month window)
      let best3MonthSum = 0;
      let best3MonthStart = 0;
      for (let i = 0; i <= amounts.length - 3; i++) {
        const sum3Months = amounts[i] + amounts[i + 1] + amounts[i + 2];
        if (sum3Months > best3MonthSum) {
          best3MonthSum = sum3Months;
          best3MonthStart = i;
        }
      }

      const peakPeriod = best3MonthSum > 0 ? {
        startMonth: best3MonthStart + 1,
        endMonth: best3MonthStart + 3,
        startMonthName: this.getMonthName(best3MonthStart + 1),
        endMonthName: this.getMonthName(best3MonthStart + 3),
        totalRevenue: Math.round(best3MonthSum * 100) / 100
      } : null;

      // Identify low revenue period (3-month window with lowest revenue)
      let worst3MonthSum = Infinity;
      let worst3MonthStart = 0;
      for (let i = 0; i <= amounts.length - 3; i++) {
        const sum3Months = amounts[i] + amounts[i + 1] + amounts[i + 2];
        if (sum3Months < worst3MonthSum && sum3Months >= 0) {
          worst3MonthSum = sum3Months;
          worst3MonthStart = i;
        }
      }

      const lowPeriod = worst3MonthSum !== Infinity ? {
        startMonth: worst3MonthStart + 1,
        endMonth: worst3MonthStart + 3,
        startMonthName: this.getMonthName(worst3MonthStart + 1),
        endMonthName: this.getMonthName(worst3MonthStart + 3),
        totalRevenue: Math.round(worst3MonthSum * 100) / 100
      } : null;

      // Calculate month-over-month growth rates
      const monthOverMonthGrowth = [];
      for (let i = 0; i < amounts.length - 1; i++) {
        const currentMonth = amounts[i];
        const nextMonth = amounts[i + 1];
        
        let growthRate = null;
        if (currentMonth > 0) {
          growthRate = ((nextMonth - currentMonth) / currentMonth) * 100;
          growthRate = Math.round(growthRate * 100) / 100;
        } else if (nextMonth > 0) {
          growthRate = 100; // From zero to positive
        }

        monthOverMonthGrowth.push({
          fromMonth: i + 1,
          toMonth: i + 2,
          fromMonthName: this.getMonthName(i + 1),
          toMonthName: this.getMonthName(i + 2),
          growthRate
        });
      }

      // Detect seasonality (simplified: check if same months show similar patterns)
      // Compare Q1 vs Q3 (similar seasonal position) and Q2 vs Q4
      const q1Total = amounts.slice(0, 3).reduce((sum, val) => sum + val, 0);
      const q2Total = amounts.slice(3, 6).reduce((sum, val) => sum + val, 0);
      const q3Total = amounts.slice(6, 9).reduce((sum, val) => sum + val, 0);
      const q4Total = amounts.slice(9, 12).reduce((sum, val) => sum + val, 0);

      // Simple seasonality check: if Q1 and Q3 are similar, or Q2 and Q4 are similar
      const q1q3Similarity = q1Total > 0 && q3Total > 0 
        ? Math.abs((q1Total - q3Total) / Math.max(q1Total, q3Total)) < 0.3 
        : false;
      const q2q4Similarity = q2Total > 0 && q4Total > 0 
        ? Math.abs((q2Total - q4Total) / Math.max(q2Total, q4Total)) < 0.3 
        : false;

      const seasonalityDetected = q1q3Similarity || q2q4Similarity;

      return {
        firstHalfVsSecondHalf,
        peakPeriod,
        lowPeriod,
        monthOverMonthGrowth,
        seasonalityDetected
      };
    } catch (error) {
      logger.error('Error calculating trend analysis', { error: error.message, year, asOfDate });
      throw error;
    }
  }

  // ============================================================================
  // Stability/Volatility Analysis Calculation (Phase 12)
  // ============================================================================

  /**
   * Calculate stability/volatility analysis
   * @param {number} year - Year (2020-2030)
   * @param {string} [asOfDate] - Optional ISO 8601 date string for historical filtering
   * @returns {Promise<Object>} Stability/volatility analysis object
   */
  async calculateStabilityVolatility(year, asOfDate = null) {
    try {
      // Get monthly revenue data
      const monthlyData = await this.pnlReportService.getMonthlyRevenue(year, false);
      
      if (!monthlyData || !monthlyData.monthly || !Array.isArray(monthlyData.monthly)) {
        return {
          coefficientOfVariation: null,
          stabilityScore: null,
          outlierMonths: [],
          consistencyIndicator: null
        };
      }

      const monthlyArray = monthlyData.monthly;
      const amounts = monthlyArray.map(m => m.amountPln || 0);
      
      // Filter out zero months for calculation (but keep them for outlier detection)
      const nonZeroAmounts = amounts.filter(a => a > 0);

      if (nonZeroAmounts.length === 0) {
        return {
          coefficientOfVariation: null,
          stabilityScore: 'no_data',
          outlierMonths: [],
          consistencyIndicator: null
        };
      }

      // Calculate mean
      const mean = this.calculateAverage(nonZeroAmounts);
      if (mean === null || mean === 0) {
        return {
          coefficientOfVariation: null,
          stabilityScore: 'no_data',
          outlierMonths: [],
          consistencyIndicator: null
        };
      }

      // Calculate standard deviation
      const stdDev = this.calculateStandardDeviation(nonZeroAmounts);
      if (stdDev === null) {
        return {
          coefficientOfVariation: null,
          stabilityScore: 'no_data',
          outlierMonths: [],
          consistencyIndicator: null
        };
      }

      // Calculate coefficient of variation
      const coefficientOfVariation = (stdDev / mean) * 100;
      const cvRounded = Math.round(coefficientOfVariation * 100) / 100;

      // Determine stability score
      let stabilityScore;
      if (cvRounded < 15) {
        stabilityScore = 'very_stable';
      } else if (cvRounded < 30) {
        stabilityScore = 'stable';
      } else if (cvRounded < 50) {
        stabilityScore = 'moderate';
      } else {
        stabilityScore = 'high_volatility';
      }

      // Identify outlier months (months with revenue >2 standard deviations from mean)
      const outlierMonths = [];
      amounts.forEach((amount, index) => {
        if (amount > 0) {
          const deviation = Math.abs(amount - mean);
          if (deviation > 2 * stdDev) {
            outlierMonths.push({
              month: index + 1,
              monthName: this.getMonthName(index + 1),
              amount: Math.round(amount * 100) / 100,
              deviation: Math.round(deviation * 100) / 100
            });
          }
        }
      });

      // Calculate consistency indicator (percentage of months within 1 standard deviation)
      const withinOneStdDev = amounts.filter(amount => {
        if (amount === 0) return false;
        return Math.abs(amount - mean) <= stdDev;
      }).length;
      
      const consistencyIndicator = nonZeroAmounts.length > 0
        ? (withinOneStdDev / nonZeroAmounts.length) * 100
        : null;
      const consistencyRounded = consistencyIndicator !== null
        ? Math.round(consistencyIndicator * 100) / 100
        : null;

      return {
        coefficientOfVariation: cvRounded,
        stabilityScore,
        outlierMonths,
        consistencyIndicator: consistencyRounded
      };
    } catch (error) {
      logger.error('Error calculating stability/volatility analysis', { error: error.message, year, asOfDate });
      throw error;
    }
  }

  // ============================================================================
  // Cash Runway Analysis Calculation (Phase 13)
  // ============================================================================

  /**
   * Calculate cash runway analysis
   * @param {Object} revenueMetrics - Revenue metrics
   * @param {Object} expensesStatistics - Expenses statistics
   * @param {Object} breakEvenAnalysis - Break-even analysis
   * @returns {Object} Cash runway analysis object
   */
  calculateCashRunway(revenueMetrics, expensesStatistics, breakEvenAnalysis) {
    try {
      if (!revenueMetrics || !expensesStatistics || !breakEvenAnalysis) {
        return {
          monthsOfRunway: null,
          monthsUntilBreakEven: null,
          requiredGrowthRate: null,
          burnRate: null
        };
      }

      // Months until break-even (already calculated in break-even analysis)
      const monthsUntilBreakEven = breakEvenAnalysis.monthsToBreakEven;

      // Months of runway = current cash balance / average monthly profit
      // Note: We don't have current cash balance, so this will be null
      // In a real scenario, this would require cash balance data
      const monthsOfRunway = null;

      // Required monthly revenue growth rate to reach break-even
      let requiredGrowthRate = null;
      if (breakEvenAnalysis.profitLoss < 0 && 
          revenueMetrics.averageMonthly !== null && 
          revenueMetrics.averageMonthly > 0 &&
          breakEvenAnalysis.monthlyBreakEven !== null) {
        // If unprofitable, calculate required growth rate
        const remainingMonths = 12; // Assume remaining months in year
        const currentMonthlyRevenue = revenueMetrics.averageMonthly;
        const targetMonthlyRevenue = breakEvenAnalysis.monthlyBreakEven;
        const monthlyGrowthNeeded = (targetMonthlyRevenue - currentMonthlyRevenue) / remainingMonths;
        requiredGrowthRate = (monthlyGrowthNeeded / currentMonthlyRevenue) * 100;
        requiredGrowthRate = Math.round(requiredGrowthRate * 100) / 100;
      }

      // Burn rate = average monthly expenses - average monthly revenue (if negative)
      let burnRate = null;
      if (expensesStatistics.averageMonthly !== null && 
          revenueMetrics.averageMonthly !== null) {
        const monthlyProfit = revenueMetrics.averageMonthly - expensesStatistics.averageMonthly;
        if (monthlyProfit < 0) {
          burnRate = Math.abs(monthlyProfit);
          burnRate = Math.round(burnRate * 100) / 100;
        }
      }

      return {
        monthsOfRunway,
        monthsUntilBreakEven,
        requiredGrowthRate,
        burnRate
      };
    } catch (error) {
      logger.error('Error calculating cash runway analysis', { error: error.message });
      throw error;
    }
  }

  // ============================================================================
  // Expense Efficiency Analysis Calculation (Phase 14)
  // ============================================================================

  /**
   * Calculate expense efficiency analysis
   * @param {number} year - Year (2020-2030)
   * @param {string} [asOfDate] - Optional ISO 8601 date string for historical filtering
   * @param {Object} currentExpensesStatistics - Current year expenses statistics
   * @returns {Promise<Object>} Expense efficiency analysis object
   */
  async calculateExpenseEfficiency(year, asOfDate, currentExpensesStatistics) {
    try {
      // Get current year expenses by category
      const expenses = await this.manualEntryService.getExpenses(year, asOfDate);
      
      if (!expenses || !Array.isArray(expenses) || expenses.length === 0) {
        return {
          topCategories: [],
          categoryGrowthRates: [],
          optimizationOpportunities: []
        };
      }

      // Group expenses by category
      const categoryTotals = {};
      expenses.forEach(expense => {
        const categoryId = expense.expense_category_id;
        if (categoryId) {
          if (!categoryTotals[categoryId]) {
            categoryTotals[categoryId] = 0;
          }
          categoryTotals[categoryId] += expense.amount_pln || 0;
        }
      });

      // Get top categories (already calculated in expensesStatistics, but we'll recalculate for consistency)
      const categoryEntries = Object.entries(categoryTotals)
        .map(([categoryId, total]) => ({
          categoryId: parseInt(categoryId, 10),
          total: total
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      // Get category names
      let topCategories = [];
      try {
        const allCategories = await this.expenseCategoryService.listCategories();
        const categoryMap = new Map(allCategories.map(cat => [cat.id, cat]));
        
        topCategories = categoryEntries.map(entry => {
          const category = categoryMap.get(entry.categoryId);
          return {
            categoryId: entry.categoryId,
            categoryName: category ? category.name : `Категория ${entry.categoryId}`,
            total: Math.round(entry.total * 100) / 100
          };
        });
      } catch (error) {
        logger.warn('Failed to load expense categories', { error: error.message });
        topCategories = categoryEntries.map(entry => ({
          categoryId: entry.categoryId,
          categoryName: `Категория ${entry.categoryId}`,
          total: Math.round(entry.total * 100) / 100
        }));
      }

      // Calculate category growth rates (YoY comparison)
      const previousYear = year - 1;
      let categoryGrowthRates = [];
      
      if (previousYear >= 2020) {
        try {
          const previousExpenses = await this.manualEntryService.getExpenses(previousYear, asOfDate);
          const previousCategoryTotals = {};
          
          previousExpenses.forEach(expense => {
            const categoryId = expense.expense_category_id;
            if (categoryId) {
              if (!previousCategoryTotals[categoryId]) {
                previousCategoryTotals[categoryId] = 0;
              }
              previousCategoryTotals[categoryId] += expense.amount_pln || 0;
            }
          });

          // Calculate growth rates for categories that exist in both years
          const allCategoryIds = new Set([
            ...Object.keys(categoryTotals),
            ...Object.keys(previousCategoryTotals)
          ]);

          const allCategories = await this.expenseCategoryService.listCategories();
          const categoryMap = new Map(allCategories.map(cat => [cat.id, cat]));

          allCategoryIds.forEach(categoryIdStr => {
            const categoryId = parseInt(categoryIdStr, 10);
            const currentTotal = categoryTotals[categoryId] || 0;
            const previousTotal = previousCategoryTotals[categoryId] || 0;

            if (previousTotal > 0 || currentTotal > 0) {
              let growthRate = null;
              if (previousTotal > 0) {
                growthRate = ((currentTotal - previousTotal) / previousTotal) * 100;
                growthRate = Math.round(growthRate * 100) / 100;
              } else if (currentTotal > 0) {
                growthRate = 100; // From zero to positive
              }

              const category = categoryMap.get(categoryId);
              categoryGrowthRates.push({
                categoryId,
                categoryName: category ? category.name : `Категория ${categoryId}`,
                currentTotal: Math.round(currentTotal * 100) / 100,
                previousTotal: Math.round(previousTotal * 100) / 100,
                growthRate
              });
            }
          });

          // Sort by growth rate (highest first)
          categoryGrowthRates.sort((a, b) => {
            if (a.growthRate === null) return 1;
            if (b.growthRate === null) return -1;
            return b.growthRate - a.growthRate;
          });
        } catch (error) {
          logger.warn('Failed to calculate category growth rates', { error: error.message });
        }
      }

      // Identify optimization opportunities
      // Categories with high growth rates (>20%) are potential optimization targets
      const optimizationOpportunities = categoryGrowthRates
        .filter(cat => cat.growthRate !== null && cat.growthRate > 20)
        .slice(0, 5)
        .map(cat => ({
          categoryId: cat.categoryId,
          categoryName: cat.categoryName,
          growthRate: cat.growthRate,
          currentTotal: cat.currentTotal,
          recommendation: `Рост расходов на ${Math.round(cat.growthRate)}% по сравнению с предыдущим годом. Рекомендуется пересмотреть необходимость и оптимизировать.`
        }));

      return {
        topCategories,
        categoryGrowthRates: categoryGrowthRates.slice(0, 10), // Top 10 by growth rate
        optimizationOpportunities
      };
    } catch (error) {
      logger.error('Error calculating expense efficiency analysis', { error: error.message, year, asOfDate });
      throw error;
    }
  }

  // ============================================================================
  // Predictive Insights Calculation (Phase 15)
  // ============================================================================

  /**
   * Calculate predictive insights
   * @param {Object} revenueMetrics - Revenue metrics
   * @param {Object} expensesStatistics - Expenses statistics
   * @param {Object} trendAnalysis - Trend analysis
   * @param {Object} yearOverYear - Year-over-year comparison
   * @param {Object} breakEvenAnalysis - Break-even analysis
   * @returns {Object} Predictive insights object
   */
  calculatePredictiveInsights(revenueMetrics, expensesStatistics, trendAnalysis, yearOverYear, breakEvenAnalysis) {
    try {
      if (!revenueMetrics || !expensesStatistics || !trendAnalysis || !breakEvenAnalysis) {
        return {
          projectedAnnualRevenue: null,
          projectedBreakEvenTimeline: null,
          forecastedBestMonth: null,
          forecastedWorstMonth: null,
          riskIndicators: []
        };
      }

      // Calculate projected annual revenue for next year
      let projectedAnnualRevenue = null;
      if (yearOverYear && yearOverYear.revenueGrowthRate !== null && revenueMetrics.totalAnnual > 0) {
        // Use YoY growth rate if available
        const growthRate = yearOverYear.revenueGrowthRate / 100;
        projectedAnnualRevenue = revenueMetrics.totalAnnual * (1 + growthRate);
        projectedAnnualRevenue = Math.round(projectedAnnualRevenue * 100) / 100;
      } else if (trendAnalysis && trendAnalysis.monthOverMonthGrowth && trendAnalysis.monthOverMonthGrowth.length > 0) {
        // Use average month-over-month growth rate
        const growthRates = trendAnalysis.monthOverMonthGrowth
          .map(g => g.growthRate)
          .filter(r => r !== null);
        if (growthRates.length > 0) {
          const avgGrowthRate = this.calculateAverage(growthRates) / 100;
          projectedAnnualRevenue = revenueMetrics.totalAnnual * (1 + avgGrowthRate);
          projectedAnnualRevenue = Math.round(projectedAnnualRevenue * 100) / 100;
        }
      }

      // Projected break-even timeline
      let projectedBreakEvenTimeline = null;
      if (breakEvenAnalysis.monthsToBreakEven !== null && breakEvenAnalysis.monthsToBreakEven > 0) {
        const currentDate = new Date();
        const breakEvenDate = new Date(currentDate);
        breakEvenDate.setMonth(currentDate.getMonth() + Math.ceil(breakEvenAnalysis.monthsToBreakEven));
        projectedBreakEvenTimeline = {
          months: Math.ceil(breakEvenAnalysis.monthsToBreakEven),
          estimatedDate: breakEvenDate.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long' })
        };
      }

      // Forecast best/worst months based on seasonality
      let forecastedBestMonth = null;
      let forecastedWorstMonth = null;
      if (trendAnalysis.seasonalityDetected && trendAnalysis.peakPeriod && trendAnalysis.lowPeriod) {
        // If seasonality detected, forecast similar pattern
        forecastedBestMonth = {
          period: `${trendAnalysis.peakPeriod.startMonthName}-${trendAnalysis.peakPeriod.endMonthName}`,
          note: 'На основе выявленной сезонности'
        };
        forecastedWorstMonth = {
          period: `${trendAnalysis.lowPeriod.startMonthName}-${trendAnalysis.lowPeriod.endMonthName}`,
          note: 'На основе выявленной сезонности'
        };
      }

      // Generate risk indicators
      const riskIndicators = [];
      
      if (breakEvenAnalysis.profitLoss < 0) {
        riskIndicators.push({
          level: 'high',
          message: 'Компания работает в убыток. Необходимо срочно пересмотреть расходы или увеличить выручку.'
        });
      }

      if (expensesStatistics.expensesToRevenueRatio !== null && expensesStatistics.expensesToRevenueRatio > 80) {
        riskIndicators.push({
          level: 'high',
          message: `Расходы составляют ${Math.round(expensesStatistics.expensesToRevenueRatio)}% от выручки. Высокий риск убыточности.`
        });
      }

      if (yearOverYear && yearOverYear.revenueGrowthRate !== null && yearOverYear.revenueGrowthRate < -10) {
        riskIndicators.push({
          level: 'medium',
          message: `Выручка снизилась на ${Math.abs(Math.round(yearOverYear.revenueGrowthRate))}% по сравнению с предыдущим годом.`
        });
      }

      if (trendAnalysis.firstHalfVsSecondHalf !== null && trendAnalysis.firstHalfVsSecondHalf < -20) {
        riskIndicators.push({
          level: 'medium',
          message: 'Значительное снижение выручки во второй половине года. Необходимо проанализировать причины.'
        });
      }

      if (breakEvenAnalysis.monthsToBreakEven !== null && breakEvenAnalysis.monthsToBreakEven > 12) {
        riskIndicators.push({
          level: 'medium',
          message: `До достижения безубыточности более года (${Math.ceil(breakEvenAnalysis.monthsToBreakEven)} месяцев).`
        });
      }

      return {
        projectedAnnualRevenue,
        projectedBreakEvenTimeline,
        forecastedBestMonth,
        forecastedWorstMonth,
        riskIndicators
      };
    } catch (error) {
      logger.error('Error calculating predictive insights', { error: error.message });
      throw error;
    }
  }

  /**
   * Calculate performance benchmarks comparing current year to previous year
   * Phase 16: Performance Benchmarks (FR-027)
   * @param {number} year - Current year
   * @param {string|null} asOfDate - Optional historical date
   * @param {Object} revenueMetrics - Current year revenue metrics
   * @param {Object} expensesStatistics - Current year expenses statistics
   * @param {Object} breakEvenAnalysis - Current year break-even analysis
   * @param {Object|null} yearOverYear - Year-over-year comparison data
   * @param {Object} profitabilityMetrics - Current year profitability metrics
   * @returns {Promise<Object>} Performance benchmarks object
   */
  async calculatePerformanceBenchmarks(year, asOfDate, revenueMetrics, expensesStatistics, breakEvenAnalysis, yearOverYear, profitabilityMetrics) {
    try {
      const benchmarks = {
        overallPerformance: null, // 'better', 'worse', 'same'
        breakEvenAchieved: breakEvenAnalysis.profitLoss >= 0,
        breakEvenAchievedMonth: null, // Month when break-even was achieved
        growthRateComparison: null, // Current vs previous year growth rate
        profitabilityImprovement: null, // Whether profit margin improved
        revenueComparison: null, // 'better', 'worse', 'same'
        expensesComparison: null, // 'better', 'worse', 'same'
        profitComparison: null // 'better', 'worse', 'same'
      };

      // If we have year-over-year data, calculate comparisons
      if (yearOverYear && yearOverYear.previousYear) {
        // Overall performance based on profit change
        if (yearOverYear.profitChange > 0) {
          benchmarks.overallPerformance = 'better';
        } else if (yearOverYear.profitChange < 0) {
          benchmarks.overallPerformance = 'worse';
        } else {
          benchmarks.overallPerformance = 'same';
        }

        // Revenue comparison
        if (yearOverYear.revenueGrowthRate !== null) {
          if (yearOverYear.revenueGrowthRate > 5) {
            benchmarks.revenueComparison = 'better';
          } else if (yearOverYear.revenueGrowthRate < -5) {
            benchmarks.revenueComparison = 'worse';
          } else {
            benchmarks.revenueComparison = 'same';
          }
        }

        // Expenses comparison (lower growth is better)
        if (yearOverYear.expensesGrowthRate !== null) {
          if (yearOverYear.expensesGrowthRate < 0) {
            benchmarks.expensesComparison = 'better'; // Expenses decreased
          } else if (yearOverYear.expensesGrowthRate > 10) {
            benchmarks.expensesComparison = 'worse'; // Expenses increased significantly
          } else {
            benchmarks.expensesComparison = 'same';
          }
        }

        // Profit comparison
        if (yearOverYear.profitChangePercent !== null) {
          if (yearOverYear.profitChangePercent > 10) {
            benchmarks.profitComparison = 'better';
          } else if (yearOverYear.profitChangePercent < -10) {
            benchmarks.profitComparison = 'worse';
          } else {
            benchmarks.profitComparison = 'same';
          }
        }

        // Growth rate comparison
        if (yearOverYear.revenueGrowthRate !== null) {
          benchmarks.growthRateComparison = {
            current: yearOverYear.revenueGrowthRate,
            previous: null, // Would need previous year's growth rate for comparison
            trend: yearOverYear.revenueGrowthRate > 0 ? 'positive' : yearOverYear.revenueGrowthRate < 0 ? 'negative' : 'stable'
          };
        }

        // Profitability improvement
        if (profitabilityMetrics && profitabilityMetrics.netProfitMargin !== null && yearOverYear.previousYear) {
          // Get previous year profitability (would need to fetch)
          // For now, compare to break-even status
          benchmarks.profitabilityImprovement = breakEvenAnalysis.profitLoss >= 0 ? 'improved' : 'declined';
        }
      }

      // Calculate break-even achievement month
      if (benchmarks.breakEvenAchieved && revenueMetrics && expensesStatistics) {
        // Find the month when cumulative profit became positive
        const monthlyData = await this.pnlReportService.getMonthlyRevenue(year, asOfDate);
        if (monthlyData && monthlyData.length > 0) {
          let cumulativeProfit = 0;
          const monthlyExpenses = await this.manualEntryService.getExpenses(year, asOfDate);
          
          // Group expenses by month
          const expensesByMonth = {};
          if (monthlyExpenses && monthlyExpenses.length > 0) {
            monthlyExpenses.forEach(expense => {
              const month = new Date(expense.entry_date).getMonth() + 1;
              if (!expensesByMonth[month]) {
                expensesByMonth[month] = 0;
              }
              expensesByMonth[month] += parseFloat(expense.amount) || 0;
            });
          }

          const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
          
          for (let i = 0; i < monthlyData.length; i++) {
            const monthData = monthlyData[i];
            const month = monthData.month;
            const revenue = parseFloat(monthData.total) || 0;
            const expenses = expensesByMonth[month] || 0;
            cumulativeProfit += (revenue - expenses);
            
            if (cumulativeProfit >= 0) {
              benchmarks.breakEvenAchievedMonth = {
                month,
                monthName: monthNames[month - 1],
                cumulativeProfit
              };
              break;
            }
          }
        }
      }

      return benchmarks;
    } catch (error) {
      logger.error('Error calculating performance benchmarks', { error: error.message });
      return {
        overallPerformance: null,
        breakEvenAchieved: breakEvenAnalysis.profitLoss >= 0,
        breakEvenAchievedMonth: null,
        growthRateComparison: null,
        profitabilityImprovement: null,
        revenueComparison: null,
        expensesComparison: null,
        profitComparison: null
      };
    }
  }

  /**
   * Calculate month-by-month insights
   * Phase 17: Month-by-Month Insights (FR-029)
   * @param {number} year - Year to analyze
   * @param {string|null} asOfDate - Optional historical date
   * @param {Object} revenueMetrics - Revenue metrics
   * @param {Object} expensesStatistics - Expenses statistics
   * @param {Object} breakEvenAnalysis - Break-even analysis
   * @returns {Promise<Object>} Month-by-month insights object
   */
  async calculateMonthByMonthInsights(year, asOfDate, revenueMetrics, expensesStatistics, breakEvenAnalysis) {
    try {
      const insights = {
        monthsAboveBreakEven: [],
        monthsBelowBreakEven: [],
        consecutiveProfitableStreak: null,
        consecutiveLossStreak: null,
        recoveryMonths: []
      };

      // Get monthly revenue data
      // Note: getMonthlyRevenue doesn't support asOfDate yet, using false for includeBreakdown
      const revenueData = await this.pnlReportService.getMonthlyRevenue(year, false);
      if (!revenueData || !revenueData.monthly || revenueData.monthly.length === 0) {
        logger.warn('No monthly revenue data found', { year, asOfDate });
        return insights;
      }
      
      // Extract monthly array and convert to expected format
      const monthlyRevenue = revenueData.monthly.map(entry => ({
        month: entry.month,
        total: entry.amountPln || 0
      }));
      
      logger.debug('Monthly revenue data loaded', { 
        year, 
        monthCount: monthlyRevenue.length,
        firstMonth: monthlyRevenue[0]?.month,
        firstMonthRevenue: monthlyRevenue[0]?.total
      });

      // Get monthly expenses
      const monthlyExpenses = await this.manualEntryService.getExpenses(year, asOfDate);
      const expensesByMonth = {};
      if (monthlyExpenses && monthlyExpenses.length > 0) {
        monthlyExpenses.forEach(expense => {
          const month = new Date(expense.entry_date).getMonth() + 1;
          if (!expensesByMonth[month]) {
            expensesByMonth[month] = 0;
          }
          expensesByMonth[month] += parseFloat(expense.amount) || 0;
        });
      }

      // Calculate monthly break-even point (average monthly expenses)
      const monthlyBreakEven = breakEvenAnalysis.monthlyBreakEven !== null ? breakEvenAnalysis.monthlyBreakEven : 0;
      const hasBreakEvenPoint = monthlyBreakEven > 0;
      const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

      // Analyze each month
      const monthlyProfits = [];
      let previousMonthProfit = null;
      let currentProfitableStreak = 0;
      let currentLossStreak = 0;
      let maxProfitableStreak = 0;
      let maxLossStreak = 0;
      let profitableStreakStart = null;
      let lossStreakStart = null;

      for (let i = 0; i < monthlyRevenue.length; i++) {
        const monthData = monthlyRevenue[i];
        const month = monthData.month;
        const revenue = parseFloat(monthData.total) || 0;
        const expenses = expensesByMonth[month] || 0;
        const profit = revenue - expenses;

        // Determine if month is above break-even:
        // - If no break-even point (no expenses or monthlyBreakEven is null/0), 
        //   all months with revenue > 0 are above break-even
        // - If break-even point exists, check if revenue >= break-even point
        let isAboveBreakEven;
        if (!hasBreakEvenPoint) {
          // No expenses or break-even point is 0/null - any month with revenue > 0 is above break-even
          isAboveBreakEven = revenue > 0;
        } else {
          // Break-even point exists - check if revenue covers it
          isAboveBreakEven = revenue >= monthlyBreakEven;
        }

        const monthInfo = {
          month,
          monthName: monthNames[month - 1],
          revenue,
          expenses,
          profit,
          isAboveBreakEven
        };

        monthlyProfits.push(monthInfo);

        // Categorize months
        if (monthInfo.isAboveBreakEven) {
          insights.monthsAboveBreakEven.push(monthInfo);
        } else if (hasBreakEvenPoint) {
          insights.monthsBelowBreakEven.push(monthInfo);
        }

        // Track consecutive streaks
        if (profit > 0) {
          currentProfitableStreak++;
          currentLossStreak = 0;
          if (currentProfitableStreak === 1) {
            profitableStreakStart = month;
          }
          if (currentProfitableStreak > maxProfitableStreak) {
            maxProfitableStreak = currentProfitableStreak;
          }
        } else if (profit < 0) {
          currentLossStreak++;
          currentProfitableStreak = 0;
          if (currentLossStreak === 1) {
            lossStreakStart = month;
          }
          if (currentLossStreak > maxLossStreak) {
            maxLossStreak = currentLossStreak;
          }
        } else {
          // Zero profit - reset streaks
          currentProfitableStreak = 0;
          currentLossStreak = 0;
        }

        // Detect recovery months (profit after loss)
        if (previousMonthProfit !== null && previousMonthProfit < 0 && profit > 0) {
          insights.recoveryMonths.push({
            month,
            monthName: monthNames[month - 1],
            previousProfit: previousMonthProfit,
            currentProfit: profit,
            recoveryAmount: profit - previousMonthProfit
          });
        }

        previousMonthProfit = profit;
      }

      // Set consecutive streaks
      if (maxProfitableStreak > 1) {
        insights.consecutiveProfitableStreak = {
          length: maxProfitableStreak,
          startMonth: profitableStreakStart,
          startMonthName: profitableStreakStart ? monthNames[profitableStreakStart - 1] : null
        };
      }

      if (maxLossStreak > 1) {
        insights.consecutiveLossStreak = {
          length: maxLossStreak,
          startMonth: lossStreakStart,
          startMonthName: lossStreakStart ? monthNames[lossStreakStart - 1] : null
        };
      }

      return insights;
    } catch (error) {
      logger.error('Error calculating month-by-month insights', { error: error.message });
      return {
        monthsAboveBreakEven: [],
        monthsBelowBreakEven: [],
        consecutiveProfitableStreak: null,
        consecutiveLossStreak: null,
        recoveryMonths: []
      };
    }
  }

  /**
   * Get cache key for AI insights
   * @param {number} year - Year
   * @param {string|null} asOfDate - Optional historical date
   * @param {string} period - 'month', 'quarter', or 'year'
   * @returns {string} Cache key
   */
  getAICacheKey(year, asOfDate, period) {
    const date = asOfDate ? new Date(asOfDate) : new Date();
    let periodKey = '';
    
    if (period === 'month') {
      periodKey = `${year}-${date.getMonth() + 1}`;
    } else if (period === 'quarter') {
      const quarter = Math.floor(date.getMonth() / 3) + 1;
      periodKey = `${year}-Q${quarter}`;
    } else {
      periodKey = `${year}`;
    }
    
    // Add version to cache key to invalidate old caches without currency fix and required fields
    const cacheVersion = 'v2'; // Increment when cache structure changes (v2: added currency fix and required fields)
    
    return `ai-insights-${cacheVersion}-${periodKey}${asOfDate ? `-${asOfDate}` : ''}`;
  }

  /**
   * Check if AI insights should be regenerated based on period
   * @param {number} year - Year
   * @param {string|null} asOfDate - Optional historical date
   * @param {string} period - 'month', 'quarter', or 'year'
   * @returns {boolean} True if should regenerate
   */
  shouldRegenerateAI(year, asOfDate, period) {
    const cacheKey = this.getAICacheKey(year, asOfDate, period);
    const cached = this.aiInsightsCache.get(cacheKey);
    
    if (!cached) {
      return true; // No cache, need to generate
    }
    
    const cachedDate = new Date(cached.generatedAt);
    const now = new Date();
    
    if (period === 'month') {
      // Regenerate if different month
      return cachedDate.getMonth() !== now.getMonth() || cachedDate.getFullYear() !== now.getFullYear();
    } else if (period === 'quarter') {
      // Regenerate if different quarter
      const cachedQuarter = Math.floor(cachedDate.getMonth() / 3);
      const currentQuarter = Math.floor(now.getMonth() / 3);
      return cachedQuarter !== currentQuarter || cachedDate.getFullYear() !== now.getFullYear();
    } else {
      // Regenerate if different year
      return cachedDate.getFullYear() !== now.getFullYear();
    }
  }

  /**
   * Calculate strategic insights using AI (with caching) or rule-based fallback
   * Phase 18-19: Strategic Insights - AI-Powered with Rule-Based Fallback (FR-010, FR-030-FR-035)
   * @param {Object} insights - All calculated insights
   * @param {boolean} [regenerateAI=false] - Force regeneration of AI insights
   * @param {string} [aiPeriod='month'] - AI regeneration period: 'month', 'quarter', or 'year'
   * @returns {Promise<Object>} Strategic insights object
   */
  async calculateStrategicInsights(insights, regenerateAI = false, aiPeriod = 'month') {
    // Try AI generation first (if enabled)
    // Cache removed - always generate fresh data
    if (this.openAIService.enabled) {
      const year = insights.year;
      const asOfDate = insights.asOfDate;
      
      // Always generate fresh AI insights (no cache)
      try {
        logger.info('Generating AI strategic insights (always fresh, no cache)', {
          year,
          aiPeriod
        });
        
        // Add currency information to insights data for AI
        const insightsWithCurrency = {
          ...insights,
          currency: 'PLN',
          currencyName: 'польские злотые',
          currencyNote: 'Все суммы в данных указаны в польских злотых (PLN), НЕ в долларах'
        };
        
        const aiInsights = await this.openAIService.generateStrategicInsights(insightsWithCurrency);
        
        // Cache removed - not saving to cache, always generate fresh
        
        logger.info('AI strategic insights generated (fresh data, not cached)', {
          year,
          aiPeriod,
          hasVision: !!aiInsights.vision && aiInsights.vision.trim() !== '',
          scalingOpportunitiesCount: aiInsights.scalingOpportunities?.length || 0,
          diversificationIdeasCount: aiInsights.diversificationIdeas?.length || 0,
          allFields: Object.keys(aiInsights)
        });
        
        return aiInsights;
      } catch (error) {
        logger.warn('AI strategic insights generation failed, using rule-based fallback', {
          error: error.message,
          year,
          aiPeriod
        });
        // Fall through to rule-based generation
      }
    }
    
    // Fallback to rule-based generation
    return await this.generateRuleBasedStrategicInsights(insights);
  }

  /**
   * Generate rule-based strategic insights (fallback)
   * Phase 18: Strategic Insights - Rule-Based (FR-010, FR-034)
   * @param {Object} insights - All calculated insights
   * @returns {Promise<Object>} Strategic insights object
   */
  async generateRuleBasedStrategicInsights(insights) {
    try {
      const strategic = {
        generatedAt: new Date().toISOString(),
        generatedBy: 'rule-based',
        summary: '',
        breakEvenStatus: '',
        growthTrajectory: '',
        seasonalPatterns: '',
        keyObservations: [],
        recommendations: [],
        vision: '', // AI-only field
        scalingOpportunities: [], // AI-only field
        diversificationIdeas: [] // AI-only field
      };

      // Overall performance summary
      const revenue = insights.revenueMetrics?.totalAnnual || 0;
      const expenses = insights.expensesStatistics?.totalAnnual || 0;
      const profit = insights.breakEvenAnalysis?.profitLoss || 0;
      const profitMargin = insights.profitabilityMetrics?.netProfitMargin || 0;

      if (profit > 0) {
        strategic.summary = `Год завершился с прибылью ${this.formatCurrency(profit)} PLN (маржа ${this.formatCurrency(profitMargin)}%). `;
      } else if (profit < 0) {
        strategic.summary = `Год завершился с убытком ${Math.abs(this.formatCurrency(profit))} PLN. `;
      } else {
        strategic.summary = `Год завершился на точке безубыточности. `;
      }

      strategic.summary += `Общая выручка составила ${this.formatCurrency(revenue)} PLN, расходы - ${this.formatCurrency(expenses)} PLN.`;

      // Break-even status assessment
      if (insights.breakEvenAnalysis) {
        const bea = insights.breakEvenAnalysis;
        if (bea.profitLoss >= 0) {
          strategic.breakEvenStatus = `Безубыточность достигнута. Прибыль составляет ${this.formatCurrency(bea.profitLoss)} PLN (${this.formatCurrency(bea.profitMargin || 0)}%).`;
          if (insights.performanceBenchmarks?.breakEvenAchievedMonth) {
            strategic.breakEvenStatus += ` Точка безубыточности была достигнута в ${insights.performanceBenchmarks.breakEvenAchievedMonth.monthName}.`;
          }
        } else {
          strategic.breakEvenStatus = `Безубыточность не достигнута. Текущий убыток составляет ${Math.abs(this.formatCurrency(bea.profitLoss))} PLN.`;
          if (bea.monthsToBreakEven !== null && bea.monthsToBreakEven > 0) {
            strategic.breakEvenStatus += ` При текущих темпах безубыточность будет достигнута через ${bea.monthsToBreakEven} месяцев.`;
          }
        }
      }

      // Growth trajectory assessment
      if (insights.yearOverYear) {
        const yoy = insights.yearOverYear;
        if (yoy.revenueGrowthRate !== null) {
          if (yoy.revenueGrowthRate > 20) {
            strategic.growthTrajectory = `Выручка выросла на ${this.formatCurrency(yoy.revenueGrowthRate)}% по сравнению с предыдущим годом - отличный рост.`;
          } else if (yoy.revenueGrowthRate > 5) {
            strategic.growthTrajectory = `Выручка выросла на ${this.formatCurrency(yoy.revenueGrowthRate)}% по сравнению с предыдущим годом - стабильный рост.`;
          } else if (yoy.revenueGrowthRate > -5) {
            strategic.growthTrajectory = `Выручка изменилась на ${this.formatCurrency(yoy.revenueGrowthRate)}% по сравнению с предыдущим годом - стабильная ситуация.`;
          } else if (yoy.revenueGrowthRate > -20) {
            strategic.growthTrajectory = `Выручка снизилась на ${Math.abs(this.formatCurrency(yoy.revenueGrowthRate))}% по сравнению с предыдущим годом - требуется внимание.`;
          } else {
            strategic.growthTrajectory = `Выручка значительно снизилась на ${Math.abs(this.formatCurrency(yoy.revenueGrowthRate))}% по сравнению с предыдущим годом - критическая ситуация.`;
          }
        }
      } else {
        strategic.growthTrajectory = 'Недостаточно данных для сравнения с предыдущим годом.';
      }

      // Seasonal patterns identification
      if (insights.trendAnalysis?.seasonalityDetected) {
        strategic.seasonalPatterns = 'Обнаружены сезонные паттерны в выручке. ';
        if (insights.trendAnalysis.peakPeriod) {
          strategic.seasonalPatterns += `Пиковый период: ${insights.trendAnalysis.peakPeriod.startMonthName}-${insights.trendAnalysis.peakPeriod.endMonthName}. `;
        }
        if (insights.trendAnalysis.lowPeriod) {
          strategic.seasonalPatterns += `Низкий период: ${insights.trendAnalysis.lowPeriod.startMonthName}-${insights.trendAnalysis.lowPeriod.endMonthName}.`;
        }
      } else {
        strategic.seasonalPatterns = 'Явных сезонных паттернов не обнаружено.';
      }

      // Key observations
      if (insights.monthByMonth) {
        const mbm = insights.monthByMonth;
        if (mbm.monthsAboveBreakEven && mbm.monthsAboveBreakEven.length > 0) {
          strategic.keyObservations.push(`Месяцев выше безубыточности: ${mbm.monthsAboveBreakEven.length} из 12.`);
        }
        if (mbm.consecutiveProfitableStreak && mbm.consecutiveProfitableStreak.length > 3) {
          strategic.keyObservations.push(`Достигнута серия из ${mbm.consecutiveProfitableStreak.length} прибыльных месяцев подряд.`);
        }
        if (mbm.consecutiveLossStreak && mbm.consecutiveLossStreak.length > 2) {
          strategic.keyObservations.push(`Обнаружена серия из ${mbm.consecutiveLossStreak.length} убыточных месяцев подряд - требуется внимание.`);
        }
        if (mbm.recoveryMonths && mbm.recoveryMonths.length > 0) {
          strategic.keyObservations.push(`Месяцев восстановления: ${mbm.recoveryMonths.length} (прибыль после убытка).`);
        }
      }

      if (insights.stabilityVolatility) {
        const sv = insights.stabilityVolatility;
        if (sv.stabilityScore === 'very_stable' || sv.stabilityScore === 'stable') {
          strategic.keyObservations.push('Выручка демонстрирует стабильность - предсказуемый доход.');
        } else if (sv.stabilityScore === 'high_volatility') {
          strategic.keyObservations.push('Высокая волатильность выручки - требуется анализ причин колебаний.');
        }
      }

      if (insights.expensesStatistics?.topCategories && insights.expensesStatistics.topCategories.length > 0) {
        const topCategory = insights.expensesStatistics.topCategories[0];
        strategic.keyObservations.push(`Крупнейшая категория расходов: ${topCategory.categoryName} (${this.formatCurrency(topCategory.total)} PLN, ${this.formatCurrency(topCategory.percentageOfRevenue || 0)}% от оборота).`);
      }

      // Actionable strategic recommendations
      if (profit < 0) {
        strategic.recommendations.push('Сфокусироваться на достижении безубыточности: увеличить выручку или сократить расходы.');
      }

      if (insights.yearOverYear?.revenueGrowthRate !== null && insights.yearOverYear.revenueGrowthRate < -10) {
        strategic.recommendations.push('Проанализировать причины снижения выручки и разработать план восстановления роста.');
      }

      if (insights.expensesStatistics?.expensesToRevenueRatio !== null && insights.expensesStatistics.expensesToRevenueRatio > 80) {
        strategic.recommendations.push('Оптимизировать расходы: текущие расходы составляют более 80% от выручки.');
      }

      if (insights.cashRunway?.burnRate !== null && insights.cashRunway.burnRate > 0) {
        strategic.recommendations.push(`Снизить burn rate: текущий расход превышает доход на ${this.formatCurrency(insights.cashRunway.burnRate)} PLN/мес.`);
      }

      if (insights.trendAnalysis?.seasonalityDetected) {
        strategic.recommendations.push('Использовать сезонные паттерны для планирования: подготовиться к пиковым и низким периодам заранее.');
      }

      if (insights.monthByMonth?.consecutiveProfitableStreak && insights.monthByMonth.consecutiveProfitableStreak.length >= 6) {
        strategic.recommendations.push('Поддерживать текущую стратегию: достигнута стабильная серия прибыльных месяцев.');
      }

      if (insights.predictiveInsights?.riskIndicators && insights.predictiveInsights.riskIndicators.length > 0) {
        insights.predictiveInsights.riskIndicators.forEach(risk => {
          if (risk.level === 'high') {
            strategic.recommendations.push(`Критический риск: ${risk.message}`);
          }
        });
      }

      if (strategic.recommendations.length === 0) {
        strategic.recommendations.push('Продолжать мониторинг ключевых метрик и поддерживать текущую стратегию.');
      }

      return strategic;
    } catch (error) {
      logger.error('Error calculating strategic insights', { error: error.message });
      return {
        generatedAt: new Date().toISOString(),
        generatedBy: 'rule-based',
        summary: 'Не удалось сгенерировать стратегические выводы.',
        breakEvenStatus: '',
        growthTrajectory: '',
        seasonalPatterns: '',
        keyObservations: [],
        recommendations: [],
        vision: '',
        scalingOpportunities: [],
        diversificationIdeas: []
      };
    }
  }

  /**
   * Calculate marketing metrics for the year
   * @param {number} year - Year
   * @param {string|null} asOfDate - Optional historical date
   * @returns {Promise<Object>} Marketing metrics object
   */
  async calculateMarketingMetrics(year, asOfDate = null) {
    try {
      // Get MQL snapshots for the year
      const snapshots = await mqlRepository.fetchSnapshots(year);
      
      if (!snapshots || snapshots.length === 0) {
        logger.info('No marketing data available', { year });
        return {
          totalMQL: 0,
          totalMarketingExpense: 0,
          totalWonDeals: 0,
          totalClosedDeals: 0,
          averageCostPerMQL: null,
          averageCostPerDeal: null,
          conversionRate: null,
          monthlyBreakdown: []
        };
      }

      // Filter by asOfDate if provided
      let filteredSnapshots = snapshots;
      if (asOfDate) {
        const asOfDateObj = new Date(asOfDate);
        filteredSnapshots = snapshots.filter(snapshot => {
          const snapshotDate = new Date(snapshot.year, snapshot.month - 1);
          return snapshotDate <= asOfDateObj;
        });
      }

      // Calculate totals
      const totals = filteredSnapshots.reduce((acc, snapshot) => {
        acc.totalMQL += snapshot.combined_mql || 0;
        acc.totalMarketingExpense += parseFloat(snapshot.marketing_expense || 0);
        acc.totalWonDeals += snapshot.won_deals || 0;
        acc.totalClosedDeals += snapshot.closed_deals || 0;
        return acc;
      }, {
        totalMQL: 0,
        totalMarketingExpense: 0,
        totalWonDeals: 0,
        totalClosedDeals: 0
      });

      // Calculate averages
      const averageCostPerMQL = totals.totalMQL > 0 
        ? Math.round((totals.totalMarketingExpense / totals.totalMQL) * 100) / 100
        : null;
      
      const averageCostPerDeal = totals.totalClosedDeals > 0
        ? Math.round((totals.totalMarketingExpense / totals.totalClosedDeals) * 100) / 100
        : null;

      // Calculate conversion rate (MQL to closed deals)
      const conversionRate = totals.totalMQL > 0
        ? Math.round((totals.totalClosedDeals / totals.totalMQL) * 100 * 100) / 100
        : null;

      // Monthly breakdown
      const monthlyBreakdown = filteredSnapshots.map(snapshot => ({
        month: snapshot.month,
        monthName: this.getMonthName(snapshot.month),
        mql: snapshot.combined_mql || 0,
        marketingExpense: Math.round(parseFloat(snapshot.marketing_expense || 0) * 100) / 100,
        wonDeals: snapshot.won_deals || 0,
        closedDeals: snapshot.closed_deals || 0,
        costPerMQL: snapshot.cost_per_mql ? Math.round(parseFloat(snapshot.cost_per_mql) * 100) / 100 : null,
        costPerDeal: snapshot.cost_per_deal ? Math.round(parseFloat(snapshot.cost_per_deal) * 100) / 100 : null
      })).sort((a, b) => a.month - b.month);

      return {
        totalMQL: totals.totalMQL,
        totalMarketingExpense: Math.round(totals.totalMarketingExpense * 100) / 100,
        totalWonDeals: totals.totalWonDeals,
        totalClosedDeals: totals.totalClosedDeals,
        averageCostPerMQL,
        averageCostPerDeal,
        conversionRate,
        monthlyBreakdown
      };
    } catch (error) {
      logger.error('Error calculating marketing metrics', { error: error.message, year, asOfDate });
      return {
        totalMQL: 0,
        totalMarketingExpense: 0,
        totalWonDeals: 0,
        totalClosedDeals: 0,
        averageCostPerMQL: null,
        averageCostPerDeal: null,
        conversionRate: null,
        monthlyBreakdown: []
      };
    }
  }

  /**
   * Format currency value (helper for strategic insights)
   * @param {number} value - Value to format
   * @returns {string} Formatted value
   */
  formatCurrency(value) {
    if (value === null || value === undefined || isNaN(value)) return '0.00';
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }
}

module.exports = PnlInsightsService;

