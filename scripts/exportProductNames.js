#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const supabase = require('../src/services/supabaseClient');

if (!supabase) {
  console.error('Supabase client is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeProductName(name) {
  const trimmed = normalizeWhitespace(name);
  if (!trimmed) {
    return '';
  }

  return trimmed
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s.\-_/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function csvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const stringValue = String(value);
  if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

async function fetchProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,normalized_name,calculation_status,calculation_due_month,created_at')
    .order('id');

  if (error) {
    throw error;
  }

  return data || [];
}

async function main() {
  try {
    const products = await fetchProducts();

    const groups = new Map();
    const prepared = products.map((product) => {
      const normalizedKey = normalizeProductName(product.normalized_name || product.name || '');
      const groupKey = normalizedKey || '(empty)';
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey).push(product.id);
      return {
        ...product,
        normalizedKey,
        groupKey
      };
    });

    const rows = prepared
      .map((item) => ({
        ...item,
        duplicateCount: groups.get(item.groupKey)?.length || 0
      }))
      .sort((a, b) => {
        if (b.duplicateCount !== a.duplicateCount) {
          return b.duplicateCount - a.duplicateCount;
        }
        if (a.groupKey !== b.groupKey) {
          return a.groupKey.localeCompare(b.groupKey);
        }
        return a.id - b.id;
      });

    const header = [
      'duplicate_group',
      'duplicate_count',
      'product_id',
      'name',
      'normalized_name',
      'calculation_status',
      'calculation_due_month',
      'created_at',
      'updated_at'
    ];

    const csvLines = [
      header.join(','),
      ...rows.map((row) =>
        [
          csvValue(row.groupKey),
          row.duplicateCount,
          row.id,
          csvValue(normalizeWhitespace(row.name || '')),
          csvValue(row.normalized_name || row.normalizedKey || ''),
          csvValue(row.calculation_status || ''),
          csvValue(row.calculation_due_month || ''),
          csvValue(row.created_at || ''),
          csvValue(row.updated_at || '')
        ].join(',')
      )
    ];

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-');
    const outputPath = path.resolve(
      __dirname,
      `../tmp/product-names-${timestamp}.csv`
    );

    const readablePath = path.resolve(
      __dirname,
      `../tmp/product-names-${timestamp}.md`
    );

    fs.writeFileSync(outputPath, `${csvLines.join('\n')}\n`, 'utf8');

    const sortedGroups = Array.from(groups.entries())
      .map(([key, ids]) => ({
        key,
        ids,
        count: ids.length,
        entries: rows.filter((row) => row.groupKey === key)
      }))
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return a.key.localeCompare(b.key);
      });

    const readableLines = [
      '# Product names export',
      '',
      `Generated at: ${timestamp}`,
      `Total products: ${rows.length}`,
      `Duplicate groups (>1): ${sortedGroups.filter((group) => group.count > 1).length}`,
      ''
    ];

    sortedGroups.forEach((group) => {
      readableLines.push(`## ${group.key || '(empty)'}`);
      readableLines.push(`Entries: ${group.count}`);
      readableLines.push('');
      readableLines.push('| Product ID | Original name | Status | Due month | Created at |');
      readableLines.push('| --- | --- | --- | --- | --- |');
      group.entries.forEach((entry) => {
        readableLines.push(
          `| ${entry.id} | ${entry.name ? entry.name.replace(/\|/g, '\\|') : '(empty)'} | ${entry.calculation_status || ''} | ${entry.calculation_due_month || ''} | ${entry.created_at || ''} |`
        );
      });
      readableLines.push('');
    });

    fs.writeFileSync(readablePath, readableLines.join('\n'), 'utf8');

    const duplicateGroups = Array.from(groups.values()).filter((ids) => ids.length > 1);
    const duplicateSummary = duplicateGroups.reduce((acc, ids) => acc + ids.length, 0);

    console.log(`Saved ${rows.length} products to ${outputPath}`);
    console.log(`Readable list: ${readablePath}`);
    console.log(`Found ${duplicateGroups.length} duplicate groups covering ${duplicateSummary} products`);
  } catch (error) {
    console.error('Failed to export products:', error);
    process.exit(1);
  }
}

main();


