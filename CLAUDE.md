# Notes for Claude

Read this first in every new session. It holds how the owner likes to work
and the plan for what comes next. Keep it up to date when a step is done.

## The project

Static site on GitHub Pages: https://masked1987.github.io/fragility/
No build step, no API keys; the browser fetches everything. See README.md for
the file layout. Tabs, in order:

1. **Gamma Detrite**: embedded from the separate repo `masked1987/gamma-detrite`
   (single `index.html`; heat map of dealer gamma by strike × expiry, Near/Wide ±25%).
2. **Fragility**: 0–100 liquidation-cascade score, history chart, phone alerts.
3. **Forced Flow**: estimated liquidation clusters + dealer gamma, with an
   automatic plain-English reading card.
4. **Market Maker**: are dealers paid for their risk (plan below, all 4 steps done).
5. **Playbook**: picks a trading mode and shows the possible decisions with levels.

## How the owner works

- Trades **ETHUSD only**. ETH is always the first coin and the default on every tab.
- Not a quant: explain in plain language, no jargon without a one-line meaning.
  Every tab leads with a **reading card** (headline, a few lines, "What it means").
  Phrase levels as rounded zones (~2,170) and moves as "±X% a day".
- Uses a phone (Android, dark mode). Always check pages at 390px wide, dark and light.
- Likes clear answers but the site says "Context, not a trade signal".
- Has said yes to publishing: after a change is tested, push the work branch,
  then publish (fragility: `main` and `gh-pages`; gamma-detrite: `main`).
  Bump `V` in `assets/app.js` and both `?v=` in `index.html` on every fragility
  change, or phones keep old files for up to 10 minutes.
- Phone alerts go through ntfy (topic in the `NTFY_TOPIC` repo secret; never
  write the topic name into the repo). Zone changes ring 3 times, a minute apart;
  so does "ETH dealers now losing". "No longer losing" and key-level crossings
  (ETH 2,250 / 2,200 / 2,170, in `tools/fragility/config.js`) ring once.
- Declined for now: outside cron trigger for on-time alerts (GitHub's schedule
  runs late), expiry dates on Gamma Detrite columns, removing the gamma column
  from Forced Flow.

## Things that bite

- Deribit `get_tradingview_chart_data` has no CORS header: browsers can't use it.
  Use Gate candlesticks for price history (`shared/sources/gate.js`).
- Binance and Bybit are blocked in some regions and on GitHub's servers; code
  must work with Gate, OKX and Deribit alone.
- Dealer gamma convention everywhere: dealers long calls, short puts
  (`shared/gamma.js`). Keep any new Greek on the same convention and say so.
- `test/*.mjs` hit live APIs: `node test/live.mjs`, `node test/flow.mjs`,
  `node test/mm.mjs`. Pure modules (`model.js`, `read.js`, `score.js`) run in Node.
  `node test/carry.mjs`, `node test/alerts.mjs` and `node test/plan.mjs` are
  offline and must pass. `node test/playbook.mjs` prints the live Playbook.
- To try `jobs/monitor.mjs` without ringing the phone: copy `state.json` and
  `log.csv` from the `data` branch into a scratch folder, and run it with a
  `--import` preload that replaces `fetch` for `https://ntfy.sh/` (prints instead).

## Market Maker plan

The tab answers one question: **are market makers paid enough for the risk
they carry?** All in one tab, under one reading card, built step by step.

### Step 1: implied vs realized volatility (done)
`tools/market-maker/`. DVOL (Deribit) vs 7-day realized vol from hourly Gate
prices. Reading: dealers winning / balanced / losing over the last 7 days
(gap ±5 vol points), plus 24h IV change, wild-day flag, 30-day IV percentile,
dealer gamma near spot. 30-day chart, gap shaded green/red.

### Step 2: theta vs gamma in dollars (done)
How much dealers collect per day from time decay against what re-hedging costs.
- From the Deribit option chain already fetched (`deribit.options`): per option
  Black-Scholes gamma (`bsGamma`) and theta; sum with the dealer sign convention.
- Daily dollars, using the identity from the owner's video
  (dΠ ≈ ½·Γ·S²·(σ²implied − σ²realized)·dt):
  theta income ≈ ½·Γ$·σ²implied/365, gamma cost ≈ ½·Γ$·σ²realized/365,
  where Γ$ = net dealer gamma in dollars; realized = step 1's 7-day figure.
