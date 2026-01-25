const path = require('path');
const fs = require('fs');
const SendpulseMqlClient = require('./sendpulseMqlClient');
const PipedriveMqlClient = require('./pipedriveMqlClient');
const PnlExpenseClient = require('./pnlExpenseClient');
const mqlRepository = require('./mqlRepository');
const mqlConfig = require('../../config/mql');
const { getMonthKey, normalizeEmail } = require('./mqlNormalizer');
const logger = require('../../utils/logger');
const sendpulseBaseline = require(path.join(__dirname, '../../../data/analytics/sendpulse-baseline.json'));

class MqlSyncService {
  constructor(options = {}) {
    this.sendpulseClient = options.sendpulseClient || new SendpulseMqlClient();
    this.pipedriveClient =
      options.pipedriveClient ||
      new PipedriveMqlClient({
        resolveFirstSeenFromFlow: true
      });
    this.pnlExpenseClient = options.pnlExpenseClient || new PnlExpenseClient();
    this.skipPipedrive = Boolean(
      options.skipPipedrive ?? (process.env.MQL_SKIP_PIPEDRIVE === '1')
    );
  }

  async run({ year, currentMonthOnly = true } = {}) {
    const targetYear = Number(year) || new Date().getFullYear();
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    
    // Если обновляем только текущий месяц, используем специальную логику
    if (currentMonthOnly && targetYear === currentYear) {
      return await this.runCurrentMonthOnly(targetYear, currentMonth);
    }
    
    // Полная синхронизация для прошлых годов или при явном запросе
    const dataset = this.createDataset(targetYear);

    await this.collectSendpulse(dataset, targetYear);
    if (this.skipPipedrive) {
      logger.warn('Skipping Pipedrive collection (MQL_SKIP_PIPEDRIVE enabled)');
    } else {
      // Для полной синхронизации не используем cutoffDate, чтобы получить все сделки
      await this.collectPipedrive(dataset, targetYear, { useCutoffDate: false });
    }
    await this.collectMarketingExpenses(dataset, targetYear);
    this.applySendpulseBaseline(dataset, targetYear);
    // Пересчитываем повторные продажи на основе всех выигранных сделок
    this.recalculateRepeatSales(dataset);
    this.updateConversion(dataset);
    this.updateCostMetrics(dataset);
    await this.persistSnapshots(dataset);

    return {
      year: targetYear,
      months: dataset.months,
      sync: dataset.sync
    };
  }

