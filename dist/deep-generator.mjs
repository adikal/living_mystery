// Deterministic deep-case generator (M4 + breadth + depth). Builds a certified DEEP case from a seed by
// piping operators over a base spec. Each SHAPE hides a different forced forensic anchor behind a LONG
// (~5-hop) discovery ladder and frames a coherent-but-wrong naive reading that the anchor overturns.
// Each case also carries RED-HERRING FOG: neutral observations with no bearing on the crime (no claims,
// never forced, never required by a forced clue) — pure misdirection that cannot change the solution.
// Budget: the bounded solver packs reachable clues into a 30-bit set, so ladder + fog + route clues must
// stay <=30 (a base deep case uses ~16; ladders add ~+3, fog ~+4). This is the reliable engine; the LLM
// composers (llm-composer.mjs) propose over it and fall back here.
import {buildSpec} from './cases/bellweather-configs.mjs';
import {emptyArtifact,addObservation,gate,forceClues,declareInversion,pipe} from './operators.mjs';
import {validateCase} from './casegen.mjs';

const mix=s=>{s=((s>>>0)*2654435761)>>>0;s^=s>>>15;s=(s*2246822519)>>>0;s^=s>>>13;return s>>>0;};
function rng(seed){let t=mix(seed)||1;const f=()=>{t^=t<<13;t>>>=0;t^=t>>17;t^=t<<5;t>>>=0;return t/4294967296;};f();f();return f;}
const choose=(r,arr)=>arr[Math.floor(r()*arr.length)];
const SUS=['clara','rowan','silas'],MOT=['fraud','inheritance','eviction'],PHYS=['seal','candlestick','knife'];

// Build a discovery LADDER: neutral stepping-stone observations chained one behind the next, terminating
// in a gate on the forced ANCHOR clue, plus the inversion the anchor forces. Depth == stones.length.
function ladder(id,{stones,anchor,tags,meta,naive,reReads}){
 let a=emptyArtifact(id);
 for(const s of stones)a=addObservation(a,{id:s.id,title:s.title,tags,meta,at:s.at,object:{label:s.title.toLowerCase(),description:s.desc},text:s.text});
 for(let i=1;i<stones.length;i++)a=gate(a,stones[i].id,[stones[i-1].id]);
 a=gate(a,anchor,[stones[stones.length-1].id]);
 a=forceClues(a,[anchor]);
 return declareInversion(a,{anchor,naive,reReads});
}

// Red herrings: each is a self-contained, irrelevant secret. Never forced, never a premise of a forced
// clue — the solver's route ignores them, but they thicken the space the player must sift.
const FOG=[
 {id:'loveletter',at:'inn',title:'A hidden love-letter',text:'A love-letter tucked behind the inn mirror, signed with initials that match no one in the case.'},
 {id:'winebill',at:'manor',title:'An unpaid wine bill',text:'An unpaid bill for claret, months overdue: an embarrassment, and nothing more.'},
 {id:'stoppedclock',at:'manor',title:'A stopped mantel clock',text:'The mantel clock stopped days ago; its frozen hands mean nothing tonight.'},
 {id:'muddyboots',at:'greenhouse',title:'Muddy boots',text:'Muddy boots by the greenhouse door — the gardener\u2019s, from a long day of ordinary work.'},
 {id:'tornticket',at:'square',title:'A torn coach ticket',text:'Half a coach ticket to a town no one here has any reason to visit.'},
 {id:'saltcellar',at:'manor',title:'An overturned salt cellar',text:'An overturned salt cellar by the sideboard — superstition, not evidence.'},
];
function addFog(a,r,n){
 const pool=[...FOG],pick=[];
 for(let i=0;i<n&&pool.length;i++)pick.push(pool.splice(Math.floor(r()*pool.length),1)[0]);
 for(const f of pick)a=addObservation(a,{id:f.id,title:f.title,tags:['Trace'],meta:{kind:'Physical trace'},at:f.at,object:{label:f.title.toLowerCase(),description:`Examine ${f.title.toLowerCase()}`},text:f.text});
 if(pick.length>=2)a=gate(a,pick[1].id,[pick[0].id]); // one red herring hidden behind another (still load-free)
 return a;
}

