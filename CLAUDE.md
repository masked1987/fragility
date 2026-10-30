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
4. **Market Maker**: implied vs realized volatility (step 1 of the plan below).

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
  write the topic name into the repo). Zone changes ring 3 times, a minute apart.
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

## Market Maker plan

The tab answers one question: **are market makers paid enough for the risk
they carry?** All in one tab, under one reading card, built step by step.

### Step 1: implied vs realized volatility (done)
`tools/market-maker/`. DVOL (Deribit) vs 7-day realized vol from hourly Gate
prices. Reading: dealers winning / balanced / losing over the last 7 days
(gap ±5 vol points), plus 24h IV change, wild-day flag, 30-day IV percentile,
dealer gamma near spot. 30-day chart, gap shaded green/red.

### Step 2: theta vs gamma in dollars (next)
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

### Step 3: vega, the risk of implied vol jumping
- Net dealer vega in dollars per 1 vol point (Black-Scholes vega × OI, same sign
  convention), total and by expiry group.
- Scenario line in plain words: "If fear pushes implied vol up 5 points,
  dealers lose about $Z" (and the reverse).
- Reading card: add a line when 24h IV change × vega is large; tie to
  "Fear is rising / easing" lines from step 1.

### Step 4: wrap-up (optional, ask first)
- One combined verdict at the top joining steps 1–3 with Fragility urgency.
- Phone alert when dealers flip from winning to losing (in `jobs/monitor.mjs`).
- ETH key-level alerts (2,250 / 2,200 / 2,170 were offered once).
