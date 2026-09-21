// Personas: an explicit, systematic behavioural contract per suspect, derived from the spec and the
// authored PEOPLE data — not hand-written per case. A persona's PUBLIC STANCE (what it says unpressed)
// can diverge from its PRIVATE TRUTH (what actually happened); that divergence *is* the lie, generated
// systematically. The consistency contract makes those lies durable and catchable. This module is pure
// data + verifiers — the deterministic engine still owns reality and the LLM never mutates it.

// A typed claim in the shared claim shape (see cases/last-bell-claims.mjs). The key is shared per
// subject+predicate so a later truthful revision supersedes the earlier lie in the claim ledger.
const claim=(subject,predicate,value,interval=null,attribution='persona',confidence=.95)=>({key:`${subject}_${predicate}`,subject,predicate,value,interval,attribution,confidence});

// Strong authored bond ⇒ this NPC would shield that person. Weak trust ⇒ distrust.
const bonds=(id,PEOPLE,test)=>Object.entries(PEOPLE[id]?.relationships??{}).filter(([other,r])=>other!=='player'&&test(r)).map(([other])=>other);
const protectsOf=(id,PEOPLE)=>bonds(id,PEOPLE,r=>(r.trust??0)>=0.85&&(r.affection??0)>=0.85);
const distrustsOf=(id,PEOPLE)=>bonds(id,PEOPLE,r=>(r.trust??1)<=0.35);

/**
 * Build a persona per suspect for this specification.
 * stance: 'self-protective' (the culprit) | 'shielding-ally' (protects the culprit) | 'truthful'.
 */
export function buildPersonas(spec,{PEOPLE,suspects=['clara','rowan','silas']}={}){
  const culprit=spec.culprit,window={start:spec.minute-5,end:spec.minute+5};
  const personas={};
  for(const id of suspects){
    const protects=protectsOf(id,PEOPLE),distrusts=distrustsOf(id,PEOPLE);
    // A shielding ally only *actively* lies for the culprit in a collusion case; otherwise a protector
    // is merely disposed to shield and stays truthful about the crime.
    const stance=id===culprit?'self-protective':(spec.collusion&&protects.includes(culprit)?'shielding-ally':'truthful');
    // Private truth: own true whereabouts; a shielding ally also privately knows the culprit was at the scene.
    const trueLocation=id===culprit?'manor':'greenhouse';
    const privateTruth=stance==='shielding-ally'
      ? [claim(id,'location','greenhouse',window,'private truth',.99),claim(culprit,'location','manor',window,'private truth',.95)]
      : [claim(id,'location',trueLocation,window,'private truth',.99)];
    // Public stance: what they say unpressed. Self-protective places itself elsewhere; a shielding ally
    // falsely places the CULPRIT with them at the greenhouse (a false alibi); the truthful state the truth.
    const publicStance=stance==='self-protective'?[claim(id,'location',PEOPLE[id].home,window,'stated alibi',.9)]
      :stance==='shielding-ally'?[claim(id,'location','greenhouse',window,'stated account',.9),claim(culprit,'location','greenhouse',window,'stated alibi for an ally',.8)]
      :privateTruth.map(c=>({...c,attribution:'stated account'}));
    personas[id]={id,disposition:{traits:PEOPLE[id].traits,values:PEOPLE[id].values},allegiance:{protects,distrusts},stance,privateTruth,publicStance};
  }
  return personas;
}

// The systematic lie: the public-stance claims whose value diverges from the private truth.
export function personaLie(persona){
  const truth=new Map(persona.privateTruth.map(c=>[`${c.subject}|${c.predicate}`,c.value]));
  return persona.publicStance.filter(c=>truth.get(`${c.subject}|${c.predicate}`)!==c.value);
}

// The durable record of what each NPC has actually asserted to the player, derived from events.
export function statementLedger(session){
  const ledger={};
  for(const e of session.events??[]){
    if(e.kind!=='speech'||e.data?.listener!=='player'||!Array.isArray(e.data.claims)||!e.data.claims.length)continue;
    (ledger[e.actor]??=[]).push(...e.data.claims.map(c=>({...c,eventId:e.id,minute:e.minute})));
  }
  return ledger;
}

// Verify every NPC's spoken record against its persona contract (deterministic; no LLM):
//  - allegiance: a persona must not volunteer a claim that incriminates someone it protects
//    (placing a protected ally at the scene during the fatal window);
//  - statement history: no unrevised self-contradiction (same subject+predicate, conflicting value)
//    unless an intervening revision event forced it.
export function validatePersonaConsistency(session,personas){
  const ledger=statementLedger(session),errors=[];
  for(const [id,claims] of Object.entries(ledger)){
    const persona=personas?.[id];if(!persona)continue;
    for(const c of claims){
      if(persona.allegiance.protects.includes(c.subject)&&c.predicate==='location'&&c.value==='manor')
        errors.push(`${id}: volunteered testimony placing protected ally ${c.subject} at the scene`);
    }
    const last=new Map();
    for(const c of claims){
      const k=`${c.subject}|${c.predicate}`,prev=last.get(k);
      if(prev&&prev.value!==c.value){
        const revised=(session.events??[]).some(e=>e.minute>=prev.minute&&e.minute<=c.minute&&(e.data?.revision===true||(e.actor===id&&e.data?.basis==='receipt_challenged')));
        if(!revised)errors.push(`${id}: contradicted own ${c.predicate} for ${c.subject} (${prev.value}→${c.value}) without a revision`);
      }
      last.set(k,c);
    }
  }
  return {ok:!errors.length,errors,detail:errors.join('; ')||'Every NPC statement is consistent with its persona and prior claims'};
}
