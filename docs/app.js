const DEFAULT_REPO = 'ziv9529/maccabi-tracker';
const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
const $ = (id) => document.getElementById(id);

const store = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },
};
// The token lives in sessionStorage (gone when the tab closes) unless the
// user opts into "remember on this device", which uses localStorage.
const tokenStore = {
  get() {
    try { return sessionStorage.getItem('token') || localStorage.getItem('token') || ''; } catch { return ''; }
  },
  set(value, remember) {
    try {
      sessionStorage.removeItem('token'); localStorage.removeItem('token');
      if (value) (remember ? localStorage : sessionStorage).setItem('token', value);
    } catch {}
  },
  remembered() { try { return Boolean(localStorage.getItem('token')); } catch { return false; } },
};

function inferRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return m && seg ? `${m[1]}/${seg}` : DEFAULT_REPO;
}
let repo = store.get('repo') || inferRepo();
let branch = null;
let watchlist = { items: [] };
let state = { items: {} };

function toast(msg, ms = 3000) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- Shopify URL helpers (mirror of src/shopify.js) ----
function toProductJsUrl(input) {
  const url = new URL(String(input).trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http(s) product links are supported');
  const parts = url.pathname.split('/').filter(Boolean);
  const i = parts.lastIndexOf('products');
  if (i === -1 || !parts[i + 1]) throw new Error('Not a product link (expected …/products/…)');
  return `${url.origin}/products/${parts[i + 1].replace(/\.(js|json)$/i, '')}.js`;
}
const toPageUrl = (u) => toProductJsUrl(u).replace(/\.js$/, '');
// Safe variant for rendering: never lets a non-http(s) URL into an href.
const safePageUrl = (u) => { try { return toPageUrl(u); } catch { return '#'; } };
const sized = (src, w) => src + (src.includes('?') ? '&' : '?') + 'width=' + w;

// ---- GitHub API ----
async function gh(path, opts = {}) {
  const token = tokenStore.get();
  const headers = { Accept: 'application/vnd.github+json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, { ...opts, headers, cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`${res.status} ${body.message || res.statusText}`), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
function b64encode(str) {
  let bin = ''; for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
  return btoa(bin);
}
async function getBranch() {
  if (!branch) branch = (await gh('')).default_branch;
  return branch;
}
async function readFile(path, fallback) {
  try {
    const f = await gh(`/contents/${path}?ref=${await getBranch()}`);
    return { data: JSON.parse(b64decode(f.content)), sha: f.sha };
  } catch (e) {
    if (e.status === 404) return { data: fallback, sha: undefined };
    throw e;
  }
}
async function writeWatchlist(mutate, message) {
  if (!tokenStore.get()) { $('settingsDetails').open = true; throw new Error('Add a GitHub token in Settings first'); }
  // Re-read right before writing so we never overwrite a newer version.
  const { data, sha } = await readFile('watchlist.json', { items: [] });
  mutate(data);
  await gh('/contents/watchlist.json', {
    method: 'PUT',
    body: JSON.stringify({ message, content: b64encode(JSON.stringify(data, null, 2) + '\n'), sha, branch: await getBranch() }),
  });
  watchlist = data;
  render();
}

// ---- Load & render ----
async function load() {
  try {
    const [w, s] = await Promise.all([readFile('watchlist.json', { items: [] }), readFile('state.json', { items: {} })]);
    watchlist = w.data; state = s.data;
    render();
  } catch (e) {
    $('list').innerHTML = `<div class="card error">Could not load data from ${esc(repo)}: ${esc(e.message)}</div>`;
  }
}

function sizeChip(size, info) {
  if (!info) return `<span class="chip pend" title="Not checked yet">${esc(size)} <small>…</small></span>`;
  return info.available
    ? `<span class="chip ok">${esc(size)} <small>in stock</small></span>`
    : `<span class="chip no">${esc(size)} <small>sold out</small></span>`;
}

function render() {
  const items = watchlist.items || [];
  $('count').textContent = items.length ? `(${items.length})` : '';
  if (!items.length) { $('list').innerHTML = '<div class="card muted">Nothing tracked yet. Paste a product link above.</div>'; return; }
  $('list').innerHTML = items.map((item) => {
    const st = state.items?.[item.id || item.url] || {};
    const pageUrl = safePageUrl(item.url);
    const origin = pageUrl === '#' ? '' : new URL(pageUrl).origin;
    const inStock = Object.entries(st.sizes || {}).filter(([s, v]) => v.available && item.sizes.map((x) => x.toUpperCase()).includes(s));
    const buy = !origin ? '' : inStock.map(([s, v]) => `<a class="btn" href="${esc(origin)}/cart/${esc(v.variantId)}:1" target="_blank" rel="noopener">🛒 Buy ${esc(s)}</a>`).join('');
    const unknown = (st.unknownSizes || []).length ? `<div class="error">Sizes not on this product: ${esc(st.unknownSizes.join(', '))}</div>` : '';
    return `<div class="card item" data-id="${esc(item.id)}">
      ${st.image ? `<img src="${esc(sized(st.image, 200))}" alt="" loading="lazy">` : '<img alt="">'}
      <div class="body">
        <a class="title" dir="auto" href="${esc(pageUrl)}" target="_blank" rel="noopener">${esc(st.title || item.label || item.url)}</a>
        ${st.price != null ? `<span class="muted"> · ${(st.price / 100).toFixed(2)}</span>` : ''}
        <div class="chips">${item.sizes.map((s) => sizeChip(s.toUpperCase(), st.sizes?.[s.toUpperCase()])).join('')}</div>
        ${st.error ? `<div class="error">⚠️ ${esc(st.error)}</div>` : ''}${unknown}
        <div class="muted">${st.lastChangeAt ? `Last change: ${new Date(st.lastChangeAt).toLocaleString()}` : 'Waiting for first check'}</div>
        <div class="actions">${buy}<button data-act="edit">Edit sizes</button><button class="danger" data-act="remove">Remove</button></div>
        <div class="edit" hidden></div>
      </div>
    </div>`;
  }).join('');
}

// ---- Size picker ----
function renderPicker(container, sizes, selected, availability = {}) {
  container.innerHTML = sizes.map((s) => {
    const a = availability[s];
    const note = a === true ? ' <small>in stock</small>' : a === false ? ' <small>sold out</small>' : '';
    return `<span class="chip ${selected.has(s) ? 'sel' : ''}" data-size="${esc(s)}" role="checkbox" aria-checked="${selected.has(s)}" tabindex="0">${esc(s)}${note}</span>`;
  }).join('');
}
function bindPicker(container, selected, rerender) {
  const toggle = (el) => { const s = el.dataset.size; selected.has(s) ? selected.delete(s) : selected.add(s); rerender(); };
  container.addEventListener('click', (e) => { const el = e.target.closest('[data-size]'); if (el) toggle(el); });
  container.addEventListener('keydown', (e) => { const el = e.target.closest('[data-size]'); if (el && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toggle(el); } });
}

let addSizes = [...DEFAULT_SIZES];
let addAvail = {};
const addSelected = new Set();
const rerenderAdd = () => renderPicker($('addChips'), addSizes, addSelected, addAvail);
bindPicker($('addChips'), addSelected, rerenderAdd);

// The page does not fetch the shop directly: a strict CSP keeps the token from
// being sent anywhere but api.github.com. Real sizes and availability show up
// under "Edit sizes" after the first check (which runs right after saving).
function loadSizes() {
  let jsUrl;
  try { jsUrl = toProductJsUrl($('url').value); } catch (e) { return toast(e.message); }
  addSizes = [...DEFAULT_SIZES]; addAvail = {}; addSelected.clear();
  $('preview').hidden = false; $('previewImg').hidden = true;
  $('previewTitle').textContent = decodeURIComponent(jsUrl.split('/products/')[1].replace(/\.js$/, '')).replace(/-/g, ' ');
  $('previewNote').textContent = 'Pick sizes. After the first check (about a minute), "Edit sizes" shows the product\'s real sizes and stock.';
  $('sizePicker').hidden = false;
  rerenderAdd();
}

$('loadBtn').onclick = loadSizes;
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSizes(); });
$('addCustom').onclick = () => {
  const s = $('customSize').value.trim().toUpperCase();
  if (!s) return;
  if (!addSizes.includes(s)) addSizes.push(s);
  addSelected.add(s); $('customSize').value = ''; rerenderAdd();
};

$('addBtn').onclick = async () => {
  if (!addSelected.size) return toast('Pick at least one size');
  const btn = $('addBtn'); btn.disabled = true;
  try {
    const url = toPageUrl($('url').value);
    const label = $('previewTitle').textContent;
    await writeWatchlist((data) => {
      data.items = data.items || [];
      const existing = data.items.find((i) => toPageUrl(i.url) === url);
      if (existing) existing.sizes = [...new Set([...existing.sizes, ...addSelected])];
      else data.items.push({ id: Math.random().toString(36).slice(2, 10), label, url, sizes: [...addSelected], addedAt: new Date().toISOString() });
    }, `Track ${label} (${[...addSelected].join(', ')})`);
    toast('Saved — the first check starts in a few seconds');
    $('url').value = ''; $('sizePicker').hidden = true; $('preview').hidden = true;
    setTimeout(load, 60000);
  } catch (e) { toast(`Save failed: ${e.message}`, 5000); }
  finally { btn.disabled = false; }
};

$('list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.item');
  const id = card.dataset.id;
  const item = watchlist.items.find((i) => i.id === id);
  if (btn.dataset.act === 'remove') {
    if (!confirm(`Stop tracking "${state.items?.[id]?.title || item.label || item.url}"?`)) return;
    btn.disabled = true;
    try { await writeWatchlist((d) => { d.items = d.items.filter((i) => i.id !== id); }, `Stop tracking ${item.label || item.url}`); toast('Removed'); }
    catch (err) { toast(`Remove failed: ${err.message}`, 5000); btn.disabled = false; }
  }
  if (btn.dataset.act === 'edit') {
    const box = card.querySelector('.edit');
    if (!box.hidden) { box.hidden = true; return; }
    const st = state.items?.[id] || {};
    const sizes = [...new Set([...(st.allSizes || DEFAULT_SIZES).map((s) => s.toUpperCase()), ...item.sizes.map((s) => s.toUpperCase())])];
    const avail = Object.fromEntries(Object.entries(st.sizes || {}).map(([k, v]) => [k, v.available]));
    const sel = new Set(item.sizes.map((s) => s.toUpperCase()));
    box.innerHTML = '<div class="chips"></div><button class="primary">Save sizes</button>';
    const chips = box.querySelector('.chips');
    const rr = () => renderPicker(chips, sizes, sel, avail);
    bindPicker(chips, sel, rr); rr();
    box.hidden = false;
    box.querySelector('button').onclick = async (ev) => {
      if (!sel.size) return toast('Pick at least one size');
      ev.target.disabled = true;
      try { await writeWatchlist((d) => { d.items.find((i) => i.id === id).sizes = [...sel]; }, `Update sizes for ${item.label || item.url}: ${[...sel].join(', ')}`); toast('Sizes updated'); }
      catch (err) { toast(`Save failed: ${err.message}`, 5000); ev.target.disabled = false; }
    };
  }
});