  /**
   * Обновляет только текущий месяц, сохраняя данные остальных месяцев из существующих snapshots.
   * ВАЖНО: Для других месяцев обновляются счетчики won_deals и closed_deals из новых данных Pipedrive,
   * так как сделки могут обновляться (меняться статус) даже после того, как месяц прошел.
   */
  async runCurrentMonthOnly(year, month) {
    logger.info('Running MQL sync for current month only', { year, month });
    
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const dataset = this.createDataset(year);
    
    // Загружаем существующие snapshots для сохранения данных других месяцев
    const existingSnapshots = await mqlRepository.fetchSnapshots(year);
    const snapshotMap = new Map();
    existingSnapshots.forEach(s => {
      const key = `${s.year}-${String(s.month).padStart(2, '0')}`;
      snapshotMap.set(key, s);
    });

    // Загружаем существующие данные в dataset для других месяцев, чтобы они не потерялись
    // НО: счетчики won_deals и closed_deals будут обновлены из новых данных Pipedrive
    for (const monthKeyIter of dataset.months) {
      if (monthKeyIter !== monthKey) {
        const existing = snapshotMap.get(monthKeyIter);
        if (existing) {
          // Восстанавливаем данные из существующего snapshot
          dataset.sources[monthKeyIter].sendpulse.mql = existing.sendpulse_mql || 0;
          dataset.sources[monthKeyIter].pipedrive.mql = existing.pipedrive_mql || 0;
          dataset.sources[monthKeyIter].combined.mql = existing.combined_mql || 0;
          // НЕ восстанавливаем won/closed/repeat - они будут обновлены из новых данных Pipedrive
          dataset.sources[monthKeyIter].combined.won = 0;
          dataset.sources[monthKeyIter].combined.repeat = 0;
          dataset.sources[monthKeyIter].combined.closed = 0;
          dataset.metrics[monthKeyIter].budget = existing.marketing_expense || 0;
          dataset.metrics[monthKeyIter].subscribers = existing.subscribers || 0;
          dataset.metrics[monthKeyIter].newSubscribers = existing.new_subscribers || 0;
          dataset.metrics[monthKeyIter].costPerSubscriber = existing.cost_per_subscriber || null;
          dataset.metrics[monthKeyIter].costPerMql = existing.cost_per_mql || null;
          dataset.metrics[monthKeyIter].costPerDeal = existing.cost_per_deal || null;
          dataset.channels[monthKeyIter] = existing.channel_breakdown || {};
        }
      }
    }

    // Собираем новые данные из Pipedrive для ВСЕХ месяцев (чтобы обновить won_deals и closed_deals)
    // Это важно, так как сделки могут обновляться (меняться статус) даже после того, как месяц прошел
    await this.collectSendpulse(dataset, year);
    if (!this.skipPipedrive) {
      // Для обновления won_deals и closed_deals нужно собирать данные для всех месяцев
      // Но для текущего месяца также обновим pipedrive_mql
      await this.collectPipedrive(dataset, year);
    }
    await this.collectMarketingExpenses(dataset, year);
    this.applySendpulseBaseline(dataset, year);
    // Пересчитываем повторные продажи на основе всех выигранных сделок
    this.recalculateRepeatSales(dataset);
    this.updateConversion(dataset);
    this.updateCostMetrics(dataset);

    // Обновляем все snapshots
    for (const monthKeyIter of dataset.months) {
      const [yearStr, monthStr] = monthKeyIter.split('-');
      const row = dataset.sources[monthKeyIter];
      const existing = snapshotMap.get(monthKeyIter);
      
      // Для текущего месяца используем все новые данные
      // Для других месяцев сохраняем старые значения pipedrive_mql и sendpulse_mql,
      // но обновляем won_deals, closed_deals, repeat_deals из новых данных Pipedrive
      const isCurrentMonth = monthKeyIter === monthKey;
      
      // Для других месяцев используем старые значения MQL, но обновленные won/closed/repeat
      const finalSendpulseMql = isCurrentMonth ? row.sendpulse.mql : (existing?.sendpulse_mql || 0);
      const finalPipedriveMql = isCurrentMonth ? row.pipedrive.mql : (existing?.pipedrive_mql || 0);
      const finalCombinedMql = finalSendpulseMql + finalPipedriveMql;
      
      // Пересчитываем метрики стоимости с учетом обновленных данных
      const budget = dataset.metrics[monthKeyIter].budget;
      const finalCostPerMql = budget > 0 && finalCombinedMql > 0 ? budget / finalCombinedMql : null;
      const finalCostPerDeal = budget > 0 && row.combined.won > 0 ? budget / row.combined.won : null;
      const finalCostPerSubscriber = budget > 0 && dataset.metrics[monthKeyIter].newSubscribers > 0
        ? budget / dataset.metrics[monthKeyIter].newSubscribers
        : null;
      
      await mqlRepository.upsertSnapshot(Number(yearStr), Number(monthStr), {
        sendpulseMql: finalSendpulseMql,
        pipedriveMql: finalPipedriveMql,
        combinedMql: finalCombinedMql,
        // ВСЕГДА обновляем из новых данных Pipedrive (сделки могут обновляться)
        wonDeals: row.combined.won,
        repeatDeals: row.combined.repeat,
        closedDeals: row.combined.closed,
        marketingExpense: budget,
        subscribers: dataset.metrics[monthKeyIter].subscribers,
        newSubscribers: dataset.metrics[monthKeyIter].newSubscribers,
        costPerSubscriber: finalCostPerSubscriber,
        costPerMql: finalCostPerMql,
        costPerDeal: finalCostPerDeal,
        retentionRate: row.combined.retention ?? null,
        channelBreakdown: isCurrentMonth 
          ? dataset.channels[monthKeyIter] 
          : (existing?.channel_breakdown || {}),
        // Обновляем даты синхронизации только для текущего месяца
        pipedriveSyncAt: isCurrentMonth ? dataset.sync.pipedrive : existing?.pipedrive_sync_at,
        sendpulseSyncAt: isCurrentMonth ? dataset.sync.sendpulse : existing?.sendpulse_sync_at,
        pnlSyncAt: isCurrentMonth ? dataset.sync.pnl : existing?.pnl_sync_at
      });
      
      if (isCurrentMonth) {
        logger.info('Updated current month snapshot', { monthKey: monthKeyIter });
      } else if (row.combined.won > 0 || row.combined.closed > 0 || row.combined.repeat > 0) {
        logger.info('Updated won/closed/repeat deals for past month', { 
          monthKey: monthKeyIter,
          won: row.combined.won,
          closed: row.combined.closed,
          repeat: row.combined.repeat,
          previousWon: existing?.won_deals || 0,
          previousClosed: existing?.closed_deals || 0
        });
      }
    }

    // Сохраняем новые лиды
    const leads = dataset.leads
      .filter((lead) => lead.firstSeenMonth)
      .map((lead) => ({
        source: lead.source,
        externalId: lead.externalId,
        email: lead.email || null,
        username: lead.username,
        firstSeenMonth: lead.firstSeenMonth,
        channelBucket: lead.channelBucket || null,
        payload: lead.payload
      }));

    if (leads.length) {
      await mqlRepository.bulkUpsertLeads(leads);
    }

    return {
      year,
      months: [monthKey],
      sync: dataset.sync
    };
  }

