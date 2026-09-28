// Minimal Telegram Bot API client + message formatting.

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function formatEvent(event, item) {
  const title = escapeHtml(item.title || item.label || item.url);
  const link = `<a href="${escapeHtml(item.url)}">${title}</a>`;
  if (event.type === 'restock') {
    const origin = new URL(item.url).origin;
    const lines = event.sizes.map(
      ({ size, variantId }) => `• <b>${escapeHtml(size)}</b> — <a href="${origin}/cart/${variantId}:1">🛒 Add to cart</a>`,
    );
    const price = item.price != null ? `\n💰 ${(item.price / 100).toFixed(2)}` : '';
    return `✅ <b>Back in stock!</b>\n${link}${price}\n${lines.join('\n')}`;
  }
  if (event.type === 'unknown-sizes') {
    const sizes = event.sizes.map((s) => escapeHtml(s.size)).join(', ');
    return `⚠️ Sizes not found on ${link}: <b>${sizes}</b>\nAvailable options: ${escapeHtml((item.allSizes || []).join(', '))}`;
  }
  return `❌ Failed to check ${link}\n<code>${escapeHtml(event.error)}</code>`;
}

export async function sendTelegram(text, { token, chatId }) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(`Telegram error: ${res.status} ${body.description || ''}`);
}
