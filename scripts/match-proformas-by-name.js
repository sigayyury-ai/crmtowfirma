#!/usr/bin/env node

/**
 * Attempts to find open Pipedrive deals for proformas without pipedrive_deal_id
 * by matching buyer names and product names.
 *
 * Usage: node scripts/match-proformas-by-name.js
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const PipedriveClient = require('../src/services/pipedrive');

const INPUT_FILE = path.resolve(__dirname, '../tmp/unlinked-proformas-2025-12-02.txt');
const OUTPUT_FILE = INPUT_FILE;
const API_DELAY_MS = parseInt(process.env.PIPEDRIVE_MATCH_DELAY_MS || '250', 10);
const searchCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const nextChar = line[i + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value).replace(/\r?\n/g, ' ').trim();
  if (str === '') {
    return '';
  }

  if (/[",]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

function normalizeProductName(value) {
  if (!value) {
    return '';
  }

  return value
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9а-яёіїґłńćżó\s]/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitProductNames(productNames) {
  if (!productNames) {
    return [];
  }

  return productNames
    .split('|')
    .map((value) => value.trim())
    .filter(Boolean);
}

function productsMatch(targetProducts, candidateProducts) {
  if (!targetProducts.length || !candidateProducts.length) {
    return false;
  }

  const normalizedTargets = targetProducts
    .map(normalizeProductName)
    .filter(Boolean);

  const normalizedCandidates = candidateProducts
    .map(normalizeProductName)
    .filter(Boolean);

  for (const target of normalizedTargets) {
    for (const candidate of normalizedCandidates) {
      if (!target || !candidate) {
        continue;
      }

      if (
        target === candidate
        || target.includes(candidate)
        || candidate.includes(target)
      ) {
        return true;
      }
    }
  }

  return false;
}

function getDealProductName(product) {
  if (!product) {
    return null;
  }

  return (
    product.name
    || product.product?.name
    || product.item_title
    || product.product?.code
    || null
  );
}

async function getPersonsWithCache(client, term, attempt) {
  const cacheKey = `${attempt.label}::${term}`;
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey);
  }

  let searchResult = await client.searchPersons(term, {
    limit: 5,
    exactMatch: attempt.exactMatch
  });

  if (searchResult.rateLimited) {
    await sleep(API_DELAY_MS * 4);
    searchResult = await client.searchPersons(term, {
      limit: 5,
      exactMatch: attempt.exactMatch
    });
  }

  searchCache.set(cacheKey, searchResult);
  await sleep(API_DELAY_MS);
  return searchResult;
}

async function findDealForEntry(entry, client) {
  const term = entry.buyerName;
  if (!term) {
    return null;
  }

  const productList = splitProductNames(entry.productNames);
  if (productList.length === 0) {
    return null;
  }

  const searchAttempts = [
    { label: 'exact', exactMatch: true },
    { label: 'fuzzy', exactMatch: false }
  ];

  for (const attempt of searchAttempts) {
    const searchResult = await getPersonsWithCache(client, term, attempt);

    if (!searchResult.success || !searchResult.persons.length) {
      continue;
    }

    for (const person of searchResult.persons) {
      const dealsResult = await client.getPersonDeals(person.id, { status: 'open' });
      await sleep(API_DELAY_MS);

      if (!dealsResult.success || !Array.isArray(dealsResult.deals)) {
        continue;
      }

      for (const deal of dealsResult.deals) {
        const productsResult = await client.getDealProducts(deal.id);
        await sleep(API_DELAY_MS);

        if (!productsResult.success || !productsResult.products.length) {
          continue;
        }

        const dealProducts = productsResult.products
          .map(getDealProductName)
          .filter(Boolean);

        if (productsMatch(productList, dealProducts)) {
          return {
            dealId: deal.id,
            dealTitle: deal.title || '',
            dealStatus: deal.status || '',
            matchType: attempt.label,
            personId: person.id
          };
        }
      }
    }
  }

  return null;
}

async function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input file not found: ${INPUT_FILE}`);
  }

  const pipedriveClient = new PipedriveClient();
  const fileContent = fs.readFileSync(INPUT_FILE, 'utf8').trim();
  const lines = fileContent.split(/\r?\n/);
  const headerLine = lines.shift();
  const headerColumns = parseCsvLine(headerLine);

  const entries = lines.map((line) => {
    const cols = parseCsvLine(line);
    return {
      proformaFullnumber: cols[0] || '',
      wfirmaId: cols[1] || '',
      buyerName: cols[2] || '',
      productNames: cols[3] || '',
      dealId: cols[4] || '',
      dealTitle: cols[5] || '',
      dealStatus: cols[6] || ''
    };
  });

  const toMatch = entries.filter((entry) => !entry.dealId);
  const matched = [];
  const unmatched = [];

  for (let i = 0; i < toMatch.length; i += 1) {
    const entry = toMatch[i];
    // eslint-disable-next-line no-console
    console.log(
      `[${i + 1}/${toMatch.length}] Matching ${entry.proformaFullnumber} (${entry.buyerName})...`
    );

    try {
      const match = await findDealForEntry(entry, pipedriveClient);
      if (match) {
        entry.dealId = String(match.dealId);
        entry.dealTitle = match.dealTitle;
        entry.dealStatus = match.dealStatus || 'open';
        matched.push(entry);
        // eslint-disable-next-line no-console
        console.log(
          `  ✅ Found deal ${entry.dealId} (${entry.dealTitle}) via ${match.matchType} match`
        );
      } else {
        unmatched.push(entry);
        // eslint-disable-next-line no-console
        console.log('  ⚠️  No matching deal found');
      }
    } catch (error) {
      unmatched.push(entry);
      // eslint-disable-next-line no-console
      console.warn(`  ⚠️  Error while matching: ${error.message}`);
    }

    await sleep(API_DELAY_MS);
  }

  const updatedLines = [
    headerColumns.join(',')
  ];

  for (const entry of entries) {
    updatedLines.push([
      entry.proformaFullnumber,
      entry.wfirmaId,
      entry.buyerName,
      entry.productNames,
      entry.dealId,
      entry.dealTitle,
      entry.dealStatus
    ].map(csvEscape).join(','));
  }

  fs.writeFileSync(OUTPUT_FILE, `${updatedLines.join('\n')}\n`, 'utf8');

  // eslint-disable-next-line no-console
  console.log('\nSummary:');
  // eslint-disable-next-line no-console
  console.log(`  Matched new deals: ${matched.length}`);
  // eslint-disable-next-line no-console
  console.log(`  Still unmatched: ${unmatched.length}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Match script failed:', error);
  process.exit(1);
});


