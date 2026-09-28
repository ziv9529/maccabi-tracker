# maccabi-tracker

Free restock tracker for Shopify stores such as [shop.maccabi-tlv.co.il](https://shop.maccabi-tlv.co.il). A GitHub Action checks your watchlist every 5 minutes. When a size you chose comes back in stock, you get a **Telegram message with a direct add-to-cart link**. A small web page on GitHub Pages lets you add and remove products and pick sizes (multi-select).

Everything runs on free tiers. Public repos get unlimited GitHub Actions minutes.

## How it works

- Shopify exposes product data as JSON at `<product-url>.js`, and each variant (size) has an `available` flag. The checker reads this endpoint and does not scrape HTML.
- `watchlist.json` lists what to track. It is edited by the web UI, or by hand on github.com.
- `state.json` holds the last known availability. You get an alert only when a size goes from **sold out to in stock**, so no spam every 5 minutes. If the size sells out and comes back again, you get another alert.
- `.github/workflows/check.yml` runs `src/check.js`:
  - every 5 minutes
  - on demand
  - right after you edit the watchlist

  It commits `state.json` only when something changed.

## Setup (about 10 minutes)

### 1. Telegram bot

1. In Telegram, message **@BotFather**, send `/newbot` and follow the steps. Copy the **bot token**.
2. Open a chat with your new bot and send it any message, for example `hi`.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and find `"chat":{"id":123456789,...}`. That number is your **chat id**.
4. In this repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`

### 2. Enable the Action

The workflows run from the default branch (`main`), so merge this branch first. Then go to **Actions**, enable workflows if GitHub asks, open **Stock check** and click **Run workflow** once to test it.

### 3. Web UI (GitHub Pages)

1. Go to **Settings → Pages**, set Source to *Deploy from a branch*, and pick `main` with the `/docs` folder.
2. The page is served at `https://<user>.github.io/maccabi-tracker/`.
3. To add or remove items, the page needs a token:
   1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new).
   2. Under *Repository access*, choose *Only select repositories* and pick `maccabi-tracker`.
   3. Under *Permissions*, set **Contents: Read and write** and **Actions: Read and write**.
4. Paste the token in the page's **Settings** panel. It is stored only in your browser's localStorage and never committed. You can view the page without a token.

### Using the UI

1. Paste a product link, click **Next**, pick one or more sizes and click **Start tracking**.
2. The check runs right away for the new item. About a minute later, **Edit sizes** shows the product's real sizes and whether each is in stock.
3. Each item shows its status per size, a **Buy** button when a size is in stock, **Edit sizes** and **Remove**.

## Timing

- The check runs every 5 minutes on GitHub's own scheduler. It's free, because Actions minutes are free for public repos.
- GitHub's scheduler is best effort:
  - Runs can start a few minutes late, and some are skipped when GitHub is busy.
  - After any change to `.github/workflows/check.yml`, the schedule can take up to about an hour to start again.
- Editing the watchlist from the page, or pressing **Check now**, runs a check immediately.
- `keepalive.yml` stops GitHub from switching the schedule off after 60 days without repo activity.

## Security

**What's public:** the page, the code, `watchlist.json` (what you track) and `state.json` (stock status). There are no secrets in any of them. A visitor without your token can only look.

**What's private:**
- The Telegram bot token and chat id are stored as GitHub Actions secrets. They are masked in logs and never given to pull requests from forks.
- Your GitHub token is typed into the page and kept only in your browser. It is sent only to `api.github.com`.

**How to create the token:**
- Make it a **fine-grained** token, with *Only select repositories* set to `maccabi-tracker`.
- Grant **Contents: Read and write** and **Actions: Read and write**. Grant nothing else, and in particular **not Workflows**, so the token can't change the workflow files.
- Set an **expiration**, for example 90 days. Revoke it anytime at <https://github.com/settings/personal-access-tokens>.

**Remembering the token:** leave "Remember on this device" off on shared or public computers. The token is then forgotten when the tab closes.

**If the token ever leaked,** someone could edit your watchlist or trigger checks, and that's all. They could not read your Telegram secrets or touch other repos. Revoke the token and create a new one.

**Page hardening:**
- A strict Content-Security-Policy runs only the page's own script.
- The page connects only to `api.github.com` and loads images only from `cdn.shopify.com`, so injected code couldn't send the token elsewhere.
- Shop data is HTML-escaped, and product links must be `http(s)`.
- The workflow actions are pinned to commit SHAs.

## Local usage

```bash
npm test                                   # unit + end-to-end tests (offline, uses a fixture)
node src/check.js --dry-run                # live check, print alerts instead of sending
node src/check.js --dry-run --fixture test/fixtures/retro-2000-01.js.json --state /tmp/state.json
```

`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are read from the environment. Without them, alerts are printed instead of sent.
