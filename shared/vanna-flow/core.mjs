// ETH flow calculation, synchronized with the private Crypto Gamma dashboard on 2026-11-06.
// All expiries. Public options data; dealer ownership is an explicit assumption.
// Keep the parity test against the dashboard when changing these research rules.
const DAY=864e5, YEAR=365*DAY, PHI=Math.sqrt(2*Math.PI);
function finite(x){return typeof x==='number'&&Number.isFinite(x)}
  function cdf(x) {
    var z = Math.abs(x), t = 1 / (1 + 0.2316419 * z);
    var p = Math.exp(-z * z / 2) / PHI * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x >= 0 ? 1 - p : p;
  }
  function valid(o, spot, now) {
    return [spot, o.strike, o.oi, o.iv, o.forward].every(function (x) { return Number.isFinite(x) && x > 0; }) &&
      Number.isFinite(o.expiry) && o.expiry > now && (o.sign === 1 || o.sign === -1);
  }
  function greeks(o, spot, now) {
    if (!valid(o, spot, now)) return null;
    var T = (o.expiry - now) / YEAR, v = o.iv * Math.sqrt(T), r = Math.log(o.forward / spot) / T;
    var d1 = (Math.log(o.forward / o.strike) + v * v / 2) / v, d2 = d1 - v;
    var density = Math.exp(-d1 * d1 / 2) / PHI;
    // Vanna per +1 percentage point of IV; Charm per one calendar day elapsed.
    var vanna = -density * d2 / o.iv * 0.01;
    var charm = density * (d2 / (2 * T) - r / v) / 365;
    var delta = cdf(d1) - (o.sign === -1 ? 1 : 0);
    return { vanna: vanna, charm: charm, delta: delta, rate: r, T: T };
  }
  function prepare(book, expiries) {
    if (!book || !Array.isArray(book.options)) return null;
    var dates = new Set(expiries), records = [], excluded = 0;
    book.options.forEach(function (o) {
      if (!dates.has(o.expiry)) return;
      var g = greeks(o, book.spot, book.now);
      if (!g) { excluded++; return; }
      var scale = o.sign * o.oi * book.spot;
      records.push({ option: o, g: g, vanna: g.vanna * scale, charm: g.charm * scale });
    });
    if (!records.length) return null;
    var total = { vanna: 0, charm: 0, grossVanna: 0, grossCharm: 0, oi: 0 }, strikes = new Map(), expiryRows = new Map();
    records.forEach(function (r) {
      total.vanna += r.vanna; total.charm += r.charm;
      total.grossVanna += Math.abs(r.vanna); total.grossCharm += Math.abs(r.charm); total.oi += r.option.oi;
      [[strikes, r.option.strike], [expiryRows, r.option.expiry]].forEach(function (pair) {
        if (!pair[0].has(pair[1])) pair[0].set(pair[1], { key: pair[1], vanna: 0, charm: 0, oi: 0, count: 0 });
        var row = pair[0].get(pair[1]); row.vanna += r.vanna; row.charm += r.charm; row.oi += r.option.oi; row.count++;
      });
    });
    return { spot: book.spot, now: book.now, records: records, total: total, excluded: excluded,
      strikes: Array.from(strikes.values()).sort(function (a, b) { return a.key - b.key; }),
      expiries: Array.from(expiryRows.values()).sort(function (a, b) { return a.key - b.key; }) };
  }
var venues=['Binance','Bybit','Bitget','Gate','Deribit'],TTL=10*6e4;
function fresh(at,now){return finite(at)&&now-at>=-6e4&&now-at<=TTL}
function feedUrls(asset){return [
 'https://fapi.binance.com/fapi/v1/ticker/24hr?symbol='+asset+'USDT',
 'https://api.bybit.com/v5/market/tickers?category=linear&symbol='+asset+'USDT',
 'https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol='+asset+'USDT',
 'https://api.gateio.ws/api/v4/futures/usdt/tickers?contract='+asset+'_USDT',
 'https://www.deribit.com/api/v2/public/ticker?instrument_name='+asset+'-PERPETUAL'];}
