// Hand-authored, reviewed configurations. No random culprit selection yet.
import {OBJECTS} from '../objects.mjs';
export const CONFIGS=Object.freeze([
 {id:'bellweather-01',title:'The Last Bell — The Ledger',culprit:'silas',weapon:'seal',weaponName:'brass seal',motive:'fraud',motiveText:'conceal diverted estate payments',minute:1274,injury:'a blunt impact with an angled brass edge',misdirection:{item:'green coat',seen:'rowan'}},
 {id:'bellweather-02',title:'The Last Bell — The Codicil',culprit:'clara',weapon:'candlestick',weaponName:'silver candlestick',motive:'inheritance',motiveText:'prevent a signed change to the inheritance',minute:1294,injury:'a blunt impact with a rounded silver rim',misdirection:{item:'grey travelling cloak',seen:'silas'}},
 {id:'bellweather-03',title:'The Last Bell — The Notice',culprit:'rowan',weapon:'knife',weaponName:'pruning knife',motive:'eviction',motiveText:'prevent the eviction of his family from the estate cottage',minute:1314,injury:'a deep wound from a narrow steel blade',misdirection:{item:'pale summer coat',seen:'clara'}}
]);
export const METHOD_OPTIONS=[['seal','Brass seal'],['candlestick','Silver candlestick'],['knife','Pruning knife']];
export const MOTIVE_OPTIONS=[['fraud','Diverted payments'],['inheritance','Changed inheritance'],['eviction','Threatened eviction']];

// Reusable spec components, so a specification can be generated and then validated
// rather than only hand-authored. buildSpec is pure: it constructs a candidate
// specification; casegen.validateCase decides whether it is admissible.
// The weapon catalog is now DERIVED from the affordance-annotated object catalog (objects.mjs): the
// method surface flows from the affordance layer, not a parallel hand-list.
export const WEAPONS=Object.fromEntries(Object.entries(OBJECTS).map(([id,o])=>[id,{name:o.name,injury:o.injury}]));
export const MOTIVES={
 fraud:{text:()=>'conceal diverted estate payments',title:'The Ledger'},
 inheritance:{text:()=>'prevent a signed change to the inheritance',title:'The Codicil'},
 eviction:{text:({poss})=>`prevent the eviction of ${poss} family from the estate cottage`,title:'The Notice'}
};
const GARMENTS={clara:'pale summer coat',rowan:'green coat',silas:'grey travelling cloak'};
const POSSESSIVE={clara:'her',rowan:'his',silas:'his'};
// Who would shield whom (mirrors the authored relationship bonds). Collusion needs a protector.
export const PROTECTOR={clara:'rowan',rowan:'clara'};
export function buildSpec({culprit,weapon,motive,minute,seen,structure='trace',manner='overt',collusion=false}){
 const w=WEAPONS[weapon],m=MOTIVES[motive];
 if(!['trace','cleanup','clockwork'].includes(structure)||!['overt','accident','suicide'].includes(manner)||(collusion&&!PROTECTOR[culprit])||!Number.isInteger(minute)||minute<1200||minute>1439||!w||!m||!GARMENTS[culprit]||!GARMENTS[seen]||seen===culprit)throw Error('Invalid spec components');
 const motiveText=typeof m.text==='function'?m.text({poss:POSSESSIVE[culprit]??'their'}):m.text;
 return {id:`gen-${culprit}-${weapon}-${motive}-${minute}-${seen}${structure==='trace'?'':'-'+structure}${manner==='overt'?'':'-'+manner}${collusion?'-collusion':''}`,title:`The Last Bell — ${m.title}`,
  structure,manner,collusion:Boolean(collusion),culprit,weapon,weaponName:w.name,motive,motiveText,minute,injury:w.injury,misdirection:{item:GARMENTS[seen],seen}};
}
// Reconstruct a spec from a generated id, so a sampled case is save/reload-safe
// without a registry: the id encodes every component buildSpec needs.
export function specFromId(id){
 const m=/^gen-([a-z]+)-([a-z]+)-([a-z]+)-(\d+)-([a-z]+)(?:-(cleanup|clockwork))?(?:-(accident|suicide))?(?:-(collusion))?$/.exec(id);
 if(!m)return null;
 try{const spec=buildSpec({culprit:m[1],weapon:m[2],motive:m[3],minute:Number(m[4]),seen:m[5],structure:m[6]??'trace',manner:m[7]||'overt',collusion:Boolean(m[8])});return spec.id===id?spec:null;}catch{return null;}
}
