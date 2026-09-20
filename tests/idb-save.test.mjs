import test from 'node:test';
import assert from 'node:assert/strict';
import {idbGet,idbSet,idbDelete} from '../dist/idb-save.mjs';

// Minimal in-memory shim covering only the IndexedDB surface idb-save.mjs uses:
// indexedDB.open -> request(onsuccess/result=db); db.transaction -> tx(oncomplete);
// store.get(key).result / put(value,key) / delete(key). Callbacks fire asynchronously,
// after the caller has assigned them, mirroring real IndexedDB ordering.
function installFakeIDB(){
  const data=new Map();
  globalThis.indexedDB={
    open(){
      const req={};
      setTimeout(()=>{const db={
        objectStoreNames:{contains:()=>true},createObjectStore(){},
        transaction(){
          const pending=[],t={};
          const os={
            get(key){const r={result:undefined};pending.push(()=>{r.result=data.has(key)?data.get(key):undefined;});return r;},
            put(v,k){pending.push(()=>data.set(k,v));return {};},
            delete(k){pending.push(()=>data.delete(k));return {};}
          };
          t.objectStore=()=>os;
          setTimeout(()=>{for(const f of pending)f();t.oncomplete&&t.oncomplete();},0);
          return t;
        }
      };req.result=db;req.onsuccess&&req.onsuccess();},0);
      return req;
    }
  };
  return ()=>{delete globalThis.indexedDB;};
}

test('idb-save degrades safely when IndexedDB is unavailable',async()=>{
  assert.equal(typeof globalThis.indexedDB,'undefined');
  assert.equal(await idbGet('living-mystery.bellweather.v1'),null,'read resolves to null, never throws');
  await assert.rejects(idbSet('living-mystery.bellweather.v1','x'),'write rejects so callers can fall back to localStorage');
});

test('idb-save round-trips a large value through IndexedDB',async()=>{
  const uninstall=installFakeIDB();
  try{
    const key='living-mystery.bellweather.v1';
    const big='m'.repeat(6_000_000); // ~6MB — beyond the ~5MB localStorage cap this feature exists to clear.
    await idbSet(key,big);
    assert.equal((await idbGet(key)).length,big.length,'a >5MB save survives a set/get round-trip');
    await idbSet(key,'small');
    assert.equal(await idbGet(key),'small','a later write overwrites the earlier value');
    await idbDelete(key);
    assert.equal(await idbGet(key),null,'delete removes the value');
  }finally{uninstall();}
});
