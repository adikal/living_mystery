import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPersonas,personaLie,statementLedger,validatePersonaConsistency} from '../dist/personas.mjs';
import {makeCase} from '../dist/cases/bellweather.mjs';
import {createRuntime} from '../dist/engine-runtime.mjs';
import {buildSpec} from '../dist/cases/bellweather-configs.mjs';

const PEOPLE=makeCase(buildSpec({culprit:'silas',weapon:'seal',motive:'fraud',minute:1274,seen:'rowan'})).PEOPLE;
const personasFor=culprit=>buildPersonas(buildSpec({culprit,weapon:'seal',motive:'fraud',minute:1274,seen:culprit==='rowan'?'clara':'rowan'}),{PEOPLE});

test('Personas are derived systematically: the culprit is self-protective and its public stance is a lie',()=>{
 const p=personasFor('silas');
 assert.equal(p.silas.stance,'self-protective');
 // The public stance diverges from the private truth — a systematically generated false alibi.
 assert.deepEqual(p.silas.privateTruth[0].value,'manor');
 assert.equal(p.silas.publicStance[0].value,PEOPLE.silas.home); // 'vestry', not the manor
 const lie=personaLie(p.silas);
 assert.equal(lie.length,1,'the culprit has exactly one divergent (false) public claim');
 assert.equal(lie[0].value,PEOPLE.silas.home);
});

test('Innocents are truthful: public stance matches private truth, no lie',()=>{
 const p=personasFor('silas');
 for(const id of ['clara','rowan']){
  assert.equal(p[id].stance,'truthful');
  assert.equal(p[id].publicStance[0].value,p[id].privateTruth[0].value);
  assert.equal(personaLie(p[id]).length,0,`${id} tells no systematic lie`);
 }
});

test('Allegiance is read from authored bonds: Clara and Rowan shield each other',()=>{
 const p=personasFor('silas');
 assert.ok(p.clara.allegiance.protects.includes('rowan'));
 assert.ok(p.rowan.allegiance.protects.includes('clara'));
 assert.ok(p.silas.allegiance.protects.length===0,'the distrusted solicitor shields no one');
});

test('Persona model is attached to the case and consistent on a normally played session',()=>{
 const spec=buildSpec({culprit:'silas',weapon:'seal',motive:'fraud',minute:1274,seen:'rowan'});
 const cm=makeCase(spec),rt=createRuntime(cm);
 assert.ok(cm.model.personas?.silas,'personas are attached to the model');
 const s=rt.createSession();
 rt.dispatch(s,{type:'move',to:'vestry'});
 rt.dispatch(s,{type:'ask',person:'silas',topic:'night'});
 const check=validatePersonaConsistency(s,cm.model.personas);
 assert.equal(check.ok,true,check.detail);
});

test('The verifier has teeth: it flags self-contradiction and betrayal of a protected ally',()=>{
 const personas=personasFor('silas');
 // Synthetic ledger: Silas asserts vestry, then manor, with no intervening revision.
 const selfContradiction={events:[
  {kind:'speech',actor:'silas',minute:1300,data:{listener:'player',claims:[{subject:'silas',predicate:'location',value:'vestry'}]}},
  {kind:'speech',actor:'silas',minute:1310,data:{listener:'player',claims:[{subject:'silas',predicate:'location',value:'manor'}]}}
 ]};
 const a=validatePersonaConsistency(selfContradiction,personas);
 assert.equal(a.ok,false);
 assert.match(a.errors.join(';'),/contradicted own location/);
 // A revision event between them clears it (the generalised receipt-challenge mechanic).
 const revised={events:[selfContradiction.events[0],{kind:'action',minute:1305,data:{revision:true}},selfContradiction.events[1]]};
 assert.equal(validatePersonaConsistency(revised,personas).ok,true);
 // Clara volunteering that her protected ally Rowan was at the scene is an allegiance violation.
 const betrayal={events:[{kind:'speech',actor:'clara',minute:1300,data:{listener:'player',claims:[{subject:'rowan',predicate:'location',value:'manor'}]}}]};
 assert.match(validatePersonaConsistency(betrayal,personas).errors.join(';'),/protected ally rowan/);
});
