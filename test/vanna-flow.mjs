import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {bias,parse,prepare,volumeRecord,volumeSelection} from '../shared/vanna-flow/core.mjs';
import {advance,collectReading,notification,publish} from '../jobs/vanna-flow.mjs';
const now=Date.UTC(2026,10,6,19,30);
assert.deepEqual(bias(6.33e6,-10.63e6,10e9,-1,false).rows.map(r=>Math.round(r.total/10000)/100),[29.62,10.63,-8.36]);
assert.equal(bias(6.33e6,-10.63e6,10e9,-1,false).label,'Neutral');
const rows=[{instrument_name:'ETH-27NOV26-2200-C',open_interest:1000,mark_iv:50,underlying_price:2240},{instrument_name:'ETH-27NOV26-2400-P',open_interest:600,mark_iv:54,underlying_price:2240}];
const payloads={
 index:{result:{index_price:2230},usOut:now*1000},chain:{result:rows,usOut:now*1000},
 bitget:{code:'00000',data:[{symbol:'ETHUSDT',usdtVolume:'4000000000',ts:String(now)}]},
 gate:[{contract:'ETH_USDT',volume_24h_quote:'6000000000',volume_24h:'999999999'}],
 deribit:{result:{instrument_name:'ETH-PERPETUAL',state:'open',timestamp:now,stats:{volume_usd:1000000000}}}
};
let failChain=false,failVolume=false;
const fetcher=async url=>{
 if(url.includes('binance')||url.includes('bybit'))throw Error('blocked');
 let value=url.includes('get_index_price')?payloads.index:url.includes('get_book_summary')?payloads.chain:url.includes('bitget')?payloads.bitget:url.includes('gateio')?payloads.gate:payloads.deribit;
 if(failChain&&value===payloads.chain)throw Error('chain unavailable');
 if(failVolume&&value===payloads.gate)throw Error('gate unavailable');
 if(failVolume&&value===payloads.deribit)throw Error('deribit unavailable');
 return {ok:true,json:async()=>value};
};
const reading=await collectReading(fetcher,()=>now);assert.ok(reading);assert.deepEqual(reading.sources,['Bitget','Gate']);assert.equal(reading.turnover,10e9);assert.equal(reading.series,2);assert.equal(reading.expiryCount,1);
failChain=true;assert.equal(await collectReading(fetcher,()=>now),null);failChain=false;
failVolume=true;assert.equal(await collectReading(fetcher,()=>now),null);failVolume=false;
payloads.chain.usOut=(now-601000)*1000;assert.equal(await collectReading(fetcher,()=>now),null);payloads.chain.usOut=now*1000;
// The alert only follows the main label: unchanged numbers/strength/venue do not ring.
let sent=[];const send=async m=>{sent.push(m);return {id:'ack-'+sent.length}};
const at=(n,label,extra={})=>({...reading,observedAt:now+n,snapshotAt:now+n,label,...extra});
let next=await advance(null,at(0,'Neutral'),send,now);assert.equal(next.action,'baseline');assert.equal(sent.length,0);
next=await advance(next.state,at(1000,'Neutral',{pct:4,strength:'Strong'}),send,now+1000);assert.equal(sent.length,0);
let prior=next.state;
next=await advance(prior,at(2000,'Bullish'),send,now+2000);assert.equal(next.action,'notified');assert.equal(sent.length,1);assert.match(sent[0].title,/Neutral -> Bullish/);
next=await advance(next.state,at(3000,'Bullish'),send,now+3000);assert.equal(sent.length,1);
for(const [i,label] of ['Bearish','Neutral','Bullish'].entries()){next=await advance(next.state,at(4000+i*1000,label),send,now+4000+i*1000);assert.equal(next.action,'notified');}
assert.equal(sent.length,4);
prior=next.state;next=await advance(prior,null,send,now+7000);assert.equal(next.state,prior);assert.equal(sent.length,4);
next=await advance(prior,at(7000,'Unavailable'),send,now+7000);assert.equal(next.state,prior);
next=await advance(prior,at(7000,'Bearish'),send,now+7000+601000);assert.equal(next.state,prior,'stale readings cannot alert');
next=await advance(prior,at(7000,'Bearish'),async()=>{throw Error('timeout')},now+7000);assert.equal(next.state,prior,'do not consume failed notification');
next=await advance(prior,at(8000,'Bearish'),send,now+8000);assert.equal(next.action,'notified');
assert.equal((await advance(next.state,at(8000,'Bearish'),send,now+9000)).action,'already checked');
const changed=notification(prior,at(9000,'Bearish',{sources:['Gate','Deribit']}));assert.match(changed.body,/Sources changed/);assert.match(changed.body,/All expiries/);assert.match(changed.click,/chatgpt.site/);
let requests=[];const mock=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({event:'message',id:'test-delivery'})}};
assert.deepEqual(await publish(sent[0],'test-only-topic',mock),{id:'test-delivery'});assert.equal(requests.length,1);assert.equal(requests[0].options.method,'POST');assert.equal(requests[0].options.body,sent[0].body);
await assert.rejects(publish(sent[0],'',mock));
await assert.rejects(publish(sent[0],'test-only-topic',async()=>({ok:false,status:500})));
await assert.rejects(publish(sent[0],'test-only-topic',async()=>({ok:true,json:async()=>({event:'error'})})));
// Optional local parity against the exact deployed dashboard, never copied into the runner.
if(process.env.CRYPTO_GAMMA_CHECKOUT){
 const root=process.env.CRYPTO_GAMMA_CHECKOUT,box=vm.createContext({});
 for(const file of ['vanna-charm.js','vc-flow.js'])vm.runInContext(readFileSync(root+'/gamma-detrite/'+file,'utf8'),box);
 const raw=parse(rows,2230,now),a=prepare(raw,raw.exps),b=box.GreekAnalytics.prepare(raw,raw.exps);
 assert.equal(a.total.vanna,b.total.vanna);assert.equal(a.total.charm,b.total.charm);
 for(const vanna of [-30e6,0,1,6.33e6,30e6])for(const charm of [-30e6,0,1,10.63e6,30e6])for(const volume of [1e8,10e9,null])for(const gamma of [-1,0,1]){
  assert.deepEqual(JSON.parse(JSON.stringify(bias(vanna,charm,volume,gamma,false))),JSON.parse(JSON.stringify(box.FlowContext.bias(vanna,charm,volume,gamma,false))));
 }
 console.log('Dashboard parity passed: 225 scenarios and exact Vanna/Charm totals.');
}
console.log('ETH flow alerts passed: baseline, transitions, deduplication, outages, freshness, retry, payload, delivery acknowledgment and turnover fallback.');
