import test from 'node:test';
import assert from 'node:assert/strict';
import {activeModules,MODULES} from '../dist/modules/index.mjs';
import {misdirection} from '../dist/modules/misdirection.mjs';
import {makeCase} from '../dist/cases/bellweather.mjs';
import {createRuntime} from '../dist/engine-runtime.mjs';
import {CONFIGS} from '../dist/cases/bellweather-configs.mjs';
import {buildSpec} from '../dist/cases/bellweather-configs.mjs';

test('Bricks interweave via peers: the affair teller is the mis-seen innocent and the note clears the sighting',()=>{
 const cm=makeCase(CONFIGS[0]); // misdirection.seen = rowan
 const {binding}=activeModules(CONFIGS[0]).find(m=>m.module.id==='secret-affair');
 assert.equal(binding.teller,'rowan','the evasive innocent is the one Ada mis-saw');
 assert.match(cm.CLUES.liaison.text,/green coat sighting/,'the note references the misdirection via peers');
});

test('Correction is a live plan: a corrected Ada travels to Bell and delivers it',async()=>{
 const {createSession,dispatch}=await import('../dist/engine.mjs');
 const s=createSession(17,'bellweather-01');
 dispatch(s,{type:'move',to:'surgery'});dispatch(s,{type:'inspect',object:'record'});
 dispatch(s,{type:'move',to:'inn'});dispatch(s,{type:'present',person:'ada',clue:'record'});
 dispatch(s,{type:'endConversation'});
 for(let i=0;i<10;i++)dispatch(s,{type:'wait',minutes:10});
 assert.ok(s.world.npcs.bell.beliefs.some(b=>b.key==='report_ada_sighting_corrected'),'Bell received the in-person correction');
});

test('Generated motive prose is role-aware (possessive by culprit)',()=>{
 assert.match(buildSpec({culprit:'clara',weapon:'knife',motive:'eviction',minute:1294,seen:'rowan'}).motiveText,/her family/);
 assert.match(buildSpec({culprit:'rowan',weapon:'knife',motive:'eviction',minute:1294,seen:'clara'}).motiveText,/his family/);
});

test('The composer activates a brick only when the spec fills its slots',()=>{
 const withMod=activeModules(CONFIGS[0]).map(m=>m.module.id);
 assert.ok(withMod.includes('misdirection'));
 const bare=activeModules({culprit:'silas'}).map(m=>m.module.id);
 assert.ok(!bare.includes('misdirection'),'misdirection needs its slot');
 assert.ok(!bare.includes('correction'),'correction needs the misdirection slot');
 assert.ok(bare.includes('concealment'),'concealment activates from the culprit alone');
 assert.ok(bare.includes('secret-affair'),'secret-affair activates from the two innocents');
});

test('A composed brick contributes its content and dialogue; a bare case omits it',()=>{
 const withMod=makeCase(CONFIGS[0]);
 assert.ok(withMod.OBJECTS.sighting,'sighting object present when brick active');
 assert.ok(withMod.CLUES.sighting.text.includes('green coat'));
 assert.ok(withMod.LOCATIONS.inn.objects.includes('sighting'));
 assert.ok(withMod.model.modules.some(m=>m.module.id==='misdirection'));
 const bare=makeCase({...CONFIGS[0],misdirection:undefined,id:'bare-01'});
 assert.equal(bare.OBJECTS.sighting,undefined,'no sighting object without the misdirection brick');
 assert.equal(bare.CLUES.sighting,undefined);
 assert.ok(!bare.LOCATIONS.inn.objects.includes('sighting'));
 assert.ok(!bare.model.modules.some(m=>m.module.id==='misdirection'));
});

test('The misdirection brick is a red herring: it implicates an innocent and is never a required clue',()=>{
 for(const spec of CONFIGS){
  const runtime=createRuntime(makeCase(spec));
  const {binding,roles}=activeModules(spec)[0];
  const inv=misdirection.invariant({binding,roles,runtime});
  assert.ok(inv.ok,`${spec.id}: ${inv.detail}`);
  assert.ok(!runtime.CASE.proofRoutes.some(r=>r.all.includes('sighting')),'sighting is not load-bearing');
 }
});

test('The brick invariant has teeth: implicating the culprit fails it',()=>{
 const spec=CONFIGS[0];
 const runtime=createRuntime(makeCase(spec));
 const {roles}=activeModules(spec)[0];
 const bad=misdirection.invariant({binding:{seen:spec.culprit,item:'green coat'},roles,runtime});
 assert.equal(bad.ok,false);
});

test('Every registered module declares the required contract methods',()=>{
 for(const m of MODULES){
  assert.equal(typeof m.id,'string');
  assert.equal(typeof m.bind,'function');
  assert.equal(typeof m.invariant,'function');
 }
});