$('runBtn').onclick = async () => {
  if (!tokenStore.get()) { $('settingsDetails').open = true; return toast('Add a GitHub token in Settings first'); }
  try {
    await gh('/actions/workflows/check.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: await getBranch() }) });
    toast('Check started — refresh in about a minute');
  } catch (e) { toast(`Could not start: ${e.message}`, 5000); }
};
$('refreshBtn').onclick = load;

// ---- Settings ----
function renderSettings() {
  $('tokenState').textContent = !tokenStore.get() ? '· no token (read-only)'
    : tokenStore.remembered() ? '· token remembered on this device ✓' : '· token saved for this tab ✓';
  $('remember').checked = tokenStore.remembered();
  $('repo').value = repo;
}
$('saveToken').onclick = () => {
  const value = $('token').value.trim() || tokenStore.get();
  tokenStore.set(value, $('remember').checked);
  $('token').value = ''; renderSettings(); toast(value ? 'Token saved' : 'No token entered');
};
$('clearToken').onclick = () => { tokenStore.set(''); renderSettings(); toast('Token cleared'); };
$('repo').addEventListener('change', () => { repo = $('repo').value.trim() || inferRepo(); store.set('repo', repo); branch = null; load(); });

renderSettings();
rerenderAdd();
load();
setInterval(() => { if (!document.hidden) load(); }, 120000);
