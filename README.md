# Fragility Score (BTC / ETH)

Tabs: Gamma Detrite (embedded, opens first), Fragility, Forced Flow, Market Maker, Playbook, Tactics.

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
  read.js                  plain-English reading at the top of the tab (runs in Node)
tools/market-maker/        Market Maker tab: implied vs realized volatility (Deribit DVOL vs Gate hourly prices),
                           dealers' time decay vs re-hedging in dollars a day, and what a jump in
                           implied vol makes or costs them (vega), by expiry group
  model.js, read.js        pure calculation and plain-English reading (run in Node)
tools/playbook/            Playbook tab: picks a trading mode from the other tabs and lays out the
                           possible decisions (trigger, entry, stop, targets, size)
  config.js                thresholds and position-size defaults
  plan.js                  pure mode and level logic (runs in Node)
tools/tactics/             Tactics tab: GEX pivot + order-flow exhaustion setup (from the owner's video)
  sources.js               Deribit option and perpetual trades, Gate 1-minute candles
  model.js, read.js        pure: gamma nodes, pivot, volume profile, premium drift, footprint, setup
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
test/mm.mjs                node test/mm.mjs    -> prints the live Market Maker reading and dollars
test/carry.mjs             node test/carry.mjs -> offline checks of the dollar maths (made-up chains)
test/alerts.mjs            node test/alerts.mjs -> offline checks of the overall verdict and alert logic
test/plan.mjs              node test/plan.mjs  -> offline checks of the Playbook modes and levels
test/playbook.mjs          node test/playbook.mjs -> prints the live Playbook mode and decisions
test/tactics.mjs           node test/tactics.mjs -> offline checks of the Tactics model (made-up trades)
test/tactics-live.mjs      node test/tactics-live.mjs -> prints the live Tactics setup
```

## Run locally

```
python3 -m http.server 8000
```
then open http://localhost:8000 (ES modules don't load from `file://`).

## Log and phone alerts

`.github/workflows/monitor.yml` runs `jobs/monitor.mjs` every 15 minutes on
GitHub Actions. It sends a push via [ntfy](https://ntfy.sh) when:

- a Fragility zone changes (3-point buffer so it doesn't flap; rings 3 times, a minute apart);
- ETH dealers start losing on the Market Maker tab (implied − realized below −5 points;
  rings 3 times), and once when they stop (1-point buffer);
- (Off for now, `keyLevels.alerts: false`: the owner only wants the Tactics 6/6
  alert.) ETH trades through a key gamma level, spikes included (a finished
  15-minute Gate candle's high or low goes past it): rings once. Again, louder, if
  price then trades back through within 48 hours (a reversal); through and back in
  one candle rings once as a spike. Each level rings at most once an hour. The
  levels (the 5 strikes with the most open calls + puts within ±15%, leaving out
  options expiring within 2 days, re-picked daily after Deribit's 08:00 UTC
  expiry) are still picked and saved every run, because the Playbook uses them.
  Settings in `tools/fragility/config.js` (`keyLevels`); dealer settings in
  `tools/market-maker/config.js` (`alertAssets`, `flipBufferPts`);
- all 6 BUY or all 6 SELL rules on the Tactics tab are met for ETH ("Tactics 6/6 BUY"
  or "SELL", with UK time and price; rings 5 times, a minute apart). BUY is the mirror image of the
  video's sell. It uses the tab's own `decide()`, rings only when the count goes
  from 5 or fewer to 6, and re-arms once it drops below 6. Assets in
  `tools/tactics/config.js` (`alertAssets`). The rules need a retest in the last 3
  fifteen-minute candles, so a late GitHub run can miss a short-lived 6/6.

To test the phone: GitHub → Actions → "Fragility log and alerts" → Run workflow →
"Send [test] phone alerts": `all` sends the zone-change and dealers alerts once
each plus Tactics 6/6 five times (like the real one); `tactics` sends only Tactics.

It also appends an hourly row to `log.csv` on the `data` branch. The Fragility tab charts that log and shows how big the
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
