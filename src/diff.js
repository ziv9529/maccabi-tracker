// Pure logic: compare previous and new state, decide what to notify about.

/**
 * @returns {Array<{type: 'restock'|'error'|'unknown-sizes', itemId: string, sizes?: Array<{size: string, variantId: number}>, error?: string}>}
 */
export function computeEvents(prevState, newState) {
  const events = [];
  for (const [itemId, next] of Object.entries(newState.items || {})) {
    const prev = prevState.items?.[itemId];

    if (next.error) {
      if (!prev?.error) events.push({ type: 'error', itemId, error: next.error });
      continue;
    }

    // Only alert on an unavailable -> available transition, so a size that
    // stays in stock doesn't re-alert every run. A first check that finds a
    // size already in stock counts as a transition too.
    const restocked = [];
    for (const [size, info] of Object.entries(next.sizes || {})) {
      if (info.available && !prev?.sizes?.[size]?.available) {
        restocked.push({ size, variantId: info.variantId });
      }
    }
    if (restocked.length) events.push({ type: 'restock', itemId, sizes: restocked });

    const unknown = next.unknownSizes || [];
    const prevUnknown = prev?.unknownSizes || [];
    if (unknown.length && unknown.join() !== prevUnknown.join()) {
      events.push({ type: 'unknown-sizes', itemId, sizes: unknown.map((size) => ({ size })) });
    }
  }
  return events;
}

/** True when anything worth persisting changed (ignores volatile fields). */
export function availabilityChanged(prev, next) {
  if (!prev) return true;
  return JSON.stringify(prev.sizes || {}) !== JSON.stringify(next.sizes || {});
}
