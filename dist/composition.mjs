// Declarative composition schema + compiler (Phase 2).
//
// A *composition* is pure data describing the fact-bearing contributions of a narrative element — the
// same artifacts a hand-authored brick produces, but as a value the LLM (Phase 4) can emit and the
// engine can validate. It never carries authoritative prose: `dialogue` is an optional, non-authoritative
// flavor passthrough; every FACT lives in clues/claims/routes/occurrences, which compile to the finite
// primitive IR the solver reasons over.
//
// Shape (any field may be a value or a thunk `(ctx)=>value`, evaluated with the live hook context):
// {
//   id, requires?,                         // module identity + optional brick dependencies
//   bind: (spec)=>binding|null,            // activation; the returned binding is threaded to every thunk
//   clues:   [{ id, title, text, tags?, meta?, at?, object? }],   // inspectable evidence (+ placement)
//   claims:  [{ clue, predicate, value, requires?, ...}],         // typed evidence claims on a clue
//   routes:  { all:[clueId,...] },         // clue ids appended to every proof route (load-bearing)
//   resetClaims?: [clueId,...],            // clear a clue's existing claims before reassigning (move a pin)
//   forces?: (ctx)=>[clueId,...],          // clues that MUST be load-bearing (checked by forced-insight)
//   methodOptions?: [[id,label],...],      // extra accusation method options (spec-local)
//   synopsis?: (ctx)=>string,              // prepend/replace the case synopsis
//   occurrences: [{ id, actor, title, changes?, data?, after?, origin? }], // the prehistory DAG
//   dialogue?: (ctx)=>string|null,         // NON-authoritative flavor
//   invariant?: (ctx)=>{ok,detail}         // coherence gate checked by validateCase
// }
//
// `after` entries link an occurrence to its causes: a bare string names an EXISTING occurrence type
// (matched on data.occurrence); an '@'-prefixed string names another occurrence in THIS composition.

const R=(v,ctx)=>typeof v==='function'?v(ctx):v;

// Turn a composition into a brick module: {id,requires,bind,content,prehistory,dialogue,invariant}.
export function moduleFromComposition(comp){
  return {
    id:comp.id,
    requires:comp.requires,
    bind:comp.bind??(()=>({})),
    content(ctx){
      for(const clue of comp.clues??[]){
        ctx.set(clue.id,R(clue.title,ctx),R(clue.text,ctx),R(clue.tags,ctx)??[],{...(R(clue.meta,ctx)??{})});
        if(clue.object)ctx.OBJECTS[clue.id]={...R(clue.object,ctx),clue:clue.id};
        const at=R(clue.at,ctx);
        if(at&&ctx.LOCATIONS[at]&&!ctx.LOCATIONS[at].objects.includes(clue.id))ctx.LOCATIONS[at].objects.push(clue.id);
      }
      for(const id of R(comp.resetClaims,ctx)??[])ctx.evidenceClaims[id]=[];
      for(const cl of comp.claims??[]){
        const {clue,...rest}=cl;
        const resolved=Object.fromEntries(Object.entries(rest).map(([k,v])=>[k,R(v,ctx)]));
        ctx.evidenceClaims[clue]=[...(ctx.evidenceClaims[clue]??[]),resolved];
      }
      const all=R(comp.routes?.all,ctx);
      if(all)for(const route of ctx.CASE.proofRoutes)for(const id of all)if(!route.all.includes(id))route.all.push(id);
      for(const o of R(comp.methodOptions,ctx)??[])if(!ctx.CASE.methodOptions.some(x=>x[0]===o[0]))ctx.CASE.methodOptions=[...ctx.CASE.methodOptions,o];
      if(comp.synopsis!=null)ctx.CASE.synopsis=R(comp.synopsis,ctx);
    },
    prehistory(ctx){
      const local={};
      for(const occ of comp.occurrences??[]){
        const parents=[];
        for(const ref of R(occ.after,ctx)??[]){
          if(typeof ref==='string'&&ref.startsWith('@')){const e=local[ref.slice(1)];if(e)parents.push(e);}
          else{const e=ctx.s.events.find(ev=>ev.data?.occurrence===ref);if(e)parents.push(e.id);}
        }
        const ev=ctx.record(R(occ.actor,ctx),R(occ.title,ctx),R(occ.changes,ctx)??{},R(occ.data,ctx)??{},parents);
        local[occ.id]=ev;
        if(occ.origin)ctx.origin(R(occ.origin,ctx),ev);
      }
      // Ground a clue on an EXISTING occurrence (by type) — e.g. move a pin onto an already-recorded event.
      for(const [clue,type] of Object.entries(R(comp.origins,ctx)??{})){
        const e=ctx.s.events.find(ev=>ev.data?.occurrence===type);
        if(e)ctx.origin(clue,e.id);
      }
    },
    dialogue:comp.dialogue,
    invariant:comp.invariant??(()=>({ok:true,detail:'no local invariant'})),
    forces:comp.forces
  };
}
