// Runs inside the existing serialized alert workflow. NTFY_TOPIC remains a repository secret.
import {readFileSync, writeFileSync, renameSync, existsSync, appendFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fresh} from '../shared/vanna-flow/core.mjs';
// The reading itself (tools/vanna/collect.js) uses the same rules as Gamma Detrite's Vanna & Charm view.
import {collectReading, LABELS} from '../tools/vanna/collect.js';
const SITE='https://masked1987.github.io/fragility/#gamma'; // Gamma tab: Vanna & Charm view

export {collectReading};
function money(n){return (n<0?'-':n>0?'+':'')+'$'+Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:0});}
export function notification(previous,reading){
  const old=previous.reading,time=new Date(reading.observedAt).toLocaleString('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'});
  const sourcesChanged=old.sources.join('+')!==reading.sources.join('+');
  return {title:`ETH 24h flow: ${old.label} -> ${reading.label}`,priority:3,
    tags:reading.label==='Bullish'?'chart_with_upwards_trend':reading.label==='Bearish'?'chart_with_downwards_trend':'information_source',click:SITE,
    body:`ETH Vanna + Charm: ${old.label} -> ${reading.label}.\nAll expiries; observed ${time} UK. Spot $${reading.spot.toLocaleString('en-US',{maximumFractionDigits:2})}.`+
      `\nFlat-IV flow ${money(reading.rows[1].total)}; ${reading.pct.toFixed(3)}% of selected 24h turnover. Context: ${reading.strength}.`+
      `\nIV -3 / flat / +3: ${reading.rows.map(r=>r.label).join(' / ')}.`+
      `\nVolume: ${reading.sources.join(' + ')}${reading.fallback?' (provisional backup basket)':''}.`+
      (sourcesChanged?' Sources changed since the previous reading; this can affect the label.':'')+
      (reading.observedAt-old.observedAt>3600000?' Compared with the last valid observation; there was a monitoring gap.':'')+
      '\nModel context, not a trade signal. Assumes dealers long calls and short puts.'};
}
export async function advance(previous,reading,send,now=Date.now()){
  if(!reading||reading.version!==1||reading.asset!=='ETH'||reading.selection!=='all'||!LABELS.includes(reading.label)||!fresh(reading.snapshotAt,now)||!fresh(reading.observedAt,now))return {state:previous,action:'unavailable'};
  const old=previous?.reading;
  if(old&&reading.observedAt<=old.observedAt)return {state:previous,action:'already checked'};
  const validOld=previous?.version===1&&old?.asset==='ETH'&&old.selection==='all'&&LABELS.includes(old.label);
  let receipt=null,action=validOld?'unchanged':'baseline';
  if(validOld&&old.label!==reading.label){
    try{receipt=await send(notification(previous,reading));action='notified';}
    catch{return {state:previous,action:'delivery failed; retry next run'};}
  }
  return {state:{version:1,reading,lastNotification:receipt?{id:receipt.id,from:old.label,to:reading.label,at:reading.observedAt}:previous?.lastNotification||null},action};
}
// 7 Nov 2026, owner said yes to "save every reading", to check later whether label changes came
// before real turns: one CSV row per new reading, in the same store folder (data branch).
export const LOG_HEADER='time_utc,spot,label,strength,pct_turnover,flow_iv_minus3,flow_flat,flow_iv_plus3,label_iv_minus3,label_flat,label_iv_plus3,sources,series'+
  // Daily (next expiry) and Weekly (nearest Friday) alone, background only (added 7 Nov 2026)
  ['day','week'].map(function(w){return [w+'_expiry',w+'_label',w+'_pct',w+'_flow_iv_minus3',w+'_flow_flat',w+'_flow_iv_plus3'].join(',')}).map(function(x){return ','+x}).join('');
