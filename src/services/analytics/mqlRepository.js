const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

const LEADS_TABLE = 'mql_leads';
const SNAPSHOTS_TABLE = 'mql_monthly_snapshots';

class MqlRepository {
  constructor() {
    this.repeatDealsSupported = process.env.MQL_ENABLE_REPEAT_DEALS !== '0';
  }

  async bulkUpsertLeads(leads = []) {
    if (!leads.length) {
      return { inserted: 0 };
    }

    const rows = leads.map((lead) => ({
      source: lead.source,
      external_id: lead.externalId,
      email: lead.email || null,
      username: lead.username || null,
      first_seen_month: lead.firstSeenMonth,
      channel_bucket: lead.channelBucket || null,
      payload: lead.payload || null,
      updated_at: new Date().toISOString()
    }));

    const { error } = await supabase.from(LEADS_TABLE).upsert(rows, {
      onConflict: 'source,external_id'
    });

    if (error) {
      throw new Error(`Failed to upsert MQL leads: ${error.message}`);
    }

    return { inserted: rows.length };
  }

  async upsertSnapshot(year, month, data) {
    const payload = {
      year,
      month,
      sendpulse_mql: data.sendpulseMql,
      pipedrive_mql: data.pipedriveMql,
      combined_mql: data.combinedMql,
      won_deals: data.wonDeals,
      closed_deals: data.closedDeals,
      marketing_expense: data.marketingExpense,
      subscribers: data.subscribers,
      new_subscribers: data.newSubscribers,
      cost_per_subscriber: data.costPerSubscriber ?? null,
      cost_per_mql: data.costPerMql ?? null,
      cost_per_deal: data.costPerDeal ?? null,
      retention_rate: data.retentionRate ?? null,
      channel_breakdown: data.channelBreakdown || {},
      pipedrive_sync_at: data.pipedriveSyncAt || null,
      sendpulse_sync_at: data.sendpulseSyncAt || null,
      pnl_sync_at: data.pnlSyncAt || null,
      updated_at: new Date().toISOString()
    };

    if (!this.repeatDealsSupported) {
      delete payload.repeat_deals;
    } else {
      payload.repeat_deals = data.repeatDeals || 0;
    }

    const { error } = await supabase.from(SNAPSHOTS_TABLE).upsert(payload, {
      onConflict: 'year,month'
    });

    if (error && this.repeatDealsSupported && this._isRepeatDealsMissingError(error)) {
      this.repeatDealsSupported = false;
      logger.warn(
        "Supabase 'repeat_deals' column missing; disabling repeat deal persistence until migration runs",
        { error: error.message }
      );
      delete payload.repeat_deals;
      const retry = await supabase.from(SNAPSHOTS_TABLE).upsert(payload, {
        onConflict: 'year,month'
      });
      if (retry.error) {
        throw new Error(`Failed to upsert snapshot: ${retry.error.message}`);
      }
      return;
    }

    if (error) {
      throw new Error(`Failed to upsert snapshot: ${error.message}`);
    }
  }

  async fetchSnapshots(year) {
    const { data, error } = await supabase
      .from(SNAPSHOTS_TABLE)
      .select('*')
      .eq('year', year)
      .order('month', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch snapshots: ${error.message}`);
    }

    return data || [];
  }

  async fetchSnapshot(year, month) {
    const { data, error } = await supabase
      .from(SNAPSHOTS_TABLE)
      .select('*')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch snapshot: ${error.message}`);
    }

    return data;
  }

  async updateSnapshot(year, month, fields) {
    const payload = {
      ...fields,
      updated_at: new Date().toISOString()
    };

    const { error, data } = await supabase
      .from(SNAPSHOTS_TABLE)
      .update(payload)
      .eq('year', year)
      .eq('month', month)
      .select()
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to update snapshot: ${error.message}`);
    }

    return data;
  }

  async getMostRecentPipedriveSyncAt() {
    const { data, error } = await supabase
      .from(SNAPSHOTS_TABLE)
      .select('pipedrive_sync_at')
      .not('pipedrive_sync_at', 'is', null)
      .order('pipedrive_sync_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.warn('Failed to read latest Pipedrive sync timestamp', { error: error.message });
      return null;
    }

    return data?.pipedrive_sync_at || null;
  }
}

MqlRepository.prototype._isRepeatDealsMissingError = function (error) {
  if (!error?.message) return false;
  return error.message.includes("repeat_deals");
};

module.exports = new MqlRepository();


