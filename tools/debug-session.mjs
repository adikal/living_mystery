#!/usr/bin/env node
// Debug an exported investigation ("Export investigation & trace").
// Usage: node tools/debug-session.mjs <export.json> [--turns] [--evidence]
//
// The export is a superset of the engine save: it carries the full event log,
// and every AI character turn stores its audit (the model's proposal, the
// deterministic validation result, the critic verdict, and the fallback reason)
// on the decision event. This tool reads that raw JSON — no replay, no model
// calls — so it can reconstruct exactly why any interaction did what it did.
import {readFileSync} from 'node:fs';
import {parseJsonLoose,parseCritic} from '../dist/llm.mjs';

const path=process.argv[2];
if(!path){console.error('usage: node tools/debug-session.mjs <export.json> [--turns] [--evidence]');process.exit(1);}
const save=JSON.parse(readFileSync(path,'utf8'));
const events=save.events??[];
const clip=(t,n=140)=>{t=String(t??'').replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n-1)+'…':t;};

console.log(`case: ${save.world?.caseId??'last-bell'} | events: ${events.length} | minute: ${save.world?.minute} | status: ${save.world?.status}`);
console.log(`evidence acquired: ${(save.world?.player?.evidence??[]).map(e=>e.clue).join(', ')||'(none)'}`);

// Reconstruct each character turn from its decision event + the preceding player utterance.
const turns=events.map((e,i)=>({e,i})).filter(({e})=>e.kind==='decision'&&e.data?.characterAudit);
console.log(`\n=== ${turns.length} AI character turn(s) ===`);
let fallbacks=0;
for(const {e,i} of turns){
  const a=e.data.characterAudit;
  // player utterance: nearest preceding converse command, else the heard speech
  let player='(?)';
  for(let j=i;j>=0&&j>i-8;j--){const p=events[j];if(p.kind==='command'&&p.data?.action?.type==='converse'){player=p.data.action.text;break;}if(p.kind==='speech'&&p.actor==='player'&&p.data?.listener===e.actor){player=p.data.assertion;}}
  const reply=events.slice(i).find(x=>x.kind==='speech'&&x.actor===e.actor&&x.data?.listener==='player');
  const status=a.status??'?';
  if(status!=='accepted')fallbacks++;
  console.log(`\n[min ${e.minute}] ${e.actor}  → ${status}${a.reason?' ('+a.reason+')':''}`);
  console.log(`  player: ${clip(player)}`);
  console.log(`  reply : ${clip(reply?.data?.assertion ?? e.data.proposal?.utterance)}`);
  if(process.argv.includes('--turns')||status!=='accepted'){
    (a.attempts??[]).forEach((at,k)=>{
      const p=parseJsonLoose(at.generation?.response??'null');
      const v=at.validation;
      const vstr=v==null?'-':(v.ok===false?('FAIL: '+(v.reason??v.error??'?')):'ok');
      const crit=parseCritic(at.critic?.response);
      console.log(`   attempt ${k}: account=${p?.account??'-'} intent=${p?.intent??'-'} | validation=${vstr} | critic=${crit?crit.verdict:(at.critic?'unparsed':'-')}`);
      if(!crit&&at.critic?.response)console.log(`     critic raw: ${clip(at.critic.response,100)}`);
      if(at.error)console.log(`     error: ${at.error}`);
      if(p&&status!=='accepted')console.log(`     proposed utterance: ${clip(p.utterance,100)}`);
    });
  }
}
console.log(`\nsummary: ${turns.length-fallbacks} accepted, ${fallbacks} fell back / rejected`);
