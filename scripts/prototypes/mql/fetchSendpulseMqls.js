#!/usr/bin/env node
/**
 * Prototype helper that downloads SendPulse Instagram contacts with the given tag
 * and stores the raw payload to tmp/sendpulse-mql-sample.json for offline analysis.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const SendPulseClient = require(path.resolve(__dirname, '../../../src/services/sendpulse'));

const DEFAULT_BOT_ID = '65ec7b3f08090e12cd01a7ca';
const OUTPUT_PATH = path.resolve(__dirname, '../../../tmp/sendpulse-mql-sample.json');
const API_URL = 'https://api.sendpulse.com/instagram/contacts/getByTag';

async function fetchContactsByTag({ tag, botId, limit = 200 }) {
  const client = new SendPulseClient();
  const token = await client.getAccessToken();
  let page = 1;
  let hasMore = true;
  const allContacts = [];

  while (hasMore) {
    const params = { tag, bot_id: botId, limit, page };
    const response = await axios.get(API_URL, {
      params,
      headers: { Authorization: `Bearer ${token}` }
    });

    const items = Array.isArray(response.data?.data)
      ? response.data.data
      : Array.isArray(response.data?.contacts)
      ? response.data.contacts
      : Array.isArray(response.data)
      ? response.data
      : [];

    allContacts.push(...items);
    hasMore = items.length === limit;
    page += 1;
    if (!hasMore) {
      console.log(`No more pages (retrieved ${items.length} records on last page).`);
    }
  }

  return allContacts;
}

async function main() {
  const tag = process.env.MQL_SENDPULSE_TAG || 'Mql';
  const botId = process.env.SENDPULSE_INSTAGRAM_BOT_ID || DEFAULT_BOT_ID;

  try {
    console.log(`Fetching SendPulse contacts for bot ${botId} with tag "${tag}"...`);
    const contacts = await fetchContactsByTag({ tag, botId });

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ fetchedAt: new Date().toISOString(), count: contacts.length, contacts }, null, 2));
    console.log(`Saved ${contacts.length} contacts to ${OUTPUT_PATH}`);
  } catch (error) {
    console.error('Failed to fetch SendPulse contacts:', error.response?.data || error.message);
    process.exit(1);
  }
}

main();


