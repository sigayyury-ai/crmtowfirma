const logger = require('../../utils/logger');
const PipedriveClient = require('../../services/pipedrive');
const mqlConfig = require('../../config/mql');
const { getMonthKey, normalizeEmail, resolveChannelBucket } = require('./mqlNormalizer');

class PipedriveMqlClient {
  constructor(options = {}) {
    this.client = new PipedriveClient();
    this.primaryLabelId = String(options.labelId || mqlConfig.pipedriveLabelId || '').trim();
    this.secondaryLabelIds = this._parseLabelList(
      options.secondaryLabelIds ||
        mqlConfig.pipedriveSqlLabelIds ||
        process.env.PIPEDRIVE_SQL_LABEL_IDS ||
        ''
    );
    this.pageSize = Number(options.pageSize || mqlConfig.pipedrivePageSize || 100);
    this.maxPages = Number(options.maxPages || mqlConfig.pipedriveMaxPages || 25);
    this.conversationStageIds = (options.conversationStageIds || mqlConfig.pipedriveConversationStageIds || []).map(
      (stageId) => String(stageId)
    );
    this.utmFields = {
      source: options.utmSourceField || mqlConfig.pipedriveUtmSourceField,
      medium: options.utmMediumField || mqlConfig.pipedriveUtmMediumField,
      campaign: options.utmCampaignField || mqlConfig.pipedriveUtmCampaignField
    };
  }

  async fetchMqlDeals(options = {}) {
    const deals = [];
    const stats = {
      scanned: 0,
      matched: 0,
      pages: 0
    };

    let start = 0;
    while (true) {
      if (stats.pages >= this.maxPages) {
        logger.warn('Reached max Pipedrive pagination limit, stopping early', {
          maxPages: this.maxPages
        });
        break;
      }

      const response = await this.client.getDeals({
        limit: this.pageSize,
        start,
        status: 'all_not_deleted',
        sort: 'update_time DESC',
        label: this._buildLabelParam()
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch deals from Pipedrive');
      }

      const batch = Array.isArray(response.deals) ? response.deals : [];
      stats.scanned += batch.length;
      stats.pages += 1;

      batch
        .filter((deal) => this._isMqlDeal(deal))
        .forEach((deal) => {
          deals.push(this._normalizeDeal(deal));
          stats.matched += 1;
        });

      const pagination = response.pagination;
      if (!pagination || !pagination.more_items_in_collection) {
        break;
      }

      start = pagination.next_start ?? start + this.pageSize;
    }

    if (options.resolveFirstSeenFromFlow) {
      for (const deal of deals) {
        const resolved = await this._resolveFirstSeenAt(deal.id);
        if (resolved) {
          deal.firstSeenAt = resolved;
          deal.firstSeenMonth = getMonthKey(resolved) || deal.firstSeenMonth;
        }
      }
    }

    return {
      deals,
      stats,
      fetchedAt: new Date().toISOString()
    };
  }

  _isMqlDeal(deal) {
    if (!deal) return false;
    const labelValue = String(deal.label || '').trim();
    if (!labelValue) return false;
    if (this.primaryLabelId && labelValue === this.primaryLabelId) {
      return true;
    }
    return this.secondaryLabelIds.includes(labelValue);
  }

  _normalizeDeal(deal = {}) {
    const person = deal.person_id || {};
    const email = normalizeEmail(this._extractPrimaryEmail(person));
    const username = person?.name || deal.person_name || null;
    const utmSource = this._pluckField(deal, this.utmFields.source);
    const firstSeenAt = deal.update_time || deal.add_time || new Date().toISOString();

    return {
      id: deal.id,
      title: deal.title,
      labelId: deal.label,
      stageId: deal.stage_id,
      pipelineId: deal.pipeline_id,
      status: deal.status,
      value: deal.value,
      currency: deal.currency,
      addTime: deal.add_time,
      updateTime: deal.update_time,
      wonTime: deal.won_time,
      closeTime: deal.close_time,
      personId: person.value || person.id || null,
      personName: deal.person_name || person.name || null,
      email,
      username,
      phone: Array.isArray(person?.phone) ? person.phone[0]?.value || null : null,
      utmSource,
      utmMedium: this._pluckField(deal, this.utmFields.medium),
      utmCampaign: this._pluckField(deal, this.utmFields.campaign),
      channelBucket: resolveChannelBucket(utmSource || ''),
      firstSeenAt,
      firstSeenMonth: getMonthKey(firstSeenAt)
    };
  }

  async _resolveFirstSeenAt(dealId) {
    try {
      const result = await this.client.getDealFlow(dealId);
      if (!result.success) {
        return null;
      }
      const entries = result.entries || [];
      const labelEntry = entries.find(
        (entry) =>
          entry.object === 'dealChange' &&
          entry.data?.field_key === 'label' &&
          String(entry.data?.new_value || '') === this.labelId
      );
      if (labelEntry) {
        return labelEntry.data?.log_time || labelEntry.timestamp || null;
      }

      const stageEntry = entries.find(
        (entry) =>
          entry.object === 'dealChange' &&
          entry.data?.field_key === 'stage_id' &&
          this.conversationStageIds.includes(String(entry.data?.new_value || ''))
      );
      if (stageEntry) {
        return stageEntry.data?.log_time || stageEntry.timestamp || null;
      }
      return null;
    } catch (error) {
      logger.warn('Failed to resolve Pipedrive first-seen timestamp via flow', {
        dealId,
        error: error.message
      });
      return null;
    }
  }

  _extractPrimaryEmail(person = {}) {
    const emails = Array.isArray(person?.email)
      ? person.email
      : Array.isArray(person?.emails)
      ? person.emails
      : [];
    const entry = emails.find((item) => {
      if (!item) return false;
      if (typeof item === 'string') return item.trim().length > 0;
      return typeof item.value === 'string' && item.value.trim().length > 0;
    });
    if (!entry) return null;
    return typeof entry === 'string' ? entry : entry.value;
  }

  _pluckField(deal, fieldKey) {
    if (!fieldKey) return null;
    return deal[fieldKey] || null;
  }

  _parseLabelList(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map((id) => String(id).trim()).filter((id) => id.length);
    }
    return String(value)
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length);
  }

  _buildLabelParam() {
    const labels = [this.primaryLabelId, ...this.secondaryLabelIds].filter((id) => id && id.length);
    if (!labels.length) {
      return undefined;
    }
    if (labels.length === 1) {
      return labels[0];
    }
    return labels.join(',');
  }
}

module.exports = PipedriveMqlClient;


