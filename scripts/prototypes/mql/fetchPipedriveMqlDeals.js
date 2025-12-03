#!/usr/bin/env node
/**
 * Prototype helper that downloads Pipedrive deals carrying the MQL label
 * and writes a trimmed snapshot to tmp/pipedrive-mql-sample.json.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const PipedriveClient = require(path.resolve(__dirname, '../../../src/services/pipedrive'));

const OUTPUT_PATH = path.resolve(__dirname, '../../../tmp/pipedrive-mql-sample.json');

function extractPrimaryEmail(person) {
  const emails = Array.isArray(person?.email)
    ? person.email
    : Array.isArray(person?.emails)
    ? person.emails
    : [];
  const first = emails.find((entry) => {
    if (typeof entry === 'string') return entry.trim().length > 0;
    if (entry && typeof entry.value === 'string') return entry.value.trim().length > 0;
    return false;
  });
  if (!first) return null;
  return typeof first === 'string' ? first : first.value;
}

function summarizeDeal(deal) {
  const person = deal.person_id || {};
  const organization = deal.org_id || {};
  return {
    id: deal.id,
    title: deal.title,
    value: deal.value,
    currency: deal.currency,
    label: deal.label,
    status: deal.status,
    add_time: deal.add_time,
    update_time: deal.update_time,
    won_time: deal.won_time,
    person: {
      id: person.value || person.id || null,
      name: person.name || null,
      email: extractPrimaryEmail(person),
      phone: Array.isArray(person?.phone) ? person.phone[0]?.value || null : null
    },
    organization: {
      id: organization.value || organization.id || null,
      name: organization.name || null
    }
  };
}

async function fetchDealsWithLabel({ label, pageLimit, requestLimit }) {
  const client = new PipedriveClient();
  const normalizedLabel = label.toLowerCase();
  const deals = [];
  let start = 0;
  let pagesFetched = 0;

  while (true) {
    if (pagesFetched >= pageLimit) {
      console.warn(`Reached page limit (${pageLimit}); stopping early.`);
      break;
    }

    const result = await client.getDeals({ limit: requestLimit, start });
    if (!result.success) {
      throw new Error(`Failed to fetch deals: ${result.error || 'unknown error'}`);
    }

    const pageDeals = Array.isArray(result.deals) ? result.deals : [];
    const filtered = pageDeals.filter((deal) => (deal.label || '').toLowerCase() === normalizedLabel);
    deals.push(...filtered.map(summarizeDeal));

    const pagination = result.pagination;
    pagesFetched += 1;
    if (!pagination || !pagination.more_items_in_collection) {
      break;
    }
    start = pagination.next_start ?? start + requestLimit;
  }

  return deals;
}

async function main() {
  const label = process.env.MQL_PIPEDRIVE_LABEL || 'MQL';
  const pageLimit = Number(process.env.MQL_PIPEDRIVE_MAX_PAGES || 20);
  const requestLimit = Number(process.env.MQL_PIPEDRIVE_PAGE_SIZE || 100);

  try {
    console.log(`Fetching Pipedrive deals with label "${label}"...`);
    const deals = await fetchDealsWithLabel({ label, pageLimit, requestLimit });
    fs.writeFileSync(
      OUTPUT_PATH,
      JSON.stringify({ fetchedAt: new Date().toISOString(), count: deals.length, deals }, null, 2)
    );
    console.log(`Saved ${deals.length} deals to ${OUTPUT_PATH}`);
  } catch (error) {
    console.error('Failed to fetch Pipedrive deals:', error.message);
    process.exit(1);
  }
}

main();


