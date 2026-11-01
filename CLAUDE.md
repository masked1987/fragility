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
6. **Tactics**: a separate intraday tactic, the GEX pivot + order-flow exhaustion
   setup from the owner's video. Keep it independent of the Playbook.

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
  so does "ETH dealers now losing". "No longer losing" rings once, and so does
  "Tactics 6/6 BUY / SELL" (all six Tactics rules on one side, ETH). Key gamma
  level alerts are OFF (`keyLevels.alerts: false`): after learning they are not
  part of the Tactics rules, the owner said "I don't need crossing alert gamma,
  I will need just 6/6 alerts from tactics". Asked about the zone and dealer
  alerts: "keep those two on". So the phone gets: zone changes, ETH dealers
  losing / no longer losing, and Tactics 6/6. "Test them now": the workflow has a
  `test_alerts` input (Run workflow → tick it; `TEST_ALERTS` in the job) that sends
  one [test] message per alert that is on, in its real format.
- Key gamma levels, picked automatically (alerts now off, see above; levels still
  picked for the Playbook). The owner watches the big, noticeable
  gamma strikes (2,200 / 2,300 / 2,500) and is "not strict to these levels", but
  waits for price to cross one and reverse, sometimes over a couple of days.
  `pickLevels()` in `shared/levels.js`: the 5 strikes with the most open contracts
  (calls + puts) within ±15%, leaving out options expiring within 2 days, ≥0.5%
  apart. (Earlier tries: fixed 2,250/2,200/2,170; then 2 per side within ±5% by
  hedging $, which picked small near strikes and missed 2,500.) `needsRepick()`:
  daily after 08:00 UTC (Deribit expiry), when price is past every level on one
  side, or when `METHOD` changes. Saved in `state.json` (`keyLevels`).
  Alerts: first asked "make sure price is crossed" (built as 0.5% past on a
  15-minute close), then "doesn't matter if that's spike or not as long as price
  is crossed": now any trade through counts, from finished 15-minute Gate candles'
  high / low (`closedCandles()` in `shared/sources/gate.js`), walked in order since
  `lastCandle` (`lastClose` = where price came from), up to 12 hours back.
  `levelEvents()` in `tools/fragility/alerts.js`: break (priority 4); reversal =
  an open break traded back through within 48 h (priority 5, says how far it got
  and how long ago); spike = through and closed back in one candle (priority 5).
  Each level rings at most once an hour (`quiet`), but breaks are always tracked.
  Breaks live in `state.json` (`breaks`), apart from the level list, so a level
  dropped at a re-pick still gets its reversal. A priority-2 (silent) push
  lists new levels. The Playbook reads the saved list from `stateUrl` (falls back
  to picking live), so its "your phone alert rings" note matches.
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
  `node test/carry.mjs`, `node test/alerts.mjs`, `node test/plan.mjs` and
  `node test/tactics.mjs` are offline and must pass. `node test/playbook.mjs`
  and `node test/tactics-live.mjs` print the live tabs.
- Deribit trade paging: page backwards from now (`sorting=desc`). Paging forward
  from a start time ran out of pages on BTC and silently dropped the newest trades.
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

## Tactics tab

From a screen recording the owner sent (TikTok, Aleks Rosme, "10/14 740 QQQ GEX +
Buyers Exhaustion = 4.75R"). Asked for as its own tab after Playbook, "do not
change anything" else. `tools/tactics/`, own data file `sources.js`.
- Video screens → tab: Gamma 3D / Depth View heatmap → depth view table (strike ×
  expiry, $M per 1%); Interval Map (GEX) → price line + node bubbles + cyan PIVOT
  (bubble history is saved in localStorage while the tab is open; no free source
  has intraday GEX history); Net Drift (Premium) → Deribit option trades, calls vs
  puts premium bought/sold since 00:00 UTC; footprint → Deribit perpetual trades,
  15-minute candles, sold × bought per row; volume profile + VAH → Gate 1-minute
  candles, UTC-day session (yesterday's for the first 4 hours) instead of US RTH.
- Setup (`setup()` in `model.js`): pivot = nearest node ≥ 50% of the biggest
  within ±3%. Below the pivot = short side, above = long side. Ready = retest in
  the last 3 candles + order-flow trigger (exhaustion or stepping in) + 2 of 3
  (pivot at VAH/VAL within 0.35%, premium leaning, price on the right side of the
  gamma flip). Stop 0.1% past the retest extreme; targets POC, far VA edge, big
  nodes, ≥ 1R.
- Decision card at the top (`decide()` in `model.js`), asked for as "same rules as
  the video, hold or sell": SELL only when all 6 hold at once (short side; retest
  rejected; buyers exhausted AND sellers in; pivot at VAH; put-heavy premium; below
  the flip), otherwise HOLD with the rules met / missing. Stricter than "Ready",
  which stays as the looser checklist. Later asked to "add buy side too": BUY is
  the mirror image (price above the pivot; retest held; sellers exhausted AND buyers
  in; pivot at VAL; call-heavy premium; above the flip). The card says BUY is not
  from the video. Rule keys: retest, exhaustion, stepping, edge, premium, gamma.
- Account and risk % are shared with the Playbook (`playbook.account`, `playbook.riskPct`).
- Not backtested.
- Phone alert "Tactics 6/6 BUY / SELL" (asked for later): `jobs/monitor.mjs` runs
  `collectTac()`, whose `decision` (= `decide(setup)`) is also what the tab's card
  shows, so they always agree. `sixOfSix()` in `model.js` rings only on the step
  from ≤5 to 6 (or a straight flip from 6/6 one side to the other) and re-arms
  below 6; last `{ met, action }` in `state.json` (`tactics`). ETH only
  (`alertAssets` in `tools/tactics/config.js`). Rings once. A one-time test push in
  the same format (`welcomedTac`) confirmed the setup; `welcomedTac: 2` = the
  later BUY + SELL test pair.
