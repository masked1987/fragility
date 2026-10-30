# Fragility Score (BTC / ETH)

Tabs: Gamma Detrite (embedded, opens first), Fragility, Forced Flow, Market Maker (soon).

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
tools/forced-flow/         Forced Flow tab: estimated liquidation clusters + dealer gamma
  config.js                leverage mix and ladder settings
  model.js                 pure liquidation model (runs in Node)
shared/sources/*.js        one file per exchange, reusable by other tabs
shared/gamma.js            Black-Scholes gamma, GEX, gamma flip
tools/fragility/
  config.js                weights, cutoffs, zones
  collect.js               fetch all sources for one asset
  score.js                 pure scoring (no DOM, runs in Node)
  alerts.js                zone-change detection with hysteresis
  view.js                  the tab UI
test/live.mjs              node test/live.mjs  -> prints live scores
test/flow.mjs              node test/flow.mjs  -> prints live liquidation clusters
```

## Run locally

```
python3 -m http.server 8000
```
then open http://localhost:8000 (ES modules don't load from `file://`).

## Log and phone alerts

`.github/workflows/monitor.yml` runs `jobs/monitor.mjs` every 15 minutes on
GitHub Actions. It sends a push via [ntfy](https://ntfy.sh) when a zone changes
(3-point buffer so it doesn't flap) and appends an hourly row to `log.csv` on
the `data` branch. The Fragility tab charts that log and shows how big the
next-day moves were after each zone.

Setup: install the ntfy app, subscribe to a hard-to-guess topic name, and save
the same name as the repo secret `NTFY_TOPIC` (Settings, Secrets and variables,
Actions). GitHub's servers are in the US, so the job uses Gate, OKX and Deribit
(Binance and Bybit block it). GitHub pauses scheduled jobs in public repos after
60 days without commits and emails you; re-enable from the Actions tab.

### On-time alerts (optional)

GitHub treats `schedule` as best effort: on quiet repos it can run hours late
(gamma-detrite's 15-minute job has run every 4–7 hours). To run on time, have a
free outside scheduler start the job. The GitHub schedule stays as a backup;
extra runs are harmless (one runs at a time, the log is still hourly).

1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate.
   Repository access: only `fragility`. Permissions: Actions → Read and write.
   Pick the longest expiry you're comfortable with and note the date.
2. At [cron-job.org](https://cron-job.org) (free account) create a job:
   - URL: `https://api.github.com/repos/masked1987/fragility/actions/workflows/monitor.yml/dispatches`
   - Schedule: every 15 minutes
   - Advanced → Request method: `POST`
   - Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`
   - Body: `{"ref":"main"}`
3. Save and use "Test run": GitHub answers `204`, and a new run appears under
   Actions within a few seconds.

When the token expires the calls fail with `401`; generate a new one and paste
it into the job.