  createDataset(year) {
    const months = Array.from({ length: 12 }, (_, idx) => `${year}-${String(idx + 1).padStart(2, '0')}`);
    const sources = {};
    const channels = {};
    const metrics = {};

    months.forEach((month) => {
      sources[month] = {
        pipedrive: { mql: 0 },
        sendpulse: { mql: 0 },
        combined: { mql: 0, won: 0, closed: 0, repeat: 0, conversion: 0 }
      };
      channels[month] = {};
      metrics[month] = {
        budget: 0,
        subscribers: 0,
        newSubscribers: 0,
        costPerSubscriber: null,
        costPerMql: null,
        costPerDeal: null
      };
    });

    return {
      year,
      months,
      sources,
      channels,
      metrics,
      leads: [],
      dedupe: new Map(),
      pipedriveSendpulse: new Map(),
      sync: {
        sendpulse: null,
        pipedrive: null,
        pnl: null
      }
    };
  }

  async collectSendpulse(dataset, year) {
    const dumpPath = path.join(__dirname, '../../../tmp', `sendpulse-mql-raw-sync-${Date.now()}.json`);
    let contacts = [];
    let fetchedAt = null;

    try {
      const result = await this.sendpulseClient.fetchContacts({ dumpFile: dumpPath });
      contacts = result.contacts || [];
      fetchedAt = result.fetchedAt;
    } finally {
      this.safeDelete(dumpPath);
    }

    contacts.forEach((contact) => {
      const monthKey = getMonthKey(contact.createdAt || contact.lastActivityAt);
      const dedupeKey = this.buildDedupeKey({
        source: 'sendpulse',
        email: contact.email,
        username: contact.username,
        externalId: contact.externalId
      });

      if (!monthKey || !monthKey.startsWith(`${dataset.year}-`)) {
        this.trackLead(dataset, dedupeKey);
        return;
      }

      const firstSeenMonth = `${monthKey}-01`;
      const monthRow = dataset.sources[monthKey];
      if (!monthRow) {
        this.trackLead(dataset, dedupeKey);
        return;
      }

      const seenBefore = this.trackLead(dataset, dedupeKey);

      if (this.shouldSkipTelegramContact(dataset, contact, monthKey)) {
        return;
      }

      monthRow.sendpulse.mql += 1;
      if (!seenBefore) {
        monthRow.combined.mql += 1;
      }

      dataset.leads.push({
        source: 'sendpulse',
        externalId: contact.externalId,
        email: contact.email || null,
        username: contact.username,
        firstSeenMonth,
        channelBucket: null,
        payload: contact.raw
      });
    });

    dataset.sync.sendpulse = fetchedAt || new Date().toISOString();
  }

