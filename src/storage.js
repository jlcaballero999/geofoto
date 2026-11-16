const DB_NAME = 'geofoto-local-v1';
let dbPromise;
function database(){
  if(!dbPromise) dbPromise = new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>req.result.createObjectStore('visits',{keyPath:'id'});
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}
async function run(mode,fn){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('visits',mode);const store=tx.objectStore('visits');const req=fn(store);tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error||req.error);tx.onabort=()=>reject(tx.error||new Error('Operación cancelada'));});}
export const getVisits=()=>run('readonly',store=>store.getAll());
export const putVisit=visit=>run('readwrite',store=>store.put(visit));
export const deleteVisit=id=>run('readwrite',store=>store.delete(id));
export function uid(){return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;}