export function logLine(r){
  const [down,flat,up]=r.rows,usd=n=>Math.round(n);
  return [new Date(r.observedAt).toISOString().slice(0,16)+'Z',r.spot.toFixed(2),r.label,r.strength,r.pct.toFixed(4),
    usd(down.total),usd(flat.total),usd(up.total),down.label,flat.label,up.label,r.sources.join('+')+(r.fallback?' (backup)':''),r.series]
    .concat(...['day','week'].map(function(w){const x=r[w];return x?[new Date(x.expiry).toISOString().slice(0,10),x.label,x.pct==null?'':x.pct.toFixed(4)].concat(x.rows.map(function(q){return usd(q.total)})):['','','','','','']})).join(',');
}
export function appendLog(path,reading){
  if(!existsSync(path))writeFileSync(path,LOG_HEADER+'\n');
  else{ // columns added since the file was started: new header, older rows padded with empty fields
    const lines=readFileSync(path,'utf8').trim().split('\n'),n=LOG_HEADER.split(',').length;
    if(lines[0]!==LOG_HEADER)writeFileSync(path,[LOG_HEADER].concat(lines.slice(1).map(function(l){const k=l.split(',').length;return k<n?l+','.repeat(n-k):l})).join('\n')+'\n');
  }
  appendFileSync(path,logLine(reading)+'\n');
}
// 7 Nov 2026, owner: "I need all alerts only 2 times": a label change rings RINGS times, a minute apart.
export const RINGS=2;
export async function publish(message,topic,fetcher=fetch,at){
  if(!topic||!topic.trim())throw Error('NTFY_TOPIC is not configured');
  const headers={Title:message.title,Priority:String(message.priority),Tags:message.tags,Click:message.click};
  if(at)headers.At=String(at); // ntfy holds it and delivers at this time (unix seconds)
  const r=await fetcher('https://ntfy.sh/'+encodeURIComponent(topic),{method:'POST',signal:AbortSignal.timeout(15000),body:message.body,headers});
  if(!r.ok)throw Error(`ntfy HTTP ${r.status}`);
  const ack=await r.json();if(ack.event!=='message'||typeof ack.id!=='string'||!ack.id)throw Error('ntfy did not acknowledge message');
  return {id:ack.id}; // Never persist the topic, which also authorizes subscriptions.
}
async function main(){
  const dry=process.argv.includes('--dry-run'),dir=process.argv[2]||'store',path=join(dir,'vanna-flow.json');
  if(!dry&&!process.env.NTFY_TOPIC)throw Error('NTFY_TOPIC missing; ETH flow alerts are not armed');
  const previous=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
  const reading=await collectReading();
  if(dry){console.log(JSON.stringify({dryRun:true,reading}));return;}
  // First ring must be acknowledged (else the label is retried next run); later rings are best effort.
  const ring=async m=>{
    const receipt=await publish({...m,title:`${m.title} [1/${RINGS}]`},process.env.NTFY_TOPIC);
    for(let k=1;k<RINGS;k++){
      try{await publish({...m,title:`${m.title} [${k+1}/${RINGS}]`},process.env.NTFY_TOPIC,fetch,Math.floor(Date.now()/1000)+60*k);}
      catch(e){console.error(`ring ${k+1} not sent: ${e.message}`);}
    }
    return receipt;
  };
  const result=await advance(previous,reading,ring);
  if(!['unavailable','already checked'].includes(result.action)&&!result.action.startsWith('delivery failed'))appendLog(join(dir,'vanna-log.csv'),reading);
  if(result.state&&result.state!==previous){const temporary=path+'.tmp';writeFileSync(temporary,JSON.stringify(result.state,null,2)+'\n');renameSync(temporary,path);}
  console.log(`ETH 24h flow: ${reading?.label||'unavailable'}; ${result.action}`+(reading?`; ${reading.sources.join(' + ')}; ${reading.series} series`:''));
  if(result.action.startsWith('delivery failed'))throw Error('ntfy delivery failed; previous label retained for retry');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