  async collectPipedrive(dataset, year, options = {}) {
    // Для полной синхронизации (useCutoffDate: false) не используем cutoffDate,
    // чтобы получить все сделки независимо от даты последнего обновления.
    // Для инкрементального обновления (useCutoffDate: true) используем cutoffDate
    // для оптимизации, но он может пропустить обновленные сделки из других месяцев.
    let cutoffDate = null;
    if (options.useCutoffDate !== false) {
      cutoffDate = await this.determinePipedriveCutoffDate();
      if (cutoffDate) {
        logger.info('Using incremental Pipedrive cutoff', { cutoffDate: cutoffDate.toISOString() });
      }
    } else {
      logger.info('Full Pipedrive sync - no cutoff date', { year });
    }

    const result = await this.pipedriveClient.fetchMqlDeals({
      resolveFirstSeenFromFlow: true,
      cutoffDate
    });
    const deals = result.deals || [];
    dataset.sync.pipedrive = result.fetchedAt || new Date().toISOString();
    
    logger.info('Collected Pipedrive deals', { 
      count: deals.length, 
      year,
      cutoffUsed: !!cutoffDate 
    });

    deals.forEach((deal) => {
      const monthKey = deal.firstSeenMonth ? deal.firstSeenMonth.slice(0, 7) : null;
      const dedupeKey = this.buildDedupeKey({
        source: 'pipedrive',
        email: deal.email,
        username: deal.username,
        externalId: deal.id
      });

      if (!monthKey || !monthKey.startsWith(`${dataset.year}-`)) {
        this.trackLead(dataset, dedupeKey);
      } else {
        const monthRow = dataset.sources[monthKey];
        if (monthRow) {
          const seenBefore = this.trackLead(dataset, dedupeKey);
          monthRow.pipedrive.mql += 1;
          if (!seenBefore) {
            monthRow.combined.mql += 1;
          }

          if (deal.channelBucket) {
            const bucket = deal.channelBucket;
            dataset.channels[monthKey][bucket] = (dataset.channels[monthKey][bucket] || 0) + 1;
          }
        }
      }

      this.incrementWonAndClosed(dataset, deal);
      this.incrementRepeatSales(dataset, deal);
      this.registerPipedriveSendpulse(dataset, deal, monthKey);

      dataset.leads.push({
        source: 'pipedrive',
        externalId: String(deal.id),
        email: deal.email,
        username: deal.username,
        firstSeenMonth: deal.firstSeenMonth ? `${deal.firstSeenMonth.slice(0, 7)}-01` : null,
        channelBucket: deal.channelBucket,
        payload: {
          ...deal,
          // Сохраняем все необходимые поля для пересчета повторных продаж
          id: deal.id,
          dealId: deal.id,
          personId: deal.personId,
          person_id: deal.personId,
          wonTime: deal.wonTime,
          won_time: deal.wonTime,
          closeTime: deal.closeTime,
          close_time: deal.closeTime
        }
      });
    });
  }

  async collectMarketingExpenses(dataset, year) {
    try {
      const result = await this.pnlExpenseClient.getMarketingExpenses(year);
      dataset.months.forEach((monthKey) => {
        dataset.metrics[monthKey].budget = result.months[monthKey] || 0;
      });
      dataset.sync.pnl = new Date().toISOString();
    } catch (error) {
      logger.error('Failed to fetch marketing expenses for MQL sync', { error: error.message });
    }
  }