// Quote turnover only: never contract count, base-coin volume or volume × last price.
function volumeRecord(venue,j,asset,now){
 if(!j||!['ETH','BTC'].includes(asset))return null;
 var r,amount,at,symbol,expected=asset+'USDT',clock='exchange',unit='USDT';
 if(venue==='Binance'){r=j;amount=r.quoteVolume;at=r.closeTime;symbol=r.symbol}
 else if(venue==='Bybit'){r=j.retCode===0&&j.result&&Array.isArray(j.result.list)&&j.result.list.length===1&&j.result.list[0];if(!r)return null;amount=r.turnover24h;at=j.time;symbol=r.symbol}
 else if(venue==='Bitget'){r=j.code==='00000'&&Array.isArray(j.data)&&j.data.length===1&&j.data[0];if(!r)return null;amount=r.usdtVolume;at=r.ts;symbol=r.symbol}
 else if(venue==='Gate'){r=Array.isArray(j)&&j.length===1&&j[0];if(!r)return null;amount=r.volume_24h_quote;at=now;symbol=r.contract;expected=asset+'_USDT';clock='retrieved'}
 else if(venue==='Deribit'){r=!j.error&&j.result;if(!r||r.state!=='open')return null;amount=r.stats&&r.stats.volume_usd;at=r.timestamp;symbol=r.instrument_name;expected=asset+'-PERPETUAL';unit='USD'}
 else return null;
 amount=typeof amount==='string'||typeof amount==='number'?Number(amount):NaN;at=Number(at);
 return symbol===expected&&finite(amount)&&amount>0&&fresh(at,now)?{venue:venue,asset:asset,amount:amount,at:at,receivedAt:now,clock:clock,unit:unit}:null;
}
function volumeSelection(ctx,now){
 var records=ctx&&ctx.records||{},health=ctx&&ctx.health||{};
 var available=venues.map(function(v){return records[v]}).filter(function(r){return r&&r.asset===ctx.asset&&finite(r.amount)&&r.amount>0&&fresh(r.at,now)&&fresh(r.receivedAt,now)});
 // Prefer successful current responses over retained values; preserve exchange priority within each group.
 available.sort(function(a,b){return Number(!!health[a.venue])-Number(!!health[b.venue])||venues.indexOf(a.venue)-venues.indexOf(b.venue)});
 var used=available.slice(0,2),total=used.reduce(function(s,r){return s+r.amount},0),complete=used.length===2;
 return {used:used,total:used.length?total:null,volume:complete?total:null,complete:complete,fallback:complete&&!(used.some(function(r){return r.venue==='Binance'})&&used.some(function(r){return r.venue==='Bybit'})),retained:used.some(function(r){return !!health[r.venue]})};
}
function validVolume(ctx,now){return volumeSelection(ctx,now).volume}
function bias(vanna,charm,volume,netGamma,stale){
 var threshold=volume>0?volume*.0001:null; // explicit provisional neutral band: 0.01% of turnover
 var rows=[-3,0,3].map(function(iv){var v=-vanna*iv,c=-charm,total=v+c,gross=Math.abs(v)+Math.abs(c);var cancel=gross>0&&Math.abs(total)<=.1*gross;
  var tiny=Math.abs(total)<1||(threshold!==null&&Math.abs(total)<threshold);
  return {iv:iv,vanna:v,charm:c,total:total,label:tiny||cancel?'Neutral':total>0?'Bullish':'Bearish',cancel:cancel};});
 var robust=rows.every(function(r){return r.label===rows[1].label}),pct=volume>0?Math.abs(rows[1].total)/volume*100:null;
 var base=pct===null?null:pct<.1?0:pct<=.3?1:2;
 var adjusted=base===null?null:Math.min(2,base+(netGamma<0&&rows[1].label!=='Neutral'&&robust?1:0));
 return {rows:rows,robust:robust,label:stale?'Unavailable':!robust?'Neutral':volume===null?'Unavailable':rows[1].label,threshold:threshold,pct:pct,base:base,adjusted:adjusted};
}
const MON="JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" "),NAME=/^ETH-(\d{1,2})([A-Z]{3})(\d{2})-([\d.d]+)-([CP])$/;
  function gam(F,K,sg,T){
    var d1=(Math.log(F/K)+0.5*sg*sg*T)/(sg*Math.sqrt(T));
    return Math.exp(-0.5*d1*d1)/Math.sqrt(2*Math.PI)/(F*sg*Math.sqrt(T));
  }
  function parse(rows,spot,now){
    var cell={},eset={},po={},co={},options=[];
    rows.forEach(function(s){
      var p=NAME.exec(s.instrument_name||""),mo=p?MON.indexOf(p[2]):-1;
      if(mo<0)return;
      var e=Date.UTC(2000+ +p[3],mo,+p[1],8),K=parseFloat(p[4].replace("d",".")),
          oi=s.open_interest||0,iv=(s.mark_iv||0)/100,F=s.underlying_price||spot,T=(e-now)/(365*864e5);
      if(![spot,K,oi,iv,F,T].every(function(v){return Number.isFinite(v)&&v>0}))return;
      var g=gam(F,K,iv,T)*oi*spot*spot*0.01;
      if(!Number.isFinite(g))return;
      options.push({expiry:e,strike:K,oi:oi,iv:iv,forward:F,sign:p[5]==="C"?1:-1});
      if(p[5]==="C")co[e]=(co[e]||0)+oi;else{po[e]=(po[e]||0)+oi;g=-g}
      cell[K+"|"+e]=(cell[K+"|"+e]||0)+g;eset[e]=1;
    });
    return {spot:spot,now:now,cell:cell,po:po,co:co,options:options,summaries:{},exps:Object.keys(eset).map(Number).sort(function(a,b){return a-b})};
  }

export {venues, fresh, feedUrls, volumeRecord, volumeSelection, bias, greeks, prepare, parse};
