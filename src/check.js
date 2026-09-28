#!/usr/bin/env node
// Entry point: check every watchlist item, notify on restocks, persist state.
//
//   node src/check.js [--dry-run] [--fixture product.json] [--state state.json] [--watchlist watchlist.json]

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fetchProduct, matchVariants, allSizes, absoluteImage, toProductPageUrl } from './shopify.js';
import { computeEvents, availabilityChanged } from './diff.js';
import { formatEvent, sendTelegram } from './telegram.js';

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    fixture: { type: 'string' },
    state: { type: 'string', default: 'state.json' },
    watchlist: { type: 'string', default: 'watchlist.json' },
  },
});

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

const itemId = (item) => item.id || item.url;

async function checkItem(item, prev, fixture) {
  const now = new Date().toISOString();
  const url = toProductPageUrl(item.url);
  try {
    const product = fixture ?? (await fetchProduct(item.url));
    const { sizes, unknownSizes } = matchVariants(product, item.sizes || []);
    const next = {
      url,
      title: product.title,
      image: absoluteImage(product.featured_image),
      price: product.price,
      allSizes: allSizes(product),
      sizes,
      unknownSizes,
      error: null,
      lastChangeAt: prev?.lastChangeAt ?? now,
    };
    if (availabilityChanged(prev, next)) next.lastChangeAt = now;
    return next;
  } catch (err) {
    // Keep the last known availability so recovery doesn't fake a restock.
    return { ...(prev || { url, sizes: {} }), url, error: err.message || String(err) };
  }
}

async function main() {
  const watchlist = await readJson(args.watchlist, { items: [] });
  const prevState = await readJson(args.state, { items: {} });
  const fixture = args.fixture ? await readJson(args.fixture) : undefined;

  const newState = { items: {} };
  for (const item of watchlist.items || []) {
    const id = itemId(item);
    newState.items[id] = await checkItem(item, prevState.items?.[id], fixture);
  }

  const events = computeEvents(prevState, newState);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const dryRun = args['dry-run'] || !token || !chatId;
  if (!args['dry-run'] && dryRun) console.warn('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — printing instead of sending.');

  let failed = false;
  for (const event of events) {
    const text = formatEvent(event, newState.items[event.itemId]);
    if (dryRun) {
      console.log(`[notify] ${text}\n`);
      continue;
    }
    try {
      await sendTelegram(text, { token, chatId });
    } catch (err) {
      failed = true;
      console.error(`Failed to notify for ${event.itemId}: ${err.message}`);
      // Roll this item back so the transition is detected (and retried) next run.
      if (prevState.items?.[event.itemId]) newState.items[event.itemId] = prevState.items[event.itemId];
      else delete newState.items[event.itemId];
    }
  }

  const serialized = JSON.stringify(newState, null, 2) + '\n';
  const previous = JSON.stringify(prevState, null, 2) + '\n';
  if (serialized !== previous) {
    await writeFile(args.state, serialized);
    console.log(`State updated (${args.state}).`);
  } else {
    console.log('No changes.');
  }

  await printSummary(newState, events);
  if (failed) process.exitCode = 1;
}

async function printSummary(state, events) {
  const rows = Object.values(state.items).map((it) => {
    const sizes = Object.entries(it.sizes || {})
      .map(([s, v]) => `${s} ${v.available ? '✅' : '❌'}`)
      .join(' · ');
    return `| [${it.title || it.url}](${it.url}) | ${sizes || '—'} | ${it.error ? `⚠️ ${it.error}` : ''} |`;
  });
  const md = [
    `### Stock check — ${new Date().toISOString()}`,
    '',
    '| Product | Sizes | Error |',
    '|---|---|---|',
    ...rows,
    '',
    `Notifications: ${events.length}`,
    '',
  ].join('\n');
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