  incrementWonAndClosed(dataset, deal) {
    const wonMonthKey = getMonthKey(deal.wonTime);
    if (wonMonthKey && dataset.sources[wonMonthKey]) {
      dataset.sources[wonMonthKey].combined.won += 1;
    }

    const closedTimestamp = deal.closeTime || deal.wonTime || deal.lostTime;
    const closedMonthKey = getMonthKey(closedTimestamp);
    if (closedMonthKey && dataset.sources[closedMonthKey]) {
      dataset.sources[closedMonthKey].combined.closed += 1;
    }
  }

  incrementRepeatSales(dataset, deal) {
    // Старая логика на основе метки - оставляем для обратной совместимости,
    // но основной пересчет будет в recalculateRepeatSales
    if (!deal.isRepeatCustomer) {
      return;
    }
    const repeatMonth =
      getMonthKey(deal.wonTime) ||
      getMonthKey(deal.closeTime) ||
      getMonthKey(deal.updateTime) ||
      deal.firstSeenMonth;

    if (!repeatMonth || !repeatMonth.startsWith(`${dataset.year}-`)) {
      return;
    }

    const row = dataset.sources[repeatMonth];
    if (row?.combined) {
      row.combined.repeat += 1;
    }
  }

  /**
   * Пересчитывает повторные продажи на основе всех выигранных сделок для каждого клиента.
   * Повторной считается любая выигранная сделка клиента, у которого уже была хотя бы одна выигранная сделка ранее.
   */
  recalculateRepeatSales(dataset) {
    logger.info('Recalculating repeat sales based on all won deals', { year: dataset.year });
    
    // Сбрасываем счетчики повторных продаж
    dataset.months.forEach((monthKey) => {
      if (dataset.sources[monthKey]?.combined) {
        dataset.sources[monthKey].combined.repeat = 0;
      }
    });

    // Собираем все выигранные сделки из dataset.leads
    const wonDealsByPerson = new Map();
    let totalWonDeals = 0;
    
    dataset.leads.forEach((lead) => {
      if (lead.source !== 'pipedrive') return;
      
      const deal = lead.payload || {};
      if (!deal.wonTime && !deal.won_time) return;
      
      const personId = deal.personId || deal.person_id;
      if (!personId) return;
      
      const wonTime = deal.wonTime || deal.won_time;
      const wonMonth = getMonthKey(wonTime);
      if (!wonMonth || !wonMonth.startsWith(`${dataset.year}-`)) return;
      
      totalWonDeals++;
      
      if (!wonDealsByPerson.has(personId)) {
        wonDealsByPerson.set(personId, []);
      }
      
      wonDealsByPerson.get(personId).push({
        dealId: deal.id || deal.dealId,
        wonTime,
        wonMonth
      });
    });

    // Для каждого клиента определяем повторные продажи
    let totalRepeatDeals = 0;
    const repeatDealsByMonth = {};
    
    wonDealsByPerson.forEach((deals, personId) => {
      if (deals.length <= 1) {
        return; // Если только одна сделка, повторных нет
      }
      
      // Сортируем по дате выигрыша
      deals.sort((a, b) => {
        const ta = new Date(a.wonTime).getTime();
        const tb = new Date(b.wonTime).getTime();
        return ta - tb;
      });
      
      // Первая сделка - не повторная, все остальные - повторные
      deals.slice(1).forEach((deal) => {
        const monthKey = deal.wonMonth;
        const row = dataset.sources[monthKey];
        if (row?.combined) {
          row.combined.repeat += 1;
          totalRepeatDeals++;
          repeatDealsByMonth[monthKey] = (repeatDealsByMonth[monthKey] || 0) + 1;
        }
      });
    });
    
    logger.info('Repeat sales recalculation completed', {
      year: dataset.year,
      totalWonDeals,
      customersWithMultipleDeals: wonDealsByPerson.size - Array.from(wonDealsByPerson.values()).filter(d => d.length <= 1).length,
      totalRepeatDeals,
      repeatDealsByMonth
    });
  }

