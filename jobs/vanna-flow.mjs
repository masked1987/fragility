// Runs inside the existing serialized alert workflow. NTFY_TOPIC remains a repository secret.
import {readFileSync, writeFileSync, renameSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fresh} from '../shared/vanna-flow/core.mjs';
// The reading itself is shared with the site's Vanna tab, so card and alert agree.
import {collectReading, LABELS} from '../tools/vanna/collect.js';
const SITE='https://masked1987.github.io/fragility/#vanna';

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
export async function publish(message,topic,fetcher=fetch){
  if(!topic||!topic.trim())throw Error('NTFY_TOPIC is not configured');
  const r=await fetcher('https://ntfy.sh/'+encodeURIComponent(topic),{method:'POST',signal:AbortSignal.timeout(15000),body:message.body,
    headers:{Title:message.title,Priority:String(message.priority),Tags:message.tags,Click:message.click}});
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
  const result=await advance(previous,reading,m=>publish(m,process.env.NTFY_TOPIC));
  if(result.state&&result.state!==previous){const temporary=path+'.tmp';writeFileSync(temporary,JSON.stringify(result.state,null,2)+'\n');renameSync(temporary,path);}
  console.log(`ETH 24h flow: ${reading?.label||'unavailable'}; ${result.action}`+(reading?`; ${reading.sources.join(' + ')}; ${reading.series} series`:''));
  if(result.action.startsWith('delivery failed'))throw Error('ntfy delivery failed; previous label retained for retry');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
