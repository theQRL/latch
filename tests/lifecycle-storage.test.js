import test from "node:test";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { transactRecord, requireEmpty } from "../shared/src/lib/lifecycle-db.js";
globalThis.indexedDB=indexedDB;
const legacy=new Map();globalThis.localStorage={getItem:k=>legacy.get(k)??null,setItem:(k,v)=>legacy.set(k,v),removeItem:k=>legacy.delete(k)};
test('storage migration, atomic wipe, stale-writer rejection and explicit resealing',async()=>{
 legacy.set('qrl-latch-vault-v1',JSON.stringify({fixture:'encrypted'}));
 const current=await import('../shared/src/lib/storage.js?current');
 const stale=await import('../shared/src/lib/storage.js?stale');
 await current.initializeStorage();await stale.initializeStorage();assert.equal(legacy.size,0);
 assert.deepEqual(await current.readVault(),{fixture:'encrypted'});
 await current.beginWipe();assert.equal((await current.readLifecycle()).phase,'wiping');assert.equal(await current.readVault(),null);
 await assert.rejects(stale.writeVault({bad:true}),/no longer writable/);
 await assert.rejects(current.finishMaintenance());
 await current.completeWipe();await current.authorizeUpdate('0.1.0+123456789abc');
 await assert.rejects(current.finishMaintenance());
 await current.cancelUpdateAuthorization();await current.finishMaintenance();
 await assert.rejects(stale.writeVault({bad:true}),/no longer writable/);
 await current.writeVault({fresh:true});assert.deepEqual(await current.readVault(),{fresh:true});
});
test('aborted transaction does not partially erase the record',async()=>{
 const before=await transactRecord(null,indexedDB);
 await assert.rejects(transactRecord(record=>{record.values={};throw Error('interrupted');},indexedDB),/interrupted/);
 assert.deepEqual(await transactRecord(null,indexedDB),before);
 assert.throws(()=>requireEmpty(before,['maintenance']));
});

test('storage initialization can recover after a transient failure', async()=>{
 const retry=await import('../shared/src/lib/storage.js?retry');
 const real=globalThis.indexedDB;
 globalThis.indexedDB={open(){throw Error('temporary storage failure');}};
 try { await assert.rejects(retry.initializeStorage(),/temporary storage failure/); }
 finally { globalThis.indexedDB=real; }
 const state=await retry.initializeStorage();assert.equal(state.phase,'sealed');
 assert.equal((await retry.readLifecycle()).epoch,state.epoch);
});