  registerPipedriveSendpulse(dataset, deal, monthKey) {
    if (!deal?.sendpulseId || !monthKey) {
      return;
    }
    const key = String(deal.sendpulseId).trim();
    if (!key.length) {
      return;
    }
    if (!dataset.pipedriveSendpulse.has(key)) {
      dataset.pipedriveSendpulse.set(key, monthKey);
    }
  }

  shouldSkipTelegramContact(dataset, contact, monthKey) {
    if (contact?.botType !== 'telegram') {
      return false;
    }
    const sendpulseId = contact?.sendpulseId;
    if (!sendpulseId) {
      return false;
    }
    const linkedMonth = dataset.pipedriveSendpulse.get(String(sendpulseId));
    if (!linkedMonth) {
      return false;
    }
    if (linkedMonth === monthKey) {
      const metrics = dataset.metrics[monthKey];
      if (metrics) {
        metrics.telegramDedup = (metrics.telegramDedup || 0) + 1;
      }
      return true;
    }
    return false;
  }

  applySendpulseBaseline(dataset, year) {
    const baseline = sendpulseBaseline[String(year)];
    if (!baseline) return;

    dataset.months.forEach((month) => {
      const idx = month.slice(5);
      const baselineValue = baseline[idx];
      if (typeof baselineValue !== 'number') return;
      const row = dataset.sources[month];
      if (!row) return;
      if (row.sendpulse.mql > 0) return;

      row.sendpulse.mql = baselineValue;
      row.combined.mql = row.pipedrive.mql + baselineValue;
    });
  }

  updateConversion(dataset) {
    dataset.months.forEach((month) => {
      const combined = dataset.sources[month]?.combined;
      if (!combined) return;
      combined.conversion = combined.mql > 0 ? combined.won / combined.mql : null;
      combined.retention = combined.won > 0 ? combined.repeat / combined.won : null;
    });
  }

  updateCostMetrics(dataset) {
    dataset.months.forEach((monthKey) => {
      const metrics = dataset.metrics[monthKey];
      const combined = dataset.sources[monthKey]?.combined;
      if (!metrics || !combined) return;

      metrics.costPerMql =
        metrics.budget > 0 && combined.mql > 0 ? metrics.budget / combined.mql : null;
      metrics.costPerDeal =
        metrics.budget > 0 && combined.won > 0 ? metrics.budget / combined.won : null;
      metrics.costPerSubscriber =
        metrics.budget > 0 && metrics.newSubscribers > 0
          ? metrics.budget / metrics.newSubscribers
          : null;
    });
  }

  async persistSnapshots(dataset) {
    const leads = dataset.leads
      .filter((lead) => lead.firstSeenMonth)
      .map((lead) => ({
        source: lead.source,
        externalId: lead.externalId,
        email: lead.email || null,
        username: lead.username,
        firstSeenMonth: lead.firstSeenMonth,
        channelBucket: lead.channelBucket || null,
        payload: lead.payload
      }));

    if (leads.length) {
      await mqlRepository.bulkUpsertLeads(leads);
    }

    for (const monthKey of dataset.months) {
      const [yearStr, monthStr] = monthKey.split('-');
      const row = dataset.sources[monthKey];

      await mqlRepository.upsertSnapshot(Number(yearStr), Number(monthStr), {
        sendpulseMql: row.sendpulse.mql,
        pipedriveMql: row.pipedrive.mql,
        combinedMql: row.combined.mql,
        wonDeals: row.combined.won,
        repeatDeals: row.combined.repeat,
        closedDeals: row.combined.closed,
        marketingExpense: dataset.metrics[monthKey].budget,
        subscribers: dataset.metrics[monthKey].subscribers,
        newSubscribers: dataset.metrics[monthKey].newSubscribers,
        costPerSubscriber: dataset.metrics[monthKey].costPerSubscriber,
        costPerMql: dataset.metrics[monthKey].costPerMql,
        costPerDeal: dataset.metrics[monthKey].costPerDeal,
        retentionRate: dataset.sources[monthKey].combined.retention ?? null,
        channelBreakdown: dataset.channels[monthKey],
        pipedriveSyncAt: dataset.sync.pipedrive,
        sendpulseSyncAt: dataset.sync.sendpulse,
        pnlSyncAt: dataset.sync.pnl
      });
    }
  }

