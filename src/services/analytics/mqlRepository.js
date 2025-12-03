const supabase = require('../supabaseClient');

const LEADS_TABLE = 'mql_leads';
const SNAPSHOTS_TABLE = 'mql_monthly_snapshots';

class MqlRepository {
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
      channel_breakdown: data.channelBreakdown || {},
      pipedrive_sync_at: data.pipedriveSyncAt || null,
      sendpulse_sync_at: data.sendpulseSyncAt || null,
      pnl_sync_at: data.pnlSyncAt || null,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from(SNAPSHOTS_TABLE).upsert(payload, {
      onConflict: 'year,month'
    });

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
}

module.exports = new MqlRepository();


