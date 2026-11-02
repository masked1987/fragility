# Notes for Claude

Read this first in every new session. It holds how the owner likes to work
and the plan for what comes next. Keep it up to date when a step is done.

## The project

Static site on GitHub Pages: https://masked1987.github.io/fragility/
No build step, no API keys; the browser fetches everything. See README.md for
the file layout. Tabs, in order:

1. **Gamma Detrite**: embedded from the separate repo `masked1987/gamma-detrite`
   (single `index.html`; heat map of dealer gamma by strike × expiry, Near/Wide ±25%).
   **Expiry tabs** (asked 2 Nov 2026, "like tab selector"): Daily (the very next
   expiry) / Weekly (nearest Friday) / Monthly (nearest last Friday of a month) /
   All, each with its date under the name and a gliding gradient underline. Heat
   map, flip, key readings and put/call use only the chosen expiries (`parse()` once,
   `view(P, wide, pick)`). One expiry = a bar per strike; All = every expiry, after
   9 columns the last ("later") adds up the rest. Saved per phone (`gd.exp`). The
   saved-snapshot fallback only has its 10 nearest columns (dates from the "Nd"
   labels). Checked against the old calculation: same numbers.
   Then (same day) a combined D+W+M tab; owner: "Not together, separately please,
   up to choice", picked "Mix your own": now Daily / Weekly / Monthly each switch on
   and off (any mix, each its own column, own underline); All = everything and
   clears them; removing the last one goes back to All. `pick` = "all" or e.g.
   "day+month". A shared date (Thursday daily = weekly) shows once.
   Then "make sure all expiries is the first to show": All is the first tab (left)
   and the page always opens on All (the choice is no longer saved per phone).
   **Daily approach** (2 Nov 2026): the owner is building a separate DAILY trading
   approach from the Gamma tab's Daily view (blue = dealers trade against the move,
   price tends to stall / turn; pink = with the move, runs). "Don't take into account
   alt tactics or any other strategies": keep it fully separate from Alt Tactics,
   Tactics, Playbook and the Market Maker strategy; his long-term strategies stay
   as they are. "Don't build anything, I just want you to know the rules" (so far):
   price touches a blue zone on the Daily view → wait for the 5-minute Ichimoku
   Tenkan / Kijun cross → enter; stop at the low / high of the touch. Sides not
   said yet. Take profit not decided ("we need to pick something optimal"). Past
   daily-expiry gamma is only free for the 1st of each month (Tardis), so a real
   test would have ~36 days. Build nothing until he asks.
   Asked "do the test to find best take profit": `SNAP=<gamma-detrite clone> node
   test/daily-tp.mjs 37 <cache> 3` (own retrying Tardis loader: the free server answers
   429 when pulled hard; never cache an empty chain). Then "use ichimoku 5 min for entry,
   god mode for tp": his own **GodMode** Pine script (pasted; LazyBear / xSilas /
   Ni6HTH4wK, current ticker only), settings **17, 6, 4**, "Multi-exchange?" off =
   wt1 = avg(TCI, money flow, RSI); wt2 = sma(wt1, 6); yellow "Caution!" dot when wt2 > 80
   (ends a buy) or < 20 (ends a sell), on the **15-minute** chart. Results
   `test/results/daily-tp-2026-11-02.txt` (37 first-of-month days + 28–31 Oct from the
   Gamma Detrite snapshot history; buys + sells, 0.1% costs, median stop 0.58%): every
   take profit slightly negative over 3 years; best GodMode dot −0.05%/trade (129, 36%
   win, worst run 7), biggest blue −0.04%, next blue −0.05%, flip line worst −0.21%;
   last year GodMode +0.15%/trade (41), biggest blue +0.11%; last 3 months GodMode
   +0.02% (15 trades). About break-even after costs, not proven. "Check last 3 months":
   no free per-strike OI for every day; only 1st of month + the snapshots since 27 Oct.
   In % (asked "show me stats like % wise"): GodMode TP, full position, after costs,
   3 years −7.0% (before costs +5.9%), 35% win, avg win +0.83% / loss −0.53%; 2024
   −2.8%, 2025 −10.2%, 2026 +6.3%; buys −6.7%, sells −0.3%. Not profitable yet.
   Stop loss grid (asked "test them all and find best SL"; `SLGRID=1`, results
   `test/results/daily-sl-2026-11-02.txt`, GodMode TP for all): touch low/high −7.0%;
   +2 pts −7.5%; +5 / +10 pts −3.7%; +20 pts +1.0%; +0.1% −7.4%; +0.2% −3.2%; +0.3% −7.2%;
   +0.5% **+1.6%** (102 trades, 49% win, max drop 12.9%); zone strike +10 pts (or the touch
   if further) −0.8% (smallest yearly losses, max drop 12.4%); next strike past the zone
   −2.0%; fixed 0.5–1.5% from entry all worst (−8.9 to −16.5%). Every stop loses in 2024
   and 2025 and wins in 2026; some room past the touch helps a little but results jump
   between neighbours, so it's about break-even whatever the stop.
   Month by month (asked): each "month" is one test day (the 1st); 0.5% stop 14 up /
   17 down, lowest −12.5% (Jan 2026), ends +1.6%; gains mostly Feb–Apr and Oct 2026.

## Outside strategies (asked 2 Nov 2026, not his own)

"Look on GitHub ... profitable strategies ... do not include mine", "doesn't need to
fit my style", then "Test 1 2 and 3". `node test/outside-strategies.mjs <cache>`
(Deribit hourly ETH perp candles, perp funding, DVOL; all free daily), results
`test/results/outside-strategies-2026-11-02.txt`, Nov 2023 – Oct 2026, % of ETH price,
full position, compounded, 0.05% a side. Buy and hold ETH +24% (max drop 68%).
1. Trend following: long only above the N-day average: 30d +166%, 40d +299%, **50d
   +269%** (max drop 37.5%, 24 trades), 60d +205%, 75d +98%, 100d +101%, 150d +93%,
   200d +84%; all beat holding, mostly by sitting out the big drops (Aug 2024, Feb 2025,
   Nov 2025, Feb / Jun 2026). Long + short 50d (perp, funding paid) +364% but max drop
   58%; 20-day breakouts and blended long + short weak (+6 to +20%).
2. Funding carry (hold ETH, short Deribit perp): always on +15.7% over 3 years, max drop
   0.8%, but 2024 +8.8%, 2025 +1.0%, 2026 +1.1% (Deribit funding avg 4.9%/yr; Binance /
   OKX higher, not fetchable). Switching on/off by recent funding is worse.
3. Selling ATM straddles, priced at DVOL (no free option price history): the result
   is all about the price you sell at. Daily: DVOL −1 +556%, −3 +163%, −5 +5%, −10 −89%;
   weekly: −1 +78%, −3 +26%, −5 −11%. Real spreads on 2 Nov 2026: daily ~3–4 vol points
   below mark at the bid, weekly ~1.5. Worst single straddle −20 to −24% of ETH price.
   Too fragile to trust. Conclusion given: trend following is the one that held up.
