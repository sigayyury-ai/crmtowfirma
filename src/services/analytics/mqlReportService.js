const path = require('path');
const SendpulseMqlClient = require('./sendpulseMqlClient');
const mqlRepository = require('./mqlRepository');
const logger = require('../../utils/logger');
const sendpulseBaseline = require(path.join(__dirname, '../../../data/analytics/sendpulse-baseline.json'));

class MqlReportService {
  constructor() {
    this.sendpulseClient = new SendpulseMqlClient();
  }

  async getMonthlySummary({ year }) {
    const safeYear = Number(year) || new Date().getFullYear();
    const snapshots = await mqlRepository.fetchSnapshots(safeYear);

    if (snapshots.length) {
      const snapshotDataset = buildDatasetFromSnapshots(snapshots, safeYear);
      return {
        year: safeYear,
        ...snapshotDataset
      };
    }

    const dataset = buildBaseDataset(safeYear);
    applyBaseline(dataset, safeYear);
    await this.populateSendpulse(dataset, safeYear);
    return {
      year: safeYear,
      ...dataset
    };
  }

  async populateSendpulse(dataset, year) {
    try {
      const filePath = path.join(
        __dirname,
        '../../../tmp',
        `sendpulse-mql-raw-${new Date().toISOString().slice(0, 10)}.json`
      );
      const { contacts } = await this.sendpulseClient.fetchContacts({ dumpFile: filePath });
      const prefix = `${year}-`;

      contacts.forEach((contact) => {
        const createdAt = contact.createdAt || contact.lastActivityAt;
        if (!createdAt || !createdAt.startsWith(prefix)) return;
        const monthKey = createdAt.slice(0, 7);
        const monthData = dataset.sources[monthKey];
        if (!monthData) return;

        if (hasBaselineValue(year, monthKey)) {
          return;
        }

        monthData.sendpulse.mql += 1;
        monthData.combined.mql = monthData.pipedrive.mql + monthData.sendpulse.mql;
        const metrics = dataset.metrics[monthKey];
        metrics.costPerMql =
          monthData.combined.mql > 0 ? metrics.budget / monthData.combined.mql : metrics.budget;
      });

      dataset.sync.sendpulse = new Date().toISOString();
    } catch (error) {
      logger.error('Failed to fetch SendPulse contacts for MQL summary', { error: error.message });
    }
  }
}

function buildBaseDataset(year) {
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
      costPerSubscriber: 0,
      costPerMql: 0,
      costPerDeal: 0
    };
  });

  return {
    months,
    sources,
    channels,
    metrics,
    sync: {
      pipedrive: null,
      sendpulse: null
    }
  };
}

function applyBaseline(dataset, year) {
  const table = sendpulseBaseline[String(year)];
  if (!table) return;

  dataset.months.forEach((month) => {
    const baselineValue = table[month.slice(5)];
    if (typeof baselineValue !== 'number') return;
    const monthData = dataset.sources[month];
    const metrics = dataset.metrics[month];

    monthData.sendpulse.mql = baselineValue;
    monthData.combined.mql = monthData.pipedrive.mql + baselineValue;
    metrics.costPerMql =
      monthData.combined.mql > 0 ? metrics.budget / monthData.combined.mql : metrics.budget;
  });
}

function hasBaselineValue(year, monthKey) {
  const table = sendpulseBaseline[String(year)];
  if (!table) return false;
  const monthIndex = monthKey.slice(5);
  return typeof table[monthIndex] === 'number';
}

function buildDatasetFromSnapshots(snapshots, year) {
  const dataset = buildBaseDataset(year);

  snapshots.forEach((snapshot) => {
    const monthKey = `${snapshot.year}-${String(snapshot.month).padStart(2, '0')}`;
    if (!dataset.sources[monthKey]) {
      return;
    }

    const sourceRow = dataset.sources[monthKey];
    const metricsRow = dataset.metrics[monthKey];

    sourceRow.pipedrive.mql = snapshot.pipedrive_mql || 0;
    sourceRow.sendpulse.mql = snapshot.sendpulse_mql || 0;
    sourceRow.combined.mql = snapshot.combined_mql || 0;
    sourceRow.combined.won = snapshot.won_deals || 0;
    sourceRow.combined.repeat = snapshot.repeat_deals || 0;
    sourceRow.combined.closed = snapshot.closed_deals || 0;
    sourceRow.combined.conversion =
      sourceRow.combined.mql > 0 && sourceRow.combined.won > 0
        ? sourceRow.combined.won / sourceRow.combined.mql
        : 0;

    metricsRow.budget = Number(snapshot.marketing_expense) || 0;
    metricsRow.subscribers = snapshot.subscribers || 0;
    metricsRow.newSubscribers = snapshot.new_subscribers || 0;
    metricsRow.costPerSubscriber = normalizeNullableNumber(snapshot.cost_per_subscriber);
    metricsRow.costPerMql = normalizeNullableNumber(snapshot.cost_per_mql);
    metricsRow.costPerDeal = normalizeNullableNumber(snapshot.cost_per_deal);

    dataset.channels[monthKey] = snapshot.channel_breakdown || {};
  });

  dataset.sync = {
    pipedrive: snapshots.find((entry) => entry.pipedrive_sync_at)?.pipedrive_sync_at || null,
    sendpulse: snapshots.find((entry) => entry.sendpulse_sync_at)?.sendpulse_sync_at || null,
    pnl: snapshots.find((entry) => entry.pnl_sync_at)?.pnl_sync_at || null
  };

  return dataset;
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

module.exports = MqlReportService;


