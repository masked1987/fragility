# Run: python3 test/levels-once.py <cacheDir>
# Scores the owner's "once per level" rule on the output of test/levels-reversal.mjs
# (levels-reversal-<mode>[-5m].json): every cross in time order; a level is traded at
# most once, and only becomes tradable again after that trade has ended AND price has
# crossed a different level ("I re-enter on the next level, once per level").
# BUY = his method. SELL = only at the level a buy just hit its target (within 48 h).
# Entry = the first Ichimoku signal after the cross (score or range), stop at the
# extreme of the move, target the next level; 0.1% round-trip costs.
import json, sys, os, datetime as dt

CACHE = sys.argv[1] if len(sys.argv) > 1 else '.bt-cache'
FEE = 0.001


def net(t):
    return t['out']['R'] - FEE * t['entry'] / abs(t['entry'] - t['stop'])


def end_time(t):
    return t['out'].get('at') or (t['T'] + (t['out']['mins'] or 7 * 1440) * 6e4)


def once_per_level(crosses, by_key, sides):
    armed, exit_at, taken = {}, {}, []
    for c in sorted(crosses, key=lambda c: c['t0']):
        L = c['level']
        for other in list(exit_at):
            if other != L and exit_at[other] < c['t0']:
                armed[other] = True
                del exit_at[other]
        if not armed.get(L, True) or c['side'] not in sides:
            continue
        t = by_key.get((L, c['side'], c['t0']))
        if t and sides[c['side']](t, taken):
            taken.append(t)
            armed[L] = False
            exit_at[L] = end_time(t)
    return taken


def stats(L):
    n = len(L)
    if not n:
        return '   0 trades'
    R = sum(net(t) for t in L)
    hit = sum(t['out']['result'] == 'target' for t in L)
    run = worst = 0
    for t in sorted(L, key=lambda t: t['T']):
        run = run + 1 if net(t) < 0 else 0
        worst = max(worst, run)
    yrs = {}
    for t in L:
        yrs.setdefault(dt.datetime.fromtimestamp(t['T'] / 1000, dt.timezone.utc).year, []).append(net(t))
    top = sum(sorted((net(t) for t in L), reverse=True)[:10])
    ys = '  '.join(f"{y}: {len(v)} {sum(v) / len(v):+.2f}R" for y, v in sorted(yrs.items()))
    return (f"{n:4} trades  {hit / n * 100:3.0f}% hit target  {R / n:+.2f}R/trade  total {R:+5.0f}R  "
            f"worst losing run {worst:3}  top-10 {top:+.0f}R\n{'':48}by year  {ys}")


for mode in ['huge60', 'huge70', 'key']:
    for tf, suffix in [('5-min', '-5m'), ('1-min', '-1m')]:
        path = os.path.join(CACHE, f'levels-reversal-{mode}{suffix}.json')
        if not os.path.exists(path):
            continue
        d = json.load(open(path))
        if 'crosses' not in d:
            print(mode, tf, 'no crosses saved (rerun levels-reversal.mjs)')
            continue
        print(f'\n== {mode} levels, Ichimoku on {tf}, once per level')
        for kind, name in [('ichi', 'score'), ('ichiR', 'range')]:
            first = [t for t in d['trades'] if t['how'] == kind]
            by_key = {(t['level'], t['side'], t['t0']): t for t in first}
            buys = once_per_level(d['crosses'], by_key, {'buy': lambda t, taken: True})

            def after_win(t, taken, buys=buys):
                return any(b['out']['result'] == 'target' and abs(b['target'] - t['level']) < 1
                           and 0 <= t['t0'] - end_time(b) <= 48 * 36e5 for b in buys)
            sells = once_per_level(d['crosses'], by_key, {'sell': after_win})
            print(f"  {name:6} BUY                         {stats(buys)}")
            print(f"  {name:6} SELL after a buy hit target  {stats(sells)}")
            both = buys + sells
            print(f"  {name:6} BUY + those SELLs           {stats(both)}")