2. **Fragility**: 0–100 liquidation-cascade score, history chart, phone alerts.
3. **Forced Flow**: estimated liquidation clusters + dealer gamma, with an
   automatic plain-English reading card.
4. **Market Maker**: are dealers paid for their risk (plan below, all 4 steps done),
   plus the flip card (trade the turn to dealers losing; see the backtest section).
5. **Playbook**: picks a trading mode and shows the possible decisions with levels.
6. ~~Tactics~~ **removed from the site 2 Nov 2026** (owner: "yes remove tactics tab", after
   asking whether anything used it: nothing did). Was the GEX pivot + order-flow setup from
   his video. The code stays in `tools/tactics/` (still in the import-map list, since
   `test/importmap.mjs` checks every file on disk) for `test/tactics*.mjs`; the job no
   longer runs it and its 6/6 alert is gone. Tab list in `assets/app.js` is 7 again, phone
   tab padding back to the 7-tab sizes. v=53. The Tactics section below is history.
7. **Alt Tactics**: the owner's own method (dip through a huge gamma level, buy
   when buyers are back, stop at the low). Kept apart from Tactics (video rules).
8. **Trend** (2 Nov 2026, "create separate tab with that strategy"): the 50-day
   average rule from the outside-strategies test. Daily close (00:00 UTC) above the
   50-day average = own ETH (IN), below = cash (OUT); long only, no stop, no target.
   `tools/trend/` (model.js pure: states, trades, `line` = tonight's line = average of
   the last 49 closes, the price today's close must beat; collect.js = Gate futures
   daily candles, 1,000 days). Reading card (In / Out / Buy / Sell headline, tonight's
   line), IN / OUT / BUY / SELL card (BUY / SELL for 24 h after the crossing close) with
   the numbered rules, 6-month chart (close, dashed average, IN shaded, triangles),
   trades table + live check on Gate prices, backtest card (ETH Nov 2023 – Oct 2026:
   +268.8% vs holding +24.4%, worst drop 38% vs 68%, 21 trades; the test's "24"
   counted a few outside the period). The tab's code on the test's Deribit closes gives
   +267.7% (first-day buy cost). `node test/trend.mjs` is offline and must pass.
   Eight tabs: phone padding 2.5px / 13.5px (1.5px / 12.5px under 380px) so all fit
   next to the style dot. v=51. (Back to 7 tabs and the 7-tab sizes at v=53, when
   Tactics was removed.)
   **Phone alert** (asked "with alerts when to enter, what's TP and stop loss"; he chose
   "keep it as tested": no fixed SL / TP): `jobs/monitor.mjs`, ETH (`alertAssets`),
   `trendEvents()` in model.js (crossings since `state.trend[asset].at`, none older than
   72 h; first run only saves the state). BUY / SELL priority 4, rings 3 times
   (`TREND_REPEATS`): BUY = entry (the close), "Stop loss: a daily close under <tonight's
   line>" (points, %), "a rule on the 00:00 UTC close, not a stop order", "Take profit:
   none"; SELL = the trade's result. While IN, one quiet (priority 2) message per daily
   close with tonight's stop line. One-time "Trend alerts are on" (`welcomedTrend`).
   Workflow test choice `trend` (also in `all`): the last real BUY (its own line) + the
   daily message, as [test]. Each state now carries `line` (for the next close). v=52.
   Test sent 2 Nov 2026 19:41 UTC (`test_alerts: trend`): owner "received all 3 alerts"
   (BUY ×3 rings, the daily stop line, "Trend alerts are on").
   Long only: SELL = close the buy, never a short (long + short 50d was +364% but −22% in
   2024 and a 58% drop; offered, not taken). Offered a filter against sideways losses
   (average rising / close 2% above): owner "Nope stay as it is". Don't re-offer.

## How the owner works

- Trades **ETHUSD only**. ETH is always the first coin and the default on every tab.
- Not a quant: explain in plain language, no jargon without a one-line meaning.
  Every tab leads with a **reading card** (headline, a few lines, "What it means").
  Phrase levels as rounded zones (~2,170) and moves as "±X% a day".
- Uses a phone (Android, dark mode). Always check pages at 390px wide, dark and light.
- 2 Nov 2026: "Don't do test, is not necessary, I already know the stats.
  Backtesting is not necessary." Don't run or report backtests / new stats unless
  he asks; just make the change he asks for (offline unit tests before publishing
  still run quietly, they aren't stats).
- Likes clear answers but the site says "Context, not a trade signal".
- Has said yes to publishing: after a change is tested, push the work branch,
  then publish (fragility: `main` and `gh-pages`; gamma-detrite: `main`).
  Bump `V` in `assets/app.js` and both `?v=` in `index.html` on every fragility
  change, or phones keep old files for up to 10 minutes. Every other module
  (tools/, shared/) gets the same `?v=` through an import map built in
  `index.html` from a file list: a NEW .js file must be added to that list
  (`node test/importmap.mjs` fails otherwise). Without it, a phone once mixed a
  new view.js with an old cached `shared/head.js` and four tabs went blank.
- **Phone alerts now (2 Nov 2026, evening): only the 3 trade strategies, ETH:
  Market Maker strategy, Alt Tactics, Trend.** Owner: "remove condition market alerts,
  also remove video rules strategy": Fragility zone changes, "ETH dealers now losing /
  no longer losing" and Tactics 6/6 no longer ring (`PHONE` flags in `jobs/monitor.mjs`;
  state still tracked, log lines still printed). Then the Tactics tab itself was removed
  (site and job). Workflow test
  choices: all (= mm, alt, trend), mm, alt, trend, check. The history below describes
  how the old alerts worked, if he wants one back.
