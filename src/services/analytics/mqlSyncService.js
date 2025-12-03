const path = require('path');
const fs = require('fs');
const SendpulseMqlClient = require('./sendpulseMqlClient');
const PipedriveMqlClient = require('./pipedriveMqlClient');
const PnlExpenseClient = require('./pnlExpenseClient');
const mqlRepository = require('./mqlRepository');
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
  }

  async run({ year } = {}) {
    const targetYear = Number(year) || new Date().getFullYear();
    const dataset = this.createDataset(targetYear);

    await this.collectSendpulse(dataset, targetYear);
    await this.collectPipedrive(dataset, targetYear);
    await this.collectMarketingExpenses(dataset, targetYear);
    this.applySendpulseBaseline(dataset, targetYear);
    this.updateConversion(dataset);
    this.updateCostMetrics(dataset);
    await this.persistSnapshots(dataset);

    return {
      year: targetYear,
      months: dataset.months,
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
        combined: { mql: 0, won: 0, closed: 0, conversion: 0 }
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

  async collectPipedrive(dataset, year) {
    const result = await this.pipedriveClient.fetchMqlDeals({ resolveFirstSeenFromFlow: true });
    const deals = result.deals || [];
    dataset.sync.pipedrive = result.fetchedAt || new Date().toISOString();

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

      dataset.leads.push({
        source: 'pipedrive',
        externalId: String(deal.id),
        email: deal.email,
        username: deal.username,
        firstSeenMonth: deal.firstSeenMonth ? `${deal.firstSeenMonth.slice(0, 7)}-01` : null,
        channelBucket: deal.channelBucket,
        payload: deal
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
      combined.conversion = combined.mql > 0 ? combined.won / combined.mql : 0;
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
        closedDeals: row.combined.closed,
        marketingExpense: dataset.metrics[monthKey].budget,
        subscribers: dataset.metrics[monthKey].subscribers,
        newSubscribers: dataset.metrics[monthKey].newSubscribers,
        costPerSubscriber: dataset.metrics[monthKey].costPerSubscriber,
        costPerMql: dataset.metrics[monthKey].costPerMql,
        costPerDeal: dataset.metrics[monthKey].costPerDeal,
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
}

module.exports = MqlSyncService;

