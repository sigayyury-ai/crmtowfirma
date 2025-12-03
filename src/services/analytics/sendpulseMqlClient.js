const axios = require('axios');

const SendPulseClient = require('../sendpulse');
const mqlConfig = require('../../config/mql');
const logger = require('../../utils/logger');

const DEFAULT_PAGE_SIZE = Number(process.env.MQL_SENDPULSE_PAGE_SIZE || 100);
const DEFAULT_TAG = mqlConfig.sendpulseTag;
const DEFAULT_BOT_ID = mqlConfig.sendpulseBotId;
const API_URL = 'https://api.sendpulse.com/instagram/contacts/getByTag';

class SendpulseMqlClient {
  constructor(options = {}) {
    this.tag = options.tag || DEFAULT_TAG;
    this.botId = options.botId || DEFAULT_BOT_ID;
    this.pageSize = Number(options.pageSize || DEFAULT_PAGE_SIZE);

    if (!this.botId) {
      throw new Error('SENDPULSE_INSTAGRAM_BOT_ID must be configured to fetch Instagram contacts');
    }

    this.sendpulseClient = new SendPulseClient();
  }

  /**
   * Fetch all contacts for the configured tag/bot. The method handles pagination
   * and returns a normalized list of contacts suitable for lead ingestion.
   *
   * @param {Object} options
   * @param {AbortSignal=} options.signal Abort signal for cancellation
   * @returns {Promise<{contacts: Array, fetchedAt: string}>}
   */
  async fetchContacts(options = {}) {
    const signal = options.signal;
    const dumpFile = options.dumpFile;
    const token = await this.sendpulseClient.getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    const contacts = [];

    let nextUrl = API_URL;
    let params = {
      tag: this.tag,
      bot_id: this.botId,
      limit: this.pageSize
    };

    while (nextUrl) {
      const requestConfig = {
        headers,
        signal
      };

      if (params) {
        requestConfig.params = params;
      }

      logger.info('Fetching SendPulse contacts', { url: nextUrl, params });

      let response;
      try {
        response = await axios.get(nextUrl, requestConfig);
      } catch (error) {
        if (error.response?.status === 404) {
          logger.warn('SendPulse pagination link returned 404, stopping early', {
            url: nextUrl
          });
          break;
        }
        throw error;
      }

      const payload = Array.isArray(response.data?.data)
        ? response.data.data
        : Array.isArray(response.data?.contacts)
        ? response.data.contacts
        : Array.isArray(response.data)
        ? response.data
        : [];

      payload.forEach((entry) => contacts.push(this._normalize(entry)));

      let nextLink = response.data?.links?.next;
      if (nextLink) {
        nextUrl = nextLink.replace('http://', 'https://');
        params = null;
      } else {
        nextUrl = null;
      }
    }

    const result = {
      contacts,
      fetchedAt: new Date().toISOString()
    };

    if (dumpFile) {
      try {
        require('fs').writeFileSync(dumpFile, JSON.stringify(result, null, 2));
      } catch (error) {
        logger.warn('Unable to persist SendPulse raw payload', { dumpFile, error: error.message });
      }
    }

    return result;
  }

  _normalize(contact = {}) {
    const channel = contact.channel_data || {};

    return {
      source: 'sendpulse',
      externalId: contact.id || channel.id,
      instagramId: channel.id,
      username: channel.user_name,
      firstName: channel.first_name || channel.name || null,
      lastName: channel.last_name || null,
      fullName: channel.name || [channel.first_name, channel.last_name].filter(Boolean).join(' ').trim() || null,
      followerCount: channel.follower_count,
      tags: Array.isArray(contact.tags) ? contact.tags : [],
      createdAt: contact.created_at,
      lastActivityAt: contact.last_activity_at,
      profilePicture: channel.profile_pic || null,
      isVerified: channel.is_verified_user || false,
      raw: contact
    };
  }
}

module.exports = SendpulseMqlClient;


