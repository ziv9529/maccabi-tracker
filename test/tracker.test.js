import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toProductJsUrl, matchVariants, allSizes } from '../src/shopify.js';
import { computeEvents } from '../src/diff.js';

const fixturePath = new URL('./fixtures/retro-2000-01.js.json', import.meta.url);
const product = JSON.parse(readFileSync(fixturePath, 'utf8'));
const PAGE =
  'https://shop.maccabi-tlv.co.il/products/%D7%97%D7%95%D7%9C%D7%A6%D7%AA-%D7%A8%D7%98%D7%A8%D7%95-%D7%91%D7%99%D7%AA-2000-01';

test('toProductJsUrl normalizes product URLs', () => {
  assert.equal(toProductJsUrl(PAGE), `${PAGE}.js`);
  assert.equal(toProductJsUrl(`${PAGE}?variant=47503735357665`), `${PAGE}.js`);
  assert.equal(toProductJsUrl(`${PAGE}.js`), `${PAGE}.js`);
  assert.equal(
    toProductJsUrl('https://shop.maccabi-tlv.co.il/collections/retro/products/חולצת-רטרו-בית-2000-01'),
    `${PAGE}.js`,
  );
  assert.throws(() => toProductJsUrl('https://shop.maccabi-tlv.co.il/collections/retro'));
});

test('matchVariants reads availability per size', () => {
  const { sizes, unknownSizes } = matchVariants(product, ['xl', 'XXL', 'XS', '3XL']);
  assert.deepEqual(sizes.XL, { available: false, variantId: 47503735357665 });
  assert.deepEqual(sizes.XXL, { available: false, variantId: 47503735423201 });
  assert.equal(sizes.XS.available, true);
  assert.deepEqual(unknownSizes, ['3XL']);
  assert.deepEqual(allSizes(product), ['L', 'M', 'S', 'XL', 'XS', 'XXL']);
});

test('computeEvents alerts only on unavailable -> available', () => {
  const out = { items: { a: { sizes: { XL: { available: false, variantId: 1 } } } } };
  const back = { items: { a: { sizes: { XL: { available: true, variantId: 1 } } } } };

  assert.deepEqual(computeEvents(out, out), []);
  assert.deepEqual(computeEvents(out, back), [{ type: 'restock', itemId: 'a', sizes: [{ size: 'XL', variantId: 1 }] }]);
  assert.deepEqual(computeEvents(back, back), [], 'no repeat alert while still in stock');
  assert.equal(computeEvents(back, out).length, 0, 'selling out is silent');
  assert.equal(computeEvents({ items: {} }, back).length, 1, 'first check finding stock alerts');
});

test('computeEvents reports errors once', () => {
  const ok = { items: { a: { sizes: {}, error: null } } };
  const bad = { items: { a: { sizes: {}, error: 'HTTP 500' } } };
  assert.equal(computeEvents(ok, bad)[0].type, 'error');
  assert.deepEqual(computeEvents(bad, bad), []);
});

test('check.js end to end with fixture: one alert, then silence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-'));
  const state = join(dir, 'state.json');
  const watchlist = join(dir, 'watchlist.json');
  const fixture = join(dir, 'product.json');
  writeFileSync(watchlist, JSON.stringify({ items: [{ id: 'shirt', url: PAGE, sizes: ['XL', 'XXL'] }] }));
  const run = () =>
    execFileSync('node', ['src/check.js', '--dry-run', '--fixture', fixture, '--state', state, '--watchlist', watchlist], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
    });

  writeFileSync(fixture, JSON.stringify(product));
  assert.doesNotMatch(run(), /\[notify\]/);

  const restocked = structuredClone(product);
  restocked.variants.find((v) => v.title === 'XL').available = true;
  writeFileSync(fixture, JSON.stringify(restocked));
  const second = run();
  assert.match(second, /Back in stock/);
  assert.match(second, /cart\/47503735357665:1/);
  assert.doesNotMatch(run(), /\[notify\]/);

  const saved = JSON.parse(readFileSync(state, 'utf8'));
  assert.equal(saved.items.shirt.sizes.XL.available, true);
  assert.equal(saved.items.shirt.sizes.XXL.available, false);
});
