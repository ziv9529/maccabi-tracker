// Helpers for reading Shopify storefront product data via the public
// `/products/<handle>.js` endpoint (no auth, JSON, per-variant `available`).

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Normalize any product page URL to its `.js` JSON endpoint. */
export function toProductJsUrl(input) {
  const url = new URL(String(input).trim());
  const parts = url.pathname.split('/').filter(Boolean);
  const idx = parts.lastIndexOf('products');
  if (idx === -1 || !parts[idx + 1]) {
    throw new Error(`Not a Shopify product URL: ${input}`);
  }
  const handle = parts[idx + 1].replace(/\.(js|json|oembed)$/i, '');
  return `${url.origin}/products/${handle}.js`;
}

/** Canonical product page URL (no query string, no `.js`). */
export function toProductPageUrl(input) {
  return toProductJsUrl(input).replace(/\.js$/, '');
}

export function normalizeSize(size) {
  return String(size).trim().toUpperCase();
}

/**
 * Map each requested size to the matching variant. A variant matches when any
 * of its option values equals the size (case-insensitive), so it works no
 * matter which option position holds the size.
 */
export function matchVariants(product, sizes) {
  const result = {};
  const unknownSizes = [];
  for (const size of sizes) {
    const wanted = normalizeSize(size);
    const variants = (product.variants || []).filter((v) => {
      const values = v.options?.length ? v.options : [v.option1, v.option2, v.option3, v.title];
      return values.some((o) => o != null && normalizeSize(o) === wanted);
    });
    if (variants.length === 0) {
      unknownSizes.push(wanted);
      continue;
    }
    // If several variants share the size (e.g. size x color), prefer an available one.
    const pick = variants.find((v) => v.available) || variants[0];
    result[wanted] = { available: Boolean(pick.available), variantId: pick.id };
  }
  return { sizes: result, unknownSizes };
}

export function allSizes(product) {
  const opt = (product.options || []).find((o) => /size|מידה/i.test(o.name));
  if (opt) return opt.values;
  return (product.variants || []).map((v) => v.title);
}

export function absoluteImage(src) {
  if (!src) return null;
  return src.startsWith('//') ? `https:${src}` : src;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch product JSON with timeout and retries. */
export async function fetchProduct(url, { retries = 2, timeoutMs = 15000 } = {}) {
  const endpoint = toProductJsUrl(url);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(endpoint, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) throw Object.assign(new Error('Product not found (404)'), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (err.fatal) break;
      if (attempt < retries) await sleep(2000 * 2 ** attempt);
    }
  }
  throw lastError;
}
