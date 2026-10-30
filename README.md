# Fragility Score (BTC / ETH)

How primed the market is for a liquidation cascade: 0–100, in three zones
(Calm < 35, Building 35–59, Primed ≥ 60). Not a trade signal.

Static site, no build step, no API keys. All data is fetched by the browser.

## Inputs and weights

| Input | Weight | Scores 0 when… | Scores 100 at… |
|---|---|---|---|
| Funding (OI-weighted, all venues) | 25 | 0% to +10% APR | +35% or −15% APR |
| Futures basis (Deribit, ~90d) | 15 | +3% to +10% APR | +25% or −5% APR |
| OI level (percentile, 30d, in coins) | 15 | ≤ 50th pct | 100th pct |
| OI change (24h, in coins) | 15 | flat or falling | +8% |
| Dealer gamma (Deribit, net/gross) | 30 | ≥ +0.3 (long gamma) | ≤ −0.3 (short gamma) |

Missing inputs are dropped and the rest re-weighted. All numbers live in
`tools/fragility/config.js`.

## Data sources

Binance → Bybit → Gate → OKX → Deribit. Each fails independently and the page
shows which ones worked. Binance and Bybit block some regions; Gate, OKX and
Deribit cover funding and OI if they do. OI history comes from the first venue
that has it (Binance, Bybit, then Gate).

## Layout

```
index.html, assets/        tab shell (add a tool in assets/app.js; tabs stay loaded)
tools/embed.js             embeds another Pages site as a tab (Gamma Detrite)
shared/sources/*.js        one file per exchange, reusable by other tabs
shared/gamma.js            Black-Scholes gamma, GEX, gamma flip
tools/fragility/
  config.js                weights, cutoffs, zones
  collect.js               fetch all sources for one asset
  score.js                 pure scoring (no DOM, runs in Node)
  alerts.js                zone-change detection with hysteresis
  view.js                  the tab UI
test/live.mjs              node test/live.mjs  -> prints live scores
```

## Run locally

```
python3 -m http.server 8000
```
then open http://localhost:8000 (ES modules don't load from `file://`).

## Alerts later

`collect` + `evaluate` + `checkZoneChange` run in Node 18+, so a scheduled job
(e.g. GitHub Actions cron) can run them and send a push via ntfy.sh or Telegram.
Store the last zone in the repo or a gist, since the job has no localStorage.