- Phone alerts go through ntfy (topic in the `NTFY_TOPIC` repo secret; never
  write the topic name into the repo). Zone changes ring 3 times, a minute apart;
  so does "ETH dealers now losing". "No longer losing" rings once. "Tactics 6/6
  BUY / SELL" (all six Tactics rules on one side, ETH) rings 3 times, a minute
  apart (owner tried 5, then "3 is enough"; `TACTICS_REPEATS` in `jobs/monitor.mjs`). Key gamma
  level alerts are OFF (`keyLevels.alerts: false`): after learning they are not
  part of the Tactics rules, the owner said "I don't need crossing alert gamma,
  I will need just 6/6 alerts from tactics". Asked about the zone and dealer
  alerts: "keep those two on". So the phone gets: zone changes, ETH dealers
  losing / no longer losing, Tactics 6/6, and (from 2 Nov 2026, his request) Alt
  Tactics BUY / SELL / WATCH / target hit / stopped (see the Alt Tactics section), and
  (2 Nov 2026) Market Maker strategy BUY / SELL with SL and TP, then TP / SL hit or
  closed after 3 days (see the Market Maker backtest section), and (2 Nov 2026) Trend BUY / SELL plus a
  quiet daily stop line while IN (see the Trend tab). "Test them now": the workflow has a
  `test_alerts` input (Run workflow → choose `all` or `tactics`; `TEST_ALERTS` in
  the job) that sends [test] messages in their real format: zone and dealers once
  each, Tactics 3 times like the real one.
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
- **The look** (asked for 1 Nov 2026, "colours fading into different colours",
  "more modern", "not plain white"): teal fading into lime on near-black
  (`--grad`, `--accent` teal, `--lime` in `assets/style.css`, "Look" sections at
  the end). Gradients only on the score number, active-tab bar, selected button
  and the Calm→Primed gauge; card tones fade in from the top-left corner (no
  thick side stripe). Titles in **Dela Gothic One** (owner picked it from six,
  wanted "like FIRE or BLEED"): headlines, h2/h3, big numbers, the HOLD/BUY/SELL
  badge, uppercase, weight 400 only. Body text, labels and tables stay **Geist**.
  Chart and state colours (calm/building/primed, gamma blue/pink) unchanged.
  Headlines: `headHtml()` in `shared/head.js` splits "Short label: details" into a
  big Dela title and the details in normal text under it (asked "short punchy
  titles"); keep new headlines in that shape. Tactics decision card shows only
  the details, since the badge already says HOLD / BUY / SELL.
  Reading-card bullets are folded under a "Details · N" button (`moreHtml()` in
  `shared/head.js`, asked "collapse the bullets"); order is headline, "What it
  means", then Details. Open/closed is remembered per phone (`readingOpen`), so
  refreshes keep it. The Tactics HOLD/BUY/SELL card keeps its 6 rules visible.
  Tab bar on phones (≤600px) shows short names so all six fit without scrolling:
  Gamma, Score, Flow, Dealers, Plan, Tactics (`short` in `TOOLS`, `assets/app.js`);
  full names on wider screens. Edge fade only if a phone is narrower still.
  **Style switcher** (asked "add a choice in the top corner", Nov 2026): round
  swatch at the right end of the tab bar opens a menu: Teal & lime (default),
  Fire (gold→orange→crimson), Blue moonlight (white→pale blue→electric blue).
  Saved per phone in localStorage `look` ('fire' / 'moon'; teal = no key), set
  before first paint by a small script in `index.html` `<head>`; only look tokens
  change (`:root[data-look=…]` in `style.css`, dark and light each), state and
  chart colours never. Gamma Detrite reads the same key (same site address) and
  follows live through the `storage` event; keep its palettes in sync.
  **Motion** (asked "motion on click or changing tab"): one `.tab-ink` underline
  glides to the new tab (`moveInk()`), the new tab's page slides in ~22px from
  the side you move toward (`slideIn()`, 260 ms expo-out), every control gives
  a press squeeze, the style menu pops from its corner, a style change
  spreads in a circle from the corner dot (`revealLook()`, View Transitions).
  Owner first "didn't notice anything", so it was made bigger: page slides 64px
  over 460 ms, cards rise in one after another (first 5, 70 ms apart), the tab
  line springs with a glow and the tab name pops. Reduced-motion phones (some
  Xiaomi / battery-saver modes) get a soft fade instead of nothing.
  Gamma Detrite has the same look in its own `index.html`. Built using the
  Impeccable design rules (Operate mode: dashboards stay easy to scan).
  To show a change before publishing: copy the site into `preview/` on
  `gh-pages` (and gamma-detrite `main`), point the preview's embed at
  `gamma-detrite/preview/`, bump its `?v=`; delete `preview/` when published.
- Site protection (asked 2 Nov 2026 "can we protect it"): both repos and the site are
  public. Offered: private repos (site needs GitHub Pro), password page (StatiCrypt-style,
  code still public), Cloudflare Pages + Access (free, but may ask for a card; private repo
  Actions = 2,000 min/month, so alerts every 30 min). Owner: can't pay a subscription,
  "leave it as it is for now". Gave him a zip copy of both repos (all branches). Don't
  re-offer unless he asks.
- Auto-trading (asked 2 Nov 2026 "connect you to TradingView or IC Markets ... place
  trades"): only **Trend** would be automatic, the rest he trades by hand; one IC Markets
  **MT5** account, phone only (MT5 Android can't run EAs). Options given: (1) the alert
  job places the trade via MetaApi (cloud MT5 link; free tier "for testing and personal
  use", not guaranteed; needs his trading password; trades hours late with the job);
  (2) Windows VPS ~$10–15/month + EA, set up via Remote Desktop app; (3) by hand from the
  alert (~7 trades a year). TradingView can't take orders from outside. Suggested 1 if
  MetaApi is still free, else 3, demo account first. Owner chose **3: "I will follow
  alerts and execute manually"**. Nothing built; don't re-offer auto-trading unless he asks.
  Explained: exit only on the SELL (daily close under the dashed 50-day line, closed by
  hand), no SL order, buys only. Size: his MT5 account is 1:20; warned off 100% margin.
  He settled on a Trend position worth **40% of the account, no leverage**.
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
  `node test/tactics.mjs`, `node test/alt.mjs`, `node test/flip.mjs`, `node test/trend.mjs` and `node test/importmap.mjs` are offline and must pass. `node test/playbook.mjs`
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

### Market Maker entries backtest (asked 2 Nov 2026)
"Choose the best entry for market maker model and do the backtest ... comparing to
my strategy". `node test/mm-backtest.mjs 36 .bt-cache` (`ALL=1` prints every
version), results `test/results/mm-backtest-2026-11-02.txt`. The tab's hourly
reading over 3 years (DVOL vs 7-day realized, `dealerSide()`), sizes in the day's
implied move, Deribit 5-min exits, 0.1% costs, 3 days max, picked on the first 2
years, checked on the last year. Range fades when dealers win, breakouts when they
lose, buying fear spikes: all lose or fade out (−0.05 to −0.37R; fear spike +0.37R
first 2y, −0.35R last year). Owner then: "count buy and sells together. I'm not
interested in separate" — about the **Market Maker** test (not Alt Tactics; I
wrongly reran Alt and he corrected me: "I want you to test Market Maker"). So every
family counts both sides, one line each (fear has a mirror sell: vol up + price up).
Best of each, buys + sells: fade −0.09R (845 trades), fade in balanced too −0.10R,
trend −0.12R, fear −0.03R (first 2y +0.06R, last year −0.22R). Only **"flip"**
works: dealers just turned losing → trade the way of the last 24h, stop ½ day's
move, target 2 day's moves: 38 trades, 34% hit, +0.65R (first 2y +0.54R, last year
+0.86R; 2024 +0.28 / 2025 +0.95 / 2026 +0.81R), worst run 6, without best 2 still
+0.47R (wins all ~+4R). Picked from 6 flip versions; trade-count floor lowered
30 → 20 after seeing it, so not fully blind. Now on the tab (see "On the tab" below). Then "which one is more consistently profitable? Give me pure % numbers":
table in the results file (price % per trade, buys + sells): flip +1.20%/trade vs
Alt +0.74%, win rate 34% vs 18%, max drawdown 11.5% vs 30.7%, profitable quarters
82% vs 31%; Alt's best 2 trades are 186% of its profit. Answer: flip is the more
consistent; he wants % figures, not R.
**On the tab** (asked "add the flip to the Market Maker tab", v=47): card right under
the reading card. `tools/market-maker/flip.js` (pure: `readings()`, `flipSignal()`,
`followFlip()`, `flipTrades()`, `flipState()`), used by both the tab (`collect.js`,
Gate hourly candles, finished hours only; `gate.hourlyCloses` now also returns
high/low) and `test/mm-backtest.mjs` (its "tab code" line must match the pick:
38 / +0.65R). `cfg.flip` in `config.js`: stopMoves 0.5, targetMoves 2, maxHours 72,
freshHours 2 (BUY / SELL badge that long, then OPEN), backtest numbers in % for the
card. The first reading can't be a flip (no "before"). Card states: BUY / SELL (stop
box with the number, entry, target, ends, size from the Plan tab account), OPEN,
WAIT (no flip: gap now, which way it would trade, stop / target now, last flip in
30 days; or dealers already losing: losing since, the flip only fires on the turn).
`node test/flip.mjs` is offline and must pass (incl. the alert events). The "dealers now losing" alert (`jobs/monitor.mjs`) uses
`ivWeek − rvWeek` from `analyse()` incl. Gate's still-forming candle, so it can come
an hour apart from the card; the card says so.
Then "Make sure it's the same strategy very clear" (v=48): every state shows a
numbered "The rules: exactly what was backtested" box (`.mm-rules`): signal (hourly
close, 7-day avg DVOL − 7-day realized ≤ −5, stays losing until > −4), direction
(24h), entry (that close), stop ½ day's move, target 2 day's moves (4R), exit on
5-minute candles (stop first if both; out after 3 days), one at a time / only the
turn. Live trades are now followed on Gate 5-minute candles (`closedCandles(asset,
5, 1000)` ≈ 3.5 days, passed to `flipState(..., fine)`), like the backtest's 5-min
exits; hourly only for older flips. The only difference stated on the card: Gate
prices on the tab, Deribit in the test (no CORS).
Owner then: "I meant market maker": he calls it the **Market Maker strategy**, not
"the flip". All visible text says "Market Maker strategy" / "signal" (card label
"ETH · Market Maker strategy", "Last signal", rules box "Market Maker strategy: the
rules, exactly as backtested", "Market Maker strategy backtest ... (the one compared
with Alt Tactics)"). Code names (`flip.js`, `cfg.flip`) unchanged. Use his name in
replies too. v=49.
**Phone alert** (asked "create alert for market maker strategy, but also add stop
loss and TP", v=50): `jobs/monitor.mjs`, inside the Market Maker block (ETH,
`MM_CONFIG.alertAssets`), uses `mm.flip` from `collectMM` (= the card) and
`mmEvents()` in `flip.js`: signal, then 'target' / 'stopped' / 'time', each pushed
once (`state.mmStrat[asset].sent`, pruned after 10 days; `since` = first run;
older than 24 h skipped). `mmsMessage()`: "Market Maker BUY / SELL - ETH 2,286.7 at
14:00 UK", rings 3 times (`MMS_REPEATS`), priority 4: why (dealers turned losing,
24h move), Entry, Stop loss (number, points, %, half a day's move), Take profit
(number, points, %, 2 day's moves, 4x), out-after-3-days time, late note if >30 min.
Then "Market Maker TP hit" (prio 4) / "SL hit" (prio 3) / "closed after 3 days"
(prio 3) once each with the % result. One-time "Market Maker strategy alerts are on"
(`welcomedMMS`). Workflow test choice `mm` (also in `all`) sends the last signal in
30 days, else a sample from today's numbers, as [test], rings 3 times. Card WAIT
text says the phone rings 3 times with SL and TP. The older "dealers now losing"
alert stays as it was (can come an hour apart; it uses the forming candle).
Month by month (asked "do the back testing ... exactly the same strategy [as the
alert] ... results for each month"): `MONTHLY=1 LIST=1 node test/mm-backtest.mjs 36
.bt-cache` runs the tab / alert code (`flipTrades`, `cfg.flip`), results in
`test/results/mm-monthly-2026-11-02.txt`. Nov 2023 – Nov 2026: 38 trades in 23 of 37
months (11 up, 12 down, 14 none); full position +52.4%, account at 1% risk +26.7%;
best month Nov 2025 +16.0%, worst Feb 2025 −5.9% / Dec 2025 −5.8%; worst drop
from a high 9.7% (month ends). Backtest enters at the signal close; the real alert
can arrive hours late (GitHub schedule).

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
- **Both sides at once** (asked Nov 2026 "what if it looks for sells and should
  look for buys at the same time"; before, one pivot = the nearest big node, and
  the side followed the price, so a BUY at a big node below was never checked
  while price sat under a pivot above). `pickPivots()` gives the nearest big node
  above (SELL rules) and at/below (BUY rules) from the same qualifying nodes;
  `buildTac()` runs `setup()` for each and `decideBoth()` combines them: the side
  that is 6/6, else the one with more rules met (tie: nearer pivot), plus
  `sides: { sell, buy }` and `setup` (that side's levels). Same shape as before,
  so the card, `sixOfSix()` alert and backtest read it unchanged; the alert
  message and backtest use `decision.setup`. Both can't be 6/6 together (gamma
  rule). Card: leading side open with its 6 rules and six dots, the other folded;
  "nothing to watch" when a side has no big node. The looser "Tactic" checklist
  card, interval map and plan still use the nearest pivot. The job log line
  prints both sides (`sell 1/6 at 2280, buy none`). The 36-day backtest above was
  run with the one-pivot version.
- Account and risk % are shared with the Playbook (`playbook.account`, `playbook.riskPct`).
- Backtest (asked "test it on past data", 1 Nov 2026): `test/tactics-backtest.mjs`.
  Past option OI per strike is only free for the 1st of each month (Tardis free
  sample days), so it tests those days: chain = first ~200 MB of Tardis
  options_chain (00:00–00:20 snapshot, held for the day), perp trades = Tardis,
  option trades = Deribit history API, 1-minute candles = Deribit chart data
  (Node only). Runs the tab's own `buildTac()` (pulled out of `collectTac()` for
  this) every 15 min at :07/:22/:37/:52, 04:00–24:00 UTC. Result over 36 days
  (Nov 2023–Oct 2026, 2,880 checks): 6/6 on 6 checks, 2 alerts, both BUY, both
  stopped out (−1R each, best +0.5R / +0.3R first); the video's SELL never fired.
  5/6 on 96 checks; the missing rule was mostly the value-area edge (41) or the
  gamma flip (38). Far too few signals to judge. Offered a 5/6 / "Ready" test,
  a forward log and wider stops: owner declined ("happy how it works now").
- **Net vs total pivots** (asked "backtest my method and the video method"): the
  owner reads big strikes by calls + puts (2,200 has lots of both, so net = calls −
  puts nearly cancels and Tactics ignored it). `cfg.pivotSize` ('net' default =
  video, 'total' = calls + puts) via `nodeSize()` in `model.js`.
  `test/tactics-compare.mjs [months] [cache] [parallel]` runs both on the same
  36 days (loaders shared in `test/bt-data.mjs`). Result (Nov 2023–Oct 2026,
  2,880 checks each; pivots differed on 55% of checks): every retest of a pivot
  net 355 trades, 23% target first, −0.27R avg; total 361, 22%, −0.28R. Retest +
  order-flow trigger: net 319, −0.24R; total 324, −0.24R. 6/6: net 2 (both
  stopped, −2R), total 5 (2 targets, +0.3R; really 3 separate setups). No real
  difference; total gives a BUY pivot on more checks (2,174 vs 1,782). Both lose
  at the retest level: the stop 0.1% past the retest is hit first ~3 times in 4.
- **Owner's own method** (explained Nov 2026): watch a big level (e.g. 2,200);
  price crosses it, makes an extreme (~2,169), turns; enter on confirmation, stop
  at the extreme, target the next big level; both sides. Confirmation = his
  TradingView indicator "Wyichi AI 4.0" (WhaleTrade, protected source: Wyckoff +
  Ichimoku, 0–100 "Global Institution Footprints" oscillator); asked for chart
  screenshots of it to rebuild an approximation. `test/levels-reversal.mjs`
  backtests it: levels = `pickLevels()` from each 1st-of-month chain (held for the
  month, so e.g. Oct 2026 had no 2,200), Deribit 5-min candles for 3 years, Gate
  taker buy/sell only the last ~180 days. Costs 0.1% round trip. Result (Nov 2023
  –Nov 2026): entry on a 15-min close back over the level loses (−0.34R/trade;
  −0.07R if the cross went ≥0.3% past). Entry on a 0.5% bounce off the extreme,
  stop at the extreme: +0.23R/trade over 1,622 trades, +0.24R over 1,072 with
  ≥0.3% depth, positive every year, but only ~13% reach the target (typical
  ~10R), losing runs of 40–80 in a row, and the top 10 wins make most of the
  profit. Order-flow entry: 37–64 trades in 6 months, too few to judge.
  Owner: "I take only levels which are huge" (now 2,000 100%, 2,200 97%, 2,500
  79%, 2,300 72%, 3,000 69% of the biggest by open contracts within ±35%). Mode
  arg `huge60` / `huge70` (`pickHuge()`): worse, −0.17R / −0.29R per trade on the
  bounce entry, only 5–7% reach the target, because the next huge level is far
  (e.g. 2,200 → 2,500). His Oct 30 trade shows why: the mechanical entry bought
  2,203 at 00:30 after a first dip to 2,193 and was stopped when price went on to
  2,169; he waited for the real low. His timing / indicator is the edge.
  His entry: the indicator crossing 80 "like RSI" on the 1-minute chart; "RSI
  won't work, closest is Ichimoku". Tested on 1-min Deribit candles (3 years):
  `ichi` = Ichimoku phase score (20 pts each: close > Tenkan, Tenkan > Kijun,
  above cloud, bullish cloud, lagging close up; buy on cross up through 80, sell
  down through 20), `ichiR` = close within the 26-bar range, `rsi` = RSI(14),
  each first-signal and with up to 3 re-entries after a stop (`-re`). Over 3
  years all lose after costs on every level set (key levels: ichi −0.56R,
  ichi-re −0.20R, ichiR −0.41R, rsi ~0R; huge levels worse, −0.4 to −0.9R),
  only ichi-re on key levels was positive in the last 180 days (+0.34R). The
  Ichimoku score did catch his Oct 30 trade: in at ~2,200 at 02:14, stop 2,170.
  Best mechanical version is still the 0.5% bounce on key levels (+0.23R).
  Same on 5-minute Ichimoku (5th arg `5`): much better than 1-minute, target hit
  ~20% vs ~10%, shorter losing runs (~65 vs ~100); key levels about break-even
  (ichi −0.06R, ichi-re +0.01R, ichiR +0.03R, ichiR-re +0.03R per trade), huge
  levels still negative (−0.06 to −0.56R). On Oct 30 the 5-minute signal skipped
  the fake first dip and bought ~2,213 at 03:10, stop 2,170. Owner said his stop
  is always the lowest / highest price of the move, never from Ichimoku (the
  test already does that: extreme since the cross, up to the entry).
  Owner then: his method is BUY only, huge levels, 2–3 re-entries; he doesn't
  know when to sell, usually looks for a sell after a buy hits its target.
  BUY only, 5-min Ichimoku, ≤2 re-entries: huge60 −0.13R/trade (score) / −0.22R
  (range), huge70 −0.30R, key levels ±0.00R. Sells (his method mirrored: spike
  over a level, Ichimoku down through 20, stop at the spike high, target the
  next level down) in general ~0 (key +0.01/+0.10R, huge60 +0.02/+0.08R, huge70
  −0.5R); only at the level a buy just hit (within 48 h, no look-ahead): key
  +0.46/+0.51R (271/266 trades, 26–29% hit), huge60 +0.35/+0.50R (171/162), but
  not every year (key 2025 −0.25R, huge60 2026 −1.1R on ~10 trades) and the top
  10 wins carry all of it. Promising, not proven.
  Correction from the owner: no re-entries at the same level; "I re-enter on the
  next level, once per level". `test/levels-once.py <cache>` scores that from the
  saved crosses (a level is traded once, re-armed only after the trade ends and
  price crosses another level). First result that is positive: BUY, huge70, 5-min
  Ichimoku score +0.47R/trade (43 trades in 3 years, 26% hit, worst losing run
  8; 2024 +0.81, 2025 +0.86, 2026 +0.09), range +0.41R; 1-min score +0.53R,
  range +0.75R (but 2025 negative); huge60 +0.15 to +0.28R; key levels −0.14 to
  +0.09R. Few trades (~15 a year) and the top 10 wins carry the total. SELL after
  a buy hit its target, once per level: huge levels only 6–15 trades, mostly
  negative; key levels +0.18 to +0.98R on 25–31 trades. Too few to trust yet.
- "Check all alerts on ntfy" (2 Nov 2026): can't read his topic (secret), so: all
  runs succeed, cron is every 15 min but GitHub ran it every 4–6 h; state shows every
  alert on and every welcome sent; `test_alerts: all` sends zone, dealers, Market Maker
  strategy (3), Tactics (3), Alt (3).
  Owner then: "I didn't receive anything". `test_alerts: check` (`jobs/ntfy-check.mjs`,
  own workflow step): topic secret clean (26 chars, no stray spaces), ntfy.sh held
  every message (all tests since 14:35 UK, plus a plain "ntfy check"), and two
  untitled prio-3 messages at 15:11 UK that the job did not send (maybe him testing
  from the app). So delivery to ntfy works; the problem is on the phone (app
  subscription name / server, notifications, battery, instant delivery).
  Topic in his app was right, but the app received nothing (CPU 0s, Xiaomi). Fixed by
  uninstall + reinstall, allow notifications, subscribe with **Instant delivery**
  ticked, battery "No restrictions". If alerts stop again, start there. A quick
  "ntfy check" can be posted straight to the topic from a session (don't put the
  topic in the repo).
- Owner on alert timing: 15 minutes late is fine, sometimes an hour is understood.
  Don't push the outside cron trigger again.
- Phone alert "Tactics 6/6 BUY / SELL" (asked for later): `jobs/monitor.mjs` runs
  `collectTac()`, whose `decision` (= `decide(setup)`) is also what the tab's card
  shows, so they always agree. `sixOfSix()` in `model.js` rings only on the step
  from ≤5 to 6 (or a straight flip from 6/6 one side to the other) and re-arms
  below 6; last `{ met, action }` in `state.json` (`tactics`). ETH only
  (`alertAssets` in `tools/tactics/config.js`). Rings 3 times. A one-time test push in
  the same format (`welcomedTac`) confirmed the setup; `welcomedTac: 2` = the
  later BUY + SELL test pair.

## Alt Tactics tab

Asked for after the backtests ("keep video rules as they are and create an
additional tab, alt tactics"). `tools/alt-tactics/`, short name "Alt" on phones.
The owner's own method, built from the version that tested best
(`test/levels-reversal.mjs` + `test/levels-once.py`, huge70, 5-minute Ichimoku):
- Levels: `pickHuge()` = strikes with ≥70% of the biggest open contracts (calls
  + puts, expiring after 2 days) within ±35%, ≥0.5% apart (Deribit chain).
- Setup (`findSetups()`): price was above a level and a 15-minute candle trades
  below it; the low since then is the stop; >3% past = broken; 48 h to confirm.
- Signal: the 5-minute Ichimoku score (`ichimoku()`, 20 points each: close >
  Tenkan, Tenkan > Kijun, above cloud, bullish cloud, lagging close up) crosses
  up through 80 — stand-in for his protected "Wyichi AI" indicator. Entry at
  that close; target the biggest huge level up (see "Target rule" below).
- Once per level (`oncePerLevel()`): a traded level is skipped until the trade
  ends and price crosses another level (either side).
- **Sells** (owner, new conversation 1 Nov 2026: "I look for sells only after
  successful buy and vice versa"): a SELL is only taken at the level a buy just
  reached as its target, with the spike over it starting within 48 h
  (`afterWinHours`; the same 15-minute candle as the target hit counts). Mirror
  mechanics: spike up through the level, the high is the stop (>3% over =
  broken), 5-min score down through 20 (`scoreSell`), target the next huge level
  down. Other spikes are marked `noWin` and ignored. "Vice versa": when a sell
  reaches its target, that level is open for a buy again at once. Buys need
  nothing first. `decideAlt()` adds `sellReady` (a buy's target hit, no sell
  watched yet: card and level table say "a spike over it is a sell until …").
  Cards say "Why a sell here" and "Unproven: 6 in the 3-year backtest, 0
  reached target" (the exact rule in `test/levels-once.py`, huge70 5-min).
  `cfg.sides` can switch a side off. An earlier mirror version (sells at any
  spike) was rejected: "Nope, you got it wrong".
- Card: BUY (signal ≤ 1 h old), OPEN (older trade still running, says buying
  late means a wider stop), WATCH (dipped, waiting for 80), WAIT (nearest huge
  levels). Then the Ichimoku checklist, the huge levels with their status, a
  chart (since the dip / spike when one is live, with the stop), and the backtest card
  (see the latest numbers below). Size uses the Playbook account.
- 5-minute candles in the browser from **Bitstamp ETH/USD** (`collect.js`, one
  request, 1,000 ≈ 3.5 days, CORS ok), Gate futures as backup. Switched 2 Nov 2026
  when he asked "2173?": his TradingView ETH/USD showed the Oct 30 low at 2,169.92;
  Bitstamp 2,170.0, Coinbase 2,170.03, Deribit 2,170.0, Gate futures 2,173.4, OKX
  USDT-swap 2,171.5. The stop box says which source was used.
  He then said "Dip is on 2169": no fetchable exchange has 2,169.92 (Bitfinex
  2,175.9, Gemini 2,171, Crypto.com 2,171.66, Binance.US 2,171.41, Bitstamp 1-min
  2,170.0); his chart's ETH/USD is most likely TradingView's own blended index. Backtests still use
  Deribit 5-min (same lows as Bitstamp here). Only setups inside the 3.5 days are
  known, so once-per-level starts fresh each load.
- After a stop (owner, 1 Nov 2026: "if price hit my SL during this buy we only re
  enter by all our rules in next gamma level"): that is the once-per-level rule.
  `oncePerLevel()` leaves `setups.locked`; `decideAlt()` gives `stopped` and
  `nextBuy` (nearest level under the price still open). WAIT card then says "The
  buy at ~2,200 was stopped ... used until price crosses another huge level" and
  points at `nextBuy`; levels table says "Bought, stopped: used until ...". v=40.
- Tweak grid (asked "how about if change and tweak a rule a bit", 1 Nov 2026):
  `GRID=1 node test/alt-backtest.mjs 36 .bt-cache`, one change at a time, buys
  only, first 2 years vs last year (unseen). Base 43 buys +0.74R (first 2y +1.14R,
  last year −0.31R). Stop 0.5% under the low +1.03R (last year +0.10R, without
  best 2 ≈ 0R); dip ≤2% deep +1.01R (last year +0.32R); half at next level +0.28R;
  Ichimoku 70 = same as 80, 60 −0.49R, 90 +0.07R; wait 24/72 h no change.
  `cfg.stopBufferPct` exists (default 0). Owner then said "stop, don't modify
  anything yet" and asked about Fibonacci: wait for his rule before changing the tab.
- **Fibonacci 0.62 entry** (1 Nov 2026, screen recording): after the cross of a huge
  level and a "noticeable reverse" (2,169 on Oct 30), he draws the fib with 1 = the
  low, 0 = the top of the bounce, entry at the grey 0.62 line (~2,203); asked for
  the stop he said "at 62 where is still grey" (read as: entry 0.62, stop at the
  low; the blue 0.79 is not used). `test/alt-fib.mjs` (LIST=ichi|bounce1), results
  in `test/results/alt-fib-2026-11-01.txt`. Same footing as the tab (biggest target,
  once per level, crosses up count for re-arming): tab entry 43 buys +0.74R; fib
  0.62 after Ichimoku 80: 41, 10% hit, −0.15R (last year +1.10R on 11); after a 1%
  bounce: 44, 9%, +0.13R, worst run 27. The fib entry misses the big runners (July
  2025 never pulled back to 0.62) and pullbacks that reach 0.62 mostly go on to the
  low. Oct 30: 0.62 ~2,203 never filled after the real low. Tab not changed.
  Then "instead of Ichimoku ... SL 2169 ... at least 4 candles 15 minutes
  reversal": `up4` (4 rising 15-min closes after the low) 42 buys, 7% hit,
  −0.47R; `hold4` (low holds 4 candles) 45, 7%, −0.58R (bought Oct 30's fake first
  dip ~2,204, stopped). Both worse than the tab's Ichimoku entry (+0.74R).
  Owner's decision: **"keep ichimoku entry"**. Don't re-offer the fib entry.
  Asked "so the 4 candle rule is not working?": also tested buying at once after
  the 4 candles (no fib): `up4now` 46 buys, 11% hit, −0.58R; `hold4now` 47, 9%,
  −0.66R. up4now caught Oct 30's real low (in ~2,233, like the tab).
  Then "4 candle rule then we apply Fibonacci and then wait for entry" = what up4 /
  hold4 test (fib 0 moving up with new highs). Also with the fib drawn once at the
  4th candle (`up4fix` / `hold4fix`): 41 / 44 buys, 5% hit, −0.53R / −0.64R, worst
  run 36–37. Every 4-candle version loses; Ichimoku entry stays.
  Then "how many candles is optimal for applying Fibonacci": `GRIDN=1 node
  test/alt-fib.mjs`, results `test/results/alt-fib-candles-2026-11-01.txt`. 1–6
  rising candles: −0.70 to −0.22R (best 3); low holds 1–12 candles: −0.73 to −0.16R
  (5+ all about −0.2R). Every count loses over 3 years and in the first 2 years;
  the last year is +0.9 to +1.1R for some, from the two July 2026 trades.
  Then "try 79" (`FIB=0.79`), results `test/results/alt-fib79-2026-11-01.txt`:
  0.79 after a 1% bounce 42 buys, 10% hit, +0.88R (first 2y +1.04R, last year
  +0.43R), better than the tab on paper, but only 4 wins and one (+49R, 9 Jul 2025,
  2,603 → 3,200) is more than the whole profit: without it −0.30R/buy (the tab
  without its best: −0.07R). Other 0.79 versions lose (after Ichimoku −0.72R, after
  4 candles −0.64 to −0.79R, 6 rising candles +0.32R on 23).
  Then "and 0.705" (`FIB=0.705`, `test/results/alt-fib705-2026-11-01.txt`): after
  a 1% bounce 43 buys, 9% hit, +0.50R (first 2y +0.11R, last year +1.49R), 4 wins,
  the 9 Jul 2025 trade +35R (without it −0.32R/buy); all other 0.705 versions lose
  (−0.11 to −1.04R). By level, after a 1% bounce: 0.62 +0.13R, 0.705 +0.50R,
  0.79 +0.88R; the tab's Ichimoku entry +0.74R.
- "So what's the best version": `test/results/alt-best-2026-11-01.txt`. Tab's
  Ichimoku entry + stop 0.5% under the low + skip dips deeper than 2%: 41 buys, 22%
  hit, +1.20R (first 2y +1.46R, last year +0.58R), the only version still positive
  without its best 2 trades (+0.11R). Stop room is jumpy (0.2% +0.50R, 0.3% +1.36R,
  0.5% +1.03R, 0.7% +0.80R, 1% +0.63R): read as "some room helps", not an exact
  number. Recommended to him; not applied (he said don't change until he says).
  Finer steps: 0.25% +0.52R, then a jump at 0.3% (+1.36R; 2 more trades reach
  target), then smoothly down (0.35% +1.26, 0.4% +1.18, 0.5% +1.03, 0.6% +0.91R).
  0.3% sits on the edge of that jump, so 0.4–0.5% suggested for a safety margin.
  With dips ≤2%: 0.3% +1.55R, 0.4% +1.36R, 0.5% +1.20R.
  **Owner: "Ok let's do it 0.4%"** → live (v=41): `stopBufferPct: 0.4`, `maxDepthPct:
  2` (was 3; part of the suggested version). Stop 0.4% under the low (sells: over
  the high). Card: 40 buys, 23% hit, +1.42R, worst run 16, 2024 −1.05R / 2025
  +4.48R / 2026 +1.01R, catch box (two July 2025 trades +26R / +23R; the other 38
  +0.2R; the old stop-at-the-low rule +0.78R), sells 4, none hit. `test/alt.mjs`
  checks 1–10 run with the old mechanics (buffer 0, 3%), check 11 the live ones.
- Stop loss as a number (asked "show the number on stop loss, I wanna see where
  I should set my SL, not just stop line", v=42): `stopBox()` in `view.js`, a red
  "Your stop loss" box with the price in Dela at the top of BUY / OPEN / SELL
  cards (0.4% under the low N · X points (Y%) under the entry), and "Stop loss so
  far" on WATCH (moves with the low). Chart line labelled "SL 2,164.7" (or "so
  far"). Note under the box: prices are Gate's, his exchange can differ a little.
  Owner on that: "it may be small difference but that's ok, I accept"; no need
  to match his exchange's prices.
- **2 Nov 2026: stop back at the low.** Owner: "set our SL as normal, not +0.4%,
  just set at SL +0%". `stopBufferPct: 0` (v=43); dips up to 2% kept (he only
  asked about the stop). Card: 40 buys, 18% hit, +1.07R, worst run 16, 2024 −1.07R
  / 2025 +3.61R / 2026 +0.64R, two July 2025 trades +35R / +19R made all of it
  (the other 38 −0.3R), "with 0.4% under it was +1.42R". `slWhere()` words the
  stop as "at the low" when the buffer is 0. Don't re-suggest the buffer unasked.
- **2 Nov 2026: 2 points past the low/high.** Owner: "add like two points to every
  stop, e.g. 2170 → 2168". `stopPoints: { ETH: 2, BTC: 60 }` in config (BTC = same
  share of price); `withPoints(cfg, asset)` in `collect.js` sets `cfg.points`;
  `stopFrom(ext, buy, cfg)` in `model.js` = low − points (sells: high + points),
  used by the model and the view. Box reads "2 points under the low 2,170.0" →
  2,168.0. Results card still says "stop at the low" (its numbers were measured
  that way; no backtest rerun, he doesn't want them). v=45.
- Ichimoku settings (asked "adjust how many candles is optimal for applying
  ichimoku"): `GRID=ichi node test/alt-backtest.mjs 36 .bt-cache`, results in
  `test/results/alt-ichimoku-2026-11-01.txt`. `ichimoku(c, p)` takes look-back
  lengths and `cfg.ichSeries` swaps the series (backtests only; tab unchanged).
  5-min 9/26/52 (tab) +0.74R is best; 10-min +0.23R, 15-min −0.01R, 30-min −0.03R,
  1-hour −0.38R; 5-min 6/18/36 +0.50R, 12/36/72 +0.31R, 18/52/104 +0.29R,
  20/60/120 +0.33R. None better in the last year (all −0.39 to +0.01R).
- `node test/alt.mjs` is offline and must pass.
- **Target rule, asked 1 Nov 2026:** "I wouldn't aim 2300 ... most likely 2500",
  "huge biggest level above, 100 points is too small". `pickTarget()` in
  `model.js`, `cfg.target` 'next' (live) / 'biggest', `cfg.minTargetPct`. Owner
  asked to test first: `node test/alt-backtest.mjs 36 .bt-cache` runs the tab's own
  `findSetups` + `oncePerLevel` (Tardis 1st-of-month chains, Deribit 5-min), `LIST=next|biggest`
  prints every trade; results in `test/results/alt-backtest-2026-11-01.txt`.
  Buys: next 41 trades, 22% hit, +0.24R (the tab's own code; the card's 43 / 26% /
  +0.47R came from the older test script), biggest 42, 14% hit, +0.78R, but 2024
  all 11 lost, worst run 18, and two July 2025 trades (+19R, +35R) are the whole
  profit (without them −0.53R/trade). ≥3% / ≥5% / ≥8% minimum changed little.
  Sells after a winning buy: 7 (next) / 3 (biggest), all lost. Shown to him as an
  artifact page (https://claude.ai/artifact/VZhutbD1Hsgz8oj26Vs6o7, ranking first).
  He said **"yes switch to biggest level"**: `target: 'biggest'` in config; collect
  passes the levels with their open contracts; the backtest card shows 42 / 14% /
  +0.78R / worst run 18 and a "catch" box (two July 2025 trades made all of it).
- **Phone alert for Alt Tactics** (2 Nov 2026, he asked: "add to that NTFY alert,
  which is gonna notify and inform me about our rules"; earlier he had said only
  zone, dealers and Tactics 6/6, so it was never offered again). `jobs/monitor.mjs`
  runs `collectAlt()` for `alertAssets: ['ETH']`; `altEvents()` in `model.js` turns
  the setups into events, each pushed once (`state.alt.ETH.sent`, pruned after 10
  days; `since` = first run, so nothing older is pushed; events older than 24 h are
  skipped). BUY / SELL: priority 4, rings 3 times (`ALT_REPEATS`), entry, stop loss
  (number + "2 points under the low N"), target, R; says "entered late" if the job
  ran >30 min after the signal. WATCH (dip / spike waiting for the signal): once,
  priority 3, low so far + stop so far. Target hit (prio 4) / stopped (prio 3):
  once; after a buy target it reminds the sell rule, after a stop it names the next
  level. `altMessage()` in the job. One-time "Alt Tactics alerts are on" message
  (`welcomedAlt`). Workflow test choice `alt` sends the last signal as [test]; if
  none in the ~3.5 days, a sample (`altSample()`: 1% dip through the nearest huge level
  below, today's levels and target), added 2 Nov 2026 when "check all alerts" showed
  the Alt test sent nothing.
- Seven tabs: phone tab padding tightened (4px, 3px under 380px) so all fit.

## Where we stopped (handover, 2 Nov 2026 evening)

Owner: "for now done, we continue tomorrow". Everything below is live and published
(fragility v=53, gamma-detrite main); nothing half-built. Ask what he wants next.
- Gamma Detrite: expiry tabs All (first, opens on it) · Daily · Weekly · Monthly, the
  last three mixable; his separate **daily approach** (blue zone touch + 5-min Tenkan /
  Kijun cross, stop at the touch low / high, GodMode 15-min dot as TP; tested about
  break-even, best stop 0.5% past the touch) is only written down, nothing built.
- Tabs: Gamma, Score, Flow, Dealers, Plan, Alt, **Trend** (new, 50-day average, long only);
  Tactics removed.
- Phone alerts: only Market Maker strategy, Alt Tactics, Trend (ETH).
- Outside strategies tested (trend / funding carry / option selling): trend held up.

## Earlier handover (1 Nov 2026, end of a long session)

The owner closed this conversation to start a new one. Pick up from here:

- **State (2 Nov 2026), all live, v=50 (Market Maker strategy card + phone alert added):** Alt
  Tactics = 5-min Ichimoku entry (he chose it over every Fibonacci / 4-candle
  version), target the biggest huge level, stop at the low (0.4% room removed
  2 Nov at his request), dips up to 2%,
  sells only after a winning buy, once per level (after a stop: next level only),
  stop loss shown as a number (box + chart label). Owner: "for now done, we gonna
  work tomorrow more". Nothing open or half-built; ask what he wants next.
- Results page for him: https://claude.ai/artifact/VZhutbD1Hsgz8oj26Vs6o7 (target
  test; made before the 0.4% stop, so its numbers are the older stop-at-the-low ones).
- **His indicator:** "Wyichi AI 4.0" (TradingView, WhaleTrade, protected).
  Enters when it crosses 80 on the 1-minute chart; says RSI won't work, closest
  is Ichimoku. Asked for screenshots of it on his chart (Oct 30 dip, settings,
  timeframe); none sent yet.
- **Alert job timing:** GitHub ran the scheduled monitor only every 3–7 hours
  (not every 15 min) on 31 Oct–1 Nov; told him, he said no need to explain.
  Outside cron trigger stays declined.
- **Figma:** connected this session. File "Fragility site: styles"
  https://www.figma.com/design/xskq1HEJA6i5Xr8yC5NSZd — all three colour styles,
  style guide + Score / Flow / Plan / Tactics screens (captured before the later
  layout changes: short titles, Details folding, Alt tab). His seat is View on a
  starter plan.
- Backtest data cache lives outside the repo; `.bt-cache/` is git-ignored. The
  1-minute candles for 3 years take ~365 requests to download again.
- **Session summary** (all published and noted above): new look (teal/lime,
  Dela Gothic titles, style switcher Teal / Fire / Moonlight, motion), short
  phone tab names, short headline titles, folded Details, import-map version fix
  for blank tabs, Tactics watching BUY and SELL sides at once, net vs total
  pivot backtest (no difference), the owner's level method backtests, and the
  Alt Tactics tab.
