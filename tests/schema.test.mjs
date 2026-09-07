import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTIONS,PLAYER_ACTION_TYPES,validateAction,EFFECT_KINDS} from '../dist/schema.mjs';
import {createSession,dispatch,parseCommand} from '../dist/engine.mjs';

test('The action catalog covers exactly the player action types the parser can emit',()=>{
  // Every non-unknown action parseCommand can produce must be described in the catalog.
  for(const input of ['go manor','inspect desk','ask Clara about alibi','wait 10','look']){
    const a=parseCommand(input);
    assert.ok(PLAYER_ACTION_TYPES.has(a.type),`${a.type} should be catalogued`);
  }
  // present/pin/note/accuse are UI-only actions but still catalogued.
  for(const t of ['move','inspect','ask','present','wait','pin','note','accuse','look'])assert.ok(ACTIONS[t],`${t} missing from catalog`);
});

test('validateAction enforces required fields without checking semantics',()=>{
  assert.equal(validateAction({type:'move',to:'manor'}).ok,true);
  assert.equal(validateAction({type:'move'}).ok,false);
  assert.equal(validateAction({type:'present',person:'clara',clue:'letter'}).ok,true);
  assert.equal(validateAction({type:'present',person:'clara'}).ok,false);
  assert.equal(validateAction({type:'nonsense'}).ok,false);
  assert.equal(validateAction(null).ok,false);
});

test('Catalogued actions still drive the real engine (shape matches execution)',()=>{
  const s=createSession();
  // A valid catalogued action executes; an under-specified one is caught before dispatch.
  assert.equal(validateAction({type:'move',to:'manor'}).ok,true);
  dispatch(s,{type:'move',to:'manor'});
  assert.equal(s.world.player.location,'manor');
  assert.ok(EFFECT_KINDS.includes('evidence'));
});