- Show three small cards: "collect ~$X a day", "re-hedging costs ~$Y a day",
  "net ~$Z a day" (green/red). Add one line to the reading card.
- Also break it down by expiry group (dailies, weeklies, monthly, quarterly),
  since big monthly/quarterly expiries dominate.
- Check: when implied > realized the net must be positive for short-gamma dealers;
  sanity-test with made-up chains in Node before wiring the UI.
- Built as `carry()` in `tools/market-maker/model.js`: per option, its own mark IV
  for decay, step 1's 7-day realized for re-hedging; options expiring within a day
  count only until expiry. Groups: dailies (non-Friday), weeklies (Friday),
  monthly (last Friday), quarterly (last Friday of Mar/Jun/Sep/Dec).
  Dealers are often short short-dated and long quarterlies, so decay and
  re-hedging can both be positive; the table and "How this works" explain it.

### Step 3: vega, the risk of implied vol jumping (done)
- Net dealer vega in dollars per 1 vol point (Black-Scholes vega × OI, same sign
  convention), total and by expiry group.
- Scenario line in plain words: "If fear pushes implied vol up 5 points,
  dealers lose about $Z" (and the reverse).
- Reading card: add a line when 24h IV change × vega is large; tie to
  "Fear is rising / easing" lines from step 1.
- Built in `carry()` as `vega` (flat, every expiry +1 point) and `vegaW` (per
  1 point of DVOL; each expiry moves √(30/days) points, a day at least). The tab
  uses `vegaW`: short-dated vol really does jump more. Under the convention
  dealers are usually net long vega (they hold the quarterlies), so they gain
  when fear rises; step 1's old "costs option sellers" wording was dropped.
  Vol line shows on fear rising/easing days, or when 24h DVOL change × vegaW
  is more than one day of time decay. Card: ±5-point scenario, last 24h, table.

### Step 4: wrap-up (done)
- Overall verdict at the top of the reading card: `readOverall()` in `read.js`
  adds pressure points (dealers losing +2, losing dollars +1, short gamma near
  spot +1, a vol move costing > 1 day of decay +1, Fragility Building +1 /
  Primed +2; well paid −1, long gamma −1). ≥4 unstable, 2–3 on watch, else
  steady, naming the main reasons. Shows the Fragility pill like Forced Flow.
- Alerts in `jobs/monitor.mjs`: ETH dealers start / stop losing (`dealerSide()`,
  1-point buffer), and ETH key levels (`levelCrossings()` in
  `tools/fragility/alerts.js`, 0.15% buffer). State lives in `state.json` on
  the `data` branch (`dealers`, `levels`); a one-time "alerts are on" message
  confirms the setup (`welcomedMM`).
- Step 1 ("losing" = option sellers in general) and step 2 (Deribit dealers'
  dollars on the long-calls/short-puts assumption) can disagree, because dealers
  own the quarterlies. `readCarry()` then says so in words; keep that.

The Market Maker plan is complete.

## Playbook tab

Asked for after the Market Maker plan: "create a strategy from all our tools",
first as a written page, then as this tab. `tools/playbook/`.
- `collect.js` reuses `collectFlow` and `collectMM` (shared HTTP cache); `plan.js`
  is pure. Modes, first match wins: Cascade risk (Primed, MM unstable, or a
  loaded cluster while not Calm), Squeeze up/down (crowded side + its cluster
  within 5% + price not on the wrong side of the flip), Trend (>0.5% below the
  flip, or dealers losing), Range (>0.5% above the flip), else No edge.
- Triggers: alert levels and round numbers (ETH 50, BTC 500), at least 0.15 of
  a day's implied move away, never on the wrong side of the flip. A level
  crossed in the last 4 hourly closes is "just broken" (plan shows Triggered).
- Stop ½ day's move past the trigger; targets are liquidation clusters and the
  biggest long-gamma strike within 2 days' moves, else ½ / ¾ of a day's move.
  These come from a 41-day check (Sep–Oct 2026): ½-move stops survived 79% of
  good days, 0.8× 91%; ½ / ¾ / 1× targets reached 79% / 59% / 43%.
- Not backtested on the Fragility log yet (it started late Oct 2026). Once it
  has a month or more, offer to check which modes actually worked.