const SHAPES=[
 {id:'delayed-poison',build:(id,r)=>({base:{weapon:'poison',structure:'trace',manner:'overt'},artifact:pipe(
   ladder(id,{anchor:'toxicology',tags:['Trace'],meta:{kind:'Physical trace'},naive:'the recorded time of death gives the culprit an alibi',reReads:['medical','vessel'],stones:[
    {id:'vessel',at:'manor',title:'The rinsed decanter',desc:'Examine the study decanter',text:'The study decanter has been rinsed spotless \u2014 strange, on an evening no one admits clearing away.'},
    {id:'trayring',at:'manor',title:'A faint tray ring',desc:'Study the serving-tray stain',text:'A faint sticky ring on the serving tray, where a second glass once stood and was taken away.'},
    {id:'dregs',at:'manor',title:'The discarded dregs',desc:'Sift the tipped-out dregs',text:'Tipped into the compost behind the manor: a knot of sediment and leaves, still damp.'},
    {id:'phial',at:'greenhouse',title:'A short-measured phial',desc:'Count the tonic phials',text:'In the greenhouse store a tonic phial stands one measure short of its fellows.'},
    {id:'assay',at:'surgery',title:'A hurried assay note',desc:'Read the assay scribble',text:'A hurried scribble in the surgery margin records a test run late, and abandoned half-finished.'}]}),
   a=>addFog(a,r,4))})},
 {id:'buried-motive',build:(id,r)=>({base:{weapon:choose(r,PHYS),structure:'trace',manner:'overt'},artifact:pipe(
   ladder(id,{anchor:'intent',tags:['Motive'],meta:{kind:'Document'},naive:'the estate papers read like an ordinary dispute, not a motive to kill',reReads:['ledger','folio'],stones:[
    {id:'scorched',at:'manor',title:'A scorched scrap',desc:'Retrieve the burnt corner',text:'A burnt corner of paper survives in the study grate \u2014 a few charred words, no more.'},
    {id:'ashcast',at:'manor',title:'An ash impression',desc:'Lift the ash impression',text:'Beneath the grate, ash holds the pressed ghost of the writing that burned above it.'},
    {id:'reconstructed',at:'surgery',title:'The reconstructed note',desc:'Reconstruct the burnt note',text:'Pieced together under lamplight, the fragments resolve into the lines of a letter.'},
    {id:'sealwax',at:'manor',title:'A blob of seal-wax',desc:'Match the seal-wax',text:'A bead of green seal-wax on the blotter matches the closure the burnt letter once bore.'},
    {id:'marginnote',at:'surgery',title:'A margin note',desc:'Read the margin note',text:'A clerk\u2019s margin note ties the letter\u2019s date to a demand made of the dead man.'}]}),
   a=>addFog(a,r,4))})},
 {id:'hidden-means',build:(id,r)=>({base:{weapon:choose(r,PHYS),structure:'trace',manner:'overt'},artifact:pipe(
   ladder(id,{anchor:'seal',tags:['Weapon'],meta:{kind:'Physical trace'},naive:'the weapon left in plain view looks like the murder weapon',reReads:['fragment','medical'],stones:[
    {id:'filings',at:'manor',title:'Stray filings',desc:'Collect the bright filings',text:'Bright metal filings lie by the desk \u2014 fresh, and from no object in this room.'},
    {id:'scratcharc',at:'manor',title:'A fresh scratch arc',desc:'Measure the scratch',text:'A short bright arc scored into the desk edge, cut tonight by something hard and narrow.'},
    {id:'toolmatch',at:'surgery',title:'The tool match',desc:'Match the filings to a tool',text:'Under the glass the filings match the working edge of a specific implement.'},
    {id:'whetstone',at:'greenhouse',title:'A traced whetstone',desc:'Examine the whetstone',text:'A whetstone in the potting shed carries the same bright metal in its grooves.'},
    {id:'woundcast',at:'surgery',title:'A cast of the wound',desc:'Compare the wound cast',text:'A wax cast of the wound edge fits that implement, and not the weapon left in plain view.'}]}),
   a=>addFog(a,r,4))})},
];

export function deepSpecWith(seed,{culprit,motive,shape}={}){
 const r=rng(seed>>>0);
 const cul=SUS.includes(culprit)?culprit:choose(r,SUS);
 const mot=MOT.includes(motive)?motive:choose(r,MOT);
 const seen=choose(r,SUS.filter(x=>x!==cul));
 const shp=SHAPES.find(s=>s.id===shape)||SHAPES[Math.floor(r()*SHAPES.length)];
 const id=`deep-${seed>>>0}`;
 const {base,artifact}=shp.build(`${id}-art`,r);
 const art={...artifact,bind:()=>({})};
 const make=minute=>{try{const b=buildSpec({culprit:cul,weapon:base.weapon,motive:mot,minute,seen,structure:base.structure,manner:base.manner});return {...b,id,deep:true,depthTarget:5,shape:shp.id,artifact:art};}catch{return null;}};
 for(let k=0;k<40;k++){const spec=make(1245+(((seed>>>0)*29+k*17)%150));if(spec&&validateCase(spec).ok)return spec;}
 // Ultimate fallback: the always-valid delayed-poison shape at a known-good minute.
 if(shp.id!=='delayed-poison')return deepSpecWith(seed,{culprit:cul,motive:mot,shape:'delayed-poison'});
 return make(1294)??make(1274);
}

export function deepSpec(seed){return deepSpecWith(seed,{});}
export function deepFromId(id){const m=/^deep-(\d+)$/.exec(id);return m?deepSpec(Number(m[1])):null;}

export function generateDeepCase(seed){
 const s=Number.isInteger(seed)?(seed>>>0):(Math.floor(Math.random()*0x7ffffffe)+1);
 const spec=deepSpec(s);
 return {id:spec.id,title:spec.title,seed:s,shape:spec.shape};
}