  async updateMarketingExpensesOnly(year) {
    const targetYear = Number(year) || new Date().getFullYear();
    const snapshots = await mqlRepository.fetchSnapshots(targetYear);
    if (!snapshots.length) {
      logger.warn('No MQL snapshots found for marketing expense update', { year: targetYear });
      return { year: targetYear, updated: 0 };
    }

    const expenses = await this.pnlExpenseClient.getMarketingExpenses(targetYear);
    const monthsBudget = expenses.months || {};
    let updated = 0;

    for (const snapshot of snapshots) {
      const monthKey = `${snapshot.year}-${String(snapshot.month).padStart(2, '0')}`;
      const budget = monthsBudget[monthKey] || 0;
      const combinedMql = snapshot.combined_mql || 0;
      const wonDeals = snapshot.won_deals || 0;
      const repeatDeals = snapshot.repeat_deals || 0;
      const newSubscribers = snapshot.new_subscribers || 0;

      const costPerMql = budget > 0 && combinedMql > 0 ? budget / combinedMql : null;
      const costPerDeal = budget > 0 && wonDeals > 0 ? budget / wonDeals : null;
      const costPerSubscriber =
        budget > 0 && newSubscribers > 0 ? budget / newSubscribers : null;

      await mqlRepository.upsertSnapshot(snapshot.year, snapshot.month, {
        sendpulseMql: snapshot.sendpulse_mql || 0,
        pipedriveMql: snapshot.pipedrive_mql || 0,
        combinedMql: snapshot.combined_mql || 0,
        wonDeals: snapshot.won_deals || 0,
        repeatDeals,
        closedDeals: snapshot.closed_deals || 0,
        marketingExpense: budget,
        subscribers: snapshot.subscribers || 0,
        newSubscribers,
        costPerSubscriber,
        costPerMql,
        costPerDeal,
        channelBreakdown: snapshot.channel_breakdown || {},
        pipedriveSyncAt: snapshot.pipedrive_sync_at,
        sendpulseSyncAt: snapshot.sendpulse_sync_at,
        pnlSyncAt: new Date().toISOString()
      });
      updated += 1;
    }

    return { year: targetYear, updated };
  }

  trackLead(dataset, dedupeKey) {
    if (!dedupeKey) return false;
    if (dataset.dedupe.has(dedupeKey)) {
      return true;
    }
    dataset.dedupe.set(dedupeKey, true);
    return false;
  }

  buildDedupeKey({ source, email, username, externalId }) {
    const normalizedEmail = normalizeEmail(email);
    if (normalizedEmail) {
      return `email:${normalizedEmail}`;
    }
    if (username && typeof username === 'string') {
      return `username:${username.trim().toLowerCase()}`;
    }
    if (externalId) {
      return `${source || 'src'}:${externalId}`;
    }
    return null;
  }

  safeDelete(filePath) {
    if (!filePath) return;
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      // ignore
    }
  }

  async determinePipedriveCutoffDate() {
    try {
      const lastSync = await mqlRepository.getMostRecentPipedriveSyncAt();
      if (!lastSync) {
        return null;
      }
      const bufferDays =
        Number(process.env.MQL_PIPEDRIVE_SYNC_BUFFER_DAYS) || mqlConfig.pipedriveSyncBufferDays || 3;
      const cutoff = new Date(lastSync);
      cutoff.setUTCDate(cutoff.getUTCDate() - bufferDays);
      return cutoff;
    } catch (error) {
      logger.warn('Failed to determine Pipedrive cutoff date', { error: error.message });
      return null;
    }
  }
}

module.exports = MqlSyncService;

