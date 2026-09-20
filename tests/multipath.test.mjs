import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIGS} from '../dist/cases/bellweather-configs.mjs';
import {validateCase,checkMultipath} from '../dist/casegen.mjs';
import {makeCase} from '../dist/cases/bellweather.mjs';

test('Every configuration offers ≥2 independent routes and guards its blockable clues',()=>{
 for(const cfg of CONFIGS){
  const r=validateCase(cfg);
  assert.ok(r.obligations.multipath.ok,`${cfg.id}: ${r.obligations.multipath.detail}`);
 }
});

test('The multipath obligation has teeth',()=>{
 // Fewer than two routes fails.
 assert.equal(checkMultipath({CASE:{proofRoutes:[{id:'a',all:['x','y']}]},model:{}}).ok,false);
 // A concealable clue on every route (no alternative) fails.
 const noAlt={CASE:{proofRoutes:[{id:'a',all:['folio','medical']},{id:'b',all:['folio','ledger']}]},model:{agentPermissions:{silas:[{id:'conceal:folio',object:'folio',to:'drawer'}]}}};
 assert.equal(checkMultipath(noAlt).ok,false);
 assert.match(checkMultipath(noAlt).detail,/alternative route avoids blockable/);
 // An alternative route that avoids the concealable clue passes.
 const withAlt={CASE:{proofRoutes:[{id:'a',all:['folio','medical']},{id:'b',all:['ledger','medical']}]},model:{agentPermissions:{silas:[{id:'conceal:folio',object:'folio',to:'drawer'}]}}};
 assert.equal(checkMultipath(withAlt).ok,true);
});

test('Concealment keeps a folio-free route alive (the runtime multi-path guarantee at the case level)',()=>{
 for(const cfg of CONFIGS){
  const {CASE}=makeCase(cfg);
  assert.ok(CASE.proofRoutes.some(r=>!r.all.includes('folio')),`${cfg.id}: a route survives without the concealable folio`);
 }
});
