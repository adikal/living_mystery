// Minimal, dependency-free IndexedDB key/value store for large autosaves.
// localStorage caps at ~5MB per origin; a long investigation with the full AI reasoning
// trace can exceed that. IndexedDB has a far larger, dynamically granted quota, so it is the
// primary durable store while localStorage remains a synchronous mirror and fallback.
// Every function is best-effort and safe when IndexedDB is unavailable (private modes, old
// browsers, or the Node test sandbox): reads resolve to null, writes reject.
const DB='living-mystery',STORE='saves',VERSION=1;
let dbPromise=null;

function open(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('indexeddb-unavailable'));return;}
    let req;try{req=indexedDB.open(DB,VERSION);}catch(e){reject(e);return;}
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('indexeddb-open-failed'));
    req.onblocked=()=>reject(new Error('indexeddb-blocked'));
  }).catch(e=>{dbPromise=null;throw e;});
  return dbPromise;
}

function run(mode,make){
  return open().then(db=>new Promise((resolve,reject)=>{
    let t;try{t=db.transaction(STORE,mode);}catch(e){reject(e);return;}
    const request=make(t.objectStore(STORE));
    t.oncomplete=()=>resolve(request?request.result:undefined);
    t.onerror=()=>reject(t.error||new Error('indexeddb-tx-error'));
    t.onabort=()=>reject(t.error||new Error('indexeddb-tx-abort'));
  }));
}

// Read a value; resolves to null when absent or IndexedDB is unavailable (never throws).
export function idbGet(key){return run('readonly',store=>store.get(key)).then(v=>v??null).catch(()=>null);}
// Write a value; the returned promise rejects if the store is unavailable so callers can fall back.
export function idbSet(key,value){return run('readwrite',store=>store.put(value,key));}
export function idbDelete(key){return run('readwrite',store=>store.delete(key));}
